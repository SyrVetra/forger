(() => {
  'use strict';

  // ---------- Tunables (art coordinates are in the 2000x1390 source images) ----------
  const ART_W = 2000, ART_H = 1390;
  const TITLE = { x: 488, y: 90, w: 1000, h: 356 };   // "FORGER" lettering
  const IMPACT = { x: 880, y: 650 };                  // where the hammer meets the blade
  const PLAY_VIEW = { x: 1000, y: 900, s: 1.5 };      // camera after the title is clicked
  const STRIKES_TO_FORGE = 3;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const frame = $('frame');
  const windup = $('windup');
  const shakeEl = $('shake');
  const camera = $('camera');
  const titleBtn = $('title');
  const cropImg = titleBtn.querySelector('.crop');
  const coldCanvas = $('title-cold');
  const hotCanvas = $('title-hot');
  const impactEl = $('impact');
  const targetEl = $('target');
  const bladeHeat = $('blade-heat');
  const forge = $('forge');
  const glowLayer = forge.querySelector('.glow');
  const hazeLayer = forge.querySelector('.haze');
  const flash = $('flash');
  const pips = document.querySelector('.pips');
  const fx = $('fx');
  const ctx = fx.getContext('2d');

  let state = 'title';
  const setState = (s) => { state = s; app.dataset.state = s; };

  // ---------- Layout from art coordinates ----------
  const pctX = (v) => (v / ART_W * 100) + '%';
  const pctY = (v) => (v / ART_H * 100) + '%';

  Object.assign(titleBtn.style, {
    left: pctX(TITLE.x), top: pctY(TITLE.y),
    width: pctX(TITLE.w), height: pctY(TITLE.h),
  });
  Object.assign(cropImg.style, {
    width: (ART_W / TITLE.w * 100) + '%',
    left: (-TITLE.x / TITLE.w * 100) + '%',
    top: (-TITLE.y / TITLE.h * 100) + '%',
  });
  for (const el of [impactEl, targetEl, bladeHeat]) {
    el.style.left = pctX(IMPACT.x);
    el.style.top = pctY(IMPACT.y);
  }
  windup.style.transformOrigin = `${pctX(IMPACT.x)} ${pctY(IMPACT.y)}`;
  for (let i = 0; i < STRIKES_TO_FORGE; i++) pips.appendChild(document.createElement('i'));

  function setCamera(view, ms, ease) {
    const tx = (0.5 - (view.x / ART_W) * view.s) * 100;
    const ty = (0.5 - (view.y / ART_H) * view.s) * 100;
    camera.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    camera.style.transform = `translate(${tx}%, ${ty}%) scale(${view.s})`;
  }

  // ---------- Title lettering: cut "FORGER" out of the sketch so it can heat up ----------
  // Light pixels connected to the crop border are background; whatever's left
  // (outlines + letter interiors) is the title. Interiors get tinted for the hot layer.
  let outlinePts = [];   // normalized points on the letter outlines, used as spark emitters

  function buildTitleLayers(img) {
    const { x, y, w, h } = TITLE;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    let src;
    try { src = g.getImageData(0, 0, w, h); } catch (e) { return false; } // file:// taints canvas

    const px = src.data, n = w * h;
    const lum = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      lum[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0;
    }

    // 1. Flood the background from the edges.
    const LIGHT = 170;
    const ext = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    const seed = (i) => { if (!ext[i] && lum[i] > LIGHT) { ext[i] = 1; q[qt++] = i; } };
    for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], cx = i % w;
      if (cx > 0) seed(i - 1);
      if (cx < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }

    // 2. Keep only big connected pieces (drops stray sketch lines near the title).
    const comp = new Int32Array(n).fill(-1);
    const sizes = [];
    for (let s = 0; s < n; s++) {
      if (ext[s] || comp[s] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      qh = qt = 0;
      comp[s] = id; q[qt++] = s;
      while (qh < qt) {
        const i = q[qh++], cx = i % w;
        size++;
        let k;
        if (cx > 0 && !ext[k = i - 1] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (cx < w - 1 && !ext[k = i + 1] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (i >= w && !ext[k = i - w] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (i < n - w && !ext[k = i + w] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
      }
      sizes.push(size);
    }
    const minKeep = n * 0.01;

    // 3. Paint the cold (ink) and hot (glowing metal) layers.
    const cold = g.createImageData(w, h), hot = g.createImageData(w, h);
    const cd = cold.data, hd = hot.data;
    outlinePts = [];
    for (let i = 0; i < n; i++) {
      const j = i * 4, L = lum[i];
      const keep = comp[i] >= 0 && sizes[comp[i]] >= minKeep;
      if (keep) {
        cd[j] = cd[j + 1] = cd[j + 2] = L; cd[j + 3] = 255;
        const row = ((i / w) | 0) / h, t = L / 255;
        // yellow-white at the top of the letters, deep orange at the bottom
        hd[j]     = 255 * t;
        hd[j + 1] = (225 - 140 * row) * t;
        hd[j + 2] = (120 - 110 * row) * t;
        hd[j + 3] = 255;
        if (L < 90 && Math.random() < 0.02) outlinePts.push([(i % w) / w, row]);
      } else if (ext[i] && L < 235) {
        // soft anti-aliased edge
        cd[j + 3] = hd[j + 3] = 255 - L;
      }
    }

    for (const cv of [coldCanvas, hotCanvas]) { cv.width = w; cv.height = h; }
    coldCanvas.getContext('2d').putImageData(cold, 0, 0);
    hotCanvas.getContext('2d').putImageData(hot, 0, 0);
    titleBtn.classList.add('ready');
    return true;
  }

  if (cropImg.complete && cropImg.naturalWidth) buildTitleLayers(cropImg);
  else cropImg.addEventListener('load', () => buildTitleLayers(cropImg), { once: true });

  // ---------- FX canvas ----------
  let W = 0, H = 0, unit = 1;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    fx.width = W * dpr; fx.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    unit = frame.getBoundingClientRect().width / 1000;
  }
  addEventListener('resize', resize);
  resize();

  const parts = [];
  const MAX_PARTS = 1600;

  function spark(x, y, vx, vy, life, size, hue) {
    if (parts.length < MAX_PARTS) parts.push({ x, y, vx, vy, life, max: life, size, hue, mote: false });
  }

  function burst(x, y, count, power, spread = Math.PI * 1.7, dir = -Math.PI / 2) {
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = power * unit * (0.25 + Math.random() * 0.9);
      spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.35 + Math.random() * 0.75, (0.8 + Math.random() * 1.8) * Math.max(unit, 0.6), 18 + Math.random() * 32);
    }
  }

  function titlePoint() {
    const r = titleBtn.getBoundingClientRect();
    if (outlinePts.length) {
      const p = outlinePts[(Math.random() * outlinePts.length) | 0];
      return [r.left + p[0] * r.width, r.top + p[1] * r.height];
    }
    return [r.left + Math.random() * r.width, r.top + r.height * (0.15 + Math.random() * 0.7)];
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  // Dust motes drifting through the forge light
  function mote() {
    const r = frame.getBoundingClientRect();
    parts.push({
      x: r.left + r.width * (0.15 + Math.random() * 0.75),
      y: r.top + r.height * (0.05 + Math.random() * 0.6),
      vx: (Math.random() - 0.5) * 6 * unit, vy: (-2 - Math.random() * 6) * unit,
      life: 4 + Math.random() * 5, max: 0, size: (0.6 + Math.random() * 1.6) * unit,
      hue: 28 + Math.random() * 15, mote: true, phase: Math.random() * 6.28,
    });
    parts[parts.length - 1].max = parts[parts.length - 1].life;
  }

  function drawParts(dt, t) {
    ctx.clearRect(0, 0, W, H);
    const dark = state === 'forge';
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    ctx.lineCap = 'round';
    const grav = 1100 * unit;

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const k = p.life / p.max;

      if (p.mote) {
        p.x += (p.vx + Math.sin(t * 0.8 + p.phase) * 4 * unit) * dt;
        p.y += p.vy * dt;
        const a = Math.sin(k * Math.PI) * 0.55;
        ctx.fillStyle = `hsla(${p.hue},100%,70%,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.283);
        ctx.fill();
        continue;
      }

      p.vy += grav * dt;
      p.vx *= 0.99; p.vy *= 0.99;
      const px = p.x, py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const tail = 0.022;
      const x0 = p.x - p.vx * tail, y0 = p.y - p.vy * tail;

      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.strokeStyle = `hsl(${p.hue - 8},100%,${dark ? 55 : 44}%)`;
      ctx.lineWidth = p.size * 1.9;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = `hsl(${p.hue + 18},100%,${55 + 30 * k}%)`;
      ctx.lineWidth = p.size * 0.8;
      ctx.beginPath(); ctx.moveTo((x0 + px) / 2, (y0 + py) / 2); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Screen shake ----------
  let trauma = 0;
  function applyShake(dt, t) {
    trauma = Math.max(0, trauma - dt * 1.8);
    if (trauma <= 0) { shakeEl.style.transform = ''; return; }
    const s = trauma * trauma * (reduceMotion ? 0.2 : 1);
    const dx = (Math.sin(t * 97) + Math.sin(t * 61) * 0.5) * 1.6 * s;
    const dy = (Math.sin(t * 89 + 1) + Math.sin(t * 53) * 0.5) * 1.6 * s;
    const rot = Math.sin(t * 73) * 1.2 * s;
    shakeEl.style.transform = `translate(${dx}%, ${dy}%) rotate(${rot}deg)`;
  }

  // ---------- Sound ----------
  // Clangs use a recorded anvil hit when one is in assets/sounds/ (first file found below);
  // otherwise they fall back to the synthesized clang.
  const ANVIL_FILES = ['assets/sounds/anvil.mp3', 'assets/sounds/anvil.wav', 'assets/sounds/anvil.ogg', 'assets/sounds/anvil.m4a'];
  const ANVIL_GAIN = 2.2;       // recorded hits are scaled relative to the synth clang volumes
  let anvilBuffer = null;
  let anvilLoading = false;

  async function loadAnvil(a) {
    if (anvilLoading) return;
    anvilLoading = true;
    for (const src of ANVIL_FILES) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        anvilBuffer = await a.decodeAudioData(await res.arrayBuffer());
        return;
      } catch (e) { /* try the next format */ }
    }
  }

  let actx = null;
  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      loadAnvil(actx);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function clang(vol = 0.35, pitch = 1) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    if (anvilBuffer) {
      const src = a.createBufferSource();
      src.buffer = anvilBuffer;
      src.playbackRate.value = pitch * (0.97 + Math.random() * 0.06);   // slight variety per hit
      const g = a.createGain();
      g.gain.value = Math.min(1, vol * ANVIL_GAIN);
      src.connect(g).connect(a.destination);
      src.start(t);
      return;
    }
    const out = a.createGain(); out.gain.value = vol; out.connect(a.destination);
    const partials = [[440, 0.5, 1.8], [1187, 0.35, 1.3], [1771, 0.25, 1.0], [2593, 0.18, 0.7], [3720, 0.12, 0.45]];
    partials.forEach(([f, amp, dur], i) => {
      const o = a.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * pitch * (0.985 + Math.random() * 0.03);
      const g = a.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    });
    const len = (a.sampleRate * 0.09) | 0;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource(); src.buffer = buf;
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = a.createGain(); ng.gain.value = 0.9;
    src.connect(hp).connect(ng).connect(out);
    src.start(t);
  }

  // ---------- Title: hover sparks, click to enter ----------
  let hovering = false;
  titleBtn.addEventListener('pointerenter', () => { if (state === 'title') { hovering = true; titleBtn.classList.add('hot'); } });
  titleBtn.addEventListener('pointerleave', () => { hovering = false; titleBtn.classList.remove('hot'); });
  titleBtn.addEventListener('focus', () => { if (state === 'title') { hovering = true; titleBtn.classList.add('hot'); } });
  titleBtn.addEventListener('blur', () => { hovering = false; titleBtn.classList.remove('hot'); });

  titleBtn.addEventListener('click', () => {
    if (state !== 'title') return;
    hovering = false;
    setState('entering');
    for (let i = 0; i < 14; i++) {
      const [x, y] = titlePoint();
      burst(x, y, 10, 520, Math.PI * 1.4);
    }
    clang(0.18, 1.35);
    trauma = 0.35;
    setCamera(PLAY_VIEW, 1500, 'cubic-bezier(.65,0,.25,1)');
    setTimeout(() => {
      titleBtn.classList.remove('hot');
      titleBtn.blur();
      setState('play');
    }, 1500);
  });

  // ---------- Play: strike the blade ----------
  let strikes = 0;
  let busy = false;

  function strike() {
    if (state !== 'play' || busy) return;
    busy = true;
    // wind-up: the scene pulls back slightly before the hammer lands
    windup.style.transition = 'transform 120ms cubic-bezier(.3,0,.6,1)';
    windup.style.transform = 'scale(.975) rotate(-.8deg)';
    setTimeout(() => {
      windup.style.transition = 'transform 90ms cubic-bezier(.2,1.8,.4,1)';
      windup.style.transform = '';
      impact();
    }, 120);
  }

  function impact() {
    strikes++;
    const [x, y] = centerOf(impactEl);
    burst(x, y, 90 + strikes * 30, 650 + strikes * 120);
    burst(x, y, 30, 380, Math.PI * 0.5, Math.PI * 0.15);   // a few skittering low
    burst(x, y, 30, 380, Math.PI * 0.5, Math.PI * 0.85);
    clang(0.35, 1 + strikes * 0.04);
    trauma = Math.min(1, 0.6 + strikes * 0.12);

    flash.style.setProperty('--fx', x + 'px');
    flash.style.setProperty('--fy', y + 'px');
    flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });

    bladeHeat.style.setProperty('--heat', (strikes / STRIKES_TO_FORGE * 0.85).toFixed(2));
    pips.children[strikes - 1]?.classList.add('on');

    if (strikes >= STRIKES_TO_FORGE) setTimeout(zoomToForge, 520);
    else setTimeout(() => { busy = false; }, 260);
  }

  app.addEventListener('pointerdown', (e) => { if (state === 'play' && e.button === 0) strike(); });
  addEventListener('keydown', (e) => {
    if (state === 'play' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); strike(); }
  });

  // ---------- Zoom into the blade, then the forge table ----------
  let zoomSparksUntil = 0;
  function zoomToForge() {
    setState('zooming');
    setCamera({ x: IMPACT.x, y: IMPACT.y, s: 9 }, 1400, 'cubic-bezier(.7,0,.35,1)');
    zoomSparksUntil = performance.now() + 1300;
    setTimeout(() => {
      setState('forge');
      camera.style.transition = 'none';
      for (let i = 0; i < 40; i++) mote();
      window.dispatchEvent(new Event('forger:forge'));
    }, 1400);
  }

  // Dull "wrong piece" thud and a short timer tick
  function thunk(vol = 0.4) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.22);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.32);
  }
  function tick(vol = 0.12) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = 1900;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.05);
  }

  // Shared effects for the matching game (forge-game.js)
  window.ForgerFX = {
    burst, clang, thunk, tick,
    shake(amount) { trauma = Math.min(1, Math.max(trauma, amount)); },
    get state() { return state; },
  };

  // Debug: ?skip jumps straight to the forge table
  if (new URLSearchParams(location.search).has('skip')) {
    setState('forge');
    setTimeout(() => window.dispatchEvent(new Event('forger:forge')), 50);
  }

  // Forge light flicker: layered sines + a little jitter so it never loops visibly
  function flicker(t) {
    const v = 0.5
      + 0.22 * Math.sin(t * 1.3 + 1.1)
      + 0.14 * Math.sin(t * 3.7 + 0.4)
      + 0.08 * Math.sin(t * 8.9 + 2.3)
      + (Math.random() - 0.5) * 0.07;
    // set opacity on the two light layers only, so nothing else gets restyled
    glowLayer.style.opacity = (0.2 + v * 0.25).toFixed(3);
    hazeLayer.style.opacity = (0.35 + v * 0.35).toFixed(3);
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let hoverAcc = 0, moteAcc = 0;
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    if (hovering && state === 'title') {
      hoverAcc += dt * 70;              // sparks per second while hovering
      while (hoverAcc >= 1) {
        hoverAcc--;
        const [x, y] = titlePoint();
        burst(x, y, 1 + (Math.random() < 0.3 ? 2 : 0), 320, Math.PI * 1.2);
      }
      titleBtn.style.setProperty('--heat', (0.8 + Math.sin(t * 9) * 0.1 + Math.random() * 0.1).toFixed(2));
    }

    if (state === 'zooming' && now < zoomSparksUntil) {
      const [x, y] = centerOf(impactEl);
      burst(x, y, 4, 900, Math.PI * 2);
    }

    if (state === 'forge') {
      flicker(t);
      moteAcc += dt * 7;
      while (moteAcc >= 1) { moteAcc--; if (parts.length < 120) mote(); }
    }

    applyShake(dt, t);
    drawParts(dt, t);
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
})();
