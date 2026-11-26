import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CslItem } from "@/shared/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stampDate(d: string | Date | null | undefined): string {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

export function relativeTime(d: string | Date): string {
  const t = new Date(d).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function cslYear(item: CslItem | null | undefined): number | null {
  const y = item?.issued?.["date-parts"]?.[0]?.[0];
  const n = typeof y === "string" ? parseInt(y, 10) : y;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function cslAuthors(item: CslItem | null | undefined, max = 3): string {
  const a = (item?.author ?? []).map((n) => n.family ?? n.literal ?? "").filter(Boolean);
  if (!a.length) return "Unknown author";
  if (a.length <= max) return a.length === 2 ? `${a[0]} & ${a[1]}` : a.join(", ");
  return `${a.slice(0, max).join(", ")} et al.`;
}

export function cslVenue(item: CslItem | null | undefined): string | null {
  if (!item) return null;
  return (item["container-title"] as string | undefined) ?? item.publisher ?? null;
}

export function download(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
