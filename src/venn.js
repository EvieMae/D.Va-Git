// ═══════════════════════════════════════════════════════════════════════
//  VENN — hidden shape-sorting minigame.
//  Triggered by holding Ctrl and typing V-E-N-N.
//
//  Three overlapping circles. Each is defined by a property
//  (e.g. "Red", "Filled", "≥ 5 sides"). The player drags shapes from a
//  tray into the correct region. Every region shows an exact required
//  count — you must satisfy both the property logic AND the count.
// ═══════════════════════════════════════════════════════════════════════

(() => {
  // ───────── Properties ─────────
  const COLORS = [
    { id: 'red',    css: '#ef4d6a' },
    { id: 'blue',   css: '#4d8def' },
    { id: 'yellow', css: '#f5c84b' },
    { id: 'green',  css: '#56c46a' },
  ];
  const SIDES = [3, 4, 5, 6];

  // Criteria pool — each returns true/false on a shape and has a label.
  const CRITERIA = [
    ...COLORS.map(c => ({
      id: 'color-' + c.id,
      label: cap(c.id),
      test: (s) => s.color === c.id,
    })),
    { id: 'filled',  label: 'Filled',          test: (s) => s.filled },
    { id: 'hollow',  label: 'Hollow',          test: (s) => !s.filled },
    { id: 'tri',     label: 'Triangle',        test: (s) => s.sides === 3 },
    { id: 'sq',      label: 'Square',          test: (s) => s.sides === 4 },
    { id: 'ge5',     label: '5+ sides',        test: (s) => s.sides >= 5 },
    { id: 'le4',     label: '4 or fewer sides',test: (s) => s.sides <= 4 },
    { id: 'odd',     label: 'Odd sides',       test: (s) => s.sides % 2 === 1 },
    { id: 'even',    label: 'Even sides',      test: (s) => s.sides % 2 === 0 },
  ];
  function cap(s) { return s[0].toUpperCase() + s.slice(1); }

  // Region keys for a 3-circle Venn: 8 regions including outside.
  // Bitmask order: bit0 = A, bit1 = B, bit2 = C. 0 = outside.
  const REGIONS = [0, 1, 2, 3, 4, 5, 6, 7];
  function regionFor(shape, crits) {
    let mask = 0;
    if (crits[0].test(shape)) mask |= 1;
    if (crits[1].test(shape)) mask |= 2;
    if (crits[2].test(shape)) mask |= 4;
    return mask;
  }

  // ───────── Game state ─────────
  let state = freshState();
  let mounted = false;
  let pane;

  function freshState() {
    return {
      crits: null,        // [crit, crit, crit]
      shapes: [],         // all shapes for the round
      targets: {},        // region mask -> required count
      placement: {},      // shape.id -> region mask | null (null = tray)
      selectedId: null,
      checked: false,
      won: false,
    };
  }

  // Pick three criteria that are non-redundant (don't share id, and at least
  // one shape ends up in every "all three" overlap-ish region naturally is
  // not required — we just need a non-degenerate setup).
  function pickCriteria() {
    const pool = CRITERIA.slice();
    shuffle(pool);
    // Avoid obviously contradictory triples like "Filled" + "Hollow".
    const conflict = (a, b) => {
      const pairs = [['filled','hollow'], ['odd','even'], ['ge5','le4']];
      return pairs.some(([x, y]) => (a.id === x && b.id === y) || (a.id === y && b.id === x));
    };
    const picked = [];
    for (const c of pool) {
      if (picked.some(p => conflict(p, c))) continue;
      if (picked.some(p => p.id === c.id)) continue;
      // Avoid two color-based criteria (too constraining)
      if (c.id.startsWith('color-') && picked.some(p => p.id.startsWith('color-'))) continue;
      picked.push(c);
      if (picked.length === 3) break;
    }
    return picked;
  }

  function newRound() {
    state = freshState();
    state.crits = pickCriteria();
    // Generate ~12 random shapes
    const n = 12;
    for (let i = 0; i < n; i++) {
      state.shapes.push({
        id: 's' + i,
        sides: SIDES[Math.floor(Math.random() * SIDES.length)],
        color: COLORS[Math.floor(Math.random() * COLORS.length)].id,
        filled: Math.random() < 0.55,
      });
    }
    // Compute targets from ground truth
    const counts = Object.fromEntries(REGIONS.map(r => [r, 0]));
    for (const s of state.shapes) counts[regionFor(s, state.crits)]++;
    state.targets = counts;
    // Everyone starts in the tray
    for (const s of state.shapes) state.placement[s.id] = null;
    render();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ───────── DOM ─────────
  function ensurePane() {
    if (mounted) return pane;
    mounted = true;
    injectStyles();
    pane = document.createElement('div');
    pane.className = 'tab-pane hidden';
    pane.id = 'tab-venn';
    pane.innerHTML = `
      <div class="venn-ui">
        <div class="venn-hud">
          <div class="venn-title">VENN — sort the shapes</div>
          <div class="venn-help">Click a shape, then click a region. Each region needs an <em>exact</em> count.</div>
          <div class="venn-actions">
            <button class="venn-btn" id="venn-check">Check</button>
            <button class="venn-btn" id="venn-reset">Reset</button>
            <button class="venn-btn" id="venn-new">New Puzzle</button>
            <button class="venn-btn close" id="venn-close" title="Close (Esc)">Close</button>
          </div>
        </div>
        <div class="venn-board">
          <svg class="venn-svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
            <defs>
              <clipPath id="venn-clip-a"><circle cx="300" cy="250" r="180"/></clipPath>
              <clipPath id="venn-clip-b"><circle cx="500" cy="250" r="180"/></clipPath>
              <clipPath id="venn-clip-c"><circle cx="400" cy="420" r="180"/></clipPath>
            </defs>
            <circle class="venn-c venn-a" cx="300" cy="250" r="180"/>
            <circle class="venn-c venn-b" cx="500" cy="250" r="180"/>
            <circle class="venn-c venn-c-c" cx="400" cy="420" r="180"/>
            <text class="venn-label" id="venn-lab-a" x="160" y="155">A</text>
            <text class="venn-label" id="venn-lab-b" x="640" y="155">B</text>
            <text class="venn-label" id="venn-lab-c" x="400" y="620">C</text>
          </svg>
          <!-- Region hit-targets are absolutely positioned divs so we get
               easy drop zones and per-region badges. -->
          <div class="venn-regions" id="venn-regions"></div>
        </div>
        <div class="venn-tray-wrap">
          <div class="venn-tray-title">Tray</div>
          <div class="venn-tray" id="venn-tray"></div>
        </div>
        <div class="venn-toast hidden" id="venn-toast"></div>
      </div>
    `;
    const center = document.querySelector('main');
    if (center) center.appendChild(pane); else document.body.appendChild(pane);

    pane.querySelector('#venn-close').onclick = closeTab;
    pane.querySelector('#venn-check').onclick = checkSolution;
    pane.querySelector('#venn-reset').onclick = () => {
      for (const s of state.shapes) state.placement[s.id] = null;
      state.checked = false; state.selectedId = null;
      render();
    };
    pane.querySelector('#venn-new').onclick = newRound;
    buildRegions();
    return pane;
  }

  // Region centroids (approx) for a standard 3-circle Venn with the circles
  // at (300,250), (500,250), (400,420), r=180.
  const REGION_DEFS = [
    { mask: 1, label: 'A only',     x: 195, y: 235 },
    { mask: 2, label: 'B only',     x: 605, y: 235 },
    { mask: 4, label: 'C only',     x: 400, y: 510 },
    { mask: 3, label: 'A ∩ B',      x: 400, y: 200 },
    { mask: 5, label: 'A ∩ C',      x: 300, y: 390 },
    { mask: 6, label: 'B ∩ C',      x: 500, y: 390 },
    { mask: 7, label: 'A ∩ B ∩ C',  x: 400, y: 320 },
    { mask: 0, label: 'Outside',    x: 720, y: 530 },
  ];

  function buildRegions() {
    const host = pane.querySelector('#venn-regions');
    host.innerHTML = REGION_DEFS.map(r => `
      <div class="venn-region" data-mask="${r.mask}" style="left:${r.x}px;top:${r.y}px">
        <div class="venn-region-name">${r.label}</div>
        <div class="venn-region-count"><span class="have">0</span> / <span class="need">0</span></div>
        <div class="venn-region-cards" id="venn-region-cards-${r.mask}"></div>
      </div>
    `).join('');
    host.querySelectorAll('.venn-region').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('.venn-card')) return; // card handled below
        const mask = parseInt(el.dataset.mask, 10);
        if (state.selectedId != null) {
          state.placement[state.selectedId] = mask;
          state.selectedId = null;
          state.checked = false;
          render();
        }
      };
    });
  }

  function shapeSvg(shape, size = 38) {
    const cx = size / 2, cy = size / 2, r = size * 0.42;
    const pts = [];
    // Point one vertex up
    const off = -Math.PI / 2;
    for (let i = 0; i < shape.sides; i++) {
      const a = off + (i * 2 * Math.PI) / shape.sides;
      pts.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1));
    }
    const color = COLORS.find(c => c.id === shape.color).css;
    const fill = shape.filled ? color : 'transparent';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <polygon points="${pts.join(' ')}" fill="${fill}" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    </svg>`;
  }

  function cardHtml(shape) {
    const sel = state.selectedId === shape.id ? 'selected' : '';
    return `<div class="venn-card ${sel}" data-id="${shape.id}">${shapeSvg(shape)}</div>`;
  }

  function render() {
    if (!mounted) return;
    // Labels
    pane.querySelector('#venn-lab-a').textContent = state.crits[0].label;
    pane.querySelector('#venn-lab-b').textContent = state.crits[1].label;
    pane.querySelector('#venn-lab-c').textContent = state.crits[2].label;

    // Region counts
    const have = Object.fromEntries(REGIONS.map(r => [r, 0]));
    for (const s of state.shapes) {
      const p = state.placement[s.id];
      if (p != null) have[p]++;
    }
    for (const r of REGION_DEFS) {
      const el = pane.querySelector(`.venn-region[data-mask="${r.mask}"]`);
      el.querySelector('.have').textContent = have[r.mask];
      el.querySelector('.need').textContent = state.targets[r.mask];
      el.classList.toggle('match', have[r.mask] === state.targets[r.mask]);
      // Cards in this region
      const cardsHost = el.querySelector('.venn-region-cards');
      cardsHost.innerHTML = state.shapes
        .filter(s => state.placement[s.id] === r.mask)
        .map(cardHtml).join('');
    }

    // Tray
    const tray = pane.querySelector('#venn-tray');
    tray.innerHTML = state.shapes
      .filter(s => state.placement[s.id] == null)
      .map(cardHtml).join('');

    // Wire card clicks
    pane.querySelectorAll('.venn-card').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (state.placement[id] != null) {
          // Click placed card -> return to tray
          state.placement[id] = null;
          state.selectedId = null;
        } else {
          state.selectedId = state.selectedId === id ? null : id;
        }
        state.checked = false;
        render();
      };
    });
  }

  function checkSolution() {
    state.checked = true;
    // Each placed shape must match its region; counts must match exactly.
    const errors = [];
    const have = Object.fromEntries(REGIONS.map(r => [r, 0]));
    for (const s of state.shapes) {
      const p = state.placement[s.id];
      if (p == null) { errors.push('Some shapes are still in the tray.'); break; }
      have[p]++;
      if (regionFor(s, state.crits) !== p) {
        errors.push('A shape is in the wrong region.');
      }
    }
    if (!errors.length) {
      for (const r of REGIONS) {
        if (have[r] !== state.targets[r]) { errors.push('Region counts don\'t match.'); break; }
      }
    }
    if (errors.length) {
      toast(errors[0], false);
    } else {
      state.won = true;
      toast('Solved!  ✓', true);
    }
  }

  let toastTimer = null;
  function toast(msg, ok) {
    const el = pane.querySelector('#venn-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('bad', !ok);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ───────── Tab integration ─────────
  function ensureTabButton() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs || tabs.querySelector('[data-tab="venn"]')) return;
    const btn = document.createElement('button');
    btn.className = 'center-tab';
    btn.dataset.tab = 'venn';
    btn.innerHTML = `<span>⚭ Venn</span> <span class="tab-close" id="venn-tab-close" title="Close">✕</span>`;
    tabs.appendChild(btn);
    btn.onclick = (e) => {
      if (e.target.id === 'venn-tab-close') { closeTab(); return; }
      showTab();
    };
  }

  function showTab() {
    ensurePane();
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    pane.classList.remove('hidden');
    document.querySelectorAll('.center-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'venn'));
    if (window.state) window.state.activeCenterTab = 'venn';
    if (!state.crits) newRound();
    render();
  }

  function closeTab() {
    if (!pane) return;
    pane.classList.add('hidden');
    document.querySelectorAll('.center-tab[data-tab="venn"]').forEach(b => b.remove());
    try { if (typeof switchCenterTab === 'function') switchCenterTab('history'); } catch {}
  }

  // Hide if user switches to another center tab (mirrors clown.js).
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.center-tab');
    if (!t) return;
    if (t.dataset.tab !== 'venn' && pane) pane.classList.add('hidden');
  }, true);

  // ───────── Ctrl+VENN trigger ─────────
  const TARGET = 'VENN';
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane && !pane.classList.contains('hidden')) closeTab();
  });

  // ───────── Styles (kept inline so this file is self-contained) ─────────
  function injectStyles() {
    if (document.getElementById('venn-styles')) return;
    const css = `
      #tab-venn { position: relative; height: 100%; overflow: hidden; background:
        radial-gradient(ellipse at top, #1b1530 0%, #0b0814 70%); color: #e9e6f5; }
      .venn-ui { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 10px; }
      .venn-hud { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .venn-title { font-size: 18px; font-weight: 700; letter-spacing: 1.2px; color: #f0d8ff; }
      .venn-help { font-size: 12px; color: #b9b3d0; }
      .venn-help em { color: #f6c84b; font-style: normal; }
      .venn-actions { margin-left: auto; display: flex; gap: 8px; }
      .venn-btn { background: #2a1f44; color: #ece6ff; border: 1px solid #463972;
        padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      .venn-btn:hover { background: #382a5a; }
      .venn-btn.close { background: #5a1a2a; border-color: #883048; }

      .venn-board { position: relative; flex: 1; min-height: 360px;
        background: rgba(255,255,255,0.02); border-radius: 10px;
        border: 1px solid #2a2244; overflow: hidden; }
      .venn-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .venn-c { fill-opacity: 0.18; stroke-width: 2.5; }
      .venn-a   { fill: #ef4d6a; stroke: #ef4d6a; }
      .venn-b   { fill: #4d8def; stroke: #4d8def; }
      .venn-c-c { fill: #56c46a; stroke: #56c46a; }
      .venn-label { fill: #f0e9ff; font-size: 20px; font-weight: 700;
        text-anchor: middle; dominant-baseline: middle;
        paint-order: stroke; stroke: #0a0814; stroke-width: 4px; }

      .venn-regions { position: absolute; inset: 0; pointer-events: none; }
      .venn-region { position: absolute; transform: translate(-50%, -50%);
        pointer-events: auto; min-width: 70px; padding: 4px 6px;
        background: rgba(10,8,20,0.55); border: 1px dashed #5b4a8a;
        border-radius: 8px; text-align: center; cursor: pointer;
        backdrop-filter: blur(2px); transition: background 0.15s, border-color 0.15s; }
      .venn-region:hover { background: rgba(40,30,70,0.75); border-color: #8c75c8; }
      .venn-region.match { border-color: #56c46a; border-style: solid; box-shadow: 0 0 0 1px #56c46a55; }
      .venn-region-name { font-size: 11px; color: #c9c2e2; }
      .venn-region-count { font-size: 14px; font-weight: 700; color: #f6c84b; }
      .venn-region-count .have { color: #fff; }
      .venn-region-cards { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center;
        margin-top: 2px; max-width: 140px; }

      .venn-tray-wrap { background: rgba(255,255,255,0.03);
        border: 1px solid #2a2244; border-radius: 10px; padding: 8px 10px; }
      .venn-tray-title { font-size: 11px; color: #9a92b8; letter-spacing: 1px; margin-bottom: 4px; }
      .venn-tray { display: flex; flex-wrap: wrap; gap: 6px; min-height: 50px; }

      .venn-card { display: inline-flex; align-items: center; justify-content: center;
        width: 44px; height: 44px; padding: 2px;
        background: #15102a; border: 1px solid #322558; border-radius: 6px;
        cursor: pointer; transition: transform 0.1s, border-color 0.1s; }
      .venn-card:hover { transform: translateY(-1px); border-color: #6a55a8; }
      .venn-card.selected { border-color: #f6c84b; box-shadow: 0 0 0 2px #f6c84b88; }
      .venn-region-cards .venn-card { width: 28px; height: 28px; padding: 1px; }

      .venn-toast { position: absolute; left: 50%; bottom: 28px;
        transform: translateX(-50%); padding: 10px 18px; border-radius: 8px;
        font-weight: 700; letter-spacing: 1px; }
      .venn-toast.ok  { background: #1f5430; color: #c8f5cd; border: 1px solid #56c46a; }
      .venn-toast.bad { background: #5a1a2a; color: #f8c8d0; border: 1px solid #ef4d6a; }
      .venn-toast.hidden { display: none; }
    `;
    const tag = document.createElement('style');
    tag.id = 'venn-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
