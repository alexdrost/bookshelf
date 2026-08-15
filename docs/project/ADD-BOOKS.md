# Adding books to the shelf

**Trigger:** Alex pastes a list of books and says some version of *"add these to my shelf."*
The list may be bare titles, title + author, Goodreads links, or a screenshot.

**The two defaults, always, unless he says otherwise in that message:**

> **`Shelf = TBR`**  ·  **`Public?` unchecked**

He is telling you what he intends to read, not what he has read. A book only becomes `read`
through the Goodreads CSV (see `GOODREADS-RECONCILE.md`) or because he says so explicitly.

---

## Step 1 — One duplicate check, on Goodreads ID, for the whole batch

**Duplicates are rare. Do not spend effort hunting them.** One query covers the entire list:

```sql
SELECT "Goodreads ID" AS gid, Title, Shelf
FROM "collection://f387f744-b4f6-46f8-83d4-22b60a9722c5"
WHERE "Goodreads ID" IN ('12345', '67890', '…')
```

**Goodreads ID is the only check worth making.** It is the join key, so a duplicate ID is the
one that actually causes damage — two rows fighting over the same cover file and the same edges.
Title matching is not worth the effort: subtitles differ between editions, so it produces false
negatives on real duplicates and false positives on genuinely different books, and it costs a
search per title to get both wrong.

- **ID already present** → skip it, and say which shelf it is on.
- **ID not present** → add it.
- **No Goodreads ID could be verified** → nothing to check against. Add it, flag it, move on.

**There is a safety net downstream, so a missed duplicate is not a disaster.** The Worker's
validation gate refuses to commit on a duplicate Goodreads ID *or* a duplicate slug — it returns
HTTP 422 and touches nothing. A duplicate that slips past this step fails loudly at sync time
rather than corrupting the graph silently.

**The effort belongs in Step 3.** Getting the tags, connections and enrichment right is what
makes a book useful on the shelf. That is where the time should go.

## Step 2 — Verify the book is real, and get the Goodreads ID

**Web-search every unfamiliar title.** Two failure modes, opposite directions:

- A 2025–26 release postdates the model cutoff, looks invented, and is real.
- A plausible-sounding title is a mislabelled listing, an AI-generated book, or a title Alex
  half-remembered.

**Never guess the Goodreads ID.** It is the join key for the cover file, the connection graph
and the edge array. A wrong one corrupts all three silently. If it cannot be verified, **leave
it blank, add the book anyway, and flag it in your report** for the next CSV reconciliation.

## Step 3 — Enrich it fully, now

Do this even though it is going on TBR. Enrichment on a non-`read` book is completely inert —
it renders nowhere, its connections are dropped from the graph, and the published `books.json`
strips the fields. It costs nothing to have it ready, and it means the book is complete the
moment it flips to `read`.

| Field | What good looks like |
| --- | --- |
| Summary | 2–4 sentences. What the book argues, and how — not a blurb |
| Core Ideas | Exactly 3, joined by `\|\|\|`. Each a claim the book makes, not a topic |
| Themes | 1–2 from the locked list. Use the **Notion/source** name (`Religion & Faith`, not `Theology & Faith`) |
| Tags | Existing canonical tags where they fit. Set as **relations** — a JSON array of tag page URLs |
| Connections | Links to books already on the shelf. Relations — a JSON array of book page URLs |
| ISBN, Pages, Year Published | From the publisher edition, not a mangled CSV value |
| Slug | Lowercase, segment before the first colon, non-alphanumerics to hyphens, ≤60 chars |

**Connections are the point of this catalog.** A connection means something specific — this book
is the prequel to that one, refutes it, or describes the same mechanism in another domain. It
does **not** mean "both are about finance"; that is what a tag is for. Aim for 4–6. A book that
connects to nothing is usually a book that said nothing, and that is worth saying in the report
rather than padding the list.

**Private prose never goes in an allowlisted property.** If Alex says something personal about
why he wants to read it, that goes in the Notion **page body**, which never syncs.

## Step 4 — Create, then verify the checkbox

`Public?` **does not reliably land unchecked on create.** Passing `__NO__` has produced pages
that came out `__YES__`. This is not theoretical — it has happened.

So: create the page, then **read it back** and confirm `Public? = __NO__` and `Shelf = TBR`.
Flip anything that did not stick. Do this every time; it is two seconds and the failure mode is
a half-finished book appearing on a live site.

```sql
SELECT Title, Shelf, "Public?" AS pub, "Goodreads ID" AS gid, Slug
FROM "collection://f387f744-b4f6-46f8-83d4-22b60a9722c5"
WHERE "Goodreads ID" IN ('…', '…')
```

## Step 5 — Report

Say plainly:

- **Added** — title, shelf, and whether the Goodreads ID was verified
- **Skipped** — already present by Goodreads ID, and the shelf it is on
- **Needs attention** — no Goodreads ID found, couldn't verify the book exists, low-confidence
  enrichment, or fewer than 3 connections
- **Nothing is live yet.** Adding a book changes nothing on the site until Alex checks `Public?`
  and clicks `/sync`.

---

## Variations

**"Add these, I've already read them."** Then `Shelf = read` — but a read book needs a **Date
Read**, and that is the CSV's job. Ask for the date, or set the shelf and flag the missing date
for the next reconciliation. A read book with no date sorts last and is easy to miss.

**"Add this, I'm reading it now."** `Shelf = reading`. It appears on `/up-next` with a large
cover as soon as `Public?` is checked.

**"Add these and publish them."** Still verify the checkbox after — the bug cuts both ways.

**A cover.** Attach it to the Notion `Cover Image` property. Any filename; the Worker
republishes it as `{Goodreads ID}.jpg`. No cover means the site renders a themed placeholder,
which is fine and not worth blocking on.

---

## Batch them

Five books in one pass produces better connections than five separate passes, because they can
be seen against each other and not just against the back catalogue. If Alex sends a long list,
work the whole list before reporting.
