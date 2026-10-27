"use strict";

const overlay = document.querySelector("#system-initialization");
const fullscreenPrompt = document.querySelector("#fullscreen-prompt");
const enterFullscreenButton = document.querySelector("#enter-fullscreen");
const continueWindowedButton = document.querySelector("#continue-windowed");
const fullscreenPromptError = document.querySelector("#fullscreen-prompt-error");
const phaseLabel = document.querySelector("#initialization-phase");
const title = document.querySelector("#initialization-title");
const description = document.querySelector("#initialization-description");
const result = document.querySelector("#initialization-result");
const retryButton = document.querySelector("#initialization-retry");
const progressBar = document.querySelector(".initialization-progress-track");
const progressFill = document.querySelector("#initialization-progress");
const header = document.querySelector(".topbar");
const dashboard = document.querySelector(".dashboard");
let initializing = false;
let dashboardUnlocked = false;
const stepDisplayDuration = 3500;

function pause(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setProgress(value) {
  progressFill.style.width = `${value}%`;
  progressBar.setAttribute("aria-valuenow", String(value));
}

function updateStep(name, state, label) {
  const step = document.querySelector(`[data-init-step="${name}"]`);
  step.classList.remove("is-running", "is-complete", "is-offline", "is-error");
  step.classList.add(`is-${state}`);
  step.querySelector(".init-check-state").textContent = label;
  const icon = step.querySelector(".init-check-icon");
  icon.textContent = state === "complete" ? "✓" : state === "error" ? "!" : "";
}

function resetSteps() {
  document.querySelectorAll('[data-init-step]:not([data-init-step="hardware"])').forEach((step) => {
    step.classList.remove("is-running", "is-complete", "is-offline", "is-error");
    step.querySelector(".init-check-state").textContent = "WAITING";
    step.querySelector(".init-check-icon").textContent = "";
  });
  updateStep("hardware", "offline", "NOT CONNECTED");
  setProgress(0);
  result.classList.remove("is-error");
  result.textContent = "System controls are locked during startup.";
}

function updateDeviceStatuses(readiness) {
  const hardwareStatuses = new Map(readiness.hardware.devices.map((device) => [device.id, device.status]));
  document.querySelectorAll(".device-row").forEach((row) => {
    const apiLink = row.dataset.deviceId === "application-api";
    const connected = apiLink
      ? readiness.services.applicationApi === "ready"
      : hardwareStatuses.get(row.dataset.deviceId) === "connected";
    const state = row.querySelector(".device-state");
    const detail = row.querySelector("code");
    row.classList.toggle("device-online", connected);
    row.classList.toggle("device-offline", !connected);
    row.setAttribute("aria-label", `${row.querySelector("span").textContent.trim()}: ${connected ? "online" : "offline"}`);
    state.textContent = connected ? "ONLINE" : "OFFLINE";
    detail.textContent = connected
      ? "Authenticated API check passed"
      : row.dataset.deviceReady || "Not connected";
  });
}

async function getReadiness() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/system/readiness", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) {
      window.location.replace("/login");
      throw new Error("Your authenticated session has expired. Sign in again.");
    }
    if (!response.ok) throw new Error(`Application services check failed (HTTP ${response.status}).`);

    const readiness = await response.json();
    if (
      readiness.status !== "ready" ||
      readiness.mode !== "simulation" ||
      readiness.services?.applicationApi !== "ready" ||
      readiness.services?.authenticatedSession !== "verified" ||
      readiness.hardware?.integration !== "not-implemented" ||
      readiness.hardware?.connected !== false ||
      !Array.isArray(readiness.hardware?.devices) ||
      readiness.hardware.devices.some((device) => device.status !== "not-connected")
    ) {
      throw new Error("The readiness response did not confirm a simulation-only system with hardware offline.");
    }
    return readiness;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Application services check timed out after 8 seconds.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function waitForSimulationReady() {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("system:simulation-ready", onReady);
      reject(new Error("The dashboard simulation controls did not finish initializing."));
    }, 3000);
    function onReady() {
      window.clearTimeout(timeout);
      window.removeEventListener("system:simulation-ready", onReady);
      resolve();
    }
    window.addEventListener("system:simulation-ready", onReady, { once: true });
    window.dispatchEvent(new Event("system:initialize-simulation"));
  });
}

async function runInitialization() {
  if (initializing || overlay.hidden) return;
  initializing = true;
  retryButton.hidden = true;
  title.textContent = "Initializing system";
  description.textContent = "Verifying the authenticated dashboard and preparing its simulation controls.";
  phaseLabel.textContent = "SECURE STARTUP SEQUENCE";
  resetSteps();

  try {
    phaseLabel.textContent = "VERIFYING OPERATOR SESSION";
    updateStep("session", "running", "CHECKING");
    await window.dashboardSessionReady;
    if (document.documentElement.classList.contains("auth-pending")) {
      throw new Error("The authenticated operator session could not be verified.");
    }
    updateStep("session", "complete", "VERIFIED");
    setProgress(22);
    await pause(stepDisplayDuration);

    phaseLabel.textContent = "CHECKING APPLICATION SERVICES";
    updateStep("server", "running", "CHECKING");
    const readiness = await getReadiness();
    updateStep("server", "complete", "AVAILABLE");
    setProgress(55);
    await pause(stepDisplayDuration);

    phaseLabel.textContent = "PREPARING DEMONSTRATION CONTROLS";
    updateStep("simulation", "running", "PREPARING");
    await waitForSimulationReady();
    updateStep("simulation", "complete", "READY");
    setProgress(82);
    await pause(stepDisplayDuration);

    phaseLabel.textContent = "HARDWARE STATUS";
    updateDeviceStatuses(readiness);
    updateStep("hardware", "offline", "NOT CONNECTED");
    setProgress(100);
    result.classList.remove("is-error");
    result.textContent = "Software checks passed. Dashboard is ready in simulation mode; all physical devices remain offline.";
    await pause(stepDisplayDuration);

    document.documentElement.classList.remove("system-initializing");
    overlay.classList.add("is-exiting");
    await pause(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200);
    overlay.hidden = true;
    fullscreenPrompt.hidden = false;
    fullscreenPrompt.focus();
    enterFullscreenButton.focus();
  } catch (error) {
    title.textContent = "Initialization could not complete";
    description.textContent = "Dashboard controls remain locked until session and application checks pass.";
    phaseLabel.textContent = "CHECK FAILED";
    result.classList.add("is-error");
    result.textContent = error instanceof Error ? error.message : "An unexpected startup error occurred.";
    retryButton.hidden = false;
    retryButton.focus();
  } finally {
    initializing = false;
  }
}

function unlockDashboard() {
  if (dashboardUnlocked) return;
  dashboardUnlocked = true;
  fullscreenPrompt.hidden = true;
  header.inert = false;
  dashboard.inert = false;
  document.querySelector("#simulate-entry").focus();
}

enterFullscreenButton.addEventListener("click", async () => {
  enterFullscreenButton.disabled = true;
  fullscreenPromptError.textContent = "";
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    unlockDashboard();
  } catch (error) {
    fullscreenPromptError.textContent = `Could not enter fullscreen: ${error.message} You can continue in a window instead.`;
    enterFullscreenButton.disabled = false;
    enterFullscreenButton.focus();
  }
});

continueWindowedButton.addEventListener("click", unlockDashboard);

fullscreenPrompt.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...fullscreenPrompt.querySelectorAll("button:not(:disabled)")];
  if (event.shiftKey && document.activeElement === focusable[0]) {
    event.preventDefault();
    focusable.at(-1).focus();
  } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
    event.preventDefault();
    focusable[0].focus();
  }
});

retryButton.addEventListener("click", () => {
  void runInitialization();
});

overlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...overlay.querySelectorAll("button:not([hidden]):not(:disabled)")];
  if (focusable.length === 0) {
    event.preventDefault();
    overlay.focus();
  } else if (event.shiftKey && document.activeElement === focusable[0]) {
    event.preventDefault();
    focusable.at(-1).focus();
  } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
    event.preventDefault();
    focusable[0].focus();
  }
});

overlay.focus();
void runInitialization();
