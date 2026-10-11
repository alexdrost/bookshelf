# Deploying the sync Worker — exact steps

**Time: about 20 minutes. Risk: low — the Worker validates before it writes, and a bad run
commits nothing.** Everything below is dashboard-only; no Wrangler, no terminal.

The full source is in **§9** and in `tools/bookshelf_sync_worker.js`. It is a **replacement**, not
a patch — the original Worker source was never in project knowledge, so this was rewritten from the
schema and the observed output. Paste it whole.

---

## 1. The one decision — where the Worker writes

`BOOKS_PATH` is the only setting whose right answer depends on timing. **Recommendation: set it to
`books.json` today, and change it to `src/data/books.json` on the day the new site goes live.**

Here's why that ordering is worth the extra thirty seconds later.

Your live site's `books.json` currently has **320 of 320 titles empty**. I checked the new Worker's
output schema against it field by field: identical, plus `slug`. Nothing removed, nothing renamed,
and the old SPA never reads `slug` or `public`, so an extra key is inert.

Which means pointing the new Worker at the root path **repairs the live site immediately** — and
does it against production, where you'll actually see whether the whole Notion → GitHub → Pages
chain works, before the new site is in the picture at all. If something's wrong, you find out now
on a site that's already broken, not later on one that isn't.

When the new site ships, change one variable and redeploy. That's the whole migration.

| Phase | `BOOKS_PATH` | What it does |
| --- | --- | --- |
| **Today** | `books.json` | Repairs the live SPA's titles; proves the chain end to end |
| **New site live** | `src/data/books.json` | Feeds the generator; the build emits the public copy into `dist/` |

> Don't ever point it at `dist/`. That directory is generated — the next build overwrites it.

---

## 2. Pre-flight — three things in hand

Have these ready before you open the dashboard. Two of them you may already have.

**a. Notion internal integration token.** The one already connected to this workspace. It must be
shared with **both** databases — the Books DB and the Tags DB. If it only has Books, tags resolve to
empty strings and every book loses its tags silently. Notion → the database → `•••` → **Connections**
→ confirm the integration is listed. Do this for both.

**b. GitHub fine-grained personal access token.** Repository access: **only** `alexdrost/bookshelf`.
Permissions: **Contents → Read and write**. Nothing else. That single permission is the entire
surface this Worker needs.

**c. A sync secret.** Any long random string — it's what gates `/sync` so the URL isn't a public
"rebuild my site" button. If one already exists, reuse it.

> **Never paste any of these into a chat, a doc, or a commit.** They go in the Worker's secret store
> and nowhere else. If one gets exposed: say so, revoke, regenerate. This has happened before.

---

## 3. Paste the code

1. Cloudflare dashboard → **Workers & Pages**
2. Select **bookshelf-notion-sync**
3. **Edit code**
4. Select all in the editor, delete, paste **§9** in whole
5. **Deploy**

Editing the existing Worker rather than making a new one is deliberate: it keeps the URL, the cron,
and the route bindings, and it means the old code stops running the moment you deploy. Two Workers
writing the same file is how you get a good `books.json` overwritten at 3am.

**Before you deploy, note the current version** under **Deployments** — that's your rollback point
(§8).

---

## 4. Variables

**Settings** → **Variables and Secrets** → **Add** → type **Text**, one per row.

| Variable name | Value |
| --- | --- |
| `DATA_SOURCE_ID` | `f387f744-b4f6-46f8-83d4-22b60a9722c5` |
| `TAGS_DATA_SOURCE_ID` | `37f9af547eb3818e9142000b913c4e62` |
| `GITHUB_REPO` | `alexdrost/bookshelf` |
| `GITHUB_BRANCH` | `main` |
| `BOOKS_PATH` | `books.json` |

`DATA_SOURCE_ID` is the **data source** ID, not the container ID. The container
(`1099af547eb38002844cf872b88ea887`) is for schema operations only; using it here returns 404 on
every query. This is the single easiest thing to get wrong.

Select **Deploy** when you've added all five.

---

## 5. Secrets

Same panel, **Add** → type **Secret**.

| Secret name | Value |
| --- | --- |
| `NOTION_TOKEN` | the Notion integration token from §2a |
| `GITHUB_TOKEN` | the fine-grained PAT from §2b |
| `SYNC_SECRET` | your random string from §2c |

Select **Deploy**. Secrets are write-only once saved — you can replace one, you can't read it back.
That's why `/health` reports them as `true`/`false` rather than echoing values.

---

## 6. Cron

**Settings** → **Triggers** → **Cron Triggers**. It should already read `0 8 * * *` (08:00 UTC
nightly). Leave it. If it's missing, add it.

---

## 7. Verify — three gates, in this order

Each one is a URL in your browser. Don't skip ahead; each gate rules out a different failure.

### Gate 1 — `/health`. No writes. Confirms wiring.

```
https://bookshelf-notion-sync.drost.workers.dev/health
```

Expected, exactly:

```json
{
  "ok": true,
  "notionVersion": "2025-09-03",
  "minPublicBooks": 300,
  "secrets": { "NOTION_TOKEN": true, "GITHUB_TOKEN": true, "SYNC_SECRET": true },
  "vars": {
    "DATA_SOURCE_ID": "f387f744-b4f6-46f8-83d4-22b60a9722c5",
    "TAGS_DATA_SOURCE_ID": "37f9af547eb3818e9142000b913c4e62",
    "GITHUB_REPO": "alexdrost/bookshelf",
    "GITHUB_BRANCH": "main",
    "BOOKS_PATH": "books.json"
  }
}
```

Any `false` under `secrets` is a secret that didn't save. Any `null` or wrong string under `vars` is
a typo. Fix and redeploy before continuing — the next two gates can't succeed past this.

### Gate 2 — `/sync?dry=1`. Full Notion read, full validation, **no commit.**

```
https://bookshelf-notion-sync.drost.workers.dev/sync?key=YOUR_SYNC_SECRET&dry=1
```

Expected:

```json
{
  "ok": true, "books": 321, "edges": 2431, "withSlug": 321,
  "read": 321, "currentlyReading": 0,
  "errors": [], "warningCount": 0,
  "committed": false, "dryRun": true
}
```

**The three numbers that matter:**

- `books: 321` — the Public? filter is working. Notion holds exactly 321 rows that are
  `Public? = yes` and `Shelf = read`.
- `withSlug: 321` — the `Slug` property is being read. **If this is 0, the property name is wrong**
  — it's capital-S `Slug`, not `slug`.
- `errors: []` — all ten abort conditions passed.

A `422` here is the gate doing its job, not a broken deploy. `errors` tells you exactly what and
where; §8 maps every message to a cause.

### Gate 3 — `/sync`. The real thing.

```
https://bookshelf-notion-sync.drost.workers.dev/sync?key=YOUR_SYNC_SECRET
```

Same payload, with `"committed": true`.

**Now load that URL a second time.** It should return `"committed": false`. That's the blob-SHA
comparison proving an unchanged sync is a genuine no-op — which is what stops the nightly cron
rebuilding Pages 365 times a year for nothing. If the second run also says `true`, something is
non-deterministic and it's worth stopping to find out what.

### Gate 4 — look at the site

Wait for the Pages build, then load `bookshelf.drost.us`. **Titles are back.** That's the original
bug fixed, on production, verified by eye.

---

## 8. If something goes wrong

### Rollback — about 30 seconds

**Workers & Pages** → **bookshelf-notion-sync** → **Deployments** → **Promote deployment** on the
version you noted in §3. The old Worker is running again.

Worth knowing: rolling back the Worker does **not** roll back `books.json`. If a sync committed
something wrong, revert that commit in GitHub separately.

### Every error this Worker can produce

| Message | What happened | Fix |
| --- | --- | --- |
| `401 {"error":"unauthorized"}` | `key=` doesn't match `SYNC_SECRET` | Check for a trailing space or a URL-encoded character |
| `Notion 404 on <id>` | `DATA_SOURCE_ID` is the container ID, or the integration isn't shared with that DB | Use the data-source ID from §4; check **Connections** on the database |
| `Notion 401` | Token wrong, revoked, or from another workspace | Regenerate; re-share both DBs |
| `N of 321 books have an empty title` | The title regression is back | You're on old code — confirm the deploy landed |
| `only N public books, floor is 300` | Fewer than 300 rows are `Public?`-checked | Almost certainly a Notion filter/view mistake, not a Worker bug |
| `duplicate Slug "x"` | Two books share a URL | Fix in Notion; the build would have silently overwritten one page |
| `duplicate Goodreads ID` | Same book twice | Usually a Legacy row duplicating a real one |
| `has theme "X" outside the locked list` | A theme outside the 11 | Fix in Notion — the site has no page for a twelfth theme |
| `has zero themes` | Unenriched row got published | Enrich it or uncheck `Public?` |
| `summary contains the core-ideas delimiter` | A `\|\|\|` leaked into Summary | Remove it — it would split the summary into fake core ideas |
| `N dangling connection refs` | A connection points at a page with no Goodreads ID | Set the ID on the target, or remove the link |
| `hit Notion's 25-item relation cap` | A book has >25 connections; the extras never reached the API response | Prune that book's connections in Notion |
| `GitHub read 401` / `write 401` | PAT wrong, expired, or lacks Contents | Regenerate fine-grained, `Contents: Read and write`, that repo only |
| `GitHub write 404` | `GITHUB_REPO` or `GITHUB_BRANCH` wrong, or PAT not scoped to the repo | Check `/health` echoes the right repo |
| `GitHub write 409` | Someone committed between the read and the write | Just run `/sync` again |

`ok: false` with a populated `errors` array **always** means nothing was committed. The commit is
the last thing that happens, and only if `errors` is empty.

---

## 9. The file — paste this whole

```js
/**
 * bookshelf-notion-sync — Cloudflare Worker
 * Notion (Books DB)  ->  books.json  ->  GitHub  ->  Cloudflare Pages
 *
 * REPLACEMENT for the previous Worker. Written fresh (the original source was not
 * available), so treat this as the new canonical file rather than a patch.
 *
 * What changed versus the version that is live today
 *   1. readProp() dispatches on the Notion property TYPE. The old generic rich_text
 *      accessor returned "" for `Title` — the only title-type property in the schema —
 *      which silently emptied every title in books.json and nothing else.
 *   2. `Slug` joins the allowlist. Notion is now the system of record for URLs.
 *   3. A validation gate runs BEFORE the commit and aborts on a whole-field wipe, so
 *      this class of failure can never publish silently again.
 *
 * Triggers
 *   GET /sync?key=SYNC_SECRET   manual
 *   cron 0 8 * * *              nightly
 *   GET /health                 config check, no writes
 *
 * Secrets (Worker secret store — never in this file)
 *   NOTION_TOKEN, GITHUB_TOKEN, SYNC_SECRET
 * Vars
 *   DATA_SOURCE_ID, TAGS_DATA_SOURCE_ID, GITHUB_REPO, GITHUB_BRANCH, BOOKS_PATH
 */

const NOTION_VERSION = '2025-09-03';
const NOTION = 'https://api.notion.com/v1';

/** Safety floor: refuse to publish a suspiciously small library. ~321 books live today. */
const MIN_PUBLIC_BOOKS = 300;

/** The 11 locked themes. Anything else aborts the commit. */
const THEMES = new Set([
  'Politics & Power', 'Business & Finance', 'History & Foreign Affairs',
  'Personal Growth & Leadership', 'Memoir & Biography', 'Psychology & Mind',
  'Society & Culture', 'Religion & Faith', 'Tech & Future', 'Crime & Justice', 'Other',
]);

const CORE_DELIM = '|||';

// ---------------------------------------------------------------- property reader
/**
 * Read any Notion property as a plain value, dispatching on `type`.
 *
 * THIS IS THE BUG FIX. A `title`-type property returns its content under `title`;
 * every other text property returns it under `rich_text`. `Title` is the only
 * title-type property in this schema, so an accessor that only looks at `rich_text`
 * empties exactly that one field and leaves everything else looking healthy.
 */
function readProp(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title': return (prop.title ?? []).map((t) => t.plain_text).join('').trim();
    case 'rich_text': return (prop.rich_text ?? []).map((t) => t.plain_text).join('').trim();
    case 'number': return prop.number == null ? '' : String(prop.number);
    case 'select': return prop.select?.name ?? '';
    case 'multi_select': return (prop.multi_select ?? []).map((o) => o.name);
    case 'checkbox': return !!prop.checkbox;
    case 'date': return prop.date?.start ?? '';
    case 'relation': return (prop.relation ?? []).map((r) => r.id.replace(/-/g, ''));
    case 'formula': return prop.formula?.string ?? '';   // read-only, never written
    case 'files': return (prop.files ?? []).map((f) => f.name);
    default: return '';
  }
}

const yyyymmdd = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '/') : '');

// ---------------------------------------------------------------- Notion
async function notionQueryAll(dataSourceId, token, body = {}) {
  const rows = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION}/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status} on ${dataSourceId}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return rows;
}

// ---------------------------------------------------------------- build books.json
async function buildBooksJson(env) {
  const token = env.NOTION_TOKEN;

  // Public? is the ONLY visibility gate — filter at the source so nothing unpublished
  // can reach the file even by accident.
  const pages = await notionQueryAll(env.DATA_SOURCE_ID, token, {
    filter: { property: 'Public?', checkbox: { equals: true } },
  });

  // Tag relation -> tag name.
  const tagPages = await notionQueryAll(env.TAGS_DATA_SOURCE_ID, token);
  const tagName = new Map();
  for (const t of tagPages) {
    const nameProp = Object.values(t.properties).find((p) => p.type === 'title');
    tagName.set(t.id.replace(/-/g, ''), readProp(nameProp));
  }

  // Notion page id -> Goodreads ID, so the self-relation can resolve to join keys.
  const pageToGid = new Map();
  for (const p of pages) pageToGid.set(p.id.replace(/-/g, ''), readProp(p.properties['Goodreads ID']));

  const books = pages.map((p) => {
    const P = p.properties;
    const dateRead = yyyymmdd(readProp(P['Date Read']));
    const core = readProp(P['Core Ideas']);
    return {
      id: readProp(P['Goodreads ID']),
      title: readProp(P['Title']),                 // <- the fix
      author: readProp(P['Author']),
      isbn: readProp(P['ISBN']),
      pages: readProp(P['Pages']),
      yearPub: readProp(P['Year Published']),
      dateRead,
      yearRead: dateRead ? dateRead.slice(0, 4) : '',
      shelf: readProp(P['Shelf']),
      slug: readProp(P['Slug']),                   // <- new: Notion owns the URL
      themes: readProp(P['Themes']),
      tags: readProp(P['Tags']).map((id) => tagName.get(id)).filter(Boolean).join(', '),
      summary: readProp(P['Summary']),
      core: core ? core.split(CORE_DELIM).map((s) => s.trim()).filter(Boolean) : [],
      // Connections resolve to Goodreads IDs. A link to a book that is not public
      // resolves to nothing and is dropped — guardrail 4, checked not assumed.
      conn: readProp(P['Connections']).map((pid) => pageToGid.get(pid)).filter(Boolean),
      // Notion returns at most 25 relation items per property per query and flags the rest
      // with has_more. Past that the extra links are simply absent — a silently thinner
      // graph, which is exactly the failure mode the title wipe taught us to catch.
      _truncated: [
        P['Connections']?.has_more ? 'Connections' : null,
        P['Tags']?.has_more ? 'Tags' : null,
      ].filter(Boolean),
    };
  });

  // Canonical order: Date Read ascending, undated last, Goodreads ID as tiebreaker.
  // edges are POSITIONAL, so this order is load-bearing — never change it casually.
  books.sort((a, b) => {
    if (a.dateRead && b.dateRead && a.dateRead !== b.dateRead) return a.dateRead < b.dateRead ? -1 : 1;
    if (a.dateRead && !b.dateRead) return -1;
    if (!a.dateRead && b.dateRead) return 1;
    return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
  });

  // edges are regenerated from conn on every sync and never stored in Notion.
  const idx = new Map(books.map((b, i) => [b.id, i]));
  const edges = [];
  for (const b of books) for (const c of b.conn) if (idx.has(c)) edges.push([idx.get(b.id), idx.get(c)]);

  return {
    _comment: 'Bookshelf data, generated by the sync Worker from Notion. Do not hand-edit. '
      + "'books' is the library (Public?-checked rows only); 'edges' is the connection graph, "
      + 'rebuilt from each book\'s conn on every sync and never stored in Notion.',
    books,
    edges,
  };
}

// ---------------------------------------------------------------- validation gate
function validate(data) {
  const { books } = data;
  const errors = [];
  const warnings = [];

  // The check that would have caught the title wipe on its first run.
  const untitled = books.filter((b) => !b.title).length;
  if (untitled > 0) errors.push(`${untitled} of ${books.length} books have an empty title — refusing to commit`);

  if (books.length < MIN_PUBLIC_BOOKS) {
    errors.push(`only ${books.length} public books, floor is ${MIN_PUBLIC_BOOKS} — refusing to commit`);
  }

  const ids = new Set();
  for (const b of books) {
    if (!b.id) { errors.push(`book "${b.title}" has no Goodreads ID`); continue; }
    if (ids.has(b.id)) errors.push(`duplicate Goodreads ID ${b.id}`);
    ids.add(b.id);
  }

  const slugs = new Map();
  for (const b of books) {
    if (!b.slug) { warnings.push(`${b.id} "${b.title}" has no Slug — the build will generate one`); continue; }
    if (slugs.has(b.slug)) errors.push(`duplicate Slug "${b.slug}" (${slugs.get(b.slug)} and ${b.id})`);
    slugs.set(b.slug, b.id);
  }

  for (const b of books) {
    if (!b.themes.length) errors.push(`${b.id} "${b.title}" has zero themes`);
    for (const t of b.themes) if (!THEMES.has(t)) errors.push(`${b.id} has theme "${t}" outside the locked list`);
    if (b.summary.includes(CORE_DELIM)) errors.push(`${b.id} summary contains the core-ideas delimiter`);
    if (!b.shelf) warnings.push(`${b.id} "${b.title}" has no Shelf value`);
  }

  const dangling = books.flatMap((b) => b.conn.filter((c) => !ids.has(c)).map((c) => `${b.id}->${c}`));
  if (dangling.length) errors.push(`${dangling.length} dangling connection refs: ${dangling.slice(0, 5).join(', ')}`);

  // A truncated relation means links exist in Notion that never reached this file.
  const truncated = books.filter((b) => b._truncated?.length);
  if (truncated.length) {
    errors.push(
      `${truncated.length} book(s) hit Notion's 25-item relation cap — links are missing: `
      + truncated.slice(0, 5).map((b) => `${b.id} (${b._truncated.join('+')})`).join(', ')
      + '. Prune connections in Notion, or page the relation via /v1/pages/{id}/properties/{prop}.'
    );
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------- GitHub
/**
 * base64 in chunks. `btoa(String.fromCharCode(...bytes))` looks equivalent and is not:
 * spreading a half-million-element array into a call blows V8's argument limit and throws
 * RangeError. 32 kB slices stay well inside it.
 */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * The git blob SHA-1 of `content` — sha1("blob <bytelength>\0" + content).
 * Comparing this against the blob sha GitHub already returns is exact and size-independent.
 * Decoding the remote file instead would break silently above 1 MB, where the Contents API
 * stops returning `content` and every sync would look like a change.
 */
async function gitBlobSha(content) {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header, 0);
  buf.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function commitIfChanged(env, content) {
  const path = env.BOOKS_PATH || 'books.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bookshelf-notion-sync',
    'Content-Type': 'application/json',
  };

  const cur = await fetch(`${api}?ref=${branch}`, { headers });
  let sha;
  if (cur.ok) {
    const j = await cur.json();
    sha = j.sha;
    // Unchanged sync must be a no-op — every commit rebuilds Pages.
    if (sha === await gitBlobSha(content)) return { changed: false, sha };
  } else if (cur.status !== 404) {
    throw new Error(`GitHub read ${cur.status}: ${(await cur.text()).slice(0, 200)}`);
  }

  const b64 = toBase64(content);
  const put = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `sync: books.json from Notion (${new Date().toISOString().slice(0, 10)})`,
      content: b64, branch, ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) throw new Error(`GitHub write ${put.status}: ${(await put.text()).slice(0, 300)}`);
  return { changed: true, sha: (await put.json()).content.sha };
}

// ---------------------------------------------------------------- run
async function runSync(env, { dryRun = false } = {}) {
  const started = Date.now();
  const data = await buildBooksJson(env);
  const { errors, warnings } = validate(data);

  const report = {
    ok: errors.length === 0,
    books: data.books.length,
    edges: data.edges.length,
    withSlug: data.books.filter((b) => b.slug).length,
    read: data.books.filter((b) => b.shelf === 'read').length,
    currentlyReading: data.books.filter((b) => b.shelf === 'currently-reading').length,
    errors,
    warnings: warnings.slice(0, 20),
    warningCount: warnings.length,
    ms: Date.now() - started,
  };
  if (errors.length) return { ...report, committed: false, aborted: true };

  // `_truncated` is a validation-only field — it never ships.
  for (const b of data.books) delete b._truncated;
  const content = JSON.stringify(data, null, 1) + '\n';
  if (dryRun) return { ...report, committed: false, dryRun: true, bytes: content.length };

  const { changed } = await commitIfChanged(env, content);
  return { ...report, committed: changed, bytes: content.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.pathname === '/health') {
      return json({
        ok: true,
        notionVersion: NOTION_VERSION,
        minPublicBooks: MIN_PUBLIC_BOOKS,
        // Secrets report presence only — never echo a secret, even partially.
        secrets: {
          NOTION_TOKEN: !!env.NOTION_TOKEN, GITHUB_TOKEN: !!env.GITHUB_TOKEN, SYNC_SECRET: !!env.SYNC_SECRET,
        },
        // Vars echo their value: a typo here is the likeliest failure, and none is sensitive.
        vars: {
          DATA_SOURCE_ID: env.DATA_SOURCE_ID ?? null,
          TAGS_DATA_SOURCE_ID: env.TAGS_DATA_SOURCE_ID ?? null,
          GITHUB_REPO: env.GITHUB_REPO ?? null,
          GITHUB_BRANCH: env.GITHUB_BRANCH ?? 'main (default)',
          BOOKS_PATH: env.BOOKS_PATH ?? 'books.json (default)',
        },
      });
    }

    if (url.pathname === '/sync') {
      if (url.searchParams.get('key') !== env.SYNC_SECRET) return json({ error: 'unauthorized' }, 401);
      try {
        const result = await runSync(env, { dryRun: url.searchParams.get('dry') === '1' });
        return json(result, result.ok ? 200 : 422);
      } catch (err) {
        return json({ ok: false, error: String(err && err.message || err) }, 500);
      }
    }

    return json({ error: 'not found', routes: ['/sync?key=…', '/sync?key=…&dry=1', '/health'] }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runSync(env).then((r) => console.log('nightly sync', JSON.stringify(r)))
        .catch((e) => console.error('nightly sync failed', e))
    );
  },
};
```

---

## 10. What changed, and why it matters

### The title wipe

`readProp()` now dispatches on the Notion property **type**:

```js
case 'title':     return (prop.title ?? []).map(t => t.plain_text).join('').trim();
case 'rich_text': return (prop.rich_text ?? []).map(t => t.plain_text).join('').trim();
```

`Title` is the only `title`-type property in the schema. An accessor that only reads `rich_text`
empties exactly that one field and leaves the other thirteen looking healthy — which is why the
failure ran for weeks without tripping anything.

### `Slug` in the allowlist

```js
slug: readProp(P['Slug']),
```

All 321 slugs are written and verified in Notion. Until this line ships, the site falls back to its
local ledger — same URLs today, but Notion isn't actually authoritative, and an edit there goes
nowhere.

### A validation gate that aborts before the commit

Twelve conditions, tested against the live 321-book payload: ten abort, two warn (a missing Slug —
the build generates one — and a missing Shelf value). An abort returns HTTP 422 with reasons and
**does not touch GitHub**.

### Two GitHub-layer bugs, caught in test

Both found by *running* the real 0.51 MB payload, not by reading the code.

- **`btoa(String.fromCharCode(...bytes))` throws.** Spreading 538,671 array elements into a call
  blows V8's argument limit — `RangeError: Maximum call stack size exceeded`, reproduced exactly.
  Every commit would have failed. Now chunked at 32 kB.
- **Change detection broke above 1 MB.** Comparing decoded file content works today and stops
  working the moment `books.json` crosses 1 MB, where GitHub's Contents API stops returning
  `content` — after which every nightly sync looks like a change and rebuilds Pages. Now it compares
  the **git blob SHA-1**, which is exact at any size and verified against `git` itself.

At 321 books the file is 0.51 MB. The 1 MB line arrives somewhere around 600 books.

### `MIN_PUBLIC_BOOKS` raised to 300

Low enough before that a bad sync could have published a near-empty library.

---

## 11. Behaviour worth knowing before it surprises you

- **`Public?` is enforced at the source.** The Notion query filters on the checkbox, so an
  unpublished book cannot reach the file even by accident. The Worker therefore doesn't emit a
  `public` field at all; both the old SPA and the new generator treat absent as public, which is
  correct given the filter.
- **A connection to a non-public book resolves to nothing and is dropped** — checked, not assumed.
  A connection to a page with no Goodreads ID is a dangling ref and aborts.
- **`edges` are positional and rebuilt every sync** from each book's `conn`, sorted by Date Read
  ascending, undated last, Goodreads ID as tiebreaker. Never stored in Notion. A wrong read date
  silently reorders the array — which is why read-date accuracy is load-bearing, not cosmetic.
- **The 25-item relation cap is closer than it looks.** Two books sit at 22 connections. At 26 the
  extra links vanish from Notion's response — now an abort rather than a silent thinning, but the
  real fix is the connection-pruning pass already parked in the project notes.
- **Nothing flows backward.** The Worker only ever reads Notion and writes one file. It cannot
  modify Notion, and it never touches page bodies — private prose stays private because it isn't in
  an allowlisted property.
