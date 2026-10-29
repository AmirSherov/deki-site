/* DEKI Help Center: поиск, копирование ссылок на разделы/вопросы, активный пункт оглавления. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ── toast ──
  const toastEl = $('[data-toast]');
  let toastTimer;
  const toast = (text) => {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 1600);
  };

  // ── copy link to section / question ──
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-copy-link]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const url = new URL(a.getAttribute('href'), location.href).href;
    history.replaceState(null, '', a.getAttribute('href'));
    const qa = a.closest('details');
    if (qa) qa.open = true;
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
    } catch {
      toast(url);
    }
  });

  // открыть вопрос FAQ по якорю
  const openTarget = () => {
    if (!location.hash) return;
    let el = null;
    try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* bad hash */ }
    if (el && el.tagName === 'DETAILS') {
      el.open = true;
      setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'instant' }), 60);
    }
  };
  openTarget();
  window.addEventListener('hashchange', openTarget);

  // ── TOC highlight ──
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(tocLinks.map((l) => [l.getAttribute('href').slice(1), l]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        tocLinks.forEach((l) => l.classList.remove('is-active'));
        const link = map.get(en.target.id);
        if (link) link.classList.add('is-active');
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    $$('.prose h2[id]').forEach((h) => io.observe(h));
  }

  // ── search ──
  const layer = $('[data-search-layer]');
  const input = $('[data-search-input]');
  const results = $('[data-search-results]');
  if (!layer || !input || !results) return;

  let index = null;
  let loading = null;
  let selected = 0;
  const load = () => loading || (loading = fetch('/help/search-index.json')
    .then((r) => r.json())
    .then((data) => {
      index = data.map((d) => ({ ...d, _t: norm(d.t), _all: norm([d.t, d.k, d.h.join(' '), d.l, d.x].join(' ')) }));
    })
    .catch(() => { index = []; }));

  const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w);

  const highlight = (text, terms) => {
    let out = esc(text);
    terms.forEach((t) => {
      if (t.length < 2) return;
      out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    });
    return out;
  };

  const snippet = (d, terms) => {
    const src = d.x || d.l;
    const low = norm(src);
    let pos = -1;
    for (const t of terms) { pos = low.indexOf(t); if (pos >= 0) break; }
    if (pos < 0) return d.l;
    const start = Math.max(0, pos - 50);
    return (start ? '…' : '') + src.slice(start, start + 170).trim() + '…';
  };

  const search = (q) => {
    const terms = norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);
    if (!terms.length) return [];
    return index
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          if (!d._all.includes(t)) return null;
          if (d._t.includes(t)) score += 10;
          if (norm(d.k).includes(t)) score += 4;
          if (norm(d.h.join(' ')).includes(t)) score += 3;
          score += 1;
        }
        if (d._t.startsWith(terms[0])) score += 3;
        return { d, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ d }) => ({ d, terms }));
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = '<div class="search-empty">Начните вводить: «витрина», «отложенный релиз», «плейлист»…</div>';
      return;
    }
    if (!index) { results.innerHTML = '<div class="search-empty">Загружаю…</div>'; return; }
    const found = search(q);
    selected = 0;
    results.innerHTML = found.length
      ? found.map(({ d, terms }, i) => `<a href="${d.u}" role="option" aria-selected="${i === 0}"><span class="r-sec">${esc(d.s)}</span><span class="r-title">${highlight(d.t, terms)}</span><span class="r-snip">${highlight(snippet(d, terms), terms)}</span></a>`).join('')
      : `<div class="search-empty">Ничего не нашлось по «${esc(q)}». Попробуйте другое слово или напишите нам: <a href="mailto:hi@deki.app">hi@deki.app</a></div>`;
  };

  const move = (dir) => {
    const items = $$('a', results);
    if (!items.length) return;
    selected = (selected + dir + items.length) % items.length;
    items.forEach((a, i) => a.setAttribute('aria-selected', String(i === selected)));
    items[selected].scrollIntoView({ block: 'nearest' });
  };

  let lastFocus = null;
  const open = () => {
    lastFocus = document.activeElement;
    layer.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    input.focus();
    input.select();
    load().then(render);
    render();
  };
  const close = () => {
    layer.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  };

  $$('[data-search-open]').forEach((b) => b.addEventListener('click', open));
  $('[data-search-close]').addEventListener('click', close);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      const a = $$('a', results)[selected];
      if (a) { e.preventDefault(); location.href = a.href; close(); }
    }
  });
  results.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !layer.hidden) close();
    else if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && layer.hidden) {
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      open();
    }
  });
})();
