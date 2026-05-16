// Shared state + cross-module helpers for the split Electron main process.
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const S = { mainWindow: null, currentRepoPath: null, git: null };

function recentReposFile() {
  return path.join(app.getPath('userData'), 'recent-repos.json');
}

function loadRecentRepos() {
  try {
    const f = recentReposFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {}
  return [];
}

function saveRecentRepos(repos) {
  try {
    fs.writeFileSync(recentReposFile(), JSON.stringify(repos.slice(0, 10)));
  } catch (e) {}
}

function addRecentRepo(repoPath) {
  let repos = loadRecentRepos().filter(r => r !== repoPath);
  repos.unshift(repoPath);
  saveRecentRepos(repos);
}

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadWindowState() {
  try {
    const f = windowStateFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {}
  return null;
}
function saveWindowState() {
  if (!S.mainWindow) return;
  try {
    const isMax = S.mainWindow.isMaximized();
    const bounds = isMax ? S.mainWindow.getNormalBounds() : S.mainWindow.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, maximized: isMax }));
  } catch (e) {}
}

function sessionFile() {
  return path.join(app.getPath('userData'), 'session.json');
}

function requireRepo() {
  if (!S.git) throw new Error('No repository opened');
  return S.git;
}

function plain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Field-separator + record-separator that won't appear in commit data.
const LOG_SEP = '\x1F';   // unit separator
const LOG_REC = '\x1E';   // record separator
// Order: hash, isoDate, authorName, authorEmail, parents, refs, subject, body
const LOG_FMT = ['%H', '%aI', '%aN', '%aE', '%P', '%D', '%s', '%b'].join(LOG_SEP) + LOG_REC;

function parseRawLog(out) {
  return out.split(LOG_REC).map(rec => rec.replace(/^[\r\n]+/, '')).filter(Boolean).map(rec => {
    const parts = rec.split(LOG_SEP);
    return {
      hash: parts[0] || '',
      date: parts[1] || '',
      author_name: parts[2] || '',
      author_email: parts[3] || '',
      parents: parts[4] || '',
      refs: parts[5] || '',
      message: parts[6] || '',
      body: parts[7] || '',
    };
  });
}

function buildTreeFromPaths(paths) {
  const root = { __children: new Map() };
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      if (!node.__children.has(name)) {
        node.__children.set(name, { __children: new Map() });
      }
      node = node.__children.get(name);
    }
    node.__isFile = true;
  }
  const toArr = (node, prefix) => {
    const out = [];
    for (const [name, child] of node.__children) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.__isFile && child.__children.size === 0) {
        out.push({ path: rel, type: 'file' });
      } else {
        out.push({ path: rel, type: 'dir', children: toArr(child, rel) });
      }
    }
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    return out;
  };
  return toArr(root, '');
}

function encryptToken(plain) {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64');
    }
  } catch {}
  return 'raw:' + plain;
}
function decryptToken(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')); }
    catch { return ''; }
  }
  if (stored.startsWith('raw:')) return stored.slice(4);
  return stored;
}

module.exports = {
  S,
  recentReposFile, loadRecentRepos, saveRecentRepos, addRecentRepo,
  windowStateFile, loadWindowState, saveWindowState, sessionFile,
  requireRepo, plain,
  LOG_SEP, LOG_REC, LOG_FMT, parseRawLog,
  buildTreeFromPaths, encryptToken, decryptToken,
};
