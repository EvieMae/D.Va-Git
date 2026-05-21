// Hooks viewer / editor: lists files in the repo's .git/hooks directory
// and allows viewing / editing them. Bound to Ctrl+Shift+K.

async function openHooksModal() {
  if (!state.repo) { toast('Open a repository first', 'error'); return; }
  const res = await window.api.hooksList();
  if (!res || !res.ok) { toast('Hooks list failed: ' + (res && res.error || 'unknown'), 'error'); return; }
  const items = res.data || [];

  const rows = items.length
    ? items.map(h => {
        const tag = h.isSample
          ? '<span class="badge" style="background:#3a2c1e;color:#ffb47a">sample</span>'
          : '<span class="badge" style="background:#1e3a2c;color:#7ee8b0">active</span>';
        return `
          <tr>
            <td style="font-family:monospace">${escapeHtml(h.name)}</td>
            <td>${tag}</td>
            <td style="text-align:right;opacity:.7">${h.size} B</td>
            <td style="text-align:right">
              <button class="btn-small hook-edit" data-name="${escapeHtml(h.name)}">View / Edit</button>
            </td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="opacity:.6;padding:12px">No hooks found in this repository.</td></tr>`;

  const body = `
    <div style="max-height:60vh;overflow:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="text-align:left;opacity:.7">
            <th style="padding:4px 6px">Name</th>
            <th style="padding:4px 6px">Status</th>
            <th style="padding:4px 6px;text-align:right">Size</th>
            <th style="padding:4px 6px"></th>
          </tr>
        </thead>
        <tbody id="hooks-tbody">${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:8px;opacity:.6;font-size:12px">
      Active hooks have no .sample suffix. On POSIX systems, saved hooks are made executable (chmod 755).
    </div>`;

  modal({ title: 'Git Hooks', body, hideOk: true, cancelText: 'CLOSE' });

  $$('.hook-edit').forEach(btn => {
    btn.onclick = () => openHookEditor(btn.dataset.name);
  });
}

async function openHookEditor(name) {
  const res = await window.api.hooksRead({ name });
  if (!res || !res.ok) { toast('Read failed: ' + (res && res.error || 'unknown'), 'error'); return; }
  const content = res.data || '';
  const body = `
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="font-family:monospace;opacity:.8">${escapeHtml(name)}</div>
      <textarea id="hook-editor-text" spellcheck="false"
        style="width:100%;min-height:50vh;font-family:monospace;font-size:12px;background:#0f0a1a;color:#e6dcff;border:1px solid #2a1f3a;padding:8px;border-radius:4px">${escapeHtml(content)}</textarea>
      <div style="opacity:.6;font-size:12px">Saving strips no extension. To enable a sample hook, rename it (remove .sample) and save -- or save as a new name from the file system.</div>
    </div>`;
  modal({
    title: 'Edit hook: ' + name,
    body,
    okText: 'SAVE',
    cancelText: 'CANCEL',
    onOk: async () => {
      const text = ($('#hook-editor-text') || {}).value || '';
      const w = await window.api.hooksWrite({ name, content: text });
      if (!w || !w.ok) { toast('Save failed: ' + (w && w.error || 'unknown'), 'error'); return false; }
      toast('Hook saved: ' + name, 'success');
      return true;
    },
  });
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
    e.preventDefault();
    openHooksModal();
  }
});
