// scripts/notify-test.js
// Usage: node scripts/notify-test.js 2025-09-05
import process from "node:process";

// EDIT this import path to wherever your real notifier lives:
import { sendCycleBoundaryEmails } from "../notify.js";

/**
 * Accepts pretendToday in YYYY-MM-DD (interpreted by your notifier).
 * Exits 0 on success, 1 on failure.
 */
async function main() {
  const pretendToday = process.argv[2];
  if (!pretendToday || !/^\d{4}-\d{2}-\d{2}$/.test(pretendToday)) {
    console.error("Usage: node scripts/notify-test.js YYYY-MM-DD");
    process.exit(1);
  }

  try {
    console.log("[notify-test] Pretend today:", pretendToday);
    // Call your real production function:
    const count = await sendCycleBoundaryEmails(pretendToday);
    console.log(`[notify-test] Emails sent: ${count}`);
    process.exit(0);
  } catch (err) {
    console.error("[notify-test] FAILED:", err?.stack || err?.message || err);
    process.exit(1);
  }
}

main();
