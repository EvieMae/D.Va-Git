// Per-repo scratchpad notes panel (Ctrl+Shift+M)
(function () {
  let panel = null;
  let textarea = null;
  let saveTimer = null;
  let lastRepoPath = null;
  let loading = false;

  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'scratchpad-panel';
    panel.setAttribute('style', [
      'position: fixed',
      'right: 16px',
      'bottom: 16px',
      'width: 360px',
      'height: 300px',
      'background: var(--bg-elev)',
      'color: var(--text)',
      'border: 1px solid var(--line)',
      'border-radius: 8px',
      'box-shadow: 0 6px 24px rgba(0,0,0,0.35)',
      'z-index: 99999',
      'display: none',
      'flex-direction: column',
      'overflow: hidden',
      'font-family: inherit',
    ].join('; '));

    const header = document.createElement('div');
    header.setAttribute('style', [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'padding: 6px 10px',
      'border-bottom: 1px solid var(--line)',
      'background: var(--bg-elev)',
      'font-size: 12px',
      'font-weight: 600',
      'user-select: none',
    ].join('; '));

    const title = document.createElement('span');
    title.textContent = 'Scratchpad';
    header.appendChild(title);

    const status = document.createElement('span');
    status.id = 'scratchpad-status';
    status.setAttribute('style', 'font-size: 11px; opacity: 0.6; font-weight: 400;');
    status.textContent = '';
    header.appendChild(status);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'x';
    closeBtn.setAttribute('style', [
      'background: transparent',
      'color: var(--text)',
      'border: 1px solid var(--line)',
      'border-radius: 4px',
      'cursor: pointer',
      'padding: 0 6px',
      'margin-left: 8px',
      'font-size: 11px',
    ].join('; '));
    closeBtn.title = 'Close (Ctrl+Shift+M)';
    closeBtn.onclick = () => togglePanel(false);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    textarea = document.createElement('textarea');
    textarea.id = 'scratchpad-textarea';
    textarea.placeholder = 'Notes for this repository...';
    textarea.setAttribute('style', [
      'flex: 1 1 auto',
      'width: 100%',
      'box-sizing: border-box',
      'resize: none',
      'border: 0',
      'outline: none',
      'padding: 10px',
      'background: var(--bg-elev)',
      'color: var(--text)',
      'font-family: ui-monospace, Menlo, Consolas, monospace',
      'font-size: 12px',
      'line-height: 1.4',
    ].join('; '));
    textarea.addEventListener('input', onInput);
    panel.appendChild(textarea);

    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(t) {
    const s = document.getElementById('scratchpad-status');
    if (s) s.textContent = t || '';
  }

  function onInput() {
    if (loading) return;
    setStatus('Saving...');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    saveTimer = null;
    if (!textarea) return;
    const text = textarea.value;
    try {
      if (window.api && window.api.scratchpadWrite) {
        const r = await window.api.scratchpadWrite({ text });
        if (r && r.ok) setStatus('Saved');
        else setStatus(r && r.error ? 'Error' : 'No repo');
      }
    } catch { setStatus('Error'); }
    setTimeout(() => setStatus(''), 1200);
  }

  async function loadForCurrentRepo() {
    if (!textarea) return;
    loading = true;
    try {
      if (window.api && window.api.scratchpadRead) {
        const r = await window.api.scratchpadRead();
        textarea.value = (r && r.ok && r.data) || '';
      } else {
        textarea.value = '';
      }
    } catch { textarea.value = ''; }
    loading = false;
    lastRepoPath = (typeof state !== 'undefined' && state.repo && state.repo.path) || null;
  }

  function togglePanel(force) {
    buildPanel();
    const shouldShow = (typeof force === 'boolean') ? force : (panel.style.display === 'none');
    if (shouldShow) {
      panel.style.display = 'flex';
      loadForCurrentRepo().then(() => { try { textarea.focus(); } catch {} });
    } else {
      // Flush pending save before hiding
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); }
      panel.style.display = 'none';
    }
  }

  // Detect repo switches while panel is open
  function watchRepoChange() {
    setInterval(() => {
      if (!panel || panel.style.display === 'none') return;
      const cur = (typeof state !== 'undefined' && state.repo && state.repo.path) || null;
      if (cur !== lastRepoPath) {
        // Flush any pending save for previous repo BEFORE switching context.
        // (write IPC will use main's currentRepoPath which has already changed,
        //  so we just discard timer to avoid cross-repo write.)
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        loadForCurrentRepo();
      }
    }, 600);
  }

  // Keybinding
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      togglePanel();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchRepoChange);
  } else {
    watchRepoChange();
  }
})();
