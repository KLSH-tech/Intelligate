"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");

const scrypt = promisify(crypto.scrypt);
const projectRoot = path.resolve(__dirname, "..");

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function waitForServer(child, expectedText) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes(expectedText)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before readiness (code ${code}): ${output}`));
    });
  });
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "expected a session cookie");
  return value.split(";")[0];
}

test("dashboard requires authentication and admin routes enforce current roles", async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "intelligate-auth-"));
  const dataDirectory = path.join(temporaryDirectory, "data");
  fs.mkdirSync(dataDirectory, { mode: 0o700 });
  const port = await reservePort();
  const username = "security-admin";
  const password = "correct-horse-battery-staple";
  const passwordHash = await hashPassword(password);
  const usersFile = path.join(dataDirectory, "auth-users.json");
  fs.writeFileSync(usersFile, `${JSON.stringify({ users: [{ username, role: "admin", passwordHash }] })}\n`, { mode: 0o600 });

  const child = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SESSION_SECRET: crypto.randomBytes(48).toString("base64url"),
      AUTH_DATA_DIR: dataDirectory,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForServer(child, `listening on 127.0.0.1:${port}`);

  const dashboard = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });
  assert.equal(dashboard.status, 303);
  assert.equal(dashboard.headers.get("location"), "/login");
  const privateApi = await fetch(`${baseUrl}/api/admin/users`);
  assert.equal(privateApi.status, 401);
  const privateReadiness = await fetch(`${baseUrl}/api/system/readiness`);
  assert.equal(privateReadiness.status, 401);

  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const initialCookie = cookieFrom(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const wrongPassword = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { Cookie: initialCookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ username, password: "wrong-password" }),
  });
  const unknownUser = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { Cookie: initialCookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ username: "missing-account", password }),
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.equal(await wrongPassword.text(), await unknownUser.text());

  const invalidCsrf = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { Cookie: initialCookie, "Content-Type": "application/json", "X-CSRF-Token": "0".repeat(64) },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(invalidCsrf.status, 403);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { Cookie: initialCookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const authenticatedCookie = cookieFrom(login);
  assert.notEqual(authenticatedCookie, initialCookie, "sign-in must rotate the session identifier");
  assert.match(login.headers.get("set-cookie"), /HttpOnly/i);

  const authenticatedDashboard = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: authenticatedCookie },
  });
  assert.equal(authenticatedDashboard.status, 200);
  const dashboardHtml = await authenticatedDashboard.text();
  assert.match(dashboardHtml, /class="auth-pending system-initializing"/);
  assert.match(dashboardHtml, /id="system-initialization"/);
  assert.match(dashboardHtml, /src="system-initialization\.js"/);
  assert.match(dashboardHtml, /src="screening-model\.js"/);

  const screeningModelResponse = await fetch(`${baseUrl}/screening-model.js`);
  assert.equal(screeningModelResponse.status, 200);
  assert.match(await screeningModelResponse.text(), /IntelliGateScreeningModel/);
  assert.match(dashboardHtml, /src="screening-model\.js"/);

  const readinessResponse = await fetch(`${baseUrl}/api/system/readiness`, {
    headers: { Cookie: authenticatedCookie },
  });
  assert.equal(readinessResponse.status, 200);
  const readiness = await readinessResponse.json();
  assert.deepEqual(readiness, {
    status: "ready",
    mode: "simulation",
    services: {
      applicationApi: "ready",
      authenticatedSession: "verified",
    },
    hardware: {
      integration: "not-implemented",
      connected: false,
      status: "not-connected",
      devices: [
        { id: "raspberry-pi", status: "not-connected" },
        { id: "esp32", status: "not-connected" },
        { id: "mlx90614", status: "not-connected" },
        { id: "break-beam-entry", status: "not-connected" },
        { id: "break-beam-exit", status: "not-connected" },
        { id: "lcd", status: "not-connected" },
      ],
    },
  });

  const adminUsers = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: authenticatedCookie },
  });
  assert.equal(adminUsers.status, 200);
  assert.deepEqual(await adminUsers.json(), { users: [{ username, role: "admin" }] });

  fs.writeFileSync(usersFile, `${JSON.stringify({ users: [{ username, role: "user", passwordHash }] })}\n`, { mode: 0o600 });
  const demotedAdmin = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: authenticatedCookie },
  });
  assert.equal(demotedAdmin.status, 403, "role changes must apply to an existing session");

  const logoutCsrf = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Cookie: authenticatedCookie },
  });
  const { csrfToken: logoutToken } = await logoutCsrf.json();
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: authenticatedCookie, "X-CSRF-Token": logoutToken },
  });
  assert.equal(logout.status, 204);
  const loggedOut = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: authenticatedCookie },
  });
  assert.equal(loggedOut.status, 401);
});
