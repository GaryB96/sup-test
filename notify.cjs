// notify.cjs — CommonJS notifier for GitHub Actions (no ESM required)
const admin = require("firebase-admin");
const { DateTime } = require("luxon");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");

// --- Inputs via env (from workflow dispatch) ---
const TEST_UID = process.env.TEST_UID || null;
const TEST_EMAIL = process.env.TEST_EMAIL || null;
const FORCE_SEND = (process.env.FORCE_SEND || "").toLowerCase() === "1" || (process.env.FORCE_SEND || "").toLowerCase() === "true";
const PRETEND_TODAY = process.env.PRETEND_TODAY || null;

// --- Firebase Admin init ---
let sa;
try {
  sa = JSON.parse(process.env.FIREBASE_SA || "{}");
} catch (e) {
  console.error("FIREBASE_SA is not valid JSON:", e);
  process.exit(1);
}
if (!sa.client_email || !sa.private_key) {
  console.error("FIREBASE_SA is missing client_email or private_key. Paste the FULL service account JSON into the FIREBASE_SA secret.");
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// --- Mail providers ---
let gmailTransport = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  gmailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(to, subject, text) {
  if (gmailTransport) {
    await gmailTransport.sendMail({ from: `"Supplement Tracker" <${process.env.GMAIL_USER}>`, to, subject, text });
    return;
  }
  if (process.env.SENDGRID_API_KEY) {
    await sgMail.send({ to, from: "no-reply@supplement-tracker.app", subject, text });
    return;
  }
  throw new Error("No email provider configured (set SENDGRID_API_KEY or GMAIL_USER + GMAIL_APP_PASSWORD).");
}

// --- Boundary calc (notify the day BEFORE a change) ---
function boundaryForTomorrow(startISO, onDays, offDays, tz, pretendToday) {
  if (!startISO || !onDays || onDays < 0 || offDays < 0) return null;
  const period = onDays + offDays;
  if (period <= 0) return null;

  const zone = tz || "America/Halifax";
  const today = (pretendToday ? DateTime.fromISO(pretendToday, { zone }) : DateTime.now().setZone(zone)).startOf("day");
  const tomorrow = today.plus({ days: 1 });

  const start = DateTime.fromISO(startISO, { zone }).startOf("day");
  if (!start.isValid) return null;

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

function redactEmail(e) {
  if (!e) return e;
  const [u, d] = e.split("@");
  if (!d) return e;
  return `${u.slice(0,2)}***@${d}`;
}

async function getEmailForUid(uid, settingsEmail) {
  if (TEST_EMAIL) return TEST_EMAIL;
  if (settingsEmail) return settingsEmail;
  try {
    const user = await admin.auth().getUser(uid);
    if (user.email) return user.email;
  } catch (e) {
    console.warn(`Could not fetch auth email for ${uid}:`, e.message || e);
  }
  return null;
}

async function run() {
  const users = await db.collection("users").get();
  console.log(`Loaded ${users.size} user docs.`);

  let sent = 0;
  for (const userDoc of users.docs) {
    if (TEST_UID && userDoc.id !== TEST_UID) continue;

    const uid = userDoc.id;
    try {
      // settings
      let tz = "America/Halifax", emailOn = false, emailFromSettings = null;
      try {
        const sDoc = await db.doc(`users/${uid}/settings/notifications`).get();
        if (sDoc.exists) {
          const s = sDoc.data();
          tz = s.timezone || tz;
          emailOn = !!s.notifyEmail;
          emailFromSettings = s.email || null;
        }
      } catch {}

      const dest = await getEmailForUid(uid, emailFromSettings);
      console.log(`[${uid}] tz=${tz}, notifyEmail=${emailOn}, dest=${redactEmail(dest)}`);

      if (!dest && !FORCE_SEND) {
        console.log(`[${uid}] Skip: no destination email and FORCE_SEND not set.`);
        continue;
      }

      const suppSnap = await db.collection(`users/${uid}/supplements`).get();
      console.log(`[${uid}] supplements=${suppSnap.size}`);

      const lines = [];
      for (const d of suppSnap.docs) {
        const rec = d.data();
        const name = rec?.name || "Supplement";
        const on = rec?.cycle?.on ?? 0;
        const off = rec?.cycle?.off ?? 0;
        let startISO = null;
        if (rec?.startDate && typeof rec.startDate.toDate === "function") startISO = rec.startDate.toDate().toISOString();
        else if (typeof rec?.startDate === "string") startISO = rec.startDate;
        else if (rec?.startDate?._seconds) startISO = new Date(rec.startDate._seconds * 1000).toISOString();

        const b = boundaryForTomorrow(startISO, on, off, tz, PRETEND_TODAY);
        console.log(`[${uid}] ${name} start=${startISO} on=${on} off=${off} => ${b?.type||"no change"}`);
        if (b?.type === "ON_BEGINS_TOMORROW") lines.push(`• ${name}: ON cycle begins tomorrow.`);
        if (b?.type === "ON_ENDS_TOMORROW")   lines.push(`• ${name}: ON cycle ends tomorrow (OFF starts).`);
      }

      if (!lines.length && !FORCE_SEND) {
        console.log(`[${uid}] No boundaries tomorrow.`);
        continue;
      }

      const when = (PRETEND_TODAY ? DateTime.fromISO(PRETEND_TODAY, { zone: tz }) : DateTime.now().setZone(tz))
                    .plus({days:1}).toFormat("cccc, LLL d");
      const subject = "Heads up: cycle changes tomorrow";
      const body = `Hi!

The following cycle changes happen tomorrow (${when}):
${lines.join("\n")}${lines.length ? "" : "\n\n(This is a test email triggered manually.)"}

You can change notification preferences in Settings.`;

      if (!dest) {
        console.log(`[${uid}] Would send (FORCE_SEND) but no destination email resolved.`);
        continue;
      }

      await sendEmail(dest, subject, body);
      console.log(`[${uid}] ✅ Notified -> ${redactEmail(dest)}`);
      sent++;

    } catch (e) {
      console.error(`[${uid}] Error:`, e);
    }
  }

  console.log(sent ? `Done. Emails sent: ${sent}` : "Done. No emails sent.");
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
