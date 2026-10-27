#!/usr/bin/env python3
"""Experimental Raspberry Pi bridge for an MLX90614 and two break-beam inputs."""

from __future__ import annotations

import json
import math
import os
import queue
import sys
import threading
import time
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

PASSAGE_TIMEOUT_SECONDS = 2.0
OBJECT_TEMPERATURE_REGISTER = 0x07
SCHEMA_VERSION = 1


@dataclass(frozen=True)
class BridgeConfig:
    entry_pin: int
    exit_pin: int
    active_level: int
    pull: str
    i2c_bus: int
    i2c_address: int

    @classmethod
    def from_environment(cls) -> "BridgeConfig":
        required = ("IG_ENTRY_BEAM_BCM", "IG_EXIT_BEAM_BCM", "IG_BEAM_ACTIVE_LEVEL", "IG_BEAM_PULL")
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

        entry_pin = int(os.environ["IG_ENTRY_BEAM_BCM"])
        exit_pin = int(os.environ["IG_EXIT_BEAM_BCM"])
        active_level = int(os.environ["IG_BEAM_ACTIVE_LEVEL"])
        pull = os.environ["IG_BEAM_PULL"].lower()
        i2c_bus = int(os.environ.get("IG_MLX90614_I2C_BUS", "1"))
        i2c_address = int(os.environ.get("IG_MLX90614_I2C_ADDRESS", "0x5a"), 0)

        if entry_pin == exit_pin or any(pin not in range(2, 28) for pin in (entry_pin, exit_pin)):
            raise ValueError("Entry and exit must use distinct BCM GPIO pins in the range 2–27.")
        if i2c_bus == 1 and any(pin in (2, 3) for pin in (entry_pin, exit_pin)):
            raise ValueError("BCM GPIO 2 and 3 are reserved for the default I2C bus.")
        if active_level not in (0, 1):
            raise ValueError("IG_BEAM_ACTIVE_LEVEL must be 0 or 1.")
        if pull not in ("up", "down", "off"):
            raise ValueError("IG_BEAM_PULL must be up, down, or off.")
        if i2c_bus < 0 or not 0x03 <= i2c_address <= 0x77:
            raise ValueError("The I2C bus or address is outside its supported range.")

        return cls(entry_pin, exit_pin, active_level, pull, i2c_bus, i2c_address)


@dataclass(frozen=True)
class Passage:
    direction: str
    timestamp: str


class PassageSequence:
    """Pairs two ordered beam activations and rearms only after both beams clear."""

    def __init__(self, timeout_seconds: float = PASSAGE_TIMEOUT_SECONDS) -> None:
        if timeout_seconds <= 0:
            raise ValueError("Passage timeout must be positive.")
        self.timeout_seconds = timeout_seconds
        self.active: set[str] = set()
        self.first_beam: str | None = None
        self.first_activation: float | None = None
        self.armed = True
        self.sequence = 0

    def update(self, beam: str, active: bool, monotonic_time: float) -> Passage | None:
        if beam not in ("entry", "exit"):
            raise ValueError("Beam must be 'entry' or 'exit'.")
        if not math.isfinite(monotonic_time):
            raise ValueError("Beam event time must be finite.")

        if active:
            if beam in self.active:
                return None
            self.active.add(beam)
            if not self.armed:
                return None
            if self.first_beam is None:
                self.first_beam = beam
                self.first_activation = monotonic_time
                return None

            assert self.first_activation is not None
            if monotonic_time - self.first_activation > self.timeout_seconds:
                self.armed = False
                self.first_beam = None
                self.first_activation = None
                return None

            direction = "ENTRY" if (self.first_beam, beam) == ("entry", "exit") else "EXIT"
            self.armed = False
            self.sequence += 1
            timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            return Passage(direction, timestamp)

        self.active.discard(beam)
        if not self.active:
            self.armed = True
            self.first_beam = None
            self.first_activation = None
        elif self.first_beam == beam:
            self.first_beam = None
            self.first_activation = None
        return None


def mlx90614_body_temperature(raw_word: int) -> float:
    temperature = (raw_word * 0.02) - 273.15
    if not math.isfinite(temperature) or not -70 <= temperature <= 380:
        raise ValueError("MLX90614 returned an out-of-range object temperature.")
    return round(temperature, 2)


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":"), allow_nan=False), flush=True)


def run_bridge(
    config: BridgeConfig,
    sensor_factory: Callable[[BridgeConfig], tuple[object, object, object]],
) -> None:
    """Run the hardware loop; sensor_factory is injected to keep logic testable."""
    event_queue: queue.Queue[tuple[str, bool, float]] = queue.Queue()
    tracker = PassageSequence()
    bus, entry_beam, exit_beam = sensor_factory(config)
    callback_lock = threading.Lock()

    def on_beam(name: str, active: bool) -> None:
        with callback_lock:
            event_queue.put((name, active, time.monotonic()))

    try:
        entry_beam.when_activated = lambda: on_beam("entry", True)
        entry_beam.when_deactivated = lambda: on_beam("entry", False)
        exit_beam.when_activated = lambda: on_beam("exit", True)
        exit_beam.when_deactivated = lambda: on_beam("exit", False)
        if entry_beam.is_active or exit_beam.is_active:
            raise RuntimeError("Both beams must be clear before the bridge starts.")
        initial_word = bus.read_word_data(config.i2c_address, OBJECT_TEMPERATURE_REGISTER)
        mlx90614_body_temperature(initial_word)
        emit({
            "schema_version": SCHEMA_VERSION,
            "type": "status",
            "status": "ready",
            "devices": {
                "mlx90614": "connected",
                "break-beam-entry": "connected",
                "break-beam-exit": "connected",
            },
        })
        while True:
            try:
                beam, active, activated_at = event_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            passage = tracker.update(beam, active, activated_at)
            if passage is None:
                continue

            temperature = None
            temperature_status = "fault"
            try:
                raw_word = bus.read_word_data(config.i2c_address, OBJECT_TEMPERATURE_REGISTER)
                temperature = mlx90614_body_temperature(raw_word)
                temperature_status = "valid"
            except (OSError, ValueError) as error:
                print(f"Temperature read failed: {error}", file=sys.stderr, flush=True)

            emit({
                "schema_version": SCHEMA_VERSION,
                "type": "passage",
                "sequence": tracker.sequence,
                "timestamp": passage.timestamp,
                "direction": passage.direction,
                "temperature_c": temperature,
                "temperature_status": temperature_status,
            })
    finally:
        entry_beam.close()
        exit_beam.close()
        bus.close()


def create_pi_sensors(config: BridgeConfig) -> tuple[object, object, object]:
    if not sys.platform.startswith("linux"):
        raise RuntimeError("The GPIO bridge can only run on Linux Raspberry Pi OS.")
    try:
        from gpiozero import DigitalInputDevice
        from smbus import SMBus
    except ImportError as error:
        raise RuntimeError(
            "Install the Raspberry Pi OS packages python3-gpiozero and python3-smbus."
        ) from error

    pull_up = {"up": True, "down": False, "off": None}[config.pull]
    active_state = bool(config.active_level)
    with ExitStack() as stack:
        bus = SMBus(config.i2c_bus)
        stack.callback(bus.close)
        entry_beam = DigitalInputDevice(
            config.entry_pin, pull_up=pull_up, active_state=active_state, bounce_time=0.05
        )
        stack.callback(entry_beam.close)
        exit_beam = DigitalInputDevice(
            config.exit_pin, pull_up=pull_up, active_state=active_state, bounce_time=0.05
        )
        stack.callback(exit_beam.close)
        stack.pop_all()
        return bus, entry_beam, exit_beam


def main() -> int:
    if os.environ.get("IG_PI_SENSOR_BRIDGE_ENABLED") != "1":
        print(
            "Pi sensor bridge is disabled. Set IG_PI_SENSOR_BRIDGE_ENABLED=1 only after "
            "reviewing the exact sensor boards, wiring, GPIO levels, and I2C pull-ups.",
            file=sys.stderr,
        )
        return 2
    try:
        config = BridgeConfig.from_environment()
        run_bridge(config, create_pi_sensors)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Pi sensor bridge failed to start: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
