# Bookshelf — how this runs from here

Written 14 August 2026. Everything in §1 was verified live today, not taken from notes.

---

## 1. Where it actually stands

**The Worker is live and correctly configured.** I hit `/health` on the deployed Worker: all three
secrets present, all five variables correct, `BOOKS_PATH` set to `books.json`, Notion API version
`2025-09-03`, safety floor 300. That's the new code, wired the way we planned.

**The live site is repaired.** `bookshelf.drost.us/books.json` now serves real titles *and* slugs.
The title bug that ran for weeks is closed, in production, and the slugs are riding along ahead of
the new site needing them.

**Notion already holds every cover.** 329 of 337 rows have a `Cover Image` attached. The eight
without are all Legacy/wishlist rows — no Goodreads ID, no shelf, not public. So **every book that
matters already has its cover in Notion.** This turns out to matter a lot; see §5.

### What's left before launch

| | |
| --- | --- |
| **Cloudflare Pages build config** | The one remaining blocker. `npm run build` → `dist`, Node 20+ |
| **Push the new repo** | 361 routes, 330 covers, `share.png` |
| **Flip `BOOKS_PATH`** | `books.json` → `src/data/books.json`, one variable, on launch day |
| Then | UI/UX polish, featured pairs, standout notes, 30 thin pages — all post-launch, at your pace |

---

## 2. The three loops you'll actually run

Everything from here is one of three things. They have different shapes and it's worth keeping them
straight, because two of them never touch code.

### Loop A — a new book (weekly-ish)

```
you finish a book  →  Goodreads  →  you tell a chat  →  I enrich + write to Notion
                                                      →  you review, check Public?
                                                      →  you click /sync  →  live
```

**No code. No repo. No build.** This is the loop that should feel like nothing.

The `Public?` checkbox is the gate — nothing reaches the site until you tick it. And because the
Worker validates before it commits, a half-finished book can't publish by accident even if you do
tick it early: zero themes, a duplicate slug, or a dangling connection all abort the sync with a
message telling you which book and why.

### Loop B — a cover (occasional)

Today this runs backwards from how you want it. §5 is the whole answer.

### Loop C — the site itself (rare, and lumpy)

Templates, CSS, layout, new page types. This one needs the repo and a build. It's the only loop
where anything gets pushed to Git by hand.

---

## 3. Where to do the work — same project, new chat

**Recommendation: keep everything in this Bookshelf project. Start a fresh chat per task.**

The project instructions are the operating manual — the exact Notion property names, the two data
source IDs, the eleven locked themes, the `|||` delimiter, the "never guess a Goodreads ID" rule.
A fresh chat in this project loads all of that automatically and is competent from the first
message. A *new project* would start blind, and you'd be re-teaching it the schema — which is
exactly where the expensive mistakes live. The API rejects `Name` instead of `Title`; a wrong
Goodreads ID silently corrupts the connection graph and orphans a cover.

What you want isn't project separation, it's **context separation**, and a new chat gives you that
for free. This chat is now carrying a full site build; a book-add doesn't need any of it.

Suggested rhythm:

- **"Adds — August 2026"** — one chat, run for a month, drop books in as you finish them
- **"UI polish"** — a separate chat for the design work you mentioned
- **This chat** — leave it for launch day

---

## 4. What to hand me when you add a book

The honest minimum is **a Goodreads link**. Everything else I can derive or look up.

If you have them, these three save a round trip:

| | Why it matters |
| --- | --- |
| **Goodreads link or ID** | The join key. Covers, edges, and the site all hang off it. This is the one thing I won't guess — if it can't be verified I'll leave it blank and flag it rather than invent one |
| **Date read** | The deterministic sort key for the connection graph. A wrong date silently reorders edges on the next rebuild |
| **Anything you actually thought** | Goes in the page body, never in a synced property. It makes the summary and core ideas better and it stays private |

I'll do the rest: summary, three core ideas, themes from the locked eleven, tags as real relations,
connections to books already on the shelf, ISBN, page count, year. Then I'll read it back out of
Notion and confirm it landed — including the `Public?` checkbox, which has a known habit of coming
out checked when it was told not to.

**Batch them.** Five books in one pass produces better connections than five separate passes,
because I can see them against each other, not just against the back catalogue.

---

## 5. Covers — the change worth making

You've got the direction backwards from what you want, and you're right that Notion is the better
place to put them.

**Today:** you put a `.jpg` in Git, and `bookshelf_set_covers.py` pulls it into Notion. Two systems,
a Colab run, and the file has to be named `{goodreads_id}.jpg` before it ever leaves your desktop.

**What you want:** drag the image into the Notion row, and it shows up on the site.

**The good news is you're most of the way there already.** Notion is holding a cover for all 329
real books. The data is in the right place. What doesn't exist is the pipe from Notion to Git.

### The fix: one new Worker route

The Worker already talks to both systems and already knows how to commit a file without churning
Pages. Adding `/covers?key=…` is maybe forty lines:

1. Read each public book's `Cover Image` property → Notion returns a signed URL
2. Fetch the bytes
3. Commit to `covers/{Goodreads ID}.jpg`, skipping anything already present

Three properties of that design are worth calling out:

- **The filename in Notion is irrelevant.** The Worker always writes `{Goodreads ID}.jpg`, because
  the Goodreads ID is the join key and a hand-typed filename is exactly how a cover ends up
  pointing at the wrong book. Drag in `IMG_4471.jpg` and it lands correctly.
- **It's the same safety model as `books.json`.** Compare the git blob SHA, commit only on a real
  change, and an unchanged run is a genuine no-op.
- **Replacements need an explicit nudge** — `/covers?force=<goodreads_id>` — because the default
  "only fetch what's missing" is what keeps the nightly run from re-downloading 330 images. That
  suits how often you'd actually swap a cover.

Net effect: **covers stop being a Git task.** Drag the image into Notion when you add the book, and
it rides the same `/sync` click as everything else. `bookshelf_set_covers.py` retires.

**This is a build, not a config change, and it means redeploying the Worker you just got working.**
Say the word and I'll write it — I'd suggest after launch, when the Pages side is settled and a
Worker redeploy isn't happening on top of everything else.

### On hunting down the right cover and the right title

Keep doing it. You said you don't mind going and finding the proper cover — that's the *correct*
instinct, and it's why the system has no automatic cover-lookup in it. The old SPA had fallbacks
that hit Open Library and Google Books at page load; I stripped them out of the new build
deliberately. They were slow, they leaked a request per book to third parties, and they were wrong
often enough to be worse than a clean placeholder.

A human picking the right edition's cover beats any API. The pipeline's job is to not lose it once
you've found it.

---

## 6. Before you start a new chat: refresh the project instructions

The **Open threads** section in the project instructions is now partly stale, and stale instructions
actively mislead a fresh chat — it'll go chasing things that are already done.

**Resolved, delete these:**

- `MIN_PUBLIC_BOOKS` floor — done, it's 300
- Regime Change cover / Smartest Guys / Dear Chairman / Blood and Oil covers — all attached in
  Notion and staged in the new repo
- The Worker title fix — deployed and verified

**Changed:**

- Currently-reading is now **Blood and Oil, 1177 B.C., The Nvidia Way, Scaling Up, Separation of
  Church and Hate** — all five held back (`Public?` unchecked). Dear Chairman, Shameless and
  Biological War have flipped to read and are live. The Biological War pre-pub caveat has expired.

**Closed for free — the Maxwell question.** "The 15 Invaluable Laws of Growth" is a real book. There
is no Maxwell title called "21 Laws of Growth"; his 21-law books are *The 21 Irrefutable Laws of
Leadership* and *The 21 Indispensable Qualities of a Leader*. So that Legacy row is a mistitle, not
a second book — merge it into the 15 Laws row or delete it. It isn't two books.

**Still open, and one of them now has a clock on it:**

- **Connection pruning.** 183+ books exceed the 6-link target. This stopped being cosmetic: Notion
  returns at most 25 relation items per query, and two books are already at 22. At 26 the extra
  links vanish from the API response. The new Worker turns that into a hard abort rather than a
  silently thinner graph — so it will fail loudly instead of corrupting quietly, but it *will* fail.
- Tag vocabulary gaps: public health, ancient history, energy/oil, climate, AI-as-distinct-from-tech
- `Public?`-on-create bug — still unexplained, still worth root-causing
- Legacy dedup: 30 rows
- Phase F, per-book OG images, author headshots

---

## 7. What breaks as the shelf grows

Nothing here is urgent. It's the list of things that will eventually need a decision, with the
number that triggers each one — so none of them arrive as a surprise.

| Threshold | What happens | Fix |
| --- | --- | --- |
| **26 connections on one book** | Notion truncates the relation; the Worker aborts the sync | Prune. Already close — two books at 22 |
| **~600 books** | `books.json` crosses 1 MB | Already handled — change detection uses the git blob SHA, which is size-independent |
| **Dropping below 300 public books** | Sync aborts | Intentional. Raise the floor as the shelf grows |
| **A duplicate slug** | Sync aborts | Two books would otherwise share one URL and one would vanish |
| **A Goodreads ID correction** | The cover orphans | Rename the file to match. Notion-side covers (§5) make this automatic |

The recurring theme: **every one of these fails loudly now.** The original title bug was dangerous
precisely because it didn't — it emptied one field and left thirteen looking healthy. Ten abort
conditions run before every commit, and none of them let a bad file reach the site.

---

## 8. The short version

- **Adding a book is a chat, not a task.** New chat in this project, hand me a Goodreads link,
  review in Notion, tick `Public?`, click `/sync`.
- **Covers should live in Notion** — and one new Worker route gets you there. Worth building after
  launch.
- **Keep finding the right covers and titles yourself.** The system is built around that, not
  around automating it away.
- **Pages build config is the last thing between you and a live site.**
