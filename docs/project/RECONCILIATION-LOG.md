# Reconciliation log

**Last Goodreads CSV pull: 8 November 2026** — `goodreads_library_export.csv`, 342 rows (341 read), full reconcile.

*Append a dated entry every time a CSV is imported. Never rewrite history — the point of this
file is that a future conversation can tell how stale the read dates are without asking.*

---

## Catalog state as of 15 August 2026

| | |
| --- | --- |
| `read`, public | 321 |
| `reading`, public | 3 |
| `TBR`, public | 1 |
| Legacy rows (no Shelf, no Goodreads ID) | 11 — old wishlist, **not** read history |
| Connections | 1,256 unique undirected pairs |
| Site routes | 360 + /404 |

Since the July 25 CSV, books have been added and promoted by hand. **The next CSV import is the
first chance to confirm those read dates against the source of truth.**

---

## 2026-11-08 — goodreads_library_export.csv (342 rows)

Full reconcile: all 341 read rows checked against Notion by Goodreads ID and date. The first full
check since 25 July, so it confirms every read date set by hand since then.

- **Read in CSV:** 341 (336 dated, 5 undated). Notion has 341 `read`, all public, so the shelf
  and the CSV agree one-to-one
- **Exact matches (ID + date):** 338
- **Promoted to `read`:** none
- **Dates corrected:** none
- **New books added:** none
- **Goodreads IDs corrected:** Den of Thieves (38059 → 1972). Same book, same date (2026-09-13).
  The cover in Git is `38059.jpg`. The next `/all` pushes `1972.jpg` from Notion's Cover Image
  and re-points the icon, leaving `38059.jpg` as a harmless orphan. Slug `den-of-thieves` is
  unchanged. Simulated before writing: build OK and QA passes with the new ID
- **Left as-is, flagged:** Project Maven (Notion 2026-10-03) and The Cult of Trump (Notion
  2026-10-09) are on the Goodreads read shelf **with no read date**. Notion's dates were kept;
  the CSV can't confirm them. Add the dates in Goodreads and the next pull will
- **Left as-is:** 3 `reading` and 55 `TBR` books absent from the CSV, as expected
- **Not imported:** ISBN and page counts. Notion holds US print values; several CSV rows are
  audio or Kindle editions
- **Goodreads want-to-read, not in Notion:** A Fabulous Debt (Robin Wigglesworth, 223856801).
  Not added; adding it is an ADD-BOOKS job
- **Legacy rows:** 3 of the 11 no-shelf rows share a Goodreads ID with a real `read` row
  (Competitive Strategy, How to Win Client Business, The 12 Week Year). They're unpublished, so
  the Worker never sees them, but they're duplicates

---

## 2026-07-25 — goodreads_library_export.csv (317 books)

Reconciled ~17 session-added books against the fresh export.

- **Goodreads ID corrected:** Regime Change (199798606 → 250673180). Cover had to be renamed to
  `250673180.jpg`; the old file no longer resolved
- **Dates corrected:** The Nine (06/28), Everything Is Tuberculosis (06/27), The Smartest Guys
  in the Room (07/05)
- **Promoted to `read`:** Regime Change (07/11), The Man Who Solved the Market (07/13),
  The Afghanistan Papers (07/27)
- **Page counts:** kept accurate publisher counts rather than the CSV's mangled edition
  artifacts (Oath = 12, several = 496)
- **Left as-is:** 5 books on currently-reading, absent from the CSV as expected

## 2026-06-03 — goodreads_library_export.csv (305 books)

Prior canonical export. 48 undated books backfilled; 3 Bulletproof titles removed. Superseded by
the July 25 export. The June 3 file and the `enrichment_index_June_5` doc are historical
references only.
