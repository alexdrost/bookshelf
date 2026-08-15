# SESSION 1 — build report

**Built:** 9 Aug 2026 · **Repo:** `bookshelf-drost-us` · `npm run build` → `npm run qa`

---

## Status

| | |
| --- | --- |
| Repo scaffold, CSS extraction, self-hosted fonts, Nunjucks, validation gate, slugs | **done** |
| `/about` · `/reading` · `/picks` · `/up-next` · `/404` | **done** |
| `index.html` head, footer, schema fixes (8a–8f) | **done** |
| `robots.txt` · `sitemap.xml` | **done** |
| **Step 0 — the title fix** | **blocked, bridged** — see `WORKER-TITLE-FIX.md` |
| Copy Deck v1 body copy | **not supplied** — drafted from §18 facts, see below |

Build: 5 routes + `/404`. QA: **134 checks, all green.** Visual: **pixel-identical at 390px and
1440px**, zero horizontal overflow on every new page.

---

## Step 0 — the title bug is real, and worse than the handoff says

Verified against the `books.json` you uploaded: **all 320 records have `title: ""`.** Every other
field is intact. The handoff's diagnosis is exactly right — `Title` is the only `title`-type
property in the schema, so a generic `rich_text` accessor empties that one field and nothing else.
I confirmed the property types directly against the live Notion data source.

I could not close it: the Worker source isn't in project knowledge, and this session can't deploy
Workers. `WORKER-TITLE-FIX.md` has the drop-in `readProp()` function, the abort guard that would
have caught this on the first bad run, and the verification steps.

**The site is currently rendering blank titles on every book card.** That makes this the most
urgent item in the project, ahead of everything below.

To unblock the rest of Session 1 I pulled all 320 titles from Notion — 1:1 match on Goodreads ID,
zero duplicates, zero misses — into `src/data/titles.recovery.txt`. The build prefers
`books.json`'s `title` and only falls back to the bridge when it's empty, so the file self-retires
the moment the Worker is fixed. **Nothing was written back into `books.json`.**

---

## Findings that change the doc set

**The counts in `00-BUILD-CONTEXT.md` aren't stale — they're read-shelf-scoped.** I chased this
because 320 ≠ 318, and it reconciles exactly:

| | all public | `shelf: "read"` only | build context says |
| --- | --- | --- | --- |
| books | 320 | 318 | 318 |
| directed `conn` refs | 2,425 | 2,401 | 2,401 |
| unique pairs | 1,250 | 1,238 | 1,238 |
| one-way pairs | — | 75 | 75 |

The two extra books are *Biological War* and *Shameless*, both `currently-reading`. Worth writing
the scope into the doc explicitly, because `/library` renders read-only while `/up-next` and the
connection graph do not — the same figure is correct or wrong depending on the surface.

Three more independent numbers reproduced exactly, which is good evidence the validator matches
your intent: **30 books below the 100-word launch threshold**, **290 below the 150-word target**,
**~8,274 words** to close the gap.

**The ten-theme migration hasn't happened in Notion yet.** The data still uses `Religion & Faith`,
and Notion's Themes property still offers all 11 options including `Other`. The good news: **zero
books currently carry `Other`**, so the removal is a schema cleanup, not a re-tagging job.
`themes.json` maps `Religion & Faith` → *Theology & Faith* / `theology-and-faith`, so the display
name and URL are already correct and the Notion rename can happen whenever you like without
touching the site.

**The reading-state migration (§9) hasn't happened either.** `Shelf` still offers only
`read | currently-reading`. The richer states already exist on **`Read Status`** (Want to Read, On
Deck, Currently Reading, Read, Paused) — but that property doesn't sync. So `/up-next` ships with
a populated "Currently reading" section and two honest empty states. It will fill in by itself
once `Shelf` carries the other values.

**Notion SQL mode works.** The project instructions say it needs Enterprise; it doesn't — I pulled
all 320 titles in a single `group_concat` query. Worth correcting, it's much cheaper than
paginating `query-database-view` 100 rows at a time.

**Project knowledge is behind.** The `index.html` and `books.json` in project docs are older than
what you uploaded (the doc copy is missing `mbk-cov` / `mtImgErr`, and has 305 books). I built
against your uploads. Worth refreshing project knowledge.

---

## Deviations from the handoff — one matters

### Slugs live in `src/data/slugs.json`, not in `books.json`

Step 4 says to write slugs back into `books.json`. **That can't hold.** The sync Worker rebuilds
`books.json` wholesale from Notion on every run and commits it. `slug` isn't in the Notion
allowlist, so every slug would be erased nightly and regenerated from the current title on the
next build. Any title correction would then silently move a live URL — the precise failure Step 4
exists to prevent ("After the first build, slugs are data").

So the ledger is a separate committed file the Worker never touches. It serves Step 4's intent
exactly: written once, never overwritten. **Verified: a second build writes 0 slugs and leaves the
ledger byte-identical.** If you'd rather have it inside `books.json`, that's fine — but the Worker
has to learn to preserve the field first, and that's a Worker change.

Same reasoning applies to `standouts.json` (`standout` / `cluster` / `standoutNote`): none are
Notion allowlist properties, so they'd be wiped too. They're companion files until the Notion
schema catches up.

### `src/styles/pages.css` is a new stylesheet

Guardrail 1 says CSS is moved, never rewritten. `site.css` is untouched and byte-identical, and
`index.html` doesn't load `pages.css` at all — the SPA is provably unchanged. The new file only
lays out the four static pages, and every value in it resolves to a token already in `tokens.css`
or to Archivo/Inter. No new colors, no new typefaces.

### `/picks` falls back to your own SPA picks

Copy Deck v1 wasn't supplied, and cluster membership is open item #1. Rather than invent twelve
picks, `/picks` renders the 12 most recent entries from the `STANDOUTS` map already hand-curated
inside `index.html` (2024 + 2025), with each teaser taken from that book's own summary. Nothing
editorial was fabricated. Populate `src/data/standouts.json` and the page switches to the
clustered path automatically — **the build reports loudly that that path is currently untested.**

### Body copy is drafted, not final

`/about`, `/reading`, and `/picks` copy is written strictly from §18 and carries **zero
`[CONFIRM]` markers** because I didn't use anything I couldn't verify. Specifically excluded: the
~$1B transaction figure, any GLCC role wording, any MICPA year. Branch Out is described as
archived. Geography is Detroit only. Northwood leads in prose, Walsh second.

It lives in `src/pages/*.md`, so swapping in the real deck is a single-file edit per page — no
template changes.

**The 2,400-connections correction:** Step 7 says the deck claims "more than 2,400 connections"
twice and the true figure is 1,238. Both my pages compute it rather than hardcoding, and currently
render **1,250** — the all-public-books figure that matches the "320 books" they also state. If
the deck's surrounding sentence is read-scoped, use 1,238 and 318. Just keep the pair consistent.

---

## Verification

**Proved, not asserted:**

- **CSS extraction is lossless.** Reassembling `tokens.css` + `site.css` reproduces the original
  `<style>` block byte-for-byte. Then, independently: rendered in Chromium with the CSS inline vs.
  linked — same markup, same fonts, only delivery differs — **byte-identical PNGs at 390px and
  1440px**. A same-URL-twice control ran first to prove the render was deterministic at all;
  it initially wasn't, so `prefers-reduced-motion` (which the site already honours) is enabled to
  kill the staggered card animations.
- **Slug idempotency.** Second pass writes nothing, ledger unchanged.
- **Undirected union.** Each book's connections union forward + reverse refs, then dedupe, then
  filter to public. Reproduces 1,250 / 1,238 and the 75 one-way pairs.
- **Zero dangling connections** across all 2,425 references.
- Person `@id` identical on all six emitted pages; `sameAs` intact at 8 nodes; no `email`,
  `telephone`, `Review`, `aggregateRating`, `ratingValue`, or `SearchAction` anywhere.
- Every internal link resolves against files actually written to `dist/`.
- Sitemap generated only from emitted routes, both directions asserted; `/404` excluded and
  `noindex`.
- The three book pairs cited in the `/reading` essay were checked against the data — all six books
  are on the shelf and all three pairs are genuinely connected in `conn`.

**One caught and fixed mid-build:** the breadcrumb was a `<nav>`, which inherited the site's global
sticky-header styling and painted a stray bar across every page. It's a `<div role="navigation">`
now.

**Not verifiable here:** covers. `src/covers/` is empty in this workspace — the images live in the
GitHub repo — so the build reports all 320 as missing. That's an artifact of the sandbox, not a
finding. Drop `/covers/` in before deploying and the number goes to near-zero.

---

## Needs you

1. **Fix the Worker.** Blank titles are live right now. `WORKER-TITLE-FIX.md`. While you're in
   there, raise `MIN_PUBLIC_BOOKS` to ~300 — it's a parked item and it's the same deploy.
2. **Review the 320 slugs before they freeze.** They're in `src/data/slugs.json` and the build
   printed all of them. Rule 1 (segment before the first colon) produces a few blunt ones worth a
   look — `code-name` (*Code Name: Pale Horse*), `fear`, `war`, `drift`, `pure`, `rage`,
   `blowout`, `abundance`. All are legal and unique; some are poor permanent URLs. Editing
   `slugs.json` now is free. After launch it's a redirect.
3. **Copy Deck v1** — send it and I'll swap it in, or keep the drafts.
4. **Cluster names and membership for `/picks`** (open item #1) — the fallback works, but the
   data-driven path stays untested until `standouts.json` has entries.
5. **Two decisions parked in §19** that Session 2 will need: whether `drost.group` and the
   Goodreads profile join `sameAs`, and whether the `/about` and `/reading` copy is final.

## Session 2 compatibility

Checked against the Session 2 handoff you sent: nothing here needs redoing. The nav carries a
comment marking the hash routes for replacement, `/reading`'s internal links are the ones Step 8
says to update, `BreadcrumbList` is already in place, and every book has a frozen slug for the
`/book/{slug}` links Session 2 generates. The cover-`<img>` attribute rule is enforced on generated
pages and deliberately not on the SPA's runtime-built tags, which Session 2 Step 1 extracts.
