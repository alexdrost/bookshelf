# Where to change what

The three things you asked about — pairs, recommendations, and shelves — live in three
different places on purpose. This is the map.

---

## 1. Pairs worth reading together — REMOVED

This section is off the site. It was showing computed pairs with no explanation of why any
two books belonged together, which read as arbitrary — and the honest version needs a written
sentence per pair, which is work you have not chosen to do yet.

`src/data/pairs.json` is deleted along with it. If it comes back, the shape was: a list of
`{a, b, note}` objects keyed on Goodreads IDs, order in the file being order on the page.

What survives is better: **click any number in the theme matrix** and you get the real pairs
behind it — cover, title, author, both linked. Computed, but self-explaining, because the
number you clicked is the reason they are grouped.

## 2. Recommendations → Notion `Standout` checkbox

Since Nov 2026 a standout is a Notion checkbox, `Standout`, on a **read** book. Its year is the
Date Read year. Ticked books appear on `/recommendations` (standout reads by year, newest first),
on that year's review card on `/timeline` and the year page, and get a "Standout read" badge on
the book page and library card. A year with no ticks shows nothing — no automatic stand-in.

`standouts.json`, `clusters.json` and the hardcoded `STANDOUTS` list are gone. There are no
per-book recommendation notes: if those are ever wanted, they belong in a new Notion text
property added to the Worker's allowlist, never in the page body (which never syncs).

## 3. Shelves → Notion

This one **is** Notion, because it's a fact about the book.

`Shelf` (select) now has three values. Rename `currently-reading` to `reading` whenever you like
— **the build accepts both**, so there's no window where a sync during the rename empties the
page.

| Shelf value | Where it appears |
| --- | --- |
| `read` | Everything: library, themes, timeline, connections, its own page |
| `reading` *(or `currently-reading`)* | `/up-next` → "Currently reading", newest Notion edit first; the home page shows the first two |
| `TBR` | `/up-next` → "On deck", small grid, reshuffled on every visit, deliberately not clickable |

Books that aren't `read` get **no book page**, so nothing on those two sections links anywhere.
That's why the TBR cards don't change colour on hover — the card lifts its border instead, which
says "this is a thing" without promising a click that doesn't exist.

**Suggested Notion property description for `Shelf`:**

> Where the book is right now. `read` = finished; it gets a full page on the site.
> `reading` = in progress; appears at the top of /up-next with a large cover.
> `TBR` = queued; appears in the "On deck" grid, cover and title only.
> Only `read` books get a page, connections, or a slug that matters.

---

## Everything else, in one table

| Thing | Where | Notes |
| --- | --- | --- |
| Title, author, ISBN, pages, year, dates | Notion | Worker syncs it |
| Summary, core ideas, themes, tags, connections | Notion | Core ideas are `\|\|\|` delimited |
| Slug | Notion | Frozen once live — changing it moves a URL |
| Cover | Notion `Cover Image` | Any filename; lands as `{Goodreads ID}.jpg` |
| Public on the site | Notion `Public?` | The only visibility gate |
| Recommendations / standouts | Notion `Standout` | Read books only; year = Date Read year |
| Theme names, order, intro copy | `src/data/themes.json` | The 11 are locked |
| Page copy (about, up-next, recommendations) | `src/pages/*.md` | Markdown + front matter. The About bio is the `bio:` line |
| Which themes appear on the connection matrix | `tools/build.mjs` → `MATRIX_EXCLUDE` | Theology & Faith is excluded |
| Books on the home shelf | `tools/build.mjs` → `recent` | 24 from book 2 (book 1 is the feature card); 12 on a phone |
| Nav items and the Explore menu | `tools/build.mjs` → `NAV` | `mobileOnly` keeps an item out of the desktop bar |
| Theme colours | `tools/build.mjs` → `THEME_COLORS` | Copies in `tools/og/lib.mjs` and `app.js` (+ `THEME_COLORS_DARK`); QA checks all three |
