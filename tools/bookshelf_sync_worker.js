/**
 * bookshelf-notion-sync — Cloudflare Worker
 * Notion (Books DB)  ->  books.json + covers  ->  GitHub  ->  Cloudflare Pages
 *                    ->  Notion page icons (the one write back to Notion)
 *
 * THIS FILE IS THE ONLY CANONICAL COPY. Never rebuild the Worker from an older copy —
 * on 3 Oct 2026 a change built on a stale base silently removed /all, icon setting and the
 * shared subrequest meter. After any deploy, /health must list ICON_BASE, ICON_BATCH and
 * MAX_SUBREQUESTS.
 *
 * History, newest first
 *   Nov 2026  Re-implements the lost 13 Sep design: Notion page icons, /all, and ONE shared
 *             subrequest meter threaded through every outbound fetch. Adds `lastEdited` and
 *             `standout` to books.json.
 *   Oct 2026  amazonAsin / audibleAsin synced.
 *   Aug 2026  readProp() dispatches on property TYPE (the title-wipe fix); Slug in the
 *             allowlist; the validation gate; /covers.
 *
 * Triggers
 *   GET /all?key=SYNC_SECRET[&dry=1]      sync, then covers, then icons — one meter
 *   GET /sync?key=SYNC_SECRET[&dry=1]     books.json only
 *   GET /covers?key=SYNC_SECRET[&dry=1]   covers, then icons
 *       optional on /all and /covers: force=<gid>, limit=<n covers>, iconLimit=<n>, icons=0
 *   cron 0 8 * * *                        the same as /all
 *   GET /health                           config check, no key, no writes, no outbound calls
 *
 * Secrets (Worker secret store — never in this file)
 *   NOTION_TOKEN, GITHUB_TOKEN, SYNC_SECRET
 * Vars (all plain text)
 *   DATA_SOURCE_ID, TAGS_DATA_SOURCE_ID, GITHUB_REPO, GITHUB_BRANCH, BOOKS_PATH, COVERS_PATH,
 *   COVER_BATCH (15), ICON_BASE (https://bookshelf.drost.us/covers), ICON_BATCH (30),
 *   MAX_SUBREQUESTS (45)
 *
 * Writes, exhaustively
 *   GitHub: books.json (one PUT, only when the blob SHA differs) and covers/{gid}.jpg.
 *   Notion: PATCH /v1/pages/{id} with { icon } — nothing else, ever. No property, no body.
 */

const NOTION_VERSION = '2025-09-03';
const NOTION = 'https://api.notion.com/v1';

/** Safety floor: refuse to publish a suspiciously small library. ~341 read books live today. */
const MIN_PUBLIC_BOOKS = 300;

/** The 11 locked themes. Anything else aborts the commit. */
const THEMES = new Set([
  'Politics & Power', 'Business & Finance', 'History & Foreign Affairs',
  'Personal Growth & Leadership', 'Memoir & Biography', 'Psychology & Mind',
  'Society & Culture', 'Religion & Faith', 'Tech & Future', 'Crime & Justice', 'Other',
]);

const CORE_DELIM = '|||';

// ---------------------------------------------------------------- config + meter
const COVER_BATCH_DEFAULT = 15;
const ICON_BASE_DEFAULT = 'https://bookshelf.drost.us/covers';
const ICON_BATCH_DEFAULT = 30;
/** Cloudflare's free-plan hard cap is 50 subrequests per invocation. Budget below it. */
const MAX_SUBREQUESTS_DEFAULT = 45;
/** Headroom the cover and icon phases leave untouched. */
const SPARE = 2;

const posInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

function cfg(env) {
  return {
    coverBatch: posInt(env.COVER_BATCH, COVER_BATCH_DEFAULT),
    iconBase: String(env.ICON_BASE || ICON_BASE_DEFAULT).replace(/\/+$/, ''),
    iconBatch: posInt(env.ICON_BATCH, ICON_BATCH_DEFAULT),
    maxSub: posInt(env.MAX_SUBREQUESTS, MAX_SUBREQUESTS_DEFAULT),
  };
}

/**
 * ONE meter per invocation. Every outbound call in this file goes through mfetch(), and
 * mfetch() refuses to run without a meter, so a call that forgets to thread it fails in
 * testing instead of quietly spending budget nobody is counting.
 *
 * The bug this exists to prevent: sync and covers each believed they had the whole budget,
 * so a busy night asked for more than the platform allows and the cron died partway with
 * Cloudflare's own "Too many subrequests". Now the cover and icon phases plan against what
 * is actually left, and the hard stop below fires before the platform's does.
 */
const newMeter = (env) => ({ calls: 0, max: cfg(env).maxSub });
const room = (meter) => meter.max - meter.calls;

async function mfetch(meter, url, init) {
  if (!meter || typeof meter.calls !== 'number') throw new Error('internal: outbound fetch without a meter');
  if (meter.calls >= meter.max) {
    throw new Error(`subrequest budget spent (${meter.calls}/${meter.max}) — stopped before Cloudflare's hard cap`);
  }
  meter.calls++;
  return fetch(url, init);
}

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

/** A checkbox that may not exist yet. Missing property, or any other type, reads as false. */
const readCheckbox = (prop) => prop?.type === 'checkbox' && prop.checkbox === true;

const yyyymmdd = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '/') : '');

// ---------------------------------------------------------------- Notion
const notionHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
});

async function notionQueryAll(dataSourceId, token, body, meter) {
  const rows = [];
  let cursor;
  do {
    const res = await mfetch(meter, `${NOTION}/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ ...(body || {}), page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status} on ${dataSourceId}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return rows;
}

/**
 * Public? is the ONLY visibility gate — filter at the source so nothing unpublished can
 * reach the file even by accident. /all and the cron call this once and hand the same rows
 * to sync and to covers, which saves a full re-query (4 subrequests at ~380 books).
 */
const fetchPublicPages = (env, meter) => notionQueryAll(env.DATA_SOURCE_ID, env.NOTION_TOKEN, {
  filter: { property: 'Public?', checkbox: { equals: true } },
}, meter);

/** The page's current icon URL if it is an external icon; anything else (none, emoji,
 *  uploaded file) reads as null and so never equals the wanted URL. Zero calls: the query
 *  result already carries the page object. */
const externalIconUrl = (page) => (page?.icon?.type === 'external' ? page.icon.external?.url ?? null : null);
const iconLabel = (page) => (page?.icon ? (externalIconUrl(page) || `(${page.icon.type})`) : '(none)');

/** THE ONLY WRITE TO NOTION IN THIS FILE. Sets the page icon and nothing else. */
async function setPageIcon(env, pageId, url, meter) {
  const res = await mfetch(meter, `${NOTION}/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_TOKEN),
    body: JSON.stringify({ icon: { type: 'external', external: { url } } }),
  });
  if (!res.ok) {
    const err = new Error(`Notion ${res.status} on icon PATCH: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
}

// ---------------------------------------------------------------- build books.json
async function buildBooksJson(env, { meter, pages: given } = {}) {
  const token = env.NOTION_TOKEN;

  const pages = given || await fetchPublicPages(env, meter);

  // Tag relation -> tag name.
  const tagPages = await notionQueryAll(env.TAGS_DATA_SOURCE_ID, token, {}, meter);
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
      // The two ASINs, not the two "... link" formulas. Same choice the site already
      // makes for Goodreads: sync the ID and derive the URL at build time. Formulas are
      // read-only and would couple the site's links to a Notion expression that can be
      // edited out from under it; an ASIN is just data.
      // Amazon ASIN is an OVERRIDE and is usually blank — the Amazon URL normally comes
      // from the ISBN above. Audible ASIN is the only source for an Audible link, so a
      // blank one simply means no link.
      amazonAsin: readProp(P['Amazon ASIN']),
      audibleAsin: readProp(P['Audible ASIN']),
      pages: readProp(P['Pages']),
      yearPub: readProp(P['Year Published']),
      dateRead,
      yearRead: dateRead ? dateRead.slice(0, 4) : '',
      shelf: readProp(P['Shelf']),
      slug: readProp(P['Slug']),                   // Notion owns the URL
      // Page metadata, not a property. Drives the currently-reading order on /up-next.
      // Any edit to the page bumps it — including this Worker's own icon PATCH, so the
      // sync after an icon is set commits once more. That is expected, not churn.
      lastEdited: p.last_edited_time || '',
      // The "Standout" checkbox. False until the property exists in Notion.
      standout: readCheckbox(P['Standout']),
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

/** Two calls when it writes (GET + PUT), one when nothing changed. */
async function commitIfChanged(env, content, meter) {
  const path = env.BOOKS_PATH || 'books.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = ghHeaders(env);

  const cur = await mfetch(meter, `${api}?ref=${branch}`, { headers });
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
  const put = await mfetch(meter, api, {
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
async function listDir(env, dirPath, meter) {
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await mfetch(
    meter,
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

async function putBinary(env, filePath, bytes, existingSha, meter) {
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`;
  if (existingSha && existingSha === await gitBlobShaBytes(bytes)) return { changed: false };
  const put = await mfetch(meter, api, {
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

/** Icon failures that will fail identically for every remaining page. Stop, don't burn budget. */
const ICON_STOP = {
  401: 'Notion token rejected (401) — icons stopped for this run',
  403: "Notion refused the icon write (403) — the integration probably lacks the 'Update content' capability",
  429: 'Notion rate-limited the icon writes (429) — the rest wait for the next run',
};

/**
 * Covers, then icons. Each cover costs two subrequests (image fetch + GitHub PUT); each icon
 * costs one. Covers go first and take what they need up to the batch; icons take whatever the
 * meter has left, less SPARE. Run alone (/covers) it brings its own meter; chained (/all, cron)
 * it is handed the shared one and the rows sync already fetched.
 */
async function runCoverSync(env, {
  dryRun = false, force = '', limit = 0, iconLimit = 0, icons = true, meter: given, pages: givenPages,
  projectExtra = 0,
} = {}) {
  const started = Date.now();
  const c = cfg(env);
  const meter = given || newMeter(env);
  const dir = env.COVERS_PATH || 'covers';
  const batch = limit || c.coverBatch;
  const iconCap = iconLimit || c.iconBatch;

  const pages = givenPages || await fetchPublicPages(env, meter);
  const { files: existing, truncated } = await listDir(env, dir, meter);

  const skipped = [];
  const noCover = [];
  const candidates = [];
  const iconQueue = [];          // cover already in the repo, icon is not the wanted URL
  let iconsCorrect = 0;
  for (const p of pages) {
    const id = readProp(p.properties['Goodreads ID']);
    const title = readProp(p.properties['Title']);
    // No join key means no filename and no icon URL. Never invent one.
    if (!id) { noCover.push({ id: null, title, why: 'no Goodreads ID — skipped for covers and icons' }); continue; }

    const name = `${id}.jpg`;
    const wantedIcon = `${c.iconBase}/${name}`;
    const currentIcon = externalIconUrl(p);
    const iconOk = currentIcon === wantedIcon;
    if (existing.has(name)) {
      if (iconOk) iconsCorrect++;
      else iconQueue.push({ pageId: p.id, id, title, url: wantedIcon, was: iconLabel(p) });
    }

    const ref = readFileRef(p.properties['Cover Image']);
    if (!ref?.url) { noCover.push({ id, title, why: ref ? `attachment has no URL (type ${ref.kind})` : 'no Cover Image attached' }); continue; }
    const isForced = force && force === id;
    if (existing.has(name) && !isForced) { skipped.push(name); continue; }
    candidates.push({
      id, title, name, url: ref.url, sourceName: ref.name, sha: existing.get(name) || null,
      pageId: p.id, wantedIcon, iconOk, was: iconLabel(p),
    });
  }

  const todo = candidates.slice(0, batch);
  // Covers that fit the meter. Two calls each, SPARE untouched. A dry run inside /all adds
  // back the books.json GET + PUT its own dry sync skipped, so the projection is honest.
  const base = meter.calls + (dryRun ? projectExtra : 0);
  const fits = Math.max(0, Math.min(todo.length, Math.floor((meter.max - base - SPARE) / 2)));

  const report = {
    ok: true,
    coversInRepo: existing.size,
    publicBooks: pages.length,
    alreadyPresent: skipped.length,
    missing: candidates.length,
    attempted: 0,
    remaining: candidates.length,
    deferredForBudget: todo.length - fits,
    committed: 0,
    unchanged: 0,
    written: [],
    iconsCorrect,
    iconsNeeded: 0,
    iconsSet: 0,
    iconsFailed: 0,
    iconsRemaining: 0,
    iconsSetFor: [],
    subrequests: 0,
    subrequestCap: meter.max,
    warnings: [],
    ms: 0,
  };
  if (truncated) report.warnings.push(`${dir}/ listing hit the 1,000-entry API cap — results may be incomplete`);
  for (const n of noCover) report.warnings.push(`${n.id ?? '(no id)'} "${n.title}": ${n.why}`);
  if (report.deferredForBudget) {
    report.warnings.push(`${report.deferredForBudget} cover(s) deferred — subrequest budget (${meter.calls}/${meter.max} used before covers)`);
  }

  const iconRoom = (used) => Math.max(0, Math.min(iconCap, meter.max - used - SPARE));
  const finish = () => {
    report.iconsRemaining = report.iconsNeeded - report.iconsSet;
    report.subrequests = meter.calls;
    report.ms = Date.now() - started;
    return report;
  };

  // ------------------------------------------------------------ dry run: zero writes
  if (dryRun) {
    const willWrite = todo.slice(0, fits);
    // Project exactly what a real run would do: those covers cost 2 each, and each one that
    // lands queues its icon ahead of the existing backlog.
    const queued = willWrite.filter((x) => !x.sha && !x.iconOk)
      .map((x) => ({ id: x.id, url: x.wantedIcon }));
    const queue = [...queued, ...iconQueue];
    const projected = base + 2 * willWrite.length;
    report.dryRun = true;
    report.attempted = 0;
    report.wouldWrite = willWrite.map((x) => `${x.name}  <-  ${x.sourceName || '(unnamed)'}`);
    report.iconsNeeded = queue.length;
    report.wouldSetIcon = icons ? queue.slice(0, iconRoom(projected)).map((q) => `${q.id} -> ${q.url}`) : [];
    if (!icons) report.iconsSkipped = true;
    report.projectedSubrequests = projected + report.wouldSetIcon.length;
    return finish();
  }

  // ------------------------------------------------------------ covers
  const newIcons = [];
  for (const x of todo.slice(0, fits)) {
    report.attempted++;
    try {
      const res = await mfetch(meter, x.url);
      if (!res.ok) { report.warnings.push(`${x.name}: Notion returned ${res.status} for the image`); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());

      const kind = imageKind(bytes);
      if (kind === 'too-small' || bytes.length < 1024) {
        report.warnings.push(`${x.name}: only ${bytes.length} bytes — not a real image, skipped`);
        continue;
      }
      if (bytes.length > 5 * 1024 * 1024) {
        report.warnings.push(`${x.name}: ${(bytes.length / 1048576).toFixed(1)} MB — too large for a cover, skipped`);
        continue;
      }
      if (kind !== 'jpeg') {
        report.warnings.push(`${x.name}: source is ${kind}, not JPEG — written anyway, but re-save it as JPEG when convenient`);
      }

      const { changed } = await putBinary(env, `${dir}/${x.name}`, bytes, x.sha, meter);
      if (changed) {
        report.committed++;
        report.written.push(`${x.name} (${(bytes.length / 1024).toFixed(0)} kB, ${kind})`);
        // A new cover queues its icon. A forced replacement keeps the same URL, so its icon
        // was already counted above from the existing-cover pass.
        if (!x.sha && !x.iconOk) newIcons.push({ pageId: x.pageId, id: x.id, title: x.title, url: x.wantedIcon, was: x.was });
      } else report.unchanged++;
    } catch (err) {
      report.ok = false;
      report.warnings.push(`${x.name}: ${String(err && err.message || err)}`);
    }
  }
  report.remaining = candidates.length - report.attempted;

  // ------------------------------------------------------------ icons
  const queue = [...newIcons, ...iconQueue];
  report.iconsNeeded = queue.length;
  if (!icons) {
    report.iconsSkipped = true;
    return finish();
  }
  const n = Math.min(queue.length, iconRoom(meter.calls));
  for (const q of queue.slice(0, n)) {
    try {
      await setPageIcon(env, q.pageId, q.url, meter);
      report.iconsSet++;
      report.iconsSetFor.push(`${q.id} "${q.title}"  ${q.was} -> ${q.url}`);
    } catch (err) {
      // An icon failure is a warning. It never fails the run.
      report.iconsFailed++;
      report.warnings.push(`icon ${q.id} "${q.title}": ${String(err && err.message || err)}`);
      if (ICON_STOP[err && err.status]) { report.iconsBlocked = ICON_STOP[err.status]; break; }
    }
  }
  return finish();
}

// ---------------------------------------------------------------- run
const isReading = (b) => b.shelf === 'reading' || b.shelf === 'currently-reading';

async function runSync(env, { dryRun = false, meter: given, pages } = {}) {
  const started = Date.now();
  const meter = given || newMeter(env);
  const data = await buildBooksJson(env, { meter, pages });
  const { errors, warnings } = validate(data);

  const report = {
    ok: errors.length === 0,
    books: data.books.length,
    edges: data.edges.length,
    withSlug: data.books.filter((b) => b.slug).length,
    read: data.books.filter((b) => b.shelf === 'read').length,
    currentlyReading: data.books.filter(isReading).length,
    standouts: data.books.filter((b) => b.standout).length,
    errors,
    warnings: warnings.slice(0, 20),
    warningCount: warnings.length,
    ms: Date.now() - started,
  };
  const done = (o) => ({ ...report, ...o, subrequests: meter.calls, subrequestCap: meter.max });
  if (errors.length) return done({ committed: false, aborted: true });

  // `_truncated` is a validation-only field — it never ships.
  for (const b of data.books) delete b._truncated;
  const content = JSON.stringify(data, null, 1) + '\n';
  if (dryRun) return done({ committed: false, dryRun: true, bytes: content.length });

  const { changed } = await commitIfChanged(env, content, meter);
  return done({ committed: changed, bytes: content.length });
}

/**
 * Sync, then covers, then icons — on ONE meter, from ONE Notion query.
 *
 * Sync goes first so the catalogue always gets first claim on the budget: covers and icons
 * are cosmetic and simply take what is left. Each half is caught separately, so a cover or
 * icon problem can never stop books.json syncing, and a sync abort (422) still lets covers run.
 */
async function runAll(env, { dryRun = false, force = '', limit = 0, iconLimit = 0, icons = true } = {}) {
  const started = Date.now();
  const meter = newMeter(env);
  const pages = await fetchPublicPages(env, meter);

  let sync;
  try { sync = await runSync(env, { dryRun, meter, pages }); }
  catch (err) { sync = { ok: false, committed: false, error: String(err && err.message || err) }; }

  let covers;
  // A real sync that commits spends 2 calls (GET + PUT) a dry sync does not; the dry
  // projection reserves them so wouldSetIcon matches what the real click will do.
  const projectExtra = dryRun && sync.ok ? 2 : 0;
  try { covers = await runCoverSync(env, { dryRun, force, limit, iconLimit, icons, meter, pages, projectExtra }); }
  catch (err) { covers = { ok: false, error: String(err && err.message || err) }; }

  const coversRemaining = covers.remaining ?? 0;
  const iconsRemaining = covers.iconsRemaining ?? 0;
  return {
    ok: !!(sync.ok && covers.ok),
    ...(dryRun ? { dryRun: true } : {}),
    committed: !!sync.committed,                 // books.json
    coversCommitted: covers.committed ?? 0,
    coversRemaining,
    iconsSet: covers.iconsSet ?? 0,
    iconsRemaining,
    ...(covers.iconsBlocked ? { iconsBlocked: covers.iconsBlocked } : {}),
    ...(dryRun ? { wouldSetIcon: covers.wouldSetIcon ?? [], projectedSubrequests: covers.projectedSubrequests } : {}),
    // A dry run writes nothing, so "click again" only means something on a real run. A
    // blocked icon phase (401/403) will not clear by clicking, so it does not count.
    clickAgain: !dryRun && !covers.error && (
      coversRemaining > 0 || (icons && !covers.iconsBlocked && iconsRemaining > 0)
    ),
    subrequests: meter.calls,
    subrequestCap: meter.max,
    ms: Date.now() - started,
    sync,
    covers,
  };
}

// ---------------------------------------------------------------- routes
const coverOpts = (url) => ({
  dryRun: url.searchParams.get('dry') === '1',
  force: url.searchParams.get('force') || '',
  limit: Number(url.searchParams.get('limit')) || 0,
  iconLimit: Number(url.searchParams.get('iconLimit')) || 0,
  icons: url.searchParams.get('icons') !== '0',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
    const authed = () => url.searchParams.get('key') === env.SYNC_SECRET && !!env.SYNC_SECRET;

    if (url.pathname === '/health') {
      return json({
        ok: true,
        notionVersion: NOTION_VERSION,
        minPublicBooks: MIN_PUBLIC_BOOKS,
        routes: ['/all', '/sync', '/covers', '/health'],
        // Secrets report presence only — never echo a secret, even partially.
        secrets: {
          NOTION_TOKEN: !!env.NOTION_TOKEN, GITHUB_TOKEN: !!env.GITHUB_TOKEN, SYNC_SECRET: !!env.SYNC_SECRET,
        },
        // Vars echo their value: a typo here is the likeliest failure, and none is sensitive.
        // "(default)" means the var is not set and the built-in default is in force.
        vars: {
          DATA_SOURCE_ID: env.DATA_SOURCE_ID ?? null,
          TAGS_DATA_SOURCE_ID: env.TAGS_DATA_SOURCE_ID ?? null,
          GITHUB_REPO: env.GITHUB_REPO ?? null,
          GITHUB_BRANCH: env.GITHUB_BRANCH ?? 'main (default)',
          BOOKS_PATH: env.BOOKS_PATH ?? 'books.json (default)',
          COVERS_PATH: env.COVERS_PATH ?? 'covers (default)',
          COVER_BATCH: env.COVER_BATCH ?? `${COVER_BATCH_DEFAULT} (default)`,
          ICON_BASE: env.ICON_BASE ?? `${ICON_BASE_DEFAULT} (default)`,
          ICON_BATCH: env.ICON_BATCH ?? `${ICON_BATCH_DEFAULT} (default)`,
          MAX_SUBREQUESTS: env.MAX_SUBREQUESTS ?? `${MAX_SUBREQUESTS_DEFAULT} (default)`,
        },
      });
    }

    if (url.pathname === '/all') {
      if (!authed()) return json({ error: 'unauthorized' }, 401);
      try {
        const result = await runAll(env, coverOpts(url));
        return json(result, result.ok ? 200 : (result.sync?.aborted ? 422 : 500));
      } catch (err) {
        return json({ ok: false, error: String(err && err.message || err) }, 500);
      }
    }

    if (url.pathname === '/sync') {
      if (!authed()) return json({ error: 'unauthorized' }, 401);
      try {
        const result = await runSync(env, { dryRun: url.searchParams.get('dry') === '1' });
        return json(result, result.ok ? 200 : 422);
      } catch (err) {
        return json({ ok: false, error: String(err && err.message || err) }, 500);
      }
    }

    if (url.pathname === '/covers') {
      if (!authed()) return json({ error: 'unauthorized' }, 401);
      try {
        const result = await runCoverSync(env, coverOpts(url));
        return json(result, result.ok ? 200 : 500);
      } catch (err) {
        return json({ ok: false, error: String(err && err.message || err) }, 500);
      }
    }

    return json({
      error: 'not found',
      routes: ['/all?key=…', '/all?key=…&dry=1', '/sync?key=…', '/sync?key=…&dry=1',
        '/covers?key=…', '/covers?key=…&dry=1', '/health'],
    }, 404);
  },

  // Nightly: exactly /all, on one meter. runAll already isolates sync from covers and icons.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runAll(env)
        .then((r) => {
          const { sync, covers, ...top } = r;
          console.log('nightly all', JSON.stringify(top));
          console.log('nightly sync', JSON.stringify(sync));
          console.log('nightly covers+icons', JSON.stringify(covers));
        })
        .catch((e) => console.error('nightly run failed', e))
    );
  },
};
