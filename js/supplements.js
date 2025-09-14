import { db } from "./firebaseConfig.js";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

/**
 * Fetch all supplements for a user
 */
export async function fetchSupplements(userId) {
  const supplementsRef = collection(db, "users", userId, "supplements");
  const snapshot = await getDocs(supplementsRef);
  return snapshot.docs.map(d => ({
    id: d.id,
    ...d.data(),
  }));
}

/**
 * Delete a supplement by ID
 */
export async function deleteSupplement(userId, supplementId) {
  if (!userId || !supplementId) {
    throw new Error("Missing userId or supplementId");
  }
  return await deleteDoc(doc(db, "users", userId, "supplements", supplementId));
}

/**
 * Add New Supplement (used by modal)
 * Path: users/{uid}/supplements
 */
export async function addSupplement(uid, data) {
  if (!uid) throw new Error("No user id");

  const name   = (data?.name || "").trim();
  const brand  = (data?.brand || "").trim();
  const dosage = (data?.dosage || "").trim();
  const dailyDose = (data && data.dailyDose != null && !isNaN(Number(data.dailyDose))) ? Math.max(1, Number(data.dailyDose)) : null;
  const servings = Number.isFinite(Number(data?.servings)) ? Number(data.servings) : null;

  // Accept either `times` (modal) or `time` (legacy)
  const times = Array.isArray(data?.times)
    ? data.times
    : Array.isArray(data?.time)
    ? data.time
    : [];

  const cycleEnabled = !!(data?.cycle && (data.cycle.on || data.cycle.off));
  const cycle = cycleEnabled
    ? {
        on:  Number(data.cycle.on)  || 0,
        off: Number(data.cycle.off) || 0,
      }
    : null;

  // Always capture a start date for better summaries; default to today if not provided
  let startDate = null;
  if (data && data.startDate) {
    startDate = String(data.startDate);
  } else {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    startDate = `${y}-${m}-${d}`;
  }

  const docData = {
    name,
    brand: brand || null,
    dosage,
    dailyDose,
    servings,
    time: Array.isArray(times) ? (times[0] || null) : (data?.time ?? null),
    times,
    cycle,
    startDate,
    color: data?.color || null,
    showOnCalendar: !!(data && data.showOnCalendar),
    orderReminder: !!(data && data.orderReminder),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await addDoc(collection(db, "users", uid, "supplements"), docData);
  return docData;
}

/**
 * Update an existing supplement (Edit flow)
 * Path: users/{uid}/supplements/{supplementId}
 * Uses setDoc(..., { merge: true }) to avoid overwriting missing fields.
 */
export async function updateSupplement(uid, supplementId, data) {
  if (!uid || !supplementId) throw new Error("Missing uid or supplementId");

  const name   = (data?.name ?? undefined);
  const brand  = (data?.brand ?? undefined);
  const dosage = (data?.dosage ?? undefined);
  const dailyDose = (data && "dailyDose" in data)
    ? ((data.dailyDose != null && !isNaN(Number(data.dailyDose))) ? Math.max(1, Number(data.dailyDose)) : null)
    : undefined;
  const servings = (data && "servings" in data)
    ? (Number.isFinite(Number(data.servings)) ? Number(data.servings) : null)
    : undefined;

  const times = Array.isArray(data?.times)
    ? data.times
    : Array.isArray(data?.time)
    ? data.time
    : undefined;

  // Preserve shape: null disables cycle, object updates values, undefined leaves untouched
  let cycle;
  if (data?.cycle === null) {
    cycle = null;
  } else if (typeof data?.cycle === "object") {
    cycle = {
      on:  Number(data.cycle.on)  || 0,
      off: Number(data.cycle.off) || 0,
    };
  } // else leave undefined to avoid changing

  const startDate = (data && "startDate" in data)
    ? (data.startDate ? String(data.startDate) : null)
    : undefined;

  const color = (data && "color" in data) ? (data.color || null) : undefined;

  const payload = {
    ...(name   !== undefined ? { name: String(name).trim() } : {}),
    ...(brand  !== undefined ? { brand: String(brand).trim() || null } : {}),
    ...(dosage !== undefined ? { dosage: String(dosage).trim() } : {}),
    ...(dailyDose !== undefined ? { dailyDose } : {}),
    ...(servings !== undefined ? { servings } : {}),
    ...((data && "orderReminder" in data) ? { orderReminder: !!data.orderReminder } : {}),
    ...((data && "showOnCalendar" in data) ? { showOnCalendar: !!data.showOnCalendar } : {}),
    ...(times  !== undefined ? { times, time: (Array.isArray(times) ? (times[0] || null) : null) } : {}),
    ...(cycle  !== undefined ? { cycle } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(color !== undefined ? { color } : {}),
    updatedAt: serverTimestamp(),
  };

  const ref = doc(db, "users", uid, "supplements", supplementId);
  await setDoc(ref, payload, { merge: true });
  return payload;
}
