
/* ============================================================================
   SESSION 2 Step 2 — progressive enhancement for /library.
   The 24 cards and the pagination anchors are already in the served HTML. This
   only adds behaviour on top:
     · the first interaction with any control lazily loads books.json, then hands
       over to the extracted renderBrowse()
     · the next/prev anchors and "Load more" are intercepted, the next batch is
       fetched and appended, and the address bar is updated with pushState
   With JavaScript off, none of this runs and the real anchors still work.
   ========================================================================== */

let _libReady = false;
let _libLoading = null;

/** Load once, then narrow to shelf:"read" — /library is a read-only index. */
function libraryData() {
  if (_libReady) return Promise.resolve();
  if (_libLoading) return _libLoading;
  _libLoading = loadBooks().then(() => {
    BOOKS = BOOKS.filter((b) => b.shelf === 'read');
    ID2I = {};
    BOOKS.forEach((b, i) => { ID2I[b.id] = i; });
    _libReady = true;
  });
  return _libLoading;
}

/* Every control re-renders from BOOKS, which is empty until the fetch lands — so
   intercept in the capture phase, load, then let the original handlers run. */
function armControls() {
  const controls = ['#q', '#sortBtns', '#themeChips', '#browseReset', '#emptyReset'];
  const arm = (e) => {
    if (_libReady) return;
    e.stopPropagation();
    e.preventDefault();
    libraryData().then(() => {
      // Once data is in, the grid becomes JS-owned: replay the interaction.
      renderChips();
      renderBrowse();
      if (e.target && typeof e.target.click === 'function' && e.type === 'click') e.target.click();
    });
  };
  for (const sel of controls) {
    const el = $(sel);
    if (!el) continue;
    el.addEventListener('click', arm, true);
    el.addEventListener('input', arm, true);
  }
}

/* ---- infinite scroll over the real pagination anchors --------------------- */
function initInfiniteScroll() {
  const pager = document.querySelector('.pager');
  const grid = $('#grid');
  if (!pager || !grid) return;
  const total = +pager.dataset.total;
  let current = +pager.dataset.page;
  let busy = false;

  async function appendPage(n) {
    if (busy || n > total) return;
    busy = true;
    const more = $('#loadMore');
    if (more) more.textContent = 'Loading…';
    try {
      const res = await fetch(n === 1 ? '/library' : `/library/${n}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const cards = doc.querySelectorAll('#grid .book');
      cards.forEach((c) => grid.appendChild(document.importNode(c, true)));
      current = n;
      history.pushState(null, '', n === 1 ? '/library' : `/library/${n}`);
      const nowSpan = pager.querySelector('.pager-now');
      if (nowSpan) nowSpan.textContent = `Page ${current} of ${total}`;
      const count = $('#count');
      if (count) count.textContent = `${grid.querySelectorAll('.book').length} of ${pager.dataset.count || grid.querySelectorAll('.book').length}`;
      if (current >= total) {
        const wrap = document.querySelector('.pager-more');
        if (wrap) wrap.remove();
        const nextA = pager.querySelector('a[rel="next"]');
        if (nextA) nextA.remove();
      } else if (more) {
        more.textContent = 'Load more books';
        more.setAttribute('href', `/library/${current + 1}`);
      }
    } catch (err) {
      if (more) more.textContent = 'Load more books';
      return;                                  // leave the real anchor working
    } finally {
      busy = false;
    }
  }

  const intercept = (e) => {
    // Only take over while the grid is still the server-rendered list; once a
    // filter or sort is applied the JS owns the grid and paging no longer applies.
    if (_libReady) return;
    e.preventDefault();
    appendPage(current + 1);
  };
  const more = $('#loadMore');
  if (more) more.addEventListener('click', intercept);
  const nextA = pager.querySelector('a[rel="next"]');
  if (nextA) nextA.addEventListener('click', intercept);

  // Auto-load as the bottom comes into view.
  if ('IntersectionObserver' in window) {
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    pager.parentNode.insertBefore(sentinel, pager);
    new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting && !_libReady && current < total) appendPage(current + 1);
    }, { rootMargin: '700px' }).observe(sentinel);
  }
}

if (document.getElementById('grid')) {
  window.addEventListener('load', () => { armControls(); initInfiniteScroll(); });
}
