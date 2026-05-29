// ─────────────────────── Recent branches (Ctrl+P) ───────────────────────
function pushRecentBranch(name) {
  if (!name) return;
  state.recentBranches = [name, ...state.recentBranches.filter(b => b !== name)].slice(0, 8);
}
const _origSwitchBranch = switchBranch;
switchBranch = async function (b) {
  pushRecentBranch(b);
  await _origSwitchBranch(b);
};
function openRecentBranchesPalette() {
  if (_palette) return;
  const all = (state.branches.local?.all || []);
  const ordered = [
    ...state.recentBranches.filter(b => all.includes(b)),
    ...all.filter(b => !state.recentBranches.includes(b)),
  ];
  const root = document.createElement('div');
  root.className = 'palette';
  root.innerHTML = `
    <input class="palette-input" placeholder="Quick branch switch…"/>
    <div class="palette-list" id="palette-list"></div>
  `;
  document.body.appendChild(root);
  _palette = root;
  const input = root.querySelector('.palette-input');
  let activeIdx = 0;
  const render = () => {
    const q = input.value.toLowerCase();
    const filtered = ordered.filter(b => !q || b.toLowerCase().includes(q));
    if (activeIdx >= filtered.length) activeIdx = 0;
    $('#palette-list').innerHTML = filtered.map((b, i) => `
      <div class="palette-item ${i === activeIdx ? 'active' : ''}" data-name="${escapeHtml(b)}">
        <span class="palette-icon">⎇</span><span>${escapeHtml(b)}</span>
        <span class="palette-sub">${state.status?.current === b ? 'current' : (state.recentBranches.includes(b) ? 'recent' : '')}</span>
      </div>
    `).join('') || '<div style="padding: 14px; color: var(--text-3);">No branches.</div>';
    $$('#palette-list .palette-item').forEach(el => {
      el.onclick = () => { closeCommandPalette(); switchBranch(el.dataset.name); };
    });
    return filtered;
  };
  input.oninput = render;
  input.onkeydown = (e) => {
    const f = render();
    if (e.key === 'Escape') closeCommandPalette();
    else if (e.key === 'Enter' && f[activeIdx]) { closeCommandPalette(); switchBranch(f[activeIdx]); }
    else if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx+1, f.length-1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx-1, 0); render(); e.preventDefault(); }
  };
  document.addEventListener('mousedown', paletteOutsideClose, true);
  render();
  input.focus();
}

// ─────────────────────── Find in file (Ctrl+F) ───────────────────────
function openFindInEditor() {
  const ta = $('#editor-textarea');
  if (!ta || ta.classList.contains('hidden')) {
    toast('Open a text file first', 'warn');
    return;
  }
  // Lazy-build the find bar
  let bar = $('#editor-find-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'editor-find-bar';
    bar.className = 'find-bar';
    bar.innerHTML = `
      <input id="editor-find-input" placeholder="Find…"/>
      <span class="find-count" id="editor-find-count"></span>
      <button class="csh-action" id="editor-find-prev">↑</button>
      <button class="csh-action" id="editor-find-next">↓</button>
      <button class="csh-action" id="editor-find-close">✕</button>
    `;
    $('#editor-body').insertBefore(bar, $('#editor-body').firstChild);
    let lastMatches = [];
    let cur = 0;
    const findAll = (q) => {
      const text = ta.value;
      lastMatches = [];
      if (!q) return;
      const lc = q.toLowerCase(); const tc = text.toLowerCase();
      let idx = 0;
      while ((idx = tc.indexOf(lc, idx)) !== -1) { lastMatches.push(idx); idx += q.length; }
    };
    const goto = (i) => {
      if (!lastMatches.length) {
        $('#editor-find-count').textContent = '0';
        return;
      }
      cur = (i + lastMatches.length) % lastMatches.length;
      const start = lastMatches[cur];
      ta.focus();
      ta.setSelectionRange(start, start + $('#editor-find-input').value.length);
      $('#editor-find-count').textContent = `${cur + 1} / ${lastMatches.length}`;
    };
    $('#editor-find-input').oninput = (e) => { findAll(e.target.value); cur = 0; goto(0); };
    $('#editor-find-input').onkeydown = (e) => {
      if (e.key === 'Enter') { goto(cur + 1); e.preventDefault(); }
      else if (e.key === 'Escape') { bar.classList.remove('shown'); }
    };
    $('#editor-find-next').onclick = () => goto(cur + 1);
    $('#editor-find-prev').onclick = () => goto(cur - 1);
    $('#editor-find-close').onclick = () => bar.classList.remove('shown');
  }
  bar.classList.add('shown');
  $('#editor-find-input').focus();
  $('#editor-find-input').select();
}

// ─────────────────────── Editor dirty → tab indicator ───────────────────────
$('#editor-textarea').addEventListener('input', () => {
  state.tabDirty = !!state.editorFile?.dirty;
  refreshTabIndicators();
});
// Also clear when editor closes (handled in editor-tab-close handler chain via wrapper below)
const _orig_editorTabClose = $('#editor-tab-close').onclick;
$('#editor-tab-close').onclick = (e) => {
  // If a conflict resolver is up, tear it down explicitly so the DOM doesn't
  // linger even if the original close handler bails on a confirm prompt etc.
  if (state.conflictResolver || state.conflictsView?.open) {
    if (typeof closeConflictResolver === 'function') closeConflictResolver();
  }
  if (_orig_editorTabClose) _orig_editorTabClose(e);
  // Final safety: nuke any orphan resolver DOM still hanging in editor-body.
  $$('#editor-body .conflict-resolver').forEach(n => n.remove());
  state.tabDirty = false;
  refreshTabIndicators();
};
const _orig_editorSave = $('#editor-save').onclick;
$('#editor-save').onclick = async (e) => {
  if (_orig_editorSave) await _orig_editorSave(e);
  state.tabDirty = !!state.editorFile?.dirty;
  refreshTabIndicators();
};

// ─────────────────────── Auto-fetch ───────────────────────
function setupAutoFetch() {
  if (state.autoFetchTimer) clearInterval(state.autoFetchTimer);
  state.autoFetchTimer = null;
  const m = state.settings.autoFetchMinutes || 0;
  if (m > 0) {
    state.autoFetchTimer = setInterval(async () => {
      if (!state.repo) return;
      try {
        await window.api.fetch({ remote: state.settings.defaultRemote });
        await refreshStatus();
        renderCenterHeader();
      } catch {}
    }, m * 60 * 1000);
  }
}

// ─────────────────────── Keyboard shortcuts ───────────────────────
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);

  // Commit on Ctrl+Enter even from inside commit textareas
  if (e.ctrlKey && e.key === 'Enter') {
    if (ae?.id === 'commit-msg' || ae?.id === 'commit-desc') {
      e.preventDefault(); $('#commit-btn').click(); return;
    }
  }
  if (inInput) return;

  // Refresh
  if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
    if (state.repo) { e.preventDefault(); refreshAll(); }
    return;
  }
  // New repo tab
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
    e.preventDefault(); $('#repo-tab-add')?.click(); return;
  }
  // New tag
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
    e.preventDefault(); openTagModal(null); return;
  }
  // New branch
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault(); openNewBranchModal(); return;
  }
  // Close tab
  if (e.ctrlKey && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    if (state.activeRepoIndex >= 0) closeRepoTab(state.activeRepoIndex);
    return;
  }
  // Cycle tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (state.openRepos.length < 2) return;
    const next = e.shiftKey
      ? (state.activeRepoIndex - 1 + state.openRepos.length) % state.openRepos.length
      : (state.activeRepoIndex + 1) % state.openRepos.length;
    activateRepoTab(next);
    return;
  }
  // Settings
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettingsModal(); return; }
  // Help
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); openHelpModal(); return; }
  // Command palette
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); return; }
  // Recent branches
  if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openRecentBranchesPalette(); return; }
  // Find in editor
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    if (state.activeCenterTab === 'editor') { e.preventDefault(); openFindInEditor(); }
    return;
  }
  // Font zoom
  if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
    e.preventDefault(); state.settings.fontSize = Math.min(22, (state.settings.fontSize || 13) + 1); applyTheme(); saveSettings(); return;
  }
  if (e.ctrlKey && e.key === '-') {
    e.preventDefault(); state.settings.fontSize = Math.max(10, (state.settings.fontSize || 13) - 1); applyTheme(); saveSettings(); return;
  }
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault(); state.settings.fontSize = 13; applyTheme(); saveSettings(); return;
  }
});

// ─────────────────────── Settings modal: add theme/font/autofetch/notify ───────────────────────
const _origOpenSettingsModal = openSettingsModal;
openSettingsModal = function () {
  _origOpenSettingsModal();
  // Inject extra rows at the end of the body
  const body = $('#modal-body');
  if (!body) return;
  const extra = document.createElement('div');
  extra.innerHTML = `
    <hr style="border: none; border-top: 1px solid var(--line); margin: 14px 0;"/>
    <div class="settings-row">
      <div><div class="settings-label">Theme</div><div class="settings-sub">Reload not required.</div></div>
      <select id="set-theme">
        ${THEMES.map(t => {
          const cur = (state.settings.theme === 'dark' ? 'dva' : state.settings.theme) || 'dva';
          return `<option value="${t.id}" ${cur === t.id ? 'selected' : ''}>${t.name}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">Font size</div><div class="settings-sub">Ctrl++ / Ctrl+− also adjust.</div></div>
      <input id="set-font-size" type="number" min="10" max="22" step="1" value="${state.settings.fontSize}"/>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">Auto-fetch (minutes)</div><div class="settings-sub">0 to disable.</div></div>
      <input id="set-auto-fetch" type="number" min="0" max="120" step="1" value="${state.settings.autoFetchMinutes}"/>
    </div>
    <div class="settings-row">
      <div><div class="settings-label">Native notifications</div><div class="settings-sub">For long ops (push/pull/cherry-pick).</div></div>
      <select id="set-notify">
        <option value="true" ${state.settings.notifyOnComplete ? 'selected' : ''}>On</option>
        <option value="false" ${!state.settings.notifyOnComplete ? 'selected' : ''}>Off</option>
      </select>
    </div>
  `;
  body.appendChild(extra);
  // Wrap the OK action to also save the new fields
  const okBtn = $('#modal-ok');
  const origOk = okBtn.onclick;
  okBtn.onclick = async (ev) => {
    state.settings.theme = $('#set-theme').value;
    state.settings.fontSize = Math.max(10, Math.min(22, parseInt($('#set-font-size').value, 10) || 13));
    state.settings.autoFetchMinutes = Math.max(0, Math.min(120, parseInt($('#set-auto-fetch').value, 10) || 0));
    state.settings.notifyOnComplete = $('#set-notify').value === 'true';
    applyTheme();
    setupAutoFetch();
    if (origOk) await origOk(ev);
  };
};

// ═══════════════════════════════════════════════════════════════════════════
//  Heavy features: conflict resolve, hunk staging, side-by-side diff,
//  whitespace toggles, line-numbers gutter, image diff, submodules,
//  worktrees, branch protection, GPG indicator, mini syntax highlighter,
//  interactive rebase, word-level intraline diff.
// ═══════════════════════════════════════════════════════════════════════════

// Extend state defaults
if (state.settings.protectedBranches === undefined) state.settings.protectedBranches = ['main', 'master'];
if (state.settings.historyCols === undefined) state.settings.historyCols = { refs: 180, graph: 200, author: 140, date: 90, hash: 70 };
if (state.settings.diffSideBySide === undefined) state.settings.diffSideBySide = false;
if (state.settings.diffIgnoreWS === undefined) state.settings.diffIgnoreWS = false;
if (state.settings.diffContext === undefined) state.settings.diffContext = 3;
if (state.settings.syntaxHighlight === undefined) state.settings.syntaxHighlight = true;
state.signing = { gpgsign: false, signingKey: '', format: 'openpgp' };
state.opState = null;
state.submodules = [];
state.worktrees = [];

// ─────────────────────── Mini syntax highlighter ───────────────────────
const LANG_BY_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  py: 'py', pyw: 'py', pyi: 'py',
  lua: 'lua',
  php: 'php', phtml: 'php', php5: 'php',
  rb: 'rb', erb: 'rb', rake: 'rb', gemspec: 'rb',
  go: 'go',
  rs: 'rs',
  java: 'java',
  kt: 'kt', kts: 'kt',
  swift: 'swift',
  scala: 'scala', sc: 'scala',
  dart: 'dart',
  sql: 'sql',
  groovy: 'groovy', gradle: 'groovy',
  ex: 'ex', exs: 'ex',
  hs: 'hs',
  jl: 'jl',
  pl: 'perl', pm: 'perl', perl: 'perl',
  r: 'r',
  ps1: 'ps1', psm1: 'ps1', psd1: 'ps1',
  sh: 'sh', bash: 'sh', zsh: 'sh', ksh: 'sh',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c',
  hpp: 'c', hh: 'c', hxx: 'c', ino: 'c', m: 'c', mm: 'c',
  cs: 'cs',
  json: 'json', json5: 'json', jsonc: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css', styl: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  md: 'md', markdown: 'md', mdx: 'md',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini',
};
function detectLang(path) {
  const ext = (path?.split('.').pop() || '').toLowerCase();
  return LANG_BY_EXT[ext] || null;
}
const KEYWORDS = {
  js: /\b(?:break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|false|try|typeof|undefined|var|void|while|with|yield|async|await)\b/g,
  ts: /\b(?:break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|false|try|typeof|undefined|var|void|while|with|yield|async|await|interface|type|enum|implements|public|private|protected|readonly|abstract|declare|namespace|module|as|is|keyof|infer|never|unknown|any|number|string|boolean|symbol|object|void)\b/g,
  py: /\b(?:def|class|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|try|except|finally|raise|with|as|import|from|pass|break|continue|lambda|global|nonlocal|yield|async|await|self)\b/g,
  json: /\b(?:true|false|null)\b/g,
  css: /\b(?:important|inherit|initial|unset|none|auto|block|inline|flex|grid|absolute|relative|fixed|sticky|hidden|visible)\b/g,
  rb: /\b(?:def|end|class|module|if|elsif|else|unless|while|until|for|in|do|return|nil|true|false|begin|rescue|ensure|raise|yield|require|attr_reader|attr_writer|attr_accessor|self|new)\b/g,
  go: /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false)\b/g,
  rs: /\b(?:as|break|const|continue|crate|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while|async|await|dyn)\b/g,
  java: /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|null|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false)\b/g,
  sh: /\b(?:if|then|else|elif|fi|for|do|done|while|until|case|esac|function|return|exit|break|continue|in|select|time|local|export|set|unset|readonly|echo|printf|read|cd|pwd|test)\b/g,
  c: /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|class|public|private|protected|namespace|template|typename|using|virtual|new|delete|nullptr|true|false|this)\b/g,
  cs: /\b(?:abstract|as|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|virtual|void|volatile|while|var|async|await|dynamic|nameof|partial|yield|get|set|value|where|when|record|init|global)\b/g,
  lua: /\b(?:and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while|self)\b/g,
  php: /\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|do|echo|else|elseif|empty|enum|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|or|print|private|protected|public|readonly|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield|true|false|null|self|parent|this)\b/g,
  swift: /\b(?:associatedtype|class|deinit|enum|extension|fileprivate|func|import|init|inout|internal|let|open|operator|private|protocol|public|static|struct|subscript|typealias|var|break|case|continue|default|defer|do|else|fallthrough|for|guard|if|in|repeat|return|switch|where|while|as|catch|is|throw|throws|try|Any|false|nil|self|Self|super|true|async|await|actor|some|any)\b/g,
  kt: /\b(?:abstract|actual|annotation|as|break|by|catch|class|companion|const|constructor|continue|crossinline|data|do|dynamic|else|enum|expect|external|final|finally|for|fun|get|if|import|in|infix|init|inline|inner|interface|internal|is|lateinit|lazy|noinline|object|open|operator|out|override|package|private|protected|public|reified|return|sealed|set|super|suspend|tailrec|this|throw|try|typealias|val|var|vararg|when|where|while|true|false|null)\b/g,
  dart: /\b(?:abstract|as|assert|async|await|break|case|catch|class|const|continue|covariant|default|deferred|do|dynamic|else|enum|export|extends|extension|external|factory|false|final|finally|for|get|hide|if|implements|import|in|interface|is|late|library|mixin|new|null|on|operator|part|required|rethrow|return|set|show|static|super|switch|sync|this|throw|true|try|typedef|var|void|while|with|yield)\b/g,
  scala: /\b(?:abstract|case|catch|class|def|do|else|extends|false|final|finally|for|forSome|if|implicit|import|lazy|match|new|null|object|override|package|private|protected|return|sealed|super|this|throw|trait|try|true|type|val|var|while|with|yield)\b/g,
  sql: /\b(?:select|from|where|insert|into|values|update|set|delete|create|alter|drop|table|index|view|join|inner|left|right|outer|full|on|group|by|order|having|limit|offset|union|all|distinct|as|and|or|not|null|is|in|like|between|exists|case|when|then|else|end|primary|key|foreign|references|default|constraint|unique|check|cascade|begin|commit|rollback|transaction|with|returning|int|integer|varchar|text|boolean|date|timestamp|serial|bigint|float|numeric)\b/gi,
  groovy: /\b(?:abstract|as|assert|boolean|break|byte|case|catch|char|class|const|continue|def|default|do|double|else|enum|extends|false|final|finally|float|for|goto|if|implements|import|in|instanceof|int|interface|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|trait|transient|true|try|void|volatile|while)\b/g,
  ex: /\b(?:def|defp|defmodule|defstruct|defprotocol|defimpl|defmacro|do|end|if|else|unless|cond|case|when|fn|nil|true|false|and|or|not|in|import|alias|require|use|receive|after|raise|rescue|try|catch|with|for)\b/g,
  hs: /\b(?:module|import|where|let|in|do|case|of|if|then|else|data|type|newtype|class|instance|deriving|infix|infixl|infixr|foreign|default)\b/g,
  jl: /\b(?:function|end|if|elseif|else|for|while|do|begin|let|module|using|import|export|struct|mutable|abstract|primitive|type|return|break|continue|in|isa|where|macro|quote|try|catch|finally|true|false|nothing|global|local|const)\b/g,
  perl: /\b(?:my|our|local|sub|if|elsif|else|unless|while|until|for|foreach|do|return|last|next|redo|use|no|require|package|eq|ne|lt|gt|le|ge|cmp|and|or|not|xor|qw|print|say|defined|undef|ref|bless|wantarray|shift|unshift|push|pop)\b/g,
  r: /\b(?:if|else|for|while|repeat|function|return|in|next|break|TRUE|FALSE|NULL|NA|Inf|NaN|library|require)\b/g,
  ps1: /\b(?:function|param|if|elseif|else|switch|foreach|for|while|do|until|break|continue|return|try|catch|finally|throw|begin|process|end|filter|in|trap|class|enum|exit|this)\b/gi,
  md: null,
  html: null,
  yaml: null,
  toml: null,
  ini: null,
};

// languages whose line comment is '#' / '--' (in addition to // and /* */)
const HASH_COMMENT = new Set(['py', 'sh', 'rb', 'perl', 'r', 'ps1', 'ex', 'jl', 'yaml', 'toml', 'ini']);
const DASH_COMMENT = new Set(['lua', 'sql', 'hs']);

function highlightCode(text, lang) {
  if (!state.settings.syntaxHighlight || !lang || !text) return escapeHtml(text);
  // swap each token out for one private-use char (0xE000+i) while we work,
  // then put the real HTML back at the end. these chars aren't letters/digits
  // so later regexes can't match inside them. (the old number-based markers
  // got re-matched by the number regex and leaked junk numbers into the code.)
  const PUA = 0xE000;
  const slots = [];
  const push = (cls, raw) => {
    const idx = slots.length;
    slots.push(`<span class="${cls}">${escapeHtml(raw)}</span>`);
    return String.fromCharCode(PUA + idx);
  };
  let s = text;

  if (lang === 'md') {
    s = s.replace(/`([^`\n]+)`/g, (_, c) => push('tok-str', '`' + c + '`'));
    s = s.replace(/^(#{1,6}\s.*)$/gm, (m) => push('tok-kw', m));
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, c) => push('tok-fn', '**' + c + '**'));
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m) => push('tok-tag', m));
  } else if (lang === 'html') {
    s = s.replace(/<!--[\s\S]*?-->/g, m => push('tok-cmt', m));
    s = s.replace(/<\/?[\w:-]+/g, m => push('tok-tag', m));
    s = s.replace(/[\w-]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/g, m => push('tok-attr', m));
    s = s.replace(/\/?>/g, m => push('tok-tag', m));
  } else {
    // Comments
    if (lang === 'lua') s = s.replace(/--\[\[[\s\S]*?\]\]/g, m => push('tok-cmt', m)); // lua block
    s = s.replace(/\/\/[^\n]*/g, m => push('tok-cmt', m));
    if (HASH_COMMENT.has(lang)) s = s.replace(/#[^\n]*/g, m => push('tok-cmt', m));
    if (DASH_COMMENT.has(lang)) s = s.replace(/--[^\n]*/g, m => push('tok-cmt', m));
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => push('tok-cmt', m));
    // Strings (single, double, template)
    s = s.replace(/"(?:\\.|[^"\\\n])*"/g, m => push('tok-str', m));
    s = s.replace(/'(?:\\.|[^'\\\n])*'/g, m => push('tok-str', m));
    s = s.replace(/`(?:\\.|[^`\\])*`/g, m => push('tok-str', m));
    // Numbers
    s = s.replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, m => push('tok-num', m));
    // Keywords
    const kw = KEYWORDS[lang];
    if (kw) s = s.replace(kw, m => push('tok-kw', m));
    // Function calls
    s = s.replace(/\b([A-Za-z_$][\w$]*)\s*(?=\()/g, (_, n) => push('tok-fn', n));
  }

  // walk the chars: placeholder char -> its HTML, anything else -> escaped text
  let out = '';
  let buf = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const idx = cp - PUA;
    if (idx >= 0 && idx < slots.length) {
      if (buf) { out += escapeHtml(buf); buf = ''; }
      out += slots[idx];
    } else {
      buf += ch;
    }
  }
  if (buf) out += escapeHtml(buf);
  return out;
}

// ─────────────────────── Word-level intraline diff (Myers, char level) ───────────────────────
function intralineDiff(a, b) {
  // Returns two arrays of spans: { kind: 'same'|'diff', text } for a and b.
  // Tokenize at word boundaries for readability.
  const tokenize = (s) => s.match(/\w+|\s+|[^\w\s]/g) || [];
  const A = tokenize(a);
  const B = tokenize(b);
  // LCS via DP
  const n = A.length, m = B.length;
  // For huge lines, bail out
  if (n > 600 || m > 600) {
    return [[{kind:'diff', text:a}], [{kind:'diff', text:b}]];
  }
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = (A[i] === B[j]) ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  const aOut = []; const bOut = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { aOut.push({kind:'same', text:A[i]}); bOut.push({kind:'same', text:B[j]}); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { aOut.push({kind:'diff', text:A[i]}); i++; }
    else { bOut.push({kind:'diff', text:B[j]}); j++; }
  }
  while (i < n) { aOut.push({kind:'diff', text:A[i++]}); }
  while (j < m) { bOut.push({kind:'diff', text:B[j++]}); }
  return [aOut, bOut];
}
function intralineRender(spans, addKind) {
  // addKind is 'add' for new side, 'rem' for old side
  return spans.map(s => {
    if (s.kind === 'same') return escapeHtml(s.text);
    return `<span class="word-${addKind}">${escapeHtml(s.text)}</span>`;
  }).join('');
}

// Replace renderHunksOnly with an enhanced version that supports intraline
// highlighting + optional side-by-side rendering. Original definition is kept
// available as the underlying line iterator.
function pairAddRem(lines) {
  // Yields a sequence of items: 'add', 'rem', 'ctx', or 'pair' (intraline diff)
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.kind === 'rem' && i + 1 < lines.length && lines[i+1].kind === 'add') {
      out.push({ kind: 'pair', rem: ln.text, add: lines[i+1].text });
      i += 2;
    } else {
      out.push(ln);
      i++;
    }
  }
  return out;
}

const _origRenderHunksOnly = renderHunksOnly;
renderHunksOnly = function (diffText) {
  if (state.settings.diffSideBySide) return renderHunksSideBySide(diffText);
  const hunks = parseDiffHunks(diffText);
  if (!hunks.length) {
    $('#editor-diff-view').innerHTML = renderDiffToolbar() + '<div style="padding:16px;color:var(--text-3);">No changes for this file.</div>';
    return;
  }
  const lang = detectLang(state.editorFile?.path);
  let html = renderDiffToolbar();
  for (const h of hunks) {
    html += `<div class="diff-row hunk-header"><span class="diff-row-lineno">@@</span><span class="diff-row-content">${escapeHtml(h.header)}</span></div>`;
    let nLine = h.newStart, oLine = h.oldStart;
    const paired = pairAddRem(h.lines);
    for (const ln of paired) {
      if (ln.kind === 'pair') {
        const [aS, bS] = intralineDiff(ln.rem, ln.add);
        html += `<div class="diff-row removed"><span class="diff-row-lineno">${oLine}</span><span class="diff-row-content">${intralineRender(aS, 'rem')}</span></div>`;
        html += `<div class="diff-row added"><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${intralineRender(bS, 'add')}</span></div>`;
        oLine++; nLine++;
      } else if (ln.kind === 'add') {
        html += `<div class="diff-row added"><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        nLine++;
      } else if (ln.kind === 'rem') {
        html += `<div class="diff-row removed"><span class="diff-row-lineno">${oLine}</span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        oLine++;
      } else {
        html += `<div class="diff-row"><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        nLine++; oLine++;
      }
    }
  }
  $('#editor-diff-view').innerHTML = html;
  wireDiffToolbar();
};

function renderHunksSideBySide(diffText) {
  const hunks = parseDiffHunks(diffText);
  if (!hunks.length) {
    $('#editor-diff-view').innerHTML = renderDiffToolbar() + '<div style="padding:16px;color:var(--text-3);">No changes for this file.</div>';
    return;
  }
  const lang = detectLang(state.editorFile?.path);
  // Build aligned rows: each row has {left:{n,text,kind}, right:{n,text,kind}}
  const rows = [];
  for (const h of hunks) {
    rows.push({ hunk: h.header });
    let oLine = h.oldStart, nLine = h.newStart;
    const paired = pairAddRem(h.lines);
    for (const ln of paired) {
      if (ln.kind === 'pair') {
        const [aS, bS] = intralineDiff(ln.rem, ln.add);
        rows.push({
          left: { n: oLine, text: intralineRender(aS, 'rem'), kind: 'removed', raw: true },
          right: { n: nLine, text: intralineRender(bS, 'add'), kind: 'added', raw: true },
        });
        oLine++; nLine++;
      } else if (ln.kind === 'add') {
        rows.push({ left: { kind: 'empty' }, right: { n: nLine, text: highlightCode(ln.text, lang), kind: 'added', raw: true } });
        nLine++;
      } else if (ln.kind === 'rem') {
        rows.push({ left: { n: oLine, text: highlightCode(ln.text, lang), kind: 'removed', raw: true }, right: { kind: 'empty' } });
        oLine++;
      } else {
        rows.push({ left: { n: oLine, text: highlightCode(ln.text, lang), kind: 'ctx', raw: true }, right: { n: nLine, text: highlightCode(ln.text, lang), kind: 'ctx', raw: true } });
        oLine++; nLine++;
      }
    }
  }
  let html = renderDiffToolbar() + '<div class="diff-sxs"><div class="col col-left">';
  // Left column
  for (const r of rows) {
    if (r.hunk) { html += `<div class="sxs-row hunk"><span class="lineno"></span><span class="content">${escapeHtml(r.hunk)}</span></div>`; continue; }
    if (r.left.kind === 'empty') html += `<div class="sxs-row empty"><span class="lineno"></span><span class="content">&nbsp;</span></div>`;
    else html += `<div class="sxs-row ${r.left.kind === 'removed' ? 'removed' : ''}"><span class="lineno">${r.left.n}</span><span class="content">${r.left.text || '&nbsp;'}</span></div>`;
  }
  html += '</div><div class="col col-right">';
  for (const r of rows) {
    if (r.hunk) { html += `<div class="sxs-row hunk"><span class="lineno"></span><span class="content">${escapeHtml(r.hunk)}</span></div>`; continue; }
    if (r.right.kind === 'empty') html += `<div class="sxs-row empty"><span class="lineno"></span><span class="content">&nbsp;</span></div>`;
    else html += `<div class="sxs-row ${r.right.kind === 'added' ? 'added' : ''}"><span class="lineno">${r.right.n}</span><span class="content">${r.right.text || '&nbsp;'}</span></div>`;
  }
  html += '</div></div>';
  $('#editor-diff-view').innerHTML = html;
  wireDiffToolbar();
}

function renderDiffToolbar() {
  return `<div class="diff-toolbar">
    <button class="csh-action toolbar-toggle ${state.settings.diffSideBySide ? 'on' : ''}" id="diff-tb-sxs" title="Side-by-side">SxS</button>
    <button class="csh-action toolbar-toggle ${state.settings.diffIgnoreWS ? 'on' : ''}" id="diff-tb-ws"  title="Ignore whitespace">no WS</button>
    <span style="color:var(--text-3); font-size:11px;">context</span>
    <button class="csh-action" id="diff-tb-ctx-dec" title="Less context">−</button>
    <span style="color:var(--text-2); min-width:18px; text-align:center;">${state.settings.diffContext}</span>
    <button class="csh-action" id="diff-tb-ctx-inc" title="More context">+</button>
  </div>`;
}
function wireDiffToolbar() {
  $('#diff-tb-sxs')?.addEventListener('click', () => {
    state.settings.diffSideBySide = !state.settings.diffSideBySide;
    saveSettings();
    if (state.editorFile?.mode) applyEditorMode(state.editorFile.mode);
  });
  $('#diff-tb-ws')?.addEventListener('click', () => {
    state.settings.diffIgnoreWS = !state.settings.diffIgnoreWS;
    saveSettings();
    if (state.editorFile?.mode) applyEditorMode(state.editorFile.mode);
  });
  $('#diff-tb-ctx-inc')?.addEventListener('click', () => {
    state.settings.diffContext = Math.min(40, (state.settings.diffContext || 3) + 1);
    saveSettings();
    if (state.editorFile?.mode) applyEditorMode(state.editorFile.mode);
  });
  $('#diff-tb-ctx-dec')?.addEventListener('click', () => {
    state.settings.diffContext = Math.max(0, (state.settings.diffContext || 3) - 1);
    saveSettings();
    if (state.editorFile?.mode) applyEditorMode(state.editorFile.mode);
  });
}

// The textarea is moved between #editor-body and a wrapper depending on mode.
// Whenever we're about to strip the wrapper (or any other editor pane), call
// this first to detach the textarea so it doesn't get torn out of the DOM.
function detachEditorTextarea() {
  const ta = document.getElementById('editor-textarea');
  if (!ta) return;
  const body = document.getElementById('editor-body');
  if (!body) return;
  ta.classList.remove('editor-textarea-overlay-mode');
  if (ta.parentElement !== body) body.appendChild(ta);
}

// Patch applyEditorMode to use diffOpts (with ws + context) instead of plain diff
const _origApplyEditorMode = applyEditorMode;
applyEditorMode = async function (mode) {
  if (!state.editorFile) return;
  state.editorFile.mode = mode;
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  // The textarea may currently be wrapped inside .editor-edit-wrap. Move it
  // back to its permanent parent (#editor-body) before we strip wrappers, so
  // it isn't deleted along with its container.
  detachEditorTextarea();
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  // Remove any prior hunk-stage / conflict containers from previous modes
  detachEditorTextarea();
  $$('#editor-body .hunk-panel, #editor-body .conflict-wrap, #editor-body .editor-edit-wrap, #editor-body .image-diff, #editor-body .conflict-resolver').forEach(n => n.remove());

  if (mode === 'edit') {
    // Wrap textarea with line gutter + syntax-highlight overlay.
    const ta = $('#editor-textarea');
    const body = $('#editor-body');
    const wrap = document.createElement('div');
    wrap.className = 'editor-edit-wrap';
    const gutter = document.createElement('div');
    gutter.className = 'editor-line-gutter';
    const pane = document.createElement('div');
    pane.className = 'editor-edit-pane';
    const overlay = document.createElement('pre');
    overlay.className = 'editor-highlight-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    wrap.appendChild(gutter);
    wrap.appendChild(pane);
    pane.appendChild(overlay);
    ta.classList.remove('hidden');
    ta.classList.add('editor-textarea-overlay-mode');
    ta.parentElement?.removeChild(ta);
    pane.appendChild(ta);
    body.appendChild(wrap);
    ta.value = state.editorFile.content;
    ta.readOnly = !!state.editorFile.atCommit;
    const lang = detectLang(state.editorFile.path);
    const renderGutter = () => {
      const lines = (ta.value.match(/\n/g) || []).length + 1;
      let g = '';
      for (let i = 1; i <= lines; i++) g += i + '\n';
      gutter.textContent = g;
    };
    const renderHighlight = () => {
      // Trailing newline keeps the last line's height matching the textarea.
      const src = ta.value.endsWith('\n') ? ta.value + ' ' : ta.value + '\n ';
      overlay.innerHTML = lang ? highlightCode(src, lang) : escapeHtml(src);
    };
    const syncScroll = () => {
      overlay.scrollTop = ta.scrollTop;
      overlay.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    };
    renderGutter();
    renderHighlight();
    ta.addEventListener('input', () => { renderGutter(); renderHighlight(); });
    ta.addEventListener('scroll', syncScroll);
    $('#editor-save').disabled = !state.editorFile.dirty || !!state.editorFile.atCommit;
    $('#editor-revert').disabled = !!state.editorFile.atCommit;
    $('#editor-bar-status').textContent = state.editorFile.dirty ? '• modified' : '';
    return;
  }

  $('#editor-save').disabled = true;
  $('#editor-diff-view').classList.remove('hidden');
  $('#editor-diff-view').innerHTML = renderDiffToolbar() + '<div style="padding: 16px; color: var(--text-3);">Loading diff…</div>';

  // Files opened at a specific commit need that commit's diff, not the
  // working-tree diff — which is empty for an already-committed file.
  let r;
  if (state.editorFile.atCommit) {
    r = await window.api.fileDiffAtCommit({
      hash: state.editorFile.atCommit,
      file: state.editorFile.path,
    });
  } else {
    const staged = state.selectedFileStaged === true && state.selectedFile === state.editorFile.path;
    r = await window.api.diffOpts({
      file: state.editorFile.path,
      staged,
      ignoreAll: state.settings.diffIgnoreWS,
      context: state.settings.diffContext,
    });
  }
  const diffText = r.ok ? (r.data || '') : '';
  if (mode === 'file') renderWholeFileDiff(state.editorFile.content, diffText);
  else if (mode === 'hunks') renderHunksOnly(diffText);
  wireDiffToolbar();
};

// Also patch renderWholeFileDiff to inject the diff toolbar at the top
const _origRenderWholeFileDiff = renderWholeFileDiff;
renderWholeFileDiff = function (newContent, diffText) {
  _origRenderWholeFileDiff(newContent, diffText);
  // Prepend toolbar
  const cur = $('#editor-diff-view').innerHTML;
  $('#editor-diff-view').innerHTML = renderDiffToolbar() + cur;
  wireDiffToolbar();
};
