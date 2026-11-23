// Forger: mode menu (Solo / Vs.) and the Vs. match connection.
// Matches run through server.py: one player creates a match and gets a 4-digit code,
// the other joins with it, and both race for 1:30 on the same sequence of swords.
(() => {
  'use strict';

  const table = document.getElementById('table');   // created by forge-game.js
  const menu = document.createElement('div');
  menu.id = 'menu';
  table.appendChild(menu);

  const G = () => window.ForgerGame;
  const FX = () => window.ForgerFX;

  let match = null;   // { code, player, es, offset, started, ended, countdown }
  let entry = '';
  let screen = '';

  // ---------- Server calls ----------
  async function api(path, body = {}) {
    let res, data;
    try {
      res = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      data = await res.json();
    } catch (e) {
      throw new Error("Vs. matches need Forger's match server, which isn't running for this copy of the game. Solo Forge works here.");
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  // ---------- Screens ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function show(name, html) {
    screen = name;
    menu.innerHTML = html;
    menu.className = 'show';
  }
  function hide() {
    screen = '';
    menu.className = '';
    menu.innerHTML = '';
  }

  const screens = {
    main() {
      show('main', `
        <h2>Choose your forge</h2>
        <button data-act="solo">Solo Forge<small>Beat the clock, round after round</small></button>
        <button data-act="vs">Vs. Match<small>Race a rival for 1:30</small></button>`);
    },
    vs() {
      show('vs', `
        <h2>Vs. Match</h2>
        <button data-act="create">Create match<small>Get a code to share</small></button>
        <button data-act="join">Join match<small>Enter your rival's code</small></button>
        <button data-act="main" class="ghost">Back</button>`);
    },
    hosting(code) {
      show('hosting', `
        <h2>Your match code</h2>
        <div class="code">${esc(code)}</div>
        <p class="note">Give this code to your rival.<br>Waiting for them to join<span class="dots"></span></p>
        <button data-act="cancel" class="ghost">Cancel</button>`);
    },
    join(err = '') {
      const slots = [0, 1, 2, 3].map((i) => `<span>${esc(entry[i] || '')}</span>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clear']
        .map((k) => `<button data-act="key" data-key="${k}" class="${k.length > 1 ? 'fn' : ''}">${k === 'del' ? '⌫' : k === 'clear' ? 'C' : k}</button>`).join('');
      show('join', `
        <h2>Enter match code</h2>
        <div class="code entry">${slots}</div>
        <div class="keypad">${keys}</div>
        <p class="note err">${esc(err)}</p>
        <button data-act="back-vs" class="ghost">Back</button>`);
    },
    message(title, msg, act = 'back-vs') {
      show('message', `
        <h2>${esc(title)}</h2>
        <p class="note">${esc(msg)}</p>
        <button data-act="${act}" class="ghost">Back</button>`);
    },
  };

  // ---------- Actions ----------
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    FX()?.burst(e.clientX, e.clientY, 16, 360);
    FX()?.clang(0.18, 1.25);
    act(b.dataset.act, b.dataset.key);
  });

  addEventListener('keydown', (e) => {
    if (screen !== 'join') return;
    if (/^[0-9]$/.test(e.key)) act('key', e.key);
    else if (e.key === 'Backspace') act('key', 'del');
    else if (e.key === 'Escape') act('back-vs');
  });

  async function act(a, key) {
    switch (a) {
      case 'solo':
        hide();
        G().startSolo();
        break;
      case 'vs':
      case 'back-vs':
        leave();
        screens.vs();
        break;
      case 'main':
        screens.main();
        break;
      case 'create':
        try {
          const r = await api('create');
          match = { code: r.code, player: r.player, offset: 0 };
          screens.hosting(r.code);
          connect();
        } catch (err) {
          screens.message('Could not create a match', err.message);
        }
        break;
      case 'join':
        entry = '';
        screens.join();
        break;
      case 'key':
        if (key === 'del') entry = entry.slice(0, -1);
        else if (key === 'clear') entry = '';
        else if (entry.length < 4) entry += key;
        screens.join();
        if (entry.length === 4) joinMatch(entry);
        break;
      case 'cancel':
        leave();
        screens.vs();
        break;
    }
  }

  async function joinMatch(code) {
    try {
      const r = await api('join', { code });
      match = { code, player: r.player, offset: 0 };
      show('joined', `
        <h2>Joined match ${esc(code)}</h2>
        <p class="note">Get your hammer ready<span class="dots"></span></p>`);
      connect();
    } catch (err) {
      entry = '';
      screens.join(err.message);
    }
  }

  // ---------- Live match ----------
  function connect() {
    const m = match;
    const es = new EventSource(`/api/events?code=${encodeURIComponent(m.code)}&player=${encodeURIComponent(m.player)}`);
    m.es = es;
    es.onmessage = (ev) => {
      if (match !== m) return;
      const msg = JSON.parse(ev.data);
      m.offset = msg.now - Date.now();
      handle(m, msg);
    };
    es.onerror = () => {
      // EventSource retries by itself; CLOSED means the server refused (match is gone)
      if (match === m && es.readyState === EventSource.CLOSED && !m.ended) {
        lost('Lost the connection to the match.');
      }
    };
  }

  const rivalScore = (m, scores) => {
    const other = Object.keys(scores).find((id) => id !== m.player);
    return other ? scores[other] : 0;
  };

  function handle(m, msg) {
    switch (msg.type) {
      case 'start':
        if (m.started) return;   // reconnect: already running
        m.started = true;
        hide();
        countdown(m, msg);
        break;
      case 'score':
        G().setRival(rivalScore(m, msg.scores));
        break;
      case 'left':
        lost('Your rival left the match.');
        break;
      case 'end':
        finish(m, msg.scores);
        break;
    }
  }

  function countdown(m, msg) {
    const localStart = msg.startAt - m.offset;
    const localEnd = msg.endAt - m.offset;
    let shown = null;
    const step = () => {
      if (match !== m) return;
      const left = localStart - Date.now();
      if (left <= 0) {
        G().startVs({
          seed: msg.seed,
          endAt: localEnd,
          duration: (msg.endAt - msg.startAt) / 1000,
          onScore: (score) => api('score', { code: m.code, player: m.player, score }).catch(() => {}),
          onTimeUp: () => {
            // the server's final tally normally lands within a second
            m.fallback = setTimeout(() => finish(m, null), 4000);
          },
        });
        return;
      }
      const n = Math.ceil(left / 1000);
      if (n !== shown) {
        shown = n;
        G().banner(`${n}<small>Match ${esc(m.code)} · race to forge the most</small>`, 'count');
        FX()?.tick(0.2);
      }
      m.countdown = setTimeout(step, 50);
    };
    step();
  }

  function finish(m, scores) {
    if (match !== m || m.ended) return;
    m.ended = true;
    clearTimeout(m.fallback);
    m.es?.close();
    const you = scores ? (scores[m.player] ?? 0) : G().score;
    const rival = scores ? rivalScore(m, scores) : NaN;
    G().endVs();
    if (scores) G().setRival(rival);
    let title = 'Draw!';
    if (!scores) title = 'Match over';
    else if (you > rival) title = 'You win!';
    else if (you < rival) title = 'Rival wins';
    const detail = scores ? `You ${you} · Rival ${rival}` : `You ${you} · couldn't reach the server for your rival's score`;
    G().banner(`${title}<small>${detail}</small>
      <div class="btns"><button data-act="menu">Menu</button></div>`, 'over');
    if (scores && you > rival) {
      FX()?.clang(0.4, 0.75);
      const r = table.getBoundingClientRect();
      for (let i = 0; i < 5; i++) {
        setTimeout(() => FX()?.burst(r.left + r.width * (0.2 + 0.15 * i), r.top + r.height * 0.6, 50, 900), i * 140);
      }
    }
    match = null;
  }

  function lost(reason) {
    const m = match;
    if (!m || m.ended) return;
    m.ended = true;
    clearTimeout(m.countdown);
    clearTimeout(m.fallback);
    m.es?.close();
    match = null;
    if (m.started) {
      G().endVs();
      G().banner(`Match over<small>${esc(reason)}</small><div class="btns"><button data-act="menu">Menu</button></div>`, 'over');
    } else {
      G().hideBanner();
      screens.message('Match closed', reason);
    }
  }

  // Leave the current match (cancel, back, or returning to the menu)
  function leave() {
    const m = match;
    if (!m) return;
    match = null;
    clearTimeout(m.countdown);
    clearTimeout(m.fallback);
    m.es?.close();
    if (!m.ended) api('leave', { code: m.code, player: m.player }).catch(() => {});
  }

  addEventListener('pagehide', () => {
    if (match && !match.ended) {
      navigator.sendBeacon('/api/leave', new Blob([JSON.stringify({ code: match.code, player: match.player })], { type: 'application/json' }));
    }
  });

  window.addEventListener('forger:menu', () => {
    leave();
    G().stop();
    screens.main();
  });
})();
