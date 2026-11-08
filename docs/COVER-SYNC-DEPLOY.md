# Covers from Notion — what changed, and how to deploy it

> **Updated 8 Nov 2026.** This doc is the Aug 2026 history of the `/covers` route. What changed
> since: covers now normally ride `/all` (sync → covers → Notion icons, on one subrequest meter),
> the cron runs exactly `/all`, and every successful cover also queues its Notion page icon.
> `COVERS_PATH` is `src/covers` (the new site is live). Current deploy steps, routes and errors:
> **`WORKER-DEPLOY.md`**. Sections 1, 2, 6 and 7 below are still accurate.

**Time: about 10 minutes.** Two new variables and a re-paste of the Worker. `/sync` is untouched —
same code, same behaviour, re-tested — so the risk here is confined to a route that didn't exist
before.

**What you get:** drag an image onto a book in Notion, click a URL, and it lands in Git as
`{Goodreads ID}.jpg`. `bookshelf_set_covers.py` retires.

---

## 1. The idea in one paragraph

The Worker reads each public book's `Cover Image` attachment, fetches the bytes from Notion's
signed URL, and commits them to `covers/{Goodreads ID}.jpg`.

**The filename you gave the image in Notion is deliberately ignored.** The Goodreads ID is the join
key for the entire system — covers, edges, page URLs — and a hand-typed filename is exactly how a
cover ends up attached to the wrong book. Drag in `IMG_4471.jpg`, `screenshot.png`, or
`final-final-v2.jpg`; it lands as `{gid}.jpg` either way. That's the whole point of doing this in
Notion: the one fiddly step disappears.

---

## 2. You don't need a backfill

Worth saying before you start, because it changes what "first run" means.

All 330 covers are already in the repo you're about to push. `/covers` is for the **steady state** —
the nought-to-three new books at a time. Your first real run will find almost nothing to do, and
that's correct.

The one thing to know: the run is **batched at 15 covers**, because free-plan Workers allow 50
outbound requests per invocation and each cover costs two. If you ever do face a big backfill, the
response tells you how many are `remaining` — click again, or pass `?limit=` higher if you're on a
paid plan.

---

## 3. Deploy

### a. Paste the code

**Workers & Pages** → **bookshelf-notion-sync** → **Edit code** → select all, delete, paste the new
`bookshelf_sync_worker.js` in whole → **Deploy**.

Note the current version under **Deployments** first — that's your rollback.

### b. Add two variables

**Settings** → **Variables and Secrets** → **Add** → type **Text**.

| Variable | Value |
| --- | --- |
| `COVERS_PATH` | `src/covers` |
| `COVER_BATCH` | `15` |

`COVERS_PATH` and `BOOKS_PATH` (`src/data/books.json`) moved together when the new site went live.
Their built-in defaults (`covers`, `books.json`) are the OLD root paths, so if a deploy ever wipes
these vars the Worker writes to the wrong place — `/health` shows it as `(default)`.

`COVER_BATCH` is optional; leave it off and it defaults to 15. Set it to `50` or more only if
you're on a paid Workers plan.

No new secrets. It reuses the Notion and GitHub tokens you already have.

---

## 4. Verify

### Gate 1 — `/health`

```
https://bookshelf-notion-sync.drost.workers.dev/health
```

`vars` should now include `COVERS_PATH` and `COVER_BATCH`. If either says `(default)`, the variable
didn't save.

### Gate 2 — dry run. Reads Notion, lists the repo, writes nothing, fetches no images.

```
https://bookshelf-notion-sync.drost.workers.dev/covers?key=YOUR_SYNC_SECRET&dry=1
```

```json
{
  "ok": true,
  "coversInRepo": 330,
  "publicBooks": 321,
  "alreadyPresent": 321,
  "missing": 0,
  "attempted": 0,
  "remaining": 0,
  "wouldWrite": [],
  "warnings": []
}
```

`missing: 0` is the expected answer today and means everything is already in place.

`wouldWrite` shows `{gid}.jpg  <-  {the name in Notion}` for each one, so you can eyeball that the
mapping is right before anything is written.

### Gate 3 — the real test: add a cover and watch it land

This is worth doing once deliberately, so you trust it later.

1. Pick a book. Delete `covers/{its id}.jpg` from GitHub (or pick a genuinely new book)
2. `/covers?key=…&dry=1` → it should now appear in `wouldWrite`
3. `/covers?key=…` → `"committed": 1`, and `written` names the file with its size and format
4. Check GitHub: the file is there, correctly named
5. Run it again → `"missing": 0`. It doesn't re-push what's already right

---

## 5. Day-to-day use

| You want to | URL |
| --- | --- |
| Sync books, push new covers, set their Notion icons | `/all?key=…` — the normal click |
| See what it would do first | `/all?key=…&dry=1` |
| **Replace** a cover you've swapped in Notion | `/all?key=…&force=25817264` |
| Covers and icons only, no books.json | `/covers?key=…` |
| Push a big batch (paid plan, raise `MAX_SUBREQUESTS` too) | `/all?key=…&limit=100` |

**`force` is the one to remember.** The default run only looks for covers that are *missing* from
Git — that's what keeps the nightly job from re-downloading 330 images every night. So when you
replace an image on a book that already has one, tell it which book. If the bytes turn out to be
identical it still won't commit.

The nightly cron runs exactly `/all`: books first, then covers up to `COVER_BATCH`, then icons, all
on one 45-call budget. Covers and icons run in their own error handler: **a cover or icon problem
can never stop `books.json` syncing.** The catalogue matters; a cover doesn't.

---

## 6. What it refuses to do, and what it tells you

Nothing in this route can abort your books sync, and nothing silently guesses. Every skip is
reported in `warnings` with the book that caused it.

| Situation | What happens |
| --- | --- |
| Book has no Goodreads ID | Skipped and warned — there's no correct filename, so it won't invent one |
| No `Cover Image` attached | Skipped and warned |
| Notion's URL 404s or expires | Warned, run continues to the next book |
| File under 1 kB | Rejected — that's an error page, not a cover |
| File over 5 MB | Rejected |
| It's a PNG, GIF or WebP | **Written anyway** and flagged. The site serves it from a `.jpg` path and browsers render it fine; the warning is a nudge to re-save, not a failure |
| `covers/` doesn't exist yet | Treated as empty, creates it |
| More than 1,000 files in `covers/` | Warned that GitHub truncated the listing |

---

## 7. What I verified before handing this over

I couldn't hit your live Notion and GitHub from here, so I tested against mocks for the network and
real data for everything else. Twenty-five checks, all passing:

**Binary handling — against `git hash-object` itself.** Six of your actual cover files, base64
round-tripped and blob-SHA'd, compared byte-for-byte with what git computes. This is the part that
would fail silently and corrupt files, so it's checked against the authoritative implementation
rather than my own reasoning.

**Behaviour, with Notion and GitHub mocked:** commits exactly what's missing and nothing else;
writes `{gid}.jpg` when Notion's filename is `IMG_4471.jpg`; caps the batch at 15 and reports the
remainder; `?limit=` overrides it; `force` re-pushes and sends the sha GitHub requires for an
update; `force` with identical bytes is still a no-op; a missing Goodreads ID, a missing attachment,
a 404, a 12-byte file and a PNG each warn without stopping the run; dry run makes zero writes and
doesn't even fetch the images; a missing `covers/` directory is treated as empty rather than fatal.

**Regression on `/sync`:** the string paths for base64 and blob SHA still match Node's and git's
output exactly, `validate()` still returns zero errors on your live 321 books, and the title wipe,
truncated library, duplicate slug and relation-cap cases all still abort.

One finding worth passing on: my first PNG test fixture was a 300-byte solid-colour image, and the
code rejected it as "not a real image" before the format check ever ran. That was the size floor
doing its job — the smallest genuine cover in your set is 8 kB — but it's why the floor sits at 1 kB
and not higher.
