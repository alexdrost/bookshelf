// tools/validate.mjs — SESSION 1 Step 5. Runs BEFORE rendering.
// Fails the build on any condition in §17 of the build context.

export const LAUNCH_THRESHOLD = 100;
export const TARGET_THRESHOLD = 150;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/** Per-book prose = summary word count + sum of core word counts (§13). */
export function proseWords(b) {
  return words(b.summary) + (b.core || []).reduce((n, c) => n + words(c), 0);
}

/**
 * Build each book's connection list by unioning its own `conn` with every other book
 * that references it, then dedupe, then filter to public targets.
 *
 * The union is the part that is easy to get wrong: 75 of the 1,250 pairs are one-way,
 * and without the reverse pass those 75 render on only one of the two book pages.
 */
export function buildConnectionIndex(books) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const union = new Map(books.map((b) => [b.id, new Set()]));
  const dangling = [];
  const nonPublic = [];

  for (const b of books) {
    for (const target of b.conn || []) {
      const t = byId.get(target);
      if (!t) { dangling.push({ from: b.id, to: target }); continue; }
      if (t.public === false) { nonPublic.push({ from: b.id, to: target }); continue; }
      if (b.public === false) continue;
      union.get(b.id).add(target);   // forward
      union.get(target).add(b.id);   // reverse — this is the undirected half
    }
  }
  for (const [, set] of union) set.delete(undefined);
  return { union, dangling, nonPublic, byId };
}

export function validate({ books, themes, ledger }) {
  const failures = [];
  const warnings = [];

  const themeSources = new Set(themes.map((t) => t.source));

  // --- identity ---------------------------------------------------------
  const seenIds = new Set();
  for (const b of books) {
    if (!b.id) failures.push(`book with missing id (title: "${b.title || '?'}")`);
    else if (seenIds.has(b.id)) failures.push(`duplicate id ${b.id}`);
    seenIds.add(b.id);

    if (!String(b.title || '').trim()) {
      failures.push(`book ${b.id} has an empty title`);
    }
  }

  // --- slugs ------------------------------------------------------------
  const slugCount = new Map();
  for (const b of books) {
    const s = ledger[b.id];
    if (!s) { failures.push(`book ${b.id} ("${b.title}") has no slug`); continue; }
    slugCount.set(s, (slugCount.get(s) || 0) + 1);
  }
  for (const [s, n] of slugCount) if (n > 1) failures.push(`duplicate slug "${s}" (${n} books)`);

  // --- themes -----------------------------------------------------------
  for (const b of books) {
    if (!b.themes || b.themes.length === 0) {
      failures.push(`book ${b.id} ("${b.title}") has zero themes`);
      continue;
    }
    for (const t of b.themes) {
      if (!themeSources.has(t)) failures.push(`book ${b.id} ("${b.title}") has theme "${t}" which is not in themes.json`);
    }
  }

  // --- connections ------------------------------------------------------
  const conn = buildConnectionIndex(books);
  for (const d of conn.dangling) failures.push(`book ${d.from} references unknown book id ${d.to}`);
  // Non-public targets are FILTERED, not fatal — they are a normal consequence of
  // unpublishing a book that others still link to. Reported so they stay visible.
  for (const n of conn.nonPublic) warnings.push(`connection ${n.from} -> ${n.to} points at a non-public book (filtered out of rendered lists)`);

  // --- data-quality warnings (report, never fail) -----------------------
  const missingIsbn = books.filter((b) => !String(b.isbn || '').trim());
  const zeroPages = books.filter((b) => !Number(b.pages) || String(b.pages) === '0');
  const noDate = books.filter((b) => !b.dateRead);
  if (missingIsbn.length) warnings.push(`${missingIsbn.length} books have no ISBN`);
  if (zeroPages.length) warnings.push(`${zeroPages.length} books have pages "0" (treat as missing)`);
  if (noDate.length) warnings.push(`${noDate.length} books have no read date`);

  // --- indexability gate (§13) -----------------------------------------
  const belowLaunch = [];
  const belowTarget = [];
  for (const b of books) {
    const w = proseWords(b);
    if (w < LAUNCH_THRESHOLD) belowLaunch.push({ id: b.id, title: b.title, words: w });
    else if (w < TARGET_THRESHOLD) belowTarget.push({ id: b.id, title: b.title, words: w });
  }
  belowLaunch.sort((a, b) => a.words - b.words);
  belowTarget.sort((a, b) => a.words - b.words);

  return { failures, warnings, conn, belowLaunch, belowTarget, missingIsbn, zeroPages, noDate };
}
