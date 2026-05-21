module.exports = (core) => {
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const SP_FILE = () => path.join(app.getPath('userData'), 'scratchpad.json');
function _readAll() { try { return JSON.parse(fs.readFileSync(SP_FILE(), 'utf8')); } catch { return {}; } }

ipcMain.handle('scratchpad:read', () => {
  const all = _readAll();
  return { ok: true, data: (core.S.currentRepoPath && all[core.S.currentRepoPath]) || '' };
});

ipcMain.handle('scratchpad:write', (event, { text } = {}) => {
  try {
    if (!core.S.currentRepoPath) return { ok: false };
    const all = _readAll();
    all[core.S.currentRepoPath] = String(text || '');
    fs.writeFileSync(SP_FILE(), JSON.stringify(all));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

};
