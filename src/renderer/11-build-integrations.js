// ─────────────────────── Build & install ───────────────────────
let _buildState = { installPath: '', lastInstaller: '', lastBuildAt: 0 };
(async () => {
  try { _buildState = await window.api.buildReadState(); } catch {}
})();

async function openBuildModal() {
  modal({
    title: 'BUILD & INSTALL',
    body: `
      <div class="build-form">
        <div class="build-form-row">
          <label style="margin: 0;">INSTALL PATH</label>
          <input id="build-install-path" value="${escapeHtml(_buildState.installPath || '')}" placeholder="Last used — installer will offer this"/>
          <button class="csh-action" id="build-pick-path">Pick…</button>
        </div>
        <p style="font-size: 11px; color: var(--text-3);">Path is remembered so re-runs (rebuilds + updates) can target the same folder. The NSIS installer also remembers via Windows registry.</p>
      </div>
      <div class="form-row" style="display: flex; gap: 6px; margin-bottom: 8px;">
        <button class="csh-action" id="build-start">Build installer</button>
        <button class="csh-action" id="build-run" ${_buildState.lastInstaller ? '' : 'disabled'}>Run last installer</button>
      </div>
      <div class="build-log" id="build-log"></div>
      <div class="build-status" id="build-status"></div>
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });

  const logEl = $('#build-log');
  const statusEl = $('#build-status');
  const append = (s) => { logEl.textContent += s; logEl.scrollTop = logEl.scrollHeight; };

  let unsub = null;

  $('#build-pick-path').onclick = async () => {
    const p = await window.api.buildPickInstallPath();
    if (p) {
      $('#build-install-path').value = p;
      _buildState.installPath = p;
      await window.api.buildWriteState(_buildState);
      toast('Install path saved', 'ok');
    }
  };

  $('#build-start').onclick = async () => {
    logEl.textContent = '';
    statusEl.className = 'build-status';
    statusEl.textContent = 'Building… this can take a minute on first run.';
    $('#build-start').disabled = true;
    if (unsub) unsub();
    unsub = window.api.onBuildLog((p) => append(p.line));
    const installPath = $('#build-install-path').value.trim();
    _buildState.installPath = installPath;
    await window.api.buildWriteState(_buildState);
    const r = await window.api.buildRun();
    $('#build-start').disabled = false;
    if (unsub) { unsub(); unsub = null; }
    if (!r.ok) {
      statusEl.className = 'build-status err';
      statusEl.textContent = 'Build failed: ' + r.error;
      return;
    }
    _buildState.lastInstaller = r.installer || '';
    _buildState.lastBuildAt = Date.now();
    await window.api.buildWriteState(_buildState);
    statusEl.className = 'build-status ok';
    statusEl.textContent = r.installer
      ? `✓ Built. Installer: ${r.installer}. Click "Run last installer" to install/update.`
      : '✓ Build complete but installer not found in dist/. Check the log.';
    $('#build-run').disabled = !r.installer;
  };

  $('#build-run').onclick = async () => {
    if (!_buildState.lastInstaller) { toast('No installer to run', 'warn'); return; }
    const r = await window.api.buildRunInstaller(_buildState.lastInstaller);
    if (!r.ok) toast(r.error, 'error');
  };
}

// Command palette entries for People + Build (mutate the global items isn't
// available; instead expose them via Settings + Help). Also wire a direct
// keyboard shortcut for the Build modal.
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if (inInput) return;
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault(); openBuildModal();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  Provider integrations + View-online URLs
// ═══════════════════════════════════════════════════════════════════════════

state.integrations = [];

async function loadIntegrations() {
  try {
    const r = await window.api.integrationsRead();
    state.integrations = r?.integrations || [];
  } catch { state.integrations = []; }
}
async function saveIntegrations() {
  try { await window.api.integrationsWrite({ integrations: state.integrations }); } catch {}
}
loadIntegrations();

// Parse a remote URL into { host, path }. Handles ssh, ssh://, https://.
function parseRemoteUrl(url) {
  if (!url) return null;
  // SSH form: user@host:path
  let m = url.match(/^[a-z][a-z0-9+\-_.]*@([^:]+):(.+?)(?:\.git)?\/?$/i);
  if (m) return { host: m[1], path: m[2].replace(/^\//, '') };
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname.replace(/^\//, '').replace(/\.git$/, '') };
  } catch { return null; }
}

function detectProvider(host) {
  if (!host) return null;
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';
  if (host === 'bitbucket.org') return 'bitbucket';
  const integ = (state.integrations || []).find(i => i.host === host);
  if (integ) return integ.type;
  if (/(^|\.)gitlab\./i.test(host) || /gitlab/i.test(host)) return 'gitlab-self';
  return null;
}

function buildBranchWebUrl(parsed, branch) {
  if (!parsed) return null;
  const provider = detectProvider(parsed.host);
  const enc = encodeURIComponent(branch);
  if (provider === 'github')      return `https://${parsed.host}/${parsed.path}/tree/${enc}`;
  if (provider === 'gitlab' || provider === 'gitlab-self')
                                   return `https://${parsed.host}/${parsed.path}/-/tree/${enc}`;
  if (provider === 'bitbucket')   return `https://${parsed.host}/${parsed.path}/src/${enc}`;
  return null;
}
function buildRepoWebUrl(parsed) {
  if (!parsed) return null;
  if (!detectProvider(parsed.host)) return null;
  return `https://${parsed.host}/${parsed.path}`;
}
function buildCommitWebUrl(parsed, hash) {
  if (!parsed) return null;
  const provider = detectProvider(parsed.host);
  if (provider === 'github')      return `https://${parsed.host}/${parsed.path}/commit/${hash}`;
  if (provider === 'gitlab' || provider === 'gitlab-self')
                                   return `https://${parsed.host}/${parsed.path}/-/commit/${hash}`;
  if (provider === 'bitbucket')   return `https://${parsed.host}/${parsed.path}/commits/${hash}`;
  return null;
}

// Find the remote and branch components from any branch name (handles
// "feature/foo" → defaultRemote, "origin/feature/foo" → origin + feature/foo).
function resolveRemoteForBranch(branchName) {
  if (!state.remotes?.length) return { remote: null, branch: branchName };
  if (branchName?.includes('/')) {
    const slash = branchName.indexOf('/');
    const head = branchName.slice(0, slash);
    const found = state.remotes.find(r => r.name === head);
    if (found) return { remote: found, branch: branchName.slice(slash + 1) };
  }
  const def = state.remotes.find(r => r.name === state.settings.defaultRemote)
           || state.remotes.find(r => r.name === 'origin')
           || state.remotes[0];
  return { remote: def, branch: branchName };
}

async function openBranchOnline(branchName) {
  const { remote, branch } = resolveRemoteForBranch(branchName);
  if (!remote) { toast('No remote configured', 'warn'); return; }
  const url = remote.refs?.fetch || remote.refs?.push;
  const parsed = parseRemoteUrl(url);
  if (!parsed) { toast(`Couldn't parse remote URL: ${url || '(empty)'}`, 'warn'); return; }
  const web = buildBranchWebUrl(parsed, branch);
  if (!web) {
    toast(`Unknown provider for ${parsed.host}. Add it under Settings → Integrations.`, 'warn');
    return;
  }
  await window.api.openExternal(web);
}

async function openRepoOnlineForRemote(remoteName) {
  const remote = state.remotes.find(r => r.name === remoteName) || state.remotes[0];
  if (!remote) { toast('No remote', 'warn'); return; }
  const parsed = parseRemoteUrl(remote.refs?.fetch || remote.refs?.push);
  const web = buildRepoWebUrl(parsed);
  if (!web) { toast(`Unknown provider for ${parsed?.host || '(unknown)'}`, 'warn'); return; }
  await window.api.openExternal(web);
}

async function openCommitOnline(hash) {
  const def = state.remotes.find(r => r.name === state.settings.defaultRemote)
           || state.remotes.find(r => r.name === 'origin')
           || state.remotes[0];
  if (!def) { toast('No remote', 'warn'); return; }
  const parsed = parseRemoteUrl(def.refs?.fetch || def.refs?.push);
  const web = buildCommitWebUrl(parsed, hash);
  if (!web) { toast('Unknown provider', 'warn'); return; }
  await window.api.openExternal(web);
}

// Patch branchContextMenu / remoteBranchContextMenu / remoteContextMenu / commitContextMenu
// to add "View online" entries.
const _origBranchCtx = branchContextMenu;
branchContextMenu = function (branch, x, y) {
  // Build by calling original via a temporary capture of showContextMenu items
  // — easier to just rebuild here.
  const items = [
    { label: 'View online', icon: '🌐', action: () => openBranchOnline(branch) },
    { separator: true },
    { label: 'Show history', icon: '⌖', action: () => filterHistoryBy(branch) },
    { label: 'Checkout', icon: '▶', action: () => switchBranch(branch) },
    { label: 'Merge into current', icon: '⎇', action: async () => {
      const r = await window.api.merge(branch);
      if (r.ok) { toast(`Merged ${branch}`, 'ok'); await refreshAll(); }
      else if (typeof _isConflictError === 'function' && _isConflictError(r.error)) {
        await refreshAll();
        toast(`Merge of ${branch} stopped — resolve conflicts to continue.`, 'warn', 5000);
      } else toast(r.error, 'error');
    } },
    { label: 'Merge into current (squash)', icon: '⊞', action: () => squashMergeInto(branch) },
    { label: 'Rebase current onto this', icon: '⤴', action: async () => {
      const r = await window.api.rebase(branch);
      if (r.ok) { toast(`Rebased onto ${branch}`, 'ok'); await refreshAll(); }
      else toast(r.error, 'error');
    } },
    { separator: true },
    { label: 'Rename...', icon: '✎', action: () => openRenameBranchModal(branch) },
    { label: 'Push branch', icon: '↑', action: async () => {
      const r = await window.api.push({ remote: state.settings.defaultRemote, branch });
      if (r.ok) toast(`Pushed ${branch}`, 'ok');
      else toast(r.error, 'error');
    } },
    { separator: true },
    { label: 'Delete branch', icon: '✕', danger: true, action: () => deleteBranchWithFallback(branch) },
  ];
  showContextMenu(x, y, items);
};

async function deleteBranchWithFallback(branch) {
  const r = await window.api.deleteBranch({ name: branch, force: false });
  if (r.ok) { toast(`Deleted ${branch}`, 'ok'); await refreshAll(); return; }
  // Detect "not fully merged" and offer force-delete
  if (/not fully merged|branch -D|forceDeleteBranch/i.test(r.error || '')) {
    modal({
      title: `FORCE-DELETE ${branch}?`,
      body: `<p>Branch <strong>${escapeHtml(branch)}</strong> isn't fully merged — Git is refusing the safe delete.</p>
        <p style="margin-top: 8px;">This is equivalent to <code>git branch -D ${escapeHtml(branch)}</code>. Any commits on this branch that aren't reachable from another branch or tag will be <strong>orphaned</strong> (still recoverable via reflog for ~30 days, but invisible).</p>`,
      okText: 'FORCE DELETE',
      onOk: async () => {
        const r2 = await window.api.deleteBranch({ name: branch, force: true });
        if (r2.ok) { toast(`Force-deleted ${branch}`, 'ok'); await refreshAll(); }
        else { toast(r2.error, 'error'); return false; }
      },
    });
    return;
  }
  toast(r.error, 'error');
}

const _origRemoteBranchCtx = remoteBranchContextMenu;
remoteBranchContextMenu = function (branch, x, y) {
  const items = [
    { label: 'View online', icon: '🌐', action: () => openBranchOnline(branch) },
    { separator: true },
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
    { separator: true },
    { label: 'Delete remote branch', icon: '✕', danger: true, action: () => {
      const seg = String(branch).split('/');
      const remote = seg[0];
      const remoteBranch = seg.slice(1).join('/');
      modal({
        title: `⚠ DELETE REMOTE BRANCH — ${escapeHtml(remoteBranch)}`,
        body: `
          <p>This deletes <strong>${escapeHtml(remoteBranch)}</strong> on
          <strong>${escapeHtml(remote)}</strong> (<code>git push ${escapeHtml(remote)} --delete ${escapeHtml(remoteBranch)}</code>).</p>
          <p style="margin-top:8px;color:var(--text-3);">
            It's removed for <strong>everyone</strong> using this remote. Your local
            branch (if any) is not affected. This can't be undone here.
          </p>`,
        okText: 'DELETE ON REMOTE',
        onOk: async () => {
          setStatus('Deleting remote branch…', 'busy');
          const r = await window.api.deleteRemoteBranch({ remote, branch: remoteBranch });
          if (r.ok) { toast(`Deleted ${remote}/${remoteBranch}`, 'ok'); await refreshAll(); }
          else { toast(r.error, 'error'); setStatus('Idle', 'error'); return false; }
        },
      });
    } },
  ];
  showContextMenu(x, y, items);
};

// Add "Open repository online" to the remote group context menu
const _origRemoteCtx = remoteContextMenu;
remoteContextMenu = function (remoteName, x, y) {
  // Reconstruct items with View-online up top
  const items = [
    { label: 'View repository online', icon: '🌐', action: () => openRepoOnlineForRemote(remoteName) },
    { separator: true },
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
    { label: 'Remove', icon: '✕', danger: true, action: () => removeRemoteWithWarning(remoteName) },
  ];
  showContextMenu(x, y, items);
};

// Inject "View online" into the commit context menu
const _origCommitCtx2 = commitContextMenu;
commitContextMenu = function (hash, x, y) {
  const short = hash.slice(0, 7);
  const items = [
    { label: 'View online', icon: '🌐', action: () => openCommitOnline(hash) },
    { separator: true },
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

// ─────────────────────── Integrations manager ───────────────────────
function _integTypeLabel(t) {
  return ({
    github: 'GitHub',
    gitlab: 'GitLab.com',
    'gitlab-self': 'GitLab (self)',
    bitbucket: 'Bitbucket',
  })[t] || t;
}
function _integDefaultHost(t) {
  return ({ github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' })[t] || '';
}

function openIntegrationsManager() {
  const list = state.integrations || [];
  const rowsHtml = list.length === 0
    ? '<p style="color: var(--text-3); padding: 6px;">No integrations configured.</p>'
    : `<div class="integ-list">${list.map((i, idx) => `
        <div class="integ-row" data-i="${idx}">
          <span class="integ-type ${escapeHtml(i.type)}">${escapeHtml(_integTypeLabel(i.type))}</span>
          <span class="integ-host" title="${escapeHtml(i.host || _integDefaultHost(i.type))}">${escapeHtml(i.host || _integDefaultHost(i.type))}</span>
          <span class="integ-user">${escapeHtml(i.username || '')}</span>
          <span class="integ-status ${i.token ? 'ok' : 'warn'}">${i.token ? '✓ token' : '— no token'}</span>
          <span class="integ-actions">
            <button class="csh-action" data-act="edit">Edit</button>
            <button class="csh-action danger" data-act="del">✕</button>
          </span>
        </div>
      `).join('')}</div>`;

  modal({
    title: 'INTEGRATIONS',
    body: `
      <button class="csh-action" id="integ-add">+ Add integration</button>
      <div style="margin-top: 12px;">${rowsHtml}</div>
      <p style="font-size: 11px; color: var(--text-3); margin-top: 12px;">
        Provider/host is used to build correct <em>View online</em> URLs (especially for self-hosted GitLab and Bitbucket).
        Tokens are encrypted at rest via OS keychain when available and used by future API calls (PR list, CI status).
      </p>
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  $('#integ-add').onclick = () => { $('#modal-backdrop').classList.add('hidden'); openIntegrationEditor(null); };
  $$('#modal-body .integ-row').forEach(row => {
    const idx = parseInt(row.dataset.i, 10);
    row.querySelector('[data-act="edit"]').onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      openIntegrationEditor(idx);
    };
    row.querySelector('[data-act="del"]').onclick = async () => {
      state.integrations.splice(idx, 1);
      await saveIntegrations();
      $('#modal-backdrop').classList.add('hidden');
      openIntegrationsManager();
    };
  });
}

function openIntegrationEditor(idx) {
  const existing = idx != null ? state.integrations[idx] : { type: 'github', host: '', username: '', token: '' };
  const isNew = idx == null;
  modal({
    title: isNew ? 'ADD INTEGRATION' : `EDIT INTEGRATION — ${_integTypeLabel(existing.type)}`,
    body: `
      <label>PROVIDER</label>
      <select id="integ-type">
        <option value="github" ${existing.type === 'github' ? 'selected' : ''}>GitHub (github.com)</option>
        <option value="gitlab" ${existing.type === 'gitlab' ? 'selected' : ''}>GitLab.com</option>
        <option value="gitlab-self" ${existing.type === 'gitlab-self' ? 'selected' : ''}>GitLab — self-hosted</option>
        <option value="bitbucket" ${existing.type === 'bitbucket' ? 'selected' : ''}>Bitbucket Cloud</option>
      </select>
      <label>HOST</label>
      <input id="integ-host" value="${escapeHtml(existing.host || '')}" placeholder="auto-fills based on provider"/>
      <p style="font-size: 11px; color: var(--text-3);">For self-hosted GitLab, enter your instance host (e.g. <code>gitlab.example.com</code>). For SaaS providers, leave blank for the default.</p>
      <label>USERNAME (optional, for display)</label>
      <input id="integ-username" value="${escapeHtml(existing.username || '')}"/>
      <div id="integ-gh-login" style="display: ${existing.type === 'github' ? 'block' : 'none'}; margin-bottom: 8px;">
        <button class="csh-action" id="integ-gh-btn">⎔ Login with GitHub</button>
        <span id="integ-gh-status" style="font-size: 11px; color: var(--text-3); margin-left: 8px;"></span>
        <p style="font-size: 11px; color: var(--text-3); margin-top: 4px;">Authorize in your browser — no token to paste. Or enter one manually below.</p>
      </div>
      <label>PERSONAL ACCESS TOKEN</label>
      <input id="integ-token" type="password" value="${escapeHtml(existing.token || '')}" placeholder="paste a token (scope: read repo / read user)"/>
      <p style="font-size: 11px; color: var(--text-3); margin-top: 4px;">
        ${{
          github: '<strong>GitHub</strong>: Settings → Developer settings → Personal access tokens → Fine-grained, scope <code>repo</code> + <code>read:user</code>.',
          gitlab: '<strong>GitLab</strong>: Preferences → Access tokens, scope <code>read_api</code> + <code>read_repository</code>.',
          'gitlab-self': '<strong>GitLab</strong>: Preferences → Access tokens on your instance, scope <code>read_api</code> + <code>read_repository</code>.',
          bitbucket: '<strong>Bitbucket</strong>: Personal settings → App passwords, scopes Repositories: Read + Pull requests: Read.',
        }[existing.type] || ''}
      </p>
    `,
    okText: 'SAVE',
    onOk: async () => {
      const type = $('#integ-type').value;
      let host = $('#integ-host').value.trim();
      const username = $('#integ-username').value.trim();
      const token = $('#integ-token').value.trim();
      if (!host) host = _integDefaultHost(type);
      if (!host) { toast('Host required for self-hosted', 'warn'); return false; }
      const entry = { type, host, username, token };
      if (isNew) state.integrations.push(entry);
      else state.integrations[idx] = entry;
      await saveIntegrations();
      toast('Integration saved', 'ok');
    },
  });
  // Live-update host placeholder when type changes; show GitHub login only for github
  $('#integ-type').onchange = () => {
    const t = $('#integ-type').value;
    const hostEl = $('#integ-host');
    if (!hostEl.value) hostEl.placeholder = _integDefaultHost(t) || 'gitlab.example.com';
    const gh = $('#integ-gh-login');
    if (gh) gh.style.display = t === 'github' ? 'block' : 'none';
  };
  // GitHub OAuth Device Flow login — fills token + username on success
  const ghBtn = $('#integ-gh-btn');
  if (ghBtn) ghBtn.onclick = () => _githubDeviceLogin(ghBtn);
}

let _ghLoginBusy = false;
async function _githubDeviceLogin(btn) {
  if (_ghLoginBusy) return;
  const statusEl = $('#integ-gh-status');
  const setStat = (html) => { if ($('#integ-gh-status')) $('#integ-gh-status').innerHTML = html; };
  _ghLoginBusy = true;
  btn.disabled = true;
  setStat('Requesting code…');
  try {
    const start = await window.api.githubDeviceStart();
    if (!start || !start.ok) { throw new Error(start?.error || 'Could not start GitHub login'); }

    try { await window.api.copy(start.userCode); } catch {}
    try { await window.api.openExternal(start.verificationUri); } catch {}
    setStat(`Enter code <strong style="color: var(--text-1); letter-spacing: 1px;">${escapeHtml(start.userCode)}</strong> at ${escapeHtml(start.verificationUri)} (copied) — waiting…`);

    let interval = (start.interval || 5) * 1000;
    const deadline = Date.now() + (start.expiresIn || 900) * 1000;
    // Poll until authorized, expired, or the editor modal closed.
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      if (!$('#integ-token')) { _ghLoginBusy = false; return; } // editor closed — abort silently
      const res = await window.api.githubDevicePoll({ deviceCode: start.deviceCode });
      if (res && res.ok) {
        $('#integ-token').value = res.token;
        if (res.username && !$('#integ-username').value) $('#integ-username').value = res.username;
        setStat(`<span style="color: var(--ok, #6ee7b7);">✓ Logged in${res.username ? ' as ' + escapeHtml(res.username) : ''} — click SAVE</span>`);
        toast('GitHub login successful', 'ok');
        _ghLoginBusy = false;
        btn.disabled = false;
        return;
      }
      if (res && res.pending) {
        if (res.slowDown) interval = res.slowDown * 1000;
        continue;
      }
      throw new Error(res?.error || 'GitHub login failed');
    }
    throw new Error('Login timed out — try again');
  } catch (e) {
    setStat(`<span style="color: var(--danger, #f87171);">${escapeHtml(e.message)}</span>`);
    toast(e.message, 'error');
  } finally {
    _ghLoginBusy = false;
    if (btn) btn.disabled = false;
  }
}

// Wire Settings to also expose Integrations
const _origOpenSettingsModal4 = openSettingsModal;
openSettingsModal = function () {
  _origOpenSettingsModal4();
  const body = $('#modal-body');
  if (!body) return;
  const extra = document.createElement('div');
  extra.innerHTML = `
    <div class="settings-row" style="margin-top: 10px;">
      <div><div class="settings-label">Integrations</div><div class="settings-sub">GitHub, GitLab, self-hosted GitLab, Bitbucket — tokens + hosts.</div></div>
      <button class="csh-action" id="set-open-integ">Manage…</button>
    </div>
  `;
  body.appendChild(extra);
  $('#set-open-integ').onclick = () => { $('#modal-backdrop').classList.add('hidden'); openIntegrationsManager(); };
};

// ─────────────────────── Sound manager ───────────────────────
// Plays a short SFX for toast() outcomes. Each kind has its own volume slider
// in Settings; a master multiplier scales them all. Audio elements are
// constructed lazily and cached so playback is instant after the first call.
const SFX_SOURCES = {
  ok:    '../assets/sfx/success.mp3',
  warn:  '../assets/sfx/error.mp3',
  error: '../assets/sfx/error.mp3',
};
const SFX_LABELS = { ok: 'Success', warn: 'Warning', error: 'Error' };
const SFX_DEFAULTS = { enabled: true, master: 0.7, kinds: { ok: 0.8, warn: 0.7, error: 0.9 } };
function _ensureSoundDefaults() {
  // Called lazily because loadSettings() replaces state.settings after module init.
  const cur = state.settings.sound || {};
  state.settings.sound = {
    enabled: cur.enabled !== undefined ? cur.enabled : SFX_DEFAULTS.enabled,
    master:  typeof cur.master === 'number' ? cur.master : SFX_DEFAULTS.master,
    kinds:   { ...SFX_DEFAULTS.kinds, ...(cur.kinds || {}) },
  };
  return state.settings.sound;
}

const _sfxCache = {};
function _sfxGet(kind) {
  const src = SFX_SOURCES[kind];
  if (!src) return null;
  if (!_sfxCache[kind]) {
    const a = new Audio(src);
    a.preload = 'auto';
    _sfxCache[kind] = a;
  }
  return _sfxCache[kind];
}
function _sfxEffectiveVolume(kind) {
  const s = _ensureSoundDefaults();
  const k = typeof s.kinds[kind] === 'number' ? s.kinds[kind] : 0.8;
  const m = typeof s.master === 'number' ? s.master : 0.7;
  return Math.max(0, Math.min(1, k * m));
}
function playSfx(kind) {
  const s = _ensureSoundDefaults();
  if (s.enabled === false) return;
  const base = _sfxGet(kind);
  if (!base) return;
  // Clone so overlapping toasts don't cut each other off.
  const node = base.cloneNode(true);
  node.volume = _sfxEffectiveVolume(kind);
  const p = node.play();
  if (p && p.catch) p.catch(() => {}); // ignore autoplay-policy rejections
}
// Warm the audio cache at idle so the first toast doesn't stutter.
const _warmSfx = () => { try { _sfxGet('ok'); _sfxGet('error'); } catch {} };
if (typeof requestIdleCallback === 'function') requestIdleCallback(_warmSfx, { timeout: 3000 });
else setTimeout(_warmSfx, 1500);

function _renderSoundRows() {
  const s = _ensureSoundDefaults();
  const row = (kind) => {
    const v = (s.kinds[kind] ?? 0.8);
    return `
      <div class="sfx-row" data-kind="${kind}">
        <div class="sfx-label">${SFX_LABELS[kind]}</div>
        <input class="sfx-slider" type="range" min="0" max="1" step="0.01" value="${v}" data-kind="${kind}"/>
        <div class="sfx-val" data-kind="${kind}">${Math.round(v * 100)}%</div>
        <button class="csh-action sfx-preview" data-kind="${kind}" title="Preview">▶</button>
      </div>
    `;
  };
  return `
    <div class="settings-row">
      <div><div class="settings-label">Enable sounds</div><div class="settings-sub">Plays SFX on toast notifications.</div></div>
      <select id="set-sfx-enabled">
        <option value="true"  ${s.enabled !== false ? 'selected' : ''}>On</option>
        <option value="false" ${s.enabled === false ? 'selected' : ''}>Off</option>
      </select>
    </div>
    <div class="sfx-row sfx-master">
      <div class="sfx-label"><strong>Master volume</strong></div>
      <input class="sfx-slider" id="sfx-master" type="range" min="0" max="1" step="0.01" value="${s.master ?? 0.7}"/>
      <div class="sfx-val" id="sfx-master-val">${Math.round((s.master ?? 0.7) * 100)}%</div>
      <button class="csh-action sfx-preview" data-kind="ok" title="Preview success at master">▶</button>
    </div>
    ${row('ok')}
    ${row('warn')}
    ${row('error')}
  `;
}

function _attachSoundHandlers() {
  const s = _ensureSoundDefaults();
  const enabledEl = $('#set-sfx-enabled');
  if (enabledEl) enabledEl.onchange = () => { s.enabled = enabledEl.value === 'true'; };
  const master = $('#sfx-master');
  const masterVal = $('#sfx-master-val');
  if (master) master.oninput = () => {
    s.master = parseFloat(master.value);
    if (masterVal) masterVal.textContent = Math.round(s.master * 100) + '%';
  };
  $$('.sfx-slider[data-kind]').forEach(sl => {
    sl.oninput = () => {
      const kind = sl.dataset.kind;
      s.kinds[kind] = parseFloat(sl.value);
      const valEl = document.querySelector(`.sfx-val[data-kind="${kind}"]`);
      if (valEl) valEl.textContent = Math.round(s.kinds[kind] * 100) + '%';
    };
  });
  $$('.sfx-preview').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const wasEnabled = s.enabled;
      s.enabled = true;            // preview ignores the toggle
      playSfx(btn.dataset.kind);
      s.enabled = wasEnabled;
    };
  });
}

const _origOpenSettingsModal5 = openSettingsModal;
openSettingsModal = function () {
  _origOpenSettingsModal5();
  const body = $('#modal-body');
  if (!body) return;
  const extra = document.createElement('div');
  extra.innerHTML = `
    <hr style="border: none; border-top: 1px solid var(--line); margin: 14px 0;"/>
    <label>SOUNDS</label>
    <p style="font-size: 11px; color: var(--text-3); margin-bottom: 8px;">Per-kind volume; master multiplies all. Click ▶ to preview.</p>
    ${_renderSoundRows()}
  `;
  body.appendChild(extra);
  _attachSoundHandlers();
};
