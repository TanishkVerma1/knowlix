import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { LRUCache } from "lru-cache";
import { extractDoi } from "@/shared/identifiers";
import type { CslItem, CslName } from "@/shared/types";

/**
 * Reads a web page a student gave as a source: its title, site, authors and
 * date, and above all whether it names a DOI (publisher pages do, in their
 * `citation_doi` tag). A DOI is then checked like any other reference; a page
 * without one is kept as a web source, clearly labelled as such.
 *
 * The server fetches a URL chosen by the visitor, so it refuses anything that
 * is not a public web address (no localhost, no private network ranges), on
 * the first request and on every redirect.
 */

export interface PageMeta {
  url: string;
  title: string | null;
  site: string | null;
  authors: string[];
  date: string | null;
  doi: string | null;
  description: string | null;
}

export class PageError extends Error {
  constructor(
    public kind: "blocked" | "unreachable" | "not-a-page",
    message: string,
  ) {
    super(message);
  }
}

const cache = new LRUCache<string, PageMeta>({ max: 300, ttl: 1000 * 60 * 30 });
const MAX_BYTES = 1_500_000;
// Arbitrary websites never get the contact email: that goes to the scholarly registries only.
const PAGE_AGENT = "Knowlix/1.0 (student research assistant)";

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") || v6.startsWith("::ffff:192.168.") || v6.startsWith("::ffff:169.254.");
}

/** Throws unless the URL is an ordinary public http(s) address. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PageError("not-a-page", "That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new PageError("blocked", "Only http and https links can be read.");
  if (url.username || url.password) throw new PageError("blocked", "Links with a username or password in them are not read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new PageError("blocked", "That address is on a private network, so it was not read.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new PageError("unreachable", "That web address could not be found.");
  if (addresses.some((a) => privateAddress(a.address))) throw new PageError("blocked", "That address is on a private network, so it was not read.");
  return url;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every <meta> tag as [name-or-property, content], lowercased keys, in document order. */
function metaTags(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (key && content) out.push([key.toLowerCase(), decode(content)]);
  }
  return out;
}

/** Pure: what a page's own markup says about itself. */
export function parsePageMeta(html: string, url: string): PageMeta {
  const head = html.slice(0, 400_000);
  const tags = metaTags(head);
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const hit = tags.find(([name]) => name === k);
      if (hit?.[1]) return hit[1];
    }
    return null;
  };
  const all = (...keys: string[]) => tags.filter(([name]) => keys.includes(name)).map(([, v]) => v);

  const rawTitle = first("citation_title", "dc.title", "dcterms.title", "og:title", "twitter:title") ?? decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  // A page that does not name its publisher is at least known by its address ("who.int").
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = null;
  }
  const site = first("citation_journal_title", "og:site_name", "application-name", "citation_publisher", "dc.publisher") ?? host;
  // "Title | Site name" and "Title - Site name": keep the title.
  const title = rawTitle && site ? rawTitle.replace(new RegExp(`\\s*[|–—-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "") : rawTitle;
  const authors = [...new Set([...all("citation_author", "dc.creator", "dcterms.creator"), ...all("author", "article:author").filter((a) => !/^https?:/i.test(a))])].slice(0, 12);
  const date = first("citation_publication_date", "citation_online_date", "citation_date", "dc.date", "dcterms.date", "article:published_time", "datepublished", "date", "og:updated_time");
  const doiTag = first("citation_doi", "dc.identifier", "dc.identifier.doi", "prism.doi", "bepress_citation_doi", "doi");
  const doi = extractDoi(doiTag ?? "") ?? extractDoi(url) ?? extractDoi(head.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? "") ?? null;
  return { url, title: title ? title.slice(0, 400) : null, site: site ? site.slice(0, 160) : null, authors, date: date ? date.slice(0, 40) : null, doi, description: first("citation_abstract", "description", "og:description")?.slice(0, 1200) ?? null };
}

/** Fetches a public page (following up to three redirects, each one re-checked) and reads its metadata. */
export async function fetchPageMeta(raw: string): Promise<PageMeta> {
  const hit = cache.get(raw);
  if (hit) return hit;
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": PAGE_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en" },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
    } catch {
      throw new PageError("unreachable", "That page did not answer.");
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new PageError("unreachable", "That link redirects nowhere.");
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    if (!res.ok) throw new PageError("unreachable", `That page answered with an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(type)) throw new PageError("not-a-page", "That link is a file, not a web page. If it is a PDF, add the PDF itself.");
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break; // everything we read lives in the head
      }
      await reader.cancel().catch(() => {});
    }
    const meta = parsePageMeta(html, url.toString());
    cache.set(raw, meta);
    return meta;
  }
  throw new PageError("unreachable", "That link redirects too many times.");
}

function nameOf(full: string): CslName {
  const s = full.trim();
  if (s.includes(",")) {
    const [family, given] = s.split(",").map((x) => x.trim());
    return { family, given: given || undefined };
  }
  const parts = s.split(/\s+/);
  // One word, or something that reads as an organisation: keep it whole.
  if (parts.length === 1 || parts.length > 4 || /\b(organization|organisation|university|institute|agency|association|ministry|department|team|staff|news|press)\b/i.test(s)) return { literal: s };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

/** A web page as a citable record (CSL "webpage"), with today's date as the day it was read. */
export function pageToCsl(meta: PageMeta, accessed = new Date()): CslItem {
  const y = meta.date?.match(/(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  const parts = y ? [Number(y[1]), ...(y[2] ? [Number(y[2])] : []), ...(y[2] && y[3] ? [Number(y[3])] : [])] : null;
  return {
    id: "web",
    type: "webpage",
    title: meta.title ?? meta.url,
    author: meta.authors.length ? meta.authors.map(nameOf) : meta.site ? [{ literal: meta.site }] : undefined,
    issued: parts ? { "date-parts": [parts] } : undefined,
    // APA leaves the site name out when the site is also the author.
    "container-title": meta.authors.length ? (meta.site ?? undefined) : undefined,
    URL: meta.url,
    accessed: { "date-parts": [[accessed.getFullYear(), accessed.getMonth() + 1, accessed.getDate()]] },
    abstract: meta.description ?? undefined,
  };
}
