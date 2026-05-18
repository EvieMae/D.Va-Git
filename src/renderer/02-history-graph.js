// ─────────────────────── Refresh ───────────────────────
async function refreshAll() {
  setStatus('Refreshing...', 'busy');
  await Promise.all([
    refreshStatus(),
    refreshBranches(),
    refreshRemotes(),
    refreshTags(),
    refreshStashes(),
    refreshLog(),
    refreshLfs(),
    refreshBranchTracking(),
  ]);
  renderEverything();
  setStatus('Ready', 'ok');
}

async function refreshBranchTracking() {
  try {
    const r = await window.api.branchTracking();
    state.branchTracking = r.ok ? r.data : [];
  } catch { state.branchTracking = []; }
}

async function refreshLfs() {
  try {
    const r = await window.api.lfsFiles();
    if (r.ok) state.lfsFiles = new Set(r.data);
    else state.lfsFiles = new Set();
  } catch { state.lfsFiles = new Set(); }
}

async function refreshStatus() {
  const r = await window.api.status();
  if (r.ok) state.status = r.data;
}
async function refreshBranches() {
  const r = await window.api.branches();
  if (r.ok) state.branches = r.data;
}
async function refreshRemotes() {
  const r = await window.api.remotes();
  if (r.ok) state.remotes = r.data;
}
async function refreshTags() {
  const r = await window.api.tags();
  if (r.ok) state.tags = r.data.all || [];
}
async function refreshStashes() {
  const r = await window.api.stashList();
  if (r.ok) state.stashes = r.data.all || [];
}
async function refreshLog() {
  if (state.historyBranchFilter) {
    const r = await window.api.logBranch({
      branch: state.historyBranchFilter,
      maxCount: state.settings.graphMaxCommits,
    });
    if (r.ok) state.commits = r.data;
  } else {
    const r = await window.api.log({ maxCount: state.settings.graphMaxCommits });
    if (r.ok) state.commits = r.data;
  }
}

// ─────────────────────── Render ───────────────────────
function renderEverything() {
  renderSidebarBranches();
  renderSidebarRemotes();
  renderSidebarTags();
  renderSidebarStashes();
  renderStatusBar();
  renderGraph();
  renderChanges();
  renderCenterHeader();
}

function renderStatusBar() {
  $('#sb-branch').textContent = state.status?.current || '—';
  $('#sb-ahead').textContent = state.status?.ahead ?? 0;
  $('#sb-behind').textContent = state.status?.behind ?? 0;
}

function renderCenterHeader() {
  const b = state.status?.current || 'none';
  $('#current-branch-pill').textContent = '⎇ ' + b;
  if (typeof renderConsoleCwd === 'function') renderConsoleCwd();

  const ahead = state.status?.ahead || 0;
  const behind = state.status?.behind || 0;
  let sync = '';
  if (ahead) sync += `↑${ahead} `;
  if (behind) sync += `↓${behind}`;
  $('#sync-pill').textContent = sync.trim();

  const fileCount = state.status?.files?.length || 0;
  $('#changes-badge').textContent = fileCount;
  $('#changes-tab-badge').textContent = fileCount;

  // history filter pill
  const fp = $('#history-filter-pill');
  if (state.historyBranchFilter) {
    fp.innerHTML = `⎇ ${escapeHtml(state.historyBranchFilter)} <span class="filter-clear">✕</span>`;
    fp.onclick = () => { state.historyBranchFilter = null; refreshLog().then(renderGraph); renderCenterHeader(); };
  } else {
    fp.innerHTML = '';
    fp.onclick = null;
  }
}

// Split "feature/x/y" style names into a nested folder tree.
function _branchTree(items, keyOf) {
  const root = { dirs: new Map(), leaves: [] };
  for (const it of items) {
    const parts = String(keyOf(it)).split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), leaves: [] });
      node = node.dirs.get(seg);
    }
    node.leaves.push({ item: it, label: parts[parts.length - 1] });
  }
  return root;
}
function _renderBranchNodes(node, pathPrefix, depth, leafHtml) {
  const collapsed = state.collapsedBranchFolders || (state.collapsedBranchFolders = new Set());
  let html = '';
  for (const seg of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
    const fpath = pathPrefix ? pathPrefix + '/' + seg : seg;
    const isCol = collapsed.has(fpath);
    const pad = 8 + depth * 12;
    html += `<div class="branch-folder ${isCol ? 'collapsed' : ''}" data-folder="${escapeHtml(fpath)}">
      <div class="branch-folder-header" data-folder="${escapeHtml(fpath)}" style="padding-left:${pad}px">
        <span class="bf-twirl">▾</span><span class="bf-icon">📁</span><span class="bf-name">${escapeHtml(seg)}</span>
      </div>
      <div class="branch-folder-children">${_renderBranchNodes(node.dirs.get(seg), fpath, depth + 1, leafHtml)}</div>
    </div>`;
  }
  for (const leaf of node.leaves.sort((a, b) => a.label.localeCompare(b.label))) {
    html += leafHtml(leaf.item, leaf.label, depth);
  }
  return html;
}
function _wireBranchFolders(cont) {
  $$('.branch-folder-header', cont).forEach(h => {
    h.onclick = (e) => {
      e.stopPropagation();
      const fp = h.dataset.folder;
      const set = state.collapsedBranchFolders || (state.collapsedBranchFolders = new Set());
      const folder = h.closest('.branch-folder');
      if (set.has(fp)) { set.delete(fp); folder.classList.remove('collapsed'); }
      else { set.add(fp); folder.classList.add('collapsed'); }
    };
  });
}

function renderSidebarBranches() {
  const cont = $('#branches-local');
  const local = state.branches.local;
  const branches = (local?.all || []).map(name => ({
    name,
    current: name === local.current,
  }));
  if (branches.length === 0) {
    cont.innerHTML = '<div class="sidebar-empty">No local branches</div>';
    return;
  }
  const trackByName = new Map((state.branchTracking || []).map(t => [t.name, t]));
  const badgeHtml = (name) => {
    const t = trackByName.get(name);
    if (!t || !t.upstream) {
      return `<span class="branch-track-badge no-upstream" title="No upstream — push to publish">⇅</span>`;
    }
    if (t.gone) {
      return `<span class="branch-track-badge gone" title="Upstream ${escapeHtml(t.upstream)} is gone">⌖ gone</span>`;
    }
    if (!t.ahead && !t.behind) {
      return `<span class="branch-track-badge even" title="In sync with ${escapeHtml(t.upstream)}">=</span>`;
    }
    const parts = [];
    if (t.ahead) parts.push(`<span class="btb-up">↑${t.ahead}</span>`);
    if (t.behind) parts.push(`<span class="btb-down">↓${t.behind}</span>`);
    return `<span class="branch-track-badge" title="${t.ahead}↑ / ${t.behind}↓ vs ${escapeHtml(t.upstream)}">${parts.join(' ')}</span>`;
  };
  const leafLocal = (b, label, depth) => {
    const pad = 8 + depth * 12 + 14;
    return `<div class="sidebar-list-item ${b.current ? 'current active' : ''} ${state.historyBranchFilter === b.name ? 'active' : ''}"
         data-branch="${escapeHtml(b.name)}"
         data-source="local"
         draggable="true" style="padding-left:${pad}px">
      <span class="branch-icon">⎇</span>
      <span class="si-label" title="${escapeHtml(b.name)}">${escapeHtml(label)}</span>
      ${badgeHtml(b.name)}
    </div>`;
  };
  cont.innerHTML = _renderBranchNodes(_branchTree(branches, b => b.name), '', 0, leafLocal);
  _wireBranchFolders(cont);
  $$('#branches-local .sidebar-list-item').forEach(el => {
    el.onclick = (e) => {
      if (e.detail === 2) return; // double-click handled separately
      filterHistoryBy(el.dataset.branch);
    };
    el.ondblclick = () => switchBranch(el.dataset.branch);
    el.oncontextmenu = (e) => {
      e.preventDefault();
      branchContextMenu(el.dataset.branch, e.clientX, e.clientY);
    };
    attachBranchDnD(el);
  });
}

function renderSidebarRemotes() {
  const cont = $('#branches-remote');
  const all = state.branches.all?.all || [];
  const remoteBranches = all.filter(n => n.startsWith('remotes/'));

  // Group by remote (origin, upstream, etc.)
  const groups = new Map();
  state.remotes.forEach(r => groups.set(r.name, []));
  remoteBranches.forEach(name => {
    const trimmed = name.replace(/^remotes\//, '');
    const slash = trimmed.indexOf('/');
    const remoteName = slash >= 0 ? trimmed.slice(0, slash) : '?';
    const branchPart = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
    if (!groups.has(remoteName)) groups.set(remoteName, []);
    groups.get(remoteName).push({ full: trimmed, branchPart });
  });

  if (groups.size === 0) {
    cont.innerHTML = '<div class="sidebar-empty">No remotes — click + to add one</div>';
    return;
  }

  cont.innerHTML = Array.from(groups.entries()).map(([remoteName, branches]) => {
    const remoteInfo = state.remotes.find(r => r.name === remoteName);
    const url = remoteInfo?.refs?.fetch || remoteInfo?.refs?.push || '';
    const leafRemote = (b, label, depth) => {
      const pad = 8 + depth * 12 + 14;
      return `<div class="sidebar-list-item ${state.historyBranchFilter === b.full ? 'active' : ''}"
               data-branch="${escapeHtml(b.full)}"
               data-remote-branch="true"
               data-source="remote"
               draggable="true" style="padding-left:${pad}px">
            <span class="branch-icon">☁</span>
            <span class="si-label" title="${escapeHtml(b.full)}">${escapeHtml(label)}</span>
          </div>`;
    };
    const branchesHtml = branches.length
      ? _renderBranchNodes(_branchTree(branches, b => b.branchPart), `__r/${remoteName}`, 0, leafRemote)
      : '<div class="sidebar-empty">— no remote branches —</div>';
    return `
      <div class="remote-group" data-remote="${escapeHtml(remoteName)}">
        <div class="remote-group-header">
          <span class="remote-name">${escapeHtml(remoteName)}</span>
          <span class="remote-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
        </div>
        ${branchesHtml}
      </div>
    `;
  }).join('');

  _wireBranchFolders(cont);
  $$('#branches-remote .sidebar-list-item[data-remote-branch="true"]').forEach(el => {
    el.onclick = () => filterHistoryBy(el.dataset.branch);
    el.ondblclick = async () => {
      const ref = el.dataset.branch;
      const localName = ref.split('/').slice(1).join('/');
      setStatus('Checking out...', 'busy');
      const r = await window.api.checkout(localName);
      if (r.ok) { toast(`On branch ${localName}`, 'ok'); await refreshAll(); }
      else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
    };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      remoteBranchContextMenu(el.dataset.branch, e.clientX, e.clientY);
    };
    attachBranchDnD(el);
  });

  $$('#branches-remote .remote-group').forEach(group => {
    group.oncontextmenu = (e) => {
      // Only fire if the right-click was on a non-branch area inside the group
      if (e.target.closest('.sidebar-list-item')) return;
      e.preventDefault();
      remoteContextMenu(group.dataset.remote, e.clientX, e.clientY);
    };
  });
}

function renderSidebarTags() {
  const cont = $('#tags-list');
  if (!state.tags.length) {
    cont.innerHTML = '<div class="sidebar-empty">No tags</div>';
    return;
  }
  cont.innerHTML = state.tags.map(t => `
    <div class="sidebar-list-item" data-tag="${escapeHtml(t)}">
      <span class="branch-icon" style="color: var(--warn);">▼</span>
      <span class="si-label">${escapeHtml(t)}</span>
    </div>
  `).join('');
}

function renderSidebarStashes() {
  const cont = $('#stash-list');
  if (!state.stashes.length) {
    cont.innerHTML = '<div class="sidebar-empty">No stashes</div>';
    return;
  }
  cont.innerHTML = state.stashes.map((s, i) => `
    <div class="sidebar-list-item" data-stash-idx="${i}">
      <span class="branch-icon" style="color: var(--warn);">★</span>
      <span class="si-label">${escapeHtml(s.message || `stash@{${i}}`)}</span>
    </div>
  `).join('');
  $$('#stash-list .sidebar-list-item').forEach(el => {
    el.onclick = () => stashContextMenuFromClick(parseInt(el.dataset.stashIdx, 10));
    el.oncontextmenu = (e) => {
      e.preventDefault();
      stashContextMenu(parseInt(el.dataset.stashIdx, 10), e.clientX, e.clientY);
    };
  });
}

// ─────────────────────── History branch filter ───────────────────────
async function filterHistoryBy(branchName) {
  // Toggle: clicking the active filter clears it
  if (state.historyBranchFilter === branchName) {
    state.historyBranchFilter = null;
  } else {
    state.historyBranchFilter = branchName;
  }
  setStatus('Loading history...', 'busy');
  await refreshLog();
  switchCenterTab('history');
  renderGraph();
  renderSidebarBranches();
  renderSidebarRemotes();
  renderCenterHeader();
  setStatus('Ready');
}

// ─────────────────────── Branch drag & drop ───────────────────────
function attachBranchDnD(el) {
  el.ondragstart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({
      branch: el.dataset.branch,
      source: el.dataset.source,
    }));
    el.classList.add('dragging');
  };
  el.ondragend = () => {
    el.classList.remove('dragging');
    $$('.sidebar-list-item.drag-over').forEach(x => x.classList.remove('drag-over'));
  };
  el.ondragover = (e) => {
    if (el.classList.contains('dragging')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  el.ondragenter = (e) => {
    if (el.classList.contains('dragging')) return;
    e.preventDefault();
    el.classList.add('drag-over');
  };
  el.ondragleave = () => { el.classList.remove('drag-over'); };
  el.ondrop = (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!payload || !payload.branch) return;
    const sourceBranch = payload.branch;
    const targetBranch = el.dataset.branch;
    if (sourceBranch === targetBranch) return;
    openBranchDropModal(sourceBranch, targetBranch, el.dataset.source);
  };
}

function openBranchDropModal(source, target, targetSource) {
  const isCurrentTarget = target === state.status?.current;
  const targetIsRemote = targetSource === 'remote';

  modal({
    title: `${source}  →  ${target}`,
    body: `
      <p style="margin-bottom: 16px;">Pick an action.</p>
      <div class="modal-choice">
        <button class="modal-choice-btn" id="drop-merge">
          <div class="mcb-icon">⎇</div>
          <div>
            <div class="mcb-title">Merge ${escapeHtml(source)} into ${escapeHtml(target)}</div>
            <div class="mcb-sub">
              ${isCurrentTarget
                ? `Merges <strong>${escapeHtml(source)}</strong> into the current branch.`
                : `Checks out <strong>${escapeHtml(target)}</strong> first, then merges.`
              }
              ${targetIsRemote ? ' Target is a remote — checkout will track it.' : ''}
            </div>
          </div>
        </button>
        <button class="modal-choice-btn" id="drop-rebase">
          <div class="mcb-icon">⤴</div>
          <div>
            <div class="mcb-title">Rebase ${escapeHtml(source)} onto ${escapeHtml(target)}</div>
            <div class="mcb-sub">Replays <strong>${escapeHtml(source)}</strong>'s commits on top of <strong>${escapeHtml(target)}</strong>.</div>
          </div>
        </button>
      </div>
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });

  $('#drop-merge').onclick = async () => {
    $('#modal-backdrop').classList.add('hidden');
    await mergeBranchInto(source, target);
  };
  $('#drop-rebase').onclick = async () => {
    $('#modal-backdrop').classList.add('hidden');
    await rebaseBranchOnto(source, target);
  };
}

// Detect git's "stopped because of conflicts" messages or a non-empty
// conflicted list in the post-refresh status.
function _isConflictError(err) {
  return /CONFLICT|fix conflicts|merge conflict|content conflicts|automatic merge failed|Resolve all conflicts/i.test(err || '');
}

async function mergeBranchInto(source, target) {
  setStatus('Merging…', 'busy');
  if (target !== state.status?.current) {
    const co = await window.api.checkout(target);
    if (!co.ok) { toast(`Checkout failed: ${co.error}`, 'error'); setStatus('Idle', 'error'); return; }
  }
  const r = await window.api.merge(source);
  // Always refresh — conflicts come back as r.ok=false but state has changed
  // and the auto-prompt in refreshOpState needs that state to fire.
  await refreshAll();
  if (r.ok) {
    toast(`Merged ${source} into ${target}`, 'ok');
  } else if (_isConflictError(r.error) || (state.status?.conflicted?.length || 0) > 0) {
    toast(`Merge of ${source} stopped — resolve conflicts to continue.`, 'warn', 5000);
    // refreshOpState's auto-prompt will open the resolver.
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
}

// Squash-merge: brings <source>'s changes into the working tree + index but
// makes NO commit (git merge --squash). User reviews and commits manually.
async function squashMergeInto(source) {
  setStatus('Squash-merging…', 'busy');
  const r = await window.api.mergeOpts({ ref: source, squash: true });
  await refreshAll();
  if (r.ok) {
    if (typeof switchCenterTab === 'function') switchCenterTab('changes');
    const msgEl = $('#commit-msg');
    if (msgEl && !msgEl.value.trim()) msgEl.value = `Squash merge ${source}`;
    toast(`Squashed ${source} — changes staged, review and commit`, 'ok', 5000);
    setStatus('Ready');
  } else if (_isConflictError(r.error) || (state.status?.conflicted?.length || 0) > 0) {
    toast(`Squash merge of ${source} hit conflicts — resolve, then commit.`, 'warn', 5000);
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
}

async function rebaseBranchOnto(source, target) {
  setStatus('Rebasing…', 'busy');
  if (source !== state.status?.current) {
    const co = await window.api.checkout(source);
    if (!co.ok) { toast(`Checkout failed: ${co.error}`, 'error'); setStatus('Idle', 'error'); return; }
  }
  const r = await window.api.rebase(target);
  await refreshAll();
  if (r.ok) {
    toast(`Rebased ${source} onto ${target}`, 'ok');
  } else if (_isConflictError(r.error) || (state.status?.conflicted?.length || 0) > 0) {
    toast(`Rebase stopped — resolve conflicts to continue.`, 'warn', 5000);
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
}

// ─────────────────────── Commit Graph ───────────────────────
function buildGraphLanes(commits) {
  const laneOf = new Map();
  const lanes = [];
  const rows = [];

  const findFreeLane = () => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (let idx = 0; idx < commits.length; idx++) {
    const c = commits[idx];
    // lanes coming in from the row above (before we touch them)
    const incoming = [...lanes];
    let lane = laneOf.has(c.hash) ? laneOf.get(c.hash) : findFreeLane();
    laneOf.set(c.hash, lane);
    lanes[lane] = c.hash;

    const parents = (c.parents || '').split(' ').filter(Boolean);
    const parentLanes = [];

    parents.forEach((p, pi) => {
      if (pi === 0) {
        if (!laneOf.has(p)) laneOf.set(p, lane);
        parentLanes.push(laneOf.get(p));
      } else {
        if (!laneOf.has(p)) laneOf.set(p, findFreeLane());
        parentLanes.push(laneOf.get(p));
      }
    });

    // free this commit's lane, then claim a lane for each parent.
    // claiming the extra-parent lanes keeps branch lines from disappearing
    // between a merge and where the branch started.
    lanes[lane] = null;
    parents.forEach(p => { lanes[laneOf.get(p)] = p; });

    rows.push({ commit: c, lane, parentLanes, activeLanes: [...lanes], incoming });
  }

  return rows;
}

const LANE_COLORS = ['#ff5aa8', '#5ee0ff', '#ffd166', '#7ee8b0', '#b58aff', '#ff9966', '#7adcff', '#ff84c4'];
function laneColor(i) { return LANE_COLORS[i % LANE_COLORS.length]; }

function renderRefsPills(refs, headBranch) {
  if (!refs || !refs.length) return '';
  // Priority: head > local > remote > tag
  const order = { head: 0, local: 1, remote: 2, tag: 3 };
  const sorted = [...refs].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  const MAX = 2;
  const visible = sorted.slice(0, MAX);
  const extra = sorted.length - visible.length;
  const pillFor = (r) => {
    let icon = '';
    let check = '';
    if (r.kind === 'head') { check = `<span class="pill-check">✓</span>`; icon = `<span class="pill-icon" title="local">💻</span>`; }
    else if (r.kind === 'local') icon = `<span class="pill-icon" title="local">💻</span>`;
    else if (r.kind === 'remote') icon = `<span class="pill-icon" title="remote">☁</span>`;
    else if (r.kind === 'tag') icon = `<span class="pill-icon" title="tag">▼</span>`;
    return `<span class="gr-pill ${r.kind}" title="${escapeHtml(r.name)}">${check}<span class="pill-name">${escapeHtml(r.name)}</span>${icon}</span>`;
  };
  let out = visible.map(pillFor).join('');
  if (extra > 0) out += `<span class="gr-pill more" title="${escapeHtml(sorted.slice(MAX).map(r => r.name).join(', '))}">+${extra}</span>`;
  return out;
}

function renderGraphRow(row, refsByHash) {
  const { commit, lane, parentLanes, activeLanes } = row;
  const incoming = row.incoming || [];
  const laneCount = Math.max(activeLanes.length, incoming.length, lane + 1);
  const slotW = 22;
  const cx = (i) => slotW / 2 + i * slotW + 4;
  const h = 38;
  const svgW = slotW * laneCount + 8;

  let linesInner = '';     // back SVG — stretches to full row height
  let nodesInner = '';     // front SVG — fixed height, holds dots/ring

  const yMid = h / 2;

  // top half of each incoming line (0 -> mid). draws the bit above the node
  // so it still connects upward even if this lane ends here.
  incoming.forEach((hash, i) => {
    if (hash) {
      linesInner += `<line x1="${cx(i)}" y1="0" x2="${cx(i)}" y2="${yMid}" stroke="${laneColor(i)}" stroke-width="2.5"/>`;
    }
  });

  // bottom half (mid -> h) for lanes that just pass straight through
  activeLanes.forEach((hash, i) => {
    if (hash && incoming[i] && i !== lane) {
      linesInner += `<line x1="${cx(i)}" y1="${yMid}" x2="${cx(i)}" y2="${h}" stroke="${laneColor(i)}" stroke-width="2.5"/>`;
    }
  });

  // line from this node down to each parent's lane
  parentLanes.forEach(pl => {
    if (pl !== lane) {
      const x1 = cx(lane), x2 = cx(pl);
      linesInner += `<path d="M ${x1} ${yMid} C ${x1} ${yMid + 10}, ${x2} ${h - 10}, ${x2} ${h}" stroke="${laneColor(pl)}" stroke-width="2.5" fill="none"/>`;
    } else {
      linesInner += `<line x1="${cx(lane)}" y1="${yMid}" x2="${cx(lane)}" y2="${h}" stroke="${laneColor(lane)}" stroke-width="2.5"/>`;
    }
  });

  // little dots on lanes that pass through this row
  activeLanes.forEach((hash, i) => {
    if (hash && incoming[i] && i !== lane) {
      nodesInner += `<circle cx="${cx(i)}" cy="${yMid}" r="3.5" fill="${laneColor(i)}" stroke="#1a1224" stroke-width="1"/>`;
    }
  });

  // Lane-coloured RING behind the avatar at the commit lane
  const ringColor = laneColor(lane);
  const ringX = cx(lane), ringY = h / 2;
  nodesInner += `<circle cx="${ringX}" cy="${ringY}" r="12" fill="${ringColor}" stroke="#1a1224" stroke-width="1.5"/>`;

  const refs = refsForHash(refsByHash, commit.hash);
  const headBranch = state.status?.current || '';
  const refsHtml = renderRefsPills(refs, headBranch);

  const date = formatDate(commit.date);
  const shortHash = (commit.hash || '').slice(0, 7);
  const author = commit.author_name || commit.author || '—';
  const email = commit.author_email || '';

  // Connector from refs pill out to this commit's avatar ring. Starts
  // ~12px to the LEFT of the graph cell (i.e. inside the refs cell), so the
  // rightmost pill (with z-index 2) visually clips the line at its own edge.
  const hasRefs = refs.length > 0;
  const connStart = -14; // px from graph cell's left edge (negative = into refs)
  const connWidth = Math.max(0, ringX - connStart);
  const connectorHtml = hasRefs
    ? `<div class="gr-connector" style="left: ${connStart}px; width: ${connWidth}px; background: ${ringColor};"></div>`
    : '';

  return `
    <div class="graph-row" data-hash="${escapeHtml(commit.hash)}">
      <div class="gr-col gr-col-refs">${refsHtml}</div>
      <div class="gr-col gr-col-graph">
        ${connectorHtml}
        <svg class="gr-graph-lines"  viewBox="0 0 ${svgW} ${h}" preserveAspectRatio="none"          width="${svgW}">${linesInner}</svg>
        <svg class="gr-graph-nodes" viewBox="0 0 ${svgW} ${h}" preserveAspectRatio="xMinYMid meet" width="${svgW}" height="${h}">${nodesInner}</svg>
        <div class="gr-avatar-dot" style="left: ${ringX}px;">${avatarHtml(author, email, 'sm')}</div>
      </div>
      <div class="gr-col gr-col-msg">${escapeHtml(commit.message)}</div>
      <div class="gr-col gr-col-author">
        ${avatarHtml(author, email, 'sm')}
        <span class="author-name">${escapeHtml(author)}</span>
      </div>
      <div class="gr-col gr-col-date">${escapeHtml(date)}</div>
      <div class="gr-col gr-col-hash">${escapeHtml(shortHash)}</div>
    </div>
  `;
}

function buildRefsMap() {
  // simple-git's BranchSummary uses abbreviated 7-char commit hashes whereas
  // `git log` gives full 40-char hashes. Normalise by storing under BOTH the
  // full hash (when we can resolve it) and the short prefix as a fallback.
  const m = new Map();
  const head = state.status?.current;
  const fullByPrefix = new Map();
  for (const c of (state.commits || [])) {
    const h = c.hash || '';
    if (!h) continue;
    fullByPrefix.set(h.slice(0, 7), h);
    fullByPrefix.set(h.slice(0, 8), h);
  }
  const keyFor = (shaOrShort) => {
    if (!shaOrShort) return null;
    if (shaOrShort.length >= 40) return shaOrShort;
    return fullByPrefix.get(shaOrShort.slice(0, 7)) || shaOrShort;
  };
  const push = (sha, entry) => {
    const k = keyFor(sha);
    if (!k) return;
    const arr = m.get(k) || [];
    arr.push(entry);
    m.set(k, arr);
  };

  const lb = state.branches.local;
  if (lb && lb.branches) {
    Object.entries(lb.branches).forEach(([name, info]) => {
      push(info.commit, { name, kind: name === head ? 'head' : 'local' });
    });
  }
  const all = state.branches.all?.branches || {};
  Object.entries(all).forEach(([name, info]) => {
    if (!name.startsWith('remotes/')) return;
    push(info.commit, { name: name.replace(/^remotes\//, ''), kind: 'remote' });
  });
  return m;
}

// Tolerant lookup that also handles a remaining abbreviation mismatch.
function refsForHash(refsByHash, hash) {
  if (!hash) return [];
  if (refsByHash.has(hash)) return refsByHash.get(hash);
  for (const [k, v] of refsByHash) {
    if (hash.startsWith(k) || k.startsWith(hash)) return v;
  }
  return [];
}

function renderGraph() {
  const body = $('#graph-body');
  if (!state.commits || state.commits.length === 0) {
    body.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-mute);">No commits yet. Make your first commit to start the mission!</div>';
    return;
  }
  const refsByHash = buildRefsMap();
  const rows = buildGraphLanes(state.commits);
  body.innerHTML = rows.map(r => renderGraphRow(r, refsByHash)).join('');
  $$('#graph-body .graph-row').forEach(row => {
    row.onclick = () => selectCommit(row.dataset.hash);
  });
  if (state.selectedCommit) {
    const el = body.querySelector(`[data-hash="${state.selectedCommit}"]`);
    if (el) el.classList.add('selected');
  }
}

async function selectCommit(hash) {
  state.selectedCommit = hash;
  state.selectedFile = null;
  $$('#graph-body .graph-row').forEach(r => r.classList.toggle('selected', r.dataset.hash === hash));

  const commit = state.commits.find(c => c.hash === hash);
  if (!commit) return;

  switchRightTab('details');

  const author = commit.author_name || commit.author || '—';
  const email = commit.author_email || '';

  $('#inspector-body').innerHTML = `
    <div class="commit-detail-header">
      ${avatarHtml(author, email, 'lg')}
      <div class="cdh-info">
        <div class="cdh-msg">${escapeHtml(commit.message)}</div>
        ${commit.body && commit.body.trim()
          ? `<div class="cdh-body">${escapeHtml(commit.body.trim())}</div>`
          : ''}
        <dl class="cdh-meta">
          <dt>Hash</dt><dd class="mono">${escapeHtml(commit.hash.slice(0, 12))}</dd>
          <dt>Author</dt><dd>${escapeHtml(author)}</dd>
          <dt>Email</dt><dd>${escapeHtml(email)}</dd>
          <dt>Date</dt><dd>${escapeHtml(new Date(commit.date).toLocaleString())}</dd>
        </dl>
      </div>
    </div>
    <div class="commit-files">
      <div class="commit-files-header">
        <div class="cf-tabs">
          <button class="cf-tab active" data-cf-tab="changed">Files changed <span class="cf-count" id="commit-files-count">…</span></button>
          <button class="cf-tab" data-cf-tab="tree">Tree</button>
        </div>
      </div>
      <div id="commit-files-list">
        <div style="padding: 12px 16px; color: var(--text-3);">Loading…</div>
      </div>
      <div id="commit-tree-list" class="hidden">
        <div style="padding: 12px 16px; color: var(--text-3);">Loading…</div>
      </div>
    </div>
    <div id="commit-file-diff" class="commit-file-diff"></div>
  `;

  let _treeLoaded = false;
  $$('#inspector-body .cf-tab').forEach(tab => {
    tab.onclick = async () => {
      $$('#inspector-body .cf-tab').forEach(t => t.classList.toggle('active', t === tab));
      const isTree = tab.dataset.cfTab === 'tree';
      $('#commit-files-list').classList.toggle('hidden', isTree);
      $('#commit-tree-list').classList.toggle('hidden', !isTree);
      if (isTree && !_treeLoaded) {
        _treeLoaded = true;
        const tr = await window.api.treeAt({ ref: hash });
        const cont = $('#commit-tree-list');
        if (!tr.ok) {
          cont.innerHTML = `<div style="padding: 12px 16px; color: var(--err);">${escapeHtml(tr.error)}</div>`;
          return;
        }
        cont.innerHTML = renderTreeNodes(tr.data, 0);
        $$('.tree-row', cont).forEach(row => {
          row.onclick = () => {
            if (row.dataset.type === 'dir') {
              row.classList.toggle('expanded');
              const arrow = row.querySelector('.tree-arrow');
              if (arrow) arrow.textContent = row.classList.contains('expanded') ? '▾' : '▸';
            } else {
              openFileInEditor(row.dataset.path, /*editable=*/ false, /*atCommit=*/ hash);
            }
          };
        });
      }
    };
  });

  const r = await window.api.commitFiles(hash);
  if (!r.ok) {
    $('#commit-files-list').innerHTML =
      `<div style="padding: 12px 16px; color: var(--err);">Error: ${escapeHtml(r.error)}</div>`;
    return;
  }
  const files = r.data || [];
  $('#commit-files-count').textContent = files.length;

  if (files.length === 0) {
    $('#commit-files-list').innerHTML =
      `<div style="padding: 12px 16px; color: var(--text-3);">No file changes (likely a merge commit).</div>`;
    return;
  }

  $('#commit-files-list').innerHTML = files.map((f, i) => `
    <div class="commit-file" data-idx="${i}" data-path="${escapeHtml(f.path)}">
      ${statusIconHtml(f.status)}
      ${lfsBadgeHtml(f.path)}
      <span class="ci-path" title="${escapeHtml(f.from ? f.from + ' → ' + f.path : f.path)}">${escapeHtml(f.path)}</span>
    </div>
  `).join('');

  $$('#commit-files-list .commit-file').forEach(el => {
    el.onclick = async () => {
      $$('#commit-files-list .commit-file').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      const filePath = el.dataset.path;
      // Show diff in the details pane
      $('#commit-file-diff').innerHTML = '<div style="padding:12px 16px;color:var(--text-3);">Loading diff…</div>';
      const d = await window.api.fileDiffAtCommit({ hash, file: filePath });
      if (d.ok) {
        $('#commit-file-diff').innerHTML = renderDiff(d.data);
      } else {
        $('#commit-file-diff').innerHTML = `<div style="padding:12px 16px;color:var(--err);">${escapeHtml(d.error)}</div>`;
      }
      // Also: open file in main page (read-only at HEAD content)
      openFileInEditor(filePath, /*editable=*/ false, /*atCommit=*/ hash);
    };
    el.ondblclick = () => {
      openFileInEditor(el.dataset.path, false, hash);
    };
  });

  if (files.length > 0) {
    $('#commit-files-list .commit-file').click();
  }
}
