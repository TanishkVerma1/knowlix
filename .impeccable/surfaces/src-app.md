---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

# Knowlix app shell (all working screens)

Scope: the whole Knowlix web app (home, Citation Audit, Research run and agent room, Library, Draft, Receipts, Activity, Settings, How it works, Test set). Visitor mode: Operate.
Audience and job: students checking and building reference lists; judges on a projector, then on their own laptops, with no instructions.
Constraints: light-first for projectors; dark theme required; WCAG 2.2 AA; status always has an icon and a word; no behaviour, copy of record, route or control name changes (tests and demo scripts depend on them).

## Direction contract

THESIS: A reference list is an official record, and Knowlix is the registrar: nothing enters the record until it has been checked and endorsed. This refuses the pastel SaaS dashboard (grey-blue ground, rounded white cards, one blue accent) the app shipped with, and the cream-paper serif "bookish" look.

OWN-WORLD:
- The registrar's transcript: ink on security paper. A deep ink-teal shell, a pale safety-tint ground, white record stock, hairline rules instead of shadows.
- Colour is reserved. Outside the shell, hue only ever means a verdict (green, amber, red), a claim label (blue) or an AI role (violet). Actions are ink.
- One type family in two widths: expanded and heavy for titles, the way a certificate sets its heading; normal width for everything read or operated. A typewriter face only for identifiers a registry issued (DOI, passage and record numbers, log serials).
- Dense, ruled, tabular; 12px record corners, 8px controls.

STORY: The student submits references or a question, watches each entry get checked and endorsed, opens any endorsement to read the evidence, decides the unresolved ones, and leaves with a record they can sign.

FIRST VIEWPORT: Ink-teal rail at left (wordmark, navigation, theme, workspace serial). Main column: the title in expanded heavy type over a register rule that carries the workspace serial, then the one composer. Right column: the reading key for stamps and labels. Top right: the AI status pill.

SIGNATURE: The endorsement stamp lands on a record when its check finishes (verdict word, date), and every title sits on a guilloche-edged register rule.

FORM: assigned candidate 7 of 7 (registrar's transcript on security paper). seed:64220800252dbe59

RAISES: one strict column grid shared by every screen (from the gridded specimen); rank carried by weight and width before size (from the timetable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the review round, the detector pass and a rewritten DESIGN.md.
