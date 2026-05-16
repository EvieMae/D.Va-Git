// ═════════════════════════════════════════════════════════════
//  D.Va Git — renderer
//  "I play to win!"
// ═════════════════════════════════════════════════════════════

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ─────────────────────── State ───────────────────────
const state = {
  repo: null,
  openRepos: [],          // [{ path, name }]
  activeRepoIndex: -1,
  status: null,
  branches: { local: { all: [], current: '' }, all: { all: [], branches: {} } },
  remotes: [],
  tags: [],
  stashes: [],
  commits: [],
  lfsFiles: new Set(),    // paths under LFS
  selectedCommit: null,
  selectedFile: null,
  selectedFileStaged: false,
  user: { name: '', email: '' },
  activeCenterTab: 'history',
  activeRightTab: 'details',
  historyBranchFilter: null,   // null = --all, else branch name
  editorFile: null,            // { path, content, original, dirty, editable, mode, fileType, atCommit }
  // Multi-selection for Changes pane
  selectedChanges: { unstaged: new Set(), staged: new Set() },
  // Sidebar filter strings
  filters: { local: '', remote: '', tags: '' },
  // Files-tab UI
  filesSearch: '',
  filesShowHidden: false,
  // Per-tab dirty flag (file editor)
  tabDirty: false,
  // Recent branches (LRU)
  recentBranches: [],
  // Auto-fetch timer
  autoFetchTimer: null,
  settings: {
    graphMaxCommits: 300,
    defaultRemote: 'origin',
    showAvatars: true,
    avatarSources: [
      { source: 'github',   enabled: true },
      { source: 'gravatar', enabled: true },
      { source: 'initials', enabled: true },
    ],
    rightPaneWidth: 420,
    sidebarWidth: 256,
    sectionHeights: { local: 180, remote: 180, stashes: 140, tags: 140 },
    changesSectionHeights: { unstaged: 220, staged: 220, commit: 260 },
    changesCollapsed: { unstaged: false, staged: false, commit: false },
    theme: 'dva',
    fontSize: 13,
    autoFetchMinutes: 0,  // 0 = off
    notifyOnComplete: true,
  },
};

// ─────────────────────── Toast ───────────────────────
function toast(message, kind = 'ok', timeout = 3200) {
  const host = $('#toast-host');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  const icon = kind === 'error' ? '✕' : kind === 'warn' ? '⚠' : '♥';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text"></span>`;
  el.querySelector('.toast-text').textContent = message;
  host.appendChild(el);
  try { playSfx(kind); } catch {}
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

function setStatus(text, kind = 'ok') {
  const el = $('#sb-status');
  el.textContent = text;
  el.className = 'sb-item sb-status' + (kind === 'busy' ? ' busy' : kind === 'error' ? ' error' : '');
}

// ─────────────────────── Modal ───────────────────────
function modal({ title, body, okText = 'CONFIRM', cancelText = 'CANCEL', onOk, hideOk = false }) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-ok').textContent = okText;
  $('#modal-cancel').textContent = cancelText;
  $('#modal-ok').style.display = hideOk ? 'none' : '';
  $('#modal-backdrop').classList.remove('hidden');

  const close = () => {
    $('#modal-backdrop').classList.add('hidden');
    $('#modal-ok').style.display = '';
  };
  const okHandler = async () => {
    const result = onOk ? await onOk() : true;
    if (result !== false) close();
  };
  $('#modal-ok').onclick = okHandler;
  $('#modal-cancel').onclick = close;
  $('#modal-backdrop').onclick = (e) => { if (e.target.id === 'modal-backdrop') close(); };

  const firstInput = $('#modal-body input, #modal-body textarea, #modal-body select');
  if (firstInput) firstInput.focus();
  return { close };
}

// ─────────────────────── Context menu ───────────────────────
function showContextMenu(x, y, items) {
  const menu = $('#ctx-menu');
  menu.innerHTML = items.map((it, i) => {
    if (it.separator) return `<div class="ctx-separator"></div>`;
    return `
      <div class="ctx-item ${it.danger ? 'danger' : ''}" data-idx="${i}">
        <span class="ctx-icon">${it.icon || ''}</span>
        <span>${escapeHtml(it.label)}</span>
      </div>
    `;
  }).join('');
  menu.classList.remove('hidden');
  // Constrain to viewport
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top = Math.min(y, maxY) + 'px';

  items.forEach((it, i) => {
    if (it.separator) return;
    const el = menu.querySelector(`[data-idx="${i}"]`);
    if (!el) return;
    el.onclick = () => {
      hideContextMenu();
      if (it.action) it.action();
    };
  });
}
function hideContextMenu() {
  $('#ctx-menu').classList.add('hidden');
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#ctx-menu')) hideContextMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu();
    $('#modal-backdrop').classList.add('hidden');
  }
});

// ─────────────────────── Util ───────────────────────
function formatDate(d) {
  const date = new Date(d);
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  return date.toLocaleDateString();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// <select> of every configured remote (falls back to the saved default /
// 'origin' so it's never empty). Reused anywhere a remote is chosen.
function remoteSelectHtml(id, selected) {
  const sel = selected || state.settings.defaultRemote || 'origin';
  const names = (state.remotes || []).map(r => r.name).filter(Boolean);
  if (!names.length) names.push('origin');
  if (!names.includes(sel)) names.unshift(sel);
  return `<select id="${id}">` + names.map(n =>
    `<option value="${escapeHtml(n)}"${n === sel ? ' selected' : ''}>${escapeHtml(n)}</option>`
  ).join('') + `</select>`;
}

function statusLetter(code) {
  if (!code) return '?';
  if (code === '??') return 'U';
  return code.trim()[0] || 'M';
}

function statusClass(code) {
  const l = statusLetter(code);
  if (l === 'U' || code === '??') return 'ci-status-untracked';
  if (l === 'M') return 'ci-status-M';
  if (l === 'A') return 'ci-status-A';
  if (l === 'D') return 'ci-status-D';
  if (l === 'R') return 'ci-status-R';
  if (l === 'C') return 'ci-status-conflict';
  return 'ci-status-M';
}

// Deterministic color from string (for initials avatars)
function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const palette = [
    '#ff5aa8', '#5ee0ff', '#ffd166', '#7ee8b0',
    '#b58aff', '#ff9966', '#7adcff', '#ff84c4',
    '#9ad17a', '#f5a142', '#42c5f5', '#c542f5',
  ];
  return palette[Math.abs(h) % palette.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
}

// Simple MD5 (for gravatar) — minimal implementation
function md5(str) {
  // Adapted minimal MD5 (Joseph Myers public domain version, condensed)
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> 32 - s), b);
  }
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5cycle(x,k){
    let a=x[0],b=x[1],c=x[2],d=x[3];
    a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
    x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);
  }
  function md5blk(s){const md5blks=[];for(let i=0;i<64;i+=4){md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);}return md5blks;}
  function md51(s){
    const n=s.length;const state=[1732584193,-271733879,-1732584194,271733878];let i;
    for(i=64;i<=s.length;i+=64) md5cycle(state,md5blk(s.substring(i-64,i)));
    s=s.substring(i-64);const tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for(i=0;i<s.length;i++) tail[i>>2] |= s.charCodeAt(i)<<((i%4)<<3);
    tail[i>>2] |= 0x80 << ((i%4)<<3);
    if(i>55){md5cycle(state,tail);for(i=0;i<16;i++) tail[i]=0;}
    tail[14]=n*8;md5cycle(state,tail);return state;
  }
  function rhex(n){const h='0123456789abcdef';let s='';for(let j=0;j<4;j++) s += h.charAt((n>>(j*8+4))&0x0F)+h.charAt((n>>(j*8))&0x0F);return s;}
  function hex(x){for(let i=0;i<x.length;i++) x[i]=rhex(x[i]);return x.join('');}
  // utf-8 encode for unicode-safe input
  const utf8 = unescape(encodeURIComponent(str));
  return hex(md51(utf8));
}

// Extract GitHub username from noreply email pattern: [id+]username@users.noreply.github.com
function githubUserFromEmail(email) {
  if (!email) return null;
  const m = email.trim().toLowerCase().match(/^(?:\d+\+)?([a-z0-9][a-z0-9-]*?)@users\.noreply\.github\.com$/i);
  return m ? m[1] : null;
}

function buildAvatarUrl(source, name, email, px) {
  if (source === 'github') {
    const user = githubUserFromEmail(email);
    if (!user) return null;
    return `https://avatars.githubusercontent.com/${encodeURIComponent(user)}?s=${px}`;
  }
  if (source === 'gravatar') {
    if (!email) return null;
    const hash = md5(email.trim().toLowerCase());
    return `https://www.gravatar.com/avatar/${hash}?s=${px}&d=identicon`;
  }
  return null;
}

function avatarHtml(name, email, size = 'sm') {
  if (!state.settings.showAvatars) return '';
  const cls = size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  const px = size === 'lg' ? 56 : 40;

  // Collect ordered fallback chain
  const chain = (state.settings.avatarSources || [])
    .filter(s => s.enabled)
    .map(s => ({ source: s.source, url: buildAvatarUrl(s.source, name, email, px) }))
    .filter(s => s.source === 'initials' || s.url);

  // Build initials fallback once
  const seed = (email || name || '?').toLowerCase().trim();
  const bg = avatarColor(seed);
  const initialsHtml = `<span class="${cls}" style="background:${bg};">${escapeHtml(initials(name))}</span>`;

  // First non-initials source with a usable URL
  const remote = chain.find(c => c.source !== 'initials');
  if (!remote) return initialsHtml;

  // Image with onerror chain. Encode initials data attributes for fallback rendering.
  // To keep things simple we fall through to initials on error.
  const remaining = chain.slice(chain.indexOf(remote) + 1).filter(c => c.source !== 'initials' && c.url);
  const fallbackUrls = remaining.map(c => c.url).join('|');
  const onerr = `dvaAvatarFallback(this, '${fallbackUrls}', '${escapeHtml(initials(name))}', '${bg}', '${cls}')`;
  return `<span class="${cls}" style="background:${bg};"><img loading="lazy" src="${remote.url}" alt="" onerror="${onerr}"/></span>`;
}

// Defined globally so the inline onerror handler can reach it
window.dvaAvatarFallback = function (img, remainingUrlsStr, initialsText, bg, cls) {
  const list = remainingUrlsStr ? remainingUrlsStr.split('|').filter(Boolean) : [];
  if (list.length > 0) {
    img.src = list.shift();
    img.setAttribute('onerror', `dvaAvatarFallback(this, '${list.join('|')}', '${initialsText}', '${bg}', '${cls}')`);
    return;
  }
  // Replace image with initials
  const span = img.parentElement;
  if (span) {
    span.textContent = initialsText;
    span.style.background = bg;
  }
};

// ─────────────────────── File status icons & types ───────────────────────
function statusIconChar(code) {
  const l = statusLetter(code);
  if (l === 'A' || code === '??') return '+';
  if (l === 'D') return '−';
  if (l === 'M') return '✎';
  if (l === 'R') return '→';
  if (l === 'C') return '!';
  if (l === 'T') return '◆';
  if (l === 'U') return '?';
  return '✎';
}
function statusIconClass(code) {
  const l = statusLetter(code);
  if (code === '??' || l === 'U') return 's-U';
  if (l === 'A') return 's-A';
  if (l === 'D') return 's-D';
  if (l === 'M') return 's-M';
  if (l === 'R') return 's-R';
  if (l === 'C') return 's-C';
  if (l === 'T') return 's-T';
  return 's-M';
}
function statusIconHtml(code) {
  return `<span class="ci-status-icon ${statusIconClass(code)}" title="${escapeHtml(statusLetter(code))}">${statusIconChar(code)}</span>`;
}

function isLfsPath(p) { return state.lfsFiles?.has(p); }
function lfsBadgeHtml(p) {
  return isLfsPath(p) ? `<span class="lfs-badge" title="Git LFS">LFS</span>` : '';
}

const FILE_TYPE_BY_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus'],
};
function getFileType(p) {
  if (!p) return 'text';
  const ext = p.split('.').pop()?.toLowerCase() || '';
  for (const [type, list] of Object.entries(FILE_TYPE_BY_EXT)) {
    if (list.includes(ext)) return type;
  }
  return 'text';
}
function mimeFor(p) {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', m4v: 'video/mp4', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg',
  };
  return map[ext] || 'application/octet-stream';
}

// ─────────────────────── Window controls ───────────────────────
$('#wc-min').onclick = () => window.api.minimize();
$('#wc-max').onclick = () => window.api.maximize();
$('#wc-close').onclick = () => window.api.close();

// ─────────────────────── Welcome screen ───────────────────────
async function renderRecent() {
  const recent = await window.api.recentRepos();
  const list = $('#welcome-recent-list');
  if (!recent || recent.length === 0) {
    list.innerHTML = `<div class="welcome-recent-empty">No recent repositories yet.</div>`;
    return;
  }
  list.innerHTML = recent.map((p) => {
    const parts = p.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] || p;
    return `
      <div class="welcome-recent-item" data-path="${escapeHtml(p)}">
        <span style="color: var(--pink);">♥</span>
        <span class="wri-name">${escapeHtml(name)}</span>
        <span class="wri-path">${escapeHtml(p)}</span>
      </div>
    `;
  }).join('');
  $$('#welcome-recent-list .welcome-recent-item').forEach(it => {
    it.onclick = () => openRepoPath(it.dataset.path);
  });
}

$('#welcome-open').onclick = () => {
  modal({
    title: 'OPEN A REPOSITORY',
    body: `
      <label>REPOSITORY FOLDER</label>
      <div style="display:flex;gap:6px;">
        <input id="modal-open-path" placeholder="Paste a path or click Browse…" style="flex:1;" />
        <button class="csh-action" id="modal-open-browse">Browse…</button>
      </div>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px;">
        Pick the folder that contains the <code>.git</code> directory.
      </div>
    `,
    okText: 'OPEN',
    onOk: async () => {
      const p = $('#modal-open-path').value.trim();
      if (!p) { toast('Pick a repository folder', 'error'); return false; }
      const ok = await openRepoPath(p);
      if (!ok) return false;
    },
  });
  $('#modal-open-browse').onclick = async () => {
    const p = await window.api.pickFolder();
    if (p) $('#modal-open-path').value = p;
  };
};

$('#welcome-init').onclick = async () => {
  const p = await window.api.pickFolder();
  if (!p) return;
  setStatus('Initializing...', 'busy');
  const r = await window.api.initRepo(p);
  if (r.ok) {
    toast(`Initialized repo at ${r.name}`, 'ok');
    await enterRepo(r);
  } else {
    toast(r.error, 'error');
    setStatus('Idle');
  }
};

$('#welcome-clone').onclick = () => {
  modal({
    title: 'CLONE A REPOSITORY',
    body: `
      <label>REMOTE URL</label>
      <input id="modal-clone-url" placeholder="https://github.com/user/repo.git" />
      <label>DESTINATION (optional)</label>
      <input id="modal-clone-dest" placeholder="Leave blank for default" />
      <label>USERNAME (optional)</label>
      <input id="modal-clone-user" placeholder="for private HTTPS repos" />
      <label>TOKEN / PASSWORD (optional)</label>
      <input id="modal-clone-token" type="password" placeholder="leave blank to use a saved integration" />
      <div style="font-size:11px;color:var(--text-3);margin-top:6px;">
        Private repo? Provide a personal access token, or save one in
        Settings → Integrations for this host and it'll be used automatically.
        Credentials are used only for the clone and never stored in the repo.
      </div>
    `,
    okText: 'CLONE',
    onOk: async () => {
      const url = $('#modal-clone-url').value.trim();
      const dest = $('#modal-clone-dest').value.trim();
      const username = $('#modal-clone-user').value.trim();
      const token = $('#modal-clone-token').value.trim();
      if (!url) { toast('URL required', 'error'); return false; }
      setStatus('Cloning...', 'busy');
      toast('Cloning... this may take a minute', 'ok', 6000);
      const r = await window.api.cloneRepo({ url, dest: dest || null, username: username || null, token: token || null });
      if (r.ok) {
        toast('Cloned successfully!', 'ok');
        await enterRepo(r);
      } else {
        toast(r.error, 'error');
        setStatus('Idle', 'error');
        return false;
      }
    },
  });
};

async function openRepoPath(path) {
  // If already open, just switch
  const existing = state.openRepos.findIndex(r => r.path === path);
  if (existing >= 0) {
    await activateRepoTab(existing);
    return true;
  }
  setStatus('Opening...', 'busy');
  showLoading('Opening repo…', path);
  try {
    const r = await window.api.openRepo(path);
    if (r.ok) { await enterRepo(r); return true; }
    toast(r.error, 'error');
    setStatus('Idle', 'error');
    return false;
  } finally {
    hideLoading();
  }
}

async function enterRepo(repo) {
  state.repo = repo;

  // Tabs management — add or switch
  const idx = state.openRepos.findIndex(r => r.path === repo.path);
  if (idx >= 0) {
    state.activeRepoIndex = idx;
  } else {
    state.openRepos.push({ path: repo.path, name: repo.name });
    state.activeRepoIndex = state.openRepos.length - 1;
  }
  renderRepoTabs();

  $('#welcome').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#repo-tabs').classList.remove('hidden');

  // Reset per-repo view state
  state.selectedCommit = null;
  state.selectedFile = null;
  state.editorFile = null;
  state.historyBranchFilter = null;
  $('#editor-tab').classList.add('hidden');

  const uc = await window.api.userConfig();
  if (uc.ok) {
    state.user = uc.data;
    $('#sb-user').textContent = state.user.name || 'Unknown pilot';
  }

  await refreshAll();
  setStatus('Repository loaded', 'ok');
}

async function activateRepoTab(idx) {
  const target = state.openRepos[idx];
  if (!target) return;
  setStatus('Switching...', 'busy');
  showLoading('Switching repo…', target.name || target.path);
  try {
    const r = await window.api.openRepo(target.path);
    if (!r.ok) {
      // Repo disappeared — drop the tab
      toast(r.error, 'error');
      closeRepoTab(idx, /*confirm=*/ false);
      return;
    }
    state.activeRepoIndex = idx;
    state.repo = r;
    renderRepoTabs();

    $('#welcome').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#repo-tabs').classList.remove('hidden');

    state.selectedCommit = null;
    state.selectedFile = null;
    state.editorFile = null;
    state.historyBranchFilter = null;
    $('#editor-tab').classList.add('hidden');

    const uc = await window.api.userConfig();
    if (uc.ok) {
      state.user = uc.data;
      $('#sb-user').textContent = state.user.name || 'Unknown pilot';
    }
    await refreshAll();
    setStatus('Ready');
  } finally {
    hideLoading();
  }
}

function closeRepoTab(idx, _confirm = true) {
  state.openRepos.splice(idx, 1);
  if (state.openRepos.length === 0) {
    state.repo = null;
    state.activeRepoIndex = -1;
    state.selectedCommit = null;
    state.selectedFile = null;
    state.editorFile = null;
    state.historyBranchFilter = null;
    $('#app').classList.add('hidden');
    $('#repo-tabs').classList.add('hidden');
    $('#welcome').classList.remove('hidden');
    renderRepoTabs();
    renderRecent();
    return;
  }
  // Activate neighbor
  const next = Math.min(idx, state.openRepos.length - 1);
  activateRepoTab(next);
}

function renderRepoTabs() {
  const strip = $('#repo-tabs-strip');
  if (!strip) return;
  strip.innerHTML = state.openRepos.map((r, i) => `
    <div class="repo-tab ${i === state.activeRepoIndex ? 'active' : ''}" data-idx="${i}" title="${escapeHtml(r.path)}">
      <span class="repo-tab-icon">♥</span>
      <span class="repo-tab-name">${escapeHtml(r.name)}</span>
      <span class="repo-tab-close" data-close="${i}">✕</span>
    </div>
  `).join('');
  $$('#repo-tabs-strip .repo-tab').forEach(el => {
    el.onclick = (e) => {
      if (e.target.classList.contains('repo-tab-close')) {
        const idx = parseInt(e.target.dataset.close, 10);
        if (state.editorFile?.dirty && idx === state.activeRepoIndex) {
          modal({
            title: 'Discard unsaved changes?',
            body: `<p>You have unsaved changes in <strong>${escapeHtml(state.editorFile.path)}</strong>. Close the repo?</p>`,
            okText: 'CLOSE',
            onOk: () => closeRepoTab(idx),
          });
        } else {
          closeRepoTab(idx);
        }
        return;
      }
      activateRepoTab(parseInt(el.dataset.idx, 10));
    };
  });
}

// Unified "Add repository" modal — choose a source: a connected GitHub
// account, any clone URL, or a local folder. GitHub/URL clones reuse saved
// integration tokens automatically (matched by host in the main process).
function openAddRepoModal() {
  const m = modal({
    title: 'ADD REPOSITORY',
    cancelText: 'Close',
    hideOk: true,
    body: `
      <div class="addrepo-seg" style="display:flex;gap:6px;margin-bottom:12px;">
        <button class="csh-action addrepo-tab" data-src="github">From GitHub</button>
        <button class="csh-action addrepo-tab" data-src="url">Clone URL</button>
        <button class="csh-action addrepo-tab" data-src="local">Local folder</button>
      </div>
      <div id="addrepo-loc" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:11px;">
        <span style="color:var(--text-3);">Clone into:</span>
        <span id="addrepo-loc-path" style="flex:1;min-width:0;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>
        <button class="csh-action" id="addrepo-loc-change">Change…</button>
        <button class="csh-action" id="addrepo-loc-reset" style="display:none;">Default</button>
      </div>
      <div id="addrepo-pane"></div>
    `,
  });

  const pane = $('#addrepo-pane');
  const tabs = $$('#modal-body .addrepo-tab');
  const setActiveTab = (src) => tabs.forEach(t =>
    t.classList.toggle('active', t.dataset.src === src));

  // Shared clone location — applies to GitHub + URL clones (null = app default).
  let cloneParentDir = null;
  const renderLoc = () => {
    $('#addrepo-loc-path').textContent = cloneParentDir || 'Default (~/dvagit-clones)';
    $('#addrepo-loc-path').title = cloneParentDir || 'Default (~/dvagit-clones)';
    $('#addrepo-loc-reset').style.display = cloneParentDir ? '' : 'none';
  };
  renderLoc();
  $('#addrepo-loc-change').onclick = async () => {
    const d = await window.api.pickCloneDir();
    if (d) { cloneParentDir = d; renderLoc(); }
  };
  $('#addrepo-loc-reset').onclick = () => { cloneParentDir = null; renderLoc(); };

  const doClone = async ({ url, dest = null, username = null, token = null }) => {
    if (!url) { toast('URL required', 'error'); return; }
    setStatus('Cloning...', 'busy');
    toast('Cloning... this may take a minute', 'ok', 6000);
    const r = await window.api.cloneRepo({ url, dest, parentDir: cloneParentDir, username, token });
    if (r.ok) {
      toast('Cloned successfully!', 'ok');
      m.close();
      await enterRepo(r);
    } else {
      toast(r.error, 'error');
      setStatus('Idle', 'error');
    }
  };

  // ---- GitHub pane: list the connected account's repos and clone on click ----
  let _ghRepos = null;
  async function renderGithub() {
    pane.innerHTML = `<p style="color:var(--text-3);padding:6px;">Loading repositories…</p>`;
    if (!_ghRepos) {
      const res = await window.api.githubListRepos();
      if (!$('#addrepo-pane')) return; // modal closed mid-fetch
      if (!res || !res.ok) {
        pane.innerHTML = `
          <p style="color:var(--text-3);padding:6px;">${escapeHtml(res?.error || 'Could not load repositories.')}</p>
          <p style="font-size:11px;color:var(--text-3);">Connect a GitHub account in <strong>Settings → Integrations</strong> (use “Login with GitHub”), then reopen this.</p>`;
        return;
      }
      _ghRepos = res.repos || [];
    }
    pane.innerHTML = `
      <input id="addrepo-gh-search" placeholder="Filter ${_ghRepos.length} repositories…" style="width:100%;margin-bottom:8px;" />
      <div id="addrepo-gh-list" style="max-height:320px;overflow:auto;"></div>`;
    const listEl = $('#addrepo-gh-list');
    const draw = (q = '') => {
      const ql = q.toLowerCase();
      const rows = _ghRepos.filter(r =>
        r.fullName.toLowerCase().includes(ql) ||
        (r.description || '').toLowerCase().includes(ql));
      listEl.innerHTML = rows.length === 0
        ? `<p style="color:var(--text-3);padding:6px;">No matches.</p>`
        : rows.map((r, i) => `
          <div class="addrepo-gh-row" data-i="${_ghRepos.indexOf(r)}"
               style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;">
            <span style="flex:1;min-width:0;">
              <span style="color:var(--text-1);">${escapeHtml(r.fullName)}</span>
              ${r.private ? '<span style="font-size:10px;color:var(--text-3);border:1px solid var(--text-3);border-radius:3px;padding:0 4px;margin-left:6px;">private</span>' : ''}
              ${r.description ? `<div style="font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.description)}</div>` : ''}
            </span>
            <button class="csh-action" data-act="clone">Clone</button>
          </div>`).join('');
      $$('#addrepo-gh-list .addrepo-gh-row').forEach(row => {
        const repo = _ghRepos[parseInt(row.dataset.i, 10)];
        row.querySelector('[data-act="clone"]').onclick = () => doClone({ url: repo.cloneUrl });
      });
    };
    draw();
    $('#addrepo-gh-search').oninput = (e) => draw(e.target.value.trim());
  }

  // ---- Clone URL pane: any git URL, with optional explicit credentials ----
  function renderUrl() {
    pane.innerHTML = `
      <label>REMOTE URL</label>
      <input id="addrepo-url" placeholder="https://github.com/user/repo.git" />
      <label>DESTINATION (optional, full path — overrides “Clone into”)</label>
      <input id="addrepo-dest" placeholder="Leave blank to use the location above" />
      <label>USERNAME (optional)</label>
      <input id="addrepo-user" placeholder="for private HTTPS repos" />
      <label>TOKEN / PASSWORD (optional)</label>
      <input id="addrepo-token" type="password" placeholder="leave blank to use a saved integration" />
      <div style="font-size:11px;color:var(--text-3);margin:6px 0 10px;">
        A saved integration token for the URL's host is applied automatically.
        Credentials are used only for the clone and never stored in the repo.
      </div>
      <button class="csh-action" id="addrepo-url-go">CLONE</button>`;
    $('#addrepo-url-go').onclick = () => doClone({
      url: $('#addrepo-url').value.trim(),
      dest: $('#addrepo-dest').value.trim() || null,
      username: $('#addrepo-user').value.trim() || null,
      token: $('#addrepo-token').value.trim() || null,
    });
  }

  // ---- Local pane: open an existing folder on disk ----
  function renderLocal() {
    pane.innerHTML = `
      <p style="color:var(--text-3);padding:6px 0;">Open an existing git repository already on this machine.</p>
      <button class="csh-action" id="addrepo-local-go">Choose folder…</button>`;
    $('#addrepo-local-go').onclick = async () => {
      const p = await window.api.pickFolder();
      if (p) { m.close(); await openRepoPath(p); }
    };
  }

  const show = (src) => {
    setActiveTab(src);
    $('#addrepo-loc').style.display = src === 'local' ? 'none' : 'flex';
    if (src === 'github') renderGithub();
    else if (src === 'url') renderUrl();
    else renderLocal();
  };
  tabs.forEach(t => { t.onclick = () => show(t.dataset.src); });
  show('github');
}

$('#repo-tab-add').onclick = openAddRepoModal;

// Home — show the welcome page without closing any open repos. Clicking a
// repo tab (or Recent entry) returns to that repo.
function showHome() {
  $('#app').classList.add('hidden');
  $('#welcome').classList.remove('hidden');
  renderRecent();
}
$('#btn-home').onclick = showHome;
