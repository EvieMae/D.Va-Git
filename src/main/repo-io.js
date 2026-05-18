module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;
// ---------- Remote management ----------
ipcMain.handle('git:remoteAdd', async (event, { name, url }) => {
  try {
    const g = core.requireRepo();
    await g.addRemote(name, url);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:remoteRemove', async (event, name) => {
  try {
    const g = core.requireRepo();
    await g.removeRemote(name);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:remoteRename', async (event, { from, to }) => {
  try {
    const g = core.requireRepo();
    await g.raw(['remote', 'rename', from, to]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:remoteSetUrl', async (event, { name, url }) => {
  try {
    const g = core.requireRepo();
    await g.raw(['remote', 'set-url', name, url]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- File read/write (for in-app editor) ----------
ipcMain.handle('file:read', async (event, relPath) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    const abs = path.resolve(S.currentRepoPath, relPath);
    if (!abs.startsWith(S.currentRepoPath)) throw new Error('Path outside repo');
    if (!fs.existsSync(abs)) return { ok: true, data: '' };
    const stat = fs.statSync(abs);
    if (stat.size > 5 * 1024 * 1024) throw new Error('File too large (>5MB)');
    const content = fs.readFileSync(abs, 'utf8');
    return { ok: true, data: content };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('file:readBinary', async (event, relPath) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    const abs = path.resolve(S.currentRepoPath, relPath);
    if (!abs.startsWith(S.currentRepoPath)) throw new Error('Path outside repo');
    if (!fs.existsSync(abs)) throw new Error('File not found');
    const stat = fs.statSync(abs);
    if (stat.size > 100 * 1024 * 1024) throw new Error('File too large (>100MB)');
    const buf = fs.readFileSync(abs);
    return { ok: true, data: buf.toString('base64'), size: stat.size };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:lfsFiles', async () => {
  try {
    const g = core.requireRepo();
    try {
      const out = await g.raw(['lfs', 'ls-files', '--name-only']);
      return { ok: true, data: out.split('\n').map(s => s.trim()).filter(Boolean) };
    } catch (e) {
      return { ok: true, data: [] };
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('file:write', async (event, { path: relPath, content }) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    const abs = path.resolve(S.currentRepoPath, relPath);
    if (!abs.startsWith(S.currentRepoPath)) throw new Error('Path outside repo');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Stash variants ----------
ipcMain.handle('git:stashStaged', async (event, message) => {
  try {
    const g = core.requireRepo();
    const args = ['push', '--staged'];
    if (message) args.push('-m', message);
    await g.stash(args);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Log scoped to a branch ----------
ipcMain.handle('git:logBranch', async (event, { branch, maxCount = 300 }) => {
  try {
    const g = core.requireRepo();
    const args = ['log'];
    if (!branch || branch === '*') args.push('--all', '--date-order');
    else args.push(branch);
    args.push(`-n${maxCount}`, `--format=${core.LOG_FMT}`);
    const out = await g.raw(args);
    return { ok: true, data: core.parseRawLog(out) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Repo tree (for file editor) ----------
function walkTree(dir, base, depth = 0, max = 4) {
  if (depth > max) return [];
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    if (name === '.git' || name === 'node_modules') continue;
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs).replace(/\\/g, '/');
    let stat;
    try { stat = fs.statSync(abs); } catch (e) { continue; }
    if (stat.isDirectory()) {
      out.push({ path: rel, type: 'dir', children: walkTree(abs, base, depth + 1, max) });
    } else {
      if (stat.size > 5 * 1024 * 1024) continue;
      out.push({ path: rel, type: 'file', size: stat.size });
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return out;
}

ipcMain.handle('repo:tree', async (_e, opts = {}) => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    if (opts && opts.trackedOnly && git) {
      // Tracked + staged-added files, honoring .gitignore implicitly.
      const out = await S.git.raw(['ls-files', '--cached', '--others', '--exclude-standard']);
      const paths = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return { ok: true, data: core.buildTreeFromPaths(paths) };
    }
    return { ok: true, data: walkTree(S.currentRepoPath, S.currentRepoPath) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Settings ----------
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULT_SETTINGS = {
  graphMaxCommits: 300,
  defaultRemote: 'origin',
  showAvatars: true,
  // Ordered fallback chain. Each entry: { source, enabled }.
  // Sources: 'github' (GitHub noreply email → avatars.githubusercontent.com),
  // 'gravatar' (md5 of email), 'initials' (offline letters w/ colored bg).
  avatarSources: [
    { source: 'github',   enabled: true },
    { source: 'gravatar', enabled: true },
    { source: 'initials', enabled: true },
  ],
  rightPaneWidth: 420,
  sidebarWidth: 256,
  sectionHeights: { local: 180, remote: 180, stashes: 140, tags: 140 },
};

ipcMain.handle('settings:read', () => {
  try {
    const f = settingsFile();
    if (fs.existsSync(f)) {
      const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
});

ipcMain.handle('settings:write', (event, data) => {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Session (open repo tabs) ----------
ipcMain.handle('session:read', () => {
  try {
    const f = core.sessionFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {}
  return { openRepos: [], activeRepoIndex: -1 };
});

ipcMain.handle('session:write', (event, data) => {
  try {
    fs.writeFileSync(core.sessionFile(), JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

};
