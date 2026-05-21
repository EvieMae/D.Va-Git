module.exports = (core) => {
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const { S } = core;

// ---------- Templates ----------
const TEMPLATES = {
  Node: [
    'node_modules/',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    'pnpm-debug.log*',
    '.npm/',
    '.yarn/',
    '.pnp.*',
    'dist/',
    'build/',
    'coverage/',
    '.env',
    '.env.local',
    '.env.*.local',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  Python: [
    '__pycache__/',
    '*.py[cod]',
    '*$py.class',
    '*.so',
    '.Python',
    'build/',
    'develop-eggs/',
    'dist/',
    'downloads/',
    'eggs/',
    '.eggs/',
    'lib/',
    'lib64/',
    'parts/',
    'sdist/',
    'var/',
    'wheels/',
    '*.egg-info/',
    '.installed.cfg',
    '*.egg',
    '.pytest_cache/',
    '.mypy_cache/',
    '.tox/',
    '.venv/',
    'venv/',
    'env/',
    '.env',
    '.coverage',
    'htmlcov/',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  Unity: [
    '[Ll]ibrary/',
    '[Tt]emp/',
    '[Oo]bj/',
    '[Bb]uild/',
    '[Bb]uilds/',
    '[Ll]ogs/',
    '[Uu]ser[Ss]ettings/',
    '[Mm]emoryCaptures/',
    '[Rr]ecordings/',
    '*.csproj',
    '*.unityproj',
    '*.sln',
    '*.suo',
    '*.user',
    '*.userprefs',
    '*.pidb',
    '*.booproj',
    '*.svd',
    '*.pdb',
    '*.mdb',
    '*.opendb',
    '*.VC.db',
    '*.pidb.meta',
    '*.pdb.meta',
    '*.mdb.meta',
    'sysinfo.txt',
    '*.apk',
    '*.aab',
    '*.unitypackage',
    'crashlytics-build.properties',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  Go: [
    '*.exe',
    '*.exe~',
    '*.dll',
    '*.so',
    '*.dylib',
    '*.test',
    '*.out',
    'go.work',
    'vendor/',
    'bin/',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  Rust: [
    'target/',
    '**/*.rs.bk',
    'Cargo.lock',
    '.cargo/',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  Web: [
    'node_modules/',
    'dist/',
    'build/',
    '.cache/',
    '.parcel-cache/',
    '.next/',
    '.nuxt/',
    '.svelte-kit/',
    '.vercel/',
    '.netlify/',
    'coverage/',
    '*.log',
    '.env',
    '.env.local',
    '.env.*.local',
    '.DS_Store',
    'Thumbs.db',
    '',
  ].join('\n'),
  generic: [
    '# OS',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '',
    '# Editors',
    '.vscode/',
    '.idea/',
    '*.swp',
    '*.swo',
    '*~',
    '',
    '# Logs',
    '*.log',
    'logs/',
    '',
    '# Env',
    '.env',
    '.env.local',
    '',
    '# Build',
    'build/',
    'dist/',
    'out/',
    '',
  ].join('\n'),
};

function gitignorePath() {
  const repo = S.currentRepoPath;
  if (!repo) throw new Error('No repository open');
  return path.join(repo, '.gitignore');
}

function readSafe() {
  try {
    return fs.readFileSync(gitignorePath(), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

ipcMain.handle('gitignore:read', async () => {
  try {
    core.requireRepo();
    return { ok: true, data: readSafe() };
  } catch (e) { return { ok: false, error: e.message, data: '' }; }
});

ipcMain.handle('gitignore:appendLine', async (event, { line }) => {
  try {
    core.requireRepo();
    if (!line || typeof line !== 'string') throw new Error('Empty line');
    const trimmed = line.trim();
    if (!trimmed) throw new Error('Empty line');
    const p = gitignorePath();
    let cur = readSafe();
    // Check if already present (exact match on a line)
    const lines = cur.split(/\r?\n/).map(l => l.trim());
    if (lines.includes(trimmed)) return { ok: true, alreadyPresent: true };
    let next = cur;
    if (next.length && !next.endsWith('\n')) next += '\n';
    next += trimmed + '\n';
    fs.writeFileSync(p, next, 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('gitignore:writeTemplate', async (event, { name, mode }) => {
  try {
    core.requireRepo();
    const tpl = TEMPLATES[name];
    if (!tpl) throw new Error('Unknown template: ' + name);
    const p = gitignorePath();
    if (mode === 'replace') {
      fs.writeFileSync(p, tpl, 'utf8');
    } else {
      let cur = readSafe();
      if (cur.length && !cur.endsWith('\n')) cur += '\n';
      const sep = cur.length ? '\n' : '';
      fs.writeFileSync(p, cur + sep + tpl, 'utf8');
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Expose templates for renderer preview via a separate channel
ipcMain.handle('gitignore:templates', async () => {
  try {
    return { ok: true, data: TEMPLATES };
  } catch (e) { return { ok: false, error: e.message }; }
});
};
