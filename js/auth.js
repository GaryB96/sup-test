// auth.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
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
  return await signInWithEmailAndPassword(auth, email, password);
}

// 🆕 Signup function
export async function signup(email, password) {
  return await createUserWithEmailAndPassword(auth, email, password);
}

// 👀 Monitor auth state
export function monitorAuthState(callback) {
  onAuthStateChanged(auth, user => {
    callback(user);
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

// Make sure this is imported at the top:
// import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";

export async function resetPassword() {
  // Prefer the signed-in user's email; fall back to the login form field if visible
  const user = auth.currentUser;
  let email = user?.email;

  if (!email) {
    const input = document.getElementById("emailInput");
    if (input && input.value) email = input.value.trim();
  }

  if (!email) {
    throw new Error("No email available. Please enter your email in the login form or sign in first.");
  }

  await sendPasswordResetEmail(auth, email);
  // If we get here, Firebase accepted the request.
  // (If the email isn't registered, Firebase intentionally does not reveal that.)
}


export { auth, db };
