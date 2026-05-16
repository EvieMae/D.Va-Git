// ═══════════════════════════════════════════════════════════════════════
//  CLOWN — hidden poker-scoring minigame
//  Triggered by holding Ctrl and typing C-L-O-W-N.
//
//  Everything here is original: joker names, effects, values, hand-score
//  table, shop pricing, and the background shader. No assets or text are
//  copied from any other game.
// ═══════════════════════════════════════════════════════════════════════

(() => {
  const SUITS = ['s', 'h', 'd', 'c'];          // spades, hearts, diamonds, clubs
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_LABEL = { T: '10' };
  const RANK_CHIPS = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 10, Q: 10, K: 10, A: 11 };
  const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

  // ── My own hand-score table. Format: [base_chips, base_mult]
  const HAND_SCORES = {
    HIGH_CARD:        { chips: 5,   mult: 1, label: 'High Card' },
    PAIR:             { chips: 10,  mult: 2, label: 'Pair' },
    TWO_PAIR:         { chips: 20,  mult: 2, label: 'Two Pair' },
    THREE_OF_A_KIND:  { chips: 30,  mult: 3, label: 'Three of a Kind' },
    STRAIGHT:         { chips: 30,  mult: 4, label: 'Straight' },
    FLUSH:            { chips: 35,  mult: 4, label: 'Flush' },
    FULL_HOUSE:       { chips: 40,  mult: 4, label: 'Full House' },
    FOUR_OF_A_KIND:   { chips: 60,  mult: 7, label: 'Four of a Kind' },
    STRAIGHT_FLUSH:   { chips: 100, mult: 8, label: 'Straight Flush' },
  };

  // ── Original joker designs. Each effect runs at score time and returns
  //    a list of mutations: { addChips?, addMult?, mulMult? }.
  // Jokers — no costs, all earned through end-of-blind picks.
  const JOKERS = [
    { id: 'jester',     name: 'The Jester',   face: '🤡',
      desc: '+4 Mult on every scored hand.',
      effect: () => ({ addMult: 4 }) },
    { id: 'smiley',     name: 'Smiley Face',  face: '😀',
      desc: '+30 Chips if the hand contains a Pair.',
      effect: (ctx) => ctx.handBuckets.pairs >= 1 ? { addChips: 30 } : null },
    { id: 'monochrome', name: 'Monochrome',   face: '🎴',
      desc: 'x1.5 Mult if all scored cards share one suit.',
      effect: (ctx) => new Set(ctx.scored.map(c => c.suit)).size === 1 ? { mulMult: 1.5 } : null },
    { id: 'cherry',     name: 'Cherry Bomb',  face: '🍒',
      desc: '+2 Mult per Heart in the scored hand.',
      effect: (ctx) => {
        const hearts = ctx.scored.filter(c => c.suit === 'h').length;
        return hearts ? { addMult: 2 * hearts } : null;
      } },
    { id: 'ironvest',   name: 'Iron Vest',    face: '🛡',
      desc: '+50 Chips if 4+ cards are scored.',
      effect: (ctx) => ctx.scored.length >= 4 ? { addChips: 50 } : null },
    { id: 'lucky7',     name: 'Lucky Seven',  face: '🎰',
      desc: '+25 Mult per 7 in scored hand.',
      effect: (ctx) => {
        const sevens = ctx.scored.filter(c => c.rank === '7').length;
        return sevens ? { addMult: 25 * sevens } : null;
      } },
    { id: 'royalist',   name: 'Royalist',     face: '👑',
      desc: '+20 Chips per face card (J/Q/K) scored.',
      effect: (ctx) => {
        const faces = ctx.scored.filter(c => 'JQK'.includes(c.rank)).length;
        return faces ? { addChips: 20 * faces } : null;
      } },
    { id: 'ladybug',    name: 'Ladybug',      face: '🐞',
      desc: '+3 Mult per scored card.',
      effect: (ctx) => ({ addMult: 3 * ctx.scored.length }) },
    { id: 'split',      name: 'The Split',    face: '✂',
      desc: 'x2 Mult if exactly 2 cards scored.',
      effect: (ctx) => ctx.scored.length === 2 ? { mulMult: 2 } : null },
    { id: 'midnight',   name: 'Midnight',     face: '🌙',
      desc: 'x1.25 Mult on every hand.',
      effect: () => ({ mulMult: 1.25 }) },
    { id: 'lockstep',   name: 'Lockstep',     face: '⚙',
      desc: 'x2 Mult on Straights and Straight Flushes.',
      effect: (ctx) => (ctx.handBuckets.isStraight) ? { mulMult: 2 } : null },
    { id: 'noblegas',   name: 'Noble Gas',    face: '💎',
      desc: 'x1.5 Mult on Flushes (any kind).',
      effect: (ctx) => (ctx.handBuckets.isFlush) ? { mulMult: 1.5 } : null },
  ];
  const JOKER_BY_ID = Object.fromEntries(JOKERS.map(j => [j.id, j]));

  // ── Deck / shuffling
  function buildDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
    return d;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Hand evaluation
  function evaluate(cards) {
    if (!cards.length) return { type: 'HIGH_CARD', scored: [], buckets: emptyBuckets() };
    const byRank = {};
    for (const c of cards) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const groups = Object.values(byRank).sort((a, b) => b.length - a.length || RANK_ORDER[b[0].rank] - RANK_ORDER[a[0].rank]);
    const counts = groups.map(g => g.length);
    const sortedByRank = [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    const ranks = sortedByRank.map(c => RANK_ORDER[c.rank]);
    const distinctRanks = [...new Set(ranks)];

    const isFlush = cards.length === 5 && new Set(cards.map(c => c.suit)).size === 1;
    const isStraight = (() => {
      if (distinctRanks.length !== 5) return false;
      const mn = Math.min(...distinctRanks), mx = Math.max(...distinctRanks);
      if (mx - mn === 4) return true;
      // Ace-low: A,2,3,4,5
      const set = new Set(distinctRanks);
      return set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5);
    })();

    const buckets = {
      pairs: counts.filter(c => c === 2).length,
      trips: counts.filter(c => c === 3).length,
      quads: counts.filter(c => c === 4).length,
      isFlush, isStraight,
    };

    let type = 'HIGH_CARD', scored = [];
    if (isStraight && isFlush)             { type = 'STRAIGHT_FLUSH'; scored = cards.slice(); }
    else if (buckets.quads)                { type = 'FOUR_OF_A_KIND'; scored = groups[0]; }
    else if (buckets.trips && buckets.pairs){ type = 'FULL_HOUSE';     scored = [...groups[0], ...groups[1]]; }
    else if (isFlush)                      { type = 'FLUSH';           scored = cards.slice(); }
    else if (isStraight)                   { type = 'STRAIGHT';        scored = cards.slice(); }
    else if (buckets.trips)                { type = 'THREE_OF_A_KIND'; scored = groups[0]; }
    else if (buckets.pairs >= 2)           { type = 'TWO_PAIR';        scored = [...groups[0], ...groups[1]]; }
    else if (buckets.pairs === 1)          { type = 'PAIR';            scored = groups[0]; }
    else {
      // High card: only the highest single counts
      scored = [sortedByRank[sortedByRank.length - 1]];
    }
    return { type, scored, buckets };
  }
  function emptyBuckets() { return { pairs: 0, trips: 0, quads: 0, isFlush: false, isStraight: false }; }

  // ── Game state
  function freshState() {
    return {
      ante: 1, blindIndex: 0,                        // 0=small, 1=big, 2=boss
      jokers: [],
      maxJokers: 5,
      hand: [],
      deck: [],
      discardPile: [],
      selected: new Set(),
      handsLeft: 4,
      discardsLeft: 3,
      score: 0,
      handSize: 8,
      gameOver: false,
      won: false,
    };
  }
  function blindTarget(ante, idx) {
    const base = 300 * Math.pow(2, ante - 1);
    return Math.round(base * [1, 1.5, 2][idx]);
  }
  function blindLabel(idx) { return ['Small', 'Big', 'Boss'][idx] || '—'; }

  // ── DOM rendering
  let state = freshState();
  let mounted = false;
  let pane;

  function ensurePane() {
    if (mounted) return pane;
    mounted = true;
    pane = document.createElement('div');
    pane.className = 'tab-pane hidden';
    pane.id = 'tab-clown';
    pane.innerHTML = `
      <canvas class="clown-shader" id="clown-shader"></canvas>
      <div class="clown-ui">
        <div class="clown-hud">
          <div class="clown-hud-cell"><span>Ante</span><span class="v" id="clown-ante">1/8</span></div>
          <div class="clown-hud-cell"><span>Blind</span><span class="v" id="clown-blind">Small</span></div>
          <div class="clown-hud-cell target"><span>Score at least</span><span class="v" id="clown-target">300</span></div>
          <div class="clown-hud-cell score"><span>Round score</span><span class="v" id="clown-score">0</span></div>
          <button class="clown-hud-close" id="clown-close" title="Close (Esc)">Close</button>
        </div>
        <div class="clown-jokers" id="clown-jokers"></div>
        <div class="clown-field">
          <div class="clown-blind-banner">
            <span id="clown-blind-name">Small Blind</span>
            — target <span class="target" id="clown-target-banner">300</span>
          </div>
          <div class="clown-hand-summary" id="clown-hand-summary"></div>
          <div class="clown-hand" id="clown-hand"></div>
        </div>
        <div class="clown-controls">
          <button class="clown-btn play"    id="clown-play">Play Hand</button>
          <button class="clown-btn discard" id="clown-discard">Discard</button>
          <span class="clown-counter">Plays<span class="n" id="clown-plays">4</span></span>
          <span class="clown-counter">Discards<span class="n" id="clown-discards">3</span></span>
        </div>
        <div class="clown-shop-backdrop hidden" id="clown-shop-backdrop">
          <div class="clown-shop">
            <h2>BLIND DEFEATED</h2>
            <div class="subtitle" id="clown-choice-sub">Pick one reward.</div>
            <div class="clown-shop-items" id="clown-shop-items"></div>
            <div class="clown-shop-actions">
              <button class="clown-btn play" id="clown-shop-leave">Skip</button>
            </div>
          </div>
        </div>
        <div class="clown-gameover hidden" id="clown-gameover">
          <h1 id="clown-gameover-title">GAME OVER</h1>
          <div class="stat" id="clown-gameover-stat">You reached Ante 1.</div>
          <button class="clown-btn play" id="clown-gameover-restart">Play Again</button>
        </div>
      </div>
    `;
    const center = document.querySelector('main');
    if (center) center.appendChild(pane); else document.body.appendChild(pane);
    wireDom();
    initShader(pane.querySelector('#clown-shader'));
    return pane;
  }

  function wireDom() {
    pane.querySelector('#clown-close').onclick = closeTab;
    pane.querySelector('#clown-play').onclick = playHand;
    pane.querySelector('#clown-discard').onclick = discardSelected;
    pane.querySelector('#clown-shop-leave').onclick = exitChoice;
    pane.querySelector('#clown-gameover-restart').onclick = () => {
      state = freshState();
      startBlind();
      pane.querySelector('#clown-gameover').classList.add('hidden');
    };
  }

  // ── Tab integration
  function ensureTabButton() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs || tabs.querySelector('[data-tab="clown"]')) return;
    const btn = document.createElement('button');
    btn.className = 'center-tab';
    btn.dataset.tab = 'clown';
    btn.innerHTML = `<span>🃏 Clown</span> <span class="tab-close" id="clown-tab-close" title="Close">✕</span>`;
    tabs.appendChild(btn);
    btn.onclick = (e) => {
      if (e.target.id === 'clown-tab-close') { closeTab(); return; }
      showTab();
    };
  }

  function showTab() {
    ensurePane();
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    pane.classList.remove('hidden');
    document.querySelectorAll('.center-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'clown'));
    if (window.state) window.state.activeCenterTab = 'clown';
    if (!state.deck.length) startBlind();
    render();
  }

  function closeTab() {
    if (!pane) return;
    pane.classList.add('hidden');
    document.querySelectorAll('.center-tab[data-tab="clown"]').forEach(b => b.remove());
    try { if (typeof switchCenterTab === 'function') switchCenterTab('history'); } catch {}
  }

  // The host's switchCenterTab only hides tab-history / files / editor —
  // hook into clicks on those tabs so clicking History etc. also hides us.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.center-tab');
    if (!t) return;
    if (t.dataset.tab !== 'clown' && pane) pane.classList.add('hidden');
  }, true);

  // ── Game flow
  function startBlind() {
    state.deck = shuffle(buildDeck());
    state.discardPile = [];
    state.hand = [];
    state.selected.clear();
    state.handsLeft = 4 + (state._bonusHands || 0);
    state.discardsLeft = 3 + (state._bonusDiscards || 0);
    state.score = 0;
    draw(state.handSize);
    render();
  }

  function draw(n) {
    for (let i = 0; i < n; i++) {
      if (!state.deck.length) {
        if (!state.discardPile.length) break;
        state.deck = shuffle(state.discardPile); state.discardPile = [];
      }
      state.hand.push(state.deck.pop());
    }
  }

  function playHand() {
    if (state.gameOver) return;
    if (state.selected.size === 0 || state.selected.size > 5) return;
    const picked = [...state.selected].map(i => state.hand[i]);
    const ev = evaluate(picked);
    const hand = HAND_SCORES[ev.type];
    const ctx = { scored: ev.scored, handBuckets: ev.buckets, chips: hand.chips, mult: hand.mult };
    for (const c of ev.scored) ctx.chips += RANK_CHIPS[c.rank];
    for (const jid of state.jokers) {
      const j = JOKER_BY_ID[jid]; if (!j) continue;
      const r = j.effect(ctx); if (!r) continue;
      if (r.addChips) ctx.chips += r.addChips;
      if (r.addMult)  ctx.mult  += r.addMult;
      if (r.mulMult)  ctx.mult  *= r.mulMult;
    }
    const gained = Math.round(ctx.chips * ctx.mult);
    state.score += gained;

    // Remove played cards
    const idxs = [...state.selected].sort((a, b) => b - a);
    for (const i of idxs) { state.discardPile.push(state.hand[i]); state.hand.splice(i, 1); }
    state.selected.clear();
    state.handsLeft--;

    flashTotal(hand.label, ctx.chips, ctx.mult, gained);
    draw(state.handSize - state.hand.length);

    const target = blindTarget(state.ante, state.blindIndex);
    if (state.score >= target) {
      setTimeout(openChoice, 700);
    } else if (state.handsLeft === 0) {
      gameOver(false);
    }
    render();
  }

  function discardSelected() {
    if (state.gameOver) return;
    if (state.selected.size === 0) return;
    if (state.discardsLeft <= 0) return;
    const idxs = [...state.selected].sort((a, b) => b - a);
    for (const i of idxs) { state.discardPile.push(state.hand[i]); state.hand.splice(i, 1); }
    state.selected.clear();
    state.discardsLeft--;
    draw(state.handSize - state.hand.length);
    render();
  }

  function flashTotal(label, chips, mult, total) {
    const el = pane.querySelector('#clown-hand-summary');
    el.innerHTML = `
      <span class="pill">${label}</span>
      <span class="pill chips">${Math.round(chips)} chips</span>
      <span class="pill mult">× ${mult.toFixed(2)} mult</span>
      <span class="pill total">+ ${total}</span>
    `;
  }

  function gameOver(won) {
    state.gameOver = true; state.won = won;
    pane.querySelector('#clown-gameover-title').textContent = won ? 'YOU WIN' : 'GAME OVER';
    pane.querySelector('#clown-gameover-stat').textContent =
      won ? `You finished Ante ${state.ante}.`
          : `You reached Ante ${state.ante} (${blindLabel(state.blindIndex)} Blind).`;
    pane.querySelector('#clown-gameover').classList.remove('hidden');
  }

  // ── End-of-blind choice: pick one reward (or skip).
  //  Three jokers are offered (drawn from the unowned pool). On top of those
  //  we sometimes inject a non-joker boon — extra hand/discard/draw size —
  //  so the run gains permanent stat improvements too.
  const BOONS = [
    { id: 'boon-hand',    face: '🂠', name: '+1 Hand',     desc: 'One extra Play per blind, forever.',
      apply: () => { state._bonusHands = (state._bonusHands || 0) + 1; } },
    { id: 'boon-discard', face: '♻', name: '+1 Discard',  desc: 'One extra Discard per blind, forever.',
      apply: () => { state._bonusDiscards = (state._bonusDiscards || 0) + 1; } },
    { id: 'boon-draw',    face: '✋', name: '+1 Hand Size', desc: 'Draw one more card to your hand.',
      apply: () => { state.handSize += 1; } },
  ];

  let choiceState = null;
  function openChoice() {
    const owned = new Set(state.jokers);
    const jokerPool = JOKERS.filter(j => !owned.has(j.id));
    shuffle(jokerPool);
    const offers = jokerPool.slice(0, 3).map(j => ({ kind: 'joker', joker: j }));
    // ~1 in 3 chance one offer is replaced by a permanent boon.
    if (Math.random() < 0.34 && offers.length) {
      const boon = BOONS[Math.floor(Math.random() * BOONS.length)];
      offers[Math.floor(Math.random() * offers.length)] = { kind: 'boon', boon };
    }
    choiceState = { offers, taken: false };
    pane.querySelector('#clown-shop-backdrop').classList.remove('hidden');
    renderChoice();
  }
  function renderChoice() {
    const host = pane.querySelector('#clown-shop-items');
    host.innerHTML = choiceState.offers.map((o, i) => {
      const j = o.kind === 'joker' ? o.joker : o.boon;
      return `<div class="clown-shop-item" data-i="${i}">${renderJokerTile(j)}</div>`;
    }).join('');
    host.querySelectorAll('.clown-shop-item').forEach(el => {
      el.onclick = () => takeOffer(parseInt(el.dataset.i, 10));
    });
    const sub = pane.querySelector('#clown-choice-sub');
    if (state.jokers.length >= state.maxJokers) {
      sub.textContent = 'Joker slots full — take a Boon or Skip.';
    } else {
      sub.textContent = 'Pick one reward, then Continue.';
    }
    pane.querySelector('#clown-shop-leave').textContent = choiceState.taken ? 'Continue' : 'Skip';
  }
  function takeOffer(i) {
    if (choiceState.taken) return;
    const o = choiceState.offers[i];
    if (o.kind === 'joker') {
      if (state.jokers.length >= state.maxJokers) return;
      state.jokers.push(o.joker.id);
    } else {
      o.boon.apply();
    }
    choiceState.taken = true;
    renderChoice();
    render();
  }
  function exitChoice() {
    pane.querySelector('#clown-shop-backdrop').classList.add('hidden');
    state.blindIndex++;
    if (state.blindIndex > 2) { state.blindIndex = 0; state.ante++; }
    if (state.ante > 8) { gameOver(true); return; }
    startBlind();
  }

  // ── Render
  function render() {
    if (!mounted) return;
    pane.querySelector('#clown-ante').textContent  = `${state.ante}/8`;
    pane.querySelector('#clown-blind').textContent = blindLabel(state.blindIndex);
    pane.querySelector('#clown-target').textContent = blindTarget(state.ante, state.blindIndex);
    pane.querySelector('#clown-target-banner').textContent = blindTarget(state.ante, state.blindIndex);
    pane.querySelector('#clown-blind-name').textContent = blindLabel(state.blindIndex) + ' Blind';
    pane.querySelector('#clown-score').textContent = state.score;
    pane.querySelector('#clown-plays').textContent = state.handsLeft;
    pane.querySelector('#clown-discards').textContent = state.discardsLeft;
    renderJokers();
    renderHand();
    pane.querySelector('#clown-play').disabled = state.selected.size === 0 || state.selected.size > 5;
    pane.querySelector('#clown-discard').disabled = state.selected.size === 0 || state.discardsLeft <= 0;
  }

  function renderJokers() {
    const host = pane.querySelector('#clown-jokers');
    const slots = state.maxJokers;
    let html = '';
    for (let i = 0; i < slots; i++) {
      const jid = state.jokers[i];
      if (jid) {
        const j = JOKER_BY_ID[jid];
        html += `<div class="clown-joker" data-jid="${jid}">${jokerInner(j)}<div class="tip"><strong>${j.name}</strong><br/>${j.desc}</div></div>`;
      } else {
        html += `<div class="clown-joker" data-empty></div>`;
      }
    }
    host.innerHTML = html;
    // Right-click a joker to discard it (no refund — there's no economy).
    host.querySelectorAll('.clown-joker[data-jid]').forEach(el => {
      el.oncontextmenu = (e) => {
        e.preventDefault();
        const idx = state.jokers.indexOf(el.dataset.jid);
        if (idx === -1) return;
        state.jokers.splice(idx, 1);
        render();
      };
    });
  }
  function jokerInner(j) {
    return `<div class="face">${j.face}</div><div class="name">${j.name}</div>`;
  }
  function renderJokerTile(j) {
    return `<div class="clown-joker">${jokerInner(j)}<div class="tip"><strong>${j.name}</strong><br/>${j.desc}</div></div>`;
  }

  function renderHand() {
    const host = pane.querySelector('#clown-hand');
    host.innerHTML = state.hand.map((c, i) => `
      <div class="clown-card suit-${c.suit} ${state.selected.has(i) ? 'selected' : ''}" data-i="${i}">
        <div class="rank-top">${RANK_LABEL[c.rank] || c.rank}${SUIT_GLYPH[c.suit]}</div>
        <div class="pip">${SUIT_GLYPH[c.suit]}</div>
        <div class="rank-bot">${RANK_LABEL[c.rank] || c.rank}${SUIT_GLYPH[c.suit]}</div>
      </div>
    `).join('');
    host.querySelectorAll('.clown-card').forEach(el => {
      el.onclick = () => {
        const i = parseInt(el.dataset.i, 10);
        if (state.selected.has(i)) state.selected.delete(i);
        else if (state.selected.size < 5) state.selected.add(i);
        render();
      };
    });
  }

  // ─────────────────────── Shader ───────────────────────
  // Original animated psychedelic field. Uses sin/cos of polar-warped
  // coordinates plus a slow palette rotation. Pure procedural — no
  // external code or assets.
  const FRAG = `
    precision mediump float;
    uniform vec2  uRes;
    uniform float uT;
    void main() {
      vec2 uv = (gl_FragCoord.xy / uRes.xy) * 2.0 - 1.0;
      uv.x *= uRes.x / uRes.y;
      float r = length(uv);
      float a = atan(uv.y, uv.x);
      float t = uT * 0.18;
      float w = sin(8.0 * r - t * 3.0 + sin(a * 3.0 + t));
      w += 0.6 * sin(a * 5.0 + t * 2.0 + r * 4.0);
      w += 0.4 * sin((uv.x + uv.y) * 6.0 + t * 1.7);
      float h = 0.5 + 0.5 * sin(t * 0.7);
      vec3 c1 = vec3(0.20 + 0.40 * sin(t + 0.0),
                     0.10 + 0.20 * sin(t + 2.0),
                     0.30 + 0.40 * sin(t + 4.0));
      vec3 c2 = vec3(0.80, 0.30 + 0.30 * sin(t * 0.5), 0.60);
      vec3 col = mix(c1, c2, 0.5 + 0.5 * w);
      col *= 1.0 - 0.45 * smoothstep(0.6, 1.3, r);
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  function initShader(canvas) {
    const gl = canvas.getContext('webgl');
    if (!gl) { canvas.style.background = 'radial-gradient(#3a1a55, #0a0612)'; return; }
    const compile = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uT   = gl.getUniformLocation(prog, 'uT');

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = canvas.clientWidth * dpr | 0;
      const h = canvas.clientHeight * dpr | 0;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };
    const t0 = performance.now();
    const tick = () => {
      if (!pane.classList.contains('hidden')) {
        resize();
        gl.uniform1f(uT, (performance.now() - t0) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ─────────────────────── Ctrl+CLOWN key trigger ───────────────────────
  const TARGET = 'CLOWN';
  let buf = '';
  let bufTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (!e.ctrlKey) { buf = ''; return; }
    const k = (e.key || '').toUpperCase();
    if (k.length !== 1 || !/[A-Z]/.test(k)) return;
    buf += k;
    if (buf.length > TARGET.length) buf = buf.slice(-TARGET.length);
    if (bufTimer) clearTimeout(bufTimer);
    bufTimer = setTimeout(() => { buf = ''; }, 2500);
    if (buf === TARGET) {
      buf = '';
      e.preventDefault();
      ensureTabButton();
      showTab();
    }
  });
  // Escape closes the game tab.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane && !pane.classList.contains('hidden')) closeTab();
  });
})();
