# Per-page OG images — report

**Against:** the build handoff dated 16 September 2026
**Written:** 17 September 2026 · **Branch:** `og-images`, based on `origin/main` @ `38371bd`

---

## 1. Status

| Phase | State |
| --- | --- |
| 0 — Discovery | **Done.** All eight questions answered against the repo, §2 below |
| 1 — Prototype, then STOP | **Done.** 14 book/section cards + the home card port. Approved 17 Sept |
| 2 — Book pipeline | **Done.** Manifest wired into `emit()`; 328 book cards render into `dist/og/book/` |
| 3 — Section cards and `share.png` | **Done.** 25 section cards + `share.png` generated from live data; `tools/make-og.mjs` and `src/share.png` retired |
| 4 — QA and determinism | **Done.** 16 new checks (87 → 103), two builds byte-compared, identity fields diffed against a baseline build of `main` |
| 5 — Branch, preview, validate | **Yours.** I cannot push — see §10 |

**Where it stands.** Two commits sit on `og-images`. `npm run build`, `npm run qa` and
`node tools/visual-check.mjs` all pass on current data. Nothing has been merged, and nothing
is live. The one hard stop left is the handoff's own: *don't merge to `main` without Alex*.

---

## 2. Discovery

**Q1 — which template emits `og:*`, and how does a page pass values in?**
`src/templates/_partials/head.njk`, lines 10–24. Exactly one `og:image` and one
`twitter:image` today, both hardcoded to `{{ site.origin }}/share.png`. Pages pass values
through the `page` object the layout is rendered with (`page.ogTitle`, `page.description`,
`page.path`, `page.ogType`, `page.noindex`). The natural hook is a `page.og` object; because
there is only ever one image tag today, replacing it in place satisfies the "exactly one"
requirement with no risk of doubling up.

**Q2 — what does `make-og.mjs` do?**
It builds an HTML string with a `<style>` block and screenshots it with **Playwright /
Chromium** at `deviceScaleFactor: 2`, writing `src/share.png` at **2400×1260** (731 kB).
It is a dev-only tool run by hand; `share.png` is **committed** and `tools/build.mjs:631`
copies it into `dist/`. The layout uses layered radial gradients, a 48px grid, an inline SVG
constellation, absolute positioning, box shadows and `text-overflow: ellipsis`.

**Q3 — do theme colours exist?**
Yes, in three places. The canonical one for the generator is `tools/build.mjs:223`:

```js
const THEME_COLORS = {
  'Politics & Power': '#3a6ea5', 'Business & Finance': '#c6913f',
  'History & Foreign Affairs': '#9c7b57', 'Personal Growth & Leadership': '#88a04a',
  'Memoir & Biography': '#8268a6', 'Psychology & Mind': '#3a8fb0',
  'Society & Culture': '#b06a93', 'Religion & Faith': '#b3864c',
  'Tech & Future': '#5a66ad', 'Crime & Justice': '#b3564c', 'Other': '#9aa0a6',
};
```

It is duplicated verbatim in `tools/make-og.mjs:18` and `src/assets/js/app.js:75`. The cards
now make a **fourth** copy, in `tools/og/lib.mjs`, because `build.mjs` is a script with side
effects and cannot be imported. Phase 4 should add a QA check that all copies match rather
than leave four literals drifting.

**Q4 — where does the manifest plug in?**
`emit(routePath, templateName, ctx, opts)` at `tools/build.mjs:372`. Every route on the site
goes through it, and it already mutates `ctx.page` (it attaches `breadcrumbJson`). Attaching
`page.og` there, keyed on `routePath`, covers all 366 routes in one place.

**Q5 — what does a missing cover render as?**
`<div class="ph">` — a `linear-gradient(140deg, …)` in the book's first theme colour with
the title and author centred in white (`src/styles/site.css:79`, colours derived by `shade()`
in `src/assets/js/app.js`). The card placeholder reproduces this exactly, so a coverless book
looks the same on its card as on its page.

**Q6 — baselines** (clean checkout of `main`, commit `3793d22`)

| | |
| --- | --- |
| Routes | **366 + /404** (the handoff said 361; the catalogue has grown) |
| Book pages | **327** (327 read, 40 TBR, 2 reading — 369 rows in `books.json`) |
| Sitemap URLs | 335 |
| QA | **87 passed, 2 FAILED** — see §8 |
| `dist/` | 36 MB, 367 HTML files, 374 covers |
| Build time | 478 ms |
| QA time | 673 ms |

**Q7 — does `robots.txt` block `/og/`?**
No. It is generated at `tools/build.mjs:634` as `User-agent: *` / `Allow: /` plus the sitemap
line. Nothing is disallowed.

**Q8 — is there a `_headers` file?**
Yes, `src/_headers`, copied to `dist/` alongside `share.png`. It already has a
`/share.png` rule at 30 days. There is no `/og/*` rule; adding one is out of scope here, but
worth noting for later — and note the file's own warning that Pages **merges** matching rules
and comma-joins duplicate header names, so `Cache-Control` must appear on exactly one rule
per path.

---

## 3. Deviations from the handoff

| # | Handoff said | What I did | Why |
| --- | --- | --- | --- |
| 1 | Download Archivo from Omnibus-Type and Inter from rsms releases | Converted the site's own `src/assets/fonts/*.woff2` to static TTF with `fontTools` | Guarantees the cards use byte-identical faces to the pages, needs no network, and cannot drift to a different cut of the typeface. All required glyphs verified present. `tools/og/make-fonts.mjs` reproduces it |
| 2 | — | Added **one** font the site does not serve: `inter-latin-400-italic.ttf` | The home card's standfirst is italic. Satori will not synthesise an oblique, so without it the port renders roman. Taken from `@fontsource/inter`, the same upstream the site's Inter files come from |
| 3 | Subtitle clamped at **2 lines** | Clamped at **4**, with the type stepping down at 80 and 130 characters | Measured across every read book: the tallest text column is **425px inside a 483px row**, 12% headroom, zero overflow. Clamping at two would truncate real subtitles for no layout reason. **Approved 17 Sept** |
| 4 | Home card is Phase 3 | Ported it in Phase 1 | It was the single largest unknown in the brief — "port the design exactly" off a browser renderer. Better to prove it before you approve a direction. It works |
| 5 | "`api.github.com` is blocked; deliver files for manual upload" (project instructions) | `github.com` **clone** works; `git push` is refused by the proxy | That standing instruction is **half stale**. Reading the repo is fine; writing is not, so this ships as a git bundle. `bookshelf.drost.us` itself is still blocked by egress policy |
| 6 | Stress case: "non-JPEG cover under a `.jpg` name" | Case could not be exercised | **All 374 covers are real JPEGs.** sharp's format sniffing is retained anyway — it costs nothing and the failure mode is silent |
| 7 | ~347 images | **354** | 328 book + 10 theme + 7 year + 8 singles + `share.png`. Computed from the data, never hardcoded — the count moves with the shelf |
| 8 | — | `/library` and every `/library/N` share **one** image | The pages differ only by offset. Ten near-identical cards would be ten cache entries advertising the same thing |
| 9 | — | `/404` borrows the home card rather than getting its own | A 404 that is shared is shared by accident. It needs a valid card, not a distinct one |

---

## 4. Metrics

Full build on current data (368 books · 328 read · 3 reading · 37 TBR):

```
367 routes + /404
354 cards in 138.6s   (392 ms each, wall clock, concurrency 4)
total 18.9 MB in dist/     largest 121 kB (/share.png)
book cards: median 53 kB · largest 77 kB
over 250 kB: 0 · over 300 kB: 0
warnings: 0
```

The render is the slowest step in the build, and it is the last one, so a failure there
cannot half-write the HTML. Total build time is comfortably inside Pages' 20-minute limit.

**Determinism.** Two consecutive builds produced 353 identical `?v=` values, a byte-identical
`share.png`, and identical MD5s across the book cards. Cover choice for section art is taken
from an ordered slice, never a shuffle, so nothing re-cuts a URL without a real input change.

**Identity fields.** Diffed 16 pages against a baseline build of `main`: zero differences in
`<link rel="canonical">`, `og:url`, the Person `@id`, `sameAs`, `Book.image` (still the cover,
not the card) or the breadcrumb JSON-LD. The only changed tags are the six `og:image*` /
`twitter:image*` lines.

**Preview origin.** With `CF_PAGES_BRANCH=og-images` and `CF_PAGES_URL` set, only `og:image`
and `twitter:image` move to the preview host. `canonical`, `og:url` and every JSON-LD `@id`
stay on `https://bookshelf.drost.us`, because those are identity claims and a preview build
must not contest them.

---

## 5. Verification done

- **Every one of the 354 cards was eyeballed** on three generated contact sheets. No blanks,
  no near-uniform cards, no clipped text, no card whose cover failed to load.
- **Overflow measured, not assumed**, across all read books by rasterising and measuring the
  ink height of the text column. Worst case 425px in a 483px row.
- **One cosmetic fix came out of that pass:** covers with white backgrounds had no edge
  against the paper ground at feed size, where the drop shadow alone is too soft to read.
  They now carry a 1px hairline at 13% ink.
- **`renderOgImages` now asserts** that every file the manifest promised actually exists, and
  throws if not. `src/share.png` is no longer committed, so a silently skipped home card
  would leave the site advertising a 404 as its `og:image` — strictly worse than a failed
  build, which changes nothing on Pages.

---

## 6. Gotchas found, for the troubleshooting table

**`lineClamp` is silently ignored unless the element is `display: block`.** Under
`display: flex` — which is what everything else on a Satori card has to be — it does nothing
at all and text runs to as many lines as it likes. This cost the first prototype a five-line
subtitle. Every clamped text node in `tools/og/cards/` is `display: block` for this reason.

**Satori supports more than the brief assumed.** Probed and working: layered
`radial-gradient` backgrounds, repeating `linear-gradient` for the grid, `box-shadow`,
`border-radius`, `letter-spacing`, absolute positioning, `text-overflow: ellipsis`, and
**inline `<svg>` children** — which is what makes the home card's constellation port
directly instead of needing to be flattened to an image. What it does not support is `<br>`
and inline `<em>`; the headline is stacked rows with the accent word as its own element.

**Measuring rendered height needs `flatten()` first.** resvg leaves everything outside the
root element transparent, and greyscaling RGBA without flattening turns those pixels black,
so every measurement reports the full canvas height.

---

## 7. Files

**New:**

```
tools/og/lib.mjs              fonts, palette, title/date rules, cover loader, hashing, render
tools/og/og.mjs               the manifest + the render pool — the whole integration surface
tools/og/cards/book.mjs       the /book/{slug} card
tools/og/cards/section.mjs    the shared section card + cover-strip helper
tools/og/cards/home.mjs       the port of make-og.mjs, for /share.png
tools/og/make-fonts.mjs       regenerates the TTFs from src/assets/fonts (authoring step)
tools/og/prototype.mjs        Phase 1 driver — stress set, section cards, contact sheet
tools/og/sweep.mjs            Phase 1 verification — overflow measurement across the shelf
tools/og/fonts/*.ttf          7 static faces, 404 kB total
tools/og/fonts/LICENSE.txt    OFL 1.1 plus provenance
docs/OG-IMAGES-REPORT.md      this file
```

**Changed:**

```
tools/build.mjs                    4 integration points + the guardrail-5 fix (own commit)
src/templates/_partials/head.njk   og:image* and twitter:image* now read page.og
tools/qa.mjs                       16 new OG checks, 87 -> 103
src/_headers                       /og/* gets a 30-day Cache-Control
package.json / package-lock.json   satori, @resvg/resvg-js, sharp
docs/project/PROJECT-INSTRUCTIONS.md · docs/project/SYSTEM-MAP.md
```

**Deleted:**

```
tools/make-og.mjs   superseded by tools/og/cards/home.mjs
src/share.png       the build now writes the same path, same PNG format, from live data
```

The build writes `share.png` to the identical path and format, so every share posted before
this change keeps resolving. Only the picture inside it becomes current.

### Two things about this repo that are not mine, but will bite you

**`npm run build` rewrites `src/data/slugs.json`.** `tools/build.mjs:674` writes the ledger
back to source, so a clean checkout goes dirty the first time you build it. I deliberately
left that file out of both commits — it is pre-existing churn and it would happen identically
on `main`. Don't let it get swept into a merge commit.

**The build warns that three slugs "moved" and need 301s. They don't.** *1177 B.C.*, *Blood
and Oil* and *The Nvidia Way* are all on `reading` or `TBR`, so they have never had a live
page for a redirect to point at. The drift detector fires on any book with a Notion slug,
read or not. Cosmetic, pre-existing, and worth narrowing one day so a real moved URL isn't
lost in the noise.

**`playwright` is imported** by `tools/visual-check.mjs` and `tools/md-to-pdf.mjs` but appears
in no `package.json`. Undeclared dev dependency, not introduced here, still true.

---

## 8. The QA blocker — fixed, in its own commit

QA was **already red on `main`** before any of this work:

```
✗ full summary of 38059 leaked onto /
✗ full summary and core ideas appear on the book page and nowhere else — 1 leaks
```

The home page was reproducing the entire summary of *Den of Thieves* — guardrail 5's exact
prohibition. The lead-in logic took "two sentences capped at 340 characters", and that book's
summary is 319 characters of exactly two sentences, so it came back unchanged. It went live
on 13 September when the book synced in as the newest read.

**Fixed in `919c7be`, committed against `main` and not part of the OG change**, so the two
stay separately reviewable. The fix forces the lead-in to be *strictly shorter* than the
summary: try two sentences, then one, then a hard truncation — first one that actually
shortens. Any future book with a short two-sentence summary is now caught by construction
rather than by QA.

---

## 9. Section card copy — as built

Approved 17 Sept and shipped as written. Every number is computed from the same values the
page itself renders, so a card cannot disagree with its page.

| Card | Kicker | Title | Subline | Art |
| --- | --- | --- | --- | --- |
| Theme | THEME | display name, e.g. *Theology & Faith* | `88 books` | 6 most recent covers in the theme |
| Year | YEAR IN READING | `2025` | `61 books read` | 8 most recent covers from that year |
| Themes hub | THEMES | Ten themes | `328 books across 10 themes` | one most-recent cover per theme |
| Timeline | TIMELINE | Reading over time | `2020–2026` | 8 most recent covers |
| Library | LIBRARY | The library | `328 books, annotated and connected` | 8 most recent covers |
| Connections | CONNECTIONS | The web of connections | `1,027 hand-made links between books` | 6 highest-degree books, ties broken by Goodreads ID |
| Analytics | ANALYTICS | Reading analytics | `328 books · 113,140 pages` | 6 most recent covers |
| Up next | UP NEXT | Up next | `3 currently reading · 37 on deck` | covers from both shelves |
| Recommendations | RECOMMENDATIONS | Books I'd actually recommend | — | the standouts the page renders |
| About | ABOUT | About Alex Drost | How the books on this shelf are chosen, summarised and linked | the headshot from `src/assets/img/` |
| Home | — | ported from `make-og.mjs`, now built from live data | | 4 most recent reads |

Three differ from the brief, deliberately: the **themes hub** counts distinct books rather
than summing theme counts (a book can carry two themes); **up next** names both shelves
because the page shows both; and **recommendations** uses the page's own H1.

**Up next carries covers of unread books, and nothing else.** No title, no author, no
summary, no core ideas — those covers are already public on `/up-next`. No unread enrichment
reaches any card, and QA asserts there is no OG file for any book that is not `read`.

---

## 10. What is left, and it is yours

I can clone this repo but **I cannot push to it** — the proxy refuses to issue a credential
for `alexdrost/bookshelf`. The branch ships as a git bundle instead.

```bash
git clone https://github.com/alexdrost/bookshelf.git   # or use your existing checkout
cd bookshelf
git fetch /path/to/og-images.bundle og-images:og-images
git checkout og-images
npm ci && npm run build && npm run qa
git push -u origin og-images
```

Then, before you even think about merging:

1. **`view-source:` three preview pages** — a book page, a theme page, and `/library/3`.
   Confirm `og:image` points at the preview host with a `?v=`, and that `canonical` and
   `og:url` still say `bookshelf.drost.us`.
2. **Run the preview URL through the LinkedIn Post Inspector** and one other previewer.
   Screenshot both.
3. **Open the PR. Do not merge it without looking at those screenshots.**

After merge, the only thing that ever needs doing by hand is bumping
`OG_TEMPLATE_VERSION` in `tools/og/lib.mjs` when the card *design* changes. Content changes
re-cut their own URLs.
