# SESSIONS 2 & 3 — build report

**Built:** 9 Aug 2026 · `npm run build` → `npm run qa` → `node tools/visual-check.mjs`

**The site is complete at 359 URLs.** 358 routes plus `/404`, exactly the number the build
context predicted.

---

## Sequencing

You sent SESSION 3, whose prerequisite is "SESSIONS 1 and 2 shipped." Session 2 had not been
built, and Session 3 cannot pass its own QA without it — book pages breadcrumb through
`/library`, link themes to `/themes/{slug}`, link years to `/{year}`, and deep-link into
`/connections`. So I built Session 2 first, then Session 3 on top. Every cross-reference
resolves; nothing is left 404-ing.

| | |
| --- | --- |
| `/` regenerated · nav switched to real routes · Authors removed | done |
| JS extracted into `app` / `library` / `graph` / `analytics` | done |
| `/library` ×14, `/themes` + 10, `/timeline` + 7 years | done |
| `/connections` rebuilt (text layer, matrix, bridges, pairs, ego, path finder, graph) | done |
| `/analytics` extended, every existing panel retained | done |
| 318 book pages, connections module, `Book` schema, indexability gate | done |
| Full sitemap with priority tiers | done |
| **QA** | **87 checks green** |
| **Runtime + layout** | **15 page types × 390px and 1440px — zero console errors, zero overflow** |

```
routes .............. 358  (14 library · 10 theme · 7 year · 318 book) + /404
connections ......... 1,238 unique undirected pairs (public + read)
indexable in sitemap  328   (30 book pages gated to noindex,follow)
book pages indexable  288 of 318      <- matches the handoff's "~288 of 318" exactly
books with <3 links   0
```

---

## The JS extraction — the one step that could have broken the site

You picked guarded extraction. Here is what actually happened.

`tools/extract-js.mjs` slices function bodies **verbatim by line range** out of the original
`<script>`; it never retypes them. It applied **39 patches, each asserting exactly one match**,
in only two categories:

- **BIND** — 23 top-level `$("#x").addEventListener(...)` calls became `on("#x", …)`, a helper
  that no-ops when the element is absent, plus element guards inside the tooltip and popover
  helpers. Only the binding site moved.
- **LINK** — the retired book modal's `onclick="openModal(...)"` handlers became real
  `<a href="/book/{slug}">` anchors, in search results, records, year-review cards, stack detail,
  library cards and graph nodes.

Two functions the extracted bodies still call — `writeState()` (the SPA hash-state writer) and
`observeCovers()` (the cover probe) — are **stubbed rather than edited out**, so the bodies stay
byte-identical.

**Deleted, per Step 1:** `probeImg` and its entire fallback chain (`lookupCover`, `tfetch`,
`gbPick`, `olISBN`, `applyCover`, `resolveCoverContainer`, `coverObserver`). I also removed the
Open Library hop from all four `*ImgErr` handlers and from `showBookPop` — those were part of the
same third-party chain, and covers now make one real request with a local placeholder on error.
The Wikipedia author-headshot lookups went with the Authors view. **Zero third-party requests for
images remain in any module.**

**Verified at runtime, not asserted:** every page type loaded in Chromium at 390px and 1440px
with a listener on `console.error`, `pageerror` and `requestfailed`. **Zero errors on all 30
loads.** That is the check that actually proves a guarded extraction works.

Interactive smoke tests, all passing:

- `/analytics` — stat cards 6, records 4, publication-lag bars 7, cumulative-pages paths 2, pace
  points 56, theme-drift columns 8, calendar cells 48. **No existing panel was removed.**
- `/connections` — graph canvas builds at 1240px with a 10-theme legend; the path finder walked
  *Chip War* → *Empire of Pain* in a 4-book chain.
- `/connections` at 390px — ego view opens automatically with 47 neighbours and the canvas is
  never built.
- `/connections` with JavaScript disabled — 1,254 words, 100 matrix cells, 12 bridge cards.
- `/library` with JavaScript disabled — 24 cards, a real `rel="next"` anchor, and the visible
  Load-more fallback.
- `/library` with JavaScript on — Load more took it 24 → 48 cards and pushState'd to `/library/2`;
  sorting by title re-rendered all 318, correctly ordered, starting at *107 Days*.

---

## Findings

### The title bug also breaks the whole client-side layer

This is new since the Session 1 report and worth knowing. Every interactive feature reads
`books.json` — search, the path finder, graph node labels, analytics book lists, year-review
cards. With all 320 titles empty, **every one of them silently renders blank**. I only caught it
because the path-finder smoke test could not find "Chip War".

The build now emits `/data/titles.json` as a client-side twin of the server-side bridge, and
`loadBooks()` applies it where a title is empty. It emits an empty object the moment the Worker is
fixed, so like the server bridge it retires itself. `WORKER-TITLE-FIX.md` is unchanged and still
the actual fix.

### The handoff's connection figures are scoped inconsistently

I checked my computations against the numbers in the Session 2 handoff. Four of five theme-matrix
figures reproduce **exactly** (Personal Growth↔Psychology 184, Memoir↔Politics 165,
Politics↔Society 142, and History↔Tech 78), as does publication lag (**median 3 years, 143 of
315**). Bridge books land on the same names — Silver at 8 themes, with Brill, Keefe, Jacobsen and
Lembke at 7–8.

Three did not, and the reason is scope, not definition:

- **History↔Tech is 78 only when currently-reading books are included** (*Biological War* carries
  both themes). Read-only it is 72. But the same handoff quotes **1,238 pairs**, which is the
  read-only figure. So the matrix numbers are all-books scoped while the pair count next to them
  is read-scoped.
- **111,251 total pages** is the all-books figure *minus 224* — exactly *Shameless*'s page count,
  so that number predates *Shameless* entering the data.
- History↔Politics is 292 read-only / 294 all-books against a quoted 293 — the same drift.

I built everything read-scoped, because Session 3 Step 2 rule 4 explicitly requires filtering
connections to public **and** read. Worth settling the convention in the doc set: the same figure
is right or wrong depending on the surface.

### Guardrail 5 versus Step 7 on the home page

Guardrail 5 says the full summary and core ideas appear on **exactly one URL**. Step 7 says keep
the existing hero and featured treatment — and the existing home page prints the most recent
book's full summary *and* its three core ideas in the feature block.

I kept the visual treatment and swapped the content for the teaser, dropping the core-ideas list.
The guardrail is absolute ("violating any of them fails review"); the layout is unchanged. Flagging
it because it is a real, if small, deviation from "keep the existing hero."

Related: several summaries are a single sentence, so "first sentence" as a teaser would have
republished them verbatim on library, theme and year pages. Teasers are now hard-capped at 130
characters, and QA fails if any hub reproduces a summary over 140 characters.

### Unread books have no page, so they no longer link to one

`/up-next` was linking *Biological War* and *Shameless* to `/book/{slug}` pages that Session 3
correctly does not generate. Those cards now render unlinked, and the client-side slug map only
contains read books so no JS feature can construct a dead link either.

---

## What is provisional

**Featured connection pairs** (§19 open item 3) — you chose the computed fallback, so
`/connections` ships 18 pairs selected by shared themes and tags, with no book appearing more than
twice, and a line on the page saying the hand-written notes are still to come. Replace by writing
the pairs; the module is already built.

**Standout notes** — `standouts.json` is still empty, so `/picks` renders the 12 hand-curated
standouts already in your SPA, and no book page shows a pull-quote. Populate `standouts.json` and
both surfaces fill from the one source, as Session 3 requires.

**Featured pairs and picks are the only provisional content on the site.** Everything else is
either your data or computed from it.

---

## Needs you

1. **Fix the Worker.** Still the top item — it now breaks the client layer as well as the titles.
2. **Review the slugs before they freeze** — unchanged from the Session 1 report, and now they are
   live URLs on 318 pages.
3. **Write the 15–20 featured pairs** and the standout notes.
4. **The enrichment worklist** — the build prints all 30 gated pages with word counts, ascending,
   with their URLs. Those pages generate, stay linked, and carry `noindex,follow`; ~29 words each
   closes the gap to the 150-word target.
5. **Deploy note:** the site now needs `/styles/`, `/assets/`, `/data/` and all 359 pages together.
   `dist/` is the deployable payload — point Cloudflare Pages at `npm run build` with output
   `dist/`, rather than uploading files individually.
6. **Submit the sitemap in batches.** 318 new URLs arriving at once on a domain with little
   accumulated authority produces slow, partial discovery. Partial indexing in the first fortnight
   is expected, not a bug.
