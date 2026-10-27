# Intelli-Gate authentication and deployment security

## What this change protects

- The Express server, not browser JavaScript, decides whether `/dashboard`, `/index.html`, and authenticated API routes are available.
- Both `user` and `admin` accounts may sign in to the dashboard. The administrator-only `/api/admin/users` route demonstrates server-enforced role authorization and never returns password hashes.
- Passwords are prompted interactively and stored as salted scrypt hashes. Sign-in uses a generic failure message, constant-time hash comparison, and a five-failure/15-minute IP rate limit.
- Sessions use a server-side SQLite store, a 30-minute cookie lifetime, session-ID rotation at sign-in, HttpOnly/SameSite cookies, CSRF tokens for state-changing requests, and security headers. Structured login success/failure, throttling, logout, and administrator account-list access events go to the service log without passwords, cookies, or CSRF tokens.
- Authenticated requests re-check the account store, so deleting an account or changing its role invalidates/updates the active session on its next request.
- Accounts, session database, and secret material are not intended for version control. Do not add real credentials, sensor readings, or personal data to the static demo.

## Raspberry Pi setup

1. Install a supported Node.js 22+ release and required build tools on the Pi. Run `npm run setup` in a private interactive terminal. It installs dependencies, creates a random private session secret, and prompts for the first administrator; it creates no default password.
2. The setup-generated secret is stored in `data/session-secret` (or `AUTH_DATA_DIR/session-secret`). Alternatively, supply a unique `SESSION_SECRET` of at least 32 bytes from the service manager's protected environment. Never commit it or put it in a URL.
3. Create additional accounts in a private terminal with `npm run create-user -- --username operator1 --role user`. There is no public signup or password reset endpoint.
4. For deployment, set `NODE_ENV=production`; this enables Secure cookies, so TLS must terminate at a trusted reverse proxy. Express binds to `127.0.0.1` by default. If the reverse proxy runs on another host, set `HOST=0.0.0.0` only with a firewall rule restricting access to that proxy. Set `TRUST_PROXY_HOPS` only to the exact number of proxies in front of Express. Do not expose port 3000 directly to an untrusted network.
5. Restrict the Pi firewall to the dashboard's intended management network, keep the OS and Node dependencies patched, back up `data` securely, and configure service-log retention/access controls. Protect administrator accounts with MFA before using the system for sensitive or internet-accessible operations.

The account file and SQLite session database are created in `data` (or `AUTH_DATA_DIR`). Create accounts with the CLI; authorized Pi operators can update or remove accounts in the account file, and changes take effect on the next request. On Linux, the account file is written with owner-only permissions. Windows ACLs must be restricted manually. Protect backups as credentials. Authentication logs include usernames and client IP addresses; handle them as operational personal data and apply an appropriate retention policy.

## ESP32 / hardware boundary

This dashboard is a local simulation and currently has no hardware-control API. Login does not by itself secure ESP32 firmware, UART, Wi-Fi, MQTT, sensor buses, or physical access. Before connecting real devices:

- Keep ESP32 devices on a dedicated, firewalled device network; do not expose their management interfaces to the public internet.
- Authenticate and authorize every device command at the Pi/backend. Never trust a role, device ID, or command supplied only by browser code. Give each device a unique credential with least privilege; rotate/revoke credentials and avoid shared/default secrets.
- Use authenticated encrypted transport between device and Pi where supported. Protect provisioning and OTA updates with signed firmware and a controlled update process; do not put reusable secrets in source control or public firmware images.
- Validate, bound, and audit device messages at the Pi; treat disconnects, malformed readings, replays, and stale sensor data as explicit faults. Define safe operational behavior for network or controller failure independently of the dashboard.
- Keep security controls separate from safety-critical detection/alarm logic. A dashboard login outage must not silently disable local alarms or make the gate report an unverified safe state.
- Minimize retention of identifying screening records, restrict report exports, and define an access, backup, incident-response, and credential-revocation process with the system owner.

The current prototype contains client-side simulated data and controls. Any future live telemetry, report export, threshold change, or hardware command must be moved behind authenticated, role-authorized server endpoints; serving a protected page alone is not sufficient to protect data or commands.
