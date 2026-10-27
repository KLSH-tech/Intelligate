"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.AUTH_DATA_DIR || path.join(ROOT, "data"));
const USERS_FILE = path.join(DATA_DIR, "auth-users.json");
const SESSION_DURATION_MS = 30 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_BYTES = 64;
const PASSWORD_MIN_LENGTH = 14;
const USERNAME_PATTERN = /^[a-zA-Z0-9._@-]{3,64}$/;
const COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-intelligate.sid"
  : "intelligate.sid";

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(DATA_DIR, 0o700);
}

function readUsers() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No accounts configured. Create one with: npm run create-user -- --username admin --role admin`);
    }
    throw new Error(`Could not read account store: ${error.message}`);
  }

  if (process.platform !== "win32") {
    const permissions = fs.statSync(USERS_FILE).mode & 0o777;
    if ((permissions & 0o077) !== 0) {
      throw new Error("Account-store permissions are too broad. Restrict data/auth-users.json to mode 600.");
    }
  }
  if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
    throw new Error("The account store is invalid or empty. Add at least one account.");
  }
  for (const user of parsed.users) {
    if (
      !user ||
      typeof user.username !== "string" ||
      !USERNAME_PATTERN.test(user.username) ||
      !["user", "admin"].includes(user.role) ||
      typeof user.passwordHash !== "string"
    ) {
      throw new Error("The account store contains an invalid user record.");
    }
  }
  return parsed.users;
}

function parsePasswordHash(encoded) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, N, r, p, salt, hash] = parts;
  if (N !== "32768" || r !== "8" || p !== "1") return null;
  const saltBuffer = Buffer.from(salt, "base64");
  const hashBuffer = Buffer.from(hash, "base64");
  if (saltBuffer.length !== 16 || hashBuffer.length !== HASH_BYTES) return null;
  return { salt: saltBuffer, hash: hashBuffer };
}

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, HASH_BYTES, SCRYPT_OPTIONS);
  return `scrypt$32768$8$1$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

async function verifyPassword(password, encodedHash, dummyHash) {
  const record = parsePasswordHash(encodedHash) || parsePasswordHash(dummyHash);
  const candidate = await scrypt(password, record.salt, HASH_BYTES, SCRYPT_OPTIONS);
  const validHash = parsePasswordHash(encodedHash);
  return Boolean(validHash) && crypto.timingSafeEqual(candidate, validHash.hash);
}

function sessionSecret() {
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    try {
      if (process.platform !== "win32") {
        const permissions = fs.statSync(path.join(DATA_DIR, "session-secret")).mode & 0o777;
        if ((permissions & 0o077) !== 0) {
          throw new Error("Session secret permissions are too broad. Restrict data/session-secret to mode 600.");
        }
      }
      secret = fs.readFileSync(path.join(DATA_DIR, "session-secret"), "utf8").trim();
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("No session secret configured. Run `npm run setup` or set SESSION_SECRET in the service environment.");
      }
      throw error;
    }
  }
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes. Run `npm run setup` or provide a secure service environment value.");
  }
  return secret;
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!["--username", "--role"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("Usage: npm run create-user -- --username <name> --role <user|admin>");
    }
    values[key.slice(2)] = args[index + 1];
    index += 1;
  }
  if (!USERNAME_PATTERN.test(values.username || "") || !["user", "admin"].includes(values.role)) {
    throw new Error("Provide a valid username (3–64 letters, digits, . _ @ -) and role (user or admin).");
  }
  return values;
}

function promptPassword() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run account creation in an interactive terminal so the password is not exposed in command history.");
  }
  return new Promise((resolve, reject) => {
    let password = "";
    const stdin = process.stdin;
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Account creation cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0008" || character === "\u007f") {
          if (password.length > 0) {
            password = Array.from(password).slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character !== "\u007f" && password.length < 256) {
          password += character;
          process.stdout.write("*");
        }
      }
    };
    process.stdout.write("Password (minimum 14 characters): ");
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function createUser(args) {
  ensureDataDirectory();
  const { username, role } = parseArguments(args);
  let users = [];
  if (fs.existsSync(USERS_FILE)) users = readUsers();
  if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("That username already exists.");
  }

  const password = await promptPassword();
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const confirmation = await promptPassword();
  if (password !== confirmation) throw new Error("Passwords did not match; no account was created.");
  const user = { username, role, passwordHash: await createPasswordHash(password) };
  const temporaryFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify({ users: [...users, user] }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryFile, USERS_FILE);
  if (process.platform !== "win32") fs.chmodSync(USERS_FILE, 0o600);
  console.log(`Created ${role} account "${username}". Store and back up the account file securely.`);
}

function csrfMatches(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return expectedBuffer.length === 32 &&
    suppliedBuffer.length === 32 &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function audit(event, req, details = {}) {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    username: typeof details.username === "string" ? details.username.slice(0, 64) : null,
    role: details.role || null,
    clientIp: req.ip,
  }));
}

function requireAuthenticatedPage(req, res, next) {
  if (!req.session.user) return res.redirect(303, "/login");
  next();
}

function requireAuthenticatedApi(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Authentication required." });
  next();
}

function refreshSessionUser({ cookieName, production }) {
  return (req, res, next) => {
    if (!req.session.user) return next();
    try {
      const account = readUsers().find(
        (user) => user.username.toLowerCase() === req.session.user.username.toLowerCase(),
      );
      if (!account) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          res.clearCookie(cookieName, {
            httpOnly: true,
            secure: production,
            sameSite: "strict",
            path: "/",
          });
          if (req.path.startsWith("/api/")) {
            return res.status(401).json({ error: "Authentication required." });
          }
          return res.redirect(303, "/login");
        });
      }
      req.session.user = { username: account.username, role: account.role };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.session.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}

async function startServer() {
  ensureDataDirectory();
  const secret = sessionSecret();
  readUsers();
  const dummyHash = await createPasswordHash(crypto.randomBytes(32).toString("hex"));
  const app = express();
  const production = process.env.NODE_ENV === "production";
  const refreshUser = refreshSessionUser({ cookieName: COOKIE_NAME, production });
  const proxyHops = process.env.TRUST_PROXY_HOPS;
  if (proxyHops !== undefined) {
    const parsedHops = Number(proxyHops);
    if (!Number.isInteger(parsedHops) || parsedHops < 1 || parsedHops > 5) {
      throw new Error("TRUST_PROXY_HOPS must be an integer from 1 to 5.");
    }
    app.set("trust proxy", parsedHops);
  }

  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }));
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  app.use(session({
    name: COOKIE_NAME,
    secret,
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: DATA_DIR,
      table: "sessions",
      ttl: Math.floor(SESSION_DURATION_MS / 1000),
      cleanupInterval: 5 * 60 * 1000,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_DURATION_MS,
    },
  }));
  app.use(express.json({ limit: "10kb", strict: true }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      audit("login_rate_limited", req);
      res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
    },
  });

  app.get("/", (req, res) => {
    res.redirect(303, req.session.user ? "/dashboard" : "/login");
  });
  app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect(303, "/dashboard");
    res.sendFile(path.join(ROOT, "login.html"));
  });
  app.get("/dashboard", requireAuthenticatedPage, refreshUser, (req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
  });
  app.get("/index.html", requireAuthenticatedPage, refreshUser, (req, res) => {
    res.redirect(303, "/dashboard");
  });

  app.get("/styles.css", (req, res) => res.sendFile(path.join(ROOT, "styles.css")));
  app.get("/login.css", (req, res) => res.sendFile(path.join(ROOT, "login.css")));
  app.get("/login.js", (req, res) => res.sendFile(path.join(ROOT, "login.js")));
  app.get("/dashboard-auth.js", (req, res) => res.sendFile(path.join(ROOT, "dashboard-auth.js")));
  app.get("/screening-model.js", (req, res) => res.sendFile(path.join(ROOT, "screening-model.js")));
  app.get("/system-initialization.js", (req, res) => res.sendFile(path.join(ROOT, "system-initialization.js")));
  app.get("/app.js", (req, res) => res.sendFile(path.join(ROOT, "app.js")));
  app.use("/assets", express.static(path.join(ROOT, "assets"), { index: false, maxAge: "1d" }));

  app.get("/api/auth/csrf", (req, res) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    res.json({ csrfToken: req.session.csrfToken });
  });
  app.get("/api/auth/session", requireAuthenticatedApi, refreshUser, (req, res) => {
    res.json({ username: req.session.user.username, role: req.session.user.role });
  });
  app.get("/api/system/readiness", requireAuthenticatedApi, refreshUser, (req, res) => {
    res.json({
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
  });

  app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
    try {
      if (!csrfMatches(req.session.csrfToken, req.get("X-CSRF-Token"))) {
        return res.status(403).json({ error: "Invalid sign-in request. Reload the page and try again." });
      }
      const { username, password } = req.body || {};
      if (
        typeof username !== "string" ||
        !USERNAME_PATTERN.test(username) ||
        typeof password !== "string" ||
        password.length === 0 ||
        Array.from(password).length > 128
      ) {
        await verifyPassword("invalid-request", "", dummyHash);
        audit("login_failed", req, { username });
        return res.status(401).json({ error: "Sign-in failed." });
      }

      const currentUsers = readUsers();
      const user = currentUsers.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
      const valid = await verifyPassword(password, user?.passwordHash || "", dummyHash);
      if (!user || !valid) {
        audit("login_failed", req, { username });
        return res.status(401).json({ error: "Sign-in failed." });
      }

      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.user = { username: user.username, role: user.role };
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      await new Promise((resolve, reject) => {
        req.session.save((error) => error ? reject(error) : resolve());
      });
      audit("login_succeeded", req, req.session.user);
      return res.json({ username: user.username, role: user.role });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/logout", requireAuthenticatedApi, refreshUser, (req, res, next) => {
    if (!csrfMatches(req.session.csrfToken, req.get("X-CSRF-Token"))) {
      return res.status(403).json({ error: "Invalid sign-out request." });
    }
    const signedOutUser = req.session.user;
    req.session.destroy((error) => {
      if (error) return next(error);
      audit("logout_succeeded", req, signedOutUser);
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: production,
        sameSite: "strict",
        path: "/",
      });
      return res.status(204).end();
    });
  });

  app.get("/api/admin/users", requireAuthenticatedApi, refreshUser, requireAdmin, (req, res) => {
    audit("admin_user_listed", req, req.session.user);
    res.json({ users: readUsers().map(({ username, role }) => ({ username, role })) });
  });

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
    return res.status(404).type("text").send("Not found.");
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("Request failed:", error.message);
    if (req.path.startsWith("/api/")) return res.status(500).json({ error: "The request could not be completed." });
    return res.status(500).type("text").send("The request could not be completed.");
  });

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`Intelli-Gate authentication server listening on ${host}:${port}.`);
    console.log("Bind this service behind a TLS reverse proxy before allowing network access.");
  });
}

if (process.argv[2] === "create-user") {
  createUser(process.argv.slice(3)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  startServer().catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
