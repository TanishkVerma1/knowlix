// Visual check: drives the real app in the installed Chrome and saves screenshots.
//   node scripts/look.mjs [baseUrl] [outDir]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".impeccable/review";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const shot = async (name, full = false) => {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  console.log("saved", name);
};

await page.goto(base + "/", { waitUntil: "networkidle" });
await shot("01-home");

await page.getByRole("button", { name: "Try a sample list" }).click();
await page.waitForURL(/\/audit\//, { timeout: 30000 });
// Mid-run: at least one stamp has landed but the run is not finished.
await page.waitForFunction(() => /Checking \d+ of \d+/.test(document.body.innerText) && document.querySelectorAll(".stamp").length >= 2, null, { timeout: 60000 }).catch(() => {});
await shot("02-audit-running");
await page.waitForFunction(() => /\d+ references? checked/.test(document.body.innerText), null, { timeout: 150000 }).catch(() => console.log("still checking after 150s"));
await page.waitForTimeout(1200);
await shot("03-audit-done");
await shot("04-audit-full", true);

const evidence = page.getByRole("button", { name: "Why this stamp?" });
const n = await evidence.count();
if (n > 6) {
  await evidence.nth(6).click();
  await page.waitForTimeout(500);
  await page.locator("[id^=evidence-]").first().scrollIntoViewIfNeeded();
  await shot("05-evidence");
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/", { waitUntil: "networkidle" });
await shot("06-home-mobile", true);

console.log("console errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();
