# Bookshelf — how this runs day to day

*Rewritten 8 November 2026. The August version was a launch-day snapshot; its history now lives in
`WORKER-DEPLOY.md` §12 and the session reports.*

---

## 1. The shape of it

```
Goodreads  →  Notion  →  Sync Worker  →  GitHub  →  Cloudflare Pages  →  bookshelf.drost.us
(what/when)   (edit here)  (/all, nightly)  (data+covers)  (npm run build)
                  ↑
                  └── the Worker sets each public book's page icon to its published cover
```

- **Notion is where you work.** Every site-facing field, the slug, the retail-link IDs, the
  `Standout` checkbox and the cover image.
- **`Public?` is the only gate.** Unchecked, a book does not exist as far as the site is concerned.
- **The Worker is the only writer to GitHub** for `books.json` and covers. Everything else in the
  repo changes only when you upload site files.

---

## 2. The three loops

### Loop A — a new book (weekly-ish). No code.

```
you finish a book → Goodreads → a chat in this project enriches it in Notion (ADD-BOOKS.md)
                  → you review, tick Public? → click /all (or wait for 08:00 UTC) → live
```

`/all?key=…` syncs `books.json`, pushes any new cover, and sets that book's Notion icon, in one
click. If the response says `clickAgain: true`, click again. The validation gate means a
half-finished book can't publish by accident: zero themes, a duplicate slug or a dangling
connection aborts the sync and names the book.

### Loop B — a cover. No code.

Drag the image onto the book's `Cover Image` in Notion (any filename) → `/all`. It lands in Git as
`{Goodreads ID}.jpg` and becomes the page icon. To **replace** a cover a book already has:
`/all?key=…&force={goodreadsId}`.

### Loop C — the site itself (rare). Repo + build.

Templates, CSS, layout, page types. Changes are delivered as files at their repo paths plus an
explicit delete list; `books.json` is never part of a delivery. Before anything ships:
`npm run build`, `npm run qa`, and `node tools/visual-check.mjs` (390px and 1440px).

---

## 3. Standouts

Tick **`Standout`** on a read book in Notion. Its year is its Date Read year. It then appears on
`/recommendations` (standout reads by year, newest first), on that year's review card, and gets a
"Standout read" badge. A year with no ticks shows no standouts — there is no automatic stand-in.

---

## 4. What to hand a chat when you add a book

The minimum is **a Goodreads link**. These three save a round trip:

| | Why it matters |
| --- | --- |
| **Goodreads link or ID** | The join key. Covers, edges and the site hang off it. Never guessed |
| **Date read** | The sort key for the connection graph. A wrong date silently reorders edges |
| **Anything you actually thought** | Goes in the page body, never a synced property — it stays private |

Batch them: five books in one pass get better connections than five separate passes.

---

## 5. What breaks as the shelf grows

| Threshold | What happens | Fix |
| --- | --- | --- |
| **26 connections on one book** | Notion truncates the relation; the Worker aborts | Prune. Two books sit at 22 |
| **~600 books** | `books.json` crosses 1 MB | Already handled — change detection uses the git blob SHA |
| **Below 300 public books** | Sync aborts | Intentional; raise the floor as the shelf grows |
| **A duplicate slug** | Sync aborts | Fix in Notion |
| **A corrected Goodreads ID** | The cover orphans | Re-attach in Notion and `/all` — it's re-pushed under the new ID |
| **A big cover/icon backlog** | More than one invocation's 45-call budget | `clickAgain: true` — click until false, or let the nightly cron chew through it |

Everything fails loudly. The original title bug was dangerous precisely because it didn't.

---

## 6. Where things are documented

| Doc | For |
| --- | --- |
| `docs/project/PROJECT-INSTRUCTIONS.md` | The operating manual a chat in this project loads |
| `docs/project/SYSTEM-MAP.md` | Pipeline, repo layout, routes, nav, palette, dark mode |
| `docs/WORKER-DEPLOY.md` | Deploying the Worker, `/all`, the meter, icons, every error |
| `docs/COVER-SYNC-DEPLOY.md` | How `/covers` behaves (history + still-accurate refusal rules) |
| `docs/EDITING-GUIDE.md` | Editing site copy |
