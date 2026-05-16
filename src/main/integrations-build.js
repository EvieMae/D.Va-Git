module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;
// ---------- Integrations (GitHub / GitLab / GitLab self-hosted / Bitbucket) ----------
function integrationsFile() { return path.join(app.getPath('userData'), 'integrations.json'); }
ipcMain.handle('integrations:read', () => {
  try {
    const f = integrationsFile();
    if (!fs.existsSync(f)) return { integrations: [] };
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const integrations = (raw.integrations || []).map(i => ({
      ...i,
      token: core.decryptToken(i.token || ''),
    }));
    return { integrations };
  } catch (e) { return { integrations: [] }; }
});
ipcMain.handle('integrations:write', (event, data) => {
  try {
    const toSave = {
      integrations: (data.integrations || []).map(i => ({
        ...i,
        token: core.encryptToken(i.token || ''),
      })),
    };
    fs.writeFileSync(integrationsFile(), JSON.stringify(toSave, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- GitHub: OAuth Device Flow login (no client secret needed) ----------
// Registered GitHub OAuth App client ID. Not a secret — embedded in distributed apps.
const GITHUB_CLIENT_ID = 'Ov23li7GhyONJ3I3MfS5';
const GITHUB_SCOPE = 'repo read:user';

// Step 1: request a device + user code. Renderer shows user_code, opens verification_uri.
ipcMain.handle('github:deviceStart', async () => {
  try {
    const r = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPE }),
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { d = null; }
    if (!r.ok || !d || !d.device_code) {
      throw new Error(`GitHub device code request failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return {
      ok: true,
      deviceCode: d.device_code,
      userCode: d.user_code,
      verificationUri: d.verification_uri,
      interval: d.interval || 5,
      expiresIn: d.expires_in || 900,
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Step 2: poll once for the access token. Renderer drives the polling loop.
// Returns { pending:true } until the user authorizes, then { ok:true, token, username }.
ipcMain.handle('github:devicePoll', async (event, { deviceCode }) => {
  try {
    if (!deviceCode) throw new Error('No device code');
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.error === 'authorization_pending') return { ok: false, pending: true };
    if (d.error === 'slow_down') return { ok: false, pending: true, slowDown: d.interval || 5 };
    if (d.error === 'expired_token') return { ok: false, error: 'Code expired — start over.' };
    if (d.error === 'access_denied') return { ok: false, error: 'Authorization was denied.' };
    if (d.error || !d.access_token) {
      return { ok: false, error: d.error_description || d.error || 'Unknown GitHub error' };
    }
    const token = d.access_token;
    // Resolve the username so the integration entry auto-fills.
    let username = '';
    try {
      const ur = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
      });
      if (ur.ok) { const u = await ur.json(); username = u.login || ''; }
    } catch {}
    return { ok: true, token, username };
  } catch (e) { return { ok: false, error: e.message }; }
});

// List repositories the connected GitHub account can clone, using a saved
// integration token (host github.com). Returns newest-updated first.
ipcMain.handle('github:listRepos', async () => {
  try {
    const integ = core.loadIntegrations()
      .find(i => i.token && (i.type === 'github' || String(i.host).toLowerCase() === 'github.com'));
    if (!integ) return { ok: false, error: 'No GitHub integration with a token. Add one in Settings → Integrations.' };
    const repos = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        { headers: { 'Authorization': `Bearer ${integ.token}`, 'Accept': 'application/vnd.github+json' } }
      );
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        if (r.status === 401) throw new Error('GitHub token rejected (401) — re-login in Settings → Integrations.');
        throw new Error(`GitHub API ${r.status}: ${txt.slice(0, 200)}`);
      }
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const x of batch) {
        repos.push({
          fullName: x.full_name,
          cloneUrl: x.clone_url,
          private: !!x.private,
          description: x.description || '',
          updatedAt: x.updated_at,
        });
      }
      if (batch.length < 100) break;
    }
    return { ok: true, repos, account: integ.username || '' };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Discord: fetch user via bot token ----------
ipcMain.handle('discord:fetchUser', async (event, { token, userId }) => {
  try {
    if (!token) throw new Error('No Discord bot token configured');
    if (!userId) throw new Error('No user ID');
    const r = await fetch(`https://discord.com/api/v10/users/${encodeURIComponent(userId)}`, {
      headers: { 'Authorization': `Bot ${token}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      if (r.status === 401) {
        throw new Error(
          `Discord auth failed (401). Paste the Bot Token from "Bot → Reset Token" in the Developer Portal — not the Client Secret, Public Key, or App ID. ` +
          `API said: ${txt.slice(0, 200)}`
        );
      }
      if (r.status === 403) throw new Error(`Discord forbidden (403): ${txt.slice(0, 200)}`);
      if (r.status === 404) throw new Error(`Discord user not found (404). Double-check the user ID. API said: ${txt.slice(0, 200)}`);
      if (r.status === 429) throw new Error('Discord rate-limited — try again in a minute');
      throw new Error(`Discord API ${r.status}: ${txt.slice(0, 200)}`);
    }
    const u = await r.json();
    let avatarUrl;
    if (u.avatar) {
      const ext = u.avatar.startsWith('a_') ? 'gif' : 'png';
      avatarUrl = `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=128`;
    } else {
      // Default avatar — new accounts use (id >> 22) % 6, legacy uses discriminator % 5
      let idx;
      if (u.discriminator && u.discriminator !== '0') {
        idx = parseInt(u.discriminator, 10) % 5;
      } else {
        try { idx = Number((BigInt(u.id) >> 22n) % 6n); }
        catch { idx = 0; }
      }
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }
    return {
      ok: true,
      data: {
        id: u.id,
        username: u.username || '',
        globalName: u.global_name || u.username || '',
        discriminator: u.discriminator || '0',
        avatarUrl,
      },
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Pick an image file (absolute path) for a custom avatar
ipcMain.handle('dialog:pickImage', async () => {
  const r = await dialog.showOpenDialog(S.mainWindow, {
    title: 'Pick an avatar image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0];
});

// Read any absolute path and return as base64 + mime (for avatars)
ipcMain.handle('file:readAbsBinary', async (event, abs) => {
  try {
    if (!abs || !fs.existsSync(abs)) throw new Error('File not found');
    const stat = fs.statSync(abs);
    if (stat.size > 10 * 1024 * 1024) throw new Error('File too large (>10MB)');
    const buf = fs.readFileSync(abs);
    const ext = (path.extname(abs).slice(1) || '').toLowerCase();
    const mime = ({
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    })[ext] || 'application/octet-stream';
    return { ok: true, data: buf.toString('base64'), mime };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Open an external URL (https://, discord://, etc.)
ipcMain.handle('shell:openExternal', async (event, url) => {
  try { await shell.openExternal(url); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:branchTracking', async () => {
  try {
    const g = core.requireRepo();
    const raw = await g.raw([
      'for-each-ref',
      '--format=%(refname:short)|%(upstream:short)|%(upstream:track)',
      'refs/heads/',
    ]);
    const out = raw.split('\n').filter(Boolean).map(line => {
      const [name, upstream, track] = line.split('|');
      let ahead = 0, behind = 0, gone = false;
      if (track === '[gone]') gone = true;
      else if (track) {
        const a = track.match(/ahead (\d+)/);
        const b = track.match(/behind (\d+)/);
        if (a) ahead = parseInt(a[1], 10);
        if (b) behind = parseInt(b[1], 10);
      }
      return { name, upstream: upstream || '', ahead, behind, gone };
    });
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- HEAD info (for local-only commits counter) ----------
ipcMain.handle('git:upstreamCounts', async () => {
  try {
    const g = core.requireRepo();
    const s = await g.status();
    return { ok: true, data: { ahead: s.ahead, behind: s.behind, current: s.current, tracking: s.tracking } };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Repo state: merge / rebase / cherry-pick in progress ----------
ipcMain.handle('git:opState', async () => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    const gd = path.join(S.currentRepoPath, '.git');
    let gitDir = gd;
    // Worktrees use a file at .git
    if (fs.existsSync(gd) && fs.statSync(gd).isFile()) {
      const c = fs.readFileSync(gd, 'utf8').trim();
      const m = c.match(/^gitdir:\s*(.+)$/);
      if (m) gitDir = path.resolve(S.currentRepoPath, m[1]);
    }
    const state = {
      merging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
      rebasing: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')),
      cherryPicking: fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD')),
      reverting: fs.existsSync(path.join(gitDir, 'REVERT_HEAD')),
      bisecting: fs.existsSync(path.join(gitDir, 'BISECT_LOG')),
    };
    return { ok: true, data: state };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:mergeAbort', async () => {
  try { await core.requireRepo().raw(['merge', '--abort']); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:mergeContinue', async () => {
  try {
    // Modern git supports `merge --continue`
    await core.requireRepo().raw(['commit', '--no-edit']);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:rebaseAbort', async () => {
  try { await core.requireRepo().raw(['rebase', '--abort']); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:rebaseContinue', async () => {
  try { await core.requireRepo().raw(['rebase', '--continue']); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:cherryPickAbort', async () => {
  try { await core.requireRepo().raw(['cherry-pick', '--abort']); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:cherryPickContinue', async () => {
  try { await core.requireRepo().raw(['cherry-pick', '--continue']); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---------- File content at a given commit (text + binary) ----------
ipcMain.handle('git:showText', async (event, { ref, file }) => {
  try {
    const g = core.requireRepo();
    const out = await g.raw(['show', `${ref}:${file}`]);
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// file tree at a given commit/ref
ipcMain.handle('git:treeAt', async (event, { ref }) => {
  try {
    const g = core.requireRepo();
    const out = await g.raw(['ls-tree', '-r', '--name-only', ref]);
    const paths = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return { ok: true, data: core.buildTreeFromPaths(paths) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:showBinary', async (event, { ref, file }) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repo');
    return await new Promise((resolve) => {
      const ps = spawn('git', ['show', `${ref}:${file}`], { cwd: S.currentRepoPath });
      const chunks = [];
      let err = '';
      ps.stdout.on('data', (c) => chunks.push(c));
      ps.stderr.on('data', (c) => { err += c.toString(); });
      ps.on('error', (e) => resolve({ ok: false, error: e.message }));
      ps.on('close', (code) => {
        if (code !== 0) return resolve({ ok: false, error: err || `git exit ${code}` });
        const buf = Buffer.concat(chunks);
        resolve({ ok: true, data: buf.toString('base64'), size: buf.length });
      });
    });
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Apply a constructed patch (hunk staging) ----------
ipcMain.handle('git:applyCached', async (event, { patch, reverse }) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repo');
    return await new Promise((resolve) => {
      const args = ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn'];
      if (reverse) args.push('--reverse');
      const ps = spawn('git', args, { cwd: S.currentRepoPath });
      let err = '';
      ps.stderr.on('data', (c) => { err += c.toString(); });
      ps.on('error', (e) => resolve({ ok: false, error: e.message }));
      ps.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: err || `git apply exit ${code}` });
      });
      ps.stdin.write(patch);
      ps.stdin.end();
    });
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Per-file diff with whitespace options ----------
ipcMain.handle('git:diffOpts', async (event, { file, staged, ignoreAll, ignoreSpace, context }) => {
  try {
    const g = core.requireRepo();
    const args = [];
    if (staged) args.push('--cached');
    if (ignoreAll) args.push('-w');
    if (ignoreSpace) args.push('-b');
    if (Number.isFinite(context)) args.push(`-U${context}`);
    if (file) args.push('--', file);
    const out = await g.diff(args);
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Submodules ----------
ipcMain.handle('git:submodules', async () => {
  try {
    const g = core.requireRepo();
    let raw = '';
    try { raw = await g.raw(['submodule', 'status', '--recursive']); } catch { raw = ''; }
    const subs = raw.split('\n').filter(Boolean).map(line => {
      // " <sha> <path> (<ref>)"  -> initialized
      // "-<sha> <path>"          -> not initialized
      // "+<sha> <path>"          -> not in sync
      const flag = line[0] || ' ';
      const rest = line.slice(1).trim();
      const m = rest.match(/^([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?$/);
      if (!m) return null;
      return {
        sha: m[1],
        path: m[2],
        describe: m[3] || '',
        initialized: flag !== '-',
        outOfSync: flag === '+',
      };
    }).filter(Boolean);
    return { ok: true, data: subs };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:submoduleUpdate', async (event, { p, init }) => {
  try {
    const g = core.requireRepo();
    const args = ['submodule', 'update'];
    if (init) args.push('--init');
    args.push('--recursive');
    if (p) args.push('--', p);
    await g.raw(args);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Worktrees ----------
ipcMain.handle('git:worktrees', async () => {
  try {
    const g = core.requireRepo();
    const raw = await g.raw(['worktree', 'list', '--porcelain']);
    const trees = [];
    let cur = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) { if (cur) trees.push(cur); cur = { path: line.slice(9) }; }
      else if (line.startsWith('HEAD ')) { if (cur) cur.head = line.slice(5); }
      else if (line.startsWith('branch ')) { if (cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, ''); }
      else if (line === 'bare') { if (cur) cur.bare = true; }
      else if (line === 'detached') { if (cur) cur.detached = true; }
      else if (line === 'locked') { if (cur) cur.locked = true; }
      else if (line.startsWith('prunable ')) { if (cur) cur.prunable = true; }
    }
    if (cur) trees.push(cur);
    return { ok: true, data: trees };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:worktreeAdd', async (event, { path: wtPath, ref }) => {
  try { await core.requireRepo().raw(['worktree', 'add', wtPath, ref]); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:worktreeRemove', async (event, p) => {
  try { await core.requireRepo().raw(['worktree', 'remove', p]); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---------- GPG / commit signing info ----------
ipcMain.handle('git:signingInfo', async () => {
  try {
    const g = core.requireRepo();
    const read = async (k) => {
      try { return (await g.raw(['config', '--get', k])).trim(); }
      catch { return ''; }
    };
    return {
      ok: true,
      data: {
        gpgsign: (await read('commit.gpgsign')) === 'true',
        signingKey: await read('user.signingkey'),
        format: await read('gpg.format') || 'openpgp',
      },
    };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:setSigning', async (event, { enabled, signingKey, format }) => {
  try {
    const g = core.requireRepo();
    await g.raw(['config', 'commit.gpgsign', enabled ? 'true' : 'false']);
    if (signingKey != null) await g.raw(['config', 'user.signingkey', signingKey]);
    if (format) await g.raw(['config', 'gpg.format', format]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Build (electron-builder) ----------
// Stores last install path so re-builds can target it. NSIS itself remembers
// via the Windows registry; this is a convenience copy + an install-path
// override the user can hand to the installer.
function buildStateFile() { return path.join(app.getPath('userData'), 'build-state.json'); }
ipcMain.handle('build:readState', () => {
  try {
    const f = buildStateFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {}
  return { installPath: '', lastInstaller: '', lastBuildAt: 0 };
});
ipcMain.handle('build:writeState', (event, data) => {
  try { fs.writeFileSync(buildStateFile(), JSON.stringify(data, null, 2)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

function projectRoot() { return path.resolve(__dirname, '..', '..'); }

// Stream build output back to the renderer via webContents.send.
ipcMain.handle('build:run', async (event) => {
  return await new Promise((resolve) => {
    const send = (channel, payload) => {
      try { S.mainWindow?.webContents.send(channel, payload); } catch {}
    };
    const cwd = projectRoot();
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    send('build:log', { line: `> cd ${cwd}\n` });
    send('build:log', { line: `> npm run build\n` });
    const ps = spawn(npmCmd, ['run', 'build'], { cwd, shell: isWin });
    ps.stdout.on('data', (c) => send('build:log', { line: c.toString() }));
    ps.stderr.on('data', (c) => send('build:log', { line: c.toString() }));
    ps.on('error', (e) => resolve({ ok: false, error: e.message }));
    ps.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false, error: `npm run build exited ${code}` });
      // Locate the installer in dist/
      const distDir = path.join(cwd, 'dist');
      let installer = '';
      try {
        const files = fs.readdirSync(distDir);
        const exe = files.find(f => /Setup.*\.exe$/i.test(f)) || files.find(f => /\.exe$/i.test(f));
        if (exe) installer = path.join(distDir, exe);
      } catch {}
      resolve({ ok: true, installer });
    });
  });
});

ipcMain.handle('build:runInstaller', async (event, installerPath) => {
  try {
    if (!installerPath || !fs.existsSync(installerPath)) throw new Error('Installer not found');
    await shell.openPath(installerPath);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('build:pickInstallPath', async () => {
  const r = await dialog.showOpenDialog(S.mainWindow, {
    title: 'Pick installation directory',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0];
});

// ---------- Interactive rebase driver ----------
// fake sequence-editor that drops our todo file into git's rebase-todo slot,
// then runs `git rebase -i`. GIT_EDITOR is stubbed so reword/edit don't pop
// vim; they just keep the message (user can reword in our UI after).
ipcMain.handle('git:rebaseInteractive', async (event, { upstream, todo }) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repo');
    const tmp = path.join(app.getPath('userData'), 'rebase-todo-' + Date.now() + '.txt');
    fs.writeFileSync(tmp, todo, 'utf8');

    const isWin = process.platform === 'win32';
    const scriptPath = path.join(app.getPath('userData'), 'dva-seq-editor' + (isWin ? '.bat' : '.sh'));
    const script = isWin
      ? `@echo off\r\ncopy /Y "${tmp}" %1 >NUL\r\nexit /B 0\r\n`
      : `#!/bin/sh\ncat "${tmp}" > "$1"\n`;
    fs.writeFileSync(scriptPath, script, 'utf8');
    if (!isWin) fs.chmodSync(scriptPath, 0o755);

    return await new Promise((resolve) => {
      const env = {
        ...process.env,
        GIT_SEQUENCE_EDITOR: isWin ? `"${scriptPath}"` : scriptPath,
        GIT_EDITOR: isWin ? 'cmd /c exit 0' : 'true',
      };
      const ps = spawn('git', ['rebase', '-i', upstream], { cwd: S.currentRepoPath, env, shell: isWin });
      let err = '';
      let out = '';
      ps.stdout.on('data', (c) => { out += c.toString(); });
      ps.stderr.on('data', (c) => { err += c.toString(); });
      ps.on('error', (e) => resolve({ ok: false, error: e.message }));
      ps.on('close', (code) => {
        try { fs.unlinkSync(tmp); } catch {}
        try { fs.unlinkSync(scriptPath); } catch {}
        if (code === 0) resolve({ ok: true, data: out });
        else resolve({ ok: false, error: (err || out || `git rebase exit ${code}`), stopped: true });
      });
    });
  } catch (e) { return { ok: false, error: e.message }; }
});
};
