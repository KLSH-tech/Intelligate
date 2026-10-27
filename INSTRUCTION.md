# Intelli-Gate Setup and Hardware Integration Instructions

## 1. Readiness statement

**Current status: software simulation only; hardware is not ready to connect.**

The present dashboard uses Node.js/Express and browser-side simulated readings. `GET /api/system/readiness` explicitly returns simulation mode and disconnected hardware. The animated startup sequence is not a physical self-test. An experimental standalone Pi sensor bridge now exists for two break-beam inputs and an MLX90614, but it is opt-in, not consumed by the dashboard, and not evidence that the hardware is connected or commissioned. There is still no ESP32 firmware, validated device protocol, integrated live sensor ingestion, hardware command API, or physical commissioning record.

The proposed schematics and pin tables are not construction instructions. Do not apply power, connect coils, install an actuator, or claim hardware compliance until the design and wiring have been reviewed and approved by qualified personnel.

## 2. Software-only setup

### Requirements

- Node.js 22 or later and npm.
- A private terminal and a trusted computer.
- If hosting on a Raspberry Pi, a supported Pi OS and Node.js build for its CPU/OS.

### Install and run

From the project directory:

```sh
npm run setup
npm start
```

The setup command installs dependencies, creates the private application data directory and session secret, and interactively creates the initial administrator. It does not create a default password. Do not expose the secret, password, account store, or session database in source control.

Open `http://127.0.0.1:3000/` on the same machine. For LAN access, configure TLS termination and firewall restrictions as described in [README.md](./README.md) and [SECURITY.md](./SECURITY.md). Do not expose port 3000 directly to the public internet.

Run the existing test suite after code changes:

```sh
npm test
```

These tests cover the current software application, not physical hardware.

### Experimental Pi sensor bridge (bench only)

The script `hardware/pi_sensor_bridge.py` requires Raspberry Pi OS, GPIO Zero, SMBus support, the exact reviewed sensors, and configuration below. It is disabled unless `IG_PI_SENSOR_BRIDGE_ENABLED=1`. Do not use the example pins as a wiring recommendation; choose BCM pins only after checking the actual modules, Pi pin constraints, pull-ups, and reviewed wiring. The script rejects duplicate/out-of-range pins and BCM 2/3 when using default I2C bus 1.

Example environment after that review:

```sh
export IG_PI_SENSOR_BRIDGE_ENABLED=1
export IG_ENTRY_BEAM_BCM=<reviewed-entry-pin>
export IG_EXIT_BEAM_BCM=<reviewed-exit-pin>
export IG_BEAM_ACTIVE_LEVEL=<0-or-1-from-module-datasheet>
export IG_BEAM_PULL=<up-down-or-off-from-reviewed-circuit>
export IG_MLX90614_I2C_BUS=1
export IG_MLX90614_I2C_ADDRESS=0x5a
python3 hardware/pi_sensor_bridge.py
```

Install the supported Raspberry Pi OS packages only after confirming the OS/package versions: `sudo apt install python3-gpiozero python3-smbus`. Confirm that the installed GPIO Zero pin factory supports the exact Pi 5 OS, enable I2C in Raspberry Pi OS, and confirm the MLX90614 is visible at the reviewed bus/address before starting. The bridge emits a `status` JSON line only after both beams are clear and the initial MLX90614 read is valid. Subsequent `passage` records include direction, sequence, UTC timestamp, temperature, and an explicit temperature status; failed temperature reads remain null and are logged to stderr. The counter requires entry-then-exit for ENTRY and exit-then-entry for EXIT, within two seconds, and rearms after both beams clear. Ambiguous/expired sequences are discarded until clear. This is a basic single-person sequence counter, not a validated turnstile or tailgating detector.

Use `python -m unittest test.test_pi_sensor_bridge` for hardware-independent logic tests. The bridge currently writes JSON to its terminal only. It does not connect to Express, update dashboard counts, persist records, or detect MDS-60 zones. Keep `IG_PI_SENSOR_BRIDGE_ENABLED` unset until physical module/polarity/pull-up details and electrical safety are confirmed.

## 3. Decisions required before ordering or wiring hardware

Complete and approve a design record before building. Use exact part numbers and datasheets; product-family names are not sufficient.

| Decision | Evidence required | Status |
|---|---|---|
| Detection layout | Six-zone L/R × upper/middle/lower; matching mechanical drawing, protocol, dashboard labels, and tests | Selected by project owner; older documents still need revision |
| Raspberry Pi | Exact model, board revision, OS, power supply and interface allocation | Pi 5 selected; OS/revision and supply still verify |
| ESP32 | Exact DevKit/module and silicon/board revision; approved pin map that avoids unsafe boot-strap behavior | ESP32-WROOM-32 development board selected; exact board revision and pin map verify |
| Metal detection | Six MDS-60 kits, documented external output, compatible isolated interface, detection/cross-talk validation | Six kits ordered; seller specs supplied, but controller-readable output is not identified |
| Sensors | Exact MLX90614 board and break-beam models, logic levels, outputs, optics/standoff and mounting | Pi-attached I²C temperature + entry/exit beams selected; modules not yet specified |
| Display/alarm | Exact LCD backpack voltage and pull-ups; buzzer type and approved driver | Proposed only |
| Power and protection | Load/current/thermal budget, rated supplies, isolation/interface design, fusing, transient protection, grounding and enclosure review | Pi separate supply selected. Owner reports 24 V/10 A PSU, 24-to-5 V/5 A buck and 3.3 V LDO purchased. MDS-60 is specified 3–5 V, <100 mA each (<600 mA total stated maximum); actual rail allocation, load budget and protection are unreviewed |
| Actuator | Gate actuator and physical barrier | Excluded from current scope |
| Communications | Versioned UART or network framing, error detection, timeouts, device identity, secure provisioning and recovery | ESP32-to-Pi protocol and firmware not implemented |
| Acceptance requirements | Measurable detection, counting, temperature-screening, fault, safety, privacy and security criteria | Open; site/jurisdiction requirements not identified |

The owner-selected mapping is Z01 `L_UPPER`, Z02 `L_MIDDLE`, Z03 `L_LOWER`, Z04 `R_UPPER`, Z05 `R_MIDDLE`, and Z06 `R_LOWER`. The MDS-60 seller information supplied by the owner specifies 3–5 V supply, <100 mA operating current per board, approximately 60 mm detection distance, and local sound/light alarm; it does not specify an external controller-readable output. A pre-assembled MDS-60 is not equivalent to the analog coil/receive front-end in the old circuit sheets. Do not connect any MDS-60 terminal directly to Raspberry Pi 5 or ESP32 GPIO until the board labels, signal levels, and output function are confirmed. Raspberry Pi 5 GPIO and ESP32 GPIO use 3.3 V logic and are not 5 V tolerant. Pi 5 has no general-purpose analog input.

Six boards at their stated maximum operating current would draw less than 600 mA together, before startup/transient margin and any other loads; this is not a complete supply-sizing calculation. The purchased 24-to-5 V/5 A converter has ample nominal current for only the six boards on paper, but do not connect it until its output regulation/ripple, safety, the actual detector revision, and the full 5 V peripheral load have been checked. Keep the Pi 5 on its separate approved supply; do not power it from this converter. The MDS-60 modules are 3–5 V devices: never connect their supply pins to 24 V. The 24 V/10 A supply currently has no confirmed load in this actuator-free design and should remain disconnected unless an approved circuit requires it. A 3.3 V LDO is not automatically suitable for the ESP32 board or all sensors; confirm exact part number, current capability, thermal dissipation, and each board's permitted supply pin. Any direct shared grounds or isolation arrangement must follow the reviewed schematic. The 24 V supply's AC mains terminals must be covered and installed by qualified personnel with appropriate protection.

### BOM workbook review

Reviewed `ESP32_Six_Zone_Metal_Detector_Updated_BOM FINAL.xlsx` (worksheet `Updated BOM (2)`). It contains 26 priced line items and reports **PHP 20,430**; the listed line-item totals sum to that figure. This is a costed proposal, not evidence that every line item was bought or an approved circuit.

The workbook is a **different detector design** from the six pre-assembled MDS-60 modules already ordered:

- It proposes six DIY coils, six TC4420/IRLZ44N coil-driver channels, flyback diodes, and six OPA2134/LM358 signal-conditioning channels. Those parts belong to a custom analog detector design; they are not an interface for reading six MDS-60 boards.
- Do not combine the DIY coil transmit/receive design with MDS-60 modules as if they were interchangeable. Select one detector architecture. Given the six MDS-60 kits already ordered, treat them as the current hardware candidate and mark the DIY coils/drivers/analog stages **not required for the MDS-60 path** unless the project owner explicitly changes direction after review.
- The MDS-60 board needs a documented controller-readable alarm output for live zone data. The workbook does not list the six MDS-60 kits or an interface for their outputs. Keep live metal readings disabled until the actual MDS-60 board output has been identified and electrically reviewed.
- The workbook calls the ESP32 the “single master controller”; the selected application architecture instead uses the Pi 5 as web/API host and the ESP32 as a subordinate device controller. Update the workbook’s controller role and specify an authenticated/validated Pi–ESP32 message contract before firmware is written.
- The workbook omits the selected Pi 5 and its separate approved supply, the MLX90614 module, both passage-beam modules, and a documented MDS-60 output adapter. These remain procurement/verification gaps.
- There are overlapping entries: active buzzer appears twice; frame materials appear twice; “PVC coil frames” and “coil former” may overlap; signal conditioning lists OPA2134 and LM358 modules without a complete circuit showing whether both stages are intended. Reconcile quantities and remove double-counting before treating PHP 20,430 as a final budget.
- The BOM does not specify coil inductance/resistance, operating waveform/frequency, driver supply/thermal design, analog-stage rails/common-mode range, ADC protection, or measured signal range. The listed flyback diode must be evaluated as part of the detector's coil-energy/recovery design because it can change coil decay and sensing behavior; do not treat the diode, MOSFETs, or op-amp labels alone as a complete detector circuit. Keep all ESP32 ADC inputs within the board's documented limits.
- The 24 V/10 A supply is listed for the DIY coil system but has no confirmed load in the chosen MDS-60/no-actuator plan. It must not feed MDS-60 boards. The 24-to-5 V converter may be a candidate source for low-voltage peripherals only after output and load review; it is not the Pi 5 supply. The generic 3.3 V LDO is not a default ESP32 DevKit supply—the board has its own regulator, and LDO suitability depends on its exact part, current, dissipation and intended load.

**Current use assessment:** ESP32-WROOM-32 DevKit and the 0.96-inch SSD1306 OLED are potentially reusable after module/logic checks. Frame materials, wiring, terminal blocks, LEDs and buzzer may be reusable where they match the final mechanical/electrical design. The DIY coil-driver and analog signal chain is a separate experimental design and cannot be approved from this BOM alone. The Pi 5 must retain its separate approved supply. MDS-60 detector power and output interface need separate verification.

**Stop condition:** if the exact component, MDS-60 output pin/function/voltage, controller pin electrical limits, power path, protection, or sensor signal type is unknown, do not connect the signal to GPIO or energize the complete system. Obtain a schematic review from a qualified electronics professional and resolve the open design decisions first.

## 4. Recommended staged implementation

### Stage A — Freeze the design

1. Use the owner-selected six-zone layout: `L_UPPER`, `L_MIDDLE`, `L_LOWER`, `R_UPPER`, `R_MIDDLE`, and `R_LOWER`. Revise older manuscript sections and diagrams that still describe `UPPER`, `MIDDLE`, `LOWER`, and `BAG`; do not silently keep both schemes.
2. Assign one MDS-60 to each zone, label the board and harness Z01–Z06, and document exact board revision, connector labels, supply pins, and any external alarm output.
3. Obtain the MDS-60 circuit/output documentation. Confirm whether an external digital signal exists, its active polarity, voltage/current, alarm behavior, and whether it is electrically isolated. If there is no documented external signal, design and review a non-invasive isolated sensing interface or replace the detector with a unit having a documented output; do not tap its coil or sounder by guesswork.
4. Reconcile the scope, objectives, mechanical drawing, BOM, circuit, DFDs, data schema, firmware map, dashboard terms, and test forms to the six-zone selection and current no-actuator scope.
5. Identify each exact temperature and break-beam module and collect its datasheet, supply range, logic levels, current draw, interface, and environmental limits. Configure I²C pull-ups for 3.3 V logic.
6. Commission an electrical review of the detector interface, power domains, protection, enclosure, grounding/isolation and mains wiring before fabrication or system power-up. Keep the Pi on its separate approved supply.
7. Define operational risks and measurable test criteria. Metal detection does not identify an object's type or dangerousness. A nominal 60 mm seller-stated range is not a validated walk-through-gate detection envelope. An MLX90614 surface reading is not a medical diagnosis.

### Stage B — Implement the device contract (after Stage A approval)

1. Define a versioned frame schema before writing ESP32 or Pi code. The data dictionary proposes `protocol_version`, `device_code`, `boot_id`, monotonic `sequence_no`, `event_type`, zone, signal/unit, threshold, decision, event time, quality and integrity fields.
2. Specify encoding/framing, maximum length, parser time/memory bounds, checksum/integrity method, supported protocol versions, freshness limits, sequence rollover, duplicate detection, reconnect behavior, clock source, and malformed-frame handling.
3. Treat the transport as untrusted. UART wiring alone does not authenticate a device; use enclosure/access controls and, for network transports, per-device authentication and an approved protected channel.
4. Write firmware with bounded configuration, watchdog/recovery policy, explicit sensor faults, safe local alarm behavior, and a controlled signed-update/recovery process.
5. Implement the Pi-side adapter behind the server boundary. Validate every message, map only registered devices/zones, persist auditable events, and never return successful readiness for stale, missing or invalid data.
6. Keep device credentials out of browser code and source control. Browser commands, if any, must pass through authenticated and role-checked server APIs, be allow-listed, rate/bounds checked, and audited.

### Stage C — Implement truthful live readiness

Keep simulation and hardware operation separate. The current endpoint is intentionally simulation-only. A future live-mode change must have explicit server-side mode selection and per-device results based on actual probes and recent heartbeats; it must not be inferred from successful login, server startup, UI animation, or an open serial port alone.

For each required component, define what constitutes connected, healthy, degraded, faulted, stale, and not connected. On any required-component failure, show an explicit fault/degraded state and block dependent operation. Never translate unknown data into a green/ready state. Preserve local detection/alarm behavior if the browser, LAN, or web service fails.

### Stage D — Bench test and commission

Proceed in this order only after design approval. Use current-limited/isolated lab arrangements and the approved procedure; this guide does not replace lab safety instructions.

1. Inspect the unpowered assembly against the approved schematic, harness labels, isolation boundaries and enclosure drawing.
2. Have a qualified reviewer verify continuity, polarity, ground strategy, protection, voltage rails, and absence of shorts before power-up.
3. Power and test each low-voltage subsystem independently using its approved procedure. Measure rail voltage, current and thermal behavior; stop on unexpected heating, odor, noise, reset, or out-of-range values.
4. Test the Pi/ESP32 communication parser with valid, malformed, truncated, oversized, duplicated, stale, wrong-version, and disconnect/reconnect frames.
5. Test each sensor and each approved zone independently; record known test objects, placement, environmental conditions, thresholds, false positives/negatives and repeatability.
6. Test beam ordering for entry, exit, reverse movement, interrupted beam, two people close together, and ambiguous sequences.
7. Validate temperature measurement only under a documented standoff, angle, ambient range, warm-up, reference comparison and movement protocol. Label the result as screening only.
8. Test network loss, Pi restart, ESP32 restart, database error, sensor fault and recovery. Confirm local alarm/fault behavior, event ordering, deduplication and durable recovery.
9. Once the in-scope actuator design is approved, test its safe state, manual release, power-loss behavior and emergency egress independently of the dashboard. Do not use a web login or network dependency as a safety interlock.
10. Obtain documented acceptance from the hardware reviewer, system owner, site safety authority and privacy/security owner before operational use.

## 5. Security, privacy, and operational controls

- Keep the dashboard on a restricted network; use TLS for LAN access and firewall rules that permit only intended operator devices.
- Give each device a unique identity/credential where the approved transport supports it. Provide revocation, rotation, backup, recovery and signed firmware-update procedures.
- Restrict physical access to the Pi, ESP32, debug ports, wiring, storage and power controls.
- Apply server-side authorization to all live readings, reports, settings and commands. Audit access and changes without logging secrets or unnecessary personal data.
- Define minimum necessary data collection, retention/deletion, backup protection, incident response and access review with the institution.
- Keep alarms and safety behavior independent from authentication, browser availability, Wi-Fi and the dashboard process.
- Treat temperature as non-diagnostic and metal events as screening indicators requiring human review. Do not make unsupported claims about threat classification or medical results.

## 6. Acceptance record

Do not mark the system hardware-ready until the project retains:

- Approved, versioned BOM, schematics, wiring/harness schedule and enclosure/mechanical drawings.
- Signed zone-layout and software-stack decisions resolving all source-document conflicts.
- Reviewed electrical safety, power budget, grounding, isolation, protection and thermal evidence.
- Firmware and adapter versions, protocol specification, test logs and recovery/update procedure.
- Calibration and repeatability reports for every sensor and detection channel, including false-positive/negative analysis.
- Fault-injection, network-loss, restart, persistence, access-control and audit test evidence.
- Actuator risk review and manual/emergency release evidence, if applicable.
- Written site/security/privacy approval and a documented operational owner.

Until these records exist, describe the project as a **simulation with a proposed hardware architecture**, not as compliant, commissioned, plug-and-play, or ready for screening operation.
