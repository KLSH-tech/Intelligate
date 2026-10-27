const identity = document.querySelector("#session-identity");
const logoutButton = document.querySelector("#logout-button");

async function loadSession() {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      window.location.replace("/login");
      return false;
    }
    const session = await response.json();
    identity.textContent = `${session.username} · ${session.role.toUpperCase()}`;
    document.documentElement.classList.remove("auth-pending");
    return true;
  } catch {
    window.location.replace("/login");
    return false;
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const csrfResponse = await fetch("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!csrfResponse.ok) throw new Error("Unable to verify sign-out request.");
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (!response.ok) throw new Error("Sign-out failed. Retry or close this browser.");
    window.location.replace("/login");
  } catch (error) {
    identity.textContent = error.message;
    logoutButton.disabled = false;
  }
});

window.dashboardSessionReady = loadSession();
window.setInterval(() => {
  void loadSession();
}, 60_000);
