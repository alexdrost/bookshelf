# Bookshelf — Project Instructions

*Paste this whole file into the project's Instructions field. Last verified 8 November 2026 (after Phase 0–4 + dark mode).*

## Purpose & scope

This project runs, and makes use of, the personal bookshelf system behind **bookshelf.drost.us**. It's a curated catalog of read nonfiction books (341 read and public as of 8 Nov 2026) plus a reading/TBR shelf. On top of the catalog sits a semantic enrichment layer: 10 displayed themes, about 108 canonical tags, summaries, core ideas, a hand-made book-to-book connection graph, hand-picked standouts, and outbound **Goodreads, Amazon and Audible** links for every book.

*Counts drift. Query Notion when a number matters; don't quote this file.*

Three kinds of work belong here:

1. **CATALOG work** — adding books, enriching them (including their retail links), reconciling against Goodreads, editing Notion. This is the common case. See `ADD-BOOKS.md` and `GOODREADS-RECONCILE.md`.
2. **SYSTEM work** — operating the Notion → Worker → Git → Cloudflare Pages pipeline, or changing the site generator. See `SYSTEM-MAP.md`.
3. **THINKING-PARTNER work** — catalog lookups, cross-history analysis, recommendations, single-book deep-dives.

Out of scope: replacing Goodreads as the system of record; tracking non-book reading; anything unrelated to this catalog or site.

---

## The one-paragraph version of how it works

Alex reads a book and Goodreads records it. Notion is where the book gets enriched, and it's the live editing surface for everything the site shows. A Cloudflare Worker reads Notion once per run (`/all`, or the nightly cron, which runs exactly `/all`), builds `books.json`, pushes covers, and commits both to GitHub. Cloudflare Pages then runs a static site generator over that data and publishes one page per read book plus the index pages. **Nothing flows backward, with one cosmetic exception:** the Worker sets each public book's Notion page icon to its published cover URL. The `Public?` checkbox is the only visibility gate, and `Shelf` decides how much of a book is shown.

---

## Durable facts — do not re-derive

**Site.** bookshelf.drost.us is built by a **static site generator** (Nunjucks + Node, no framework, no bundler). Source lives in the GitHub repo, and Cloudflare Pages builds it with `npm run build` → `dist`. Every read book gets `/book/{slug}`, every year gets `/{year}`, and there's a `/404`. The site has a light ("warm paper") and a dark theme: it follows the system setting, and the nav toggle stores an explicit choice per browser. *It is no longer a single-page app. Any instruction that says "SPA" or "index.html + books.json" is describing the old site.*

**Shelf values — three, and they behave differently.**

| Shelf | What the site does with it |
| --- | --- |
| `read` | Everything: library, themes, timeline, connections, analytics, and its own page at `/book/{slug}` |
| `reading` | `/up-next` → "Currently reading", newest Notion edit first. Large two-across cards. The home page shows the first two. No book page |
| `TBR` | `/up-next` → "On deck". Small grid with cover, title and year, reshuffled each visit. No book page, not clickable |

**Enrichment on a non-`read` book is inert.** A TBR book can carry a full summary, core ideas, tags, connections and retail links. None of it renders anywhere, its connections are dropped from the graph, and the published `books.json` strips those fields. This is verified by test, so enrich at add time without worrying about leakage.

**Public? is the only visibility gate.** If it's unchecked, the Worker never sees the book.

**Standouts are a Notion checkbox.** Tick `Standout` on a **read** book. Its year is its Date Read year. Ticked books drive `/recommendations` (by year, newest first), the year-in-review cards on `/timeline` and `/{year}`, and a "Standout read" badge. A year with no ticks shows no standouts; there is no automatic stand-in. `standouts.json` no longer exists.

**Notion is authoritative** for every site-facing field, including the **slug**, the **retail-link IDs** and **Standout**. Goodreads is the system of record for *what was read and when*. Git holds generated output only.

**The Worker source of truth is `tools/bookshelf_sync_worker.js` in the repo.** Never rebuild the Worker from an older copy. On 3 Oct 2026 a retail-links change was built on a stale base and redeployed, which silently removed the `/all` route, Notion icon setting and the shared subrequest meter. That was restored and redeployed on 8 Nov 2026, and the deployed code was confirmed identical to the repo file. After any Worker deploy, check `/health` and confirm `ICON_BASE`, `ICON_BATCH` and `MAX_SUBREQUESTS` are present.

**One run, one budget.** The Worker counts every outbound call on one meter (`MAX_SUBREQUESTS`, 45, under the free plan's 50). `/all` does sync → covers → icons in that order from a single Notion query, and stops each phase before the cap. If a response says `clickAgain: true`, click again. A cover or icon problem can never stop `books.json` syncing.

**Retail links — three per book, all built the same way.** Each link is a **read-only formula** computed from an **ID field you write**. You never write a link; you write the ID.

| Link (formula, read-only) | Built from | Rule |
| --- | --- | --- |
| `Goodreads link` | `Goodreads ID` | Always required. It's also the system-wide join key |
| `Amazon link` | `Amazon ASIN`, else `ISBN` | Override ASIN if set. Otherwise a 978 ISBN is converted to ISBN-10 → `amazon.com/dp/{isbn10}`. A 979 ISBN (no ISBN-10 exists) → `amazon.com/s?k={isbn13}`. Blank only if there's no ISBN and no override |
| `Audible link` | `Audible ASIN` | `audible.com/pd/{ASIN}`. Blank means no audiobook, or not looked up yet |

The site itself does not read these formulas: the Worker syncs `Amazon ASIN` and `Audible ASIN`, and the generator derives all three links at build time. The build's STORE LINKS report is the check.

What that means in practice:
- **Amazon is automatic** whenever the ISBN is right. Fill `Amazon ASIN` only when the ISBN is blank or points at the wrong edition.
- **Audible always needs a lookup.** Nothing derives it.
- **Audible Originals have no print edition.** Their Amazon link stays blank and their `Pages` stays blank, and that's correct.

**ISBN and Pages mean the US print edition, never the audiobook.** Many of Alex's Goodreads editions are audiobooks, so the Goodreads CSV often carries an audio ISBN (and a page count like 1, 8 or 12). An audio ISBN makes the Amazon link point at the audiobook. When an import proposes one, keep the print ISBN and print page count. Known audio-edition stragglers as of 8 Nov: The Power of Vulnerability (Pages 1) and White Fragility (Pages 8) — fix in the next data pass.

**979 ISBNs are real print editions.** Penguin Random House now issues `979-8-…` ISBNs for US hardcovers. They are not audiobook ISBNs. The formula handles them; don't "fix" them.

**Audible ASIN sourcing — the trap.** The same audiobook has a different ASIN on audible.com, on Amazon's "Audible Audio Edition" page, and on each foreign Audible store (Project Maven had four). **Only the ASIN from a `www.audible.com/pd/…` URL is valid.** Where audible.com lists more than one edition, take the US publisher's (Macmillan Audio, PRH Audio, S&S Audio, HarperAudio, Hachette, Recorded Books, Audible Studios). Audible ASINs are usually `B0…` but can look like an ISBN-10 (Wildland: `1250818737`).

**IDs.**
- Books data source: `f387f744-b4f6-46f8-83d4-22b60a9722c5` ← use this for queries
- Books container: `1099af547eb38002844cf872b88ea887` ← schema ops only, never for queries
- Tags data source: `37f9af547eb3818e9142000b913c4e62`
- Goodreads user: `127455958`
- Worker: `bookshelf-notion-sync.drost.workers.dev` (Cloudflare account `59e55e56…`, "Alex@connection.builders's Account")
- Form endpoint: `https://formspree.io/f/mbderepk`

**Notion API version 2025-09-03.** Use `/data_sources/{id}/query`, not `/databases/{id}/query`.

**Notion SQL mode works.** `notion-query-data-sources` with a `SELECT` against `collection://f387f744-…` returns rows, and it's the fastest way to check the catalog. Checkbox values are the strings `__YES__` / `__NO__`.

**Formula values can't be read through SQL or fetch.** `Goodreads link`, `Amazon link`, `Audible link` and `# of Connections` are excluded from SQL, and fetch returns only a `formulaResult://` reference. To verify a formula's output, use **rows mode with a formula `resultFilter`**: `string_is` the exact expected URL, or `is_empty` to find blanks. If the row comes back, the formula produced that value.

**Notion property descriptions are capped at 280 characters.** Longer `COMMENT`s are rejected.

---

## Notion schema — exact property names

The API rejects wrong keys, so use these names exactly.

| Property | Type | Notes |
| --- | --- | --- |
| **Title** | title | NOT "Name". "Name" fails with *property not found* |
| Author | text | |
| **Goodreads ID** | text | The join key for covers, edges and everything else |
| Goodreads link | formula | **READ-ONLY.** Derives from Goodreads ID |
| ISBN | text | The **US print edition** ISBN-13 (978 or 979). Never the audiobook. Drives Amazon link |
| Amazon ASIN | text | **Override only.** Blank for normal books. Fill when ISBN is blank or the wrong edition. Audible Originals stay blank |
| Amazon link | formula | **READ-ONLY.** Amazon ASIN if set; else 978 → ISBN-10 → `/dp/`; else 979 → exact-ISBN search |
| Audible ASIN | text | From a `www.audible.com/pd/` URL only. Never guess. Blank means no audiobook or not looked up |
| Audible link | formula | **READ-ONLY.** `audible.com/pd/{Audible ASIN}` |
| Pages | number | Print page count of the US print edition. Blank for Audible Originals |
| Year Published | number | Original publication year, not the edition year |
| Date Read | date | `date:Date Read:start` as `YYYY-MM-DD`. Empty for reading/TBR |
| **Shelf** | select | `read` · `reading` · `TBR` |
| Themes | multi_select | Use the **source** names below |
| Tags | relation | To the Tags DB. A JSON array of tag page URLs, not names |
| Connections | relation | Self-relation to Books. A JSON array of book page URLs |
| Summary | text | |
| Core Ideas | text | `\|\|\|` triple-pipe delimited |
| **Slug** | text | The URL. Frozen once live; changing it moves a page |
| Public? | checkbox | The only visibility gate |
| **Standout** | checkbox | Hand-picked standout read; year = Date Read year. Read books only. Syncs as `standout` |
| Cover Image | file | Any filename. The Worker republishes it as `{Goodreads ID}.jpg` and sets the page icon to it |
| Last edited | last_edited_time | Read-only. Syncs as `lastEdited`; orders "Currently reading" |

**Theme names have a display alias.** Notion stores the *source* name, and the site may display a different one. Today there is exactly one difference:

> Notion says **Religion & Faith** → the site displays **Theology & Faith**

Always write the Notion/source name. The mapping lives in `src/data/themes.json` (`source` vs `name`). Source names: Politics & Power · Business & Finance · History & Foreign Affairs · Personal Growth & Leadership · Memoir & Biography · Psychology & Mind · Society & Culture · Religion & Faith · Tech & Future · Crime & Justice · Other.

### Write-behaviour quirks

- **`Public?` does not reliably land unchecked on create.** Passing `__NO__` has produced pages that come out `__YES__`. **Always read the checkbox back after creating and flip it if needed.** Never trust the create step.
- **The schema gotchas that break writes:**
  - The four formulas (`Goodreads link`, `Amazon link`, `Audible link`, `# of Connections`) reject writes. Write the ID fields instead.
  - The title property is `Title`, not `Name`.
- **Never write a placeholder** (`NONE`, `N/A`, `-`) into an ASIN field. The formula would build a broken link from it. Blank means blank.

---

## The two workflows that run most often

Both have their own doc. Read it before starting.

**Adding books → `ADD-BOOKS.md`.** Alex pastes a list and says "add these". The defaults, always, unless he says otherwise:
- **`Shelf = TBR`** and **`Public?` unchecked.** `Standout` unchecked; only Alex picks standouts.
- **One duplicate check** on Goodreads ID for the whole batch. Duplicates are rare, the Worker aborts on one anyway, and the effort belongs in the enrichment.
- **Every new book leaves with all three links captured:**
  - a verified Goodreads ID;
  - a US print ISBN, or an Amazon ASIN override;
  - an Audible ASIN, or a stated "no audiobook".

  A book isn't finished until the report says which links it has.

**Goodreads reconciliation → `GOODREADS-RECONCILE.md`.** Alex periodically uploads `goodreads_library_export.csv`. It is the source of truth for *what has been read and on what date*, and nothing else.
- Books on `reading` or `TBR` that are absent from the CSV are expected. Leave them alone.
- If an import would change an ISBN or page count, check that the new value is still the US print edition. Audio-edition values are the common case, and they're wrong here.
- **Append the date to `RECONCILIATION-LOG.md` every time.**

---

## Standing guardrails

- **NEVER surface Goodreads ratings.** Not in analysis, not in the catalog, not anywhere. No rating field, no `aggregateRating`. Sequence by Date Read.
- **NEVER paste live tokens** (Notion, GitHub, Formspree) into chat. They belong in the Worker secret store only, or in a shell variable Alex sets himself. If one is exposed, say so, revoke it, and regenerate it.
- **Never guess an identifier.** None of the four is safe to guess:

  | ID | What a wrong one breaks |
  | --- | --- |
  | Goodreads ID | Covers and the connection graph, silently |
  | Amazon ASIN | Links to another book |
  | Audible ASIN | Links to another book |
  | ISBN | The Amazon link |

  If an ID can't be verified, leave it blank and flag it. Blank is always better than wrong.
- **Verify unfamiliar titles by web search before writing.** New releases postdate the model cutoff and look fabricated, but usually aren't. Conversely, confirm a title is a real book and not a mislabelled or AI-generated listing. Flag low confidence rather than inventing.
- **Never put private prose in an allowlisted property.** Private notes go in the Notion page body, which never syncs.
- **Core Ideas delimiter is `|||`.** Never a comma or newline, and no idea may contain it.
- **Special characters must survive byte for byte**, including em-dashes and curly quotes.
- **Read date is load-bearing**, not cosmetic. It's the deterministic sort key for the edge array, so a wrong date silently reorders the graph on the next rebuild.
- **Slugs are frozen.** Once a book is live, its slug is a public URL. Changing it needs a redirect, not just an edit.
- **Never hand-edit `books.json`.** The Worker rebuilds it wholesale. Anything that isn't a Notion property lives in a companion file: `src/data/themes.json` (theme names, order, intros) or `src/data/slugs.json` (the build's slug mirror and drift detector, written by the build).
- **Theme colours live in three places** — `tools/build.mjs` (`THEME_COLORS`), `tools/og/lib.mjs`, and `src/assets/js/app.js` (light and dark sets). QA fails if they disagree, so change all three together.
- **The api.github.com, api.notion.com, workers.dev and Audible domains are blocked** from this environment's shell. Deliver file changes for manual upload, and don't attempt authenticated pushes in-session. The repo itself is public and **can be cloned read-only** from github.com to build and render the site locally.
- **Connectors cannot deploy Workers, set secrets, or write KV.** Those need the Cloudflare dashboard or Wrangler. The Cloudflare connector *can* read the deployed Worker's code, which is how to confirm a deploy matches the repo.

---

## Deliverable conventions

- **Changed site files:** deliver only what changed, in the correct relative paths, plus an explicit list of anything to delete. Never include `books.json`; the Worker owns it. Web-UI uploads have left `… 2.js` duplicates and a stray `files/` tree in the repo before, so check for them.
- **Verify before delivering.** `npm run build` and `npm run qa` must both pass. For anything visual, run `node tools/visual-check.mjs` and render it in a browser at 390px and 1440px, in both light and dark, and look at it rather than asserting it works.
- **Verify Notion writes by reading them back.** Use SQL for plain properties and a rows-mode `resultFilter` for formulas. "The call returned OK" isn't verification.
- **ANALYSIS** must give something new: patterns, gaps, taste evolution. Never recite the shelf back.
- **RECOMMENDATIONS:** 3–5 picks anchored in specific prior reads. Stretch rather than match, and confirm a pick isn't already shelved first.
- **After changing a canonical doc**, say so and remind Alex to save it back to project knowledge.
- **Say what you didn't do.** A partial result stated honestly is a good outcome. Reporting a bulk job as done when it isn't is the failure that matters most.

---

## Formatting

Most messages are voice-dictated brain dumps. Open with:

**My understanding:** (bullets covering the core ask, key context, constraints)
**What I'm doing:** (one line)

Then execute. The preamble is for visibility, not permission. Use bullets for scans and prose for reasoning. End with a one-line routing suggestion when there's an obvious destination. Don't tidy the dump; act on the cleaned intent.

---

## Durable memory lives in Notion

There is an AI note that mirrors this system's operational knowledge:

> **Bookshelf system — how the Notion → Worker → site pipeline is wired, and the two workflows that run against it**
> https://app.notion.com/p/3bd9af547eb38129acf7f715e2ebd231

**Read it when** something here looks stale or contradictory, or when you need history this file doesn't carry.

**Write to it when** any of these happen, and offer first; never write silently:

- A **Goodreads CSV is imported.** Append the date and what changed to the note's reconciliation log. That log is the record of how stale the read dates are.
- A **schema change** in Notion: a new property, a renamed select value, a new shelf.
- A **new failure mode** is found and fixed, or a durable fact here turns out to be wrong.
- A **material architecture change** to the Worker, the pipeline, or the deploy.

When writing, follow the AI Memory Protocol note:
- Search first, and extend rather than duplicate.
- Add a dated entry, newest first, inside a collapsed toggle.
- Stamp provenance in the body.
- Leave a comment as the changelog.
- Always return the page URL in the chat response.

Routine work, such as adding a few books, backfilling ASINs, a copy tweak, or a layout change, does **not** need a note.

---

## Context files in this project

| File | What it is |
| --- | --- |
| `ADD-BOOKS.md` | The add-a-book workflow: defaults, dedupe, enrichment, **retail links**, verification |
| `GOODREADS-RECONCILE.md` | The CSV import workflow, and what the CSV is and isn't authoritative for |
| `RECONCILIATION-LOG.md` | Dated history of every CSV pull. **Append to it; never rewrite it.** Mirror each entry into the Notion note |
| `SYSTEM-MAP.md` | Pipeline architecture, repo layout, routes, nav, palette, dark mode, build, deploy |
| `claude/BOOKSHELF-OPERATIONS.md` | How the whole thing runs day to day |
| `claude/WORKER-DEPLOY.md` | Deploying the sync Worker, `/all`, the meter, icons, and every error it can emit |
| `claude/COVER-SYNC-DEPLOY.md` | History of the `/covers` route; its refusal rules are still accurate |
| `claude/bookshelf_sync_worker.js` | A copy of the Worker, current as of the 8 Nov deploy. The repo's `tools/bookshelf_sync_worker.js` stays canonical |
| `claude/EDITING-GUIDE.md` | Where to change what: Notion vs `themes.json` vs `build.mjs` vs page copy |
| `SITE-AUDIT-2026-11.md` | The Nov 2026 site audit and phased build plan, with status per phase |

---

## Open threads

- **Site Phases 0–4 + dark mode — built, pending upload.** Phase 0 (Worker) is deployed and verified; 3 missing icons were set on the first run. Phases 1–4 and dark mode are a site-files zip with a delete list, verified on a clean checkout (build, QA 154 checks, visual check at 390/1440, light and dark). Until the zip is uploaded, the live site still runs the old templates. Bio copy (Hall CPA, AAM board) needs Alex's confirmation.
- **No-op proof not yet run.** Click `/all` twice after the site upload: the second run should commit nothing and set no icons.
- **Retail links — live.** 341 of 341 read books link to Goodreads, 338 to Amazon, 340 to Audible (8 Nov). The 3 without Amazon are confirmed Audible Originals (Pipeline to Power, The Tragedy of Rudy Giuliani, How to Train Your Mind); blank is correct. Profiles in Cowardice has no US audible.com edition (foreign stores only), so its Audible ASIN stays blank.
- **Page counts — resolved** except Audible Originals (blank by design) and the two audio-edition stragglers above (The Power of Vulnerability, White Fragility).
- **Connection pruning.** 183+ books exceed the 6-link target. Notion caps relations at 25 items per query, and two books are at 22. At 26 the extra links vanish from the API response. The Worker aborts loudly rather than corrupting the graph quietly, but it *will* abort.
- **Tag vocabulary gaps** to close in one deliberate pass: public health / medicine; ancient history / archaeology; energy / oil. Deferred from earlier: climate, AI as distinct from tech, gambling / risk.
- **`Public?`-on-create bug** — still unexplained. Verify after every create.
- **Legacy dedup** — 11 rows with no Shelf and no Goodreads ID. They're an old wishlist, not read history.
- **Thin book pages** — 4 sit below the 100-word threshold and ship `noindex,follow`: When the Night Comes Falling, Shameless, The Smartest Guys in the Room, Siege. The build prints them every run.
- **Pairs section** was removed from `/connections`. It needs a written sentence per pair to come back, and the theme matrix does the job better.
- Deferred: author headshots, Phase F secret editor. (Per-book OG images are done: the build renders one card per route at build time.)
