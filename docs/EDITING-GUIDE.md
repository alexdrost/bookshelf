# Where to change what

The three things you asked about — pairs, recommendations, and shelves — live in three
different places on purpose. This is the map.

---

## 1. Pairs worth reading together → `src/data/pairs.json`

**A file in the repo, not Notion.** A pair is a *relationship between two books* plus a sentence
you write. Notion has no property shaped like that, and adding one would mean a new relation table
for eighteen rows.

```json
{
  "pairs": [
    { "a": "59366216", "b": "113576",
      "_a": "Dear Chairman", "_b": "The Smartest Guys in the Room",
      "note": "Gramm's boardroom letters are the polite version of the fight; Enron is what happens when nobody sends one." }
  ]
}
```

- `a` and `b` are **Goodreads IDs** — the same join key as everywhere else
- `_a` / `_b` are ignored by the build. They exist so the file is readable by a human
- `note` is your sentence. Leave it empty and the pair renders without one
- **Order in the file is order on the page.** Delete a pair to drop it; add an object to add one
- A pair naming a book that isn't public is skipped rather than half-rendered

I seeded it with the 18 computed pairs and left every `note` blank, so you can rewrite the list
without starting from nothing.

## 2. Recommendations → `src/data/standouts.json`

Same idea, keyed by Goodreads ID:

```json
{ "standouts": { "113576": { "cluster": "business", "note": "The one that made me..." } } }
```

Anything with an entry gets a star on its library card and appears on `/recommendations`.
`clusters.json` defines the groupings the page organises them into.

**Why not Notion?** These are editorial notes about *why a book matters to you*, and the one
discipline the system has is that private prose never goes in an allowlisted property. A note
here is a note about the book, not part of the book's record.

If you'd rather drive it from Notion, the clean way is a `Recommended` checkbox plus a
`Recommendation Note` text property, both added to the Worker's allowlist. Say the word and it's
about twenty lines — but it does mean the note travels through Notion.

## 3. Shelves → Notion

This one **is** Notion, because it's a fact about the book.

`Shelf` (select) now has three values. Rename `currently-reading` to `reading` whenever you like
— **the build accepts both**, so there's no window where a sync during the rename empties the
page.

| Shelf value | Where it appears |
| --- | --- |
| `read` | Everything: library, themes, timeline, connections, its own page |
| `reading` *(or `currently-reading`)* | `/up-next` → "On the desk right now", large two-across cards |
| `TBR` | `/up-next` → "On deck", small grid, deliberately not clickable |

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
| Pairs on /connections | `src/data/pairs.json` | Order = page order |
| Recommendations | `src/data/standouts.json` | Plus `clusters.json` for groupings |
| Theme names, order, intro copy | `src/data/themes.json` | The 11 are locked |
| Page copy (about, up-next, recommendations) | `src/pages/*.md` | Markdown + front matter |
| Which themes appear on the connection matrix | `tools/build.mjs` → `MATRIX_EXCLUDE` | Theology & Faith is excluded |
| Books on the home shelf | `tools/build.mjs` → `recent` | Currently 24 |
