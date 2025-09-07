import { db } from "./firebaseConfig.js";

import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc
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

// Add a new supplement (make sure supplement includes colorClass and date)
export async function addSupplement(userId, supplement) {
  if (!userId || !supplement) {
    throw new Error("Missing userId or supplement data");
  }

  return await addDoc(collection(db, "users", userId, "supplements"), {
    name: supplement.name,
    dosage: supplement.dosage,
    time: supplement.time,
    startDate: supplement.startDate || "",         // ✅ NEW
    cycle: supplement.cycle || { on: 0, off: 0 },  // ✅ NEW
    color: supplement.color || "#cccccc"           // ✅ NEW
  });
}

// Delete a supplement by ID
export async function deleteSupplement(userId, supplementId) {
  if (!userId || !supplementId) {
    throw new Error("Missing userId or supplementId");
  }

  return await deleteDoc(doc(db, "users", userId, "supplements", supplementId));
}

// Add New Supplement MODAL //
export async function addSupplement(uid, data) {
  if (!uid) throw new Error("No user id");

  // Normalize
  const name = (data.name || "").trim();
  const dosage = (data.dosage || "").trim();
  const times = Array.isArray(data.times) ? data.times : [];

  const cycleEnabled = !!(data.cycle && (data.cycle.on || data.cycle.off));
  const cycle = cycleEnabled
    ? {
        on: Number(data.cycle.on) || 0,
        off: Number(data.cycle.off) || 0,
      }
    : null;

  const startDate = cycleEnabled && data.startDate ? String(data.startDate) : null;

  const docData = {
    name,
    dosage,
    times,                 // ["Morning","Afternoon","Evening"]
    cycle,                 // null OR { on, off }
    startDate,             // "YYYY-MM-DD" if cycle is enabled
    color: data.color || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const coll = collection(db, "users", uid, "supplements");
  await addDoc(coll, docData);
  return docData;
}