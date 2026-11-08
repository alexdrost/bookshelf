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
    │              /all    → sync, then covers, then icons, on one subrequest meter
    │              /sync   → builds books.json, validates, commits if changed
    │              /covers → pushes Cover Image files as {Goodreads ID}.jpg, then icons
    │              /health → config check, no key, no writes
    │              cron 0 8 * * * UTC = /all
    │  ┄┄┄┄┄┄┄┄┄┄  icons: sets each public page's Notion icon to its published cover
    ▼
GitHub             src/data/books.json + src/covers/ + the generator
    ▼
Cloudflare Pages   npm run build → dist  ·  Node pinned to 22 via .nvmrc
    ▼
bookshelf.drost.us 360 routes + /404
```

**One direction only, with one cosmetic exception.** The Worker sets each public book's Notion
page icon to its published cover URL (`PATCH /v1/pages/{id}` with `{ icon }` and nothing else).
Nothing else writes back to Notion, nothing on the site writes to Notion at all, and nothing in
Notion writes back to Goodreads.

---

## The Worker

Source: **`tools/bookshelf_sync_worker.js` in the repo — the only canonical copy.** Never rebuild
it from an older copy (that's how `/all`, icons and the meter were lost on 3 Oct 2026). Deployed by
pasting into the Cloudflare dashboard — connectors cannot deploy Workers or set secrets. After
every deploy, `/health` must list `ICON_BASE`, `ICON_BATCH` and `MAX_SUBREQUESTS`, and the other
vars must still hold their values (a code-editor deploy can wipe plain-text vars).

**Secrets:** `NOTION_TOKEN` (needs *Read content* + *Update content*), `GITHUB_TOKEN`,
`SYNC_SECRET`.
**Vars:** `DATA_SOURCE_ID`, `TAGS_DATA_SOURCE_ID`, `GITHUB_REPO`, `GITHUB_BRANCH`,
`BOOKS_PATH` (`src/data/books.json`), `COVERS_PATH` (`src/covers`), `COVER_BATCH` (15).
Optional, correct by default: `ICON_BASE` (`https://bookshelf.drost.us/covers`), `ICON_BATCH`
(30), `MAX_SUBREQUESTS` (45).

**Routes.** `/all?key=…` is the one to click: sync, then covers, then icons, with
`clickAgain: true` while work remains. `/sync` and `/covers` still work alone. `dry=1` on any of
them writes nothing; on `/all` it returns `wouldSetIcon`.

**One subrequest meter per invocation.** Cloudflare's free plan caps a run at 50 outbound calls;
the Worker budgets against `MAX_SUBREQUESTS` (45). Sync takes first claim (~8 calls), covers take
2 each up to `COVER_BATCH`, icons take 1 each from whatever is left, up to `ICON_BATCH`. What
doesn't fit waits for the next click or the next night. The cron runs exactly `/all`.

**Icons.** For every public page whose cover is in the repo, the wanted icon is
`${ICON_BASE}/{Goodreads ID}.jpg`; if the page's current icon isn't exactly that, it's set. A cover
written in the same run queues its icon. An icon failure is a warning and never fails the run.

**Synced fields.** Everything the site reads, plus `amazonAsin`, `audibleAsin`, `lastEdited` (the
page's `last_edited_time`; bumped by any edit, including the icon write) and `standout` (the
`Standout` checkbox; `false` until the property exists).

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
  templates/          _layout.njk + partials + one template per page type
  styles/             tokens.css · site.css (verbatim from the original) · pages.css
  assets/js/          split from the old SPA in Aug 2026; hand-maintained since
  assets/img/         headshot
  covers/             {goodreadsId}.jpg — written by the Worker
  pages/              about.md · up-next.md · recommendations.md
tools/                bookshelf_sync_worker.js (the Worker — canonical copy)
                      build.mjs · validate.mjs · derive.mjs · slugify.mjs · qa.mjs
                      og/ — build-time OG cards (satori + resvg + sharp, static TTFs in og/fonts)
                      + dev-only: visual-check (runtime + layout at 390/1440) · md-to-pdf
docs/                 runbooks and reports
dist/                 generated, gitignored — Pages builds it
```

`npm run build` then `npm run qa` (152 checks), plus `node tools/visual-check.mjs` for anything
visual. Both must pass before anything is delivered.
The build also renders 354 OG images into `dist/og/` and `dist/share.png`.

**Standouts come from Notion.** The `Standout` checkbox (read books only; the year is the Date
Read year) syncs as `standout`. It drives `/recommendations` (standout reads by year, newest
first), the year-in-review cards, and the "Standout read" badges. A year with no ticks shows no
standouts — there is no algorithmic fallback. `standouts.json`, `clusters.json` and the
hardcoded `STANDOUTS` constant are gone.

**Theme display names.** Notion stores the source name; `themes.json` maps it to what the site
shows (Religion & Faith → Theology & Faith). Templates use the `themeName` filter; client JS
uses `tname()` with its own `THEME_DISPLAY` copy in `app.js`, which QA checks against
`themes.json`.

**Theme palette.** Ten hues, re-picked Nov 2026 and validated for colour-blind and normal-vision
separation between neighbours in every chart (Politics stays blue). The canonical map is
`THEME_COLORS` in `build.mjs`; `tools/og/lib.mjs` and `src/assets/js/app.js` carry copies, and QA
fails if either drifts. Key order is the chart stacking/legend order — don't re-sort it.
In the force graph all ten are on screen at once, and no ten-colour set separates every
pair; the legend and hover card carry identity there.

**Visual layer.** Phase 2 overrides (warm paper, one primary + one secondary button style,
shelf bands behind cover grids, matrix and graph treatment, 404) live in one block at the end of
`pages.css`, so it can be read or reverted as a unit.

**Mobile (390px).** Phase 3 rules are one `@media(max-width:640px)` block in `pages.css`.
Panels that can't work on a phone carry `hide-sm` (the theme matrix, analytics month trend,
compare table, themes-by-length). Year and theme pages switch to compact lists; the home page
shows 12 books and a one-line currently-reading strip.

**Dark mode.** Follows the system setting; the sun/moon toggle in the nav (inside the menu on a
phone) stores an explicit choice in `localStorage["theme"]`, applied before first paint by a
script in `head.njk`. All colour is tokens: the dark values are at the end of `pages.css`,
declared for both the media query and `[data-theme="dark"]`. Charts use `THEME_COLORS_DARK` in
`app.js` (same hues, lifted for the dark card and re-validated) and redraw on a `themechange`
event. OG images are always light.

**About.** The short bio is the `bio:` front-matter line in `src/pages/about.md`; the Person
schema on /about carries the current employer (`PERSON_ABOUT` in `build.mjs`). Change both
together.

**The published `books.json` is a filtered copy**, not a passthrough: books that are not `read`
have their summary, core ideas, tags and connections stripped, because `dist/books.json` is a
public URL and unread enrichment should not be downloadable.

---

## Routes

| Route | What it is |
| --- | --- |
| `/` | Home — stat bar, most recent read, currently reading (desktop), 24-book shelf starting at book 2 |
| `/library` + `/library/2…15` | All read books, 24 per page, client-side sort and filter |
| `/up-next` | `reading` (newest Notion edit first) + `TBR` (shuffled on every visit) |
| `/timeline` | Trend by year, then every year in review |
| `/2021…/2026` | The year as title, its year-in-review card, then the year's books by month |
| `/themes` + 10 theme pages | Hub: two-up cards. Theme page: 12 newest as cards, the rest as a cover grid |
| `/connections` | Theme matrix (clickable) · path finder · force graph |
| `/analytics` | Stat cards, profile, trend by month, calendar, rhythm, lag, streaks, cumulative pages, rising & falling, compare, records, length/decade/freshness |
| `/recommendations` | Standout reads by year, plus the recommend-a-book form. Not in the desktop nav; linked from home, footer, About, Up Next, 404 and the mobile Explore group |
| `/about` | Bio, headshot, the connections essay, contact form |
| `/book/{slug}` × 341 | One per read book |

**Nav.** Desktop: Library · Themes · Timeline · Up Next · Explore ▾ (Connections, Analytics) ·
About · Search. Mobile: the same with Explore as a labelled group that adds Recommendations.
Defined once as `NAV` in `build.mjs`. Visible breadcrumbs only on book, year and theme pages;
no eyebrow labels.

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
