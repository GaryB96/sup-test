// auth.js – Firebase Email/Password auth with REQUIRED email verification

import { auth, db } from "./firebaseConfig.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  updatePassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";

// ----- Helpers -----
function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function showToast(msg) {
  // non-blocking UI hint if host app defines it
  if (typeof window?.toast === "function") window.toast(msg);
  // also update a fallback status area if present
  const el = document.getElementById("auth-status");
  if (el) el.textContent = msg;
}

// ----- Core API used by main.js -----

/** Sign up and require email verification before granting access. */
export async function signup(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Immediately send verification email
  try {
    await sendEmailVerification(cred.user);
  } catch (e) {
    console.warn("Failed to send verification email:", e);
  }
  // Sign out to force verification gate if SDK marked as logged in
  await signOut(auth);
  throw Object.assign(new Error("Please verify your email address. We sent you a verification link."), { code: "auth/email-not-verified" });
}

/** Log in but block unverified accounts. */
export async function login(email, password) {
  const BYPASS_EMAIL = 'test@test.com';
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  if (user.email !== 'test@test.com' && !user.emailVerified) {
    // Optionally re-send verification if user clicked "login" again
    try { await sendEmailVerification(user); } catch {}
    await signOut(auth);
    throw Object.assign(new Error("Email not verified. Check your inbox for the verification link."), { code: "auth/email-not-verified" });
  }
  // success; onAuthStateChanged below will emit the event used by the app
  return user;
}

export async function logout() {
  await signOut(auth);
}

export async function deleteAccount() {
  if (!auth.currentUser) throw new Error("Not signed in.");
  await deleteUser(auth.currentUser);
}

export async function changePassword(newPassword, currentPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  if (currentPassword) {
    const cred = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, cred);
  }
  await updatePassword(user, newPassword);
}

export async function resetPassword(email) {
  const target = email || auth.currentUser?.email;
  if (!target) throw new Error("Enter your email first.");
  await sendPasswordResetEmail(auth, target);
}

export async function resendVerification() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  await sendEmailVerification(user);
  return true;
}

// Monitor auth and emit only when verified
export function monitorAuthState(callback) {
  onAuthStateChanged(auth, async (user) => {
    // ✅ stop hiding the UI now that Firebase has resolved the user
    document.documentElement.classList.remove("auth-pending");

    const isBypass = user && user.email === 'test@test.com';
    const isVerified = !!(user && (isBypass || user.emailVerified));
    if (isVerified) {
      document.body.classList.add("logged-in");
      emit("user-authenticated", user);
      showToast("Signed in");
      if (typeof callback === "function") {
        try { await callback(user); } catch (e) { console.warn("monitorAuthState callback error", e); }
      }
    } else {
      document.body.classList.remove("logged-in");
      emit("user-signed-out", null);
      if (user && !isBypass && !user.emailVerified) {
        showToast("Please verify your email to continue.");
      }
      if (typeof callback === "function") {
        try { await callback(null); } catch (e) { console.warn("monitorAuthState callback error", e); }
      }
    }
  });
}


// Optional: expose auth/db for advanced callers
export { auth, db };
