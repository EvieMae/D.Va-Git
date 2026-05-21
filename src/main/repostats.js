module.exports = (core) => {
const { ipcMain } = require('electron');

function parseCountObjects(out) {
  const data = {};
  const lines = String(out || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z\-]+):\s*(.+?)\s*$/);
    if (m) data[m[1]] = m[2];
  }
  // count-objects -v provides: count, size, in-pack, packs, size-pack, prune-packable, garbage, size-garbage
  const objectCount = (parseInt(data['count'], 10) || 0) + (parseInt(data['in-pack'], 10) || 0);
  // sizes from count-objects are in KiB
  const sizeKiB = (parseInt(data['size'], 10) || 0) + (parseInt(data['size-pack'], 10) || 0) + (parseInt(data['size-garbage'], 10) || 0);
  const sizeBytes = sizeKiB * 1024;
  return { objectCount, sizeBytes };
}

function parseShortlog(out) {
  const lines = String(out || '').split(/\r?\n/);
  const contributors = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(.*?)\s+<([^>]*)>\s*$/);
    if (!m) continue;
    contributors.push({ commits: parseInt(m[1], 10), name: m[2], email: m[3] });
    if (contributors.length >= 20) break;
  }
  return contributors;
}

function parseFiles(out) {
  const lines = String(out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const counts = new Map();
  for (const p of lines) {
    const base = p.substring(p.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    let ext = '(none)';
    if (dot > 0 && dot < base.length - 1) ext = base.substring(dot + 1).toLowerCase();
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  const byExt = Array.from(counts.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
    .slice(0, 15);
  return { total: lines.length, byExt };
}

async function readBranches(g) {
  try {
    const out = await g.raw(['branch', '-a']);
    const lines = String(out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let local = 0, remote = 0;
    for (const line of lines) {
      const name = line.replace(/^\*\s*/, '').trim();
      if (name.startsWith('remotes/')) {
        if (!/->/.test(name)) remote++;
      } else {
        local++;
      }
    }
    return { local, remote };
  } catch (e) {
    return { local: 0, remote: 0 };
  }
}

async function readTags(g) {
  try {
    const out = await g.raw(['tag']);
    return String(out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
  } catch (e) {
    return 0;
  }
}

ipcMain.handle('repostats:read', async () => {
  try {
    const g = core.requireRepo();
    const [coOut, slOut, lsOut, branches, tags] = await Promise.all([
      g.raw(['count-objects', '-v']).catch(() => ''),
      g.raw(['shortlog', '-s', '-n', '-e', 'HEAD']).catch(() => ''),
      g.raw(['ls-files']).catch(() => ''),
      readBranches(g),
      readTags(g),
    ]);
    const { objectCount, sizeBytes } = parseCountObjects(coOut);
    const contributors = parseShortlog(slOut);
    const files = parseFiles(lsOut);
    return { ok: true, data: { objectCount, sizeBytes, contributors, files, branches, tags } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

};
