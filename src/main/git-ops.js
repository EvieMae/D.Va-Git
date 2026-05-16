module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;
// ---------- Window controls ----------
ipcMain.handle('window:minimize', () => S.mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (S.mainWindow?.isMaximized()) S.mainWindow.unmaximize();
  else S.mainWindow?.maximize();
});
ipcMain.handle('window:close', () => S.mainWindow?.close());

// ---------- Repository ----------
ipcMain.handle('repo:pickFolder', async () => {
  const result = await dialog.showOpenDialog(S.mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick a git repository',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('repo:open', async (event, repoPath) => {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return { ok: false, error: 'Path does not exist' };
  }
  try {
    const candidate = simpleGit(repoPath);
    const isRepo = await candidate.checkIsRepo();
    if (!isRepo) {
      return { ok: false, error: 'Not a git repository' };
    }
    S.git = candidate;
    S.currentRepoPath = repoPath;
    core.addRecentRepo(repoPath);
    return { ok: true, path: repoPath, name: path.basename(repoPath) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('repo:init', async (event, repoPath) => {
  try {
    const candidate = simpleGit(repoPath);
    await candidate.init();
    S.git = candidate;
    S.currentRepoPath = repoPath;
    core.addRecentRepo(repoPath);
    return { ok: true, path: repoPath, name: path.basename(repoPath) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('repo:clone', async (event, { url, dest }) => {
  try {
    const finalDest = dest || path.join(os.homedir(), 'dvagit-clones', path.basename(url, '.git'));
    fs.mkdirSync(path.dirname(finalDest), { recursive: true });
    await simpleGit().clone(url, finalDest);
    S.git = simpleGit(finalDest);
    S.currentRepoPath = finalDest;
    core.addRecentRepo(finalDest);
    return { ok: true, path: finalDest, name: path.basename(finalDest) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('repo:recent', () => core.loadRecentRepos());

ipcMain.handle('repo:current', () => S.currentRepoPath ? { path: S.currentRepoPath, name: path.basename(S.currentRepoPath) } : null);

ipcMain.handle('git:status', async () => {
  try {
    const g = core.requireRepo();
    const s = await g.status();
    return { ok: true, data: core.plain(s) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:log', async (event, opts = {}) => {
  try {
    const g = core.requireRepo();
    const maxCount = opts.maxCount || 200;
    const out = await g.raw(['log', '--all', '--date-order', `-n${maxCount}`, `--format=${core.LOG_FMT}`]);
    return { ok: true, data: core.parseRawLog(out) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:branches', async () => {
  try {
    const g = core.requireRepo();
    const local = await g.branchLocal();
    const all = await g.branch(['-a']);
    return { ok: true, data: { local: core.plain(local), all: core.plain(all) } };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:remotes', async () => {
  try {
    const g = core.requireRepo();
    const remotes = await g.getRemotes(true);
    return { ok: true, data: core.plain(remotes) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:tags', async () => {
  try {
    const g = core.requireRepo();
    const tags = await g.tags();
    return { ok: true, data: core.plain(tags) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stashList', async () => {
  try {
    const g = core.requireRepo();
    const stash = await g.stashList();
    return { ok: true, data: core.plain(stash) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:diff', async (event, { file, staged }) => {
  try {
    const g = core.requireRepo();
    const args = [];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    const diff = await g.diff(args);
    return { ok: true, data: diff };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:diffCommit', async (event, hash) => {
  try {
    const g = core.requireRepo();
    const show = await g.show([hash, '--stat', '--patch']);
    return { ok: true, data: show };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:commitFiles', async (event, hash) => {
  try {
    const g = core.requireRepo();
    // --name-status gives "M\tpath" / "A\tpath" / "R100\told\tnew" etc.
    const raw = await g.raw(['show', '--name-status', '--format=', hash]);
    const files = raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split('\t');
        const status = parts[0];
        if (status.startsWith('R') || status.startsWith('C')) {
          return { status: status[0], path: parts[2], from: parts[1] };
        }
        return { status: status[0], path: parts[1] };
      });
    return { ok: true, data: files };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:fileDiffAtCommit', async (event, { hash, file }) => {
  try {
    const g = core.requireRepo();
    const diff = await g.raw(['show', hash, '--', file]);
    return { ok: true, data: diff };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stage', async (event, files) => {
  try {
    const g = core.requireRepo();
    await g.add(files);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:unstage', async (event, files) => {
  try {
    const g = core.requireRepo();
    await g.reset(['HEAD', '--', ...(Array.isArray(files) ? files : [files])]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:commit', async (event, { message, amend }) => {
  try {
    const g = core.requireRepo();
    const opts = amend ? ['--amend'] : [];
    await g.commit(message, undefined, opts);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:push', async (event, { remote, branch, force } = {}) => {
  try {
    const g = core.requireRepo();
    const opts = force ? ['--force'] : [];
    const r = await g.push(remote || 'origin', branch, opts);
    return { ok: true, data: core.plain(r) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:pull', async (event, { remote, branch } = {}) => {
  try {
    const g = core.requireRepo();
    const r = await g.pull(remote || 'origin', branch);
    return { ok: true, data: core.plain(r) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:fetch', async (event, { remote } = {}) => {
  try {
    const g = core.requireRepo();
    const r = await g.fetch(remote || 'origin');
    return { ok: true, data: core.plain(r) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:checkout', async (event, ref) => {
  try {
    const g = core.requireRepo();
    await g.checkout(ref);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:createBranch', async (event, name) => {
  try {
    const g = core.requireRepo();
    await g.checkoutLocalBranch(name);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:deleteBranch', async (event, { name, force }) => {
  try {
    const g = core.requireRepo();
    await g.deleteLocalBranch(name, !!force);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:merge', async (event, ref) => {
  try {
    const g = core.requireRepo();
    await g.merge([ref]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:rebase', async (event, onto) => {
  try {
    const g = core.requireRepo();
    await g.rebase([onto]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stash', async (event, message) => {
  try {
    const g = core.requireRepo();
    if (message) await g.stash(['push', '-m', message]);
    else await g.stash();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stashPop', async () => {
  try {
    const g = core.requireRepo();
    await g.stash(['pop']);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stashApply', async (event, idx) => {
  try {
    const g = core.requireRepo();
    await g.stash(['apply', `stash@{${idx}}`]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:stashDrop', async (event, idx) => {
  try {
    const g = core.requireRepo();
    await g.stash(['drop', `stash@{${idx}}`]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:discardFile', async (event, file) => {
  try {
    const g = core.requireRepo();
    await g.checkout(['--', file]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:userConfig', async () => {
  try {
    const g = core.requireRepo();
    const name = (await g.raw(['config', 'user.name'])).trim();
    const email = (await g.raw(['config', 'user.email'])).trim();
    return { ok: true, data: { name, email } };
  } catch (e) {
    return { ok: true, data: { name: '', email: '' } };
  }
});

ipcMain.handle('git:setUserConfig', async (event, { name, email, scope = 'local' }) => {
  try {
    const g = core.requireRepo();
    const args = scope === 'global' ? ['--global'] : [];
    if (name) await g.raw(['config', ...args, 'user.name', name]);
    if (email) await g.raw(['config', ...args, 'user.email', email]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

};
