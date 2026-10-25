/* DEKI — page motion: smooth scroll, loader, split text, scroll scenes. */
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  // phones/tablets: native momentum scroll, weaker GPU → lighter effects, no scrub lag
  const lite = !fine || innerWidth < 760;
  if (lite) root.classList.add('lite');
  const S = (v) => (lite ? 0.12 : v);   // scrub smoothing: instant on touch, buttery on desktop
  const hasGsap = !!window.gsap && !!window.ScrollTrigger;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  window.DEKI = window.DEKI || {};
  const D = window.DEKI;
  D.mouse = { x: 0, y: 0 };      // -1..1, eased in scene
  D.velocity = 0;                 // px per frame-ish
  D.lite = lite;

  if (reduce || !hasGsap) root.classList.add('rm');

  /* ── smooth scroll ─────────────────────────────────────────────── */
  let lenis = null;
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
  }
  if (hasGsap && !reduce && window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.4 });
    lenis.stop();
    lenis.on('scroll', (e) => { D.velocity = e.velocity; ScrollTrigger.update(); });
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    D.lenis = lenis;
  } else {
    let last = scrollY;
    const track = () => { D.velocity = scrollY - last; last = scrollY; requestAnimationFrame(track); };
    track();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const target = id === '#' ? null : $(id);
    if (id === '#' ) { e.preventDefault(); return; }
    if (!target) return;
    e.preventDefault();
    closeMenu();
    if (lenis) lenis.scrollTo(target, { offset: id === '#hero' ? -200 : 0, duration: 1.6 });
    else target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });

  addEventListener('pointermove', (e) => {
    D.mouse.x = (e.clientX / innerWidth) * 2 - 1;
    D.mouse.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  /* ── split text ────────────────────────────────────────────────── */
  function wrapWords(el, cls) {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/);
          if (parts.length === 1 && !parts[0]) return;
          const frag = document.createDocumentFragment();
          parts.forEach((p) => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            if (cls === 'w') {
              const w = document.createElement('span'); w.className = 'w';
              const i = document.createElement('span'); i.className = 'wi'; i.textContent = p;
              w.appendChild(i); frag.appendChild(w);
            } else {
              const s = document.createElement('span'); s.className = 'ws'; s.textContent = p;
              frag.appendChild(s);
            }
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') {
          walk(n);
        }
      });
    };
    walk(el);
    return cls === 'w' ? $$('.wi', el) : $$('.ws', el);
  }

  const splitEls = $$('[data-split]');
  const wordEls = $$('[data-words]');
  splitEls.forEach((el) => wrapWords(el, 'w'));
  wordEls.forEach((el) => wrapWords(el, 'ws'));

  /* ── clock ─────────────────────────────────────────────────────── */
  const tEl = $('#time');
  const tick = () => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    tEl.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} · MSK`;
  };
  tick(); setInterval(tick, 1000);

  /* ── menu ──────────────────────────────────────────────────────── */
  const burger = $('#burger'), menu = $('#menu');
  function closeMenu() {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false'); lenis && lenis.start();
  }
  burger.addEventListener('click', () => {
    const open = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open); menu.setAttribute('aria-hidden', String(!open));
    burger.setAttribute('aria-expanded', String(open));
    if (lenis) open ? lenis.stop() : lenis.start();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ── nav state ─────────────────────────────────────────────────── */
  const nav = $('#nav');
  let lastY = 0;
  const onScrollNav = () => {
    const y = scrollY;
    nav.classList.toggle('is-scrolled', y > 24);
    if (!menu.classList.contains('is-open')) nav.classList.toggle('is-hidden', y > 480 && y > lastY + 2);
    if (y < lastY - 2 || y < 480) nav.classList.remove('is-hidden');
    lastY = y;
  };
  addEventListener('scroll', onScrollNav, { passive: true });

  /* ── loader ────────────────────────────────────────────────────── */
  const num = $('#loader-num'), bar = $('.loader-bar');
  let shown = 0, target = 0, sceneReady = false;
  const t0 = performance.now();
  addEventListener('deki:progress', (e) => { target = Math.max(target, e.detail * 100); });
  addEventListener('deki:scene-ready', () => { sceneReady = true; target = 100; });
  setTimeout(() => { sceneReady = true; target = 100; }, 4500); // never hold the page hostage
  setTimeout(() => finishLoading(), 6000);                         // even if rAF is throttled
  let tPrev = t0;
  const loadLoop = (now = performance.now()) => {
    const dt = Math.min((now - tPrev) / 1000, 0.25); tPrev = now;
    const minTime = now - t0 > 900;
    const cap = sceneReady && minTime ? 100 : Math.min(target, 92);
    shown += Math.max((cap - shown) * (1 - Math.exp(-dt * 7)), dt * 25);
    shown = Math.min(shown, cap);
    num.textContent = Math.round(shown);
    bar.style.setProperty('--p', shown / 100);
    if (loaded) return;
    if (shown >= 99.5 && sceneReady && minTime) return finishLoading();
    requestAnimationFrame(loadLoop);
  };
  if (reduce) { sceneReady = true; }
  requestAnimationFrame(loadLoop);

  let loaded = false;
  function finishLoading() {
    if (loaded) return;
    loaded = true;
    num.textContent = 100;
    root.classList.add('is-ready');
    root.classList.remove('is-loading');
    setTimeout(() => $('.loader') && $('.loader').remove(), 800);   // stop its animations for good
    lenis && lenis.start();
    dispatchEvent(new Event('deki:intro'));
    intro();
  }

  /* ── intro ─────────────────────────────────────────────────────── */
  function intro() {
    if (!hasGsap || reduce) return;
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.nav-pill', { y: -30, opacity: 0, duration: 1.2 }, 0.1)
      .to('.hero .tag-row', { opacity: 1, y: 0, duration: 1.2 }, 0.15)
      .fromTo('.hero h1 .wi', { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.4, stagger: 0.045 }, 0.2)
      .to('.hero .lede', { opacity: 1, y: 0, duration: 1.2 }, 0.65)
      .to('.hero .cta-row', { opacity: 1, y: 0, duration: 1.2 }, 0.75)
      .to('.hero .platform-row', { opacity: 1, y: 0, duration: 1.2 }, 0.85)
      .from('.scroll-cue', { opacity: 0, y: 20, duration: 1 }, 1.0);
  }

  if (!hasGsap || reduce) {
    wordEls.forEach((el) => $$('.ws', el).forEach((w) => (w.style.opacity = 1)));
    return;
  }

  /* ════════════════════════ scroll scenes ════════════════════════ */
  const mm = gsap.matchMedia();

  // progress bar
  gsap.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: S(0.3) } });

  // ambient light drifts with the page
  if (!lite) {
    gsap.to('.ambient .a1', { yPercent: 60, xPercent: 30, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1 } });
    gsap.to('.ambient .a2', { yPercent: -70, xPercent: -20, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1 } });
  }

  // hero text drifts up & softens as you leave
  gsap.to('.hero-text', {
    yPercent: -18, opacity: 0, ...(lite ? {} : { filter: 'blur(6px)' }), ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 15%', scrub: true },
  });
  gsap.to('.scroll-cue', { opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '15% top', scrub: true } });

  // reveal batches
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%',
    once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: lite ? 0.9 : 1.3, ease: 'expo.out', stagger: lite ? 0.05 : 0.09, overwrite: true }),
  });

  // split headlines rise word by word
  const splitTriggers = [];
  function buildSplits(instant) {
    splitTriggers.splice(0).forEach((t) => t.kill());
    splitEls.forEach((el) => {
      if (el.closest('.hero')) return;
      const words = $$('.wi', el);
      if (instant) { gsap.set(words, { yPercent: 0, rotate: 0 }); return; }
      gsap.set(words, { yPercent: 115, rotate: 3 });
      splitTriggers.push(ScrollTrigger.create({
        trigger: el, start: 'top 86%', once: true,
        onEnter: () => gsap.to(words, { yPercent: 0, rotate: 0, duration: lite ? 0.9 : 1.3, ease: 'expo.out', stagger: lite ? 0.02 : 0.035 }),
      }));
    });
  }
  buildSplits(false);

  // words light up while you read
  const wordTweens = [];
  function buildWordScrub() {
    wordTweens.splice(0).forEach((t) => { t.scrollTrigger && t.scrollTrigger.kill(); t.kill(); });
    wordEls.forEach((el) => {
      const words = $$('.ws', el);
      wordTweens.push(gsap.fromTo(words, { opacity: 0.14 }, {
        opacity: 1, ease: 'none', stagger: 0.1,
        scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 45%', scrub: S(0.6) },
      }));
    });
  }
  buildWordScrub();

  document.addEventListener('deki:lang', () => {
    splitEls.forEach((el) => wrapWords(el, 'w'));
    wordEls.forEach((el) => wrapWords(el, 'ws'));
    gsap.set('.hero h1 .wi', { yPercent: 0, rotate: 0 });
    buildSplits(true);
    buildWordScrub();
    formatStats(false);
    chips.forEach((c, i) => ($('.t2', c).textContent = t2of(CH[i][2])));
    ScrollTrigger.refresh();
  });

  /* ── ticker reacts to scroll velocity ── */
  $$('.ticker-row').forEach((row) => {
    const track = $('.ticker-track', row);
    for (let i = 0; i < 3; i++) row.appendChild(track.cloneNode(true));
    const dir = Number(row.dataset.dir);
    let x = 0, skew = 0, w = track.offsetWidth || 1, visible = true;
    new ResizeObserver(() => (w = track.offsetWidth || 1)).observe(track);
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(row);
    gsap.ticker.add((_, dt) => {
      if (!visible) return;
      const v = D.velocity || 0;
      x -= dir * (0.05 * dt + Math.min(Math.abs(v), 60) * 0.7);
      x = gsap.utils.wrap(-w, 0, x);
      skew += (gsap.utils.clamp(-12, 12, -v * 0.6 * dir) - skew) * 0.1;
      row.style.transform = `translate3d(${x}px,0,0) skewX(${skew}deg)`;
    });
  });

  /* ── 01 chaos → one feed ── */
  const chaos = $('#chaos');
  const CH = [
    ['K', '@kip_music', ['новый трек · mp3 · 3:12', 'new track · mp3 · 3:12'], 'icon_play_02'],
    ['N', 'Nova Lane', ['Тёплый свет · сингл', 'Warm Light · single'], 'icon_like'],
    ['A', 'Artist One', 'клип_final_v3.mp4', 'icon_flow_01'],
    ['E', 'Echoes', ['LIVE сегодня в 21:00', 'LIVE tonight 9 pm'], 'icon_feed_01'],
    ['B', 'Blue Hour', ['демо · 2:48', 'demo · 2:48'], 'icon_play_02'],
    ['T', 'Тихий город', ['альбом · 9 треков', 'album · 9 tracks'], 'icon_library_02'],
    ['G', 'Neon Garden', ['репост · 1.2k', 'repost · 1.2k'], 'icon_share_01'],
    ['M', 'Night Drive', ['ремикс · wav', 'remix · wav'], 'icon_random'],
    ['S', 'scene.chat', ['+238 непрочитанных', '+238 unread'], 'icon_feed_02'],
    ['D', 'drop.mp3', ['пересланное сообщение', 'forwarded message'], 'icon_forward_01'],
    ['F', 'flow.mix', ['плейлист · 24', 'playlist · 24'], 'icon_library_01'],
    ['R', 'Afterglow', ['новый EP · 5 треков', 'new EP · 5 tracks'], 'icon_play_01'],
    ['L', 'lofi.room', ['стрим · 312 зрителей', 'stream · 312 watching'], 'icon_repeat'],
    ['P', 'Pulse', ['тизер · mp4', 'teaser · mp4'], 'icon_flow_02'],
    ['V', 'Voyage', ['сниппет · 0:30', 'snippet · 0:30'], 'icon_play_02'],
    ['O', 'Orbit', ['донат · скоро', 'donation · soon'], 'icon_donate_01'],
    ['Z', 'zvuk.kanal', ['+57 сообщений', '+57 messages'], 'icon_feed_01'],
    ['H', 'Horizon', ['акустика · 4:05', 'acoustic · 4:05'], 'icon_like'],
    ['C', 'Cassette', ['архив 2019', 'archive 2019'], 'icon_library_02'],
    ['W', 'Wave', ['кавер · mp3', 'cover · mp3'], 'icon_random'],
  ];
  const AV = [
    'linear-gradient(135deg,#5aff1f,#1fb800)', 'linear-gradient(135deg,#b46bff,#6a00ff)',
    'linear-gradient(135deg,#ffb347,#ff5f6d)', 'linear-gradient(135deg,#4facfe,#00f2fe)',
    'linear-gradient(135deg,#f5f5f7,#8e8e93)', 'linear-gradient(135deg,#ff6ec4,#7873f5)',
  ];
  const t2of = (t2) => (Array.isArray(t2) ? t2[window.DEKI_LANG === 'en' ? 1 : 0] : t2);
  const chips = CH.slice(0, lite ? 12 : CH.length).map(([l, t1, t2, ic], i) => {
    const c = document.createElement('div');
    c.className = lite ? 'chaos-chip solid' : 'chaos-chip glass';
    c.innerHTML = `<span class="av" style="background:${AV[i % AV.length]}">${l}</span><span class="tx"><span class="t1">${t1}</span><span class="t2">${t2of(t2)}</span></span><img class="ic" src="04_Icons/${ic}.svg" alt="">`;
    chaos.appendChild(c);
    return c;
  });
  const rnd = gsap.utils.random;
  const seeds = chips.map((_, i) => {
    // spread chips on an elliptical band around the headline, never right on top of it
    const a = (i / chips.length) * Math.PI * 2 + rnd(-0.25, 0.25);
    const r = rnd(0.62, 1.05);
    return lite
      ? { a, r, z: rnd(-260, 120), rx: rnd(-25, 25), ry: rnd(-30, 30), rz: rnd(-22, 22), drift: rnd(-1, 1) }
      : { a, r, z: rnd(-700, 260), rx: rnd(-50, 50), ry: rnd(-60, 60), rz: rnd(-30, 30), drift: rnd(-1, 1) };
  });
  const LIST = 6;
  mm.add({ desk: '(min-width: 900px)', mob: '(max-width: 899px)' }, (ctx) => {
    const desk = ctx.conditions.desk;
    const pin = $('.chaos-pin'), after = $('.chaos-after');
    const vw = () => innerWidth, vh = () => pin.clientHeight || innerHeight;
    const rowH = desk ? 76 : 66;
    // phones: the feed stacks right under the headline and shows as many rows as fit
    const afterBottom = () => after.offsetTop + after.offsetHeight;
    const rows = () => (desk ? LIST : gsap.utils.clamp(3, LIST, Math.floor((vh() - afterBottom() - 44) / rowH)));
    const firstY = () => (desk ? -((LIST - 1) / 2) * rowH : afterBottom() + 20 + rowH / 2 - vh() / 2);
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: '.chaos-pin', start: 'top top', end: '+=230%', pin: true, scrub: S(1), invalidateOnRefresh: true, anticipatePin: 1 },
    });
    chips.forEach((c, i) => {
      const s = seeds[i];
      const sx = () => Math.cos(s.a) * s.r * vw() * (desk ? 0.46 : 0.62);
      const sy = () => Math.sin(s.a) * s.r * vh() * 0.42;
      gsap.set(c, { x: sx, y: sy, z: s.z, rotationX: s.rx, rotationY: s.ry, rotationZ: s.rz, opacity: 1 });
      // phase 1 — swirl harder
      tl.to(c, { x: () => sx() * 1.08 + s.drift * 60, y: () => sy() + s.drift * 90, rotationZ: s.rz + s.drift * 40, rotationY: s.ry * 1.3, duration: 0.35 }, 0);
      // phase 2 — collapse into one tidy feed
      const inList = () => i < rows();
      const lx = () => (desk ? vw() * 0.24 : 0);
      const ly = () => firstY() + i * rowH;
      tl.to(c, {
        x: () => (inList() ? lx() : lx() + rnd(-80, 80)),
        y: () => (inList() ? ly() : firstY() + rows() * rowH * 0.5),
        z: () => (inList() ? 0 : (lite ? -600 : -1400)), rotationX: 0, rotationY: 0, rotationZ: 0,
        opacity: () => (inList() ? 1 : 0), duration: 0.45, ease: 'power3.inOut',
      }, 0.32 + i * 0.006);
    });
    tl.to('.chaos-head', { opacity: 0, yPercent: -40, scale: 0.94, duration: 0.25 }, 0.3)
      .fromTo('.chaos-after', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.25 }, 0.72)
      .to({}, { duration: 0.12 });
    return () => tl.kill();
  });

  /* ── tilt + spotlight cards ── */
  if (fine) {
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', `${px * 100}%`);
        card.style.setProperty('--my', `${py * 100}%`);
        card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 6}deg) rotateY(${(px - 0.5) * 8}deg) translateZ(0)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });

    $$('.magnetic').forEach((b) => {
      const xTo = gsap.quickTo(b, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
      const yTo = gsap.quickTo(b, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.25);
        yTo((e.clientY - r.top - r.height / 2) * 0.35);
      });
      b.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  }

  /* ── 02 sticky phone follows the steps ── */
  const focus = $('#solution-phone .phone-focus');
  const phoneImg = $('#solution-phone .phone-img');
  const dots = $$('.step-dots i');
  // regions of the feed screenshot each step talks about (fractions of screen height)
  const FOCUS = [
    { top: 0, height: 1, opacity: 0, img: 1 },
    { top: 0.085, height: 0.235, opacity: 1, img: 1.03 },
    { top: 0.355, height: 0.30, opacity: 1, img: 1.03 },
    { top: 0.67, height: 0.235, opacity: 1, img: 1.03 },
  ];
  const setStep = (i) => {
    $$('.step').forEach((s, k) => s.classList.toggle('is-active', k === i));
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    const f = FOCUS[i];
    gsap.to(focus, { top: `${f.top * 100}%`, height: `${f.height * 100}%`, opacity: f.opacity, duration: 1.1, ease: 'expo.out', overwrite: true });
    gsap.to(phoneImg, { scale: f.img, duration: 1.4, ease: 'expo.out', overwrite: true });
  };
  setStep(0);
  $$('.step').forEach((s, i) => {
    ScrollTrigger.create({
      trigger: s, start: 'top 55%', end: 'bottom 55%',
      onEnter: () => setStep(i), onEnterBack: () => setStep(i),
    });
  });
  mm.add('(min-width: 900px)', () => {
    const t = gsap.fromTo('#solution-phone', { rotationY: -22, rotationX: 10, rotationZ: -3 }, {
      rotationY: 14, rotationX: -6, rotationZ: 2, ease: 'none',
      scrollTrigger: { trigger: '.scrolly', start: 'top bottom', end: 'bottom top', scrub: 1 },
    });
    const c = $$('#solution-phone .chip').map((chip, i) => gsap.fromTo(chip, { y: 80 * (i % 2 ? 1 : -1) }, {
      y: -80 * (i % 2 ? 1 : -1), ease: 'none',
      scrollTrigger: { trigger: '.scrolly', start: 'top bottom', end: 'bottom top', scrub: 1.5 },
    }));
    return () => { t.kill(); c.forEach((x) => x.kill()); };
  });
  gsap.from('#solution-phone .chip', {
    scale: 0.6, opacity: 0, duration: 1.2, ease: 'back.out(1.6)', stagger: 0.12,
    scrollTrigger: { trigger: '.sticky-phone', start: 'top 70%' },
  });

  /* ── 04 studio phones fan out ── */
  const stats = $$('.stat b[data-count]');
  function fmt(v, el) {
    const dec = String(el.dataset.count).includes('.') ? 1 : 0;
    const s = new Intl.NumberFormat(window.DEKI_LANG === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    return (el.dataset.prefix || '') + s + (el.dataset.suffix || '');
  }
  function formatStats(final) {
    stats.forEach((el) => { if (final || el._done) el.textContent = fmt(Number(el.dataset.count), el); });
  }
  mm.add({ desk: '(min-width: 761px)', mob: '(max-width: 760px)' }, (ctx) => {
    const spread = ctx.conditions.desk ? 58 : 30;
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: '#studio-stage', start: 'top top', end: '+=150%', pin: true, scrub: S(1), anticipatePin: 1 },
    });
    tl.fromTo('.studio-phones .phone-l', { xPercent: 0, yPercent: 30, rotationX: 58, rotationZ: -18, rotationY: 0, scale: 0.72 },
      { xPercent: -spread, yPercent: 0, rotationX: 0, rotationZ: -4, rotationY: 16, scale: 1, duration: 1, ease: 'power2.inOut' }, 0)
      .fromTo('.studio-phones .phone-r', { xPercent: 0, yPercent: 40, rotationX: 58, rotationZ: 14, rotationY: 0, scale: 0.68 },
        { xPercent: spread, yPercent: 4, rotationX: 0, rotationZ: 4, rotationY: -16, scale: 1, duration: 1, ease: 'power2.inOut' }, 0)
      .fromTo('.studio-phones .phone-img', { scale: 1.12 }, { scale: 1, duration: 1 }, 0)
      .fromTo('.stat', { opacity: 0, scale: 0.6, y: 40 }, { opacity: 1, scale: 1, y: 0, duration: 0.35, stagger: 0.08, ease: 'back.out(1.7)' }, 0.55)
      .to({}, { duration: 0.25 });
    return () => tl.kill();
  });
  stats.forEach((el) => {
    const v = { n: 0 };
    ScrollTrigger.create({
      trigger: '#studio-stage', start: 'top top', end: '+=150%',
      onUpdate: (self) => {
        if (el._done || self.progress < 0.5) return;
        el._done = true;
        gsap.to(v, { n: Number(el.dataset.count), duration: 2, ease: 'expo.out', onUpdate: () => (el.textContent = fmt(v.n, el)) });
      },
    });
  });

  gsap.to('.flow-line line', {
    strokeDashoffset: 0, ease: 'none',
    scrollTrigger: { trigger: '#flow', start: 'top 80%', end: 'bottom 55%', scrub: S(1) },
  });
  gsap.from('.flow-step .badge', {
    scale: 0, duration: 1, ease: 'back.out(2)', stagger: 0.15,
    scrollTrigger: { trigger: '#flow', start: 'top 80%' },
  });

  /* ── CTA + footer ── */
  gsap.fromTo('.cta-glow', { scale: 0.5, opacity: 0.3 }, {
    scale: 1.1, opacity: 1, ease: 'none',
    scrollTrigger: { trigger: '.cta-final', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });
  gsap.fromTo('.word span', { yPercent: 100, rotate: 8 }, {
    yPercent: 0, rotate: 0, ease: 'none', stagger: 0.06,
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: S(1) },
  });

  /* ── nav active link ── */
  const links = $$('.nav .links a');
  links.forEach((a) => {
    const sec = $(a.getAttribute('href'));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec, start: 'top 50%', end: 'bottom 50%',
      onToggle: (self) => a.classList.toggle('is-active', self.isActive),
    });
  });

  addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
