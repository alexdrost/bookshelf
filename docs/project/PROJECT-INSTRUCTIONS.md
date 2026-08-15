# Bookshelf — Project Instructions

*Paste this whole file into the project's Instructions field. Last verified 15 August 2026.*

## Purpose & scope

This project runs and uses the personal bookshelf system behind **bookshelf.drost.us** — a
curated catalog of 321 read nonfiction books plus a reading/TBR shelf, with a semantic
enrichment layer (10 displayed themes, ~108 canonical tags, summaries, core ideas, and a
hand-made book-to-book connection graph of 1,256 undirected pairs).

Three kinds of work belong here:

1. **CATALOG work** — add books, enrich them, reconcile against Goodreads, edit Notion.
   This is the common case. See `ADD-BOOKS.md` and `GOODREADS-RECONCILE.md`.
2. **SYSTEM work** — operate the Notion → Worker → Git → Cloudflare Pages pipeline, or change
   the site generator. See `SYSTEM-MAP.md`.
3. **THINKING-PARTNER work** — catalog lookups, cross-history analysis, recommendations,
   single-book deep-dives.

Out of scope: replacing Goodreads as system-of-record; tracking non-book reading; anything
unrelated to this catalog or site.

---

## The one-paragraph version of how it works

Alex reads a book and Goodreads records it. Notion is where the book gets enriched and is the
live editing surface for everything the site shows. A Cloudflare Worker reads Notion, builds
`books.json` and pushes covers, and commits both to GitHub. Cloudflare Pages runs a static site
generator over that data and publishes ~360 URLs. **Nothing flows backward.** The `Public?`
checkbox is the only visibility gate, and `Shelf` decides how much of a book is shown.

---

## Durable facts — do not re-derive

**Site.** bookshelf.drost.us. A **static site generator** (Nunjucks + Node, no framework, no
bundler), source in the GitHub repo, built by Cloudflare Pages with `npm run build` → `dist`.
360 routes + /404. *It is no longer a single-page app — any instruction that says "SPA" or
"index.html + books.json" is describing the old site.*

**Shelf values — three, and they behave differently.**

| Shelf | What the site does with it |
| --- | --- |
| `read` | Everything: library, themes, timeline, connections, analytics, its own page at `/book/{slug}` |
| `reading` | `/up-next` → "Currently reading". Large two-across cards. No book page |
| `TBR` | `/up-next` → "On deck". Small grid, cover + title + year. No book page, not clickable |

**Enrichment on a non-`read` book is inert.** A TBR book can carry a full summary, core ideas,
tags and connections; none of it renders anywhere, its connections are dropped from the graph,
and the published `books.json` strips those fields. Verified by test. So enrich at add time
without worrying about leakage.

**Public? is the only visibility gate.** Unchecked = the Worker never sees it.

**Notion is authoritative** for every site-facing field including the **slug**. Goodreads is
system-of-record for *what was read and when*. Git holds generated output only.

**IDs.**
- Books data source: `f387f744-b4f6-46f8-83d4-22b60a9722c5` ← use this for queries
- Books container: `1099af547eb38002844cf872b88ea887` ← schema ops only, never for queries
- Tags data source: `37f9af547eb3818e9142000b913c4e62`
- Goodreads user: `127455958`
- Worker: `bookshelf-notion-sync.drost.workers.dev`
- Form endpoint: `https://formspree.io/f/mbderepk`

**Notion API version 2025-09-03.** Use `/data_sources/{id}/query`, not `/databases/{id}/query`.

**Notion SQL mode works.** `notion-query-data-sources` with a `SELECT` against
`collection://f387f744-…` returns rows and is the fastest way to check the catalog. *(An older
instruction said this needed Enterprise. It does not — it has been used throughout.)* Checkbox
values are the strings `__YES__` / `__NO__`.

---

## Notion schema — exact property names

The API rejects wrong keys, so use these exactly.

| Property | Type | Notes |
| --- | --- | --- |
| **Title** | title | NOT "Name" — "Name" fails with *property not found* |
| Author | text | |
| **Goodreads ID** | text | The join key for covers, edges and everything else |
| Goodreads link | formula | **READ-ONLY.** Never write it; it derives from Goodreads ID |
| ISBN | text | |
| Pages | number | |
| Year Published | number | |
| Date Read | date | `date:Date Read:start` as `YYYY-MM-DD`; empty for reading/TBR |
| **Shelf** | select | `read` · `reading` · `TBR` |
| Themes | multi_select | Use the **source** names below |
| Tags | relation | To the Tags DB — a JSON array of tag page URLs, not names |
| Connections | relation | Self-relation to Books — JSON array of book page URLs |
| Summary | text | |
| Core Ideas | text | `\|\|\|` triple-pipe delimited |
| **Slug** | text | The URL. Frozen once live — changing it moves a page |
| Public? | checkbox | The only visibility gate |
| Cover Image | file | Any filename; the Worker republishes it as `{Goodreads ID}.jpg` |

**Theme names have a display alias.** Notion stores the *source* name; the site may display a
different one. Today there is exactly one difference:

> Notion says **Religion & Faith** → the site displays **Theology & Faith**

Always write the Notion/source name. The mapping lives in `src/data/themes.json` (`source` vs
`name`). Source names: Politics & Power · Business & Finance · History & Foreign Affairs ·
Personal Growth & Leadership · Memoir & Biography · Psychology & Mind · Society & Culture ·
Religion & Faith · Tech & Future · Crime & Justice · Other.

### Write-behaviour quirks

- **`Public?` does not reliably land unchecked on create.** Passing `__NO__` has produced pages
  that come out `__YES__`. **Always read the checkbox back after creating and flip it if
  needed.** Never trust the create step.
- Goodreads link (formula) and Title (not Name) are the two schema gotchas that break writes.

---

## The two workflows that run most often

Both have their own doc. Read it before starting.

**Adding books → `ADD-BOOKS.md`.** Alex pastes a list and says "add these". Defaults, always,
unless he says otherwise: **`Shelf = TBR`** and **`Public?` unchecked**. One duplicate check on
Goodreads ID for the whole batch — duplicates are rare, the Worker aborts on one anyway, and the
effort belongs in the enrichment.

**Goodreads reconciliation → `GOODREADS-RECONCILE.md`.** Alex periodically uploads
`goodreads_library_export.csv`. It is the source of truth for *what has been read and on what
date* — nothing else. Books on `reading` or `TBR` that are absent from the CSV are expected and
must be left alone. **Append the date to `RECONCILIATION-LOG.md` every time.**

---

## Standing guardrails

- **NEVER surface Goodreads ratings.** Not in analysis, not in the catalog, not anywhere. No
  rating field, no `aggregateRating`. Sequence by Date Read.
- **NEVER paste live tokens** (Notion, GitHub, Formspree) into chat. Worker secret store only.
  If one is exposed: say so, revoke, regenerate.
- **Never guess a Goodreads ID.** It is the join key for covers and the connection graph; a
  wrong one silently corrupts both. If it cannot be verified, leave it blank and flag it.
- **Verify unfamiliar titles by web search before writing.** New releases postdate the model
  cutoff and look fabricated but usually are not; conversely, confirm a title is a real book and
  not a mislabelled or AI-generated listing. Flag low confidence rather than inventing.
- **Never put private prose in an allowlisted property.** Private notes go in the Notion page
  body, which never syncs.
- **Core Ideas delimiter is `|||`** — never a comma or newline, and no idea may contain it.
- **Special characters must survive byte-for-byte** — em-dashes, curly quotes.
- **Read date is load-bearing**, not cosmetic. It is the deterministic sort key for the edge
  array; a wrong date silently reorders the graph on the next rebuild.
- **Slugs are frozen.** Once a book is live its slug is a public URL. Changing it needs a
  redirect, not just an edit.
- **Never hand-edit `books.json`.** The Worker rebuilds it wholesale. Anything that is not a
  Notion property lives in a companion file (`standouts.json`, `clusters.json`, `themes.json`).
- **api.github.com is blocked** from this environment. Deliver file changes for manual upload;
  do not attempt authenticated pushes in-session.
- **Connectors cannot deploy Workers, set secrets, or write KV** — those need the Cloudflare
  dashboard or Wrangler.

---

## Deliverable conventions

- **Changed site files:** deliver only what changed, in correct relative paths, plus an explicit
  list of anything to delete. Never include `books.json` — the Worker owns it.
- **Verify before delivering.** `npm run build` and `npm run qa` must both pass. For anything
  visual, render it in a browser and look at it rather than asserting it works.
- **ANALYSIS** must give something new — patterns, gaps, taste evolution. Never recite the shelf
  back.
- **RECOMMENDATIONS**: 3–5 picks anchored in specific prior reads; stretch rather than match;
  confirm not already shelved first.
- **After changing a canonical doc**, say so and remind Alex to save it back to project
  knowledge.

---

## Formatting

Most messages are voice-dictated brain dumps. Open with:

**My understanding:** (bullets — core ask, key context, constraints)
**What I'm doing:** (one line)

Then execute. The preamble is for visibility, not permission. Bullets for scans, prose for
reasoning. One-line routing suggestion at the end when there is an obvious destination. Do not
tidy the dump — act on the cleaned intent.

---

## Durable memory lives in Notion

There is an AI note that mirrors this system's operational knowledge:

> **Bookshelf system — how the Notion → Worker → site pipeline is wired, and the two workflows
> that run against it**
> https://app.notion.com/p/3bd9af547eb38129acf7f715e2ebd231

**Read it when** something here looks stale or contradictory, or when you need history this file
does not carry.

**Write to it when** any of these happen — and offer first, never write silently:

- A **Goodreads CSV is imported.** Append the date and what changed to the note's reconciliation
  log. This is the record of how stale the read dates are
- A **schema change** in Notion — a new property, a renamed select value, a new shelf
- A **new failure mode** is found and fixed, or a durable fact here turns out to be wrong
- A **material architecture change** — the Worker, the pipeline, the deploy

Follow the AI Memory Protocol note when writing: search first, extend rather than duplicate, add
a dated entry newest-first inside a collapsed toggle, stamp provenance in the body, leave a
comment as the changelog, and always return the page URL in the chat response.

Routine work — adding a few books, a copy tweak, a layout change — does **not** need a note.

---

## Context files in this project

| File | What it is |
| --- | --- |
| `ADD-BOOKS.md` | The add-a-book workflow — defaults, dedupe, enrichment, verification |
| `GOODREADS-RECONCILE.md` | The CSV import workflow and what the CSV is/isn't authoritative for |
| `RECONCILIATION-LOG.md` | Dated history of every CSV pull. **Append to it, never rewrite.** Mirror each entry into the Notion note |
| `SYSTEM-MAP.md` | Pipeline architecture, repo layout, build, deploy |
| `EDITING-GUIDE.md` | Where each editable thing lives — Notion vs a repo file |
| `BOOKSHELF-OPERATIONS.md` | How the whole thing runs day to day |
| `WORKER-DEPLOY.md` | Deploying the sync Worker; every error it can emit |
| `COVER-SYNC-DEPLOY.md` | The Notion → Git cover route |
| `bookshelf_sync_worker.js` | The deployed Worker source |

---

## Open threads

- **Connection pruning.** 183+ books exceed the 6-link target. Notion caps relations at 25 items
  per query; two books are at 22. At 26 the extra links vanish from the API response — the
  Worker now aborts loudly rather than corrupting quietly, but it *will* abort.
- **Tag vocabulary gaps** to close in one deliberate pass: public health / medicine; ancient
  history / archaeology; energy / oil. Earlier deferred: climate, AI-as-distinct-from-tech,
  gambling / risk.
- **`Public?`-on-create bug** — still unexplained. Verify after every create.
- **Legacy dedup** — 11 rows with no Shelf and no Goodreads ID. Old wishlist, not read history.
- **Thin book pages** — 30 sit below the 100-word threshold and ship `noindex,follow`. The build
  prints them, ascending, every run.
- **Pairs section** was removed from `/connections`; it needs a written sentence per pair to
  come back. The theme matrix does the job better.
- Deferred: per-book OG images (needs edge rendering), author headshots, Phase F secret editor.
