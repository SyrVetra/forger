// Forger's hand-drawn typeface, cut from assets/font-sheet.jpg.
// Each glyph is the white body of a letter on the sheet (found by flooding from a seed
// point inside it, with gaps in the ink closed), plus the ink outline around it.
// Text inside the game's UI is swapped for these glyphs automatically.
(() => {
  'use strict';

  const SHEET = 'assets/font-sheet.jpg';

  // box = [x0, y0, x1, y1] of the letter body on the sheet, seeds = points inside it
  const GLYPHS = {
    A: { box: [40, 57, 232, 248], seeds: [[136, 181]] },
    B: { box: [172, 63, 338, 252], seeds: [[256, 159]] },
    C: { box: [338, 65, 485, 249], seeds: [[398, 157]] },
    D: { box: [497, 61, 637, 247], seeds: [[553, 105]] },
    E: { box: [644, 54, 791, 248], seeds: [[716, 150]] },
    F: { box: [798, 50, 975, 248], seeds: [[886, 150]] },
    G: { box: [993, 50, 1214, 245], seeds: [[1105, 142]] },
    H: { box: [1199, 48, 1405, 247], seeds: [[1303, 148]] },
    I: { box: [1412, 45, 1498, 241], seeds: [[1456, 141]] },
    J: { box: [1517, 51, 1652, 249], seeds: [[1585, 151]] },
    K: { box: [1651, 41, 1837, 250], seeds: [[1743, 145]] },
    L: { box: [1804, 52, 1961, 245], seeds: [[1884, 148]] },
    M: { box: [24, 266, 253, 501], seeds: [[140, 386]] },
    N: { box: [264, 273, 459, 498], seeds: [[360, 385]] },
    O: { box: [475, 274, 632, 498], seeds: [[603, 386]] },
    P: { box: [654, 275, 817, 498], seeds: [[734, 399]] },
    Q: { box: [833, 267, 1037, 513], seeds: [[937, 419]] },
    R: { box: [998, 274, 1213, 501], seeds: [[1106, 386]] },
    S: { box: [1190, 264, 1372, 498], seeds: [[1282, 380]] },
    T: { box: [1379, 270, 1602, 496], seeds: [[1491, 382]] },
    U: { box: [1595, 272, 1801, 502], seeds: [[1719, 388]] },
    V: { box: [27, 515, 317, 780], seeds: [[207, 663]] },
    W: { box: [304, 519, 652, 775], seeds: [[476, 647]] },
    X: { box: [581, 530, 951, 787], seeds: [[765, 658]] },
    Y: { box: [974, 528, 1278, 785], seeds: [[1126, 656]] },
    Z: { box: [1269, 534, 1608, 779], seeds: [[1437, 658]] },
    1: { box: [1277, 959, 1375, 1089], seeds: [[1325, 1023]] },
    2: { box: [1348, 956, 1491, 1089], seeds: [[1424, 1024]] },
    3: { box: [1474, 959, 1587, 1087], seeds: [[1530, 1015]] },
    4: { box: [1602, 955, 1699, 1079], seeds: [[1654, 1011]] },
    5: { box: [1715, 960, 1781, 1078], seeds: [[1750, 976], [1747, 1043]] },
    6: { box: [1795, 960, 1884, 1082], seeds: [[1839, 1024]] },
    7: { box: [1887, 951, 1993, 1084], seeds: [[1955, 1031]] },
    8: { box: [4, 1117, 143, 1277], seeds: [[72, 1197]] },
    9: { box: [147, 1119, 261, 1280], seeds: [[203, 1199]] },
    0: { box: [264, 1119, 366, 1279], seeds: [[284, 1203]] },
  };

  const OUTLINE = 13;     // px of ink kept around each letter body
  const GLYPH_H = 0.9;    // rendered glyph height, in em

  // Elements whose text is drawn in the sketch font
  const ROOTS = '#hud, #order, #banner, #menu, #hint, #strike-ui, .float';

  const atlas = {};       // char -> { x, y, w, h }
  let atlasUrl = '', atlasW = 0, atlasH = 0;
  let ready = false;

  function cutGlyph(px, sheetW, sheetH, g) {
    const { dilate } = window.ForgerCut;
    const P = OUTLINE + 6;
    const x0 = Math.max(0, g.box[0] - P), y0 = Math.max(0, g.box[1] - P);
    const x1 = Math.min(sheetW - 1, g.box[2] + P), y1 = Math.min(sheetH - 1, g.box[3] + P);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;

    const lum = new Uint8Array(n), ink = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = ((y0 + y) * sheetW + (x0 + x)) * 4, i = y * w + x;
        lum[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0;
        ink[i] = lum[i] < 150 ? 1 : 0;
      }
    }
    const wall = dilate(ink, w, h, 2);

    // flood the letter body from its seed point(s)
    const body = new Uint8Array(n), q = new Int32Array(n);
    let qh = 0, qt = 0;
    const push = (i) => { if (!body[i] && !wall[i]) { body[i] = 1; q[qt++] = i; } };
    for (const [sx, sy] of g.seeds) push((sy - y0) * w + (sx - x0));
    while (qh < qt) {
      const i = q[qh++], cx = i % w;
      if (cx > 0) push(i - 1);
      if (cx < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }

    // body grown by the outline width = the letter with its ink edge
    const mask = dilate(body, w, h, OUTLINE);
    const out = new ImageData(w, h), od = out.data;
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const j = i * 4, L = lum[i];
      od[j] = L; od[j + 1] = L * 0.97; od[j + 2] = L * 0.9; od[j + 3] = 255;
      const x = i % w, y = (i / w) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(out, 0, 0);
    return { canvas: c, sx: bx0, sy: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
  }

  async function build() {
    const img = await window.ForgerCut.loadImage(SHEET);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;

    // pack glyphs in one row-wrapped atlas
    const cuts = Object.entries(GLYPHS).map(([ch, def]) => [ch, cutGlyph(px, img.width, img.height, def)]);
    const MAXW = 2048;
    let x = 0, y = 0, rowH = 0;
    for (const [ch, cut] of cuts) {
      if (x + cut.w > MAXW) { x = 0; y += rowH + 2; rowH = 0; }
      atlas[ch] = { x, y, w: cut.w, h: cut.h };
      x += cut.w + 2;
      rowH = Math.max(rowH, cut.h);
    }
    atlasW = MAXW; atlasH = y + rowH;
    const a = document.createElement('canvas');
    a.width = atlasW; a.height = atlasH;
    const ag = a.getContext('2d');
    for (const [ch, cut] of cuts) {
      const p = atlas[ch];
      ag.drawImage(cut.canvas, cut.sx, cut.sy, cut.w, cut.h, p.x, p.y, cut.w, cut.h);
    }
    // Use a short blob: URL in a plain rule. (A multi-MB data URL in a CSS variable gets
    // re-parsed for every glyph on every style recalc, which dropped the game to ~2 fps.)
    const blob = await new Promise((res) => a.toBlob(res, 'image/png'));
    atlasUrl = URL.createObjectURL(blob);
    const style = document.createElement('style');
    style.textContent = `.sk-g { background-image: url(${atlasUrl}); }`;
    document.head.appendChild(style);
    ready = true;
    document.querySelectorAll(ROOTS).forEach(convertTree);
  }

  // ---------- Rendering text ----------
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  function glyphSpan(ch) {
    const p = atlas[ch];
    const s = document.createElement('span');
    if (!p) {
      s.className = 'sk-x';            // punctuation and anything not on the sheet
      s.textContent = ch;
      return s;
    }
    const k = GLYPH_H / p.h;           // sheet px -> em
    s.className = 'sk-g';
    s.style.width = (p.w * k).toFixed(3) + 'em';
    s.style.backgroundSize = `${(atlasW * k).toFixed(3)}em ${(atlasH * k).toFixed(3)}em`;
    s.style.backgroundPosition = `${(-p.x * k).toFixed(3)}em ${(-p.y * k).toFixed(3)}em`;
    return s;
  }

  function render(text) {
    const wrap = document.createElement('span');
    wrap.className = 'sk';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', text);
    const words = norm(text).split(/(\s+)/);
    for (const w of words) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { wrap.appendChild(document.createTextNode(' ')); continue; }
      const ws = document.createElement('span');
      ws.className = 'sk-w';
      ws.setAttribute('aria-hidden', 'true');
      for (const ch of w) ws.appendChild(glyphSpan(ch));
      wrap.appendChild(ws);
    }
    return wrap;
  }

  function convertText(node) {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('.sk')) return;
    node.replaceWith(render(text));
  }

  function convertTree(root) {
    if (root.nodeType === 3) { convertText(root); return; }
    if (root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(convertText);
  }

  const inRoot = (n) => {
    const el = n.nodeType === 1 ? n : n.parentElement;
    return el && el.closest(ROOTS) && !el.closest('.sk');
  };

  new MutationObserver((muts) => {
    if (!ready) return;
    for (const m of muts) {
      if (m.type === 'characterData') { if (inRoot(m.target)) convertText(m.target); continue; }
      for (const n of m.addedNodes) if (inRoot(n)) convertTree(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  build().catch((err) => console.error('Forger: could not build the sketch font', err));
  window.SketchFont = { render, get ready() { return ready; } };
})();
