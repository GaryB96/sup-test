import { db } from "./firebaseConfig.js";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

// Fetch all supplements for a user
export async function fetchSupplements(userId) {
  const supplementsRef = collection(db, "users", userId, "supplements");
  const snapshot = await getDocs(supplementsRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

// Delete a supplement by ID
export async function deleteSupplement(userId, supplementId) {
  if (!userId || !supplementId) {
    throw new Error("Missing userId or supplementId");
  }
  return await deleteDoc(doc(db, "users", userId, "supplements", supplementId));
}

// Add New Supplement (used by modal)
export async function addSupplement(uid, data) {
  if (!uid) throw new Error("No user id");

  const name   = (data.name || "").trim();
  const dosage = (data.dosage || "").trim();

  // Accept either `times` (modal) or `time` (legacy main form)
  const times = Array.isArray(data.times)
    ? data.times
    : Array.isArray(data.time)
    ? data.time
    : [];

  const cycleEnabled = !!(data.cycle && (data.cycle.on || data.cycle.off));
  const cycle = cycleEnabled
    ? {
        on:  Number(data.cycle.on)  || 0,
        off: Number(data.cycle.off) || 0,
      }
    : null;

  const startDate = cycleEnabled && data.startDate ? String(data.startDate) : null;

  const docData = {
    name,
    dosage,
    // Write both for backward/forward compatibility with the UI
    time: times,                      // ✅ singular (used by summary UI)
    times,                            // ✅ plural (what the modal collected)
    cycle,
    startDate,
    color: data.color || null,
    createdAt: serverTimestamp(),     // ✅ now defined
    updatedAt: serverTimestamp(),     // ✅ now defined
  };

  await addDoc(collection(db, "users", uid, "supplements"), docData);
  return docData;
}
