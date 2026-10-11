# Slugs in Notion — what I did, what you do, and how new books get one

Moving the slug into Notion is the right call and it retires the workaround I flagged in the
Session 1 report. The value is now editable by you, survives the nightly sync, and cannot be
silently regenerated from a corrected title.

---

## Done in Notion already

**1. Renamed `slug` → `Slug`.** You created it lowercase; every other property in the schema is
Title Case (`Title`, `Author`, `ISBN`, `Public?`, `Cover Image`…). The Notion API matches property
names **exactly** — my first write failed with *Property "Slug" not found… Did you mean "slug"?*
That is the same class of trap as `Title` vs `Name`. Renamed while the field was empty and unused,
so nothing had to be migrated.

**2. Wrote two slugs, to verify the format end to end** — `107-days` and `the-history-of-money`.
Both read back correctly. The write shape is:

```json
{"properties": {"Slug": {"rich_text": [{"type": "text", "text": {"content": "107-days"}}]}}}
```

**3. The other 318 are in `slug_map.csv` and `bookshelf_set_slugs.py`, not written yet.** The
connector writes one page per call — 318 calls is the wrong tool for a bulk backfill, and every
other bulk operation in this project already runs as a Colab script. Run it the same way you ran
the cover-setter: paste the token into `CONFIG`, run once with `DRY_RUN = True`, read the summary,
flip to `False`. It refuses to overwrite an existing slug, aborts on duplicates, and re-reads
everything afterwards to verify.

---

## You need to paste this (the API can't)

The Notion API's DDL supports `ADD` / `DROP` / `RENAME` / `ALTER COLUMN … SET <type>` but **not**
property descriptions — it rejected `DESCRIPTION` outright. So this has to go in by hand: open the
`Slug` property → *Edit property* → Description.

> The permanent URL segment for this book on bookshelf.drost.us (`/book/{slug}`). **Write once,
> then never change it** — it is data, not a derivation. Generated from the title segment before
> the first colon: lowercased, non-alphanumerics to hyphens, repeats collapsed, trimmed, truncated
> at 60 characters on a word boundary; articles and prepositions kept. On a collision the author's
> surname is appended, then the Goodreads ID. It lives here rather than in books.json so the
> nightly sync cannot erase it and a later title correction cannot silently move a live URL.
> Editing this changes a published URL and needs a 301 redirect. Leave it blank on a new book: the
> build assigns one, reports it, and it gets written back here.

---

## The Worker needs one line

`Slug` has to join the allowlist so it reaches `books.json`, next to the `Title` fix:

```js
slug: readProp(page.properties['Slug']),
```

Until that ships the build falls back to the local ledger and says so:

```
SLUG SOURCE
  from Notion ......... 0   (add Slug to the Worker allowlist so it reaches books.json)
  from local ledger ... 320
  generated this run .. 0
```

Once it lands that first line reads 320 and the ledger becomes a pure backup.

---

## How new books get a slug

The rule that matters: **a slug is assigned once and then frozen.** Everything else follows.

1. **Book is added to Notion** (CSV importer or by hand). `Slug` is left blank. `Public?` stays
   unchecked pending enrichment.
2. **Enrichment pass.** Alongside summary, core ideas, themes, tags and connections, generate the
   slug with the rules above and write it to `Slug`. Check it is not already taken — a duplicate
   would collide two book pages onto one URL. `slug_map.csv` is the current list.
3. **`Public?` gets checked**, the sync runs, and the slug arrives in `books.json`.
4. **The build is the safety net.** If a public book still has no slug, `tools/slugify.mjs`
   generates one, uses it, and prints it under `SLUGS WRITTEN THIS RUN`. Copy that value back into
   Notion so the two agree. The build never invents a slug for a book that already has one.
5. **Drift detection.** If a slug in Notion differs from the ledger, the build prints:

   ```
   !! 1 SLUG(S) CHANGED IN NOTION — these are live URLs that just moved
      222376657  the-history-of-money  ->  a-history-of-money   (needs a 301 from the old path)
   ```

   That is the guard against an accidental edit quietly breaking a published URL.

**Recommended:** add `Slug` to the enrichment checklist in the project instructions so it is
assigned at the same moment as everything else, and keep `slugs.json` committed as the backup —
it is what makes drift detection possible.

---

## Review these before the backfill

The slugs come from rule 1, "the segment before the first colon", which produces a few blunt
permanent URLs. All are legal and unique; editing `slug_map.csv` now is free, after the backfill it
needs a redirect.

| Slug | Book |
| --- | --- |
| `code-name` | Code Name: Pale Horse |
| `fear` | Fear: Trump in the White House |
| `war` | War |
| `drift` | Drift |
| `pure` | Pure: Inside the Evangelical Movement… |
| `rage` | Rage |
| `blowout` | Blowout |
| `abundance` | Abundance |
| `the-fall` | The Fall |
| `what-happened` | What Happened |

`code-name` is the one I would actually change — `code-name-pale-horse` is both clearer and still
rule-compliant if you allow the second segment. The rest are short because the books are.

---

## Two other things I noticed in Notion

**`Read Status` has been deleted.** It is gone from the schema. My Session 1 report said the richer
reading states (Want to Read, On Deck, Paused) lived there — that is no longer true, so §9's
reading-state migration now has no source at all. `/up-next` will keep rendering empty "Set aside"
and "Next up" sections until `Shelf` gains those options. Worth confirming that was deliberate.

**All 320 public books are now `Shelf = read`.** `books.json` still shows *Biological War* and
*Shameless* as currently-reading, so the committed data is behind Notion. Nothing to fix — the
build is fully data-driven and the next sync will produce 320 book pages instead of 318, an empty
"Currently reading" section, and 1,250 connection pairs instead of 1,238.
