// Screenshot tour of every page (assumes the sample audit + a research run exist in this browser's workspace).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".impeccable/review";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text().slice(0, 300)));
const shot = async (n, full = false) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, `${n}.png`), fullPage: full }); console.log("saved", n); };

// Seed: sample audit → save to library
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Try a sample list" }).click();
await page.waitForURL(/\/audit\//);
await page.waitForFunction(() => /\d+ references? checked/.test(document.body.innerText), null, { timeout: 150000 });
const auditUrl = page.url();
await page.getByRole("button", { name: "Save to library" }).click();
await page.waitForTimeout(2500);

await page.goto(`${base}/library`, { waitUntil: "networkidle" });
for (const name of ["Dissertation", "Week 4 reading"]) {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill(name);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
}
await page.getByRole("button", { name: /All references/ }).click();
await page.waitForTimeout(500);
await shot("20-library");
await page.locator("#add-ref").fill("10.1038/s41562-021-01187-4");
await page.getByRole("button", { name: "Check and add" }).click();
await page.waitForTimeout(6000);
await shot("21-library-refused");
await page.locator("tbody button").first().click();
await page.waitForTimeout(2500);
await shot("22-library-sheet");
await page.keyboard.press("Escape");

await page.goto(auditUrl.replace("/audit/", "/receipts/audit/"), { waitUntil: "networkidle" });
await shot("23-receipt", true);
await page.goto(`${base}/activity`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Try to edit the log" }).click();
await page.waitForTimeout(1500);
await shot("24-activity");
await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
await shot("25-settings");
await page.goto(`${base}/how-it-works`, { waitUntil: "networkidle" });
await shot("26-how", true);
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Switch to dark theme" }).click();
await page.goto(auditUrl, { waitUntil: "networkidle" });
await shot("27-audit-dark");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
