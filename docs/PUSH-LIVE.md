# Replacing the repo and going live

**About 30 minutes, most of it waiting for builds.** The old repo contents get deleted and the
generator replaces them, in one commit, on a branch you can look at before it touches the live
domain.

---

## What you're pushing

`bookshelf-repo.zip` — 422 files, 19 MB. Everything the site needs and nothing it doesn't.

```
.gitignore  .nvmrc  README.md  package.json  package-lock.json
src/    templates, styles, fonts, extracted JS, 330 covers, books.json, share.png
tools/  build.mjs, qa.mjs, the Worker source, and dev-only tools
docs/   runbooks and session reports
```

Verified before packaging: unzipped into an empty directory, `npm ci` → `npm run build` →
`npm run qa` produced **361 routes and 87 passing checks**. That's the same three commands
Cloudflare will run.

Four things were removed in this pass, so you're not pushing dead weight:

- `titles.recovery.txt` — the bridge for the title bug. The Worker is fixed; it's obsolete. (`qa.mjs`
  now tolerates its absence — that was a real code change, not just a delete)
- `index.html.orig` — a pre-patch backup, superseded
- The generated PDFs — you have them; the markdown sources live in `docs/`
- Loose docs at the repo root — now in `docs/`

---

## Before you start

**Set the Pages build configuration first, if you haven't.** Saving it doesn't trigger a rebuild, so
there's no window where the new config meets the old repo.

**Workers & Pages** → your Pages project → **Settings** → **Build** → **Build configuration**:
build command `npm run build`, output directory `dist`.

Two things worth knowing so nothing here feels alarming:

- **Deleting files from the repo does not take the site down.** The live site is an already-built
  deployment; it keeps serving until a *successful* new build replaces it.
- **A failed build changes nothing.** Pages keeps the last good deployment. The worst case for a
  mistake here is "the site doesn't update," not "the site breaks."

---

## Step 1 — wipe and replace, on a branch

GitHub's web UI can't delete a folder, and you have 330 covers to remove. This is a terminal job.

```bash
# 1. Unzip into an empty folder somewhere — NOT inside the repo
mkdir -p ~/bookshelf-new && cd ~/bookshelf-new
unzip ~/Downloads/bookshelf-repo.zip

# 2. Clone the repo separately
cd ~ && git clone https://github.com/alexdrost/bookshelf.git
cd bookshelf
git checkout -b v2

# 3. Delete everything that's tracked
git rm -rqf .

# 4. Copy the new tree in. The trailing /. matters — it's what carries
#    .gitignore and .nvmrc across.
cp -a ~/bookshelf-new/. .

# 5. Commit and push
git add -A
git status          # sanity check: deletions of the old tree, additions of src/ tools/ docs/
git commit -m "Rebuild as a static site generator (361 routes, Nunjucks + Cloudflare Pages)"
git push -u origin v2
```

`git rm -rqf .` clears the working tree and the index in one go; history is untouched, so the old
SPA stays in the log if you ever want it back.

**Authentication:** whatever you normally use. If you have no credential set up, the fine-grained
PAT you made for the Worker already has `Contents: read and write` on this repo — paste it as the
password at the HTTPS prompt.

---

## Step 2 — look at the preview

Pages builds every non-production branch. Watch the build under **Deployments**, then open the
`*.pages.dev` preview URL it gives you.

Worth clicking, in this order — each one exercises something different:

1. **Home** — covers load, the featured book renders
2. **`/library/`** — 24 cards, then **Load more** → 48, and the URL becomes `/library/2`
3. **Any book page** — cover, summary, core ideas, connected books
4. **`/connections`** — the force graph draws, the path finder returns a chain
5. **`/analytics`** — all six panels have data
6. **On your phone** — the whole point of the 390px work

If the build fails, the log says which: `npm ci` (lockfile mismatch), the build command (the report
prints the actual error), or an empty output directory (the path is `dist`, no leading slash).

---

## Step 3 — merge to main

Open a PR from `v2` on GitHub and merge it, or `git checkout main && git merge v2 && git push`.

Pages builds `main` as production and your custom domain picks it up. **This is the moment the new
site is live.**

---

## Step 4 — repoint the Worker, straight away

The old repo kept `books.json` and `covers/` at the root. The generator keeps them under `src/`.
Until you change these, the Worker is still writing to paths the new site doesn't read.

**Workers & Pages** → **bookshelf-notion-sync** → **Settings** → **Variables and Secrets**:

| Variable | From | To |
| --- | --- | --- |
| `BOOKS_PATH` | `books.json` | `src/data/books.json` |
| `COVERS_PATH` | `covers` | `src/covers` |

**Deploy.** Change both together — they're the same migration.

Don't leave a gap here. The cron fires at 08:00 UTC, and if it runs before you've flipped these it
will recreate a root `books.json` that nothing reads. Harmless, but delete it if it appears.

---

## Step 5 — prove the loop end to end

```
/health                       BOOKS_PATH and COVERS_PATH show the new src/ paths
/sync?key=…&dry=1             ok: true, books: 321, withSlug: 321, errors: []
/sync?key=…                   committed: true on the first run, false on a second
/covers?key=…&dry=1           missing: 0
```

The commit from `/sync` triggers a Pages build. When it finishes, the site is running on the live
pipeline — Notion to production, no hands.

**Then make one real edit as a test.** Change a summary in Notion, click `/sync`, wait for the
build, and watch it appear. That's the thing worth confirming while you're paying attention,
because it's the loop you'll use every week.

---

## If you need to undo it

| Situation | Fix |
| --- | --- |
| Preview looks wrong | Nothing to undo. `main` hasn't moved and the live site hasn't changed |
| Merged and the site is wrong | **Deployments** → **Promote deployment** on the previous one. Instant |
| Want the old repo tree back | `git revert` the commit. The old SPA is still in the history |
| Worker misbehaving | **Deployments** on the Worker → promote the previous version |

Nothing in this sequence is one-way.

---

## After it's live

`docs/GO-LIVE.md` has the rest: submit the sitemap, and expect indexation over weeks rather than
days — 321 new URLs arriving at once on a domain with little accumulated authority produces slow,
partial discovery. Partial indexing in the first fortnight is normal.

Then the editorial work, at your pace: featured connection pairs, standout notes, and the 30 thin
book pages listed at the end of every build report.
