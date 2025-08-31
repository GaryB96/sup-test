// smtpTest.js - optional local SMTP test
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
const to = process.env.TEST_TO || user;

if (!user || !pass) {
  console.error("Set GMAIL_USER and GMAIL_APP_PASSWORD env vars."); process.exit(1);
}

const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });

const subject = "SMTP test from Supplement Tracker";
const text = "If you received this, Gmail App Password SMTP is working.";
transport.sendMail({ from: `"Supplement Tracker" <${user}>`, to, subject, text })
  .then(() => console.log("SMTP test sent to", to))
  .catch(err => { console.error("SMTP test failed:", err); process.exit(1); });
