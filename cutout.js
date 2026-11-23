// Shared helpers for cutting drawings out of the sketch scans.
// Background = light pixels connected to the crop edge (after closing small gaps in
// the ink); everything else is the drawing. Light interiors get a warm parchment tint.
(() => {
  'use strict';

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function dilate(src, w, h, r) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!src[row + x]) continue;
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        for (let i = a; i <= b; i++) tmp[row + i] = 1;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!tmp[y * w + x]) continue;
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        for (let j = a; j <= b; j++) out[j * w + x] = 1;
      }
    }
    return out;
  }

  function cutPiece(img, rect, rotate, scale = 1) {
    const [x0, y0, x1, y1] = rect;
    const w = x1 - x0, h = y1 - y0, n = w * h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    const src = g.getImageData(0, 0, w, h);
    const px = src.data;

    const lum = new Uint8Array(n), ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      lum[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) | 0;
      ink[i] = lum[i] < 200 ? 1 : 0;
    }

    // close small gaps in the outline, then flood the background from the edges
    const R = 2;
    const wall = dilate(ink, w, h, R);
    const bg = new Uint8Array(n), q = new Int32Array(n);
    let qh = 0, qt = 0;
    const seed = (i) => { if (!bg[i] && !wall[i]) { bg[i] = 1; q[qt++] = i; } };
    for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], cx = i % w;
      if (cx > 0) seed(i - 1);
      if (cx < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
    const bgGrown = dilate(bg, w, h, R);
    const solid = new Uint8Array(n);
    for (let i = 0; i < n; i++) solid[i] = (bgGrown[i] && !ink[i]) ? 0 : 1;

    // drop small specks (stray strokes, neighbouring pieces poking into the crop)
    const comp = new Int32Array(n).fill(-1);
    const sizes = [];
    for (let s = 0; s < n; s++) {
      if (!solid[s] || comp[s] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      qh = qt = 0; comp[s] = id; q[qt++] = s;
      while (qh < qt) {
        const i = q[qh++], cx = i % w;
        size++;
        let k;
        if (cx > 0 && solid[k = i - 1] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (cx < w - 1 && solid[k = i + 1] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (i >= w && solid[k = i - w] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
        if (i < n - w && solid[k = i + w] && comp[k] < 0) { comp[k] = id; q[qt++] = k; }
      }
      sizes.push(size);
    }
    const biggest = Math.max(1, ...sizes);
    const keepMin = biggest * 0.015;

    const out = g.createImageData(w, h), od = out.data;
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 4, L = lum[i];
      const keep = solid[i] && sizes[comp[i]] >= keepMin;
      let a = 0;
      if (keep) a = 255;
      else if (!solid[i] && L < 240) {
        // soft edge next to kept ink
        a = Math.min(255, (240 - L) * 4);
      }
      if (!a) continue;
      od[j] = L; od[j + 1] = L * 0.95; od[j + 2] = L * 0.85; od[j + 3] = a;
      if (keep) {
        const x = i % w, y = (i / w) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    g.putImageData(out, 0, 0);

    // trim to the piece, optionally rotate 90deg clockwise so blades point up
    const pad = 3;
    bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad);
    bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);
    const sw = bx1 - bx0 + 1, sh = by1 - by0 + 1;
    const tw = Math.round(sw * scale), th = Math.round(sh * scale);
    const t = document.createElement('canvas');
    if (rotate) { t.width = th; t.height = tw; } else { t.width = tw; t.height = th; }
    const tg = t.getContext('2d', { willReadFrequently: true });
    if (rotate) { tg.translate(th, 0); tg.rotate(Math.PI / 2); }
    tg.drawImage(c, bx0, by0, sw, sh, 0, 0, tw, th);

    const ad = tg.getImageData(0, 0, t.width, t.height).data;
    const alpha = new Uint8Array(t.width * t.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = ad[i * 4 + 3];
    return { url: t.toDataURL('image/png'), canvas: t, w: t.width, h: t.height, alpha,
      ox: x0 + bx0, oy: y0 + by0, scale };
  }

  window.ForgerCut = { loadImage, dilate, cutPiece };
})();
