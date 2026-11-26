// Copies pdf.js's worker into /public so PDFs are parsed in the browser (never uploaded).
import fs from "node:fs";
import path from "node:path";
const src = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dst = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
