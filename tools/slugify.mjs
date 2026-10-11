// tools/slugify.mjs — SESSION 1 Step 4.
// Slugs are DATA, not a derivation. Generated once, then frozen forever.
//
// Rules (verbatim from the handoff):
//   1. Take the title segment before the first colon.
//   2. Lowercase; replace non-alphanumerics with hyphens; collapse repeats; trim.
//   3. Keep articles and prepositions. Do NOT strip stopwords.
//   4. Truncate at 60 characters on a word boundary.
//   5. On collision, append the author's surname. On a second collision, append the Goodreads ID.
//   6. Write back only where the slug is empty. NEVER overwrite an existing slug.

const MAX = 60;

/** Strip diacritics so accented letters become their ASCII base rather than vanishing. */
function deaccent(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Rules 1–4. Pure; no collision handling. */
export function baseSlug(title) {
  const beforeColon = String(title).split(':')[0];
  let s = deaccent(beforeColon)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (s.length <= MAX) return s;
  // Rule 4: truncate at 60 chars on a word boundary.
  s = s.slice(0, MAX + 1);
  const cut = s.lastIndexOf('-');
  return (cut > 0 ? s.slice(0, cut) : s.slice(0, MAX)).replace(/-+$/, '');
}

/** Last whitespace-delimited token of the first listed author. */
export function surname(author) {
  const first = String(author || '').split(',')[0].trim();
  const parts = first.split(/\s+/).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : '';
  return deaccent(last).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Deterministic ordering for first-come-wins collision resolution.
 * Project convention: Date Read ascending, undated last, Goodreads ID as tiebreaker.
 * Without a stable order, which book "wins" a contested slug could change between runs.
 */
export function catalogOrder(a, b) {
  const ad = a.dateRead || '';
  const bd = b.dateRead || '';
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
}

/**
 * Assign slugs to any book that does not already have one in the ledger.
 * @param {Array} books        books with {id, title, author, dateRead}
 * @param {Object} ledger      existing id -> slug map (authoritative, never mutated in place)
 * @returns {{ledger: Object, written: Array, report: Array}}
 */
export function assignSlugs(books, ledger) {
  const next = { ...ledger };
  const taken = new Set(Object.values(next));
  const written = [];
  const report = [];

  for (const b of [...books].sort(catalogOrder)) {
    // Rule 6 — the whole point. An existing slug is untouchable.
    if (next[b.id]) continue;

    const base = baseSlug(b.title);
    if (!base) {
      report.push({ id: b.id, level: 'error', msg: `title "${b.title}" produced an empty slug` });
      continue;
    }

    let slug = base;
    let strategy = 'base';
    if (taken.has(slug)) {
      const sn = surname(b.author);
      slug = sn ? `${base}-${sn}` : base;
      strategy = 'surname';
      if (!sn || taken.has(slug)) {
        slug = `${base}-${b.id}`;
        strategy = 'goodreads-id';
      }
    }
    if (taken.has(slug)) {
      report.push({ id: b.id, level: 'error', msg: `could not resolve collision for "${base}"` });
      continue;
    }

    next[b.id] = slug;
    taken.add(slug);
    written.push({ id: b.id, title: b.title, slug, strategy });

    if (strategy !== 'base') {
      report.push({ id: b.id, level: 'warn', msg: `collision on "${base}" resolved via ${strategy} -> ${slug}` });
    }
    // A very short slug is legal but rarely what you want as a permanent URL.
    if (slug.length <= 4 || slug.split('-').length === 1) {
      report.push({ id: b.id, level: 'notice', msg: `single-word slug "${slug}" from "${b.title}" — review before it freezes` });
    }
  }

  return { ledger: next, written, report };
}
