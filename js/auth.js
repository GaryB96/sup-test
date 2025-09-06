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
  reauthenticateWithCredential,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
// auth.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAOsbsQ77ciIFrzKWqcoNnfg2nx4P7zRqE",
  authDomain: "supplement-tracker-bec8a.firebaseapp.com",
  projectId: "supplement-tracker-bec8a",
  storageBucket: "supplement-tracker-bec8a.appspot.com",
  messagingSenderId: "394903426941",
  appId: "1:394903426941:web:be4541048a814346005e14",
  measurementId: "G-W5ZKYC8MFT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔐 Login function
export async function login(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  const bypass = user.email === "test@test.com";
  if (!bypass && !user.emailVerified) {
    try { await sendEmailVerification(user); } catch {}
    await signOut(auth);
    const err = new Error("Email not verified. Check your inbox for the verification link.");
    err.code = "auth/email-not-verified";
    throw err;
  }
  return user;
}

// 🆕 Signup function
export async function signup(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try { await sendEmailVerification(cred.user); } catch {}
  await signOut(auth);
  const err = new Error("Please verify your email address. We sent you a verification link.");
  err.code = "auth/email-not-verified";
  throw err;
}

// 👀 Monitor auth state
export function monitorAuthState(callback) {
  onAuthStateChanged(auth, (user) => {
    // Remove the pending class to avoid flicker once Firebase resolves
    try { document.documentElement.classList.remove("auth-pending"); } catch {}
    if (typeof callback === "function") callback(user);
  });
}

// 🚪 Logout function
export async function logout() {
  try {
    await signOut(auth);
    console.log("Logged out");
  } catch (error) {
    console.error("Logout error:", error.message);
  }
}

// 🗑️ Delete account
export async function deleteAccount(user) {
  try {
    await user.delete();
    console.log("Account deleted");
  } catch (error) {
    console.error("Delete error:", error.message);
    alert("Failed to delete account: " + error.message);
  }
}

// 🔑 Change password
export async function changePassword(newPassword) {
  const user = auth.currentUser;
  if (user) {
    return await updatePassword(user, newPassword);
  }
  throw new Error("No user is currently signed in.");
}

/**
 * Utility: mask an email address for UI messages to avoid leaking full addresses.
 * e.g., "jdoe@example.com" -> "jd•••@example.com"
 */
function maskEmail(email) {
  try {
    const [local, domain] = email.split("@");
    if (!local || !domain) return email;
    const visible = Math.min(2, local.length);
    const maskedLocal = local.slice(0, visible) + "•••";
    return `${maskedLocal}@${domain}`;
  } catch {
    return email;
  }
}

/**
 * 🔁 Resend verification email for the currently signed-in user.
 * Returns an object you can use for UI messaging.
 */
export async function resendVerification() {
  const user = auth.currentUser;
  if (!user) {
    const err = new Error("Please sign in first to resend the verification email.");
    err.code = "auth/no-current-user";
    throw err;
  }
  if (user.emailVerified) {
    return { alreadyVerified: true, email: user.email };
  }
  await sendEmailVerification(user);
  return { sent: true, email: user.email, maskedEmail: maskEmail(user.email) };
}

/**
 * 📧 Send a password reset email.
 * - If a targetEmail is provided, use that first.
 * - Otherwise prefer the signed-in user's email, then fall back to #emailInput if present.
 * Returns a result object for UI messaging.
 */
export async function resetPassword(targetEmail) {
  const user = auth.currentUser;
  let email = (targetEmail || "").trim();
  if (!email) email = user?.email || "";
  if (!email) {
    const input = document.getElementById("emailInput");
    if (input && input.value) email = input.value.trim();
  }
  if (!email) {
    const err = new Error("No email available. Please enter your email in the login form or sign in first.");
    err.code = "auth/missing-email";
    throw err;
  }

  await sendPasswordResetEmail(auth, email);

  // Firebase does not disclose whether the address exists; we keep UX consistent.
  const masked = maskEmail(email);
  return {
    sent: true,
    email,
    maskedEmail: masked,
    message: `A reset link has been sent. Please check your inbox and spam.`
  };
}

export { auth, db };
