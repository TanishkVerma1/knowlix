"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileUp, ShieldCheck, LoaderCircle } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import { api, errorMessage } from "@/lib/api";
import { extractDoi } from "@/shared/identifiers";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Input, Label } from "@/components/ui/field";

interface Extracted {
  fileName: string;
  title: string;
  doi: string;
  year: string;
  authors: string;
  passages: string[];
  pages: number;
}

const MAX_PAGES = 15;
const MAX_PASSAGES = 30;
const WORDS_PER_PASSAGE = 60;

/** Reads a PDF entirely in the browser with pdf.js. Nothing is uploaded here. */
export async function readPdf(file: File): Promise<Extracted> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? `${it.str}${it.hasEOL ? "\n" : " "}` : ""))
      .join("")
      .replace(/-\n(?=[a-z])/g, "")
      .replace(/[ \t]+/g, " ");
    pages.push(text);
  }
  let full = pages.join("\n");
  const refs = full.search(/\n\s*(references|bibliography|works cited)\s*\n/i);
  if (refs > full.length * 0.3) full = full.slice(0, refs); // stop before the reference list
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  const firstLines = pages[0]?.split("\n").map((l) => l.trim()).filter((l) => l.length > 20 && l.length < 220) ?? [];
  const metaTitle = info.Title && !/^(microsoft word|untitled|document)/i.test(info.Title) ? info.Title : "";
  const words = full.replace(/\s+/g, " ").trim().split(" ");
  const passages: string[] = [];
  for (let i = 0; i < words.length && passages.length < MAX_PASSAGES; i += WORDS_PER_PASSAGE) {
    const chunk = words.slice(i, i + WORDS_PER_PASSAGE).join(" ");
    if (chunk.replace(/[^A-Za-z]/g, "").length > 40) passages.push(chunk);
  }
  const year = (pages[0] ?? "").match(/\b(19[5-9]\d|20[0-4]\d)\b/)?.[1] ?? "";
  return {
    fileName: file.name,
    title: (metaTitle || firstLines[0] || file.name.replace(/\.pdf$/i, "")).slice(0, 300),
    doi: extractDoi(pages.slice(0, 2).join(" ")) ?? "",
    year,
    authors: (info.Author ?? "").slice(0, 300),
    passages,
    pages: doc.numPages,
  };
}

/**
 * The reference list of a PDF (an essay, a thesis chapter, a paper), read in the browser.
 * Returns the text after the last "References" style heading, or null if there is none.
 */
export async function readPdfReferenceList(file: File): Promise<{ text: string; pages: number } | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(
      content.items
        .map((it) => ("str" in it ? `${it.str}${it.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .replace(/-\n(?=[a-z])/g, "")
        .replace(/[ \t]+/g, " "),
    );
  }
  const full = pages.join("\n");
  const headings = [...full.matchAll(/\n\s*(references|reference list|bibliography|works cited|literature cited)\s*\n/gi)];
  const last = headings[headings.length - 1];
  if (!last || last.index === undefined) return null;
  const text = full
    .slice(last.index + last[0].length)
    .split(/\n\s*(appendix|appendices|acknowledge?ments)\b/i)[0]
    .trim();
  return text.length > 40 ? { text: text.slice(0, 95_000), pages: doc.numPages } : null;
}

export function PdfUpload({ runId, onAdded }: { runId: string; onAdded: (run: RunDTO) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [reading, setReading] = React.useState(false);
  const [data, setData] = React.useState<Extracted | null>(null);
  const [sending, setSending] = React.useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 30_000_000) return toast.error("That PDF is larger than 30 MB.");
    setReading(true);
    try {
      const d = await readPdf(f);
      if (!d.passages.length) toast.error("No text found in that PDF. It may be a scanned image.");
      else setData(d);
    } catch {
      toast.error("That file could not be read as a PDF.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const send = async () => {
    if (!data) return;
    setSending(true);
    try {
      const run = await api<RunDTO>(`/api/research/${runId}/upload`, {
        body: { fileName: data.fileName, title: data.title, doi: data.doi || null, year: data.year ? Number(data.year) : null, authors: data.authors || null, passages: data.passages },
      });
      onAdded(run);
      setData(null);
      toast.success("Your PDF was added as a source", { description: "Only the passages you saw were sent." });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const chars = data?.passages.reduce((n, p) => n + p.length, 0) ?? 0;

  return (
    <>
      <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={reading}>
        {reading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
        {reading ? "Reading on your device…" : "Add your own PDF"}
      </Button>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <Dialog
        open={data !== null}
        onOpenChange={(o) => !o && setData(null)}
        width="max-w-2xl"
        title="Add this PDF as a source?"
        description="It was read on your device. Check the details: Knowlix verifies the DOI (if any) like every other source."
        footer={
          <>
            <Button variant="ghost" onClick={() => setData(null)}>Cancel</Button>
            <Button variant="primary" loading={sending} disabled={!data || data.title.trim().length < 3} onClick={send}>
              Send {data?.passages.length ?? 0} passages
            </Button>
          </>
        }
      >
        {data ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-xl bg-ok-tint px-3 py-2.5 text-[0.9rem] text-ink-2">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
              <span>
                <strong className="text-ok">The PDF itself never leaves your device.</strong> Only the {data.passages.length} passages below ({chars.toLocaleString()} characters, from {Math.min(data.pages, MAX_PAGES) === 1 ? "its only page" : `the first ${Math.min(data.pages, MAX_PAGES)} pages`}, stopping before the reference list) will be sent.
              </span>
            </p>
            <div>
              <Label htmlFor="up-title">Title</Label>
              <Input id="up-title" className="mt-1.5" value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div>
                <Label htmlFor="up-doi">DOI (found in the PDF, if any)</Label>
                <Input id="up-doi" className="mt-1.5 font-record" value={data.doi} placeholder="none found" onChange={(e) => setData({ ...data, doi: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="up-year">Year</Label>
                <Input id="up-year" className="mt-1.5 tabular" value={data.year} inputMode="numeric" onChange={(e) => setData({ ...data, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
              </div>
            </div>
            <div>
              <Label htmlFor="up-auth">Authors</Label>
              <Input id="up-auth" className="mt-1.5" value={data.authors} placeholder="e.g. Roediger; Karpicke" onChange={(e) => setData({ ...data, authors: e.target.value })} />
            </div>
            <details>
              <summary className="cursor-pointer text-[0.9rem] font-semibold text-accent">See exactly what will be sent</summary>
              <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-paper p-3 text-[0.82rem] text-ink-2">
                {data.passages.map((p, i) => (
                  <li key={i}>
                    <span className="font-record font-bold text-ink-3">{i + 1}.</span> {p}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
