// ─────────────────────── .gitignore tools ───────────────────────

const GITIGNORE_TEMPLATE_NAMES = ['Node', 'Python', 'Unity', 'Go', 'Rust', 'Web', 'generic'];
let _gitignoreTemplatesCache = null;

async function loadGitignoreTemplates() {
  if (_gitignoreTemplatesCache) return _gitignoreTemplatesCache;
  try {
    const r = await window.api.gitignoreTemplates();
    if (r && r.ok) _gitignoreTemplatesCache = r.data || {};
  } catch (_) {}
  return _gitignoreTemplatesCache || {};
}

function gitignoreFindStatusEntry(p) {
  if (!state || !state.status || !Array.isArray(state.status.files)) return null;
  return state.status.files.find(f => f.path === p) || null;
}

function gitignoreIsUntracked(entry) {
  if (!entry) return false;
  const idx = entry.index || ' ';
  const wt = entry.working_dir || ' ';
  return idx === '?' && wt === '?';
}

async function gitignoreAddPath(relPath) {
  if (!relPath) return;
  // simple-git represents untracked directories with a trailing '/', so we forward as-is.
  const line = relPath.replace(/\\/g, '/');
  const r = await window.api.gitignoreAppendLine(line);
  if (r && r.ok) {
    if (r.alreadyPresent) toast('.gitignore already contains that entry', 'ok');
    else toast('Added to .gitignore: ' + line, 'ok');
    if (typeof refreshStatus === 'function') refreshStatus();
  } else {
    toast('Failed to update .gitignore: ' + (r && r.error || 'unknown'), 'err');
  }
}

async function openGitignoreModal() {
  const templates = await loadGitignoreTemplates();
  const names = Object.keys(templates).length ? Object.keys(templates) : GITIGNORE_TEMPLATE_NAMES;
  const optionsHtml = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  const first = names[0] || 'generic';
  const previewInit = escapeHtml(templates[first] || '');

  const body = `
    <div style="display: flex; flex-direction: column; gap: 10px; min-width: 520px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <label style="font-size: 12px; color: var(--text-3); text-transform: uppercase; letter-spacing: 1px;">Template</label>
        <select id="gi-template-select" style="flex: 1;">${optionsHtml}</select>
      </div>
      <textarea id="gi-template-preview" spellcheck="false" style="width: 100%; height: 280px; font-family: monospace; font-size: 12px;">${previewInit}</textarea>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="gi-append-btn" class="btn">Append</button>
        <button id="gi-replace-btn" class="btn danger">Replace</button>
      </div>
      <div style="font-size: 11px; color: var(--text-mute);">Append adds to the existing .gitignore. Replace overwrites the file.</div>
    </div>
  `;

  modal({
    title: 'Generate .gitignore',
    body,
    okText: 'CLOSE',
    cancelText: 'CANCEL',
    hideOk: true,
  });

  const sel = $('#gi-template-select');
  const preview = $('#gi-template-preview');
  if (sel && preview) {
    sel.addEventListener('change', async () => {
      const tpls = await loadGitignoreTemplates();
      preview.value = tpls[sel.value] || '';
    });
  }

  const doWrite = async (mode) => {
    const name = sel ? sel.value : first;
    const r = await window.api.gitignoreWriteTemplate(name, mode);
    if (r && r.ok) {
      toast('.gitignore ' + (mode === 'replace' ? 'replaced' : 'updated'), 'ok');
      $('#modal-backdrop').classList.add('hidden');
      if (typeof refreshStatus === 'function') refreshStatus();
    } else {
      toast('Failed: ' + (r && r.error || 'unknown'), 'err');
    }
  };

  const appendBtn = $('#gi-append-btn');
  const replaceBtn = $('#gi-replace-btn');
  if (appendBtn) appendBtn.onclick = () => doWrite('append');
  if (replaceBtn) replaceBtn.onclick = () => {
    modal({
      title: 'Replace .gitignore?',
      body: '<div>This overwrites the entire .gitignore file at the repo root. Continue?</div>',
      okText: 'REPLACE',
      onOk: () => doWrite('replace'),
    });
  };
}

// Monkey-patch bindChangesDelegation to add untracked context menu
(function() {
  if (typeof bindChangesDelegation !== 'function') return;
  const _orig = bindChangesDelegation;
  let _ctxBound = false;
  bindChangesDelegation = function() {
    _orig();
    if (_ctxBound) return;
    _ctxBound = true;
    const list = $('#unstaged-list');
    if (!list) return;
    list.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.change-item');
      if (!item || !list.contains(item)) return;
      if (item.dataset.staged !== 'false') return;
      const p = item.dataset.path;
      const entry = gitignoreFindStatusEntry(p);
      if (!gitignoreIsUntracked(entry)) return;
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: 'Add to .gitignore',
          icon: '🚫',
          action: () => gitignoreAddPath(p),
        },
        { separator: true },
        {
          label: 'Generate .gitignore...',
          action: () => openGitignoreModal(),
        },
      ]);
    });
  };
})();

// Ctrl+Shift+G shortcut to open template modal
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    openGitignoreModal();
  }
});
