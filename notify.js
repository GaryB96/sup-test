// notify.js - GitHub Actions daily notifier (Option 1)
import admin from "firebase-admin";
import { DateTime } from "luxon";
import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";
const TEST_UID = process.env.TEST_UID || null;
const TEST_EMAIL = process.env.TEST_EMAIL || null;
const FORCE_SEND = (process.env.FORCE_SEND || "").toLowerCase() === "1" || (process.env.FORCE_SEND || "").toLowerCase() === "true";
const PRETEND_TODAY = process.env.PRETEND_TODAY || null;


const sa = JSON.parse(process.env.FIREBASE_SA);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

let gmailTransport = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  gmailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}
async function sendEmail(to, subject, text) {
  if (gmailTransport) {
    await gmailTransport.sendMail({ from: `"Supplement Tracker" <${process.env.GMAIL_USER}>`, to, subject, text });
    return;
  }
  if (process.env.SENDGRID_API_KEY) {
    await sgMail.send({ to, from: "no-reply@supplement-tracker.app", subject, text });
    return;
  }
  throw new Error("No email provider configured");
}

function boundaryForTomorrow(startISO, onDays, offDays, tz, pretendToday) {
  if (!startISO || !onDays || onDays < 0 || offDays < 0) return null;
  const period = onDays + offDays; if (period <= 0) return null;
  const zone = tz || "America/Halifax";
  const today = (pretendToday ? DateTime.fromISO(pretendToday, { zone: zone }) : DateTime.now().setZone(zone)).startOf("day");
  const tomorrow = today.plus({ days: 1 });
  const start = DateTime.fromISO(startISO, { zone }).startOf("day");
  const d = Math.floor(tomorrow.diff(start, "days").days);
  if (d < 0) return null;
  const phaseYesterday = (d - 1) % period;
  const phaseTomorrow = d % period;
  const wasOn = phaseYesterday >= 0 && phaseYesterday < onDays;
  const willBeOn = phaseTomorrow < onDays;
  if (wasOn && !willBeOn) return { type: "ON_ENDS_TOMORROW" };
  if (!wasOn && willBeOn) return { type: "ON_BEGINS_TOMORROW" };
  return null;
}

async function run() {
  // Load users (optionally filter by TEST_UID)
  const users = await db.collection("users").get(); // filter by TEST_UID in loop
  for (const userDoc of users.docs) {
    // test controls injected
    if (TEST_UID && userDoc.id !== TEST_UID) continue;
    const uid = userDoc.id;
    try {
      let tz = "America/Halifax", emailOn = false, emailAddr = null;
      try {
        const sDoc = await db.doc(`users/${uid}/settings/notifications`).get();
        if (sDoc.exists) {
          const s = sDoc.data();
          tz = s.timezone || tz;
          emailOn = !!s.notifyEmail;
          emailAddr = s.email || null;
        }
      } catch {}
      if (!emailOn || !emailAddr) continue;

      const suppSnap = await db.collection(`users/${uid}/supplements`).get();
      const lines = [];
      for (const d of suppSnap.docs) {
        const rec = d.data();
        const name = rec?.name || "Supplement";
        const on = rec?.cycle?.on ?? 0;
        const off = rec?.cycle?.off ?? 0;
        let startISO = null;
        if (rec?.startDate?._seconds) startISO = new Date(rec.startDate._seconds * 1000).toISOString();
        else if (rec?.startDate?.toDate) startISO = rec.startDate.toDate().toISOString();
        else if (typeof rec?.startDate === "string") startISO = rec.startDate;
        const b = boundaryForTomorrow(startISO, on, off, tz);
        if (b?.type === "ON_BEGINS_TOMORROW") lines.push(`• ${name}: ON cycle begins tomorrow.`);
        if (b?.type === "ON_ENDS_TOMORROW")   lines.push(`• ${name}: ON cycle ends tomorrow (OFF starts).`);
      }
      if (lines.length || FORCE_SEND) {
        const when = DateTime.now().setZone(tz).plus({days:1}).toFormat("cccc, LLL d");
        const subject = "Heads up: cycle changes tomorrow";
        const body = `Hi!

The following cycle changes happen tomorrow (${when}):
${lines.join("\n")}

You can change notification preferences in Settings.` + (lines.length ? '' : '\n\n(This is a test email triggered manually.)');
        await sendEmail(emailAddr, subject, body);
        console.log(`Notified ${uid} (${emailAddr})`);
      }
    } catch (e) {
      console.error(`Notify failed for user ${uid}`, e);
    }
  }
}
run().catch(e => { console.error(e); process.exit(1); });
