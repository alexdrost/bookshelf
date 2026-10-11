# Goodreads CSV reconciliation

**Trigger:** Alex uploads `goodreads_library_export.csv` and says some version of *"reconcile
this."* This happens every few weeks, not on a schedule.

---

## What the CSV is — and is not — authoritative for

**It is the source of truth for exactly two things:**

1. **Which books have actually been read**
2. **The date each one was finished**

**It is authoritative for nothing else.** Specifically:

| Field | Trust the CSV? |
| --- | --- |
| Read status, Date Read | **Yes.** This is the whole point |
| Goodreads ID | Yes — correct Notion if they disagree, and rename the cover file to match |
| Title, Author | Only to match records. Notion's version may be deliberately tidier |
| **Page count** | **No.** The CSV carries edition artifacts — audiobook durations, `12`, `496` on everything. Keep the publisher page count already in Notion |
| ISBN | Weakly. It reflects whichever edition Goodreads matched |
| **Rating** | **Never.** Do not read it, surface it, or factor it into anything |

## What will be missing from the CSV, by design

Books on `reading` or `TBR` that Alex never added to Goodreads **will not appear**. That is
expected and correct. **Absence from the CSV is not evidence a book should be removed or
demoted.** Leave those rows exactly as they are.

The reconciliation is one-directional: the CSV can promote a book to `read` and set its date. It
can never demote one.

---

## The procedure

### 1. Parse and count

Report the total rows and how many are on the Goodreads `read` shelf before changing anything.
Compare that count to the last run recorded in `RECONCILIATION-LOG.md` — the delta is roughly
how many new reads to expect.

### 2. Match on Goodreads ID, then title

```sql
SELECT "Goodreads ID" AS gid, Title, Shelf, "Date Read" AS dateRead, "Public?" AS pub
FROM "collection://f387f744-b4f6-46f8-83d4-22b60a9722c5"
```

Pull the whole catalog once and diff in memory rather than querying per row. Match on Goodreads
ID first; fall back to a normalised title match, and **flag every fallback match** — it usually
means Notion has a missing or wrong ID that needs fixing.

### 3. Sort each book into one of five buckets

| Bucket | Action |
| --- | --- |
| In CSV as read, in Notion as `read`, same date | Nothing. The majority |
| In CSV as read, in Notion as `read`, **different date** | Update Notion to the CSV date. Report the change |
| In CSV as read, in Notion as `reading` or `TBR` | **Flip to `read` and set Date Read.** The main event |
| In CSV as read, **not in Notion at all** | A new read. Add and enrich it per `ADD-BOOKS.md`, but `Shelf = read` with the CSV date |
| In Notion, **not in CSV** | Leave alone. Expected for `reading`/`TBR`. If it is on `read` with no CSV row, flag it — do not change it |

### 4. Fix Goodreads IDs, and the covers that follow them

If the CSV's ID differs from Notion's, the CSV is right. Update Notion — **and remember the
cover file is named `{Goodreads ID}.jpg`.** A corrected ID orphans the cover until the file is
renamed or the Worker's `/covers` route re-pushes it from Notion. Say so explicitly in the
report; this has bitten before.

### 5. Read back and verify

Query the changed rows and confirm the new shelf and dates actually landed. Do not report
success from the write call's return value.

### 6. Append to the log — every time, without exception

Add a dated entry to `RECONCILIATION-LOG.md`. This is how any future conversation knows when the
last pull happened and what state the catalog was left in. **Append; never rewrite history.**

```markdown
## 2026-08-15 — goodreads_library_export.csv (N books)

- **Read in CSV:** N
- **Promoted to `read`:** Title (date), Title (date)
- **Dates corrected:** Title (was → now)
- **New books added:** Title
- **Goodreads IDs corrected:** Title (old → new) — cover rename needed
- **Left as-is:** N on `reading`/`TBR`, absent from CSV as expected
- **Flagged:** anything that needs a human decision
```

Also update the "last pull" line at the top of that file, and mention the date in your response
so it is visible without opening anything.

### 7. Then remind Alex what has not happened yet

Reconciliation changes Notion. It does not change the site. The site updates when he clicks
`/sync` (or the nightly cron runs at 08:00 UTC) and Cloudflare Pages rebuilds.

---

## Why read dates are load-bearing

The connection graph's edge array is **positional** — rebuilt on every sync by sorting books by
Date Read ascending, undated last, Goodreads ID as tiebreaker. A wrong date silently reorders
that array. The rendered connections still resolve because they are read from `conn` (which is
ID-based), but the edge array feeding the force graph will be wrong.

This is why the CSV is worth running against, and why a guessed date is worse than a blank one.
