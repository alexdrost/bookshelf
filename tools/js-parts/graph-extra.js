
/* ============================================================================
   SESSION 2 Steps 5c–5e — focus mode, path finding, and the mobile default.
   NEW code, not extracted. Built from `conn`, never from `edges`: edges is
   position-based and silently wrong after any reorder. The force graph above
   keeps using EDGES because that is the one sanctioned consumer (§7).
   ========================================================================== */

const MOBILE = () => window.innerWidth <= 640;
let ADJ = null;

/** Undirected, deduped, public + read adjacency. 75 pairs are one-way by design. */
function buildAdj() {
  if (ADJ) return ADJ;
  const ok = (b) => b && b.shelf === 'read';
  ADJ = new Map(BOOKS.map((b) => [b.id, new Set()]));
  for (const b of BOOKS) {
    for (const t of b.conn || []) {
      if (t === b.id) continue;
      const o = BOOKS[ID2I[t]];
      if (!ok(b) || !ok(o)) continue;
      ADJ.get(b.id).add(t);
      ADJ.get(t).add(b.id);
    }
  }
  return ADJ;
}

/** Breadth-first search over the undirected graph. Returns ids, or null. */
function shortestPath(fromId, toId) {
  const adj = buildAdj();
  if (!adj.has(fromId) || !adj.has(toId)) return null;
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const cur = q.shift();
    for (const nx of adj.get(cur) || []) {
      if (prev.has(nx)) continue;
      prev.set(nx, cur);
      if (nx === toId) {
        const out = [nx];
        let p = cur;
        while (p != null) { out.unshift(p); p = prev.get(p); }
        return out;
      }
      q.push(nx);
    }
  }
  return null;
}

// ---------------------------------------------------------------- ego view
function egoHTML(id) {
  const adj = buildAdj();
  const b = BOOKS[ID2I[id]];
  if (!b) return '';
  const direct = [...(adj.get(id) || [])].map((x) => BOOKS[ID2I[x]]).filter(Boolean);
  const second = new Set();
  for (const n of direct) for (const x of adj.get(n.id) || []) if (x !== id && !adj.get(id).has(x)) second.add(x);
  const row = (bk, why) => `<a class="ego-item" href="${bookHref(bk.id)}" data-ego="${bk.id}">` +
    `<span class="ego-t">${esc(bk.title.split(':')[0])}</span>` +
    `<span class="ego-a">${esc(bk.author)}${why ? ' · ' + esc(why) : ''}</span></a>`;
  const shared = (o) => (b.themes || []).filter((t) => (o.themes || []).includes(t)).join(', ');
  return `<div class="ego-head">
      <div class="ego-kick">Focused on</div>
      <h3 class="ego-title"><a href="${bookHref(b.id)}">${esc(b.title)}</a></h3>
      <div class="ego-sub">${esc(b.author)} · ${direct.length} direct connections · ${second.size} two hops away</div>
    </div>
    <div class="ego-sec">Directly connected</div>
    <div class="ego-grid">${direct.map((d) => row(d, shared(d))).join('')}</div>
    ${second.size ? `<div class="ego-sec">Two hops away</div><div class="ego-grid">${[...second].slice(0, 24).map((x) => row(BOOKS[ID2I[x]], '')).join('')}</div>` : ''}`;
}

let egoCurrent = null;
function showEgo(id) {
  const panel = $('#egoPanel');
  if (!panel) return;
  egoCurrent = id;
  panel.innerHTML = egoHTML(id);
  panel.classList.add('open');
  const back = $('#egoBack');
  if (back) back.style.display = '';
  // Tap-to-traverse: move focus rather than navigating, on mobile.
  panel.querySelectorAll('[data-ego]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (!MOBILE()) return;              // desktop keeps the normal link behaviour
      e.preventDefault();
      showEgo(el.dataset.ego);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  history.replaceState(null, '', '#book=' + id);
}
function hideEgo() {
  const panel = $('#egoPanel');
  if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  const back = $('#egoBack');
  if (back) back.style.display = 'none';
  egoCurrent = null;
  history.replaceState(null, '', location.pathname);
}

// ---------------------------------------------------------------- path finder
function wireTypeahead(inputSel, listSel, onPick) {
  const input = $(inputSel), list = $(listSel);
  if (!input || !list) return;
  let chosen = null;
  const close = () => list.classList.remove('open');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    chosen = null;
    if (q.length < 2) return close();
    const hits = BOOKS.filter((b) => b.shelf === 'read' && b.title.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) return close();
    list.innerHTML = hits.map((b) => `<li data-id="${b.id}">${esc(b.title.split(':')[0])} <span style="color:var(--faint)">${esc(b.author)}</span></li>`).join('');
    list.classList.add('open');
    list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      chosen = li.dataset.id;
      input.value = BOOKS[ID2I[chosen]].title.split(':')[0];
      close();
      onPick(chosen);
    }));
  });
  input.addEventListener('blur', () => setTimeout(close, 160));
  return () => chosen;
}

function initPathFinder() {
  let a = null, b = null;
  wireTypeahead('#pfA', '#pfListA', (id) => { a = id; });
  wireTypeahead('#pfB', '#pfListB', (id) => { b = id; });
  on('#pfGo', 'click', () => {
    const out = $('#pfResult');
    if (!out) return;
    if (!a || !b) { out.innerHTML = '<p class="pf-note">Pick a book from each list first.</p>'; return; }
    const path = shortestPath(a, b);
    if (!path) { out.innerHTML = '<p class="pf-note">No chain between those two — the graph is not fully connected.</p>'; return; }
    out.innerHTML = '<div class="pf-chain">' + path.map((id, i) => {
      const bk = BOOKS[ID2I[id]];
      return (i ? '<span class="pf-arrow">&rarr;</span>' : '') + `<a href="${bookHref(id)}">${esc(bk.title.split(':')[0])}</a>`;
    }).join('') + '</div>' +
      `<p class="pf-note">${path.length - 1} step${path.length - 1 === 1 ? '' : 's'} between them.</p>`;
  });
}

// ---------------------------------------------------------------- boot
function initConnections() {
  loadBooks().then(() => {
    buildAdj();
    initPathFinder();
    on('#egoBack', 'click', hideEgo);

    const m = /(?:^|[#&])book=(\d+)/.exec(location.hash);
    if (m && BOOKS[ID2I[m[1]]]) {
      showEgo(m[1]);
    } else if (MOBILE()) {
      // Mobile default is the ego view, not a shrunk-down hairball. Start on the
      // most-connected book so the page opens on something worth reading.
      const adj = buildAdj();
      let best = null, bestN = -1;
      for (const [id, set] of adj) if (set.size > bestN) { bestN = set.size; best = id; }
      if (best) showEgo(best);
    }
    // The canvas is expensive; only build it where it is actually useful.
    if (!MOBILE()) initGraph();
  });
}
if (document.getElementById('graphCanvas') || document.getElementById('egoPanel')) {
  window.addEventListener('load', initConnections);
}
