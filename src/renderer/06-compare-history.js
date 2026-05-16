// ─────────────────────── Compare refs modal ───────────────────────
function refsList() {
  const out = [];
  out.push({ name: 'HEAD', kind: 'special' });
  (state.branches.local?.all || []).forEach(n => out.push({ name: n, kind: 'local' }));
  (state.branches.all?.all || [])
    .filter(n => n.startsWith('remotes/'))
    .forEach(n => out.push({ name: n.replace(/^remotes\//, ''), kind: 'remote' }));
  state.tags.forEach(t => out.push({ name: t, kind: 'tag' }));
  return out;
}

function openCompareRefsModal() {
  const refs = refsList();
  const opts = refs.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)} · ${r.kind}</option>`).join('');
  modal({
    title: 'COMPARE TWO REFS',
    body: `
      <label>FROM</label>
      <select id="modal-compare-from">${opts}</select>
      <label>TO</label>
      <select id="modal-compare-to">${opts}</select>
      <label>OPTIONAL FILE (relative path)</label>
      <input id="modal-compare-file" placeholder="leave blank for all"/>
      <div id="modal-compare-out" style="margin-top: 14px;"></div>
    `,
    okText: 'DIFF',
    onOk: async () => {
      const from = $('#modal-compare-from').value;
      const to = $('#modal-compare-to').value;
      const file = $('#modal-compare-file').value.trim() || null;
      const r = await window.api.diffRefs({ from, to, file });
      const out = $('#modal-compare-out');
      if (!r.ok) { out.innerHTML = `<div style="color: var(--err);">${escapeHtml(r.error)}</div>`; return false; }
      out.innerHTML = `<div style="max-height: 50vh; overflow: auto; border: 1px solid var(--line); border-radius: 4px;">${renderDiff(r.data) || '<div style="padding: 12px; color: var(--text-3);">No differences.</div>'}</div>`;
      return false; // keep modal open
    },
  });
}

// ─────────────────────── Multi-select in Changes ───────────────────────
function clearChangesSelection() {
  state.selectedChanges.unstaged.clear();
  state.selectedChanges.staged.clear();
  $$('.change-item').forEach(el => el.classList.remove('selected-multi'));
  $('#stage-selected-btn').style.display = 'none';
  $('#discard-selected-btn').style.display = 'none';
  $('#unstage-selected-btn').style.display = 'none';
  $('#unstaged-bulk-info').classList.add('hidden');
  $('#staged-bulk-info').classList.add('hidden');
}

function updateBulkButtons() {
  const u = state.selectedChanges.unstaged.size;
  const s = state.selectedChanges.staged.size;
  $('#stage-selected-btn').style.display = u ? '' : 'none';
  $('#discard-selected-btn').style.display = u ? '' : 'none';
  $('#unstage-selected-btn').style.display = s ? '' : 'none';
  const ui = $('#unstaged-bulk-info'); ui.classList.toggle('hidden', !u); ui.textContent = u ? `${u} selected` : '';
  const si = $('#staged-bulk-info'); si.classList.toggle('hidden', !s); si.textContent = s ? `${s} selected` : '';
}

$('#stage-selected-btn').onclick = async () => {
  const list = Array.from(state.selectedChanges.unstaged);
  if (!list.length) return;
  const r = await window.api.stage(list);
  if (r.ok) { clearChangesSelection(); await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
};
$('#discard-selected-btn').onclick = () => {
  const list = Array.from(state.selectedChanges.unstaged);
  if (!list.length) return;
  modal({
    title: 'DISCARD SELECTED',
    body: `<p>Discard local changes to ${list.length} file(s)? This cannot be undone.</p>`,
    okText: 'DISCARD',
    onOk: async () => {
      for (const f of list) {
        const r = await window.api.discardFile(f);
        if (!r.ok) toast(`${f}: ${r.error}`, 'error');
      }
      clearChangesSelection();
      await refreshStatus(); renderChanges(); renderCenterHeader();
    },
  });
};
$('#unstage-selected-btn').onclick = async () => {
  const list = Array.from(state.selectedChanges.staged);
  if (!list.length) return;
  const r = await window.api.unstage(list);
  if (r.ok) { clearChangesSelection(); await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
};

// Discard-all confirm
$('#discard-all-btn').onclick = () => {
  const unstaged = (state.status?.files || []).filter(f => f.working_dir && f.working_dir !== ' ').map(f => f.path);
  if (unstaged.length === 0) { toast('Nothing to discard', 'warn'); return; }
  modal({
    title: 'DISCARD ALL UNSTAGED CHANGES',
    body: `<p>Discard local changes to <strong>${unstaged.length}</strong> file(s)? This cannot be undone.</p>`,
    okText: 'DISCARD ALL',
    onOk: async () => {
      for (const f of unstaged) {
        await window.api.discardFile(f);
      }
      clearChangesSelection();
      await refreshStatus(); renderChanges(); renderCenterHeader();
    },
  });
};

// Wrap renderChanges to attach multi-select + drag-between-zones handlers
const _origRenderChanges = renderChanges;
renderChanges = function () {
  _origRenderChanges();
  // Wire shift-click multi-select
  $$('.change-item').forEach(item => {
    const path = item.dataset.path;
    const isStaged = item.dataset.staged === 'true';
    const set = isStaged ? state.selectedChanges.staged : state.selectedChanges.unstaged;
    if (set.has(path)) item.classList.add('selected-multi');

    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      const list = set.has(path) ? Array.from(set) : [path];
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('application/dva', JSON.stringify({ from: isStaged ? 'staged' : 'unstaged', paths: list })); } catch {}
      e.dataTransfer.setData('text/plain', list.join('\n'));
    });
    item.addEventListener('click', (e) => {
      if (e.target.classList?.contains('ci-act-btn')) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.stopImmediatePropagation();
        if (set.has(path)) { set.delete(path); item.classList.remove('selected-multi'); }
        else { set.add(path); item.classList.add('selected-multi'); }
        updateBulkButtons();
      }
    }, true);
  });
  updateBulkButtons();

  // Drag-zones
  ['unstaged', 'staged'].forEach(zone => {
    const el = document.querySelector(`.changes-list[data-zone="${zone}"]`);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      const payload = e.dataTransfer?.getData('application/dva');
      // Only react if dragging from the opposite zone
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', async (e) => {
      el.classList.remove('drop-target');
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('application/dva')); } catch { return; }
      if (!payload || payload.from === zone) return;
      if (zone === 'staged') {
        const r = await window.api.stage(payload.paths);
        if (!r.ok) toast(r.error, 'error');
      } else {
        const r = await window.api.unstage(payload.paths);
        if (!r.ok) toast(r.error, 'error');
      }
      clearChangesSelection();
      await refreshStatus(); renderChanges(); renderCenterHeader();
    });
  });
};

// ─────────────────────── Commit polish: templates, signoff, co-author, reword-last ───────────────────────
$('#commit-type-select')?.addEventListener('change', () => {
  const t = $('#commit-type-select').value;
  if (!t) return;
  const msg = $('#commit-msg').value;
  // If summary already starts with type:, replace; else prepend
  const m = msg.match(/^([a-z]+)(\([^)]+\))?:\s*/);
  if (m) $('#commit-msg').value = msg.replace(m[0], t + ': ');
  else $('#commit-msg').value = t + ': ' + msg;
  $('#commit-type-select').value = '';
  updateMsgHint();
});

$('#coauthor-check')?.addEventListener('change', () => {
  $('#commit-coauthor-row').classList.toggle('hidden', !$('#coauthor-check').checked);
});

function updateMsgHint() {
  const v = $('#commit-msg')?.value || '';
  const len = v.length;
  const el = $('#commit-msg-hint');
  if (!el) return;
  el.classList.remove('over', 'warn');
  if (len === 0) { el.textContent = ''; return; }
  if (len > 72) { el.textContent = `${len} chars (over 72)`; el.classList.add('over'); }
  else if (len > 50) { el.textContent = `${len} / 72 chars`; el.classList.add('warn'); }
  else el.textContent = `${len} / 72 chars`;
}
$('#commit-msg')?.addEventListener('input', updateMsgHint);

// Override #commit-btn to include signoff and co-author handling
$('#commit-btn').onclick = async () => {
  const summary = $('#commit-msg').value.trim();
  const descRaw = $('#commit-desc').value;
  const amend = $('#amend-check').checked;
  const signoff = $('#signoff-check').checked;
  const coauthor = $('#coauthor-check').checked ? $('#commit-coauthor').value.trim() : '';
  if (!summary && !amend) { toast('Commit message required', 'warn'); return; }

  // Wrap description body at 72 columns
  const wrap = (text, w = 72) => {
    if (!text) return '';
    return text.split('\n').map(line => {
      if (line.length <= w) return line;
      const out = []; let rest = line;
      while (rest.length > w) {
        let cut = rest.lastIndexOf(' ', w);
        if (cut <= 0) cut = w;
        out.push(rest.slice(0, cut)); rest = rest.slice(cut + 1);
      }
      out.push(rest);
      return out.join('\n');
    }).join('\n');
  };
  const desc = wrap(descRaw.trim(), 72);

  let fullMsg = desc ? `${summary}\n\n${desc}` : summary;
  const trailers = [];
  if (signoff && state.user?.name && state.user?.email) {
    trailers.push(`Signed-off-by: ${state.user.name} <${state.user.email}>`);
  }
  if (coauthor) trailers.push(`Co-authored-by: ${coauthor}`);
  if (trailers.length) fullMsg += `\n\n${trailers.join('\n')}`;

  setStatus('Committing...', 'busy');
  const r = await window.api.commit({ message: fullMsg, amend });
  if (r.ok) {
    toast('Committed.', 'ok');
    $('#commit-msg').value = '';
    $('#commit-desc').value = '';
    $('#amend-check').checked = false;
    $('#commit-coauthor').value = '';
    $('#coauthor-check').checked = false;
    $('#commit-coauthor-row').classList.add('hidden');
    updateMsgHint();
    await refreshAll();
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
};

$('#reword-last-btn')?.addEventListener('click', async () => {
  const head = state.commits[0];
  if (!head) { toast('No commits', 'warn'); return; }
  openRewordModal(head.hash);
});

// ─────────────────────── Sidebar filters ───────────────────────
function applySidebarFilters() {
  const lf = ($('#filter-local')?.value || '').toLowerCase();
  const rf = ($('#filter-remote')?.value || '').toLowerCase();
  const tf = ($('#filter-tags')?.value || '').toLowerCase();
  $$('#branches-local .sidebar-list-item').forEach(el => {
    el.style.display = !lf || el.dataset.branch?.toLowerCase().includes(lf) ? '' : 'none';
  });
  $$('#branches-remote .sidebar-list-item').forEach(el => {
    el.style.display = !rf || el.dataset.branch?.toLowerCase().includes(rf) ? '' : 'none';
  });
  $$('#tags-list .sidebar-list-item').forEach(el => {
    el.style.display = !tf || el.dataset.tag?.toLowerCase().includes(tf) ? '' : 'none';
  });
}
$('#filter-local')?.addEventListener('input', applySidebarFilters);
$('#filter-remote')?.addEventListener('input', applySidebarFilters);
$('#filter-tags')?.addEventListener('input', applySidebarFilters);

// Re-apply filters whenever sidebar re-renders
const _origRenderSidebarBranches = renderSidebarBranches;
renderSidebarBranches = function () { _origRenderSidebarBranches(); applySidebarFilters(); };
const _origRenderSidebarRemotes = renderSidebarRemotes;
renderSidebarRemotes = function () { _origRenderSidebarRemotes(); applySidebarFilters(); };
const _origRenderSidebarTags = renderSidebarTags;
renderSidebarTags = function () {
  _origRenderSidebarTags();
  // Make tags clickable: right-click context menu (delete, push, copy)
  $$('#tags-list .sidebar-list-item').forEach(el => {
    el.oncontextmenu = (e) => {
      e.preventDefault();
      tagContextMenu(el.dataset.tag, e.clientX, e.clientY);
    };
  });
  applySidebarFilters();
};

function tagContextMenu(tag, x, y) {
  showContextMenu(x, y, [
    { label: `Copy "${tag}"`, icon: '⧉', action: () => copyText(tag) },
    { label: 'Push tag', icon: '↑', action: async () => {
      const r = await window.api.tagPush({ remote: state.settings.defaultRemote, tag });
      if (r.ok) toast(`Pushed ${tag}`, 'ok');
      else toast(r.error, 'error');
    } },
    { separator: true },
    { label: 'Delete tag', icon: '✕', danger: true, action: async () => {
      modal({
        title: 'DELETE TAG',
        body: `<p>Delete tag <strong>${escapeHtml(tag)}</strong>? Local only — push to remove from remote.</p>`,
        okText: 'DELETE',
        onOk: async () => {
          const r = await window.api.tagDelete(tag);
          if (r.ok) { toast(`Deleted ${tag}`, 'ok'); await refreshAll(); }
          else { toast(r.error, 'error'); return false; }
        },
      });
    } },
  ]);
}

// ─────────────────────── Files tab: search + hidden + icons ───────────────────────
function extIconClass(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js','jsx','mjs','cjs'].includes(ext)) return 'ext-js';
  if (['ts','tsx'].includes(ext)) return 'ext-ts';
  if (['py'].includes(ext)) return 'ext-py';
  if (['md','markdown','txt','rst'].includes(ext)) return 'ext-md';
  if (['json','yaml','yml','toml'].includes(ext)) return 'ext-json';
  if (['css','scss','sass','less'].includes(ext)) return 'ext-css';
  if (['html','htm','xml','svg'].includes(ext)) return 'ext-html';
  if (['png','jpg','jpeg','gif','webp','bmp','ico','avif'].includes(ext)) return 'ext-img';
  if (['mp4','webm','mov','mkv','avi'].includes(ext)) return 'ext-video';
  if (['mp3','wav','ogg','flac','m4a'].includes(ext)) return 'ext-audio';
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'ext-archive';
  return '';
}

// Wrap renderTreeNodes to add ext class
const _origRenderTreeNodes = renderTreeNodes;
renderTreeNodes = function (nodes, depth) {
  if (!nodes || nodes.length === 0) return '<div style="padding: 8px 18px; color: var(--text-mute); font-style: italic;">— empty —</div>';
  const filtered = nodes.filter(n => {
    if (!state.filesShowHidden && n.path.split('/').pop().startsWith('.')) return false;
    return true;
  });
  return filtered.map(n => {
    const padding = 12 + depth * 14;
    const leaf = n.path.split('/').pop();
    if (n.type === 'dir') {
      return `
        <div class="tree-row dir" data-path="${escapeHtml(n.path)}" data-type="dir" style="padding-left: ${padding}px;">
          <span class="tree-arrow">▸</span>
          <span class="tree-icon">📁</span>
          <span class="tree-label">${escapeHtml(leaf)}</span>
        </div>
        <div class="tree-children">${renderTreeNodes(n.children, depth + 1)}</div>
      `;
    }
    return `
      <div class="tree-row file" data-path="${escapeHtml(n.path)}" data-type="file" style="padding-left: ${padding}px;">
        <span class="tree-arrow"></span>
        <span class="tree-icon ${extIconClass(leaf)}">📄</span>
        ${lfsBadgeHtml(n.path)}
        <span class="tree-label">${escapeHtml(leaf)}</span>
      </div>
    `;
  }).join('');
};

function applyFilesSearch() {
  const q = (state.filesSearch || '').trim().toLowerCase();
  const tree = $('#files-tree');
  if (!tree) return;
  const allRows = $$('#files-tree .tree-row');
  const allChildContainers = $$('#files-tree .tree-children');

  if (!q) {
    tree.classList.remove('search-active');
    allRows.forEach(r => { r.style.display = ''; });
    allChildContainers.forEach(c => { c.style.display = ''; });
    allRows.forEach(r => {
      if (r.dataset.type === 'dir') {
        const arrow = r.querySelector('.tree-arrow');
        if (arrow) arrow.textContent = r.classList.contains('expanded') ? '▾' : '▸';
      }
    });
    return;
  }

  tree.classList.add('search-active');
  // Hide directory rows entirely while searching — show only matching files.
  allRows.forEach(row => {
    if (row.dataset.type === 'dir') { row.style.display = 'none'; return; }
    const p = (row.dataset.path || '').toLowerCase();
    row.style.display = p.includes(q) ? '' : 'none';
  });
  // Force-show all tree-children containers so files inside collapsed dirs render.
  allChildContainers.forEach(c => { c.style.display = 'block'; });
}
$('#files-search')?.addEventListener('input', (e) => {
  state.filesSearch = e.target.value;
  applyFilesSearch();
});
$('#files-show-hidden')?.addEventListener('change', () => {
  state.filesShowHidden = $('#files-show-hidden').checked;
  renderFilesTree();
});
$('#files-tracked-only')?.addEventListener('change', () => {
  renderFilesTree();
});

// ─────────────────────── Commit-file context menu (Restore + Copy) ───────────────────────
// Patch selectCommit's file-click handler to also wire context menu
const _origSelectCommit = selectCommit;
selectCommit = async function (hash) {
  await _origSelectCommit(hash);
  $$('#commit-files-list .commit-file').forEach(el => {
    el.oncontextmenu = (e) => {
      e.preventDefault();
      const file = el.dataset.path;
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Open at HEAD', icon: '↗', action: () => openFileInEditor(file, true) },
        { label: `Restore from ${hash.slice(0,7)}`, icon: '⤺', action: async () => {
          const r = await window.api.restoreFromCommit({ hash, file });
          if (r.ok) { toast('Restored', 'ok'); await refreshAll(); }
          else toast(r.error, 'error');
        } },
        { separator: true },
        { label: 'Show file history…', icon: '⌖', action: () => openFileHistoryModal(file) },
        { label: 'Blame…', icon: '👁', action: () => openBlameModal(file) },
        { separator: true },
        { label: 'Copy path', icon: '⧉', action: () => copyText(file) },
      ]);
    };
  });
};

// ─────────────────────── File history modal ───────────────────────
async function openFileHistoryModal(file) {
  modal({
    title: `HISTORY — ${file}`,
    body: `<div id="modal-file-history-list" style="max-height: 60vh; overflow-y: auto;"><div style="padding: 12px; color: var(--text-3);">Loading…</div></div>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  const r = await window.api.logFile({ file, maxCount: 300 });
  const out = $('#modal-file-history-list');
  if (!r.ok) { out.innerHTML = `<div style="color: var(--err); padding: 12px;">${escapeHtml(r.error)}</div>`; return; }
  if (!r.data.length) { out.innerHTML = `<div style="padding: 12px; color: var(--text-3);">No history.</div>`; return; }
  out.innerHTML = `<div class="file-history-list">${r.data.map(c => `
    <div class="file-history-item" data-hash="${escapeHtml(c.hash)}">
      <span class="file-history-sha">${escapeHtml(c.hash.slice(0,7))}</span>
      <span class="file-history-msg">${escapeHtml(c.message)}</span>
      <span class="file-history-date">${escapeHtml(formatDate(c.date))}</span>
    </div>
  `).join('')}</div>`;
  $$('#modal-file-history-list .file-history-item').forEach(el => {
    el.onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      switchCenterTab('history');
      selectCommit(el.dataset.hash);
    };
  });
}

// ─────────────────────── Blame modal ───────────────────────
async function openBlameModal(file) {
  modal({
    title: `BLAME — ${file}`,
    body: `<div id="modal-blame-out" style="max-height: 65vh; overflow: auto;"><div style="padding:12px; color: var(--text-3);">Loading…</div></div>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  const r = await window.api.blame({ file });
  const out = $('#modal-blame-out');
  if (!r.ok) { out.innerHTML = `<div style="color: var(--err); padding: 12px;">${escapeHtml(r.error)}</div>`; return; }
  const blameLang = detectLang(file);
  out.innerHTML = `<div class="blame-view">${r.data.map(row => `
    <div class="blame-row" data-hash="${escapeHtml(row.sha)}" title="${escapeHtml(row.summary || '')}">
      <span class="blame-sha">${escapeHtml((row.sha || '').slice(0,7))}</span>
      <span class="blame-author">${escapeHtml(row.author || '')}</span>
      <span class="blame-line">${row.line}</span>
      <span class="blame-code">${highlightCode(row.text, blameLang) || '&nbsp;'}</span>
    </div>
  `).join('')}</div>`;
  $$('#modal-blame-out .blame-row').forEach(el => {
    el.onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      selectCommit(el.dataset.hash);
    };
  });
}

// ─────────────────────── Reflog modal ───────────────────────
async function openReflogModal() {
  modal({
    title: 'REFLOG',
    body: `<div id="modal-reflog-out" style="max-height: 65vh; overflow-y: auto;"><div style="padding: 12px; color: var(--text-3);">Loading…</div></div>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  const r = await window.api.reflog({ maxCount: 300 });
  const out = $('#modal-reflog-out');
  if (!r.ok) { out.innerHTML = `<div style="color: var(--err); padding: 12px;">${escapeHtml(r.error)}</div>`; return; }
  out.innerHTML = `<div class="reflog-list">${r.data.map(row => `
    <div class="reflog-row" data-hash="${escapeHtml(row.hash)}">
      <span class="reflog-hash">${escapeHtml(row.hash)}</span>
      <span><span class="reflog-ref">${escapeHtml(row.ref)}</span><span class="reflog-msg">${escapeHtml(row.message)}</span></span>
    </div>
  `).join('')}</div>`;
  $$('#modal-reflog-out .reflog-row').forEach(el => {
    el.onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      switchCenterTab('history');
      selectCommit(el.dataset.hash);
    };
  });
}

// ─────────────────────── Help cheatsheet modal ───────────────────────
function openHelpModal() {
  const rows = [
    ['Ctrl+Enter', 'Commit'],
    ['F5 / Ctrl+R', 'Refresh repo'],
    ['Ctrl+T', 'Open another repo'],
    ['Ctrl+W', 'Close active repo tab'],
    ['Ctrl+Tab / Ctrl+Shift+Tab', 'Cycle tabs'],
    ['Ctrl+K', 'Command palette'],
    ['Ctrl+P', 'Recent branches'],
    ['Ctrl+F', 'Find in editor'],
    ['Ctrl+/', 'This help'],
    ['Ctrl+,', 'Settings'],
    ['Ctrl++ / Ctrl+-', 'Increase / decrease font'],
    ['Ctrl+0', 'Reset font'],
    ['Ctrl+B', 'New branch'],
    ['Ctrl+Shift+T', 'New tag'],
    ['Shift+click Push', 'Push options'],
    ['Middle-click tab', 'Close tab'],
    ['Drag a folder onto the window', 'Open that repo'],
    ['Drag file in Changes', 'Move between Staged ↔ Unstaged'],
  ];
  modal({
    title: 'KEYBOARD SHORTCUTS',
    body: `<div class="help-grid">${rows.map(([k, v]) => `
      <div class="help-row"><kbd>${k}</kbd><span class="help-label">${v}</span></div>
    `).join('')}</div>
    <p style="margin-top: 14px; font-size: 11px; color: var(--text-3);">D.Va Git · "I play to win!"</p>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
}
$('#btn-help').onclick = openHelpModal;

// ─────────────────────── Command palette (Ctrl+K) ───────────────────────
let _palette = null;
function openCommandPalette() {
  if (_palette) return;
  const items = [
    { id: 'fetch',    label: 'Fetch',                     icon: '⟲', action: () => $('#btn-fetch').click() },
    { id: 'pull',     label: 'Pull',                      icon: '↓', action: () => $('#btn-pull').click() },
    { id: 'push',     label: 'Push',                      icon: '↑', action: () => $('#btn-push').click() },
    { id: 'pushopts', label: 'Push (options)…',           icon: '↑', action: openPushOptionsModal },
    { id: 'tag',      label: 'New tag…',                  icon: '▼', action: () => openTagModal(null) },
    { id: 'branch',   label: 'New branch…',               icon: '⎇', action: openNewBranchModal },
    { id: 'stash',    label: 'Stash…',                    icon: '★', action: stashFlow },
    { id: 'compare',  label: 'Compare refs…',             icon: '⇄', action: openCompareRefsModal },
    { id: 'reflog',   label: 'Show reflog…',              icon: '⌖', action: openReflogModal },
    { id: 'settings', label: 'Settings',                  icon: '⚙', action: openSettingsModal },
    { id: 'help',     label: 'Help / shortcuts',          icon: '?', action: openHelpModal },
    { id: 'explorer', label: 'Open in file explorer',     icon: '📁', action: () => $('#btn-open-folder').click() },
    { id: 'terminal', label: 'Open terminal here',        icon: '▶_', action: () => $('#btn-open-terminal').click() },
    { id: 'vscode',   label: 'Open in VS Code',           icon: '⌘', action: () => $('#btn-open-vscode').click() },
    { id: 'history',  label: 'Show History',              icon: '⌖', action: () => switchCenterTab('history') },
    { id: 'changes',  label: 'Show Changes',              icon: '✎', action: () => switchRightTab('changes') },
    { id: 'files',    label: 'Show Files',                icon: '📂', action: () => switchCenterTab('files') },
    { id: 'submodules', label: 'Submodules…',             icon: '🧩', action: () => openSubmodulesModal() },
    { id: 'worktrees',  label: 'Worktrees…',              icon: '🌿', action: () => openWorktreesModal() },
    { id: 'conflicts',  label: 'Resolve conflicts…',      icon: '⚠', action: () => openConflictsModal() },
  ];
  // Add branches dynamically
  (state.branches.local?.all || []).forEach(b => items.push({
    id: 'cb-' + b, label: 'Checkout ' + b, icon: '⎇', sub: 'branch', action: () => switchBranch(b),
  }));

  const root = document.createElement('div');
  root.className = 'palette';
  root.innerHTML = `
    <input class="palette-input" id="palette-input" placeholder="Type a command or branch…"/>
    <div class="palette-list" id="palette-list"></div>
  `;
  document.body.appendChild(root);
  _palette = root;

  let activeIdx = 0;
  const render = (q = '') => {
    const lq = q.toLowerCase();
    const filtered = items.filter(it => !lq || it.label.toLowerCase().includes(lq));
    if (activeIdx >= filtered.length) activeIdx = 0;
    $('#palette-list').innerHTML = filtered.map((it, i) => `
      <div class="palette-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <span class="palette-icon">${escapeHtml(it.icon)}</span>
        <span>${escapeHtml(it.label)}</span>
        ${it.sub ? `<span class="palette-sub">${escapeHtml(it.sub)}</span>` : ''}
      </div>
    `).join('') || '<div style="padding: 14px; color: var(--text-3);">No matches.</div>';
    $$('#palette-list .palette-item').forEach(el => {
      el.onclick = () => { closeCommandPalette(); filtered[parseInt(el.dataset.idx, 10)].action(); };
    });
    return filtered;
  };

  const close = () => closeCommandPalette();
  $('#palette-input').oninput = () => render($('#palette-input').value);
  $('#palette-input').onkeydown = (e) => {
    const filtered = render($('#palette-input').value);
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter') {
      if (filtered[activeIdx]) { close(); filtered[activeIdx].action(); }
    }
    else if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, filtered.length - 1); render($('#palette-input').value); e.preventDefault(); }
    else if (e.key === 'ArrowUp')   { activeIdx = Math.max(activeIdx - 1, 0); render($('#palette-input').value); e.preventDefault(); }
  };
  document.addEventListener('mousedown', paletteOutsideClose, true);
  render();
  $('#palette-input').focus();
}
function paletteOutsideClose(e) {
  if (!_palette) return;
  if (!e.target.closest('.palette')) closeCommandPalette();
}
function closeCommandPalette() {
  if (!_palette) return;
  document.removeEventListener('mousedown', paletteOutsideClose, true);
  _palette.remove();
  _palette = null;
}
