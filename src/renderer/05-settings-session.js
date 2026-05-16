// ─────────────────────── Settings ───────────────────────
async function loadSettings() {
  const s = await window.api.settingsRead();
  if (s) state.settings = { ...state.settings, ...s };
  applySidebarSectionHeights();
  applyChangesSectionHeights();
  applyChangesCollapsed();
}

async function saveSettings() {
  await window.api.settingsWrite(state.settings);
}

$('#btn-settings').onclick = () => openSettingsModal();

const AVATAR_SOURCE_META = {
  github:   { name: 'GitHub',   hint: 'GitHub noreply email → github.com avatar' },
  gravatar: { name: 'Gravatar', hint: 'gravatar.com lookup by email md5' },
  initials: { name: 'Initials', hint: 'Offline colored letters (fallback)' },
};

function renderAvatarSourcesList() {
  // Ensure all known sources are present in the settings list (so the user can re-enable them).
  const present = new Set(state.settings.avatarSources.map(s => s.source));
  for (const k of Object.keys(AVATAR_SOURCE_META)) {
    if (!present.has(k)) state.settings.avatarSources.push({ source: k, enabled: false });
  }
  return state.settings.avatarSources.map((s, i) => {
    const meta = AVATAR_SOURCE_META[s.source] || { name: s.source, hint: '' };
    return `
      <div class="avatar-source-item" data-idx="${i}" draggable="true">
        <span class="avatar-source-handle" title="Drag to reorder">≡</span>
        <input type="checkbox" data-srcidx="${i}" ${s.enabled ? 'checked' : ''} />
        <span class="avatar-source-name">${escapeHtml(meta.name)}</span>
        <span class="avatar-source-hint">${escapeHtml(meta.hint)}</span>
      </div>
    `;
  }).join('');
}

function attachAvatarListHandlers() {
  const list = $('#avatar-source-list');
  if (!list) return;

  // checkbox toggle
  $$('#avatar-source-list input[type="checkbox"]').forEach(cb => {
    cb.onchange = () => {
      const idx = parseInt(cb.dataset.srcidx, 10);
      state.settings.avatarSources[idx].enabled = cb.checked;
    };
  });

  // drag & drop reorder
  let draggingIdx = null;
  $$('#avatar-source-list .avatar-source-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggingIdx = parseInt(item.dataset.idx, 10);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(draggingIdx)); } catch {}
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      $$('#avatar-source-list .avatar-source-item').forEach(x => x.classList.remove('drop-target'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      $$('#avatar-source-list .avatar-source-item').forEach(x => x.classList.remove('drop-target'));
      item.classList.add('drop-target');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIdx = parseInt(item.dataset.idx, 10);
      if (draggingIdx === null || draggingIdx === targetIdx) return;
      const arr = state.settings.avatarSources;
      const [moved] = arr.splice(draggingIdx, 1);
      arr.splice(targetIdx, 0, moved);
      draggingIdx = null;
      // re-render list in place
      list.innerHTML = renderAvatarSourcesList();
      attachAvatarListHandlers();
    });
  });
}

async function openSettingsModal() {
  const uc = state.user || { name: '', email: '' };
  modal({
    title: 'SETTINGS',
    body: `
      <div class="settings-row">
        <div>
          <div class="settings-label">Default remote</div>
          <div class="settings-sub">Used by Fetch / Pull / Push buttons.</div>
        </div>
        <input id="set-default-remote" value="${escapeHtml(state.settings.defaultRemote)}" />
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Graph max commits</div>
          <div class="settings-sub">How many commits to load in History.</div>
        </div>
        <input id="set-max-commits" type="number" min="50" max="5000" step="50" value="${state.settings.graphMaxCommits}" />
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Show avatars</div>
          <div class="settings-sub">For authors in History and Details.</div>
        </div>
        <select id="set-show-avatars">
          <option value="true" ${state.settings.showAvatars ? 'selected' : ''}>On</option>
          <option value="false" ${!state.settings.showAvatars ? 'selected' : ''}>Off</option>
        </select>
      </div>
      <label style="margin-top: 18px;">AVATAR SOURCES (drag to reorder)</label>
      <p style="font-size: 11px; color: var(--text-3); margin-bottom: 8px;">Tried in order, falling back when one isn't available.</p>
      <div class="avatar-source-list" id="avatar-source-list">${renderAvatarSourcesList()}</div>
      <div class="settings-row" style="margin-top: 18px;">
        <div>
          <div class="settings-label">Git user.name</div>
          <div class="settings-sub">Local repo, falls back to global.</div>
        </div>
        <input id="set-user-name" value="${escapeHtml(uc.name)}" />
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Git user.email</div>
          <div class="settings-sub">Used for commit authoring (and avatars).</div>
        </div>
        <input id="set-user-email" value="${escapeHtml(uc.email)}" />
      </div>
    `,
    okText: 'SAVE',
    onOk: async () => {
      state.settings.defaultRemote = $('#set-default-remote').value.trim() || 'origin';
      state.settings.graphMaxCommits = Math.max(50, parseInt($('#set-max-commits').value, 10) || 300);
      state.settings.showAvatars = $('#set-show-avatars').value === 'true';
      // avatarSources already mutated live by drag/checkbox handlers
      const name = $('#set-user-name').value.trim();
      const email = $('#set-user-email').value.trim();
      await saveSettings();
      if (state.repo) {
        await window.api.setUserConfig({ name, email, scope: 'local' });
        state.user = { name, email };
        $('#sb-user').textContent = name || 'Unknown pilot';
        await refreshLog();
      }
      renderEverything();
      toast('Settings saved', 'ok');
    },
  });
  attachAvatarListHandlers();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Feature additions: keyboard shortcuts, drag-drop folder, session,
//  commit context menu, tags, push opts, history search, multi-select,
//  blame / file history / reflog, theme/font, help, command palette,
//  external tools, recent branches, line numbers in edit, auto-fetch.
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────── Theme / font ───────────────────────
const THEMES = [
  { id: 'dva',       name: 'D.Va Purple' },
  { id: 'sunset',    name: 'Sunset' },
  { id: 'moonlight', name: 'Moonlight' },
  { id: 'oled',      name: 'OLED Black' },
  { id: 'light',     name: 'Blinding Light' },
];
function applyTheme() {
  // legacy values: 'dark' was the old default purple, 'light' kept as-is
  let t = state.settings.theme || 'dva';
  if (t === 'dark') t = 'dva';
  if (!THEMES.some(x => x.id === t)) t = 'dva';
  document.body.classList.remove('theme-light');
  document.body.dataset.theme = t;
  document.body.style.fontSize = (state.settings.fontSize || 13) + 'px';
}

// ─────────────────────── External-tool toolbar buttons ───────────────────────
function _withRepoPath(fn) {
  return () => {
    if (!state.repo) { toast('No repository open', 'warn'); return; }
    fn(state.repo.path);
  };
}
$('#btn-open-folder').onclick = _withRepoPath(async (p) => {
  const r = await window.api.openPath(p);
  if (!r.ok) toast(r.error, 'error');
});
$('#btn-open-terminal').onclick = _withRepoPath(async (p) => {
  const r = await window.api.openTerminal(p);
  if (!r.ok) toast(r.error, 'error');
});
$('#btn-open-vscode').onclick = _withRepoPath(async (p) => {
  const r = await window.api.openInVSCode(p);
  if (!r.ok) toast(r.error, 'error');
});

// ─────────────────────── Notifications ───────────────────────
function notifyDone(title, body) {
  if (!state.settings.notifyOnComplete) return;
  try { window.api.notify({ title, body }); } catch {}
}

// ─────────────────────── Copy helpers ───────────────────────
async function copyText(text, label = 'Copied') {
  const r = await window.api.copy(text);
  if (r.ok) toast(`${label}`, 'ok', 1600);
  else toast(r.error, 'error');
}

// ─────────────────────── Session persistence ───────────────────────
async function persistSession() {
  try {
    await window.api.sessionWrite({
      openRepos: state.openRepos,
      activeRepoIndex: state.activeRepoIndex,
    });
  } catch {}
}

async function restoreSession() {
  try {
    const s = await window.api.sessionRead();
    if (!s || !Array.isArray(s.openRepos) || s.openRepos.length === 0) return false;
    // Try opening each (skip ones that no longer exist)
    const good = [];
    let firstRepo = null;
    for (const r of s.openRepos) {
      const opened = await window.api.openRepo(r.path);
      if (opened.ok) {
        good.push({ path: opened.path, name: opened.name });
        if (!firstRepo) firstRepo = opened;
      }
    }
    if (good.length === 0) return false;
    state.openRepos = good;
    state.activeRepoIndex = Math.min(s.activeRepoIndex ?? 0, good.length - 1);
    // Open whichever is the active one
    const activePath = good[state.activeRepoIndex]?.path;
    if (activePath) {
      const r = await window.api.openRepo(activePath);
      if (r.ok) await enterRepo(r);
    } else {
      await enterRepo(firstRepo);
    }
    return true;
  } catch { return false; }
}

// ─────────────────────── Drag-drop folder onto window ───────────────────────
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  // Electron exposes the absolute path on .path
  const p = f.path;
  if (p) await openRepoPath(p);
});

// ─────────────────────── Tab middle-click + indicator updates ───────────────────────
function refreshTabIndicators() {
  const tabs = $$('#repo-tabs-strip .repo-tab');
  tabs.forEach((el) => {
    const i = parseInt(el.dataset.idx, 10);
    if (i === state.activeRepoIndex) {
      el.classList.toggle('dirty', !!state.tabDirty);
      // Stamp counts
      let counts = el.querySelector('.repo-tab-counts');
      if (!counts) {
        counts = document.createElement('span');
        counts.className = 'repo-tab-counts';
        el.insertBefore(counts, el.querySelector('.repo-tab-close'));
      }
      const ahead = state.status?.ahead || 0;
      const behind = state.status?.behind || 0;
      counts.textContent = (ahead || behind) ? `↑${ahead} ↓${behind}` : '';
    }
  });
}

// Hook into renderRepoTabs to also add middle-click close
const _origRenderRepoTabs = renderRepoTabs;
renderRepoTabs = function () {
  _origRenderRepoTabs();
  $$('#repo-tabs-strip .repo-tab').forEach(el => {
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx, 10);
        closeRepoTab(idx);
      }
    });
  });
  refreshTabIndicators();
  persistSession();
};

// Wrap renderCenterHeader to also update tab indicators
const _origRenderCenterHeader = renderCenterHeader;
renderCenterHeader = function () {
  _origRenderCenterHeader();
  refreshTabIndicators();
  updateLocalOnlyCounter();
};

// ─────────────────────── Local-only commits counter (commit box) ───────────────────────
function updateLocalOnlyCounter() {
  const el = $('#commit-box-counter');
  if (!el) return;
  const ahead = state.status?.ahead || 0;
  el.textContent = ahead ? `↑${ahead} unpushed` : '';
}

// ─────────────────────── History search ───────────────────────
function applyHistorySearchFilter(rows) {
  const q = $('#history-search')?.value.trim().toLowerCase();
  const field = $('#history-search-field')?.value || 'any';
  if (!q) return rows;
  const test = (r) => {
    const c = r.commit;
    if (field === 'message') return (c.message || '').toLowerCase().includes(q);
    if (field === 'author') return ((c.author_name || '') + ' ' + (c.author_email || '')).toLowerCase().includes(q);
    if (field === 'hash') return (c.hash || '').toLowerCase().startsWith(q);
    // any
    return (
      (c.message || '').toLowerCase().includes(q) ||
      ((c.author_name || '') + ' ' + (c.author_email || '')).toLowerCase().includes(q) ||
      (c.hash || '').toLowerCase().startsWith(q)
    );
  };
  return rows.filter(test);
}

// Wrap renderGraph to apply the search and right-click context menu
const _origRenderGraph = renderGraph;
renderGraph = function () {
  // Build all rows, then filter
  const body = $('#graph-body');
  if (!state.commits || state.commits.length === 0) {
    body.innerHTML = '<div class="empty-state"><div class="empty-state-icon">♥</div><div class="empty-state-title">No commits yet</div><div>Stage some files and make your first commit.</div><button class="empty-state-cta" id="empty-go-changes">Open Changes</button></div>';
    const cta = $('#empty-go-changes');
    if (cta) cta.onclick = () => switchRightTab('changes');
    return;
  }
  _origRenderGraph();
  // Now filter visible rows by search (DOM-level filter to preserve lane assignment)
  const q = $('#history-search')?.value.trim().toLowerCase();
  const field = $('#history-search-field')?.value || 'any';
  let shown = 0;
  $$('#graph-body .graph-row').forEach(row => {
    const hash = row.dataset.hash;
    const c = state.commits.find(c => c.hash === hash);
    if (!c) return;
    let match = !q;
    if (q) {
      if (field === 'message') match = (c.message || '').toLowerCase().includes(q);
      else if (field === 'author') match = ((c.author_name || '') + ' ' + (c.author_email || '')).toLowerCase().includes(q);
      else if (field === 'hash') match = (c.hash || '').toLowerCase().startsWith(q);
      else match = (c.message || '').toLowerCase().includes(q)
        || ((c.author_name || '') + ' ' + (c.author_email || '')).toLowerCase().includes(q)
        || (c.hash || '').toLowerCase().startsWith(q);
    }
    row.style.display = match ? '' : 'none';
    if (match) shown++;
    row.oncontextmenu = (e) => {
      e.preventDefault();
      commitContextMenu(hash, e.clientX, e.clientY);
    };
  });
  const cnt = $('#history-count');
  if (cnt) cnt.textContent = q ? `${shown} / ${state.commits.length}` : '';
};

// Wire search inputs
$('#history-search')?.addEventListener('input', () => renderGraph());
$('#history-search-field')?.addEventListener('change', () => renderGraph());
$('#history-search-clear')?.addEventListener('click', () => {
  $('#history-search').value = '';
  renderGraph();
});

// ─────────────────────── Commit context menu ───────────────────────
function commitContextMenu(hash, x, y) {
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
    { label: 'Reset to here (soft — keep changes staged)',   icon: '◐', action: () => resetTo('soft', hash) },
    { label: 'Reset to here (mixed — keep unstaged)',        icon: '◑', action: () => resetTo('mixed', hash) },
    { label: 'Reset to here (hard — DISCARD changes)', icon: '◉', danger: true, action: () => resetTo('hard', hash, true) },
    { separator: true },
    { label: 'Reword (only HEAD)',  icon: '✎', action: () => openRewordModal(hash) },
  ];
  showContextMenu(x, y, items);
}

function openBranchFromCommitModal(hash) {
  modal({
    title: `NEW BRANCH AT ${hash.slice(0,7)}`,
    body: `<label>BRANCH NAME</label><input id="modal-newbranch-name" placeholder="feature/from-this-commit" />`,
    okText: 'CREATE',
    onOk: async () => {
      const name = $('#modal-newbranch-name').value.trim();
      if (!name) { toast('Name required', 'warn'); return false; }
      const r = await window.api.branchFromCommit({ name, hash });
      if (r.ok) { toast(`Branch ${name} created`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

function openTagModal(ref) {
  modal({
    title: ref ? `TAG @ ${ref.slice(0,7)}` : 'NEW TAG',
    body: `
      <label>TAG NAME</label>
      <input id="modal-tag-name" placeholder="v1.0.0" />
      <label>MESSAGE (annotated if non-empty)</label>
      <input id="modal-tag-msg" placeholder="Release notes" />
      <label class="checkbox-row"><input type="checkbox" id="modal-tag-force"/> Force (overwrite existing)</label>
      <label class="checkbox-row"><input type="checkbox" id="modal-tag-push" checked/> Push tag after creating</label>
    `,
    okText: 'CREATE TAG',
    onOk: async () => {
      const name = $('#modal-tag-name').value.trim();
      if (!name) { toast('Tag name required', 'warn'); return false; }
      const message = $('#modal-tag-msg').value.trim();
      const force = $('#modal-tag-force').checked;
      const push = $('#modal-tag-push').checked;
      const r = await window.api.tagCreate({ name, ref: ref || null, message: message || null, force });
      if (!r.ok) { toast(r.error, 'error'); return false; }
      toast(`Tag ${name} created`, 'ok');
      if (push) {
        const pr = await window.api.tagPush({ remote: state.settings.defaultRemote, tag: name });
        if (pr.ok) toast(`Tag ${name} pushed`, 'ok');
        else toast(`Tag push failed: ${pr.error}`, 'error');
      }
      await refreshAll();
    },
  });
}

async function cherryPickCommit(hash) {
  setStatus('Cherry-picking…', 'busy');
  const r = await window.api.cherryPick(hash);
  await refreshAll();
  if (r.ok) {
    toast(`Cherry-picked ${hash.slice(0,7)}`, 'ok');
    notifyDone('Cherry-picked', hash.slice(0,7));
  } else if (_isConflictError(r.error) || (state.status?.conflicted?.length || 0) > 0) {
    toast(`Cherry-pick stopped — resolve conflicts to continue.`, 'warn', 5000);
  } else {
    toast(r.error, 'error'); setStatus('Idle', 'error');
  }
}

async function revertCommit(hash) {
  modal({
    title: `REVERT ${hash.slice(0,7)}`,
    body: `<p>Create a new commit that undoes this one.</p>
      <label class="checkbox-row"><input type="checkbox" id="modal-revert-nocommit"/> Leave changes staged (no commit)</label>`,
    okText: 'REVERT',
    onOk: async () => {
      const noCommit = $('#modal-revert-nocommit').checked;
      setStatus('Reverting…', 'busy');
      const r = await window.api.revertCommit({ hash, noCommit });
      await refreshAll();
      if (r.ok) { toast(`Reverted ${hash.slice(0,7)}`, 'ok'); return; }
      if (_isConflictError(r.error) || (state.status?.conflicted?.length || 0) > 0) {
        toast(`Revert stopped — resolve conflicts to continue.`, 'warn', 5000);
        return;
      }
      toast(r.error, 'error'); setStatus('Idle', 'error');
      return false;
    },
  });
}

async function resetTo(mode, hash, confirmFirst = false) {
  const doIt = async () => {
    setStatus('Resetting…', 'busy');
    const r = await window.api.resetTo({ mode, hash });
    if (r.ok) { toast(`Reset (${mode}) to ${hash.slice(0,7)}`, 'ok'); await refreshAll(); }
    else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
  };
  if (confirmFirst) {
    modal({
      title: `HARD RESET TO ${hash.slice(0,7)}?`,
      body: `<p style="color: var(--err);">This will discard <strong>all</strong> uncommitted changes. There is no undo.</p>`,
      okText: 'HARD RESET',
      onOk: doIt,
    });
  } else doIt();
}

function openRewordModal(hash) {
  const c = state.commits.find(c => c.hash === hash);
  const orig = c?.message || '';
  modal({
    title: `REWORD ${hash.slice(0,7)}`,
    body: `
      <p style="font-size: 11px; color: var(--text-3);">Only the most recent commit can be reworded inline. For older commits, use an interactive rebase.</p>
      <label>NEW MESSAGE</label>
      <textarea id="modal-reword-msg" style="min-height: 100px;">${escapeHtml(orig)}</textarea>
    `,
    okText: 'REWORD',
    onOk: async () => {
      const message = $('#modal-reword-msg').value.trim();
      if (!message) { toast('Message required', 'warn'); return false; }
      const r = await window.api.reword({ hash, message });
      if (r.ok) { toast('Reworded', 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

// ─────────────────────── Toolbar buttons for Tag / Compare ───────────────────────
$('#btn-tag').onclick = () => {
  if (!state.repo) { toast('No repo open', 'warn'); return; }
  openTagModal(null);
};
$('#add-tag-btn').onclick = () => openTagModal(null);

$('#btn-compare').onclick = () => openCompareRefsModal();

// ─────────────────────── Push options modal ───────────────────────
function openPushOptionsModal() {
  modal({
    title: 'PUSH OPTIONS',
    body: `
      <label>REMOTE</label>
      <input id="modal-push-remote" value="${escapeHtml(state.settings.defaultRemote)}"/>
      <label>BRANCH (blank = current)</label>
      <input id="modal-push-branch" placeholder="${escapeHtml(state.status?.current || '')}"/>
      <label class="checkbox-row"><input type="checkbox" id="modal-push-upstream"/> Set upstream (-u)</label>
      <label class="checkbox-row"><input type="checkbox" id="modal-push-tags"/> Push tags (--tags)</label>
      <label class="checkbox-row"><input type="checkbox" id="modal-push-lease"/> Force with lease (--force-with-lease)</label>
      <label class="checkbox-row"><input type="checkbox" id="modal-push-force"/> Force (--force) <span style="color: var(--err);">⚠ destructive</span></label>
    `,
    okText: 'PUSH',
    onOk: async () => {
      setStatus('Pushing…', 'busy');
      const r = await window.api.pushOpts({
        remote: $('#modal-push-remote').value.trim() || 'origin',
        branch: $('#modal-push-branch').value.trim() || null,
        setUpstream: $('#modal-push-upstream').checked,
        pushTags: $('#modal-push-tags').checked,
        forceLease: $('#modal-push-lease').checked,
        force: $('#modal-push-force').checked,
      });
      if (r.ok) { toast('Pushed', 'ok'); await refreshAll(); notifyDone('Pushed', state.repo?.name || ''); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); return false; }
    },
  });
}

// Override the push button to use the options modal when shift held; default plain push otherwise.
$('#btn-push').onclick = async (e) => {
  if (e.shiftKey) return openPushOptionsModal();
  setStatus('Pushing...', 'busy');
  const r = await window.api.pushOpts({ remote: state.settings.defaultRemote });
  if (r.ok) { toast('Pushed! ♥', 'ok'); await refreshAll(); notifyDone('Pushed', state.repo?.name || ''); return; }

  if (/no upstream branch|set-upstream|--set-upstream|has no upstream/i.test(r.error || '')) {
    setStatus('Idle');
    const branch = state.status?.current || '';
    const remote = state.settings.defaultRemote || 'origin';
    modal({
      title: 'NO UPSTREAM CONFIGURED',
      body: `<p>The branch <strong>${escapeHtml(branch)}</strong> has no upstream. Publish it by pushing with <code>--set-upstream</code>?</p>
        <label>REMOTE</label>
        <input id="modal-pubu-remote" value="${escapeHtml(remote)}"/>
        <label>UPSTREAM BRANCH NAME</label>
        <input id="modal-pubu-branch" value="${escapeHtml(branch)}"/>`,
      okText: 'PUBLISH (–u)',
      onOk: async () => {
        const remoteN = $('#modal-pubu-remote').value.trim() || 'origin';
        const branchN = $('#modal-pubu-branch').value.trim() || branch;
        setStatus('Pushing –u…', 'busy');
        const r2 = await window.api.pushOpts({ remote: remoteN, branch: branchN, setUpstream: true });
        if (r2.ok) {
          toast(`Published to ${remoteN}/${branchN}`, 'ok');
          await refreshAll();
          notifyDone('Published', `${remoteN}/${branchN}`);
        } else {
          toast(r2.error, 'error'); setStatus('Idle', 'error');
          return false;
        }
      },
    });
    return;
  }

  toast(r.error, 'error'); setStatus('Idle', 'error');
};
$('#btn-push').title = 'Push (Shift+click for options)';
