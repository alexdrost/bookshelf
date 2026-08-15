// tools/derive.mjs — build-time computations for SESSION 2 and 3.
// Everything here is derived from `conn`. Nothing reads `edges`.

/** Undirected, deduped, public-and-read connection map: id -> Set(id). */
export function connectionMap(books) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const eligible = (b) => b && b.public !== false && b.shelf === 'read';
  const map = new Map(books.map((b) => [b.id, new Set()]));
  for (const b of books) {
    for (const t of b.conn || []) {
      const other = byId.get(t);
      if (!other) continue;                 // dangling — caught by the validator
      if (t === b.id) continue;             // never link a book to itself
      if (!eligible(b) || !eligible(other)) continue;
      map.get(b.id).add(t);                 // forward
      map.get(t).add(b.id);                 // reverse — 75 pairs are one-way
    }
  }
  return map;
}

export function uniquePairs(map) {
  const seen = new Set();
  for (const [id, set] of map) for (const t of set) seen.add([id, t].sort().join('|'));
  return seen;
}

/**
 * Bridge books — the books whose connections reach the most distinct themes.
 * Free internal linking, and genuinely the most interesting derived list on the site.
 */
export function bridgeBooks(books, map, limit = 12) {
  const byId = new Map(books.map((b) => [b.id, b]));
  return books
    .filter((b) => b.public !== false && b.shelf === 'read')
    .map((b) => {
      const themes = new Set();
      for (const t of map.get(b.id) || []) for (const th of byId.get(t)?.themes || []) themes.add(th);
      return { book: b, themeCount: themes.size, themes: [...themes], degree: (map.get(b.id) || new Set()).size };
    })
    .sort((a, b) => b.themeCount - a.themeCount || b.degree - a.degree || String(a.book.id).localeCompare(String(b.book.id)))
    .slice(0, limit);
}

/**
 * Theme-to-theme connection density. Each connected pair contributes to every
 * combination of one book's themes with the other's. Symmetric; the diagonal counts
 * within-theme links.
 */
export function themeMatrix(books, map, themeNames) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const idx = new Map(themeNames.map((t, i) => [t, i]));
  const m = themeNames.map(() => themeNames.map(() => 0));
  for (const key of uniquePairs(map)) {
    const [a, b] = key.split('|');
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B) continue;
    for (const ta of A.themes || []) {
      for (const tb of B.themes || []) {
        const i = idx.get(ta), j = idx.get(tb);
        if (i == null || j == null) continue;
        if (i === j) m[i][j] += 1;
        else { m[i][j] += 1; m[j][i] += 1; }
      }
    }
  }
  return m;
}

/** Flattened cross-theme densities, strongest first. */
export function matrixPairs(matrix, themeNames) {
  const out = [];
  for (let i = 0; i < themeNames.length; i++) {
    for (let j = i + 1; j < themeNames.length; j++) {
      if (matrix[i][j]) out.push({ a: themeNames[i], b: themeNames[j], n: matrix[i][j] });
    }
  }
  return out.sort((x, y) => y.n - x.n);
}

/**
 * Featured connection pairs. Alex's hand-written pairs are the intended source
 * (§19 open item 3); until those land this picks the pairs with the strongest shared
 * footing — most shared themes, then most shared tags, then closest read dates —
 * so the module ships with real content rather than a placeholder.
 */
export function featuredPairs(books, map, limit = 18) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const tagSet = (b) => new Set(String(b.tags || '').split(',').map((s) => s.trim()).filter(Boolean));
  const scored = [];
  for (const key of uniquePairs(map)) {
    const [ia, ib] = key.split('|');
    const A = byId.get(ia), B = byId.get(ib);
    if (!A || !B) continue;
    const sharedThemes = (A.themes || []).filter((t) => (B.themes || []).includes(t));
    const ta = tagSet(A), tb = tagSet(B);
    const sharedTags = [...ta].filter((t) => tb.has(t));
    if (!sharedThemes.length || !sharedTags.length) continue;
    const gapDays = Math.abs(new Date(String(A.dateRead || '').replace(/\//g, '-')) - new Date(String(B.dateRead || '').replace(/\//g, '-'))) / 86400000;
    scored.push({
      a: A, b: B, sharedThemes, sharedTags,
      score: sharedTags.length * 10 + sharedThemes.length * 4 - (isFinite(gapDays) ? Math.min(gapDays / 365, 4) : 4),
    });
  }
  scored.sort((x, y) => y.score - x.score || String(x.a.id).localeCompare(String(y.a.id)));
  // Don't let one book dominate the module.
  const used = new Map();
  const out = [];
  for (const p of scored) {
    const na = used.get(p.a.id) || 0, nb = used.get(p.b.id) || 0;
    if (na >= 2 || nb >= 2) continue;
    used.set(p.a.id, na + 1); used.set(p.b.id, nb + 1);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** Distribution of yearRead − yearPub. */
export function publicationLag(books) {
  const gaps = books
    .map((b) => (b.yearRead && /\d/.test(b.yearPub || '') ? +b.yearRead - parseInt(b.yearPub, 10) : null))
    .filter((g) => g != null && g >= 0)
    .sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  return { gaps, median: med, withinTwo: gaps.filter((g) => g <= 2).length, total: gaps.length };
}

/** Longest run of consecutive months with a finish, and the longest drought. */
export function streaksAndGaps(books) {
  const months = new Set();
  for (const b of books) {
    const m = /^(\d{4})\/(\d{2})/.exec(b.dateRead || '');
    if (m) months.add(`${m[1]}-${m[2]}`);
  }
  const keys = [...months].sort();
  if (!keys.length) return { longestStreak: 0, longestGap: 0, streakFrom: '', streakTo: '', gapFrom: '', gapTo: '' };
  const toIndex = (k) => { const [y, m] = k.split('-').map(Number); return y * 12 + (m - 1); };
  const idxs = keys.map(toIndex);
  let best = 1, cur = 1, bestEnd = 0, gap = 0, gapAt = 0;
  for (let i = 1; i < idxs.length; i++) {
    const d = idxs[i] - idxs[i - 1];
    if (d === 1) { cur++; if (cur > best) { best = cur; bestEnd = i; } }
    else { cur = 1; if (d - 1 > gap) { gap = d - 1; gapAt = i; } }
  }
  return {
    longestStreak: best, longestGap: gap,
    streakFrom: keys[bestEnd - best + 1], streakTo: keys[bestEnd],
    gapFrom: keys[gapAt - 1], gapTo: keys[gapAt],
  };
}

/** Cumulative pages over time, one point per month with a finish. */
export function cumulativePages(books) {
  const byMonth = new Map();
  let total = 0;
  for (const b of books) {
    const m = /^(\d{4})\/(\d{2})/.exec(b.dateRead || '');
    const p = parseInt(b.pages, 10);
    if (!m || !isFinite(p) || p <= 0) continue;
    const k = `${m[1]}-${m[2]}`;
    byMonth.set(k, (byMonth.get(k) || 0) + p);
    total += p;
  }
  const keys = [...byMonth.keys()].sort();
  let run = 0;
  return { total, points: keys.map((k) => ({ month: k, pages: byMonth.get(k), cumulative: (run += byMonth.get(k)) })) };
}
