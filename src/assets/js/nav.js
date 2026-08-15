/* Static-page nav toggle. The SPA at / has its own copy inline; this is only for
   the generated pages, which have no other JavaScript. */
(function () {
  var t = document.getElementById('navToggle');
  var m = document.getElementById('navMenu');
  if (!t || !m) return;
  t.addEventListener('click', function () {
    var open = m.classList.toggle('open');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
