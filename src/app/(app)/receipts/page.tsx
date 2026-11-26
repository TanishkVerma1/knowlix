import { PageHeader } from "@/components/shell/app-shell";
import { ReceiptIndex } from "@/features/receipts/receipt-index";

export const metadata = { title: "Honesty receipts" };

export default function ReceiptsPage() {
  return (
    <div>
      <PageHeader
        title="Honesty receipts"
        description="A record of what was checked, which AI was used and what you decided, with proof that the log behind it was never edited. Print it, or share a read-only link with your supervisor."
      />
      <ReceiptIndex />
    </div>
  );
}
