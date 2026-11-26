# Knowlix design system

The visual world is **the registrar's record**: a reference list is an official record, and nothing enters it until it has been checked and endorsed. It is an Operate surface (a working app), light-first for projectors, with a full dark theme. The world lends four things only: type, palette, density and one signature move. Layout, navigation and controls stay standard web patterns.

Tokens live in `src/app/globals.css`: CSS variables on `:root` and `[data-theme="dark"]`, mapped to Tailwind via `@theme inline`. Changing a token changes every screen.

## The one rule about colour

**Colour is reserved.** Outside the shell, a hue only ever means one of five things: a verdict (green Verified, amber Please check, red Mismatch), a claim label (blue Reported) or an AI role (violet). Everything else is ink-teal on a pale safety-tint ground. A student who sees green, amber or red is always looking at a verdict.

## Palette

| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| Ground | `paper` / `paper-2` | `#e6eeee` / `#d9e4e4` | `#061415` / `#0b1e20` | Page background (security-paper tint), quiet fills |
| Record stock | `card` / `card-2` | `#ffffff` / `#f4f8f8` | `#0f2527` / `#142e31` | Cards, panels, card footers |
| Ink | `ink`, `ink-2`, `ink-3` | `#0d1c1e`, `#314346`, `#516366` | `#e7f2f1`, `#bdcfce`, `#92a9a8` | Text; `ink-3` is the minimum for small text (≥4.5:1) |
| Rules | `rule`, `rule-strong` | `#c9d6d6`, `#a3b6b7` | `#214044`, `#33595d` | Borders, dividers, the guilloche braid |
| Shell | `rail`, `rail-2`, `rail-ink`, `rail-muted` | `#0b2a2e`… | `#030e0f`… | The left navigation and the live AI console |
| Action | `accent`, `accent-hover`, `accent-tint` | `#0b5a63` | `#62d2d9` | Primary buttons, links, focus, selection, "your turn" |
| Verified | `ok`, `ok-tint`, `--ok-stamp` | `#266b24` / `#2c7a2a` | `#84d67f` | Verdict ink, stamp, card header band |
| Please check | `warn`, `warn-tint`, `--warn-stamp` | `#875000` / `#ad6800` | `#f2bb55` | 〃 |
| Mismatch | `danger`, `danger-tint`, `--danger-stamp` | `#b1251c` / `#c3291b` | `#ff8a7c` | 〃 |
| Reported (claims) | `info`, `info-tint` | `#1d54a6` | `#8cbcff` | Lock 2 label |
| AI | `neutral`, `neutral-tint` | `#5a3fb3` | `#b8a8ff` | AI reasoning label and anything an AI model did |
| Folder tabs | `tab-salmon`, `tab-sage`, `tab-sky`, `tab-buff`, `tab-lilac` | pressboard tints | muted | Folder colours in the library |

Verified green is a yellow-green on purpose, well away from the teal of the shell, so a button is never mistaken for a verdict. Status is never shown by colour alone: every status carries an icon and a word (`StatusChip`, `ClaimChip`, `Stamp`, the three-answer strip).

## Type

- **One family, two widths: Archivo** (variable, weight and width axes).
  - Titles are set **expanded and heavy** (`h1` at width 122, weight 800–900; `h2` at 112; `h3` at 106), the way a certificate sets its heading. The `.wide` class gives the same width to the wordmark and stamps.
  - Everything that is read or operated (body, labels, buttons, tables) stays at normal width. Body 16px/1.55.
  - Rank is carried by weight and width before size.
- **Registry identifiers: Courier Prime**, used only for things a registry issued: DOIs, passage IDs (P3), record numbers (No. 03), citation keys, the workspace serial, log fingerprints. Never as a "technical" costume, and never for the references themselves, which are set in the reading face exactly as the student typed them.
- **AI console: Atkinson Hyperlegible Mono**, for the raw text a model types.
- The ampersand is taken from a plain system face (`"Knowlix Ampersand"` in `globals.css`): Archivo draws it as an "et" ligature that misreads in author lists.
- Scripts Archivo does not cover fall back to Atkinson Hyperlegible Next, then the system face.

## Shape and depth

- **Records are separated by rules, not shadows.** Cards are `rounded-2xl` (12px) with a 1px `rule` border and no shadow. Only things that float (dialogs, sheets, the composer, sticky action bars) cast `shadow-lift`.
- Controls: 8px radius (`rounded-lg`), small ones 6px; chips are pills.
- The radius scale is redefined in `@theme` (`--radius-lg` 8px … `--radius-2xl` 12px), so utilities stay standard.
- A record card's top band is 4px in the verdict's ink (pending shows a moving sweep).

## Signature: the endorsement, on a register rule

1. **The stamp** (`Stamp` in `src/components/ui/status.tsx`): a double-ruled endorsement, rotated −4°, with the verdict word in expanded caps and the check date in Courier Prime. When a check finishes it **lands**: scale 1.9 → 0.94 → 1 with a blur-to-sharp settle (420ms, exponential ease-out), plus a ring that fades. Reduced motion shows it without motion. It is the only authored motion.
2. **The register rule** (`RegisterRule` / `.register-rule`): every page title sits on a guilloche braid, the interlaced line security printers use at the head of an official record, ending in the workspace serial. It is SVG geometry drawn through a CSS mask, so it takes the rule colour in both themes.

Supporting behaviours:
- The open page in the navigation is a tab cut from the page's own paper, joined to the work area at the rail's edge.
- Live work is marked by a soft pulse around whoever is working and a caret in the console; nothing else moves.

## Components (src/components, src/features)

| Component | Notes |
|---|---|
| `AppShell`, `PageHeader`, `RegisterRule` | Ink-teal rail (17rem), AI status pill top right, title over the register rule. The mobile header opens the rail as a drawer. |
| `Button` | primary (ink-teal) / secondary / ghost / danger / quiet-danger / link. Disabled states are inert grey, never a faded accent. |
| `Input`, `Textarea`, `Select`, `Label` | 40px controls, accent focus border |
| `StatusChip`, `ClaimChip`, `Stamp` | All status vocabulary comes from `src/shared/labels.ts` |
| `AnswerStrip`, `WhyThisStamp` | The three answers behind a stamp; wording from `src/shared/explain.ts` |
| `Pipeline`, `AgentRoom` | Who is working (AI, code, rules or you), with each AI answer typed live in a shell-coloured console |
| `Dialog`, `Sheet`, `Tip`, `Tabs`, `Menu` | Radix primitives styled with the tokens |
| `Panel`, `Notice`, `EmptyState`, `Skeleton` | Notices are tinted blocks with an icon; no coloured side borders |

## Browser surfaces

Themed selection, caret, focus rings (2px accent, offset 2px), thin scrollbars in `rule-strong`, link underline offset, tabular numerals in tables. Print hides the rail and controls (`no-print`, `print:pl-0`), so receipts print cleanly.

## Voice

Plain words a first-year student understands. Controls name their action. A verdict always says what was found, why it got that stamp and what to do next. "Not found" and "not checked" are stated as such and never softened into a guess.
