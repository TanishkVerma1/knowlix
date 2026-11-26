import { PageHeader } from "@/components/shell/app-shell";
import { Composer } from "@/features/home/composer";
import { AuditList } from "@/features/audit/audit-list";

export const metadata = { title: "Citation Audit" };

export default function AuditIndexPage() {
  return (
    <div>
      <PageHeader
        title="Citation Audit"
        description="Paste any reference list. Each entry is checked against doi.org, Crossref, OpenAlex and Open Library, then stamped Verified, Please check or Mismatch, with the evidence one click away."
      />
      <Composer initialMode="audit" />
      <section className="mt-10" aria-labelledby="past-h">
        <h2 id="past-h" className="mb-3 text-[1.05rem] font-bold text-ink">Past audits</h2>
        <AuditList />
      </section>
    </div>
  );
}
