const form = document.querySelector("#login-form");
const submitButton = document.querySelector("#login-submit");
const message = document.querySelector("#login-message");

async function requestCsrfToken() {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Authentication service is unavailable. Access is denied.");
  }
  return response.json();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Verifying…";

  try {
    const { csrfToken } = await requestCsrfToken();
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
      }),
    });

    if (!response.ok) {
      message.textContent = response.status === 429
        ? "Too many attempts. Wait before trying again."
        : "Sign-in failed. Check your account details or contact an administrator.";
      return;
    }

    window.location.replace("/dashboard");
  } catch {
    message.textContent = "Authentication service is unavailable. Access is denied.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Sign in securely";
  }
});
