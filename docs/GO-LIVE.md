# bookshelf.drost.us — where the build stands, and what's left to ship

**Status: deployable.** The two mechanical blockers from the last pass are gone — the covers are
staged and `share.png` is in the repo. `books.json` now mirrors Notion exactly, every slug comes
from Notion, and the sync Worker has been rewritten. What remains is one Cloudflare configuration
step, one Worker deploy, and a short list of editorial work that the site ships fine without.

---

## Where the build is

| | |
| --- | --- |
| **362 URLs** | 361 routes + `/404` |
| | 1 home · 4 identity pages · 14 library · 1 themes hub + 10 themes · 1 timeline + 7 years · 1 connections · 1 analytics · **321 book pages** |
| **331 in the sitemap** | 30 thin book pages carry `noindex,follow` and are excluded |
| **291 of 321 book pages indexable** | |
| **1,256 connections** | unique undirected pairs across public + read books |
| **330 covers staged** | all 321 books have one · 5 held for currently-reading books · 4 stale |
| **QA** | 87 checks, all green |
| **Runtime** | 15 page types × 390px and 1440px — zero console errors, zero horizontal overflow |
| **No-JS** | `/connections` serves 1,258 words + a 100-cell matrix; `/library` serves 24 cards + real pagination |
| **Build size** | 29 MB in `dist/`, 18 MB of it covers |

Verified rather than assumed: the CSS extraction renders pixel-identical; a second slug pass writes
nothing; every connection resolves; one-way pairs appear on both books; the Person `@id` is
identical across every page; no rating field exists anywhere; and every `/covers/` reference in the
built output resolves to a file that exists.

---

## What changed since the last go-live doc

**Covers are complete.** 330 files in `src/covers/`, copied into `dist/covers/` by the build. All
321 books have one — including `250673180.jpg`, the corrected Regime Change ID that had been an
active gap since 25 July, and `220341389.jpg` for *Everything Is Tuberculosis*, the last one
outstanding. `missing covers ...... 0`.

**`books.json` mirrors Notion.** Notion holds 321 rows that are `Public? = yes` **and**
`Shelf = read`; `books.json` holds exactly those 321. Titles are real, all 321 slugs come from
Notion, and 2,431 edges were rebuilt from `conn`. Five currently-reading books are held back —
unchecked in Notion, so the site doesn't show them:

> Blood and Oil · 1177 B.C. · The Nvidia Way · Scaling Up · Separation of Church and Hate

Their covers are already staged, so they'll render the moment you check the box. *Biological War*
and *Shameless* have flipped to read and are live.

**Your ten slug edits were adopted verbatim.** Notion is the source; the local ledger is a backup
and a drift detector. `a-short-history-of-reconstruction`, `all-the-presidents-men`, `blowback`,
`cant-hurt-me`, `happiness-hbr-emotional-intelligence`, `how-to-win-client-business`,
`it-is-even-worse-than-it-looks`, `the-despots-apprentice`, `the-last-of-the-presidents-men`,
`the-original-watergate-stories`.

**`share.png` is generated, not drawn.** `tools/make-og.mjs` builds the card from `books.json`, so
the "RECENTLY READ" label stays true instead of quietly ageing. Re-run it after any sync. It
currently shows Dear Chairman, The History of Money, Shameless, and Biological War — all four
verified against the catalog. The design is your layout; only the data binding changed.

**The Worker was rewritten** — see `WORKER-DEPLOY.md`. Title fix, `Slug` in the allowlist, a
validation gate, `MIN_PUBLIC_BOOKS` at 300, and two GitHub-layer bugs that testing caught before
deployment rather than after.

---

## Blocking — two steps, both about twenty minutes

### 1. Deploy the new Worker — `WORKER-DEPLOY.md`

Paste `tools/bookshelf_sync_worker.js` in whole, set five vars and three secrets, then verify with
`/health` → `/sync?dry=1` → `/sync`. The dry run should report `books: 321, withSlug: 321`.

One thing not to skip: the **old Worker's cron still fires nightly at 08:00 UTC**. Replace the code
in place, or disable the old Worker. Two Workers writing the same file is how you get a good
`books.json` overwritten with empty titles at 3am.

### 2. Point Cloudflare Pages at the build

The site is no longer a single file you upload:

```
Build command:      npm run build
Output directory:   dist
Node version:       20 or later
```

Uploading `index.html` on its own now ships an unstyled, JS-less page — it depends on `/styles/`,
`/assets/`, and `/data/`.

---

## Worth doing before launch, but not blocking

### 3. Tidy `/covers/` — four dead files

`199798606.jpg` (the pre-correction Regime Change ID) plus `22299976.jpg`, `23723799.jpg` and
`30653985.jpg`, none of which match any row in Notion. Delete them. The other five extras belong to
the currently-reading books and are worth keeping so those pages render the instant you publish
them.

### 4. Paste the `Slug` property description

Text is in `SLUG-PLAN.md`. Notion's API rejects `DESCRIPTION` in its DDL, so this is UI-only.
Thirty seconds, and it's what stops someone editing a slug in six months without realising they've
moved a live URL.

### 5. Skim the slugs while changes are still free

321 URLs freeze the moment you deploy; after that a change is a redirect. Your ten edits closed
most of what I'd have flagged. Two remain, and both belong to books that aren't public yet — so
they're free to change and there's no rush:

- **`1177-b-c`** — rule-correct (periods become hyphens) but ugly. `1177-bc` reads better.
- **`separation-of-church-and-hate`** — fine, just long. No change needed.

The blunt ones that are live (`fear`, `war`, `drift`, `pure`, `rage`, `blowout`, `debt`, `siege`,
`hoax`) are short because the books are. I'd leave them.

---

## Editorial — the visible gaps, all post-launch

### 6. Featured connection pairs

`/connections` ships 18 pairs chosen by shared themes and tags, with a line on the page saying the
hand-written notes are still to come. The module is built — replacing the fallback is writing
15–20 sentences, not code.

### 7. Standout notes

`standouts.json` is empty, so `/picks` renders the 12 standouts already hand-curated in your SPA
and no book page shows a pull-quote. Populate it and both surfaces fill from one source.

### 8. The enrichment worklist — 30 pages

Thirty book pages sit below the 100-word threshold. They generate, stay linked, and pass
`noindex,follow` so their outbound links still flow — they're just not indexed. The build prints
all 30 ascending with word counts and URLs. The thinnest:

```
 64w  Content Inc.                             /book/content-inc
 66w  A Short History of Reconstruction        /book/a-short-history-of-reconstruction
 74w  Competitive Strategy                     /book/competitive-strategy
 76w  The 7 Habits of Highly Effective People  /book/the-7-habits-of-highly-effective-people
 78w  Building a Second Brain · The Body Keeps the Score
```

Closing all 30 to the 150-word target is ~8,274 words. A further 260 pages sit between 100 and 150
words — indexed, just thin. Raising the threshold later is one line (`TARGET_THRESHOLD` in
`tools/validate.mjs`).

---

## Known and expected, no action needed

- **`/up-next` will look thin.** `Shelf` only offers `read` and `currently-reading`, so there's no
  source for "Set aside" or "Next up". Those sections render honest empty states. Add the values to
  `Shelf` in Notion when you want them populated.
- **11 Legacy/wishlist rows have no slug**, deliberately — no Goodreads ID, and several duplicate
  books already in the catalog. They need a dedup pass, not slugs.
- **8 books report `pages: 0` and 4 have no ISBN.** The build treats zero as missing and omits
  `numberOfPages` from the schema rather than publishing a false one.
- **3 books have no read date.** They sort last, by design.

---

## Suggested order

1. Deploy the Worker; verify `/health`, then `/sync?dry=1`, then `/sync`
2. `npm run build && npm run qa` — confirm `from Notion 321` and `titles recovered 0`, then delete
   `src/data/titles.recovery.txt`
3. Configure Cloudflare Pages, deploy to a preview URL, click through on a phone
4. Paste the Slug property description; delete the four dead cover files
5. Go live, submit the sitemap
6. Featured pairs, standout notes, and the 30 thin pages — after launch, at your pace

**On submission:** ship the sitemap complete, but expect indexation over weeks. 321 new URLs
arriving at once on a domain with little accumulated authority produces slow, partial discovery.
Partial indexing in the first fortnight is normal, not a bug.
