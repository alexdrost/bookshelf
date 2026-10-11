# Reconciliation log

**Last Goodreads CSV pull: 25 July 2026** — `goodreads_library_export.csv`, 317 books.

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
