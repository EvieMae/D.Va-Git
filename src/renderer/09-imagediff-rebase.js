// ─────────────────────── Image diff ───────────────────────
async function openImageDiff(file, hash) {
  state.editorFile = { path: file, fileType: 'image', mode: 'image-diff', editable: false, dirty: false, atCommit: hash };
  $('#editor-tab').classList.remove('hidden');
  $('#editor-tab-label').textContent = file.split(/[\\/]/).pop() || file;
  $('#editor-tab').title = file;
  $('#editor-bar-path').textContent = `${file} @ ${hash.slice(0,7)} (image diff)`;
  $('#editor-bar-status').textContent = '';
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.add('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = true;
  switchCenterTab('editor');
  // Hide other panes
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  $('#editor-media').classList.add('hidden');
  $('#editor-binary').classList.add('hidden');
  detachEditorTextarea();
  $$('#editor-body .hunk-panel, #editor-body .conflict-wrap, #editor-body .editor-edit-wrap, #editor-body .image-diff, #editor-body .conflict-resolver').forEach(n => n.remove());

  // Get image at parent (before) and at the commit (after).
  const beforeRef = hash + '^';
  const [a, b] = await Promise.all([
    window.api.showBinary({ ref: beforeRef, file }),
    window.api.showBinary({ ref: hash, file }),
  ]);
  const mime = mimeFor(file);
  const beforeUri = a.ok ? `data:${mime};base64,${a.data}` : null;
  const afterUri = b.ok ? `data:${mime};base64,${b.data}` : null;

  const root = document.createElement('div');
  root.className = 'image-diff';
  root.innerHTML = `
    <div class="image-diff-toolbar">
      <button class="csh-action toolbar-toggle on" data-mode="sxs">Side-by-side</button>
      <button class="csh-action toolbar-toggle" data-mode="swipe">Swipe</button>
      <button class="csh-action toolbar-toggle" data-mode="onion">Onion-skin</button>
    </div>
    <div class="image-diff-area" id="image-diff-area"></div>
  `;
  $('#editor-body').appendChild(root);

  const renderMode = (mode) => {
    $$('.image-diff-toolbar button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const area = $('#image-diff-area');
    if (!beforeUri && !afterUri) { area.innerHTML = '<div style="color:var(--text-3);">Image not available at either revision.</div>'; return; }
    if (mode === 'sxs') {
      area.innerHTML = `
        <div class="image-diff-side-by-side">
          <div class="image-diff-side before">
            <div class="image-diff-side-label">Before</div>
            ${beforeUri ? `<img src="${beforeUri}"/>` : '<div style="color: var(--text-3);">— (new file)</div>'}
          </div>
          <div class="image-diff-side after">
            <div class="image-diff-side-label">After</div>
            ${afterUri ? `<img src="${afterUri}"/>` : '<div style="color: var(--text-3);">— (deleted)</div>'}
          </div>
        </div>
      `;
    } else if (mode === 'swipe' && beforeUri && afterUri) {
      area.innerHTML = `
        <div class="image-diff-swipe" id="swipe-root">
          <img class="before" src="${beforeUri}"/>
          <div class="image-diff-swipe-after" id="swipe-after-clip"><img src="${afterUri}"/></div>
          <div class="image-diff-swipe-handle" id="swipe-handle" style="left: 50%;"></div>
        </div>
      `;
      const root = $('#swipe-root');
      const clip = $('#swipe-after-clip');
      const handle = $('#swipe-handle');
      const onMove = (e) => {
        const r = root.getBoundingClientRect();
        const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
        clip.style.width = x + 'px';
        handle.style.left = x + 'px';
      };
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const up = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', up);
      });
    } else if (mode === 'onion' && beforeUri && afterUri) {
      area.innerHTML = `
        <div style="display:flex; flex-direction: column; gap: 10px; align-items: center;">
          <div class="image-diff-onion">
            <img class="before" src="${beforeUri}"/>
            <img class="after" id="onion-after" src="${afterUri}" style="opacity: 0.5;"/>
          </div>
          <input type="range" min="0" max="100" value="50" id="onion-slider" style="width: 320px;"/>
        </div>
      `;
      $('#onion-slider').oninput = (e) => { $('#onion-after').style.opacity = e.target.value / 100; };
    } else {
      area.innerHTML = '<div style="color: var(--text-3);">Need both before and after for this mode.</div>';
    }
  };
  $$('.image-diff-toolbar button').forEach(b => {
    b.onclick = () => renderMode(b.dataset.mode);
  });
  renderMode('sxs');
}

// Hook into commit-file click: if file is image, open image diff view in main page
const _origSelectCommit2 = selectCommit;
selectCommit = async function (hash) {
  await _origSelectCommit2(hash);
  $$('#commit-files-list .commit-file').forEach(el => {
    const oldClick = el.onclick;
    el.onclick = async (e) => {
      const file = el.dataset.path;
      const ft = getFileType(file);
      if (ft === 'image') {
        $$('#commit-files-list .commit-file').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        // Still show the inline diff on the side, then open image diff in editor
        await openImageDiff(file, hash);
        return;
      }
      if (oldClick) await oldClick.call(el, e);
    };
  });
};

// ─────────────────────── Submodules / Worktrees modals ───────────────────────
async function openSubmodulesModal() {
  modal({
    title: 'SUBMODULES',
    body: `<div id="modal-sm-out"><div style="padding: 12px; color: var(--text-3);">Loading…</div></div>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  const r = await window.api.submodules();
  const out = $('#modal-sm-out');
  if (!r.ok) { out.innerHTML = `<div style="color: var(--err); padding: 12px;">${escapeHtml(r.error)}</div>`; return; }
  state.submodules = r.data;
  if (!r.data.length) { out.innerHTML = `<div style="padding: 12px; color: var(--text-3);">No submodules in this repo.</div>`; return; }
  out.innerHTML = `<div class="sm-list">${r.data.map(s => `
    <div class="sm-row" data-path="${escapeHtml(s.path)}">
      <span class="sm-path">${escapeHtml(s.path)}</span>
      <span class="sm-sha">${escapeHtml(s.sha.slice(0,7))}</span>
      <span class="sm-state ${s.initialized ? (s.outOfSync ? 'out' : 'ok') : 'uninit'}">${s.initialized ? (s.outOfSync ? 'out of sync' : 'OK') : 'uninit'}</span>
      <span style="display:flex; gap:4px;">
        <button class="csh-action" data-act="init">Init/Update</button>
        <button class="csh-action" data-act="open">Open</button>
      </span>
    </div>
  `).join('')}</div>`;
  $$('#modal-sm-out .sm-row').forEach(row => {
    const p = row.dataset.path;
    row.querySelector('[data-act="init"]').onclick = async () => {
      setStatus('Updating submodule…', 'busy');
      const r = await window.api.submoduleUpdate({ p, init: true });
      if (r.ok) { toast(`Updated ${p}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
    };
    row.querySelector('[data-act="open"]').onclick = async () => {
      const abs = state.repo.path.replace(/[/\\]$/, '') + '/' + p;
      $('#modal-backdrop').classList.add('hidden');
      await openRepoPath(abs);
    };
  });
}

async function openWorktreesModal() {
  modal({
    title: 'WORKTREES',
    body: `<div id="modal-wt-out"><div style="padding: 12px; color: var(--text-3);">Loading…</div></div>
      <hr style="border: none; border-top: 1px solid var(--line); margin: 14px 0;"/>
      <label>Add a new worktree</label>
      <div class="form-row" style="gap: 8px; margin-top: 6px;">
        <input id="modal-wt-path" placeholder="C:\\path\\to\\new-worktree" />
        <input id="modal-wt-ref" placeholder="branch or commit"/>
        <button class="csh-action" id="modal-wt-add">Add</button>
      </div>`,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  const refresh = async () => {
    const r = await window.api.worktrees();
    const out = $('#modal-wt-out');
    if (!r.ok) { out.innerHTML = `<div style="color: var(--err); padding: 12px;">${escapeHtml(r.error)}</div>`; return; }
    state.worktrees = r.data;
    out.innerHTML = `<div class="wt-list">${r.data.map(w => `
      <div class="wt-row" data-path="${escapeHtml(w.path)}">
        <span class="wt-path">${escapeHtml(w.path)}${w.path === state.repo?.path ? ' <span class="wt-current-pill">current</span>' : ''}</span>
        <span class="wt-head">${escapeHtml((w.head || '').slice(0,7))}</span>
        <span style="color: var(--text-2);">${escapeHtml(w.branch || (w.detached ? '(detached)' : ''))}</span>
        <span style="display:flex; gap:4px;">
          <button class="csh-action" data-act="open">Open</button>
          <button class="csh-action danger" data-act="remove">Remove</button>
        </span>
      </div>
    `).join('')}</div>`;
    $$('#modal-wt-out .wt-row').forEach(row => {
      const p = row.dataset.path;
      row.querySelector('[data-act="open"]').onclick = async () => {
        $('#modal-backdrop').classList.add('hidden');
        await openRepoPath(p);
      };
      row.querySelector('[data-act="remove"]').onclick = async () => {
        if (p === state.repo?.path) { toast("Can't remove the current worktree", 'warn'); return; }
        const rr = await window.api.worktreeRemove(p);
        if (rr.ok) { toast(`Removed ${p}`, 'ok'); refresh(); }
        else toast(rr.error, 'error');
      };
    });
  };
  await refresh();
  $('#modal-wt-add').onclick = async () => {
    const path = $('#modal-wt-path').value.trim();
    const ref = $('#modal-wt-ref').value.trim();
    if (!path || !ref) { toast('Path and ref required', 'warn'); return; }
    const r = await window.api.worktreeAdd({ path, ref });
    if (r.ok) { toast('Worktree added', 'ok'); refresh(); }
    else toast(r.error, 'error');
  };
}

// ─────────────────────── Branch protection ───────────────────────
function markProtectedBranches() {
  const protect = (state.settings.protectedBranches || []).map(s => s.toLowerCase());
  $$('#branches-local .sidebar-list-item').forEach(el => {
    const b = (el.dataset.branch || '').toLowerCase();
    if (protect.includes(b)) el.classList.add('protected');
    else el.classList.remove('protected');
  });
}

// ─────────────────────── GPG signing pill ───────────────────────
function applySigningPill() {
  const header = $('.commit-box-header');
  if (!header) return;
  let pill = header.querySelector('.gpg-pill');
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'gpg-pill';
    pill.style.marginLeft = '6px';
    pill.title = 'Click to toggle commit signing';
    pill.onclick = async () => {
      const enabled = !state.signing.gpgsign;
      const r = await window.api.setSigning({ enabled });
      if (r.ok) { state.signing.gpgsign = enabled; applySigningPill(); toast(enabled ? 'Signing ON' : 'Signing OFF', 'ok'); }
      else toast(r.error, 'error');
    };
    header.insertBefore(pill, header.querySelector('.commit-template-picker') || null);
  }
  if (state.signing.gpgsign) { pill.textContent = '🔏 signed'; pill.classList.remove('off'); }
  else { pill.textContent = 'unsigned'; pill.classList.add('off'); }
}

// ─────────────────────── Interactive rebase ───────────────────────
async function openInteractiveRebaseModal(upstream) {
  // List commits from HEAD down to upstream (exclusive)
  // Use the existing log; filter to those reachable from HEAD that aren't in upstream.
  // Simplest: take state.commits where ancestor of HEAD; we don't have that. So use
  // git directly.
  setStatus('Loading commits…', 'busy');
  const r = await window.api.logBranch({ branch: 'HEAD', maxCount: 200 });
  if (!r.ok) { toast(r.error, 'error'); setStatus('Idle', 'error'); return; }
  // Cut at the upstream commit (or 30 if not found)
  const allCommits = r.data;
  let cutoff = allCommits.findIndex(c => c.hash.startsWith(upstream) || (c.hash === upstream));
  if (cutoff < 0) cutoff = Math.min(30, allCommits.length);
  const commits = allCommits.slice(0, cutoff).reverse(); // git rebase todo is oldest→newest
  if (!commits.length) { toast('No commits to rebase', 'warn'); setStatus('Idle'); return; }

  setStatus('Ready');
  // Build editable list
  const rows = commits.map(c => ({ hash: c.hash, message: c.message, author: c.author_name, action: 'pick' }));

  modal({
    title: `INTERACTIVE REBASE onto ${upstream.slice(0,7)}`,
    body: `<p style="font-size: 11.5px; color: var(--text-3);">Drag to reorder. Older commits at top.</p>
      <div id="rebase-list" class="rebase-list"></div>
      <p style="font-size: 11px; color: var(--text-3); margin-top: 10px;">Note: reword and edit will pause the rebase — use Continue from the banner. Squash/fixup combine into the previous commit.</p>`,
    okText: 'START REBASE',
    onOk: async () => {
      // Build todo
      const todo = rows.map(r => `${r.action} ${r.hash} ${r.message.split('\n')[0]}`).join('\n') + '\n';
      setStatus('Rebasing…', 'busy');
      const rr = await window.api.rebaseInteractive({ upstream, todo });
      if (rr.ok) { toast('Rebase complete', 'ok'); await refreshAll(); }
      else { toast(rr.error || 'Rebase stopped (may need conflict resolution)', 'error'); await refreshAll(); }
    },
  });

  const renderRows = () => {
    $('#rebase-list').innerHTML = rows.map((r, i) => `
      <div class="rebase-row action-${escapeHtml(r.action)}" data-i="${i}" draggable="true">
        <span class="rebase-handle">≡</span>
        <select class="rebase-action" data-i="${i}">
          ${['pick','reword','edit','squash','fixup','drop'].map(a => `<option value="${a}" ${a === r.action ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <span class="rb-sha">${escapeHtml(r.hash.slice(0,7))}</span>
        <span class="rb-msg">${escapeHtml(r.message.split('\n')[0])}</span>
        <span class="rb-author">${escapeHtml(r.author || '')}</span>
      </div>
    `).join('');

    let dragIdx = null;
    $$('#rebase-list .rebase-row').forEach(el => {
      el.addEventListener('dragstart', () => { dragIdx = parseInt(el.dataset.i, 10); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('#rebase-list .rebase-row').forEach(x => x.classList.remove('drop-target')); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drop-target');
        const target = parseInt(el.dataset.i, 10);
        if (dragIdx == null || dragIdx === target) return;
        const [moved] = rows.splice(dragIdx, 1);
        rows.splice(target, 0, moved);
        dragIdx = null;
        renderRows();
      });
    });
    $$('#rebase-list .rebase-action').forEach(sel => {
      sel.onchange = () => {
        const i = parseInt(sel.dataset.i, 10);
        rows[i].action = sel.value;
        renderRows();
      };
    });
  };
  renderRows();
}

// Add "Interactive rebase from here" to commit context menu
const _origCommitContextMenu = commitContextMenu;
commitContextMenu = function (hash, x, y) {
  // Compose the original items, then append rebase
  const orig = state; // placeholder; we replicate by calling original and then patching
  // Easiest: just call original and let it open the menu, then patch is too complex.
  // Instead, reconstruct here with a single extra entry.
  const short = hash.slice(0, 7);
  const items = [
    { label: 'Copy SHA',            icon: '⧉', action: () => copyText(hash, `Copied ${short}`) },
    { label: 'Copy short SHA',      icon: '⧉', action: () => copyText(short, `Copied ${short}`) },
    { separator: true },
    { label: 'Create branch here…', icon: '⎇', action: () => openBranchFromCommitModal(hash) },
    { label: 'Tag this commit…',    icon: '▼', action: () => openTagModal(hash) },
    { separator: true },
    { label: 'Cherry-pick onto current', icon: '⟜', action: () => cherryPickCommit(hash) },
    { label: 'Revert this commit',  icon: '⤺', action: () => revertCommit(hash) },
    { separator: true },
    { label: 'Interactive rebase onto this commit…', icon: '⟳', action: () => openInteractiveRebaseModal(hash) },
    { separator: true },
    { label: 'Reset to here (soft — keep changes staged)',   icon: '◐', action: () => resetTo('soft', hash) },
    { label: 'Reset to here (mixed — keep unstaged)',        icon: '◑', action: () => resetTo('mixed', hash) },
    { label: 'Reset to here (hard — DISCARD changes)', icon: '◉', danger: true, action: () => resetTo('hard', hash, true) },
    { separator: true },
    { label: 'Reword…',  icon: '✎', action: () => openRewordModal(hash) },
  ];
  showContextMenu(x, y, items);
};

// (Palette extras now baked into the original items list above.)

// Settings: add protected branches + syntax + diff toggles
const _origOpenSettingsModal2 = openSettingsModal;
openSettingsModal = function () {
  _origOpenSettingsModal2();
  const body = $('#modal-body');
  if (!body) return;
  const extra = document.createElement('div');
  extra.innerHTML = `
    <hr style="border: none; border-top: 1px solid var(--line); margin: 14px 0;"/>
    <div class="settings-row">
      <div><div class="settings-label">Protected branches</div><div class="settings-sub">Comma-separated. Shows 🔒 in sidebar.</div></div>
      <input id="set-protected" value="${escapeHtml((state.settings.protectedBranches || []).join(', '))}"/>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">Syntax highlighting</div><div class="settings-sub">In read-only diff & file views.</div></div>
      <select id="set-syntax">
        <option value="true" ${state.settings.syntaxHighlight ? 'selected' : ''}>On</option>
        <option value="false" ${!state.settings.syntaxHighlight ? 'selected' : ''}>Off</option>
      </select>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">Default side-by-side diff</div><div class="settings-sub">Toggle on the diff toolbar too.</div></div>
      <select id="set-sxs">
        <option value="false" ${!state.settings.diffSideBySide ? 'selected' : ''}>Off</option>
        <option value="true" ${state.settings.diffSideBySide ? 'selected' : ''}>On</option>
      </select>
    </div>
  `;
  body.appendChild(extra);
  const okBtn = $('#modal-ok');
  const origOk = okBtn.onclick;
  okBtn.onclick = async (ev) => {
    state.settings.protectedBranches = ($('#set-protected').value || '').split(',').map(s => s.trim()).filter(Boolean);
    state.settings.syntaxHighlight = $('#set-syntax').value === 'true';
    state.settings.diffSideBySide = $('#set-sxs').value === 'true';
    if (origOk) await origOk(ev);
    markProtectedBranches();
  };
};
