// Hammer cursor, cut from assets/hammer.jpg. It follows the pointer and swings down on
// every click, pivoting at the end of the handle so the head's lower edge lands on
// the pointer.
(() => {
  'use strict';

  const SRC = 'assets/hammer.jpg';
  const CROP = [330, 50, 1600, 1220];          // drawing area on the 2000x1390 scan
  const PIVOT = { x: 1528, y: 1112 };          // end of the handle, in scan px
  const HOT = { x: 503, y: 882 };              // middle of the striking edge, in scan px
  const WIDTH = 120;                           // rendered width in CSS px

  const el = document.createElement('div');
  el.id = 'hammer';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  el.appendChild(img);
  const aim = document.createElement('div');
  aim.id = 'hammer-aim';
  document.body.append(aim, el);

  let hot = { x: 0, y: 0 };   // hotspot in rendered px, relative to the image's top-left

  window.ForgerCut.loadImage(SRC).then((scan) => {
    const cut = window.ForgerCut.cutPiece(scan, CROP, false, 1);
    const k = WIDTH / cut.w;
    img.src = cut.url;
    img.style.width = WIDTH + 'px';
    hot = { x: (HOT.x - cut.ox) * k, y: (HOT.y - cut.oy) * k };
    img.style.transformOrigin = `${(PIVOT.x - cut.ox) * k}px ${(PIVOT.y - cut.oy) * k}px`;
    document.documentElement.classList.toggle('hammer-cursor', matchMedia('(pointer: fine)').matches);
    place();
  }).catch((err) => console.error('Forger: could not load the hammer cursor', err));

  let x = -999, y = -999, visible = false;
  function place() {
    el.style.transform = `translate(${x - hot.x}px, ${y - hot.y}px)`;
    aim.style.transform = `translate(${x}px, ${y}px)`;
  }
  function show(v) {
    if (v === visible) return;
    visible = v;
    el.classList.toggle('on', v);
    aim.classList.toggle('on', v);
  }

  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') show(true);
    place();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => show(false));

  let swingTimer = 0;
  addEventListener('pointerdown', (e) => {
    x = e.clientX; y = e.clientY;
    place();
    show(true);
    el.classList.remove('swing');
    void el.offsetWidth;              // restart the animation
    el.classList.add('swing');
    clearTimeout(swingTimer);
    swingTimer = setTimeout(() => {
      el.classList.remove('swing');
      if (e.pointerType === 'touch') show(false);
    }, 320);
  });
})();
