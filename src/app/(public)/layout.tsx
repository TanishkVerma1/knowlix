import Link from "next/link";
import { Logo } from "@/components/ui/misc";

/** Minimal frame for pages a supervisor opens without a workspace. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="no-print bg-rail">
        <div className="mx-auto flex max-w-[60rem] items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="size-7" />
            <span className="font-extrabold text-rail-ink">Knowlix</span>
          </Link>
          <span className="text-[0.85rem] text-rail-muted">Read-only receipt</span>
        </div>
      </header>
      <main className="mx-auto max-w-[60rem] px-4 py-8">{children}</main>
    </div>
  );
}
