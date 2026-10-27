# Intelli-Gate Project Status

Last updated: 2026-10-23

## Overall status

Status: Prototype / software simulation only

The project has a working authenticated dashboard simulation and setup flow, but the physical hardware and live-edge integration are not delivered or approved for deployment. The repository explicitly states that the system is not ready for connection to Raspberry Pi, ESP32, sensors, or actuator hardware.

## Scope status

### Already delivered / completed

- Authenticated Node.js / Express application with sign-in, logout, session management, and role checks.
- Browser-based dashboard UI with simulated zone activity, alerts, temperature events, and status overlays.
- Local demo controls for entry/exit simulation, random alert generation, high-temperature simulation, reset, and fullscreen mode.
- Dashboard event model distinguishes missing temperature data from a measured value; metal-only demo alerts no longer imply a temperature sample.
- Temperature classifications use finite numeric samples and the configured threshold; changing the threshold reclassifies all available demo events.
- Dashboard labels and status presentation identify the interface as simulation-only and show physical hardware offline.
- Project setup flow via `npm run setup` to create the private data directory, session secret, and admin account.
- User creation CLI support for adding users or admins.
- Automated tests covering login, logout, session rotation, role authorization, protected readiness checks, and temperature/event classification.
- Documentation for setup, security, and architecture baselines.
- Experimental Raspberry Pi sensor bridge prototype for two break-beam sensors and MLX90614 temperature sampling, intentionally disabled unless explicitly enabled.

Evidence:
- [README.md](./README.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INSTRUCTION.md](./INSTRUCTION.md)
- [package.json](./package.json)
- [server.js](./server.js)
- [index.html](./index.html)

### Not delivered / not implemented

- Live Raspberry Pi hardware integration.
- ESP32 firmware and communications protocol.
- Real sensor ingestion from the dashboard (temperature, break-beam, or metal detection inputs).
- Physical alarm/actuator control.
- Final validated power, grounding, and safety design.
- Final six-zone hardware mapping confirmed for all detector, sensor, and controller interfaces.
- Durable event storage and audit trail for live device readings.
- Approved wiring, BOM, and electrical build instructions for the complete system.
- Compliance validation for safety, screening accuracy, privacy, and deployment readiness.
- Full reconciliation of existing design docs that still contain stale or conflicting references.

### Current blockers

- The repository notes that older architecture and hardware documents disagree about the device layout and software stack.
- Hardware is described as a proposed target only; it is not built, electrically reviewed, or validated.
- The MDS-60 output interface and controller-readable signal are not confirmed.
- Exact temperature and break-beam sensor models, electrical levels, and final board/pin mapping are not confirmed.
- There is no finished ESP32-to-Pi protocol or firmware implementation.
- The dashboard readiness endpoint explicitly identifies the environment as simulation mode and reports hardware as not connected.

### Project risk summary

- Hardware and software scope are not yet integrated.
- The project is not ready for operational deployment or live commissioning.
- Visual dashboard activity is not evidence of actual device health or detector accuracy.
- Design decisions still require verification before ordering or wiring real hardware.

## Status by workstream

### Software
- Status: Delivered as simulation prototype
- Notes: Authentication, dashboard simulation, explicit no-reading behavior, counter/alert separation, and targeted model tests are implemented. Live sensor ingestion is not delivered.

### Hardware
- Status: Not delivered / not approved
- Notes: No verified hardware integration, controller firmware, or physical wiring build is in place.

### Sensor and detection stack
- Status: In design only
- Notes: Six-zone concept is selected. Physical detection interfaces, sensor models, and signal mapping remain unverified.

### Documentation and compliance
- Status: Partially complete but not final
- Notes: Setup and architecture docs exist, but some documents still require reconciliation and approval before build or deployment.

## Update rule for future scope changes

This file should be updated whenever a scope item changes status.

Use the following labels:
- Done = completed and verified
- In progress = active development underway
- Pending = planned but not started
- Not delivered = not implemented or not approved
- Blocked = waiting on design, hardware, or approval decisions

## Recommended next milestone

### Live integration prerequisites (blocked on verified hardware details)

1. Confirm the delivered MDS-60 board revision, terminal labels, controller-readable output function, and output voltage from its actual documentation.
2. Confirm exact Pi, ESP32, temperature-sensor, and break-beam models/revisions and reviewed signal/power interfaces.
3. Obtain qualified review of the wiring, power budget, grounding/isolation, and protection design before connecting equipment.
4. Define and test the device message contract: identity, protocol version, sequence/freshness, units, limits, faults, timeout, and malformed/duplicate-message behavior.
5. Implement authenticated server-side sensor ingestion and durable event records only after steps 1–4 are signed off; do not trust browser-provided hardware readings.
6. Add integration tests and commissioning acceptance criteria for counting, six-zone metal events, temperature thresholds, offline/fault behavior, and recovery.

Until these prerequisites are verified, the UI work remains prototype-only and no live detection or screening accuracy claim is supported.

This document is the baseline project status. Update it as each milestone is completed and verified.
