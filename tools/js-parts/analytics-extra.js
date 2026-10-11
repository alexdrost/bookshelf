
/* ============================================================================
   SESSION 2 Step 6 — the two additions that need their own rendering.
   Publication lag and cumulative pages. Nothing existing is removed or changed.
   ========================================================================== */

const LAG_BUCKETS = [
  { label: 'same yr', test: (g) => g === 0 },
  { label: '1', test: (g) => g === 1 },
  { label: '2', test: (g) => g === 2 },
  { label: '3–5', test: (g) => g >= 3 && g <= 5 },
  { label: '6–10', test: (g) => g >= 6 && g <= 10 },
  { label: '11–25', test: (g) => g >= 11 && g <= 25 },
  { label: '25+', test: (g) => g > 25 },
];

function renderLagBars() {
  const host = $('#lagBars');
  if (!host) return;
  const L = (typeof lensList === 'function' ? lensList() : BOOKS).filter((b) => b.shelf === 'read');
  const buckets = LAG_BUCKETS.map((b) => ({ ...b, books: [] }));
  for (const b of L) {
    if (!b.yearRead || !/\d/.test(b.yearPub || '')) continue;
    const g = +b.yearRead - parseInt(b.yearPub, 10);
    if (!isFinite(g) || g < 0) continue;
    const hit = buckets.find((x) => x.test(g));
    if (hit) hit.books.push(b);
  }
  const max = Math.max(...buckets.map((b) => b.books.length), 1);
  const peak = buckets.reduce((p, c) => (c.books.length > p.books.length ? c : p), buckets[0]);
  host.innerHTML = buckets.map((b) =>
    `<div class="mc ${b === peak ? 'peakmc' : ''}" data-lag="${b.label}"><div class="mb" style="height:${b.books.length / max * 100}%"><span class="ml-v">${b.books.length || ''}</span></div><span class="ml">${b.label}</span></div>`
  ).join('');
  host.querySelectorAll('.mc').forEach((el) => {
    const b = buckets.find((x) => x.label === el.dataset.lag);
    if (b && b.books.length) bindList(el, `Read ${b.label === 'same yr' ? 'the same year' : b.label + ' years'} after publication`, b.books.length + ' books', b.books.slice().sort((x, y) => (y.dateRead || '').localeCompare(x.dateRead || '')));
  });
}

function renderCumulative() {
  const svg = $('#cumChart');
  if (!svg) return;
  const byMonth = new Map();
  for (const b of BOOKS) {
    if (b.shelf !== 'read') continue;
    const m = /^(\d{4})\/(\d{2})/.exec(b.dateRead || '');
    const p = parseInt(b.pages, 10);
    if (!m || !isFinite(p) || p <= 0) continue;
    const k = m[1] + '-' + m[2];
    byMonth.set(k, (byMonth.get(k) || 0) + p);
  }
  const keys = [...byMonth.keys()].sort();
  if (!keys.length) return;
  let run = 0;
  const pts = keys.map((k) => ({ k, v: (run += byMonth.get(k)) }));
  const W = 800, H = 220, padL = 56, padR = 16, padT = 18, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = pts[pts.length - 1].v;
  const x = (i) => padL + plotW * (pts.length < 2 ? 0.5 : i / (pts.length - 1));
  const y = (v) => padT + plotH * (1 - v / max);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const area = `M${x(0)} ${H - padB} ` + pts.map((p, i) => 'L' + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') + ` L${x(pts.length - 1)} ${H - padB} Z`;
  const gl = [0, 0.5, 1].map((f) => {
    const gy = padT + plotH * f;
    const gv = Math.round(max * (1 - f));
    return `<line class="gl" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"/><text class="axl" x="${padL - 8}" y="${gy + 4}" text-anchor="end">${gv >= 1000 ? Math.round(gv / 1000) + 'k' : gv}</text>`;
  }).join('');
  const seen = {};
  let xl = '';
  pts.forEach((p, i) => { const yr = p.k.slice(0, 4); if (!seen[yr]) { seen[yr] = 1; xl += `<text class="axl" x="${x(i)}" y="${H - padB + 20}" text-anchor="middle">${yr}</text>`; } });
  svg.innerHTML = `<defs><linearGradient id="cumgrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#2e6fb5" stop-opacity=".35"/><stop offset="100%" stop-color="#2e6fb5" stop-opacity="0"/></linearGradient></defs>` +
    `${gl}<path class="area" d="${area}" fill="url(#cumgrad)"/><path class="ln" d="${line}"/>${xl}`;
}

function renderExtras() {
  renderLagBars();
  renderCumulative();
}
window.renderExtras = renderExtras;
