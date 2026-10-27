# Intelli-Gate Dashboard

Intelli-Gate is a prototype dashboard for a walk-through screening system. The dashboard currently displays simulated activity and does not consume sensor data from the experimental Raspberry Pi sensor bridge. Authentication is provided by a Node.js server; do not run this as a static website if you need the login gate.

The simulation keeps passage counts, zone alerts, and temperature readings separate: metal-only demo events show no temperature reading instead of inventing a normal value. Entry/exit counts and temperature classification remain demonstration data until a reviewed device interface is integrated.

**Hardware readiness: NOT READY FOR CONNECTION OR OPERATION.** This repository does not include ESP32 firmware, an integrated dashboard hardware adapter, a validated device protocol, or approved electrical/build instructions. An experimental, opt-in Raspberry Pi bridge for two digital break-beam inputs and an MLX90614 is provided under `hardware/`; it is not connected to the dashboard and is disabled by default. The circuit and pin assignments in the project documents are proposals, not approved wiring instructions. Do not connect or power the proposed coil, actuator, or mains-powered circuits based on those drawings alone.

Before purchasing, wiring, or claiming compliance, review [ARCHITECTURE.md](./ARCHITECTURE.md) and follow [INSTRUCTION.md](./INSTRUCTION.md). The source documents disagree about the detection-zone layout and software stack, and the exact ordered component models and electrical design have not been confirmed.

In the dashboard, **Reset** clears the local simulation and runs a 30-second simulated reboot message followed by a scrolling initialization phase before the gate returns to its green active display. This is a visual software sequence only; it does not restart or activate connected hardware.

Each simulated entry also plays a short, pitch-varying two-note chime in the browser. Audio requires a browser that supports Web Audio and may be subject to the browser's user-gesture sound policy.

## First-time setup

Requirements: Node.js 22 or later and npm. On Raspberry Pi, install a supported Node.js release for the Pi's operating system before continuing.

From a private terminal in the project directory, run:

```sh
npm run setup
```

The setup command:

1. Installs the dependencies from `package.json`.
2. Creates the private `data` directory and generates a random session-signing secret. The secret is saved to `data/session-secret`; it is not printed.
3. Prompts for an administrator username, then securely prompts you to choose and confirm a password of at least 14 characters. No default password is created.
4. Leaves an existing administrator account and existing session secret unchanged when you run setup again.

Setup requires an interactive terminal. On Linux, the data directory and credential files are restricted to the service account. On Windows, restrict the `data` folder to your account using Windows file permissions.

Start the app:

```sh
npm start
```

Then open [http://127.0.0.1:3000/](http://127.0.0.1:3000/) in the same computer. The server redirects to the sign-in page; successful sign-in leads to the dashboard. The server listens on loopback (`127.0.0.1`) by default.

After sign-in, an initialization overlay appears over the dashboard while the browser verifies the operator session, checks the authenticated application API, and prepares the simulation controls. If a software check fails, the dashboard remains locked and the overlay offers a retry. Successful software initialization opens the dashboard in simulation mode. The readiness endpoint explicitly reports Raspberry Pi, ESP32, and sensors as disconnected: the experimental Pi bridge is not integrated with the application, so the sequence does not prove or activate physical equipment.

After the startup overlay, the completion prompt confirms dashboard services and simulated modules are ready. Choose **Proceed** to display the dashboard in browser fullscreen, or **Continue in window** to use the normal browser view. The explicit click is required by browser fullscreen security rules. Physical hardware is not connected.

## Accounts

Setup creates one administrator. To add another user or administrator, run:

```sh
npm run create-user -- --username operator1 --role user
npm run create-user -- --username another-admin --role admin
```

The CLI prompts for the password without putting it in command history. Passwords must be at least 14 characters. Usernames may contain 3–64 letters, digits, periods, underscores, `@`, or hyphens. There is no public signup or password reset endpoint. Authorized Pi operators manage or remove accounts in `data/auth-users.json`; changes take effect on the next authenticated request. Keep the file private and make secure backups.

## Raspberry Pi network deployment

The server is deliberately not exposed to the LAN by default. For remote dashboard access, place it behind a trusted TLS reverse proxy, enable production settings, and restrict access with the Pi firewall:

```sh
NODE_ENV=production HOST=127.0.0.1 npm start
```

Configure the reverse proxy to terminate TLS and forward requests to `127.0.0.1:3000`. If the proxy runs on another machine, bind Express to a reachable interface only when the Pi firewall permits the proxy host alone. Configure `TRUST_PROXY_HOPS` only when you know the exact proxy count. Do not port-forward the app or expose port 3000 to the public internet. Production cookies are Secure and require HTTPS.

For service-manager deployment, protect its environment and the `data` directory; do not store `SESSION_SECRET` in source control or a world-readable environment file. The generated secret can remain in `data/session-secret`. Back up the account store, session secret, and session database securely. Review [SECURITY.md](./SECURITY.md) before network deployment.

## Development and tests

```sh
npm test
```

Tests use an isolated temporary data directory. They exercise login, session rotation, role authorization, protected readiness reporting, and logout without using production accounts.

## Hardware integration status

The authenticated `/api/system/readiness` endpoint reports that the application API and user session are ready, but explicitly reports `mode: "simulation"` and hardware `not-connected`. The splash screen and green dashboard indicators are not proof that a Raspberry Pi, ESP32, sensor, coil, or actuator has been detected or tested. Running the standalone bridge does not change API readiness or dashboard readings.

### Experimental Raspberry Pi sensor bridge

The bridge source is `hardware/pi_sensor_bridge.py`. It pairs two ordered digital break-beam activations as entry/exit, then samples the MLX90614 object-temperature register and emits newline-delimited JSON to stdout. It requires an explicit GPIO BCM pin pair, active level, and pull configuration; it will not guess these from a sensor listing. It refuses to start unless enabled with `IG_PI_SENSOR_BRIDGE_ENABLED=1`, checks that both beams are clear, and performs an initial temperature read before reporting ready. A failed temperature sample is emitted as `temperature_c: null` with `temperature_status: "fault"` rather than being replaced with demo data.

This is a bench-integration component only: it is not a persistent service, does not store readings, and has no authenticated connection to the Express API. Keep it disabled until the exact break-beam modules, output voltage/polarity, pull-up arrangement, MLX90614 breakout/I2C pull-up voltage, Pi OS, and pin assignments have been reviewed. Pi GPIO inputs must not receive 5 V.

The project owner selected the six-zone layout: left/right upper, middle, and lower positions. Six MDS-60 detector kits have been ordered for one-to-one zone assignment; Raspberry Pi 5 and ESP32-WROOM-32 are the selected controllers. Older manuscript sections and diagrams still describe four logical zones including a bag zone and must be revised to match. The supplied MDS-60 listing gives 3–5 V supply, under 100 mA current, approximately 60 mm detection distance, and local sound/light alarm, but does not document a controller-readable output pin or electrical output level. Do not connect its alarm/coil terminals directly to Pi/ESP32 GPIO until the actual board interface is identified and its signal conditioning reviewed. The latest scope excludes a physical gate actuator.

Known blocking checks include the MDS-60 output/terminal specification and six-channel interface; exact temperature and beam sensor modules; GPIO voltage compatibility and ESP32 pin mapping; I²C pull-up voltage; power budgets, thermal limits, protection, isolation and grounding; a versioned device protocol; detection cross-talk and calibrated screening tests; and site-specific electrical, privacy, and safety approval. Applicable site and jurisdiction requirements have not yet been identified. A qualified reviewer must approve the final schematics and construction details before the detector interface is connected or the complete system is energized.

The owner has also purchased a 24 V/10 A switching supply, a 24-to-5 V/5 A buck converter, and a 3.3 V LDO regulator. These are inventory items, not an approved wiring plan: the present MDS-60 modules require only 3–5 V, the Pi is to use its separate approved supply, and the 24 V supply has no confirmed load in the current actuator-free design. Do not connect the 24 V rail to MDS-60 boards, GPIO, sensors, or the Pi. Have the mains supply installation and regulator/module compatibility reviewed before use.

The workbook [ESP32_Six_Zone_Metal_Detector_Updated_BOM FINAL.xlsx](./ESP32_Six_Zone_Metal_Detector_Updated_BOM%20FINAL.xlsx) is a separate DIY six-coil detector proposal, not an MDS-60 wiring/interface plan. Its 26 line items total PHP 20,430 as listed, but it has duplicate/overlapping parts and omits several selected system components. See the BOM review in [INSTRUCTION.md](./INSTRUCTION.md) before using it as a purchase or wiring list.

See [INSTRUCTION.md](./INSTRUCTION.md) for staged software setup, hardware-readiness gates, and commissioning checklists. Hardware installation, commissioning, calibration, and compliance have not been performed or verified by this software repository.

## Current limits

- The simulated controls and reports in this prototype are browser-side demonstration features. A hidden page or UI role is not authorization; any future real readings, report downloads, threshold changes, or device commands must go through authenticated, role-checked server APIs.
- The example admin API demonstrates authorization only; it is not a full user-management interface.
- Login does not secure ESP32 firmware, UART, Wi-Fi/MQTT, GPIO, physical access, or a separate device network. Follow the hardware and safety guidance in [SECURITY.md](./SECURITY.md) before integrating devices.
- No default credentials or emergency bypass are included. Keep local safety-critical alarms and detection independent of web login and network availability.
