// js/verification-ui.js
import { resendVerification } from "./auth.js";

const btn = document.getElementById("resendVerificationBtn");
const statusEl = document.getElementById("auth-status");

if (btn) {
  btn.addEventListener("click", async () => {
    try {
      await resendVerification();
      if (statusEl) statusEl.textContent = "Verification email sent. Please check your inbox.";
    } catch (e) {
      if (statusEl) statusEl.textContent = e?.message || "Could not send verification email.";
    }
  });
}

window.addEventListener("user-signed-out", (e) => {
  // If the user exists but isn't verified, main auth module will have shown a status.
  // Expose the resend button in that state by displaying it when an email is present in the login form.
  const emailInput = document.querySelector('input[type="email"]');
  if (emailInput && emailInput.value) {
    btn && (btn.style.display = "inline-block");
  } else {
    btn && (btn.style.display = "none");
  }
});

window.addEventListener("user-authenticated", () => {
  btn && (btn.style.display = "none");
  if (statusEl) statusEl.textContent = "";
});
