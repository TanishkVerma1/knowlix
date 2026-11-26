"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileUp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Adds a paper to the library from its PDF. The file is read in the browser;
 * only the DOI (or, failing that, the title, authors and year) goes on to the
 * reference check. The PDF itself is never uploaded.
 */
export function PdfToLibrary({ onReference, busy }: { onReference: (reference: string) => void; busy: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [reading, setReading] = React.useState(false);

  const onFile = async (f: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    if (f.size > 30_000_000) return toast.error("That PDF is larger than 30 MB.");
    setReading(true);
    try {
      const { readPdf } = await import("@/features/research/pdf-upload");
      const d = await readPdf(f);
      if (d.doi) {
        toast.message("Found a DOI in the PDF", { description: `${d.doi}. Checking it now.` });
        onReference(d.doi);
      } else if (d.title.trim().length >= 6) {
        toast.message("No DOI in the PDF", { description: "Checking it by its title instead." });
        onReference(`${d.authors ? `${d.authors}. ` : ""}${d.year ? `(${d.year}). ` : ""}${d.title.trim()}.`);
      } else {
        toast.error("Nothing readable was found in that PDF.", { description: "It may be a scanned image. Paste its DOI or reference instead." });
      }
    } catch {
      toast.error("That file could not be read as a PDF.");
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      <Button type="button" variant="secondary" size="lg" onClick={() => inputRef.current?.click()} disabled={reading || busy}>
        {reading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
        {reading ? "Reading…" : "Add a PDF"}
      </Button>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Add a PDF to the library" onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );
}
