// notify-local.cjs
// Full local notifier: reads Firestore for a single user, computes if cycles change "tomorrow",
// and sends an email. Can also force-send for testing.
// 
// 1) Install deps in your project folder:
//    npm i firebase-admin nodemailer luxon dotenv @sendgrid/mail
//
// 2) Put your Firebase service account JSON in the same folder as this script named:
//    service-account.json
//    (or set FIREBASE_SA_PATH or FIREBASE_SA env var)
//
// 3) Run (Git Bash examples):
//    # Gmail (App Password):
//    GMAIL_USER="you@gmail.com" GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
//    node notify-local.cjs --uid=YOUR_UID --force --email="you@gmail.com"
//
//    # SendGrid (no Gmail needed):
//    SENDGRID_API_KEY="SG.xxxxx" node notify-local.cjs --uid=YOUR_UID --force --email="you@gmail.com"
//
//    # Simulate a date (pretend today):
//    GMAIL_USER="you@gmail.com" GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
//    node notify-local.cjs --uid=YOUR_UID --email="you@gmail.com" --pretend=2025-09-01 --force
//
// CLI flags:
//   --uid=STRING           (required) Firebase Auth uid / user doc id
//   --email=STRING         Override destination email (optional; otherwise uses Firestore setting)
//   --force                Send even if no boundaries (useful for testing)
//   --pretend=YYYY-MM-DD   Pretend "today" (in user's timezone) for boundary calculation
//   --project=ID           Not needed; the service account selects project
//
// Firestore paths used:
//   users/{uid}/settings/notifications   (fields: notifyEmail, email, timezone)
//   users/{uid}/supplements              (fields: name, startDate, cycle.on, cycle.off)

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { DateTime } = require("luxon");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");

// ---- Arg parsing ----
function parseArgs(argv) {
  const out = { force: false };
  for (const a of argv.slice(2)) {
    if (a === "--force") out.force = true;
    else if (a.startsWith("--uid=")) out.uid = a.split("=")[1];
    else if (a.startsWith("--email=")) out.email = a.split("=")[1];
    else if (a.startsWith("--pretend=")) out.pretend = a.split("=")[1];
    else if (a.startsWith("--project=")) out.project = a.split("=")[1];
  }
  return out;
}
const args = parseArgs(process.argv);
if (!args.uid) {
  console.error("Missing --uid=YOUR_UID"); process.exit(1);
}

// ---- Service account loading ----
function loadServiceAccount() {
  if (process.env.FIREBASE_SA) {
    try { return JSON.parse(process.env.FIREBASE_SA); }
    catch (e) { console.error("FIREBASE_SA is not valid JSON:", e); process.exit(1); }
  }
  if (process.env.FIREBASE_SA_PATH) {
    try { return JSON.parse(fs.readFileSync(process.env.FIREBASE_SA_PATH, "utf8")); }
    catch (e) { console.error("Cannot read FIREBASE_SA_PATH:", e); process.exit(1); }
  }
  const p = path.join(process.cwd(), "service-account.json");
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { console.error("Cannot read service-account.json:", e); process.exit(1); }
  }
  console.error("Service account missing. Provide service-account.json or set FIREBASE_SA / FIREBASE_SA_PATH."); process.exit(1);
}
const sa = loadServiceAccount();

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// ---- Email providers ----
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
  throw new Error("No email provider configured (set GMAIL_USER/GMAIL_APP_PASSWORD or SENDGRID_API_KEY).");
}

// ---- Boundary calc (notify the day BEFORE a change) ----
function boundaryForTomorrow(startISO, onDays, offDays, tz, pretendToday) {
  if (!startISO || !onDays || onDays < 0 || offDays < 0) return null;
  const period = onDays + offDays;
  if (period <= 0) return null;

  const zone = tz || "America/Halifax";
  const today = (pretendToday ? DateTime.fromISO(pretendToday, { zone }) : DateTime.now().setZone(zone)).startOf("day");
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

// ---- Main ----
(async () => {
  const uid = args.uid;
  // Load settings
  let tz = "America/Halifax", emailOn = false, emailAddr = null;
  try {
    const sDoc = await db.doc(`users/${uid}/settings/notifications`).get();
    if (sDoc.exists) {
      const s = sDoc.data();
      tz = s.timezone || tz;
      emailOn = !!s.notifyEmail;
      emailAddr = s.email || null;
    }
  } catch (e) {
    console.warn("No settings doc; continuing with defaults if --email provided.");
  }
  if (args.email) emailAddr = args.email;
  if (!emailAddr && !args.force) {
    console.error("No destination email. Either set it in Firestore settings or pass --email=you@example.com (or add --force with --email).");
    process.exit(1);
  }
  if (!emailAddr && args.force) {
    console.error("When using --force, you must still provide --email to send."); process.exit(1);
  }

  // Read supplements
  const suppSnap = await db.collection(`users/${uid}/supplements`).get();
  const lines = [];
  suppSnap.forEach(d => {
    const rec = d.data();
    const name = rec?.name || "Supplement";
    const on = rec?.cycle?.on ?? 0;
    const off = rec?.cycle?.off ?? 0;

    let startISO = null;
    if (rec?.startDate?.toDate) startISO = rec.startDate.toDate().toISOString();
    else if (typeof rec?.startDate === "string") startISO = rec.startDate;
    else if (rec?.startDate?._seconds) startISO = new Date(rec.startDate._seconds * 1000).toISOString();

    const b = boundaryForTomorrow(startISO, on, off, tz, args.pretend);
    if (b?.type === "ON_BEGINS_TOMORROW") lines.push(`• ${name}: ON cycle begins tomorrow.`);
    if (b?.type === "ON_ENDS_TOMORROW")   lines.push(`• ${name}: ON cycle ends tomorrow (OFF starts).`);
  });

  if (!lines.length && !args.force) {
    console.log("No boundaries tomorrow. Use --force to send a test anyway, or --pretend=YYYY-MM-DD to simulate.");
    process.exit(0);
  }

  const when = (args.pretend ? DateTime.fromISO(args.pretend, { zone: tz }) : DateTime.now().setZone(tz))
               .plus({days:1}).toFormat("cccc, LLL d");
  const subject = "Heads up: cycle changes tomorrow";
  const body = `Hi!

The following cycle changes happen tomorrow (${when}):
${lines.join("\n")}${(lines.length ? "" : "\n\n(This is a test email triggered manually with --force.)")}

You can change notification preferences in Settings.`;

  await sendEmail(emailAddr, subject, body);
  console.log(`Email sent to ${emailAddr}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
