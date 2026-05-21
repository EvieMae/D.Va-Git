module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;

// Resolve the actual .git/hooks dir for the current repo. Works with
// worktrees, where .git is a file containing 'gitdir: <path>'.
function resolveHooksDir() {
  if (!S.currentRepoPath) throw new Error('No repository opened');
  const gd = path.join(S.currentRepoPath, '.git');
  let gitDir = gd;
  if (fs.existsSync(gd) && fs.statSync(gd).isFile()) {
    const c = fs.readFileSync(gd, 'utf8').trim();
    const m = c.match(/^gitdir:\s*(.+)$/);
    if (m) gitDir = path.resolve(S.currentRepoPath, m[1]);
  }
  // For linked worktrees, hooks live in the common dir, not the per-worktree gitdir.
  const commonFile = path.join(gitDir, 'commondir');
  if (fs.existsSync(commonFile)) {
    try {
      const rel = fs.readFileSync(commonFile, 'utf8').trim();
      if (rel) gitDir = path.resolve(gitDir, rel);
    } catch {}
  }
  return path.join(gitDir, 'hooks');
}

function safeHookPath(name) {
  const dir = resolveHooksDir();
  // Prevent path traversal: only allow simple file names.
  if (!name || typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Invalid hook name');
  }
  return { dir, full: path.join(dir, name) };
}

ipcMain.handle('hooks:list', async () => {
  try {
    const dir = resolveHooksDir();
    if (!fs.existsSync(dir)) return { ok: true, data: [] };
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => {
        const full = path.join(dir, e.name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        return { name: e.name, isSample: e.name.endsWith('.sample'), size };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: entries };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('hooks:read', async (event, { name }) => {
  try {
    const { full } = safeHookPath(name);
    try {
      return { ok: true, data: fs.readFileSync(full, 'utf8') };
    } catch (e) {
      if (e.code === 'ENOENT') return { ok: true, data: '' };
      throw e;
    }
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('hooks:write', async (event, { name, content }) => {
  try {
    const { dir, full } = safeHookPath(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content == null ? '' : String(content), 'utf8');
    if (process.platform !== 'win32') {
      try { fs.chmodSync(full, 0o755); } catch {}
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

};
