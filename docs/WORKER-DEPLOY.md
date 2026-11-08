# Deploying the sync Worker — exact steps

**Source: `tools/bookshelf_sync_worker.js` in the repo. It is the only canonical copy.** This doc
no longer embeds the source: the copy that used to live in §9 went stale, and on 3 Oct 2026 a
change built on a stale base silently removed `/all`, Notion icon setting and the shared
subrequest meter. Paste the repo file, whole, every time.

Everything below is dashboard-only; no Wrangler, no terminal. Connectors can't deploy Workers or
set secrets.

*Last updated 8 Nov 2026 (Phase 0: icons, `/all`, one shared meter, `lastEdited`, `standout`).*

---

## 0. The Nov 2026 redeploy — do exactly this

1. **Note the current version** under **Workers & Pages → bookshelf-notion-sync → Deployments**.
   That's your rollback (§9).
2. **Paste** — **Edit code** → select all → delete → paste `tools/bookshelf_sync_worker.js` →
   **Deploy**.
3. **`/health`** (no key):
   `https://bookshelf-notion-sync.drost.workers.dev/health`
   - `vars` must now list `ICON_BASE`, `ICON_BATCH`, `MAX_SUBREQUESTS`. If they're missing, the
     paste didn't land. They'll read `… (default)`, which is fine: the defaults are the right
     values and you don't need to add them.
   - **Every other var must still hold its real value.** A code-editor deploy can wipe plain-text
     vars while secrets survive. Check these four especially, because their defaults are wrong for
     the live site:
     `BOOKS_PATH` = `src/data/books.json`, `COVERS_PATH` = `src/covers`,
     `DATA_SOURCE_ID` = `f387f744-b4f6-46f8-83d4-22b60a9722c5`,
     `TAGS_DATA_SOURCE_ID` = `37f9af547eb3818e9142000b913c4e62`.
     Anything reading `null` or `(default)` there: re-add it (§4) and redeploy before going on.
   - All three `secrets` must be `true`.
4. **Dry run** — `/all?key=…&dry=1`. Writes nothing.
   - `sync.ok: true`, `sync.errors: []`, `sync.books` ≈ 381.
   - `sync.standouts: 0` (no `Standout` property yet), `sync.currentlyReading` = the reading-shelf
     count (3 today).
   - **Read `wouldSetIcon`.** Expect about 10 lines of the form
     `75293505 -> https://bookshelf.drost.us/covers/75293505.jpg`, including *The Nerd Reich*. Any
     line pointing at a book you don't expect: stop.
   - `projectedSubrequests` ≲ 20.
5. **Run it** — `/all?key=…`. Expect `committed: true` (the two new fields reach `books.json` for
   the first time, so Pages rebuilds once), `iconsSet` ≈ 10, `iconsRemaining: 0`,
   `clickAgain: false`, `subrequests` ≈ 19. If `clickAgain: true`, click again until it's false.
   - `iconsBlocked` present → see §9; the code is fine and the Notion integration lacks a
     capability.
6. **Verify in Notion** — *The Nerd Reich* now shows its cover as the page icon.
7. **Re-run `/all` twice.**
   - The first re-run says `iconsSet: 0` and **`committed: true`**. That's expected: setting an
     icon bumps the page's `last_edited_time`, and `books.json` now carries it as `lastEdited`, so
     the sync after an icon write commits once more.
   - The second re-run must say **`iconsSet: 0` and `committed: false`**. That's the no-op proof.
     If it still commits, something is non-deterministic — stop and look.
8. **Tell the build chat it's verified**, so Phase 1 can start.

---

## 1. Routes

| Route | Key | What it does |
| --- | --- | --- |
| `/all?key=…[&dry=1]` | yes | Sync, then covers, then icons, on **one** meter and one Notion query. The one to click |
| `/sync?key=…[&dry=1]` | yes | `books.json` only |
| `/covers?key=…[&dry=1]` | yes | Covers, then icons |
| `/health` | no | Config echo. No writes, no outbound calls |
| cron `0 8 * * *` | — | Exactly `/all` |

Optional on `/all` and `/covers`: `force=<goodreadsId>` (re-push one cover), `limit=<n>` (covers
this run), `iconLimit=<n>` (icons this run), `icons=0` (skip the icon phase).

**`/all` response, top level** (the full `sync` and `covers` reports are nested underneath):

| Field | Meaning |
| --- | --- |
| `committed` | `books.json` was written this run |
| `coversCommitted` / `coversRemaining` | Cover files written / still to do |
| `iconsSet` / `iconsRemaining` | Notion icons set / still to do |
| `iconsBlocked` | Present only when Notion refused icon writes outright (401/403/429) |
| `clickAgain` | `true` while covers or icons remain and clicking would clear them. Always `false` on a dry run |
| `subrequests` / `subrequestCap` | Meter reading for the whole invocation |
| `wouldSetIcon`, `projectedSubrequests` | Dry run only |

HTTP status: 200 when both halves are `ok`; 422 when the sync's validation gate aborted (covers and
icons still ran); 500 on an exception.

---

## 2. Pre-flight — three things in hand

**a. Notion internal integration token.** Shared with **both** databases, Books and Tags. If it
only has Books, tags resolve to empty strings and every book loses its tags silently.
**Capabilities:** *Read content* and **Update content**. The icon write needs *Update content*;
without it the icon phase stops with `iconsBlocked` and nothing else is affected.

**b. GitHub fine-grained personal access token.** Repository access: **only**
`alexdrost/bookshelf`. Permissions: **Contents → Read and write**. Nothing else.

**c. A sync secret.** Any long random string. It gates `/all`, `/sync` and `/covers`.

> **Never paste any of these into a chat, a doc, or a commit.** They go in the Worker's secret store
> and nowhere else. If one gets exposed: say so, revoke, regenerate.

---

## 3. Paste the code

1. Cloudflare dashboard → **Workers & Pages** → **bookshelf-notion-sync** → **Edit code**
2. Select all, delete, paste `tools/bookshelf_sync_worker.js` in whole → **Deploy**

Edit the existing Worker rather than making a new one: it keeps the URL, the cron and the
bindings, and the old code stops the moment you deploy. Two Workers writing the same file is how a
good `books.json` gets overwritten at 3am.

**Then always check `/health` (§7).**

---

## 4. Variables

**Settings** → **Variables and Secrets** → **Add** → type **Text**.

| Variable | Value | If unset |
| --- | --- | --- |
| `DATA_SOURCE_ID` | `f387f744-b4f6-46f8-83d4-22b60a9722c5` | Every query fails |
| `TAGS_DATA_SOURCE_ID` | `37f9af547eb3818e9142000b913c4e62` | Every query fails |
| `GITHUB_REPO` | `alexdrost/bookshelf` | Every GitHub call fails |
| `GITHUB_BRANCH` | `main` | `main` |
| `BOOKS_PATH` | `src/data/books.json` | `books.json` at the repo root — **wrong for the live site** |
| `COVERS_PATH` | `src/covers` | `covers` at the repo root — **wrong for the live site** |
| `COVER_BATCH` | `15` | 15 |
| `ICON_BASE` | — (leave unset) | `https://bookshelf.drost.us/covers` |
| `ICON_BATCH` | — (leave unset) | 30 |
| `MAX_SUBREQUESTS` | — (leave unset) | 45 |

`DATA_SOURCE_ID` is the **data source** ID, not the container ID
(`1099af547eb38002844cf872b88ea887`). The container returns 404 on every query.

The three new vars are deliberately optional: their defaults are correct, so a var wipe can't break
icons. Set `MAX_SUBREQUESTS` higher only on a paid Workers plan (the platform cap there is far above
50), and then `COVER_BATCH` / `ICON_BATCH` can rise with it.

---

## 5. Secrets

Same panel, **Add** → type **Secret**: `NOTION_TOKEN`, `GITHUB_TOKEN`, `SYNC_SECRET`.

Secrets are write-only once saved, which is why `/health` reports them as `true`/`false`.

---

## 6. Cron

**Settings** → **Triggers** → **Cron Triggers**: `0 8 * * *` (08:00 UTC nightly). It runs exactly
what `/all` runs, on one meter. Logs (`nightly all`, `nightly sync`, `nightly covers+icons`) are
under the Worker's **Logs** tab.

---

## 7. Verify — the gates

### Gate 1 — `/health`

```
https://bookshelf-notion-sync.drost.workers.dev/health
```

Expected:

```json
{
  "ok": true,
  "notionVersion": "2025-09-03",
  "minPublicBooks": 300,
  "routes": ["/all", "/sync", "/covers", "/health"],
  "secrets": { "NOTION_TOKEN": true, "GITHUB_TOKEN": true, "SYNC_SECRET": true },
  "vars": {
    "DATA_SOURCE_ID": "f387f744-b4f6-46f8-83d4-22b60a9722c5",
    "TAGS_DATA_SOURCE_ID": "37f9af547eb3818e9142000b913c4e62",
    "GITHUB_REPO": "alexdrost/bookshelf",
    "GITHUB_BRANCH": "main",
    "BOOKS_PATH": "src/data/books.json",
    "COVERS_PATH": "src/covers",
    "COVER_BATCH": "15",
    "ICON_BASE": "https://bookshelf.drost.us/covers (default)",
    "ICON_BATCH": "30 (default)",
    "MAX_SUBREQUESTS": "45 (default)"
  }
}
```

- No `ICON_BASE` / `ICON_BATCH` / `MAX_SUBREQUESTS` at all → old code is deployed.
- Any `false` under `secrets` → a secret didn't save.
- `null`, a typo, or `(default)` on `BOOKS_PATH` / `COVERS_PATH` → a var was wiped. Fix before
  going on.

### Gate 2 — `/all?key=…&dry=1`

Full Notion read, full validation, repo listing. **No commit, no image fetch, no Notion write.**
Read `sync.errors` (must be `[]`), `covers.wouldWrite` and `wouldSetIcon`.

A `422` is the validation gate doing its job, not a broken deploy. §9 maps every message.

### Gate 3 — `/all?key=…`

Click until `clickAgain: false`.

### Gate 4 — the no-op

Run `/all` again until it returns `committed: false`, `coversCommitted: 0`, `iconsSet: 0`. After a
run that set icons, the first re-run commits once (the `lastEdited` bump, §11); the one after that
must be the no-op.

---

## 8. The subrequest budget

Cloudflare's free plan allows **50 outbound requests per invocation**. The Worker budgets against
`MAX_SUBREQUESTS` (45) with **one meter per invocation**: every outbound `fetch` goes through
`mfetch(meter, …)`, which refuses to run without a meter and refuses any call past the cap, so the
Worker stops itself with a clear message before the platform kills it with an opaque one.

**Cost of each step** (≈381 public books, ≈108 tags):

| Step | Calls |
| --- | --- |
| Notion books query (100 per page) | 4 — shared by sync and covers in `/all` and the cron |
| Notion tags query | 2 |
| `books.json` GET (+ PUT when changed) | 1–2 |
| Covers directory listing | 1 |
| Each cover (image fetch + GitHub PUT) | 2 |
| Each icon (Notion PATCH) | 1 |

**Order and priority.** Sync first, so the catalogue always gets first claim. Covers take what they
need up to `COVER_BATCH`, while 2 calls of headroom (`SPARE`) remain. Icons take whatever is left,
up to `ICON_BATCH`, less the same headroom. Anything that doesn't fit is reported as remaining and
`clickAgain` goes `true`.

**Worst case — 15 covers queued, 30+ icons queued, `books.json` changed** (tested):

```
books query 4 + tags 2 + books.json GET 1 + PUT 1     =  8
covers listing                                         =  1   ->  9
15 covers x 2                                          = 30   -> 39
icons: room = 45 - 39 - 2 spare = 4                    =  4   -> 43
                                                 total = 43  <= 45
```

The 26+ icons that didn't fit go out on the next click: with no covers left and `books.json`
unchanged, that run is `4 + 2 + 1 + 1 = 8`, room `45 − 8 − 2 = 35`, capped at `ICON_BATCH` 30 →
38 calls.

**The bug this fixes.** Before, sync and covers each assumed the full budget. On a night with a real
cover backlog, the cron asked for more than 50 and died partway through, silently.

---

## 9. If something goes wrong

### Rollback — about 30 seconds

**Deployments** → **Promote deployment** on the version you noted. Rolling back the Worker does
**not** roll back `books.json` or covers; revert those commits in GitHub separately. It does not
undo icons either, and doesn't need to: an icon is cosmetic.

### Every error this Worker can produce

| Message | What happened | Fix |
| --- | --- | --- |
| `401 {"error":"unauthorized"}` | `key=` doesn't match `SYNC_SECRET` | Check for a trailing space or a URL-encoded character |
| `Notion 404 on <id>` | `DATA_SOURCE_ID` is the container ID, or the integration isn't shared with that DB | Use the data-source ID; check **Connections** on the database |
| `Notion 401` | Token wrong, revoked, or from another workspace | Regenerate; re-share both DBs |
| `N of M books have an empty title` | The title regression is back | You're on old code — confirm the deploy landed |
| `only N public books, floor is 300` | Fewer than 300 rows are `Public?`-checked | Almost certainly a Notion filter/view mistake |
| `duplicate Slug "x"` | Two books share a URL | Fix in Notion |
| `duplicate Goodreads ID` | Same book twice | Usually a Legacy row duplicating a real one |
| `has theme "X" outside the locked list` | A theme outside the 11 | Fix in Notion |
| `has zero themes` | Unenriched row got published | Enrich it or uncheck `Public?` |
| `summary contains the core-ideas delimiter` | A `\|\|\|` leaked into Summary | Remove it |
| `N dangling connection refs` | A connection points at a page with no Goodreads ID | Set the ID on the target, or remove the link |
| `hit Notion's 25-item relation cap` | A book has >25 connections | Prune that book's connections |
| `GitHub read 401` / `write 401` | PAT wrong, expired, or lacks Contents | Regenerate fine-grained, `Contents: Read and write`, that repo only |
| `GitHub write 404` | `GITHUB_REPO` / `GITHUB_BRANCH` wrong, or PAT not scoped to the repo | Check `/health` |
| `GitHub write 409` | Someone committed between the read and the write | Run again |
| `subrequest budget spent (n/45)` | A phase tried to go past `MAX_SUBREQUESTS` | Shouldn't happen — the phases plan against the meter. Report it with the full response |
| `N cover(s) deferred — subrequest budget` (warning) | Covers didn't all fit this run | Click again |
| `iconsBlocked: "…(403)… 'Update content' capability"` | Notion refused the icon write | Notion → Settings → Integrations → this integration → Capabilities → tick **Update content** |
| `iconsBlocked: "…(401)…"` | Token rejected on the write | Same as `Notion 401` |
| `iconsBlocked: "…(429)…"` | Notion rate limit | Wait a minute and click again |
| `icon <gid> "…": Notion <status>` (warning) | One page's icon write failed | Warnings never fail the run; it retries next run |
| `"<gid>" "…": no Goodreads ID — skipped for covers and icons` (warning) | A public page with no join key | Set the Goodreads ID |

`ok: false` with a populated `sync.errors` array **always** means `books.json` was not committed.
An icon problem never sets `ok: false`.

---

## 10. Icons — how they work

- **The only write to Notion anywhere in the Worker** is `PATCH /v1/pages/{id}` with
  `{ icon: { type: 'external', external: { url } } }`. No property, no page body.
- **Wanted icon** for a book is `${ICON_BASE}/${goodreadsId}.jpg`, the cover the site already
  publishes.
- **A page becomes an icon candidate** when its cover is in the repo and its current icon isn't
  exactly that external URL. The current icon comes from the query result's page object, at zero
  extra calls. An emoji or uploaded icon counts as "not the wanted URL" and gets replaced.
- **A cover written this run queues its icon** ahead of the existing backlog. A book with no cover
  in the repo gets no icon until the cover lands.
- **`Public?` is still the gate.** Only public pages are queried. A page with no Goodreads ID is
  skipped with a warning.
- **A forced cover replacement (`force=`) keeps the same URL**, so the icon isn't re-set. Notion may
  show the old image from its cache for a while.

---

## 11. Behaviour worth knowing before it surprises you

- **Two new fields in `books.json`:**
  - `lastEdited` — the page's `last_edited_time` (ISO). Any edit to the page bumps it, including
    the Worker's own icon PATCH and edits to the private page body. So: the sync after an icon is
    set commits once more, and a body-only edit now produces one commit and one Pages build on the
    next sync. Both are expected.
  - `standout` — the `Standout` checkbox; `false` until the property exists. **The build already
    reads `book.standout`:** `book.njk` shows a "Standout read" badge on any book page where it's
    true. Ticking boxes before Phase 1 ships therefore shows that badge immediately.
  - Both pass `tools/validate.mjs` and the build untouched, and the published `dist/books.json`
    carries them. With `standout` all `false`, the built HTML is identical to before.
- **`Public?` is enforced at the source.** The Notion query filters on the checkbox, so an
  unpublished book can't reach the file even by accident.
- **A connection to a non-public book resolves to nothing and is dropped.** A connection to a page
  with no Goodreads ID is a dangling ref and aborts.
- **`edges` are positional and rebuilt every sync**, sorted by Date Read ascending, undated last,
  Goodreads ID as tiebreaker. A wrong read date silently reorders the array.
- **An unchanged sync is a genuine no-op.** The git blob SHA of the new file is compared with the
  one GitHub returns; equal means no PUT and no Pages build.
- **One cosmetic write flows backward:** the page icon. Nothing else in Notion is ever modified.

---

## 12. History

- **Nov 2026.** Re-implemented the lost 13 Sep design: icons, `/all`, one shared meter, the cron
  chained on that meter. Added `lastEdited` and `standout`. Fixed the `currentlyReading` report
  count, which looked for the retired `currently-reading` value and always said 0. `/sync` and
  `/covers` behave as before apart from metering, and `/covers` now sets icons too.
- **3 Oct 2026.** Amazon/Audible ASINs added, built on a pre-13-Sep copy. That redeploy is what
  removed `/all`, icons and the meter.
- **13 Sep 2026.** `/all`, icon setting, the shared meter. Never saved to the repo, which is the
  root cause of the regression.
- **Aug 2026.**
  - *Title wipe:* `readProp()` now dispatches on property **type**. `Title` is the only
    `title`-type property; an accessor that only read `rich_text` emptied exactly that field.
  - *`Slug`* joined the allowlist; Notion owns URLs.
  - *Validation gate:* ten abort conditions, two warnings; an abort returns 422 and touches
    nothing.
  - *Two GitHub-layer bugs caught in test:* `btoa(String.fromCharCode(...bytes))` throws above a
    few hundred kB (now chunked at 32 kB), and content comparison broke above 1 MB (now the git
    blob SHA-1).
  - *`MIN_PUBLIC_BOOKS`* raised to 300.
  - `/covers` added (see `COVER-SYNC-DEPLOY.md`).
