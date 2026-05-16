// ─────────────────────── History column widths (resizable) ───────────────────────
function applyHistoryColWidths() {
  const c = state.settings.historyCols || {};
  const root = document.documentElement;
  if (Number.isFinite(c.refs))   root.style.setProperty('--col-refs',   c.refs   + 'px');
  if (Number.isFinite(c.graph))  root.style.setProperty('--col-graph',  c.graph  + 'px');
  if (Number.isFinite(c.author)) root.style.setProperty('--col-author', c.author + 'px');
  if (Number.isFinite(c.date))   root.style.setProperty('--col-date',   c.date   + 'px');
  if (Number.isFinite(c.hash))   root.style.setProperty('--col-hash',   c.hash   + 'px');
}

function setupHistoryColResizers() {
  // Resizable columns: REFS, GRAPH, MESSAGE (the message edge resizes the message column),
  // AUTHOR, DATE. SHA (last) just consumes the trailing space — its right edge is the row edge.
  const cols = [
    { sel: '.gh-col-refs',   key: 'refs',   min: 60,  max: 400 },
    { sel: '.gh-col-graph',  key: 'graph',  min: 80,  max: 600 },
    { sel: '.gh-col-author', key: 'author', min: 60,  max: 400 },
    { sel: '.gh-col-date',   key: 'date',   min: 50,  max: 200 },
    { sel: '.gh-col-hash',   key: 'hash',   min: 40,  max: 200 },
  ];
  cols.forEach(({ sel, key, min, max }) => {
    const el = $(sel);
    if (!el || el.querySelector('.gh-col-resizer')) return;
    const handle = document.createElement('div');
    handle.className = 'gh-col-resizer';
    handle.title = `Drag to resize ${key}`;
    el.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = el.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => {
        const newW = Math.max(min, Math.min(max, startW + (ev.clientX - startX)));
        state.settings.historyCols = { ...(state.settings.historyCols || {}), [key]: newW };
        document.documentElement.style.setProperty(`--col-${key}`, newW + 'px');
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveSettings();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  D.Va loading modal — random GIF + status. Stack-counted so nested calls
//  work correctly. Iframe loads Tenor embed URLs; if blocked, the centred
//  fallback heart still shows so the modal isn't blank.
// ═══════════════════════════════════════════════════════════════════════════

const DVA_GIFS = [
  'https://tenor.com/embed/12140880',
  'https://tenor.com/embed/27653075',
  'https://tenor.com/embed/14670290760458410879',
  'https://tenor.com/embed/14410414565113091419',
  'https://tenor.com/embed/455810005706328581',
  'https://tenor.com/embed/17690544',
];

// Stream-preload Tenor embeds one-at-a-time into hidden iframes after the app
// is idle, so they're warm in the HTTP cache and don't pop in when the loading
// modal opens. Sequential (not parallel) keeps the network from competing with
// startup work; an idle callback defers kickoff past first paint.
const _preloadedGifs = new Set();
function _preloadDvaGifs() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;overflow:hidden;';
  document.body.appendChild(host);
  let i = 0;
  const next = () => {
    if (i >= DVA_GIFS.length) return;
    const url = DVA_GIFS[i++];
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.setAttribute('frameborder', '0');
    f.style.cssText = 'width:1px;height:1px;border:0;';
    const done = () => {
      _preloadedGifs.add(url);
      // Give the embed a moment to fetch its inline GIF asset, then move on.
      setTimeout(next, 1200);
    };
    f.addEventListener('load', done, { once: true });
    f.addEventListener('error', done, { once: true });
    host.appendChild(f);
    f.src = url;
  };
  next();
}
const _kickPreload = () => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(_preloadDvaGifs, { timeout: 4000 });
  } else {
    setTimeout(_preloadDvaGifs, 1500);
  }
};
if (document.readyState === 'complete') _kickPreload();
else window.addEventListener('load', _kickPreload, { once: true });

let _loadingDepth = 0;
function showLoading(title, sub = '') {
  _loadingDepth++;
  const titleEl = $('#loading-status');
  const subEl = $('#loading-sub');
  if (titleEl) titleEl.textContent = title || 'Working…';
  if (subEl) subEl.textContent = sub || '';
  if (_loadingDepth === 1) {
    // Prefer a gif we've already streamed into cache so it shows instantly.
    const warm = DVA_GIFS.filter(u => _preloadedGifs.has(u));
    const pool = warm.length ? warm : DVA_GIFS;
    const gif = pool[Math.floor(Math.random() * pool.length)];
    const iframe = $('#loading-gif');
    if (iframe) iframe.src = gif;
    $('#loading-modal')?.classList.remove('hidden');
  }
}
function hideLoading() {
  if (_loadingDepth > 0) _loadingDepth--;
  if (_loadingDepth === 0) {
    $('#loading-modal')?.classList.add('hidden');
    const iframe = $('#loading-gif');
    if (iframe) iframe.src = 'about:blank';
  }
}
// Convenience wrapper — runs an async fn with the modal up the whole time.
async function withLoading(title, sub, fn) {
  showLoading(title, sub);
  try { return await fn(); }
  finally { hideLoading(); }
}

// Wrap top-bar buttons with the loading modal. We re-bind each .onclick by
// capturing the existing handler and calling it inside a withLoading frame.
function _wrapBtnWithLoading(sel, title, subFn) {
  const el = $(sel);
  if (!el || el.__dvaWrapped) return;
  const orig = el.onclick;
  if (!orig) return;
  el.__dvaWrapped = true;
  el.onclick = async (ev) => {
    const sub = typeof subFn === 'function' ? subFn() : (subFn || '');
    showLoading(title, sub);
    try { return await orig.call(el, ev); }
    finally { hideLoading(); }
  };
}
function attachLoadingWrappers() {
  _wrapBtnWithLoading('#btn-fetch',  'Fetching…',  () => state.repo?.name || '');
  _wrapBtnWithLoading('#btn-pull',   'Pulling…',   () => `from ${state.settings.defaultRemote}`);
  _wrapBtnWithLoading('#btn-push',   'Pushing…',   () => `to ${state.settings.defaultRemote}`);

  // Wrap the long-running named operations. These are function declarations
  // earlier in the file, so the binding is reassignable.
  if (typeof cherryPickCommit === 'function') {
    const orig = cherryPickCommit;
    cherryPickCommit = (hash) => withLoading('Cherry-picking…', hash.slice(0, 7), () => orig(hash));
  }
  if (typeof mergeBranchInto === 'function') {
    const orig = mergeBranchInto;
    mergeBranchInto = (s, t) => withLoading('Merging…', `${s} → ${t}`, () => orig(s, t));
  }
  if (typeof rebaseBranchOnto === 'function') {
    const orig = rebaseBranchOnto;
    rebaseBranchOnto = (s, t) => withLoading('Rebasing…', `${s} onto ${t}`, () => orig(s, t));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Patch: stop auto-opening the first file when selecting a commit
// ═══════════════════════════════════════════════════════════════════════════

// We monkey-patch selectCommit's tail behaviour by wrapping it. The original
// fires `$('#commit-files-list .commit-file').click()` after the file list is
// built, which triggers the editor and slows down quick browsing. We intercept
// .click() on the first child for the next microtask after selectCommit runs.
const _origSelectCommit_noAutoOpen = selectCommit;
selectCommit = async function (hash) {
  // Temporarily neuter HTMLElement.click on the auto-clicked node so the inner
  // call inside the original is a no-op. Restore right after.
  const origClickProto = HTMLElement.prototype.click;
  let neutered = false;
  HTMLElement.prototype.click = function () {
    if (!neutered && this.classList?.contains('commit-file')) {
      neutered = true;       // only swallow the FIRST programmatic click
      return;
    }
    return origClickProto.apply(this, arguments);
  };
  try {
    await _origSelectCommit_noAutoOpen(hash);
  } finally {
    HTMLElement.prototype.click = origClickProto;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  Reload open editor file when branches change. Skips dirty buffers and
//  historical (atCommit) views so we don't clobber in-progress edits.
// ═══════════════════════════════════════════════════════════════════════════

async function reloadOpenEditorFile() {
  const ef = state.editorFile;
  if (!ef) return;
  if (ef.dirty) {
    toast(`Editor has unsaved changes for ${ef.path} — not reloading.`, 'warn');
    return;
  }
  if (ef.atCommit) return;
  try {
    if (ef.fileType === 'text') {
      const r = await window.api.readFile(ef.path);
      if (!r.ok) return;
      ef.content = r.data;
      ef.original = r.data;
      const ta = $('#editor-textarea');
      if (ta) ta.value = r.data;
      if (ef.mode && ef.mode !== 'edit') {
        applyEditorMode(ef.mode);
      }
    } else if (['image', 'video', 'audio'].includes(ef.fileType)) {
      // Re-fetch the binary so the media element shows the new branch's copy.
      const r = await window.api.readBinary(ef.path);
      if (r.ok) {
        const dataUri = `data:${mimeFor(ef.path)};base64,${r.data}`;
        renderMediaPane(ef.fileType, dataUri, r.size);
      }
    }
  } catch {}
}

const _origSwitchBranch_reload = switchBranch;
switchBranch = async function (b) {
  await _origSwitchBranch_reload(b);
  await reloadOpenEditorFile();
};

// Also reload on tab switch (different repo entirely → file path may not exist).
const _origActivateRepoTab_reload = activateRepoTab;
activateRepoTab = async function (idx) {
  // Always drop any in-progress conflict resolver before switching repos.
  if (state.conflictResolver) closeConflictResolver();
  await _origActivateRepoTab_reload(idx);
  if (state.editorFile) {
    state.editorFile = null;
    $('#editor-tab')?.classList.add('hidden');
    if (state.activeCenterTab === 'editor') switchCenterTab('history');
  }
  // Final sweep in case any DOM lingered.
  $$('#editor-body .conflict-resolver').forEach(n => n.remove());
};

// ═══════════════════════════════════════════════════════════════════════════
//  Merge-conflict workflow: when an op stops on conflicts, auto-prompt to
//  resolve. We track a "conflicts handled" flag so we don't re-prompt every
//  refresh tick for the same op.
// ═══════════════════════════════════════════════════════════════════════════

state._conflictPromptShown = false;

const _origRefreshOpState = refreshOpState;
refreshOpState = async function () {
  await _origRefreshOpState();
  const conflicted = (state.status?.conflicted?.length || 0) > 0;
  const inOp = state.opState && (
    state.opState.merging || state.opState.rebasing ||
    state.opState.cherryPicking || state.opState.reverting
  );
  if (conflicted && inOp) {
    if (!state._conflictPromptShown) {
      state._conflictPromptShown = true;
      const kind = state.opState.merging ? 'merge'
                : state.opState.rebasing ? 'rebase'
                : state.opState.cherryPicking ? 'cherry-pick'
                : 'operation';
      toast(`${state.status.conflicted.length} conflicted file(s) — opening resolver…`, 'warn', 4000);
      // Slight delay so the user sees the toast / banner update first
      setTimeout(() => {
        if (state.status?.conflicted?.length) openConflictsModal();
      }, 250);
      try { window.api.notify({ title: 'D.Va Git', body: `Conflicts during ${kind}` }); } catch {}
    }
  } else {
    state._conflictPromptShown = false;
  }
};

// ─────────────────────── Init ───────────────────────
(async function init2() {
  await loadSettings();
  setupSplitters();
  setupSidebarSectionResizers();
  setupChangesSectionResizers();
  setupChangesCollapseToggles();
  applyTheme();
  applyHistoryColWidths();
  setupHistoryColResizers();
  setupAutoFetch();
  attachLoadingWrappers();
  renderRecent();
  setStatus('Idle');
  const restored = await restoreSession();
  if (!restored) {
    // welcome remains visible
  }
})();
