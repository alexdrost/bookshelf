# System map

How a book gets from Alex's hands to bookshelf.drost.us, and where every piece lives.

---

## The pipeline

```
Goodreads          the record of what was read and when
    │              (CSV export, imported periodically — see GOODREADS-RECONCILE.md)
    ▼
Notion             the live editing surface. Enrichment, shelf, slug, cover, Public?
    │              Books data source f387f744-b4f6-46f8-83d4-22b60a9722c5
    ▼
Sync Worker        bookshelf-notion-sync.drost.workers.dev
    │              /sync   → builds books.json, validates, commits if changed
    │              /covers → pushes Cover Image files as {Goodreads ID}.jpg
    │              /health → config check, no writes
    │              cron 0 8 * * * UTC (books first, then a small cover batch)
    ▼
GitHub             src/data/books.json + src/covers/ + the generator
    ▼
Cloudflare Pages   npm run build → dist  ·  Node pinned to 22 via .nvmrc
    ▼
bookshelf.drost.us 360 routes + /404
```

**One direction only.** Nothing on the site writes back to Notion, and nothing in Notion writes
back to Goodreads.

---

## The Worker

Source: `bookshelf_sync_worker.js` (also in project knowledge). Deployed via the Cloudflare
dashboard — connectors cannot deploy Workers or set secrets.

**Secrets:** `NOTION_TOKEN`, `GITHUB_TOKEN`, `SYNC_SECRET`.
**Vars:** `DATA_SOURCE_ID`, `TAGS_DATA_SOURCE_ID`, `GITHUB_REPO`, `GITHUB_BRANCH`,
`BOOKS_PATH` (`src/data/books.json`), `COVERS_PATH` (`src/covers`), `COVER_BATCH` (15).

**It refuses to commit** when any of ten conditions fail: an empty title, fewer than
`MIN_PUBLIC_BOOKS` (300), a duplicate Goodreads ID or slug, a theme outside the locked list,
zero themes, a `|||` in a summary, a dangling connection, or a relation truncated at Notion's
25-item cap. An abort returns HTTP 422 and touches nothing.

Full detail, including every error string and what causes it: `WORKER-DEPLOY.md` and
`COVER-SYNC-DEPLOY.md`.

---

## The generator

No framework, no bundler, no CSS processor. Nunjucks + Node.

```
src/
  data/
    books.json        written by the Worker — never hand-edit
    slugs.json        slug ledger + drift detector; Notion is authoritative
    themes.json       display name, source name, slug, order, intro copy
    clusters.json     /recommendations groupings
    standouts.json    id -> {cluster, note} — the recommendations themselves
  templates/          _layout.njk + partials + one template per page type
  styles/             tokens.css · site.css (verbatim from the original) · pages.css
  assets/js/          extracted from the old SPA by line range, not rewritten
  assets/img/         headshot
  covers/             {goodreadsId}.jpg — written by the Worker
  pages/              about.md · up-next.md · recommendations.md
  index.html          the original SPA; still a build input for the home page
tools/                build.mjs · validate.mjs · derive.mjs · slugify.mjs · qa.mjs
                      + dev-only: visual-check · make-og · md-to-pdf · extract-js
docs/                 runbooks and reports
dist/                 generated, gitignored — Pages builds it
```

`npm run build` then `npm run qa` (87 checks). Both must pass before anything is delivered.

**The published `books.json` is a filtered copy**, not a passthrough: books that are not `read`
have their summary, core ideas, tags and connections stripped, because `dist/books.json` is a
public URL and unread enrichment should not be downloadable.

---

## Routes

| Route | What it is |
| --- | --- |
| `/` | Home — stat bar, most recent read, 24-book shelf |
| `/library` + `/library/2…14` | All read books, 24 per page, client-side sort and filter |
| `/up-next` | `reading` (large cards) + `TBR` (small grid) |
| `/timeline` + `/2020…/2026` | Trend by month (clickable → `/{year}#m-{MM}`), trend by year |
| `/themes` + 10 theme pages | Two-up cards with six biased-random covers |
| `/connections` | Theme matrix (clickable) · force graph · path finder |
| `/analytics` | Publication lag, streaks, cumulative pages, theme mix |
| `/recommendations` | Standouts, plus the recommend-a-book form |
| `/about` | Bio, headshot, the connections essay, contact form |
| `/book/{slug}` × 321 | One per read book |

Retired: `/picks` (now `/recommendations`) and `/reading` (folded into `/about`). Both are dead
URLs — if either was ever shared, they need redirects.

---

## Things that will break as it grows

| Threshold | What happens |
| --- | --- |
| 26 connections on one book | Notion truncates the relation; the Worker aborts. Two books are at 22 |
| ~600 books | `books.json` crosses 1 MB. Already handled — change detection uses the git blob SHA |
| Below 300 public books | Sync aborts. Intentional; raise the floor as the shelf grows |
| A duplicate slug | Sync aborts — two books would otherwise share one URL |
| A corrected Goodreads ID | The cover orphans until it is renamed or re-pushed from Notion |

**Everything fails loudly now.** The original title bug was dangerous precisely because it did
not: it emptied one field and left thirteen looking healthy.
