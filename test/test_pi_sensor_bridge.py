import unittest
from unittest.mock import patch

from hardware.pi_sensor_bridge import (
    BridgeConfig,
    PassageSequence,
    mlx90614_body_temperature,
)


class PassageSequenceTests(unittest.TestCase):
    def setUp(self):
        self.tracker = PassageSequence(timeout_seconds=2.0)

    def test_entry_order_counts_once_until_both_beams_clear(self):
        self.assertIsNone(self.tracker.update("entry", True, 1.0))
        passage = self.tracker.update("exit", True, 1.4)
        self.assertEqual(passage.direction, "ENTRY")
        self.assertIsNone(self.tracker.update("entry", False, 1.5))
        self.assertIsNone(self.tracker.update("entry", True, 1.6))
        self.tracker.update("exit", False, 1.7)
        self.tracker.update("entry", False, 1.8)
        self.assertIsNone(self.tracker.update("entry", True, 2.0))
        self.assertEqual(self.tracker.update("exit", True, 2.2).direction, "ENTRY")
        self.assertEqual(self.tracker.sequence, 2)

    def test_reverse_order_counts_exit(self):
        self.tracker.update("exit", True, 10.0)
        self.assertEqual(self.tracker.update("entry", True, 10.1).direction, "EXIT")

    def test_expired_first_beam_does_not_count(self):
        self.tracker.update("entry", True, 1.0)
        self.assertIsNone(self.tracker.update("exit", True, 3.1))
        self.assertEqual(self.tracker.sequence, 0)
        self.tracker.update("entry", False, 3.2)
        self.assertIsNone(self.tracker.update("exit", False, 3.3))
        self.tracker.update("entry", True, 4.0)
        self.assertEqual(self.tracker.update("exit", True, 4.2).direction, "ENTRY")

    def test_beam_retrigger_does_not_duplicate_passage(self):
        self.tracker.update("entry", True, 1.0)
        self.tracker.update("exit", True, 1.1)
        self.assertIsNone(self.tracker.update("exit", True, 1.2))
        self.assertEqual(self.tracker.sequence, 1)

    def test_invalid_beam_is_rejected(self):
        with self.assertRaises(ValueError):
            self.tracker.update("side", True, 1.0)


class TemperatureTests(unittest.TestCase):
    def test_converts_mlx90614_object_temperature_word(self):
        raw_word = round((36.5 + 273.15) / 0.02)
        self.assertEqual(mlx90614_body_temperature(raw_word), 36.49)

    def test_rejects_out_of_range_temperature(self):
        with self.assertRaises(ValueError):
            mlx90614_body_temperature(0)


class ConfigurationTests(unittest.TestCase):
    def test_configuration_requires_explicit_pin_polarity_and_pull(self):
        environment = {
            "IG_ENTRY_BEAM_BCM": "17",
            "IG_EXIT_BEAM_BCM": "27",
            "IG_BEAM_ACTIVE_LEVEL": "0",
            "IG_BEAM_PULL": "up",
        }
        with patch.dict("os.environ", environment, clear=True):
            config = BridgeConfig.from_environment()
        self.assertEqual(config.entry_pin, 17)
        self.assertNotEqual(config.entry_pin, config.exit_pin)

    def test_configuration_rejects_duplicate_gpio_pins(self):
        environment = {
            "IG_ENTRY_BEAM_BCM": "17",
            "IG_EXIT_BEAM_BCM": "17",
            "IG_BEAM_ACTIVE_LEVEL": "0",
            "IG_BEAM_PULL": "up",
        }
        with patch.dict("os.environ", environment, clear=True):
            with self.assertRaises(ValueError):
                BridgeConfig.from_environment()

    def test_configuration_rejects_default_i2c_pins_as_beam_inputs(self):
        environment = {
            "IG_ENTRY_BEAM_BCM": "2",
            "IG_EXIT_BEAM_BCM": "27",
            "IG_BEAM_ACTIVE_LEVEL": "0",
            "IG_BEAM_PULL": "up",
        }
        with patch.dict("os.environ", environment, clear=True):
            with self.assertRaises(ValueError):
                BridgeConfig.from_environment()


if __name__ == "__main__":
    unittest.main()
