// Forger: the timed matching game on the forge table.
// A target combination (blade + guard + grip) is shown assembled, then shrinks to
// words at the top. Every piece is scattered on the table and the player hammers
// the right three into place before time runs out.
(() => {
  'use strict';

  const ART_W = 2000, ART_H = 1390;   // forge table art size; all layout is in these units
  const S = 0.58;                     // sketch px -> table units

  // Crop rects are [x0, y0, x1, y1] in each 2000x1390 sketch.
  // Guard anchor = [x, bladeY, gripY] as fractions of the guard: where the blade's
  // base and the grip's top attach.
  const SWORDS = [
    { id: 'shortsword', name: 'Short Sword', src: 'assets/sketches/shortsword.jpg', parts: {
      blade: { rect: [1680, 485, 1955, 1340] },
      guard: { rect: [1270, 1150, 1595, 1295], anchor: [0.5, 0.45, 0.72] },
      grip:  { rect: [1150, 1025, 1255, 1310] },
    } },
    { id: 'katana', name: 'Katana', src: 'assets/sketches/katana.jpg', parts: {
      blade: { rect: [955, 1205, 1900, 1315], rotate: true },
      // block guard: the blade seats in the top tab, the grip under the bar
      guard: { rect: [1530, 1020, 1765, 1140], anchor: [0.5, 0.06, 0.9] },
      grip:  { rect: [1015, 930, 1145, 1185] },
    } },
    { id: 'rapier', name: 'Rapier', src: 'assets/sketches/rapier.jpg', parts: {
      blade: { rect: [1615, 705, 1700, 1370] },
      guard: { rect: [1195, 1025, 1435, 1335], anchor: [0.36, 0.08, 0.55] },
      grip:  { rect: [1485, 1105, 1580, 1370] },
    } },
    { id: 'lightsaber', name: 'Lightsaber', src: 'assets/sketches/lightsaber.jpg', parts: {
      blade: { rect: [1240, 730, 1378, 1382] },
      grip:  { rect: [1382, 1170, 1500, 1382] },
    } },
    { id: 'zweihander', name: 'Zweihänder', src: 'assets/sketches/zweihander.jpg', parts: {
      blade: { rect: [875, 595, 1075, 1386] },
      guard: { rect: [1080, 1270, 1500, 1389], anchor: [0.5, 0.38, 0.62] },
      grip:  { rect: [1545, 1090, 1655, 1378] },
    } },
  ];
  const SLOTS = ['blade', 'guard', 'grip'];
  const SLOT_LABEL = { blade: 'Blade', guard: 'Guard', grip: 'Grip' };

  // Timing
  const REVEAL_MS = 3000;   // finished sword + parts list on screen
  const GO_MS = 2000;       // GET FORGING card before the pieces drop
  const roundTime = (round) => Math.max(12, 32 - (round - 1) * 2);
  const WRONG_PENALTY = 3;

  // Layout
  const JOINT = { x: 1000, y: 800 };              // where blade, guard and grip meet
  const KEEP_OUT = { x0: 800, x1: 1200 };         // center column stays clear for assembling
  const REGIONS = [
    { x0: 50, y0: 200, x1: 790, y1: 1345 },
    { x0: 1210, y0: 200, x1: 1950, y1: 1345 },
  ];

  // ---------- Elements ----------
  const forge = document.getElementById('forge');
  const table = document.createElement('div');
  table.id = 'table';
  table.innerHTML = `
    <div id="anvil-glow"></div>
    <div id="pieces"></div>
    <div id="hud">
      <div id="hud-left"><span id="hud-round">Round 1</span><span id="hud-score">Score 0</span></div>
      <div id="order"></div>
      <div id="hud-timer"><span id="timer-num">30</span><div id="timer-bar"><i></i></div></div>
    </div>
    <div id="banner"></div>`;
  forge.appendChild(table);
  const piecesEl = table.querySelector('#pieces');
  const orderEl = table.querySelector('#order');
  const bannerEl = table.querySelector('#banner');
  const roundEl = table.querySelector('#hud-round');
  const scoreEl = table.querySelector('#hud-score');
  const timerNum = table.querySelector('#timer-num');
  const timerBar = table.querySelector('#timer-bar i');
  const timerBox = table.querySelector('#hud-timer');

  const FX = () => window.ForgerFX || { burst() {}, clang() {}, thunk() {}, tick() {}, shake() {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const pctX = (v) => (v / ART_W * 100) + '%';
  const pctY = (v) => (v / ART_H * 100) + '%';

  // ---------- Cutting pieces out of the sketches ----------
  // Background = light pixels connected to the crop edge (after closing small gaps in
  // the ink), everything else is the piece. Interiors get a warm parchment tint.
  const DEFS = {};   // key "katana:blade" -> { key, sword, slot, url, w, h, alpha, anchor }

  const { loadImage, cutPiece } = window.ForgerCut;

  let ready = null;
  function preparePieces() {
    if (ready) return ready;
    ready = Promise.all(SWORDS.map(async (sw) => {
      const img = await loadImage(sw.src);
      for (const slot of SLOTS) {
        const p = sw.parts[slot];
        if (!p) continue;
        const cut = cutPiece(img, p.rect, p.rotate, p.scale);
        DEFS[`${sw.id}:${slot}`] = {
          key: `${sw.id}:${slot}`, sword: sw, slot, ...cut,
          anchor: p.anchor || [0.5, 0.4, 0.6],
        };
      }
    }));
    return ready;
  }

  // ---------- Pieces on the table ----------
  function makePieceEl(def, cls = 'piece') {
    const el = document.createElement('img');
    el.className = cls;
    el.src = def.url;
    el.alt = `${def.sword.name} ${SLOT_LABEL[def.slot]}`;
    el.draggable = false;
    el.dataset.slot = def.slot;
    el.dataset.sword = def.sword.id;
    el.style.width = pctX(def.w * S);
    return el;
  }

  function setPose(el, x, y, rot) {
    el.style.left = pctX(x);
    el.style.top = pctY(y);
    el.style.transform = `translate(-50%, -50%) rotate(${rot}rad)`;
  }

  // Where each part of a combination sits once assembled
  function assemblyPoses(combo) {
    const guard = combo.guard, blade = combo.blade, grip = combo.grip;
    const [ax, bY, gY] = guard.anchor;
    const gw = guard.w * S, gh = guard.h * S;
    const mid = (bY + gY) / 2;
    const gx = JOINT.x + (0.5 - ax) * gw;
    const gy = JOINT.y + (0.5 - mid) * gh;
    const bladeBase = JOINT.y + (bY - mid) * gh;
    const gripTop = JOINT.y + (gY - mid) * gh;
    return {
      guard: { x: gx, y: gy },
      blade: { x: JOINT.x, y: bladeBase - blade.h * S / 2 + 4 },
      grip:  { x: JOINT.x, y: gripTop + grip.h * S / 2 - 4 },
    };
  }

  function scatter(defs) {
    // blades first (biggest), lying roughly sideways; others mostly upright
    const order = [...defs].sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    const poses = new Map();
    for (const d of order) {
      const w = d.w * S, h = d.h * S;
      let best = null;
      for (let tries = 0; tries < 400; tries++) {
        const rot = d.slot === 'blade'
          ? (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.35)
          : (Math.random() - 0.5) * 0.9;
        const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
        const bw = w * c + h * s, bh = w * s + h * c;
        const r = pick(REGIONS);
        if (bw > r.x1 - r.x0 || bh > r.y1 - r.y0) continue;
        const x = r.x0 + bw / 2 + Math.random() * (r.x1 - r.x0 - bw);
        const y = r.y0 + bh / 2 + Math.random() * (r.y1 - r.y0 - bh);
        const box = { x0: x - bw / 2 - 14, x1: x + bw / 2 + 14, y0: y - bh / 2 - 14, y1: y + bh / 2 + 14 };
        const hits = placed.filter((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0).length;
        if (!best || hits < best.hits) best = { x, y, rot, box, hits };
        if (hits === 0) break;
      }
      placed.push(best.box);
      poses.set(d.key, best);
    }
    return poses;
  }


  // ---------- Game state ----------
  // Solo: every round has its own countdown; running out ends the game.
  // Vs.:  one shared match clock; both players get the same target sequence (seeded)
  //       and race to score the most before it runs out.
  const VS_WRONG_POINTS = 25;
  const VS_FAST_SECONDS = 15;          // speed bonus: 10 pts per second under this

  let pieces = [];        // { def, el, x, y, rot, placed, flying }
  let target = null;      // { blade, guard, grip } -> def
  let filled = {};
  let mode = 'solo';      // solo | vs
  let round = 0, score = 0, timeLeft = 0, timeMax = 1;
  let phase = 'idle';     // idle | reveal | play | forged | over
  let lastTick = 0;
  let roundStartedAt = 0;
  let rng = Math.random;
  let vs = null;          // { endAt (local ms), onScore, onTimeUp, rival }
  let gen = 0;            // bumped on every start/stop so stale async steps bail out
  let best = 0;
  try { best = +localStorage.getItem('forger.best') || 0; } catch (e) {}

  function mulberry32(a) {
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rpick = (arr) => arr[(rng() * arr.length) | 0];

  function updateHud() {
    if (mode === 'vs') {
      roundEl.textContent = `You ${score}`;
      scoreEl.textContent = `Rival ${vs ? vs.rival : 0}`;
    } else {
      roundEl.textContent = `Round ${round}`;
      scoreEl.textContent = `Score ${score}` + (best ? ` · Best ${best}` : '');
    }
  }

  function showBanner(html, cls = '') {
    bannerEl.innerHTML = html;
    bannerEl.className = 'show ' + cls;
  }
  const hideBanner = () => { bannerEl.className = ''; };

  // Buttons inside banners (game over / results)
  bannerEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    FX().burst(e.clientX, e.clientY, 18, 380);
    FX().clang(0.2, 1.2);
    if (b.dataset.act === 'again') startSolo();
    if (b.dataset.act === 'menu') { stop(); window.dispatchEvent(new Event('forger:menu')); }
  });

  function renderOrder() {
    orderEl.innerHTML = SLOTS.map((slot) => {
      const d = target[slot];
      return `<span class="part${filled[slot] ? ' done' : ''}" data-slot="${slot}">${d.sword.name} ${SLOT_LABEL[slot]}</span>`;
    }).join('<b>+</b>');
  }

  function clearTable() {
    piecesEl.innerHTML = '';
    pieces = [];
    hovered = null;
  }

  function enterGame(newMode) {
    const g = ++gen;
    mode = newMode;
    round = 0; score = 0;
    hideBanner();
    table.classList.add('in-game');
    table.classList.toggle('vs', mode === 'vs');
    return g;
  }

  async function startSolo() {
    await preparePieces();
    const g = enterGame('solo');
    rng = Math.random;
    vs = null;
    nextRound(g);
  }

  // opts: { seed, endAt (local ms), duration (s), onScore(score), onTimeUp() }
  async function startVs(opts) {
    await preparePieces();
    const g = enterGame('vs');
    rng = mulberry32(opts.seed);
    vs = { endAt: opts.endAt, onScore: opts.onScore, onTimeUp: opts.onTimeUp, rival: 0 };
    timeMax = opts.duration;
    timeLeft = Math.max(0, (vs.endAt - Date.now()) / 1000);
    lastTick = Math.ceil(timeLeft);
    nextRound(g);
  }

  function stop() {
    gen++;
    phase = 'idle';
    clearTable();
    hideBanner();
    orderEl.innerHTML = '';
    table.classList.remove('in-game', 'vs', 'revealing', 'forged-glow');
  }

  function setRival(n) {
    if (!vs) return;
    vs.rival = n;
    updateHud();
  }

  // Freeze the board when a vs. match ends (time up or rival left)
  function endVs() {
    gen++;
    phase = 'over';
    timeLeft = 0;
    renderTimer();
    table.classList.remove('revealing', 'forged-glow');
    pieces.forEach((p) => { if (!p.placed) p.el.classList.add('cold'); });
  }

  async function nextRound(g) {
    if (g !== gen) return;
    round++;
    updateHud();
    clearTable();
    filled = {};
    target = {
      blade: DEFS[`${rpick(SWORDS).id}:blade`],
      guard: DEFS[`${rpick(SWORDS.filter((s) => s.parts.guard)).id}:guard`],
      grip: DEFS[`${rpick(SWORDS).id}:grip`],
    };
    if (mode === 'solo') timeMax = timeLeft = roundTime(round);
    renderTimer();

    // 1. Show the finished combination: the assembled sword with its full parts list
    //    underneath. Nothing covers it.
    phase = 'reveal';
    table.classList.add('revealing');
    orderEl.className = 'center';
    renderOrder();
    hideBanner();
    const poses = assemblyPoses(target);
    const ghosts = SLOTS.map((slot) => {
      const el = makePieceEl(target[slot], `piece reveal slot-${slot}`);
      setPose(el, poses[slot].x, poses[slot].y, 0);
      piecesEl.appendChild(el);
      return el;
    });
    await wait(REVEAL_MS);
    if (g !== gen) return;

    // 2. Sword fades, the list moves up to the top center, and GET FORGING takes the screen
    ghosts.forEach((el) => el.classList.add('vanish'));
    orderEl.className = 'top';
    table.classList.remove('revealing');
    showBanner('GET FORGING', 'go');
    FX().clang(0.25, 1.15);
    await wait(650);
    if (g !== gen) return;
    ghosts.forEach((el) => el.remove());
    await wait(GO_MS - 650);
    if (g !== gen) return;
    hideBanner();

    // 3. Every piece lands on the table
    const all = Object.values(DEFS);
    const spots = scatter(all);
    all.sort(() => Math.random() - 0.5).forEach((def, i) => {
      const s = spots.get(def.key);
      const el = makePieceEl(def);
      setPose(el, s.x, s.y, s.rot);
      el.style.animationDelay = (i * 45) + 'ms';
      el.classList.add('drop');
      piecesEl.appendChild(el);
      pieces.push({ def, el, x: s.x, y: s.y, rot: s.rot, placed: false, flying: false });
    });
    await wait(all.length * 45 + 300);
    if (g !== gen) return;
    phase = 'play';
    roundStartedAt = performance.now();
    lastTick = Math.ceil(timeLeft);
  }

  // ---------- Hitting pieces ----------
  function toArt(clientX, clientY) {
    const r = table.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width * ART_W, y: (clientY - r.top) / r.height * ART_H, scale: r.width / ART_W };
  }

  function alphaAt(def, ix, iy) {
    ix |= 0; iy |= 0;
    if (ix < 0 || iy < 0 || ix >= def.w || iy >= def.h) return 0;
    return def.alpha[iy * def.w + ix];
  }

  function hitTest(clientX, clientY) {
    const p = toArt(clientX, clientY);
    const tol = 7 / p.scale / S;   // ~7 screen px of forgiveness, in sketch px
    const offs = [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol]];
    for (let i = pieces.length - 1; i >= 0; i--) {
      const pc = pieces[i];
      if (pc.placed || pc.flying) continue;
      const dx = p.x - pc.x, dy = p.y - pc.y;
      const c = Math.cos(pc.rot), s = Math.sin(pc.rot);
      const lx = (dx * c + dy * s) / S + pc.def.w / 2;
      const ly = (-dx * s + dy * c) / S + pc.def.h / 2;
      for (const [ox, oy] of offs) if (alphaAt(pc.def, lx + ox, ly + oy) > 60) return pc;
    }
    return null;
  }

  function artToClient(x, y) {
    const r = table.getBoundingClientRect();
    return [r.left + x / ART_W * r.width, r.top + y / ART_H * r.height];
  }

  function floatText(text, x, y, cls) {
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = pctX(x);
    el.style.top = pctY(y);
    table.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function onHit(e) {
    if (phase !== 'play') return;
    const fx = FX();
    const pc = hitTest(e.clientX, e.clientY);
    if (!pc) {
      fx.burst(e.clientX, e.clientY, 6, 180, Math.PI * 1.2);
      fx.thunk(0.12);
      return;
    }
    const slot = pc.def.slot;
    if (target[slot] === pc.def && !filled[slot]) {
      placePiece(pc, e.clientX, e.clientY);
      return;
    }
    // wrong piece: it rattles and costs time (solo) or points (vs.)
    if (mode === 'vs') {
      const lost = Math.min(score, VS_WRONG_POINTS);
      score -= lost;
      updateHud();
      vs.onScore?.(score);
      floatText(`-${VS_WRONG_POINTS}`, pc.x, pc.y - 30, 'bad');
      roundEl.animate([{ color: '#ff3b1f', scale: 1.15 }, { color: '', scale: 1 }], { duration: 450 });
    } else {
      timeLeft = Math.max(0, timeLeft - WRONG_PENALTY);
      floatText(`-${WRONG_PENALTY}s`, pc.x, pc.y - 30, 'bad');
      timerBox.animate([{ color: '#ff3b1f', scale: 1.15 }, { color: '', scale: 1 }], { duration: 450 });
    }
    fx.thunk(0.4);
    fx.shake(0.25);
    fx.burst(e.clientX, e.clientY, 10, 240, Math.PI * 1.4);
    pc.el.animate([
      { translate: '0 0' }, { translate: '-1.2% -1%' }, { translate: '1% 0.6%' }, { translate: '-0.6% 0' }, { translate: '0 0' },
    ], { duration: 280, easing: 'ease-out' });
  }

  function placePiece(pc, cx, cy) {
    const fx = FX();
    const g = gen;
    pc.flying = true;
    filled[pc.def.slot] = true;
    renderOrder();
    fx.clang(0.3, 1.05);
    fx.burst(cx, cy, 40, 520);
    fx.shake(0.35);

    const dest = assemblyPoses(target)[pc.def.slot];
    pc.el.classList.add('flying', `slot-${pc.def.slot}`);
    pc.el.classList.remove('hover');
    const from = { left: pc.el.style.left, top: pc.el.style.top, transform: pc.el.style.transform };
    setPose(pc.el, dest.x, dest.y, 0);
    const to = { left: pc.el.style.left, top: pc.el.style.top, transform: pc.el.style.transform };
    const midT = `translate(-50%, -50%) rotate(${pc.rot / 3}rad) scale(1.15)`;
    pc.el.animate([
      from,
      { left: pctX((pc.x + dest.x) / 2), top: pctY(Math.min(pc.y, dest.y) - 140), transform: midT, offset: 0.5 },
      to,
    ], { duration: 520, easing: 'cubic-bezier(.45,0,.35,1)' }).finished.then(() => {
      if (g !== gen) return;
      pc.flying = false;
      pc.placed = true;
      pc.el.classList.remove('flying');
      pc.el.classList.add('placed');
      const [jx, jy] = artToClient(JOINT.x, JOINT.y);
      fx.clang(0.32, 0.92);
      fx.burst(jx, jy, 55, 600);
      fx.shake(0.4);
      if (SLOTS.every((s) => filled[s]) && phase === 'play') forged(g);
    });
  }

  async function forged(g) {
    phase = 'forged';
    const fx = FX();
    let bonus;
    if (mode === 'vs') {
      const took = (performance.now() - roundStartedAt) / 1000;
      bonus = 100 + Math.max(0, Math.ceil(VS_FAST_SECONDS - took)) * 10;
    } else {
      bonus = 100 + Math.ceil(timeLeft) * 10;
    }
    score += bonus;
    if (mode === 'solo' && score > best) {
      best = score;
      try { localStorage.setItem('forger.best', String(best)); } catch (e) {}
    }
    if (mode === 'vs') vs.onScore?.(score);
    updateHud();
    table.classList.add('forged-glow');
    const [jx, jy] = artToClient(JOINT.x, JOINT.y);
    for (let i = 0; i < 3; i++) setTimeout(() => fx.burst(jx, jy - 120 * i, 70, 800, Math.PI * 2), i * 120);
    fx.clang(0.4, 0.8);
    fx.shake(0.6);
    showBanner(`Forged! <small>+${bonus}</small>`);
    await wait(mode === 'vs' ? 1100 : 1900);
    if (g !== gen) return;
    hideBanner();
    table.classList.remove('forged-glow');
    pieces.forEach((p) => p.el.classList.add('vanish'));
    await wait(450);
    nextRound(g);
  }

  function timeUp() {
    if (mode === 'vs') {
      endVs();
      FX().thunk(0.5);
      showBanner('Time! <small>Tallying the scores…</small>');
      vs.onTimeUp?.();
      return;
    }
    gen++;
    phase = 'over';
    FX().thunk(0.5);
    FX().shake(0.5);
    pieces.forEach((p) => { if (!p.placed) p.el.classList.add('cold'); });
    const n = round - 1;
    showBanner(`Time's up! <small>You forged ${n} sword${n === 1 ? '' : 's'} · Score ${score}</small>
      <div class="btns"><button data-act="again">Forge again</button><button data-act="menu">Menu</button></div>`, 'over');
  }

  function fmtClock(s) {
    const t = Math.ceil(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  let timerLabel = '';
  function renderTimer() {
    const label = String(mode === 'vs' ? fmtClock(timeLeft) : Math.ceil(timeLeft));
    if (label !== timerLabel) { timerLabel = label; timerNum.textContent = label; }
    timerBar.style.width = (timeLeft / timeMax * 100) + '%';
    timerBox.classList.toggle('low', timeLeft <= (mode === 'vs' ? 10 : 5));
  }

  // ---------- Input ----------
  addEventListener('pointerdown', (e) => {
    if (FX().state !== 'forge' || e.button !== 0) return;
    onHit(e);
  });

  let hovered = null;
  addEventListener('pointermove', (e) => {
    if (phase !== 'play') return;
    const pc = hitTest(e.clientX, e.clientY);
    if (pc === hovered) return;
    hovered?.el.classList.remove('hover');
    hovered = pc;
    pc?.el.classList.add('hover');
  }, { passive: true });

  // ---------- Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const running = mode === 'vs'
      ? (phase === 'reveal' || phase === 'play' || phase === 'forged')   // shared clock never pauses
      : phase === 'play';
    if (running) {
      timeLeft = mode === 'vs'
        ? Math.max(0, (vs.endAt - Date.now()) / 1000)
        : Math.max(0, timeLeft - dt);
      const whole = Math.ceil(timeLeft);
      if (whole < lastTick) {
        lastTick = whole;
        if (whole <= 5 && whole > 0) FX().tick();
      }
      renderTimer();
      if (timeLeft <= 0) timeUp();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Once the camera lands on the forge table, show the mode menu (vs.js)
  preparePieces().catch((err) => console.error('Forger: could not cut sword pieces', err));
  window.addEventListener('forger:forge', () => setTimeout(() => window.dispatchEvent(new Event('forger:menu')), 1100));

  window.ForgerGame = {
    DEFS, SWORDS,
    startSolo, startVs, stop, setRival, endVs,
    banner: showBanner, hideBanner,
    get score() { return score; },
    // Debug: ForgerGame.showSet('katana') lays out a sword's own three pieces
    async showSet(id) {
      await preparePieces();
      stop();
      target = {
        blade: DEFS[`${id}:blade`],
        guard: DEFS[`${id}:guard`] || DEFS['shortsword:guard'],
        grip: DEFS[`${id}:grip`],
      };
      const poses = assemblyPoses(target);
      SLOTS.forEach((slot) => {
        const el = makePieceEl(target[slot], `piece placed slot-${slot}`);
        setPose(el, poses[slot].x, poses[slot].y, 0);
        piecesEl.appendChild(el);
      });
    },
  };
})();
