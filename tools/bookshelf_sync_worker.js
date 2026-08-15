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
 *
 * Takes bytes, not a string, so the same path serves JSON and JPEGs.
 */
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
const toBase64 = (str) => bytesToBase64(new TextEncoder().encode(str));

/**
 * The git blob SHA-1 of `bytes` — sha1("blob <bytelength>\0" + bytes).
 * Comparing this against the blob sha GitHub already returns is exact and size-independent.
 * Decoding the remote file instead would break silently above 1 MB, where the Contents API
 * stops returning `content` and every sync would look like a change.
 */
async function gitBlobShaBytes(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const gitBlobSha = (content) => gitBlobShaBytes(new TextEncoder().encode(content));

const ghHeaders = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'bookshelf-notion-sync',
  'Content-Type': 'application/json',
});

async function commitIfChanged(env, content) {
  const path = env.BOOKS_PATH || 'books.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = ghHeaders(env);

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

// ================================================================= COVER SYNC
// Notion -> GitHub, one image per public book, always written as {Goodreads ID}.jpg.
//
// The filename you give the image in Notion is deliberately ignored. The Goodreads ID is the
// join key for the whole system — covers, edges, page URLs — and a hand-typed filename is
// exactly how a cover ends up attached to the wrong book. Drag in IMG_4471.jpg; it lands right.

/** Magic-byte sniff. The site serves everything from a .jpg path, so a PNG still renders — but
 *  it's worth saying so out loud rather than silently mislabelling the bytes. */
function imageKind(bytes) {
  const b = bytes;
  if (b.length < 12) return 'too-small';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return 'unknown';
}

/** First attachment on a files-type property, as {url, name, kind}. Handles Notion-hosted
 *  (expiring signed URL), external, and the newer file_upload shape. */
function readFileRef(prop) {
  const f = (prop?.files ?? [])[0];
  if (!f) return null;
  return {
    url: f.file?.url ?? f.external?.url ?? f.file_upload?.url ?? null,
    name: f.name ?? '',
    kind: f.type ?? 'unknown',
  };
}

/** Existing files in a repo directory, as name -> blob sha. Missing directory = empty map. */
async function listDir(env, dirPath) {
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${dirPath}?ref=${branch}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return { files: new Map(), truncated: false };
  if (!res.ok) throw new Error(`GitHub list ${res.status} on ${dirPath}: ${(await res.text()).slice(0, 200)}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error(`${dirPath} is a file, not a directory`);
  return {
    files: new Map(arr.filter((e) => e.type === 'file').map((e) => [e.name, e.sha])),
    // The Contents API caps a directory listing at 1,000 entries and gives no warning.
    truncated: arr.length >= 1000,
  };
}

async function putBinary(env, filePath, bytes, existingSha) {
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`;
  if (existingSha && existingSha === await gitBlobShaBytes(bytes)) return { changed: false };
  const put = await fetch(api, {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: `sync: cover ${filePath.split('/').pop()} from Notion`,
      content: bytesToBase64(bytes),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!put.ok) throw new Error(`GitHub write ${put.status} on ${filePath}: ${(await put.text()).slice(0, 200)}`);
  return { changed: true };
}

/**
 * Free-plan Workers allow 50 subrequests per invocation; each cover costs two (fetch from
 * Notion, PUT to GitHub). Overheads take ~6. Hence a conservative default batch — the steady
 * state is nought to three new covers at a time, so this only bites on a cold backfill, and
 * even then the response reports what's left so you can just click again.
 */
const COVER_BATCH_DEFAULT = 15;

async function runCoverSync(env, { dryRun = false, force = '', limit = 0 } = {}) {
  const started = Date.now();
  const dir = env.COVERS_PATH || 'covers';
  const batch = limit || Number(env.COVER_BATCH) || COVER_BATCH_DEFAULT;

  const pages = await notionQueryAll(env.DATA_SOURCE_ID, env.NOTION_TOKEN, {
    filter: { property: 'Public?', checkbox: { equals: true } },
  });

  const { files: existing, truncated } = await listDir(env, dir);

  const skipped = [];
  const noCover = [];
  const candidates = [];
  for (const p of pages) {
    const id = readProp(p.properties['Goodreads ID']);
    const title = readProp(p.properties['Title']);
    // No join key means no filename. Never invent one.
    if (!id) { noCover.push({ id: null, title, why: 'no Goodreads ID' }); continue; }
    const ref = readFileRef(p.properties['Cover Image']);
    if (!ref?.url) { noCover.push({ id, title, why: ref ? `attachment has no URL (type ${ref.kind})` : 'no Cover Image attached' }); continue; }
    const name = `${id}.jpg`;
    const isForced = force && force === id;
    if (existing.has(name) && !isForced) { skipped.push(name); continue; }
    candidates.push({ id, title, name, url: ref.url, sourceName: ref.name, sha: existing.get(name) || null });
  }

  const todo = candidates.slice(0, batch);
  const report = {
    ok: true,
    coversInRepo: existing.size,
    publicBooks: pages.length,
    alreadyPresent: skipped.length,
    missing: candidates.length,
    attempted: todo.length,
    remaining: candidates.length - todo.length,
    committed: 0,
    unchanged: 0,
    written: [],
    warnings: [],
    ms: 0,
  };
  if (truncated) report.warnings.push(`${dir}/ listing hit the 1,000-entry API cap — results may be incomplete`);
  for (const n of noCover) report.warnings.push(`${n.id ?? '(no id)'} "${n.title}": ${n.why}`);

  if (dryRun) {
    report.dryRun = true;
    report.wouldWrite = todo.map((c) => `${c.name}  <-  ${c.sourceName || '(unnamed)'}`);
    report.ms = Date.now() - started;
    return report;
  }

  for (const c of todo) {
    try {
      const res = await fetch(c.url);
      if (!res.ok) { report.warnings.push(`${c.name}: Notion returned ${res.status} for the image`); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());

      const kind = imageKind(bytes);
      if (kind === 'too-small' || bytes.length < 1024) {
        report.warnings.push(`${c.name}: only ${bytes.length} bytes — not a real image, skipped`);
        continue;
      }
      if (bytes.length > 5 * 1024 * 1024) {
        report.warnings.push(`${c.name}: ${(bytes.length / 1048576).toFixed(1)} MB — too large for a cover, skipped`);
        continue;
      }
      if (kind !== 'jpeg') {
        report.warnings.push(`${c.name}: source is ${kind}, not JPEG — written anyway, but re-save it as JPEG when convenient`);
      }

      const { changed } = await putBinary(env, `${dir}/${c.name}`, bytes, c.sha);
      if (changed) { report.committed++; report.written.push(`${c.name} (${(bytes.length / 1024).toFixed(0)} kB, ${kind})`); }
      else report.unchanged++;
    } catch (err) {
      report.ok = false;
      report.warnings.push(`${c.name}: ${String(err && err.message || err)}`);
    }
  }

  report.ms = Date.now() - started;
  return report;
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
          COVERS_PATH: env.COVERS_PATH ?? 'covers (default)',
          COVER_BATCH: env.COVER_BATCH ?? `${COVER_BATCH_DEFAULT} (default)`,
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

    if (url.pathname === '/covers') {
      if (url.searchParams.get('key') !== env.SYNC_SECRET) return json({ error: 'unauthorized' }, 401);
      try {
        const result = await runCoverSync(env, {
          dryRun: url.searchParams.get('dry') === '1',
          force: url.searchParams.get('force') || '',
          limit: Number(url.searchParams.get('limit')) || 0,
        });
        return json(result, result.ok ? 200 : 500);
      } catch (err) {
        return json({ ok: false, error: String(err && err.message || err) }, 500);
      }
    }

    return json({
      error: 'not found',
      routes: ['/sync?key=…', '/sync?key=…&dry=1', '/covers?key=…', '/covers?key=…&dry=1', '/health'],
    }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // Books first, and covers in their own try/catch: a cover problem must never be able to
      // stop books.json syncing. Covers are cosmetic; the catalogue is not.
      try {
        console.log('nightly sync', JSON.stringify(await runSync(env)));
      } catch (e) {
        console.error('nightly sync failed', e);
      }
      try {
        console.log('nightly covers', JSON.stringify(await runCoverSync(env, { limit: 10 })));
      } catch (e) {
        console.error('nightly cover sync failed', e);
      }
    })());
  },
};
