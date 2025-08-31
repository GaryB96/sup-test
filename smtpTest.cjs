// smtpTest.cjs
// Minimal SMTP check using Gmail App Password or any SMTP relay you configure with nodemailer.
// Usage (Git Bash):
//   npm i nodemailer
//   GMAIL_USER="you@gmail.com" GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" TEST_TO="you@gmail.com" node smtpTest.cjs
//
// If you prefer SendGrid, this script is not needed; use notify-local.cjs with SENDGRID_API_KEY.

const nodemailer = require("nodemailer");

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
const to = process.env.TEST_TO || user;

if (!user || !pass) {
  console.error("Set GMAIL_USER and GMAIL_APP_PASSWORD env vars."); process.exit(1);
}

(async () => {
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  const subject = "SMTP test from Supplement Tracker";
  const text = "If you received this, Gmail App Password SMTP is working.";
  try {
    await transport.sendMail({ from: `"Supplement Tracker" <${user}>`, to, subject, text });
    console.log("SMTP test sent to", to);
  } catch (err) {
    console.error("SMTP test failed:", err);
    process.exit(1);
  }
})();
