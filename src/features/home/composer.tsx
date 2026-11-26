"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Stamp as StampIcon, Telescope, FlaskConical, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cn, plural } from "@/lib/utils";

type Mode = "audit" | "research";

/** Guesses whether pasted text is a reference list or a research question. */
export function detectMode(text: string): { mode: Mode; count: number } {
  const t = text.trim();
  if (!t) return { mode: "audit", count: 0 };
  const lines = t.split(/\n\s*\n|\n/).map((l) => l.trim()).filter((l) => l.length > 5);
  const refSignals =
    /10\.\d{4,9}\/\S+/.test(t) ||
    /\(\s*(1[5-9]\d\d|20\d\d)[a-z]?\s*\)/.test(t) ||
    /^@\w+\s*\{/m.test(t) ||
    /^TY\s{2}-/m.test(t) ||
    /ISBN|arxiv[:.]/i.test(t) ||
    /\b(vol\.|pp\.|et al\.)/i.test(t);
  if (refSignals) {
    const bib = (t.match(/^@\w+\s*\{/gm) ?? []).length;
    return { mode: "audit", count: bib || Math.max(1, t.split(/\n\s*\n/).length > 1 ? t.split(/\n\s*\n/).filter((p) => p.trim().length > 5).length : lines.length) };
  }
  return { mode: lines.length > 2 ? "audit" : "research", count: lines.length };
}

export function Composer({ autoFocus = false, initialMode }: { autoFocus?: boolean; initialMode?: Mode }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [override, setOverride] = React.useState<Mode | null>(initialMode ?? null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const detected = detectMode(text);
  const mode = override ?? detected.mode;

  const audit = useMutation({
    mutationFn: (body: { text?: string; sample?: boolean }) => api<{ auditId: string; count: number; truncated: boolean; unreadable: number }>("/api/audits", { body }),
    onSuccess: (r) => {
      if (r.truncated) toast.message("Only the first 60 references were taken", { description: "Split longer lists into several audits." });
      if (r.unreadable) toast.message(`${plural(r.unreadable, "entry")} could not be read`, { description: "Check the BibTeX/RIS syntax of those entries." });
      router.push(`/audit/${r.auditId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [hint, setHint] = React.useState(false);
  const submit = () => {
    const t = text.trim();
    if (!t) {
      setHint(true);
      document.getElementById("composer")?.focus();
      return;
    }
    setHint(false);
    if (mode === "audit") audit.mutate({ text: t });
    else router.push(`/research/new?q=${encodeURIComponent(t.slice(0, 500))}`);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = "";
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      // An essay or paper: read it on this device and lift out its reference list.
      if (f.size > 30_000_000) return toast.error("That PDF is larger than 30 MB.");
      const reading = toast.loading("Reading the PDF on your device…");
      try {
        const { readPdfReferenceList } = await import("@/features/research/pdf-upload");
        const refs = await readPdfReferenceList(f);
        toast.dismiss(reading);
        if (!refs) return toast.error("No reference list was found in that PDF.", { description: "Knowlix looks for a heading such as “References” or “Bibliography”. Paste the list instead." });
        setText(refs.text);
        setOverride("audit");
        toast.success(`Reference list taken from ${f.name}`, { description: "The file stayed on your device. Check the list below, tidy anything the PDF garbled, then press “Check references”." });
      } catch {
        toast.dismiss(reading);
        toast.error("That file could not be read as a PDF.");
      }
      return;
    }
    if (f.size > 2_000_000) return toast.error("That file is larger than 2 MB.");
    const content = await f.text();
    setText(content);
    setOverride("audit");
    toast.success(`Loaded ${f.name}`, { description: "Press “Check references” to verify every entry." });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-lift">
      <div className="flex flex-wrap items-center gap-1 border-b border-rule bg-card-2 px-3 py-2" role="radiogroup" aria-label="What do you want to do?">
        {(
          [
            { id: "audit", label: "Check references", icon: StampIcon },
            { id: "research", label: "Ask a research question", icon: Telescope },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setOverride(m.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[0.92rem] font-semibold transition-colors",
              mode === m.id ? "bg-card text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            <m.icon className="size-4" aria-hidden />
            {m.label}
          </button>
        ))}
        <span className="ml-auto hidden text-[0.8rem] text-ink-3 sm:block">{text.trim() && !override ? "Detected from what you typed" : ""}</span>
      </div>
      <div className="relative">
        <label htmlFor="composer" className="sr-only">
          {mode === "audit" ? "Paste your references" : "Type your research question"}
        </label>
        <textarea
          id="composer"
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={mode === "audit" ? 7 : 3}
          spellCheck={mode === "research"}
          placeholder={
            mode === "audit"
              ? "Paste your reference list: APA, MLA, Harvard, IEEE, BibTeX, RIS, DOIs, links or ISBNs. One per line. Or upload your essay as a PDF and Knowlix lifts out its reference list.\n\nExample: Hattie, J., & Timperley, H. (2007). The power of feedback. Review of Educational Research, 77(1), 81–112."
              : "Example: Does retrieval practice improve long-term learning more than re-reading?"
          }
          className={cn(
            "block w-full resize-y border-0 bg-transparent px-5 pb-4 pt-4 leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none",
            mode === "audit" ? "text-[1rem]" : "text-[1.15rem]",
          )}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
        <Button variant="primary" size="lg" onClick={submit} loading={audit.isPending}>
          {mode === "audit" ? (text.trim() ? `Check ${plural(detected.count || 1, "reference")}` : "Check references") : "Research this question"}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        {mode === "audit" ? (
          <>
            <Button variant="secondary" onClick={() => audit.mutate({ sample: true })} disabled={audit.isPending}>
              <FlaskConical className="size-4" aria-hidden />
              Try a sample list
            </Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" aria-hidden />
              Upload a file
            </Button>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf,.bib,.ris,.txt,.md,.bibtex" className="hidden" aria-label="Upload a PDF, BibTeX, RIS or text file" onChange={(e) => onFile(e.target.files?.[0])} />
          </>
        ) : null}
        {hint && !text.trim() ? (
          <span className="text-[0.88rem] font-semibold text-warn" role="status">
            {mode === "audit" ? "Paste at least one reference first, or try the sample list." : "Type your question first."}
          </span>
        ) : null}
        <span className="ml-auto hidden text-[0.8rem] text-ink-3 md:block">
          <kbd className="font-sans">Ctrl</kbd> + <kbd className="font-sans">Enter</kbd> to start
        </span>
      </div>
    </div>
  );
}
