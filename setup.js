"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.AUTH_DATA_DIR || path.join(ROOT, "data"));
const USERS_FILE = path.join(DATA_DIR, "auth-users.json");
const SECRET_FILE = path.join(DATA_DIR, "session-secret");
const USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,64}$/;

function secureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(DATA_DIR, 0o700);
}

function createSessionSecret() {
  try {
    const secret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(SECRET_FILE, secret, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(SECRET_FILE, 0o600);
    console.log("Created a private session-signing secret in the data directory.");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (process.platform !== "win32") {
      const permissions = fs.statSync(SECRET_FILE).mode & 0o777;
      if ((permissions & 0o077) !== 0) {
        throw new Error("data/session-secret has overly broad permissions. Restrict it to mode 600.");
      }
    }
    const existingSecret = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (Buffer.byteLength(existingSecret, "utf8") < 32) {
      throw new Error("data/session-secret is invalid. Replace it with a new private secret or restore a valid backup.");
    }
    console.log("Keeping the existing private session-signing secret.");
  }
}

function readExistingUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.users)) {
      throw new Error("The existing account store is invalid; setup will not overwrite it.");
    }
    return parsed.users;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function promptForAdminUsername() {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const username = (await terminal.question("Choose an administrator username (3–64 letters, digits, . _ @ -): ")).trim();
      if (!USERNAME_PATTERN.test(username)) {
        console.log("That username is invalid; please try again.");
        continue;
      }
      return username;
    }
  } finally {
    terminal.close();
  }
}

function installDependencies() {
  console.log("Installing project dependencies…");
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["install", "--registry=https://registry.npmjs.com"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw new Error(`Could not run npm install: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status ?? "unknown"}.`);
}

function createAdmin(username) {
  console.log("\nCreate your administrator password. It must be at least 14 characters.");
  console.log("The password is prompted without being saved in shell history.");
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "server.js"),
    "create-user",
    "--username",
    username,
    "--role",
    "admin",
  ], { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw new Error(`Could not start account creation: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Administrator account creation failed with exit code ${result.status ?? "unknown"}.`);
}

async function setup() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("First-run setup requires an interactive terminal for safe password entry.");
  }
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) {
    throw new Error(`Node.js 22 or later is required; found ${process.versions.node}.`);
  }
  installDependencies();
  secureDataDirectory();
  createSessionSecret();

  const users = readExistingUsers();
  if (users.some((user) => user && user.role === "admin")) {
    console.log("An administrator account already exists; setup left account data unchanged.");
  } else {
    const username = await promptForAdminUsername();
    createAdmin(username);
  }

  console.log("\nSetup complete. Start the application with `npm start`.");
  console.log("Open http://127.0.0.1:3000/ to sign in.");
  console.log("For network access, follow the TLS reverse-proxy and firewall guidance in SECURITY.md.");
}

setup().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
