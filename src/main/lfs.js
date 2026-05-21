module.exports = (core) => {
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { S } = core;

// Detect a "git lfs not installed" style error so the renderer can show a
// friendly message instead of the raw stderr from git.
function isLfsMissing(e) {
  const msg = String((e && (e.message || e.stderr)) || '');
  if (!msg) return false;
  if (/lfs is not a git command/i.test(msg)) return true;
  if (/'lfs' is not a git command/i.test(msg)) return true;
  if (/git: 'lfs'/i.test(msg)) return true;
  if (e && (e.code === 'ENOENT')) return true;
  return false;
}

const LFS_MISSING = 'Git LFS is not installed on this system.';

// ---------- LFS: parse .gitattributes for filter=lfs patterns ----------
ipcMain.handle('lfs:patterns', async () => {
  try {
    if (!S.currentRepoPath) throw new Error('No repository opened');
    const file = path.join(S.currentRepoPath, '.gitattributes');
    if (!fs.existsSync(file)) return { ok: true, data: [] };
    const text = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (!/filter=lfs/i.test(line)) continue;
      const tok = line.split(/\s+/)[0];
      if (tok) out.push({ pattern: tok });
    }
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- LFS: pull objects ----------
ipcMain.handle('lfs:pull', async () => {
  try {
    const g = core.requireRepo();
    const out = await g.raw(['lfs', 'pull']);
    return { ok: true, out };
  } catch (e) {
    if (isLfsMissing(e)) return { ok: false, error: LFS_MISSING };
    return { ok: false, error: e.message };
  }
});

// ---------- LFS: fsck verify ----------
ipcMain.handle('lfs:fsck', async () => {
  try {
    const g = core.requireRepo();
    const out = await g.raw(['lfs', 'fsck']);
    return { ok: true, out };
  } catch (e) {
    if (isLfsMissing(e)) return { ok: false, error: LFS_MISSING };
    return { ok: false, error: e.message };
  }
});

// ---------- LFS: track a new pattern ----------
ipcMain.handle('lfs:track', async (_e, { pattern } = {}) => {
  try {
    if (!pattern || typeof pattern !== 'string') throw new Error('Pattern required');
    const g = core.requireRepo();
    await g.raw(['lfs', 'track', pattern]);
    return { ok: true };
  } catch (e) {
    if (isLfsMissing(e)) return { ok: false, error: LFS_MISSING };
    return { ok: false, error: e.message };
  }
});

};
