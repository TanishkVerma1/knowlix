import { describe, expect, it } from "vitest";
import { assertPublicUrl, pageToCsl, parsePageMeta, PageError } from "@/server/scholarly/webpage";

const PUBLISHER = `<!doctype html><html><head>
<title>Deep learning | Nature</title>
<meta name="citation_title" content="Deep learning">
<meta name="citation_author" content="LeCun, Yann">
<meta name="citation_author" content="Bengio, Yoshua">
<meta name="citation_journal_title" content="Nature">
<meta name="citation_publication_date" content="2015/05/27">
<meta name="citation_doi" content="10.1038/nature14539">
</head><body></body></html>`;

const ORGANISATION = `<html><head>
<title>Malaria &amp; children | World Health Organization</title>
<meta property="og:site_name" content="World Health Organization">
<meta property="og:title" content="Malaria &amp; children | World Health Organization">
<meta property="article:published_time" content="2024-12-11T09:00:00Z">
<meta name='description' content='Key facts about malaria.'>
</head></html>`;

describe("reading a web page given as a source", () => {
  it("finds the DOI a publisher page declares, so it can be checked as a scholarly record", () => {
    const m = parsePageMeta(PUBLISHER, "https://www.nature.com/articles/nature14539");
    expect(m.doi).toBe("10.1038/nature14539");
    expect(m.title).toBe("Deep learning");
    expect(m.authors).toEqual(["LeCun, Yann", "Bengio, Yoshua"]);
    expect(m.site).toBe("Nature");
  });

  it("reads an ordinary page as a web source: title without the site name, publisher, date", () => {
    const m = parsePageMeta(ORGANISATION, "https://www.who.int/news-room/fact-sheets/detail/malaria");
    expect(m.doi).toBeNull();
    expect(m.title).toBe("Malaria & children");
    expect(m.site).toBe("World Health Organization");
    const csl = pageToCsl(m, new Date(2026, 10, 26));
    expect(csl.type).toBe("webpage");
    expect(csl.author).toEqual([{ literal: "World Health Organization" }]);
    expect(csl.issued).toEqual({ "date-parts": [[2024, 12, 11]] });
    expect(csl.accessed).toEqual({ "date-parts": [[2026, 11, 26]] });
    expect(csl.URL).toBe("https://www.who.int/news-room/fact-sheets/detail/malaria");
  });

  it("falls back to the address when a page names no publisher", () => {
    const m = parsePageMeta("<html><head><title>Notes on memory</title></head></html>", "https://www.example.org/notes");
    expect(m.site).toBe("example.org");
    expect(m.title).toBe("Notes on memory");
  });

  it("never fetches private or local addresses, or anything that is not http(s)", async () => {
    for (const bad of ["http://localhost:3000/api/health", "http://127.0.0.1/", "http://10.0.0.5/admin", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd", "ftp://example.org/x", "https://user:pass@example.org/", "http://printer.local/"]) {
      await expect(assertPublicUrl(bad)).rejects.toBeInstanceOf(PageError);
    }
  });
});
