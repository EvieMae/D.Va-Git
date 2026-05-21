// ═══════════════════════════════════════════════════════════════════════════
//  LFS management panel (Ctrl+Shift+L)
//  Shows tracked patterns from .gitattributes, populated LFS files, and
//  exposes pull / fsck / track buttons.
// ═══════════════════════════════════════════════════════════════════════════

async function openLfsModal() {
  if (!state.currentRepoPath) {
    toast('Open a repository first', 'warn');
    return;
  }

  let patterns = [];
  try {
    const r = await window.api.lfsPatterns();
    if (r && r.ok) patterns = r.data || [];
  } catch {}

  const files = state.lfsFiles instanceof Set
    ? Array.from(state.lfsFiles)
    : Array.isArray(state.lfsFiles) ? state.lfsFiles : [];

  const patHtml = patterns.length
    ? patterns.map(p => `<div style="padding:4px 8px;font-family:monospace;background:var(--panel,#1a1224);border:1px solid var(--border,#2d2540);border-radius:4px;margin-bottom:4px;">${escapeHtml(p.pattern)}</div>`).join('')
    : `<div style="opacity:.6;font-style:italic;padding:4px 8px;">No filter=lfs entries in .gitattributes.</div>`;

  const fileHtml = files.length
    ? `<div style="max-height:180px;overflow:auto;border:1px solid var(--border,#2d2540);border-radius:4px;padding:6px 8px;font-family:monospace;font-size:12px;">`
      + files.map(f => `<div>${escapeHtml(f)}</div>`).join('')
      + `</div>`
    : `<div style="opacity:.6;font-style:italic;padding:4px 8px;">No LFS-managed files detected.</div>`;

  const body = `
    <div style="display:flex;flex-direction:column;gap:14px;min-width:480px;">
      <div>
        <div style="font-weight:600;margin-bottom:6px;">Tracked patterns (.gitattributes)</div>
        ${patHtml}
      </div>
      <div>
        <div style="font-weight:600;margin-bottom:6px;">LFS-managed files (${files.length})</div>
        ${fileHtml}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="lfs-btn-pull" class="btn">Pull LFS objects</button>
        <button id="lfs-btn-fsck" class="btn">Verify (fsck)</button>
        <button id="lfs-btn-track" class="btn">Track pattern...</button>
      </div>
    </div>
  `;

  const m = modal({
    title: 'Git LFS',
    body,
    okText: 'CLOSE',
    cancelText: '',
    hideOk: false,
    onOk: () => true,
  });

  const handle = async (fn, label) => {
    setStatus(label + '...', 'busy');
    try {
      const r = await fn();
      if (r && r.ok) {
        toast(label + ' complete', 'ok');
        setStatus(label + ' complete', 'ok');
      } else {
        toast((r && r.error) || (label + ' failed'), 'error');
        setStatus((r && r.error) || (label + ' failed'), 'error');
      }
    } catch (e) {
      toast(e.message || (label + ' failed'), 'error');
      setStatus(e.message || (label + ' failed'), 'error');
    }
  };

  const btnPull = document.getElementById('lfs-btn-pull');
  if (btnPull) btnPull.onclick = () => handle(() => window.api.lfsPull(), 'LFS pull');

  const btnFsck = document.getElementById('lfs-btn-fsck');
  if (btnFsck) btnFsck.onclick = () => handle(() => window.api.lfsFsck(), 'LFS fsck');

  const btnTrack = document.getElementById('lfs-btn-track');
  if (btnTrack) btnTrack.onclick = () => {
    modal({
      title: 'Track LFS pattern',
      body: `
        <div style="display:flex;flex-direction:column;gap:8px;min-width:360px;">
          <div style="opacity:.8;font-size:12px;">Pattern (e.g. *.psd, assets/**/*.bin)</div>
          <input id="lfs-track-input" type="text" placeholder="*.bin" style="padding:6px 8px;background:var(--panel,#1a1224);border:1px solid var(--border,#2d2540);border-radius:4px;color:inherit;font-family:monospace;" />
        </div>
      `,
      okText: 'TRACK',
      onOk: async () => {
        const inp = document.getElementById('lfs-track-input');
        const pat = (inp && inp.value || '').trim();
        if (!pat) { toast('Pattern required', 'warn'); return false; }
        try {
          const r = await window.api.lfsTrack({ pattern: pat });
          if (r && r.ok) {
            toast('Now tracking ' + pat, 'ok');
            try { await refreshAll(); } catch {}
            // Re-open the main LFS modal so the new pattern shows up.
            setTimeout(() => openLfsModal(), 50);
          } else {
            toast((r && r.error) || 'Track failed', 'error');
            return false;
          }
        } catch (e) {
          toast(e.message || 'Track failed', 'error');
          return false;
        }
      },
    });
  };
}

document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if (inInput) return;
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    openLfsModal();
  }
});
