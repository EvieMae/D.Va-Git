// ─────────────────────── Git Actions ───────────────────────
async function stageFiles(files) {
  const r = await window.api.stage(files);
  if (r.ok) { await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
}
async function unstageFiles(files) {
  const r = await window.api.unstage(files);
  if (r.ok) { await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
}
async function discardFile(file) {
  modal({
    title: 'DISCARD CHANGES',
    body: `<p>Discard local changes to <strong style="color: var(--pink-soft);">${escapeHtml(file)}</strong>? This cannot be undone.</p>`,
    okText: 'DISCARD',
    onOk: async () => {
      const r = await window.api.discardFile(file);
      if (r.ok) {
        toast('Changes discarded', 'ok');
        await refreshStatus(); renderChanges(); renderCenterHeader();
      } else toast(r.error, 'error');
    },
  });
}

$('#stage-all-btn').onclick = async () => {
  const r = await window.api.stage('.');
  if (r.ok) { await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
};
$('#unstage-all-btn').onclick = async () => {
  const staged = (state.status?.files || []).filter(f => f.index && f.index !== ' ' && f.index !== '?').map(f => f.path);
  if (staged.length === 0) return;
  const r = await window.api.unstage(staged);
  if (r.ok) { await refreshStatus(); renderChanges(); renderCenterHeader(); }
  else toast(r.error, 'error');
};

$('#commit-btn').onclick = async () => {
  const summary = $('#commit-msg').value.trim();
  const desc = $('#commit-desc').value.trim();
  const amend = $('#amend-check').checked;
  if (!summary && !amend) { toast('Commit message required', 'warn'); return; }
  const fullMsg = desc ? `${summary}\n\n${desc}` : summary;
  setStatus('Committing...', 'busy');
  const r = await window.api.commit({ message: fullMsg, amend });
  if (r.ok) {
    toast('Committed.', 'ok');
    $('#commit-msg').value = '';
    $('#commit-desc').value = '';
    $('#amend-check').checked = false;
    await refreshAll();
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
};

$('#amend-check').onchange = () => renderChanges();

// ─────────────────────── Titlebar buttons ───────────────────────
$('#btn-fetch').onclick = async () => {
  setStatus('Fetching...', 'busy');
  const r = await window.api.fetch({ remote: state.settings.defaultRemote });
  if (r.ok) { toast(`Fetched from ${state.settings.defaultRemote}`, 'ok'); await refreshAll(); }
  else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
};
$('#btn-pull').onclick = async () => {
  setStatus('Pulling...', 'busy');
  const r = await window.api.pull({ remote: state.settings.defaultRemote });
  await refreshAll();
  if (r.ok) { toast('Pulled successfully', 'ok'); return; }
  if ((typeof _isConflictError === 'function' && _isConflictError(r.error)) || (state.status?.conflicted?.length || 0) > 0) {
    toast('Pull stopped — resolve conflicts to continue.', 'warn', 5000);
    return;
  }
  toast(r.error, 'error'); setStatus('Idle', 'error');
};
$('#btn-push').onclick = async () => {
  setStatus('Pushing...', 'busy');
  const r = await window.api.push({ remote: state.settings.defaultRemote });
  if (r.ok) { toast('Pushed! ♥', 'ok'); await refreshAll(); }
  else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
};

$('#btn-branch').onclick = () => openNewBranchModal();
$('#add-branch-btn').onclick = () => openNewBranchModal();

function openNewBranchModal() {
  modal({
    title: 'CREATE BRANCH',
    body: `
      <label>BRANCH NAME</label>
      <input id="modal-branch-name" placeholder="feature/new-mech" />
      <p style="margin-top: 10px; font-size: 11px;">Branches from the current HEAD and checks out immediately.</p>
    `,
    okText: 'CREATE',
    onOk: async () => {
      const name = $('#modal-branch-name').value.trim();
      if (!name) { toast('Name required', 'warn'); return false; }
      const r = await window.api.createBranch(name);
      if (r.ok) { toast(`Branch "${name}" created`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

// Stash button: stashes the staged files if any are staged, otherwise stashes everything
$('#btn-stash').onclick = () => stashFlow();
$('#add-stash-btn').onclick = () => stashFlow();

function stashFlow() {
  const stagedCount = (state.status?.files || []).filter(f => f.index && f.index !== ' ' && f.index !== '?').length;
  const hasStaged = stagedCount > 0;
  modal({
    title: hasStaged ? 'STASH STAGED FILES' : 'STASH CHANGES',
    body: `
      <label>MESSAGE (optional)</label>
      <input id="modal-stash-msg" placeholder="WIP: dive bomb refactor" />
      ${hasStaged
        ? `<label class="checkbox-row" style="margin-top: 14px;">
             <input type="checkbox" id="modal-stash-staged-only" checked />
             Only stash staged files (${stagedCount})
           </label>`
        : '<p style="margin-top: 10px; font-size: 11px; color: var(--text-3);">No staged files — will stash everything.</p>'
      }
    `,
    okText: 'STASH',
    onOk: async () => {
      const msg = $('#modal-stash-msg').value.trim();
      const stagedOnly = hasStaged && $('#modal-stash-staged-only')?.checked;
      const r = stagedOnly
        ? await window.api.stashStaged(msg || null)
        : await window.api.stash(msg || null);
      if (r.ok) { toast('Stashed ★', 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

$('#btn-pop').onclick = async () => {
  if (!state.stashes.length) { toast('No stashes to pop', 'warn'); return; }
  const r = await window.api.stashPop();
  if (r.ok) { toast('Stash popped', 'ok'); await refreshAll(); }
  else toast(r.error, 'error');
};

// ─────────────────────── Branch context menu ───────────────────────
function branchContextMenu(branch, x, y) {
  const items = [
    { label: 'Show history', icon: '⌖', action: () => filterHistoryBy(branch) },
    { label: 'Checkout', icon: '▶', action: () => switchBranch(branch) },
    { label: 'Merge into current', icon: '⎇', action: async () => {
      const r = await window.api.merge(branch);
      if (r.ok) { toast(`Merged ${branch}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { label: 'Rebase current onto this', icon: '⤴', action: async () => {
      const r = await window.api.rebase(branch);
      if (r.ok) { toast(`Rebased onto ${branch}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { label: 'Rename...', icon: '✎', action: () => openRenameBranchModal(branch) },
    { separator: true },
    { label: 'Push branch', icon: '↑', action: async () => {
      const r = await window.api.push({ remote: state.settings.defaultRemote, branch });
      if (r.ok) toast(`Pushed ${branch}`, 'ok');
      else toast(r.error, 'error');
    } },
    { separator: true },
    { label: 'Delete branch', icon: '✕', danger: true, action: async () => {
      const r = await window.api.deleteBranch({ name: branch, force: false });
      if (r.ok) { toast(`Deleted ${branch}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
  ];
  showContextMenu(x, y, items);
}

function openRenameBranchModal(branch) {
  modal({
    title: `RENAME BRANCH — ${branch}`,
    body: `
      <label>NEW NAME</label>
      <input id="modal-branch-newname" value="${escapeHtml(branch)}" />
    `,
    okText: 'RENAME',
    onOk: async () => {
      const to = $('#modal-branch-newname').value.trim();
      if (!to || to === branch) return false;
      const r = await window.api.renameBranch({ from: branch, to });
      if (r.ok) { toast(`Renamed to ${to}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

function remoteBranchContextMenu(branch, x, y) {
  const items = [
    { label: 'Show history', icon: '⌖', action: () => filterHistoryBy(branch) },
    { label: 'Checkout (track)', icon: '▶', action: async () => {
      const local = branch.split('/').slice(1).join('/');
      const r = await window.api.checkout(local);
      if (r.ok) { toast(`On branch ${local}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { label: 'Merge into current', icon: '⎇', action: async () => {
      const r = await window.api.merge(branch);
      if (r.ok) { toast(`Merged ${branch}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
  ];
  showContextMenu(x, y, items);
}

async function switchBranch(branch) {
  setStatus('Checking out...', 'busy');
  const r = await window.api.checkout(branch);
  if (r.ok) { toast(`On branch ${branch}`, 'ok'); await refreshAll(); }
  else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
}

// ─────────────────────── Stash context menu ───────────────────────
function stashContextMenu(idx, x, y) {
  const items = [
    { label: 'Apply', icon: '▶', action: async () => {
      const r = await window.api.stashApply(idx);
      if (r.ok) { toast('Stash applied', 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { label: 'Pop (apply + drop)', icon: '☆', action: async () => {
      const r = await window.api.stashPop();
      if (r.ok) { toast('Stash popped', 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { separator: true },
    { label: 'Drop', icon: '✕', danger: true, action: async () => {
      const r = await window.api.stashDrop(idx);
      if (r.ok) { toast('Stash dropped', 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
  ];
  showContextMenu(x, y, items);
}

function stashContextMenuFromClick(idx) {
  // For left-click, just open the modal-based menu at current mouse
  const rect = document.body.getBoundingClientRect();
  stashContextMenu(idx, window.event?.clientX || 200, window.event?.clientY || 200);
}

// ─────────────────────── Remote context menu ───────────────────────
function remoteContextMenu(remoteName, x, y) {
  const items = [
    { label: 'Fetch', icon: '⟲', action: async () => {
      setStatus('Fetching...', 'busy');
      const r = await window.api.fetch({ remote: remoteName });
      if (r.ok) { toast(`Fetched ${remoteName}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
    } },
    { label: 'Pull', icon: '↓', action: async () => {
      setStatus('Pulling...', 'busy');
      const r = await window.api.pull({ remote: remoteName });
      if (r.ok) { toast(`Pulled ${remoteName}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
    } },
    { label: 'Push', icon: '↑', action: async () => {
      setStatus('Pushing...', 'busy');
      const r = await window.api.push({ remote: remoteName });
      if (r.ok) { toast(`Pushed to ${remoteName}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
    } },
    { separator: true },
    { label: 'Edit URL...', icon: '✎', action: () => openEditRemoteModal(remoteName) },
    { label: 'Rename...', icon: '↔', action: () => openRenameRemoteModal(remoteName) },
    { label: 'Set as default', icon: '★', action: async () => {
      state.settings.defaultRemote = remoteName;
      await window.api.settingsWrite(state.settings);
      toast(`Default remote: ${remoteName}`, 'ok');
    } },
    { separator: true },
    { label: 'Manage all remotes...', icon: '☁', action: () => openRemotesManager() },
    { separator: true },
    { label: 'Remove', icon: '✕', danger: true, action: async () => {
      modal({
        title: 'REMOVE REMOTE',
        body: `<p>Remove remote <strong>${escapeHtml(remoteName)}</strong>? Local branches are not affected.</p>`,
        okText: 'REMOVE',
        onOk: async () => {
          const r = await window.api.remoteRemove(remoteName);
          if (r.ok) { toast(`Removed ${remoteName}`, 'ok'); await refreshAll(); }
          else { toast(r.error, 'error'); return false; }
        },
      });
    } },
  ];
  showContextMenu(x, y, items);
}

// ─────────────────────── Remotes management ───────────────────────
$('#add-remote-btn').onclick = (e) => {
  e.stopPropagation();
  openAddRemoteModal();
};

function openAddRemoteModal() {
  modal({
    title: 'ADD REMOTE',
    body: `
      <label>NAME</label>
      <input id="modal-remote-name" placeholder="upstream" />
      <label>URL</label>
      <input id="modal-remote-url" placeholder="https://github.com/user/repo.git" />
    `,
    okText: 'ADD',
    onOk: async () => {
      const name = $('#modal-remote-name').value.trim();
      const url = $('#modal-remote-url').value.trim();
      if (!name || !url) { toast('Name and URL required', 'warn'); return false; }
      const r = await window.api.remoteAdd({ name, url });
      if (r.ok) { toast(`Added remote ${name}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

function openEditRemoteModal(remoteName) {
  const existing = state.remotes.find(r => r.name === remoteName);
  const url = existing?.refs?.push || existing?.refs?.fetch || '';
  modal({
    title: `EDIT REMOTE — ${remoteName}`,
    body: `
      <label>URL</label>
      <input id="modal-remote-url" value="${escapeHtml(url)}" />
    `,
    okText: 'SAVE',
    onOk: async () => {
      const newUrl = $('#modal-remote-url').value.trim();
      if (!newUrl) { toast('URL required', 'warn'); return false; }
      const r = await window.api.remoteSetUrl({ name: remoteName, url: newUrl });
      if (r.ok) { toast('Remote URL updated', 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

function openRenameRemoteModal(remoteName) {
  modal({
    title: `RENAME REMOTE — ${remoteName}`,
    body: `
      <label>NEW NAME</label>
      <input id="modal-remote-newname" value="${escapeHtml(remoteName)}" />
    `,
    okText: 'RENAME',
    onOk: async () => {
      const newName = $('#modal-remote-newname').value.trim();
      if (!newName || newName === remoteName) return false;
      const r = await window.api.remoteRename({ from: remoteName, to: newName });
      if (r.ok) { toast('Remote renamed', 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); return false; }
    },
  });
}

function openRemotesManager() {
  const rows = state.remotes.map(r => {
    const url = r.refs?.push || r.refs?.fetch || '';
    return `
      <div class="remote-row" data-name="${escapeHtml(r.name)}">
        <span class="remote-row-name">${escapeHtml(r.name)}</span>
        <span class="remote-row-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
        <span class="remote-row-actions">
          <button class="remote-row-btn" data-act="edit">Edit</button>
          <button class="remote-row-btn" data-act="rename">Rename</button>
          <button class="remote-row-btn danger" data-act="remove">Remove</button>
        </span>
      </div>
    `;
  }).join('') || '<p style="color: var(--text-3);">No remotes configured.</p>';

  modal({
    title: 'MANAGE REMOTES',
    body: `
      <div id="remotes-manager-list">${rows}</div>
      <button class="csh-action" style="margin-top: 14px;" id="modal-add-remote">+ Add remote</button>
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });

  $('#modal-add-remote').onclick = () => {
    $('#modal-backdrop').classList.add('hidden');
    openAddRemoteModal();
  };

  $$('#remotes-manager-list .remote-row').forEach(row => {
    const name = row.dataset.name;
    row.querySelectorAll('.remote-row-btn').forEach(btn => {
      btn.onclick = () => {
        $('#modal-backdrop').classList.add('hidden');
        const act = btn.dataset.act;
        if (act === 'edit') openEditRemoteModal(name);
        else if (act === 'rename') openRenameRemoteModal(name);
        else if (act === 'remove') {
          modal({
            title: 'REMOVE REMOTE',
            body: `<p>Remove remote <strong>${escapeHtml(name)}</strong>?</p>`,
            okText: 'REMOVE',
            onOk: async () => {
              const r = await window.api.remoteRemove(name);
              if (r.ok) { toast(`Removed ${name}`, 'ok'); await refreshAll(); }
              else { toast(r.error, 'error'); return false; }
            },
          });
        }
      };
    });
  });
}

// ─────────────────────── Tabs ───────────────────────
function switchCenterTab(t) {
  state.activeCenterTab = t;
  $$('.center-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  $$('#tab-history, #tab-files, #tab-editor').forEach(p => {
    const id = p.id;
    p.classList.toggle('hidden', !(
      (t === 'history' && id === 'tab-history') ||
      (t === 'files' && id === 'tab-files') ||
      (t === 'editor' && id === 'tab-editor')
    ));
  });
  if (t === 'files') renderFilesTree();
}

$$('.center-tab').forEach(tab => {
  tab.onclick = (e) => {
    if (e.target.classList.contains('tab-close')) return;
    switchCenterTab(tab.dataset.tab);
  };
});

function switchRightTab(t) {
  state.activeRightTab = t;
  $$('.inspector-tab').forEach(x => x.classList.toggle('active', x.dataset.rtab === t));
  $$('#rtab-details, #rtab-changes').forEach(p => {
    p.classList.toggle('hidden', !p.id.endsWith(t));
  });
}

$$('.inspector-tab').forEach(tab => {
  tab.onclick = () => switchRightTab(tab.dataset.rtab);
});

$('#nav-changes').onclick = () => switchRightTab('changes');
$('#nav-history').onclick = () => switchCenterTab('history');
$('#nav-files').onclick = () => switchCenterTab('files');

// ─────────────────────── Splitters (pane widths) ───────────────────────
function setupSplitters() {
  const app = $('#app');
  const updateGrid = () => {
    app.style.gridTemplateColumns =
      `${state.settings.sidebarWidth}px 5px minmax(0, 1fr) 5px ${state.settings.rightPaneWidth}px`;
  };
  updateGrid();

  const startDrag = (which) => (e) => {
    e.preventDefault();
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => {
      if (which === 'sidebar') {
        const w = Math.max(180, Math.min(480, ev.clientX));
        state.settings.sidebarWidth = w;
      } else {
        const w = Math.max(280, Math.min(900, window.innerWidth - ev.clientX));
        state.settings.rightPaneWidth = w;
      }
      updateGrid();
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveSettings();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  $('#splitter-sidebar').addEventListener('mousedown', startDrag('sidebar'));
  $('#splitter-right').addEventListener('mousedown', startDrag('right'));
}

// ─────────────────────── Sidebar section resizing ───────────────────────
function setupSidebarSectionResizers() {
  $$('.sidebar-section-resizer').forEach(handle => {
    const key = handle.dataset.resizer;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const section = handle.parentElement;
      const startY = e.clientY;
      const startH = section.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        const newH = Math.max(60, Math.min(500, startH + dy));
        document.documentElement.style.setProperty(`--h-${key}`, `${newH}px`);
        state.settings.sectionHeights[key] = newH;
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveSettings();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function applySidebarSectionHeights() {
  Object.entries(state.settings.sectionHeights).forEach(([k, v]) => {
    document.documentElement.style.setProperty(`--h-${k}`, `${v}px`);
  });
}

function applyChangesSectionHeights() {
  const h = state.settings.changesSectionHeights || {};
  Object.entries(h).forEach(([k, v]) => {
    document.documentElement.style.setProperty(`--h-changes-${k}`, `${v}px`);
  });
}

function applyChangesCollapsed() {
  const c = state.settings.changesCollapsed || {};
  ['unstaged', 'staged'].forEach(k => {
    const el = document.querySelector(`.changes-section[data-section="${k}"]`);
    if (el) el.classList.toggle('collapsed', !!c[k]);
  });
  const cb = document.querySelector('.commit-box');
  if (cb) cb.classList.toggle('collapsed', !!c.commit);
}

function setupChangesSectionResizers() {
  document.querySelectorAll('#rtab-changes .changes-section-resizer').forEach(handle => {
    const key = handle.dataset.resizer;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Don't allow resizing collapsed sections (visibility hidden, but be safe)
      if (state.settings.changesCollapsed?.[key]) return;
      const section = key === 'commit'
        ? document.querySelector('.commit-box')
        : document.querySelector(`.changes-section[data-section="${key}"]`);
      if (!section) return;
      const startY = e.clientY;
      const startH = section.getBoundingClientRect().height;
      // For commit (last section, top resizer) dragging up should grow it
      const dir = key === 'commit' ? -1 : 1;
      document.body.style.cursor = 'row-resize';
      const onMove = (ev) => {
        const dy = (ev.clientY - startY) * dir;
        const newH = Math.max(60, Math.min(900, startH + dy));
        if (!state.settings.changesSectionHeights) state.settings.changesSectionHeights = {};
        state.settings.changesSectionHeights[key] = newH;
        document.documentElement.style.setProperty(`--h-changes-${key}`, `${newH}px`);
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveSettings();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function setupChangesCollapseToggles() {
  document.querySelectorAll('#rtab-changes [data-collapse-target]').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle when clicking buttons / inputs inside the header
      if (e.target.closest('button, input, select, textarea, a')) return;
      const key = header.dataset.collapseTarget;
      if (!state.settings.changesCollapsed) state.settings.changesCollapsed = {};
      state.settings.changesCollapsed[key] = !state.settings.changesCollapsed[key];
      applyChangesCollapsed();
      saveSettings();
    });
  });
}
