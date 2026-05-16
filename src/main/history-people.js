module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;
// ---------- Commit operations (context menu) ----------
ipcMain.handle('git:cherryPick', async (event, hash) => {
  try {
    const g = core.requireRepo();
    await g.raw(['cherry-pick', hash]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:revert', async (event, { hash, noCommit }) => {
  try {
    const g = core.requireRepo();
    const args = ['revert'];
    if (noCommit) args.push('--no-commit');
    else args.push('--no-edit');
    args.push(hash);
    await g.raw(args);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:reset', async (event, { mode, hash }) => {
  try {
    const g = core.requireRepo();
    const flag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed';
    await g.raw(['reset', flag, hash]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:reword', async (event, { hash, message }) => {
  try {
    const g = core.requireRepo();
    // Only supported for HEAD; otherwise user would need rebase --interactive
    const head = (await g.revparse(['HEAD'])).trim();
    if (head !== hash) {
      throw new Error('Reword is only supported for the most recent commit (HEAD).');
    }
    await g.commit(message, undefined, ['--amend']);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:branchFromCommit', async (event, { name, hash }) => {
  try {
    const g = core.requireRepo();
    await g.raw(['branch', name, hash]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('git:restoreFromCommit', async (event, { hash, file }) => {
  try {
    const g = core.requireRepo();
    await g.raw(['checkout', hash, '--', file]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Tags ----------
ipcMain.handle('git:tagCreate', async (event, { name, ref, message, force }) => {
  try {
    const g = core.requireRepo();
    const args = ['tag'];
    if (force) args.push('-f');
    if (message) args.push('-a', name, '-m', message);
    else args.push(name);
    if (ref) args.push(ref);
    await g.raw(args);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:tagDelete', async (event, name) => {
  try {
    const g = core.requireRepo();
    await g.raw(['tag', '-d', name]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('git:tagPush', async (event, { remote, tag }) => {
  try {
    const g = core.requireRepo();
    const args = ['push', remote || 'origin'];
    if (tag) args.push('refs/tags/' + tag);
    else args.push('--tags');
    await g.raw(args);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Push with options ----------
ipcMain.handle('git:pushOpts', async (event, { remote, branch, force, forceLease, setUpstream, pushTags }) => {
  try {
    const g = core.requireRepo();
    const args = ['push'];
    if (force) args.push('--force');
    if (forceLease) args.push('--force-with-lease');
    if (setUpstream) args.push('-u');
    if (pushTags) args.push('--tags');
    args.push(remote || 'origin');
    if (branch) args.push(branch);
    const r = await g.raw(args);
    return { ok: true, data: r };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Compare any two refs ----------
ipcMain.handle('git:diffRefs', async (event, { from, to, file }) => {
  try {
    const g = core.requireRepo();
    const args = ['diff', `${from}...${to}`];
    if (file) { args.push('--'); args.push(file); }
    const out = await g.raw(args);
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- File history (log scoped to a file) ----------
ipcMain.handle('git:logFile', async (event, { file, maxCount = 200 }) => {
  try {
    const g = core.requireRepo();
    const log = await g.log([`-n${maxCount}`, '--follow', '--', file]);
    return { ok: true, data: core.plain(log.all) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Blame ----------
ipcMain.handle('git:blame', async (event, { file, ref }) => {
  try {
    const g = core.requireRepo();
    const args = ['blame', '--porcelain'];
    if (ref) args.push(ref);
    args.push('--', file);
    const raw = await g.raw(args);
    // Parse porcelain into per-line entries
    const lines = raw.split('\n');
    const commits = {};
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const head = lines[i++];
      if (!head) continue;
      const m = head.match(/^([0-9a-f]{40}) \d+ (\d+) ?(\d+)?$/);
      if (!m) continue;
      const sha = m[1];
      const resultLine = parseInt(m[2], 10);
      let meta = commits[sha];
      if (!meta) {
        meta = { sha };
        commits[sha] = meta;
        while (i < lines.length && !lines[i].startsWith('\t')) {
          const ln = lines[i++];
          if (ln.startsWith('author ')) meta.author = ln.slice(7);
          else if (ln.startsWith('author-mail ')) meta.email = ln.slice(12).replace(/[<>]/g, '');
          else if (ln.startsWith('author-time ')) meta.time = parseInt(ln.slice(12), 10);
          else if (ln.startsWith('summary ')) meta.summary = ln.slice(8);
        }
      } else {
        while (i < lines.length && !lines[i].startsWith('\t')) i++;
      }
      const codeLn = lines[i++] || '';
      out.push({ sha, line: resultLine, text: codeLn.replace(/^\t/, ''), author: meta.author, email: meta.email, time: meta.time, summary: meta.summary });
    }
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Reflog ----------
ipcMain.handle('git:reflog', async (event, { maxCount = 200 } = {}) => {
  try {
    const g = core.requireRepo();
    const out = await g.raw(['reflog', '--date=iso', `-n${maxCount}`]);
    const rows = out.split('\n').filter(Boolean).map(line => {
      const m = line.match(/^([0-9a-f]{7,40})\s+(\S+):\s+(.*)$/);
      if (!m) return null;
      return { hash: m[1], ref: m[2], message: m[3] };
    }).filter(Boolean);
    return { ok: true, data: rows };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- External tools ----------
ipcMain.handle('shell:openPath', async (event, p) => {
  try {
    const err = await shell.openPath(p);
    if (err) return { ok: false, error: err };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('shell:showInFolder', async (event, p) => {
  try { shell.showItemInFolder(p); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('shell:openTerminal', async (event, p) => {
  try {
    const dir = p || S.currentRepoPath;
    if (!dir) throw new Error('No directory');
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/K', `cd /d "${dir}"`], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Terminal', dir], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-terminal', [dir], { detached: true, stdio: 'ignore' });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('shell:openInVSCode', async (event, p) => {
  try {
    const dir = p || S.currentRepoPath;
    if (!dir) throw new Error('No directory');
    spawn('code', [dir], { detached: true, stdio: 'ignore', shell: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Clipboard ----------
ipcMain.handle('clipboard:write', async (event, text) => {
  try { clipboard.writeText(text || ''); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Native notification ----------
ipcMain.handle('notify', async (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title || 'D.Va Git', body: body || '' }).show();
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- Per-branch tracking info (ahead/behind/gone/no-upstream) ----------
// ---------- People (per-person custom avatars + Discord) ----------
function peopleFile() { return path.join(app.getPath('userData'), 'people.json'); }

ipcMain.handle('people:read', () => {
  try {
    const f = peopleFile();
    if (!fs.existsSync(f)) return { people: [], discordBotToken: '' };
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    // Decrypt token for renderer use; never persist plain.
    const out = { ...raw, discordBotToken: core.decryptToken(raw.discordBotToken || raw._discordBotTokenEnc || '') };
    return out;
  } catch (e) { return { people: [], discordBotToken: '' }; }
});
ipcMain.handle('people:write', (event, data) => {
  try {
    const toSave = { ...data, discordBotToken: core.encryptToken(data.discordBotToken || '') };
    fs.writeFileSync(peopleFile(), JSON.stringify(toSave, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

};
