// Visual check: live searching state + adding your own PDF at checkpoint 2.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".impeccable/review";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text().slice(0, 300)));
const shot = async (n, full = false) => { await page.screenshot({ path: path.join(out, `${n}.png`), fullPage: full }); console.log("saved", n); };

await page.goto(`${base}/research`, { waitUntil: "networkidle" });
// A question this server has not searched before, so the searching state is real.
await page.locator("#composer").fill(`Does concept mapping help students learn science more than retrieval practice? (${Date.now() % 1000})`);
await page.getByRole("button", { name: "Research this question" }).click();
await page.getByRole("button", { name: /Approve plan and search/ }).waitFor({ timeout: 60000 });
await page.getByRole("button", { name: /Approve plan and search/ }).click();
await page.getByText(/Searched \d+ of \d+|sources verified so far/).waitFor({ timeout: 30000 });
await page.waitForTimeout(300);
await shot("11-searching");
await page.getByRole("button", { name: /Approve \d+ sources? and write/ }).waitFor({ timeout: 180000 });

await page.locator('input[type="file"][accept*="pdf"]').setInputFiles(path.resolve("tests/fixtures/sample-paper.pdf"));
await page.getByRole("heading", { name: "Add this PDF as a source?" }).waitFor({ timeout: 30000 });
await page.getByText("See exactly what will be sent").click();
await page.waitForTimeout(400);
await shot("15-pdf-dialog");
await page.getByRole("button", { name: /Send \d+ passages/ }).click();
await page.getByText(/Your PDF ·/).waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
await page.getByText(/Your PDF ·/).scrollIntoViewIfNeeded();
await shot("16-pdf-added");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
