// Visual check of the research flow: plan → sources → summary → export.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".impeccable/review";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text().slice(0, 300)));
const shot = async (n, full = false) => {
  await page.screenshot({ path: path.join(out, `${n}.png`), fullPage: full });
  console.log("saved", n);
};

await page.goto(`${base}/research`, { waitUntil: "networkidle" });
await page.locator("#composer").fill("Does retrieval practice improve long-term retention compared with re-reading?");
await page.getByRole("button", { name: "Research this question" }).click();
await page.getByRole("button", { name: /Approve plan and search/ }).waitFor({ timeout: 60000 });
await page.waitForTimeout(600);
await shot("10-plan");
await page.getByRole("button", { name: /Approve plan and search/ }).click();
await page.waitForTimeout(4000);
await shot("11-searching");
await page.getByRole("button", { name: /Approve \d+ sources? and write/ }).waitFor({ timeout: 180000 });
await page.waitForTimeout(600);
await shot("12-sources");
await page.getByRole("button", { name: /Approve \d+ sources? and write/ }).click();
await page.getByRole("button", { name: "Approve summary" }).waitFor({ timeout: 180000 });
await page.waitForTimeout(800);
await shot("13-summary");
await page.getByRole("button", { name: "Approve summary" }).click();
await page.getByRole("heading", { name: "AI-use statement" }).waitFor({ timeout: 60000 });
await page.getByRole("heading", { name: "References" }).waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
await shot("14-export", true);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
