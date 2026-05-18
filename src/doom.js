// ═══════════════════════════════════════════════════════════════════════
//  DOOM — hidden tab embedding the freeware shareware DOOM episode
//  (id Software, 1993) via the Internet Archive's JS-DOS emulator.
//  Triggered by holding Ctrl and typing D-O-O-M.
// ═══════════════════════════════════════════════════════════════════════

(() => {
  // Internet Archive's embed page for the freely-distributable
  // shareware episode of DOOM. It loads em-dosbox in the iframe.
  const DOOM_EMBED = 'https://archive.org/embed/DoomsharewareEpisode';

  let mounted = false;
  let pane;

  function ensurePane() {
    if (mounted) return pane;
    mounted = true;
    injectStyles();
    pane = document.createElement('div');
    pane.className = 'tab-pane hidden';
    pane.id = 'tab-doom';
    pane.innerHTML = `
      <div class="doom-ui">
        <div class="doom-hud">
          <div class="doom-title">DOOM — shareware (id Software, 1993)</div>
          <div class="doom-help">Click the game frame to capture input. <em>Arrows</em> move, <em>Ctrl</em> fires, <em>Space</em> opens doors, <em>Alt</em> strafes.</div>
          <div class="doom-actions">
            <button class="doom-btn" id="doom-reload">Reload</button>
            <button class="doom-btn close" id="doom-close" title="Close (Esc)">Close</button>
          </div>
        </div>
        <div class="doom-frame-wrap">
          <iframe class="doom-frame" id="doom-frame"
            src="${DOOM_EMBED}"
            allow="autoplay; fullscreen; gamepad"
            allowfullscreen
            referrerpolicy="no-referrer"></iframe>
        </div>
      </div>
    `;
    const center = document.querySelector('main');
    if (center) center.appendChild(pane); else document.body.appendChild(pane);

    pane.querySelector('#doom-close').onclick = closeTab;
    pane.querySelector('#doom-reload').onclick = () => {
      const f = pane.querySelector('#doom-frame');
      f.src = 'about:blank';
      setTimeout(() => { f.src = DOOM_EMBED; }, 50);
    };
    return pane;
  }

  function ensureTabButton() {
    const tabs = document.getElementById('center-tabs');
    if (!tabs || tabs.querySelector('[data-tab="doom"]')) return;
    const btn = document.createElement('button');
    btn.className = 'center-tab';
    btn.dataset.tab = 'doom';
    btn.innerHTML = `<span>🔫 DOOM</span> <span class="tab-close" id="doom-tab-close" title="Close">✕</span>`;
    tabs.appendChild(btn);
    btn.onclick = (e) => {
      if (e.target.id === 'doom-tab-close') { closeTab(); return; }
      showTab();
    };
  }

  function showTab() {
    ensurePane();
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    pane.classList.remove('hidden');
    document.querySelectorAll('.center-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'doom'));
    if (window.state) window.state.activeCenterTab = 'doom';
  }

  function closeTab() {
    if (!pane) return;
    pane.classList.add('hidden');
    // Stop the emulator from chewing CPU when the tab is closed.
    const f = pane.querySelector('#doom-frame');
    if (f) f.src = 'about:blank';
    document.querySelectorAll('.center-tab[data-tab="doom"]').forEach(b => b.remove());
    try { if (typeof switchCenterTab === 'function') switchCenterTab('history'); } catch {}
  }

  // Reload the iframe next time the tab is shown after a close.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.center-tab');
    if (!t) return;
    if (t.dataset.tab !== 'doom' && pane) pane.classList.add('hidden');
  }, true);

  // ───────── Ctrl+DOOM trigger ─────────
  const TARGET = 'DOOM';
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
      // If the iframe was unloaded by close, restore it.
      if (pane) {
        const f = pane.querySelector('#doom-frame');
        if (f && (!f.src || f.src === 'about:blank')) f.src = DOOM_EMBED;
      }
      showTab();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane && !pane.classList.contains('hidden')) closeTab();
  });

  function injectStyles() {
    if (document.getElementById('doom-styles')) return;
    const css = `
      #tab-doom { position: relative; height: 100%; overflow: hidden;
        background: #0b0b0e; color: #e9e6f5; }
      .doom-ui { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 10px; }
      .doom-hud { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .doom-title { font-size: 18px; font-weight: 700; letter-spacing: 1.5px;
        color: #ff5a3c; text-shadow: 0 0 6px #ff5a3c55; font-family: 'Courier New', monospace; }
      .doom-help { font-size: 12px; color: #b9b3b0; }
      .doom-help em { color: #f6c84b; font-style: normal; }
      .doom-actions { margin-left: auto; display: flex; gap: 8px; }
      .doom-btn { background: #2a1a14; color: #ece6ff; border: 1px solid #6b2e1a;
        padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      .doom-btn:hover { background: #44261a; }
      .doom-btn.close { background: #5a1a2a; border-color: #883048; }

      .doom-frame-wrap { flex: 1; min-height: 360px; background: #000;
        border: 1px solid #2a1a14; border-radius: 8px; overflow: hidden;
        display: flex; align-items: stretch; justify-content: stretch; }
      .doom-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #000; }
    `;
    const tag = document.createElement('style');
    tag.id = 'doom-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
