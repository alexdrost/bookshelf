# The title bug — diagnosis, fix, and verification

**Status: BLOCKING and not yet applied.** The Worker source (`bookshelf_sync_worker.js`) is
not in project knowledge and this session cannot deploy Workers, so SESSION 1 Step 0 could not
be closed here. Everything needed to close it in ten minutes is below.

---

## Confirmed, not assumed

Pulled from the live `books.json` Alex supplied on 9 Aug 2026:

```
books ......................... 320
books with a non-empty title ..   0
every other field ............. populated normally
```

Every one of the 320 records carries a correct author, ISBN, page count, summary, core ideas,
themes, tags, and connections. Only `title` is empty. That single-field pattern is the signature.

## Root cause

Confirmed against the live Notion schema (data source `f387f744-b4f6-46f8-83d4-22b60a9722c5`):

| Property | Notion type | Payload key |
| --- | --- | --- |
| **Title** | `title` | `title[]` |
| Author, Goodreads ID, ISBN, Summary, Core Ideas | `rich_text` | `rich_text[]` |
| Pages, Year Published | `number` | `number` |
| Shelf, Read Status | `select` | `select.name` |
| Themes | `multi_select` | `multi_select[]` |
| Tags, Connections | `relation` | `relation[]` |
| Public? | `checkbox` | `checkbox` |

`Title` is the **only** `title`-type property in the entire schema. Notion returns its content
under a `title` array, never under `rich_text`. A generic text accessor shaped like:

```js
const text = (p) => (p?.rich_text ?? []).map(r => r.plain_text).join('');
```

returns `''` for exactly this one property and behaves correctly for every other field. That
matches the observed damage precisely — nothing else to look for.

## The fix

Find the Worker's property accessor and dispatch on `type` instead of assuming `rich_text`:

```js
// Reads any Notion property value as a plain string. Dispatches on `type` because
// `title`-type properties return their content under `title`, not `rich_text` —
// Title is the only title-type property in this schema, so a rich_text-only
// accessor silently empties that one field and nothing else.
function readProp(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return (prop.title        ?? []).map(t => t.plain_text).join('').trim();
    case 'rich_text':    return (prop.rich_text    ?? []).map(t => t.plain_text).join('').trim();
    case 'number':       return prop.number == null ? '' : String(prop.number);
    case 'select':       return prop.select?.name ?? '';
    case 'multi_select': return (prop.multi_select ?? []).map(o => o.name);
    case 'checkbox':     return !!prop.checkbox;
    case 'date':         return prop.date?.start ?? '';
    case 'formula':      return prop.formula?.string ?? '';   // read-only, never written
    default:             return '';
  }
}
```

Then make sure the title is read through it:

```js
title: readProp(page.properties['Title']),
```

Two schema gotchas worth restating, because both break writes:

- the property is **`Title`**, not `Name`
- **`Goodreads link`** is a formula and is read-only — never write to it

## Add a guard so this cannot recur silently

The sync already has a validation gate and a `MIN_PUBLIC_BOOKS` floor. Add one more assertion
before the commit — a whole-field wipe should abort, not publish:

```js
const untitled = books.filter(b => !b.title).length;
if (untitled > 0) {
  throw new Error(`ABORT: ${untitled} of ${books.length} books have an empty title — refusing to commit.`);
}
```

That check would have caught this on the first bad run. The failure mode here was not that the
extractor broke; it was that a wholesale field wipe committed and deployed without complaint.

**Worth doing in the same edit:** raise `MIN_PUBLIC_BOOKS` to ~300 (it is a parked item in the
project notes, and ~320 books are now live). One deploy, both fixes.

## Verification

1. Run the sync manually: `/sync?key=SYNC_SECRET`.
2. Confirm the regenerated `books.json` has **320** non-empty titles — not 318. (318 is the
   `shelf: "read"` count; 2 books are `currently-reading`.)
3. Re-run `npm run build` in this repo. The report should print `titles recovered ...... 0`,
   which means the build read real titles from `books.json` and never touched the bridge file.
4. Delete `src/data/titles.recovery.txt` and rebuild once more. A clean build with the bridge
   gone is the definition of done for Step 0.

**Do not hand-patch titles into `books.json`.** The next sync overwrites the file wholesale.

## What unblocked SESSION 1 in the meantime

Titles were pulled straight from Notion (`Title` where `Public? = checked`, 320 rows, exact
1:1 match on Goodreads ID with zero duplicates) and written to `src/data/titles.recovery.txt`.

The build prefers `books.json`'s `title` and falls back to that file only when the field is
empty, so it self-retires the moment the Worker is fixed. It is a bridge, not a workaround —
nothing was written back into `books.json`.
