# Knowlix benchmark data

This folder holds the test data behind every accuracy number Knowlix shows. This page explains, in plain language, what the data is, where each record came from, how the fake references were made, and what the numbers can and cannot tell you.

## In one minute

- Knowlix's reference check ("Lock 1") is **ordinary program code, not AI**. It looks a reference up in public registries and catalogues (doi.org, Crossref, DataCite, OpenAlex, Open Library, Google Books) and compares the title, authors, year and journal field by field.
- It gives one of three stamps: **Verified**, **Please check** (could not be confirmed, but not proven wrong) or **Mismatch** (proven wrong: the DOI was never issued, or it belongs to a different paper).
- To measure how often the stamp is right, we run references whose true status we already know through the same code the website uses, and count.
- There are **three sets of references**: two small hand-written ones (60 and 40) and one large generated one (300) built from random real records. Every case and its result from the large set is published inside the app (`src/shared/benchmark-cases.json`), so anyone can read exactly what the accuracy claim rests on.

## The three reference datasets

| File | Cases | Who made it | Was the checker adjusted using it? | What it is for |
|---|---|---|---|---|
| `references.json` | 60 (30 real, 30 fake) | Written by hand | **Yes.** This is the *tuning set*: when a case failed, the parsing and matching rules were corrected. Its score is therefore optimistic. | Developing the rules |
| `holdout.json` | 40 (20 real, 20 fake) | Written by hand, separately | **No.** It was kept aside, never used to adjust the rules, and is only ever scored. | A first honest number, on famous papers |
| `generated.json` | 300 (150 real, 50 real-with-a-slip, 100 fake) | Built by a script from **random** real records | **No.** The cases were fixed before the checker was first run on them (see "Known limits" for what happens next). | A large, unglamorous, edge-case-rich test whose every case is published in the app |

A fourth file, `claims.json` (20 items), tests a different feature, the claim check. It is described at the end.

### Why the large set exists

The two hand-written sets are small and made of well-known papers (NEJM, Nature, famous economics articles). Famous papers are the easy case: every database has clean records for them. Real student reference lists also contain a 1937 note in *Science*, a Brazilian nursing article, a Russian physics paper, a Zenodo dataset and a book chapter with no DOI. The generated set samples those **at random**, so nobody chose the cases to make the checker look good.

## Where every record comes from

| Source | What we asked for | Used in |
|---|---|---|
| **Crossref REST API, `sample` endpoint**<br>`https://api.crossref.org/works?sample=100&filter=…` | 100 records chosen at random *by Crossref* for each filter. Crossref is the registry that issues DOIs for most journals and books. | `generated.json` |
| **DataCite REST API, `random` listing**<br>`https://api.datacite.org/dois?random=true&…` | Random arXiv preprints (DOI prefix `10.48550`) and Zenodo records. DataCite issues DOIs for preprints, datasets and software. | `generated.json` |
| **doi.org Handle API**<br>`https://doi.org/api/handles/{doi}` | "Has any registry ever issued this DOI?" Used to confirm that every invented DOI really does not exist. | all three sets |
| **Crossref title search**<br>`https://api.crossref.org/works?query.title=…` | "Is there a real paper with a title like this?" Used to confirm that every invented title is not accidentally a real one. | `generated.json` |
| **Open Library**<br>`https://openlibrary.org/isbn/{isbn}.json` | "Is this ISBN known?" Used to confirm that every invented ISBN is unknown. | `generated.json` |
| **Hand-written** | A person picked well-known papers and typed each reference, then checked the details against doi.org, Crossref, OpenAlex, DataCite and Open Library on 2026-11-25. | `references.json`, `holdout.json`, `claims.json` |

No API key was used anywhere. Requests were sent one at a time, at least 1.2 seconds apart. A contact e-mail is added to requests only if the `CONTACT_EMAIL` environment variable is set; none is stored in the code.

## How `generated.json` is built

The script is `bench/build-generated.ts`. It imports nothing from the app, so the test data is made independently of the code being tested.

### Step 1: draw random real records

| What was sampled | Filter sent to the registry | Records drawn | Usable |
|---|---|---|---|
| Journal articles published up to 1979 | `type:journal-article,until-pub-date:1979` (two draws) and `…from-pub-date:1950,until-pub-date:1979` | 300 | 206 |
| Journal articles 1980–1999 | `type:journal-article,from-pub-date:1980,until-pub-date:1999` (two draws) | 200 | 163 |
| Journal articles 2000–2014 | `type:journal-article,from-pub-date:2000,until-pub-date:2014` (two draws) | 200 | 162 |
| Journal articles 2015–2025 | `type:journal-article,from-pub-date:2015,until-pub-date:2025` (two draws) | 200 | 180 |
| Book chapters | `type:book-chapter` (two draws) | 200 | 110 |
| Conference papers | `type:proceedings-article` | 100 | 87 |
| Books and monographs | `type:book` and `type:monograph` | 200 | 60 |
| Preprints registered with Crossref | `type:posted-content` | 100 | 87 |
| Datasets registered with Crossref | `type:dataset` (two draws) | 200 | 49 |
| Mostly Portuguese and Spanish (SciELO) | `type:journal-article,prefix:10.1590` | 100 | 96 |
| Mostly French (OpenEdition) | `prefix:10.4000` | 100 | 72 |
| Mostly Russian | `type:journal-article,prefix:10.31857` and `…prefix:10.17223` | 200 | 151 |
| Japanese publisher (JSCE) | `type:journal-article,prefix:10.2208` | 100 | 74 |
| Older German-language journals (De Gruyter) | `type:journal-article,prefix:10.1515,until-pub-date:1990` | 100 | 64 |
| arXiv preprints (DataCite) | `prefix=10.48550&random=true` | 60 | 56 |
| Zenodo datasets, software and texts (DataCite) | `client-id=cern.zenodo&random=true&resource-type-id=…` (two draws) | 200 | 61 |
| **Total** | | **2560** | **1678** |

The sample was drawn on **2026-11-25**. The 300 cases chosen in Step 3 use 314 of these 1,678 usable records (each chimera uses two).

Raw answers from the registries are saved in `bench/.cache/`. Because "random" gives a different answer each time, **this cache is what makes the dataset reproducible**: with the cache present, the script makes no network calls and produces a byte-identical file. Delete the cache to draw a brand-new sample.

### Step 2: drop records nobody could cite

About one in three sampled records was set aside, by fixed rules in the build script that look only at the record itself and never at what the checker would answer:

| Reason a record was not used | Records |
|---|---|
| No author | 248 |
| Title shorter than three words | 213 |
| Not a citable item (front matter, erratum, review, index…) | 110 |
| A record type that was not asked for (reference entry, edited book, report…) | 85 |
| Zenodo record that is not a text, dataset or software (figure, taxonomic treatment, poster…) | 62 |
| Zenodo/arXiv creator name not split into given name and family name | 41 |
| No title | 35 |
| Same author listed more than once (broken or spam record) | 23 |
| Job title or affiliation typed into the author field | 15 |
| No usable year | 14 |
| Title contains maths markup | 12 |
| Title too long | 6 |
| First author is only an initial | 5 |
| Title contains a broken character | 4 |
| Automatic GitHub release record | 4 |
| Non-Latin title under six characters | 2 |
| Title repeats the journal name | 2 |
| Retracted or a retraction notice | 1 |
| **Total set aside** | **882** of 2560 |

Two small clean-ups are applied to the records that remain: a title stored in ALL CAPITALS is written in sentence case (as a student would type it), and footnote marks stuck to author names (`*`, `†`) are removed. Preprints registered through Crossref are written with the name of the preprint server ("SSRN", "Research Square") because that is what citation styles ask for, even though the registry lists the company that owns the server ("Elsevier BV").

### Step 3: choose cases with a fixed random seed

One number, the **seed `20261125`**, drives every random choice (which records, which style, which letters get swapped in a typo). The same seed and the same cache always give the same 300 cases. Each record is used in at most one case. A few shapes are deliberately topped up so that they are not missed by chance: papers with eight or more authors, organisations as authors, titles with subtitles, and names with accents.

Among the 200 real and real-with-a-slip cases: 124 include a DOI and 76 do not; 27 are from before 1980, 38 from 1980–1999, 52 from 2000–2014 and 83 from 2015 onwards; 69 have a single author, 23 have eight or more, and 4 have an organisation as author; 52 have a subtitle; 37 contain accented letters; 31 have a non-English title, of which 10 are not in the Latin alphabet (Cyrillic, Arabic and others).

### Step 4: write each record out as a student would

Each real record is printed as a reference in a rotating style, using small hand-written templates in the build script (not the app's own formatter, which would be testing the app against itself):

| Style | Cases (all 300) |
|---|---|
| APA 7 | 64 |
| MLA 9 | 39 |
| Harvard | 45 |
| IEEE | 40 |
| Chicago | 38 |
| Vancouver | 38 |
| the "arXiv preprint arXiv:NNNN.NNNNN" form | 3 |
| a doi.org link | 6 |
| BibTeX | 21 |
| a bare DOI | 6 |

About two thirds of the real cases include the DOI and one third leave it out, because without a DOI the checker has to *find* the paper by searching, which is harder.

### The three kinds of case

**Real (150).** The reference is correct. The right answer is **Verified**. Calling it Mismatch is counted as a *serious error*, because that would block a student from using a genuine source.

**Real but imperfect (50).** A correct reference with one honest slip of the kind students make. The right answer is **Verified or Please check**; it must never be Mismatch.

| Slip | What was changed |
|---|---|
| Year off by one | 2019 written as 2018 or 2020 |
| Typo in the title | Two neighbouring letters swapped in one word (two words in long titles) |
| First names spelled out | "Smith, John" where the style expects "Smith, J." |
| Cut to "et al." | Only the first author is named, however many there are |
| Abbreviated journal name | The registry's own short title, or word-by-word abbreviations ("J. Fluid Mech.") |
| Volume and pages left out | Authors, year, title and journal only |
| Title in capitals / without capitals | The whole title in UPPER or lower case |

**Fake (100).** Every fake starts from a real sampled record and changes it, so it looks plausible. A fake must **never** be Verified; that is the serious error for this group.

| Category | How it is made | How we know it is fake | Right answer |
|---|---|---|---|
| Invented DOI on a real title | A real reference; every digit of the DOI is re-rolled at random under the same publisher prefix | doi.org confirmed that no registry has issued the new DOI | Mismatch |
| DOI with two characters swapped | A real reference; two neighbouring characters of the DOI are swapped | doi.org confirmed the swapped DOI is not registered | Mismatch |
| Real DOI, different paper | A real DOI, journal, year and pages, but with an invented title and invented authors | The DOI's true record is known; Crossref's title search found no real paper close to the invented title | Mismatch |
| Fully invented paper | Invented title, authors, volume and pages in a real journal and year; no DOI | Crossref's title search found no real paper close to the invented title | Please check (it cannot be proven wrong, but must not be Verified) |
| Real title, wrong authors and year | A real title and journal, credited to invented people, with the year moved by 3 to 9 years; no DOI | By construction | Please check or Mismatch |
| Chimera of two real papers | The authors, year, journal and pages of one real paper with the title of another; no DOI | By construction | Please check or Mismatch |
| Invented book with a fake ISBN | Invented title and authors, a real publisher and year, and an ISBN with a correct check digit | Open Library had no record of the ISBN; Crossref had no close title | Please check or Mismatch |

Invented titles are assembled from word lists in the build script ("Effects of *peer-led tutoring* on *reading fluency* among *rural primary schools*: *a randomised controlled trial*"). Invented author names come from a fixed list of surnames and first names, avoiding the surnames of the real paper's authors. They are test data and are not claims about any real person.

### What is stored for each case

`id`, `category`, `kind` (`real`, `imperfect` or `fake`), `style`, `input` (the reference text), `acceptable` (the stamps counted as correct), `mustNot` (the stamps that would be a serious error), `truth` (the real record the case was built from: DOI, title, first author, year, registry, and what role that record plays), `tags` and a plain-language `note`.

## How a case is scored

`bench/run-generated.ts` sends each `input` through `parseInput` and `verifyReference`, the same two functions the website calls, four at a time.

- **Correct**: the stamp is one of the `acceptable` ones.
- **Wrong**: any other stamp.
- **Serious error**: the stamp is in `mustNot` (a fake stamped Verified, or a real reference stamped Mismatch). These are the errors that would hurt a student, so they are counted separately.
- **Error (not graded)**: the registries did not answer. The case is retried once after a 20-second pause; if they still do not answer it is recorded as `error` and left out of the percentage, because an outage is not a wrong answer. `npm run bench:generated -- --errors` re-runs only those cases.
- A crash inside the checker is **not** treated as an outage. If the checker stops with an internal error twice in a row, the case is graded on the stamp it actually showed, and the error message is recorded in the reason.

The published file also records how long each case took, the checker's own explanation, and a short fingerprint of the checker's source code at the time of the run.

## Latest results

Snapshot of the run made on **2026-11-25** (checker fingerprint `a8b6d4801a19`). The numbers the app shows are read from `src/shared/benchmark-cases.json`, which is rewritten by every run; this table is only a copy for readers of this page.

| | Result |
|---|---|
| Cases with an acceptable stamp | **284 of 300 (94.7%)** |
| Fakes stamped Verified (serious error) | **0 of 100** |
| Fakes proven wrong (Mismatch) | 46 of the 46 that can be proven wrong; the other 54 have no DOI and were correctly left at Please check |
| Real references stamped Mismatch (serious error) | **0 of 150** |
| Real references stamped Verified | 134 of 150 (the other 16 got Please check) |
| Real-with-a-slip stamped Mismatch (serious error) | **0 of 50** (44 Verified, 6 Please check) |
| Cases the registries failed to answer | 0 (one timed out in the main run and passed when re-run) |
| Typical time per reference | about 2.5 seconds |

| Category | Cases | Correct | Serious errors |
|---|---|---|---|
| Journal article, with DOI | 32 | 30 | 0 |
| Journal article, no DOI | 28 | 25 | 0 |
| Book chapter | 10 | 10 | 0 |
| Conference paper | 10 | 10 | 0 |
| Book | 8 | 7 | 0 |
| Preprint (Crossref) | 8 | 6 | 0 |
| Dataset (Crossref) | 5 | 5 | 0 |
| Non-English title | 14 | 10 | 0 |
| arXiv and Zenodo (DataCite) | 15 | 11 | 0 |
| Only a DOI | 10 | 10 | 0 |
| BibTeX entry | 10 | 10 | 0 |
| Year off by one | 7 | 7 | 0 |
| Typo in the title | 7 | 7 | 0 |
| First names spelled out | 6 | 6 | 0 |
| Cut to "et al." | 7 | 7 | 0 |
| Abbreviated journal name | 7 | 7 | 0 |
| Volume and pages left out | 6 | 6 | 0 |
| Title in capitals | 5 | 5 | 0 |
| Title without capitals | 5 | 5 | 0 |
| Invented DOI on a real title | 16 | 16 | 0 |
| Real DOI, different paper | 16 | 16 | 0 |
| Fully invented paper | 16 | 16 | 0 |
| Real title, wrong authors and year | 14 | 14 | 0 |
| Chimera of two real papers | 14 | 14 | 0 |
| DOI with two characters swapped | 14 | 14 | 0 |
| Invented book with a fake ISBN | 10 | 10 | 0 |

**Every one of the 16 misses is a genuine reference that was given the cautious "Please check" stamp instead of "Verified".** No fake got through and no genuine reference was rejected. The misses fall into a few groups:

| Why a real reference was only "Please check" | Cases |
|---|---|
| The title, authors or journal are not in the Latin alphabet (Cyrillic, Arabic), which the comparison code cannot read | 4 |
| The title contains a full stop in the middle ("Sp. Nov.", "Chapitre second. …", "8. Le verdissement…"), so the parser cut it short | 3 |
| arXiv written the arXiv way ("arXiv preprint arXiv:2411.02280"), or with a pre-2007 arXiv number | 2 |
| A preprint cited by its server name ("SSRN", "Research Square") while the registry lists the owning company | 2 |
| A two-word surname ("Daee Abedin", "Pérouse de Montclos") was split into two people | 2 |
| A quotation inside the title was mistaken for the title | 1 |
| An unquoted (italic) title in MLA style could not be separated from the authors | 1 |
| Crossref's search did not return the book at all | 1 |

### Blind spots found outside the 300 cases

While building this set, four problems were confirmed with one-off tests that are **not** among the 300 cases, because the random draw happened not to produce them. They matter for reading the "0 serious errors" line honestly:

1. **A reference written entirely in a non-Latin alphabet, with a DOI, is not compared at all.** In APA style the checker treats it as "just a DOI" and stamps it Verified from the registry record. An invented Russian title attached to an unrelated real DOI was stamped **Verified**.
2. **The same kind of reference in MLA or IEEE style goes the other way.** A genuine Russian article with its correct DOI was stamped **Mismatch** ("this DOI belongs to a different paper"), because non-Latin text compares as empty.
3. **Old-style DOIs containing `<` and `>`** (used by Wiley and the American Meteorological Society in the 1990s; 6 of the 2,300 Crossref records sampled) are cut off at the `<`, so a genuine DOI was stamped **Mismatch** ("this DOI does not exist").
4. **A BibTeX entry whose publisher contains the word "and"** ("Springer Science and Business Media LLC", exactly as Crossref exports it) makes the checker stop with an internal error and answer "could not be checked right now".

These were found on 2026-11-25 against checker fingerprint `a8b6d4801a19` and have been reported to the developers. They show why a 300-case sample supports "rare", not "never".

## Why nothing is "trained"

Knowlix's reference check contains no machine-learning model. There are no weights, no training run and no examples it has memorised. It is a fixed list of steps:

1. Ask doi.org whether the DOI exists.
2. Fetch the official record from Crossref or DataCite. If the reference has no DOI, search Crossref (and OpenAlex, and book catalogues for books) for the closest record instead.
3. Compare title, authors, year and journal, and add up a score out of 100 (title 40, authors 30, year 15, journal 15).
4. 90 or more is Verified. A DOI that does not exist, or a DOI whose record has a different title *and* different authors, is Mismatch. Everything else is Please check.

So "accuracy" here does not mean "how well a model learned". It means "how often do these fixed rules, applied to live registry data, give the right stamp". What *can* happen is that a developer reads failing cases and edits the rules. That is what "tuning" means on this page:

- `references.json` **was** used that way, so its score flatters the checker.
- `holdout.json` and `generated.json` **were not**, so their scores are the honest ones.

The benchmark data is never sent to an AI model and is never used by the app at run time. The app only *displays* the results.

## How to run it again

All commands are run from the project folder and need an internet connection.

```bash
npm run bench                      # the 60-case tuning set          (about 2 minutes)
npm run bench -- holdout           # the 40-case held-out set        (about 2 minutes)
npm run bench:generated            # the 300-case generated set      (about 15 minutes)
npm run bench:generated -- --errors      # re-run only cases the registries failed to answer
npm run bench:generated -- GF012         # show one case (or one category id) in full detail; writes nothing
npm run bench:generated:build      # rebuild generated.json (no network if bench/.cache/ is present)
```

`npm run bench:generated` is short for `node --conditions=react-server --import tsx bench/run-generated.ts`.

| Output | Contents |
|---|---|
| `src/shared/benchmark.json` | Headline numbers for the two hand-written sets (read by the app) |
| `src/shared/benchmark-cases.json` | Every generated case with its result, per-category counts, totals and a provenance paragraph (read by the app) |
| `bench/results/lock1-generated.json` | The same run in full detail: what the parser read, the score for each field, every step taken |

Results can move slightly between runs because the registries are live: records get corrected, new papers are registered, and a service may be slow on the day.

## Known limits of this evaluation

- **It measures the stamp, nothing else.** A case passes if the stamp is acceptable. It does not check that the suggested DOI, the retraction flag or the explanation text is right.
- **The registries are the answer key.** A "real" case is real because Crossref or DataCite holds the record. If a registry record is itself wrong (misspelled author, wrong year), the benchmark treats the registry as correct.
- **Crossref's random sample is not a student's reading list.** It over-represents old, obscure and non-English items and under-represents the famous recent papers students mostly cite. This makes the generated set *harder* than typical use, which is the intention, but its percentage is not a prediction of everyday accuracy.
- **Some real records were filtered out.** Items with titles under three words, no author or no year were not used (the table above gives the counts). References like that exist in real life and are not measured here.
- **The filter rules involve judgement.** They were written by reading the sampled records (and after one trial run on an earlier draw). They look only at the record, never at the checker's answer, but another person might draw the line between "citable" and "junk" differently.
- **Fakes are template-made.** The invented titles follow a handful of patterns and are less varied than what a language model can invent. Seven kinds of fake are covered; there are others (a real paper cited for a different journal, a real book with the wrong edition, a predatory-journal article that exists but is worthless).
- **"Not registered" was true on the build date.** A publisher could, in principle, register one of the invented DOIs later.
- **One run, one day.** The numbers come from a single run against live services. OpenAlex's free quota is often exhausted, in which case the checker's OpenAlex steps are skipped; the provenance paragraph in `benchmark-cases.json` states how many OpenAlex lookups were answered in that run.
- **300 cases is still a small number.** With 100 fakes, a result of "0 fakes verified" supports a claim of roughly "fewer than 3 in 100", not "never". Small categories (5 to 10 cases) can swing a lot from one case.
- **The generated set stays honest only while nobody tunes on it.** If the checker's rules are later changed *because of* failures listed here, this set becomes a tuning set too, and a fresh sample is needed for an unbiased number.
- **That has already happened once, and was handled.** The first sample (seed `20261125`, `generated.json`) exposed parser and matching bugs on 25 Nov 2026: titles cut at an internal full stop, compound surnames, non-Latin scripts, preprint server names, and others. Those were fixed, so that sample is now a development set. A second sample was then drawn with a new seed (`BENCH_SEED=20261126`, `generated-20261126.json`, its own cache folder) and run on the fixed code without looking at it first. The numbers shown in the app come from that second sample. To draw another: `BENCH_SEED=<any new number> npm run bench:generated:build`, then `BENCH_SEED=<the same number> npm run bench:generated`.
- **Citation styles are approximations.** The templates follow APA 7, MLA 9, Harvard, IEEE, Chicago and Vancouver closely but not perfectly, and plain text cannot show italics.

---

## Appendix A: the two hand-written sets

Both files are lists of items with `id`, `kind`, `category`, `raw` (the reference text), `expected` (the right stamp), `expectedFlags` and `truth`. Everything was checked against the live registries on 2026-11-25.

| Kind | Category | `references.json` | `holdout.json` | Right stamp |
|---|---|---|---|---|
| real | Journal article with DOI (medicine, psychology, education, computing, economics) | 10 | 11 | Verified |
| real | Conference paper | 4 | 1 | Verified |
| real | arXiv / Zenodo (DataCite) | 4 | 1 | Verified (arXiv also flagged as a preprint) |
| real | Journal article without DOI | 4 | 2 | Verified |
| real | Book with ISBN / book chapter | 3 | 1 | Verified |
| real | Minor typo | 3 | – | Verified |
| real | Accented names / organisation as author | – | 3 | Verified |
| real | Retracted paper | 2 | 1 | Please check, with a "retracted" flag (the record is real, but the student must acknowledge the retraction) |
| fake | DOI that does not exist | 8 | 6 | Mismatch |
| fake | Real DOI on a different paper | 7 | 5 | Mismatch |
| fake | Fully invented, no DOI | 6 | 4 | Please check |
| fake | Real paper with wrong year or journal | 5 | 3 | Please check |
| fake | Chimera (real author and journal, invented title, non-existent DOI) | 4 | 2 | Mismatch |

Most items are in APA 7; a few are BibTeX, bare DOIs or Harvard. Invented titles attributed to real researchers in these two files are test data, not claims about those researchers' work.

How each item was confirmed:

| Check | Endpoint |
|---|---|
| DOI exists in any registry | `https://doi.org/api/handles/{doi}` (`responseCode` 1 = exists, 100 or HTTP 404 = not found) |
| Official record | `https://doi.org/{doi}` with `Accept: application/vnd.citationstyles.csl+json`, and `https://api.crossref.org/works/{doi}` |
| Finding papers cited without a DOI; confirming invented titles have no close match | `https://api.crossref.org/works?query.bibliographic=…` and `https://api.openalex.org/works?search=…` |
| Retractions | `https://api.crossref.org/works?filter=updates:{doi}` and OpenAlex `is_retracted` |
| arXiv and Zenodo | `https://api.datacite.org/dois/{doi}` |
| Books | `https://openlibrary.org/isbn/{isbn}.json` |

## Appendix B: `claims.json` (the claim check)

Twenty claim/passage pairs built from the abstracts of 14 real papers. They test a different feature: whether a sentence is supported by the passage it cites. Run with `npm run bench:claims`.

| Expected answer | Items | Notes |
|---|---|---|
| supports | 6 | C01–C06 |
| partly | 7 | C07–C10 overgeneralise or drop a qualifier; C18–C20 are caught by code (a misquote, a changed number, a changed year) |
| says nothing | 4 | C11–C14 |
| opposite | 3 | C15–C17 |

Every passage is copied exactly from the source abstract (the build checked this with an exact text match).

## Appendix C: registry quirks worth knowing (for developers)

- **arXiv and Zenodo DOIs are DataCite DOIs.** Crossref returns 404 for them; doi.org content negotiation returns the record. A DataCite lookup can fail once and work on retry.
- **OpenAlex merges an arXiv DOI with the published version**, so detect preprints from the DOI prefix, not from OpenAlex's `type`.
- **Zenodo "concept" DOIs change over time** (they point to the latest version), and Zenodo creator names are often not split into given and family name.
- **ACM titles are split in Crossref**: the part before the colon is in `title`, the rest in `subtitle`.
- **Retracted records are renamed** with a `RETRACTED:` prefix in Crossref and OpenAlex.
- **Crossref fields can be empty or placeholders**: `volume: null`, pages `0-0`, an author called `&NA;` or `Et al.`, the same author listed twice, a title stored in capitals, markup inside a journal name.
- **Crossref title search can rank a review or a reprint above the paper itself.**
- **Preprints in Crossref list the owning company as publisher** ("Elsevier BV" for SSRN, "Springer Science and Business Media LLC" for Research Square), not the server name a student would write.
- **Rate limits**: OpenAlex without a key has a small shared daily budget and answers HTTP 429 when it is spent. Crossref answers 429 if several heavy requests arrive together; one request at a time, about a second apart, was reliable.
