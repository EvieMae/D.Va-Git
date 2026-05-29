// ─────────────────────── Hunk staging ───────────────────────
function openHunkStaging(filePath, isStaged) {
  state.editorFile = {
    path: filePath,
    fileType: 'text',
    mode: 'stage',
    editable: false,
    dirty: false,
    atCommit: null,
    content: '',
  };
  $('#editor-tab').classList.remove('hidden');
  $('#editor-tab-label').textContent = filePath.split(/[\\/]/).pop() || filePath;
  $('#editor-tab').title = filePath;
  $('#editor-bar-path').textContent = filePath + (isStaged ? ' (staged hunks)' : ' (unstaged hunks)');
  $('#editor-bar-status').textContent = '';
  $('#editor-lfs-badge').classList.toggle('hidden', !isLfsPath(filePath));
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.add('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = true;
  switchCenterTab('editor');

  // Hide all editor panes
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  $('#editor-media').classList.add('hidden');
  $('#editor-binary').classList.add('hidden');
  detachEditorTextarea();
  $$('#editor-body .hunk-panel, #editor-body .conflict-wrap, #editor-body .editor-edit-wrap, #editor-body .image-diff, #editor-body .conflict-resolver').forEach(n => n.remove());

  renderHunkPanel(filePath, isStaged);
}

async function renderHunkPanel(filePath, isStaged) {
  const body = $('#editor-body');
  const panel = document.createElement('div');
  panel.className = 'hunk-panel';
  panel.innerHTML = `
    <div class="hunk-panel-actions">
      <button class="csh-action" id="hp-select-all">Select all</button>
      <button class="csh-action" id="hp-select-none">None</button>
      <span style="flex:1"></span>
      <button class="csh-action" id="hp-apply">${isStaged ? 'Unstage selected hunks' : 'Stage selected hunks'}</button>
    </div>
    <div id="hp-list"><div style="padding:16px;color:var(--text-3);">Loading…</div></div>
  `;
  body.appendChild(panel);

  const r = await window.api.diffOpts({
    file: filePath,
    staged: isStaged,
    ignoreAll: false,
    context: 3,
  });
  if (!r.ok) {
    $('#hp-list').innerHTML = `<div style="padding:16px;color:var(--err);">${escapeHtml(r.error)}</div>`;
    return;
  }
  const hunks = parseDiffHunksWithRange(r.data || '');
  if (!hunks.length) {
    $('#hp-list').innerHTML = `<div style="padding:16px;color:var(--text-3);">No ${isStaged ? 'staged ' : ''}changes for this file.</div>`;
    return;
  }
  const lang = detectLang(filePath);
  let html = '';
  hunks.forEach((h, hi) => {
    html += `<div class="hunk-block" data-hi="${hi}">
      <div class="hunk-block-header">
        <input type="checkbox" class="hunk-check" data-hi="${hi}" checked />
        <span class="hunk-block-header-text">${escapeHtml(h.header)}</span>
        <span class="hunk-block-header-spacer"></span>
      </div>
      <div class="hunk-block-rows">`;
    let oLine = h.oldStart, nLine = h.newStart;
    h.lines.forEach((ln, li) => {
      if (ln.kind === 'add') {
        html += `<div class="diff-row added" data-hi="${hi}" data-li="${li}"><span class="diff-row-lineno"></span><span class="diff-row-lineno"></span><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        nLine++;
      } else if (ln.kind === 'rem') {
        html += `<div class="diff-row removed" data-hi="${hi}" data-li="${li}"><span class="diff-row-lineno"></span><span class="diff-row-lineno">${oLine}</span><span class="diff-row-lineno"></span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        oLine++;
      } else {
        html += `<div class="diff-row" data-hi="${hi}" data-li="${li}"><span class="diff-row-lineno"></span><span class="diff-row-lineno">${oLine}</span><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${highlightCode(ln.text, lang) || '&nbsp;'}</span></div>`;
        oLine++; nLine++;
      }
    });
    html += '</div></div>';
  });
  $('#hp-list').innerHTML = html;

  const selectAll = (val) => {
    $$('#hp-list .hunk-check').forEach(cb => cb.checked = val);
  };
  $('#hp-select-all').onclick = () => selectAll(true);
  $('#hp-select-none').onclick = () => selectAll(false);

  $('#hp-apply').onclick = async () => {
    const selected = [];
    $$('#hp-list .hunk-check').forEach((cb, i) => { if (cb.checked) selected.push(hunks[i]); });
    if (!selected.length) { toast('No hunks selected', 'warn'); return; }
    const patch = buildPatchForHunks(filePath, selected);
    setStatus(isStaged ? 'Unstaging…' : 'Staging…', 'busy');
    const r = await window.api.applyCached({ patch, reverse: isStaged });
    if (r.ok) {
      toast(isStaged ? 'Unstaged hunks' : 'Staged hunks', 'ok');
      await refreshAll();
      // Re-render hunk panel with the remaining diff
      renderHunkPanel(filePath, isStaged);
    } else {
      toast(r.error, 'error');
      setStatus('Idle', 'error');
    }
  };
}

// Extended hunk parser that keeps line array as-is (compatible with parseDiffHunks).
function parseDiffHunksWithRange(diffText) {
  return parseDiffHunks(diffText);
}

function buildPatchForHunks(filePath, hunks) {
  // git apply requires a real --- / +++ header per file. We pass a/file and b/file.
  let out = `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n`;
  for (const h of hunks) {
    let removed = 0, added = 0;
    for (const ln of h.lines) {
      if (ln.kind === 'rem') removed++;
      else if (ln.kind === 'add') added++;
      else { removed++; added++; }
    }
    out += `@@ -${h.oldStart},${removed} +${h.newStart},${added} @@\n`;
    for (const ln of h.lines) {
      const prefix = ln.kind === 'rem' ? '-' : ln.kind === 'add' ? '+' : ' ';
      out += prefix + ln.text + '\n';
    }
  }
  return out;
}

// Add "Stage hunks" / "Unstage hunks" buttons to each change item via action menu
const _origRenderChanges2 = renderChanges;
renderChanges = function () {
  _origRenderChanges2();
  $$('.change-item').forEach(item => {
    const path = item.dataset.path;
    const isStaged = item.dataset.staged === 'true';
    // Add Hunks button to the action area
    const acts = item.querySelector('.ci-actions');
    if (acts && !acts.querySelector('[data-act="hunks"]')) {
      const b = document.createElement('button');
      b.className = 'ci-act-btn';
      b.dataset.act = 'hunks';
      b.title = 'Stage/unstage hunks';
      b.textContent = '◧';
      b.onclick = (e) => { e.stopPropagation(); openHunkStaging(path, isStaged); };
      acts.insertBefore(b, acts.firstChild);
    }
  });
};

// ─────────────────────── Op-state banner ───────────────────────
function _ensureOpBanner() {
  let b = $('#op-banner');
  if (b) return b;
  b = document.createElement('div');
  b.id = 'op-banner';
  b.className = 'op-banner hidden';
  const center = $('.center');
  if (center) center.insertBefore(b, center.firstChild);
  return b;
}

async function refreshOpState() {
  const r = await window.api.opState();
  if (!r.ok) { state.opState = null; return; }
  state.opState = r.data;
  const b = _ensureOpBanner();
  const conflicted = (state.status?.conflicted?.length || 0) > 0;
  const op = r.data;
  let shown = false;
  let kind = '';
  let title = '';
  if (op.merging) { shown = true; kind = 'merge'; title = 'MERGE IN PROGRESS'; }
  else if (op.rebasing) { shown = true; kind = 'rebase'; title = 'REBASE IN PROGRESS'; }
  else if (op.cherryPicking) { shown = true; kind = 'cherry'; title = 'CHERRY-PICK IN PROGRESS'; }
  else if (op.reverting) { shown = true; kind = 'revert'; title = 'REVERT IN PROGRESS'; }
  if (!shown) { b.classList.add('hidden'); b.innerHTML = ''; return; }
  b.classList.remove('hidden');
  b.className = `op-banner kind-${kind}`;
  b.innerHTML = `
    <span class="op-banner-title">${title}</span>
    ${conflicted ? `<span style="color: var(--err); font-weight: 600;">${state.status.conflicted.length} conflicted file(s)</span>` : ''}
    <span class="op-banner-spacer"></span>
    ${conflicted ? `<button class="csh-action" id="op-resolve">Resolve conflicts…</button>` : ''}
    <button class="csh-action" id="op-continue">Continue</button>
    <button class="csh-action danger" id="op-abort">Abort</button>
  `;
  $('#op-resolve')?.addEventListener('click', () => openConflictsView());
  $('#op-continue')?.addEventListener('click', async () => {
    setStatus('Continuing…', 'busy');
    let r;
    if (op.merging) r = await window.api.mergeContinue();
    else if (op.rebasing) r = await window.api.rebaseContinue();
    else if (op.cherryPicking) r = await window.api.cherryPickContinue();
    else r = { ok: false, error: 'No op in progress' };
    if (r.ok) { toast('Continued', 'ok'); await refreshAll(); }
    else { toast(r.error, 'error'); setStatus('Idle', 'error'); }
  });
  $('#op-abort')?.addEventListener('click', async () => {
    modal({
      title: 'ABORT OPERATION?',
      body: `<p>Abort the current ${kind}? Your branch will return to its prior state.</p>`,
      okText: 'ABORT',
      onOk: async () => {
        setStatus('Aborting…', 'busy');
        let r;
        if (op.merging) r = await window.api.mergeAbort();
        else if (op.rebasing) r = await window.api.rebaseAbort();
        else if (op.cherryPicking) r = await window.api.cherryPickAbort();
        else r = { ok: false, error: 'No op in progress' };
        if (r.ok) { toast('Aborted', 'ok'); await refreshAll(); }
        else { toast(r.error, 'error'); setStatus('Idle', 'error'); return false; }
      },
    });
  });
}

// Hook into refreshAll to also fetch op state and signing info
const _origRefreshAll = refreshAll;
refreshAll = async function () {
  await _origRefreshAll();
  try {
    const s = await window.api.signingInfo();
    if (s.ok) state.signing = s.data;
  } catch {}
  await refreshOpState();
  applySigningPill();
  markProtectedBranches();
};

// ═══════════════════════════════════════════════════════════════════════════
//  Conflict resolver — GitKraken-style.
//
//  Layout (lives in the editor tab, replacing it while active):
//
//    ┌─ resolver toolbar ────────────────────────────────────────────────┐
//    │ ⚠ Resolving merge  ·  2/3 files done   [Continue ✓] [Abort]       │
//    ├──────────┬────────────────────────────────────────────────────────┤
//    │  FILES   │ ┌─ pane toolbar ──────────────────────────────────────┐ │
//    │ • a.js   │ │ b.js · 1 of 3  [◀ ▶]   [all ours][all theirs][save] │ │
//    │ ✓ a2.js  │ ├──────────────────────┬──────────────────────────────┤ │
//    │ ◧ b.js   │ │ Ours (HEAD)          │ Theirs (incoming)            │ │ ← sync scroll
//    │          │ │   …                  │   …                          │ │
//    │          │ ├──────────────────────┴──────────────────────────────┤ │
//    │          │ │ Output (editable) — per-conflict action bars        │ │
//    │          │ │  ┌─ conflict 1 ────────────────────────────────────┐│ │
//    │          │ │  │ [Ours][Theirs][Both ⇄][None][Edit]               ││ │
//    │          │ │  │ result lines…                                    ││ │
//    │          │ │  └──────────────────────────────────────────────────┘│ │
//    │          │ └─────────────────────────────────────────────────────┘ │
//    └──────────┴────────────────────────────────────────────────────────┘
//
//  Per-conflict state: { mode: 'ours'|'theirs'|'both'|'none'|'custom',
//                        order: 'OT'|'TO',        // only used when mode=both
//                        custom: '…' }            // only used when mode=custom
// ═══════════════════════════════════════════════════════════════════════════

// CRLF-safe per-line parser. Returns { lines, blocks, usesCRLF }.
function parseConflictsByLine(content) {
  // Without splitting on \r?\n the "=======\r" marker never matches on
  // Windows-EOL files and the whole conflict falls into OURS.
  const usesCRLF = /\r\n/.test(content);
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (/^<{7}(\s|$)/.test(lines[i])) {
      const startMarkerLine = i;
      const oursLabel = lines[i].slice(8).trim() || 'ours';
      i++;
      const ours = [];
      while (i < lines.length && !/^={7}(\s|$)/.test(lines[i])) {
        ours.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip =======
      const theirs = [];
      while (i < lines.length && !/^>{7}(\s|$)/.test(lines[i])) {
        theirs.push(lines[i]);
        i++;
      }
      const theirsLabel = (lines[i] || '').slice(8).trim() || 'theirs';
      const endMarkerLine = i;
      blocks.push({ startMarkerLine, endMarkerLine, oursLabel, theirsLabel, ours, theirs });
      i++;
    } else {
      i++;
    }
  }
  return { lines, blocks, usesCRLF };
}

// ── Choice model helpers ──
// A choice starts as `{ mode: null }` — that means the user hasn't picked yet.
// We show the OURS content as a suggestion in the output pane, but the file
// stays "in progress" until every block has a real mode set.
function _defaultChoice() {
  return { mode: null, order: 'OT', custom: '' };
}
function _resolvedLinesForChoice(block, choice) {
  const mode = choice?.mode || 'ours'; // null → preview ours
  switch (mode) {
    case 'ours':    return block.ours.slice();
    case 'theirs':  return block.theirs.slice();
    case 'both':    return (choice?.order === 'TO')
      ? [...block.theirs, ...block.ours]
      : [...block.ours, ...block.theirs];
    case 'none':    return [];
    case 'custom':  return (choice?.custom || '').split(/\r?\n/);
    default:        return block.ours.slice();
  }
}

// Build a "side view" of the file as if one side had been picked everywhere —
// used to render Ours and Theirs panes with conflict regions highlighted.
function buildSideView(parsed, side) {
  const { lines, blocks } = parsed;
  const out = [];
  const ranges = [];
  let i = 0;
  const byStart = new Map(blocks.map((b, idx) => [b.startMarkerLine, idx]));
  while (i < lines.length) {
    if (byStart.has(i)) {
      const bi = byStart.get(i);
      const block = blocks[bi];
      const sideLines = side === 'ours' ? block.ours : block.theirs;
      const startIdx = out.length;
      out.push(...sideLines);
      const endIdx = out.length - 1;
      if (sideLines.length > 0) ranges.push({ startIdx, endIdx, blockIdx: bi });
      else ranges.push({ startIdx: out.length, endIdx: out.length - 1, blockIdx: bi, empty: true });
      i = block.endMarkerLine + 1;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return { lines: out, ranges };
}

// Build the file contents the user is about to write, given current choices.
function buildResolvedContent(parsed, choices) {
  const { lines, blocks } = parsed;
  const out = [];
  let i = 0;
  const byStart = new Map(blocks.map((b, idx) => [b.startMarkerLine, idx]));
  while (i < lines.length) {
    if (byStart.has(i)) {
      const bi = byStart.get(i);
      const block = blocks[bi];
      out.push(..._resolvedLinesForChoice(block, choices[bi]));
      i = block.endMarkerLine + 1;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out;
}

// ── Per-file state: tracks user choices on each conflict block in a file. ──
function _ensureFileState(filePath, parsed) {
  const cv = state.conflictsView;
  if (cv.files[filePath]) return cv.files[filePath];
  cv.files[filePath] = {
    parsed,
    choices: parsed.blocks.map(() => _defaultChoice()),
    activeIdx: 0,
    saved: false,    // user has run "Save & mark resolved" at least once
    resolved: false, // file is staged + has no remaining conflict markers
  };
  return cv.files[filePath];
}

function _opTitle(kind) {
  return ({ merge: 'merge', rebase: 'rebase', cherryPick: 'cherry-pick', revert: 'revert' })[kind] || 'operation';
}
function _currentOpKind() {
  const op = state.opState || {};
  if (op.merging) return 'merge';
  if (op.rebasing) return 'rebase';
  if (op.cherryPicking) return 'cherryPick';
  if (op.reverting) return 'revert';
  return null;
}

// ── Top-level entry point ──
// Opens (or refreshes) the GitKraken-style conflict resolver inside the editor
// tab. Builds the file sidebar from state.status.conflicted, and renders the
// three-pane resolver for the active file.
async function openConflictsView(initialFile) {
  const files = state.status?.conflicted || [];
  if (!files.length) { toast('No conflicted files', 'warn'); return; }

  // Initialise the persistent view state. We hold on to state for files that
  // have already been resolved so the top toolbar can show "2 of 5 done" even
  // after a refresh drops them from state.status.conflicted.
  if (!state.conflictsView || !state.conflictsView.open) {
    state.conflictsView = {
      open: true,
      files: {},
      activeFile: null,
      opKind: _currentOpKind(),
      totalFiles: files.length,
    };
  } else {
    state.conflictsView.opKind = _currentOpKind() || state.conflictsView.opKind;
    // If a new operation has more files than we've ever seen, bump the total.
    const seen = Object.keys(state.conflictsView.files).length;
    state.conflictsView.totalFiles = Math.max(state.conflictsView.totalFiles || 0, seen, files.length);
  }

  const cv = state.conflictsView;
  const target = initialFile && files.includes(initialFile)
    ? initialFile
    : (cv.activeFile && files.includes(cv.activeFile) ? cv.activeFile : files[0]);

  // Pre-parse every conflicted file so the sidebar can show counts/progress.
  await Promise.all(files.map(async (f) => {
    if (cv.files[f]) return; // already parsed
    const r = await window.api.readFile(f);
    if (!r.ok) { cv.files[f] = { error: r.error }; return; }
    _ensureFileState(f, parseConflictsByLine(r.data));
  }));

  // If the user closed the resolver while we were fetching, drop the render.
  if (state.conflictsView !== cv || !cv.open) return;

  cv.activeFile = target;

  // Repurpose the editor tab.
  state.editorFile = { path: '__conflicts__', fileType: 'text', mode: 'conflict', editable: false, dirty: false };
  $('#editor-tab').classList.remove('hidden');
  $('#editor-tab-label').textContent = `⚠ Conflicts (${files.length})`;
  $('#editor-tab').title = `Resolving ${_opTitle(cv.opKind)} — ${files.length} file(s)`;
  $('#editor-bar-path').textContent = `Resolving ${_opTitle(cv.opKind)}`;
  $('#editor-bar-status').textContent = '';
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.add('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = true;
  switchCenterTab('editor');

  // Tear down whatever else lived in the editor body.
  detachEditorTextarea();
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  $('#editor-media').classList.add('hidden');
  $('#editor-binary').classList.add('hidden');
  $$('#editor-body .hunk-panel, #editor-body .conflict-wrap, #editor-body .editor-edit-wrap, #editor-body .image-diff, #editor-body .conflict-resolver').forEach(n => n.remove());

  const root = document.createElement('div');
  root.className = 'conflict-resolver';
  root.innerHTML = `
    <div class="crv-toolbar">
      <span class="crv-title">⚠ <span id="crv-title-text"></span></span>
      <span class="crv-progress" id="crv-progress"></span>
      <span class="crv-spacer"></span>
      <button class="csh-action" id="crv-continue" title="Finish the in-progress operation" disabled>Continue ✓</button>
      <button class="csh-action danger" id="crv-abort" title="Abort the in-progress operation">Abort</button>
    </div>
    <div class="crv-main">
      <aside class="crv-files">
        <div class="crv-files-header">
          <span>Conflicted files</span>
          <span class="crv-files-count" id="crv-files-count"></span>
        </div>
        <div class="crv-files-list" id="crv-files-list"></div>
        <div class="crv-files-hint">
          <kbd>j</kbd>/<kbd>k</kbd> next/prev conflict<br/>
          <kbd>1</kbd> ours · <kbd>2</kbd> theirs · <kbd>3</kbd> both · <kbd>4</kbd> none<br/>
          <kbd>Ctrl+S</kbd> save &amp; mark resolved
        </div>
      </aside>
      <div class="crv-resolver" id="crv-resolver"></div>
    </div>
  `;
  $('#editor-body').appendChild(root);

  _crvRenderToolbar();
  _crvRenderFileList();
  _crvRenderResolver();

  $('#crv-continue').onclick = _crvOnContinue;
  $('#crv-abort').onclick = _crvOnAbort;
}

// Back-compat shim — many call sites still call openConflictsModal().
async function openConflictsModal() { return openConflictsView(); }

// Tear down the resolver. Called when the user closes the editor tab or
// finishes the operation.
function closeConflictResolver() {
  state.conflictResolver = null;
  if (state.conflictsView) state.conflictsView.open = false;
  if (state.editorFile?.mode === 'conflict') state.editorFile = null;
  $$('#editor-body .conflict-resolver').forEach(n => n.remove());
  $('#editor-tab')?.classList.add('hidden');
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.remove('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = false;
  if (state.activeCenterTab === 'editor') switchCenterTab('history');
}

// ── Top toolbar (operation + Continue/Abort) ──
function _crvRenderToolbar() {
  const cv = state.conflictsView;
  if (!cv) return;
  const remaining = (state.status?.conflicted || []).length;
  const total = Math.max(cv.totalFiles || 0, remaining);
  const done = Math.max(0, total - remaining);
  const titleEl = $('#crv-title-text');
  if (titleEl) titleEl.textContent = `Resolving ${_opTitle(cv.opKind)}`;
  const progEl = $('#crv-progress');
  if (progEl) {
    progEl.textContent = remaining === 0
      ? '✓ All files resolved — ready to continue'
      : `${done} of ${total} file(s) resolved · ${remaining} remaining`;
    progEl.className = 'crv-progress' + (remaining === 0 ? ' ok' : '');
  }
  const contEl = $('#crv-continue');
  if (contEl) {
    contEl.disabled = remaining > 0 || !cv.opKind;
    contEl.classList.toggle('primary', remaining === 0);
  }
}

// ── File sidebar ──
function _crvRenderFileList() {
  const cv = state.conflictsView;
  if (!cv) return;
  const list = $('#crv-files-list');
  const countEl = $('#crv-files-count');
  if (!list || !countEl) return;  // resolver was torn down
  const files = state.status?.conflicted || [];
  countEl.textContent = files.length;

  list.innerHTML = files.map(f => {
    const fs = cv.files[f];
    const isActive = f === cv.activeFile;
    if (!fs || fs.error) {
      return `
        <div class="crv-file-row ${isActive ? 'active' : ''} crv-file-error" data-file="${escapeHtml(f)}" title="${escapeHtml(f)}">
          <span class="crv-file-icon">!</span>
          <span class="crv-file-name">${escapeHtml(f.split(/[\\/]/).pop() || f)}</span>
          <span class="crv-file-meta">read error</span>
        </div>
      `;
    }
    const total = fs.parsed.blocks.length;
    const doneBlocks = fs.choices.filter((c, i) => _choiceTouched(c)).length;
    const pct = total === 0 ? 100 : Math.round((doneBlocks / total) * 100);
    const allTouched = doneBlocks === total && total > 0;
    return `
      <div class="crv-file-row ${isActive ? 'active' : ''} ${allTouched ? 'all-touched' : ''}"
           data-file="${escapeHtml(f)}" title="${escapeHtml(f)}">
        <span class="crv-file-icon">${allTouched ? '✓' : '◧'}</span>
        <span class="crv-file-name">${escapeHtml(f.split(/[\\/]/).pop() || f)}</span>
        <span class="crv-file-meta">${doneBlocks}/${total}</span>
        <div class="crv-file-bar"><span style="width:${pct}%"></span></div>
      </div>
    `;
  }).join('');

  $$('#crv-files-list .crv-file-row').forEach(row => {
    row.onclick = () => {
      cv.activeFile = row.dataset.file;
      _crvRenderFileList();
      _crvRenderResolver();
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      const file = row.dataset.file;
      showContextMenu(e.clientX, e.clientY, [
        { icon: '⟵', label: 'Use ours for entire file', action: () => _crvFileBulk(file, 'ours') },
        { icon: '⟶', label: 'Use theirs for entire file', action: () => _crvFileBulk(file, 'theirs') },
        { icon: '⇄', label: 'Use both for entire file', action: () => _crvFileBulk(file, 'both') },
        { separator: true },
        { icon: '↗', label: 'Open file in plain editor', action: () => { closeConflictResolver(); openFileInEditor(file, true); } },
      ]);
    };
  });
}

function _choiceTouched(c) {
  // "Touched" = user-meaningful resolution recorded. The default we set on
  // first load is 'ours' — counting that as touched lets the progress bar
  // start populated, and "All ours/Theirs/Both" buttons keep working.
  return !!c && c.mode != null;
}

function _crvFileBulk(file, mode) {
  const fs = state.conflictsView?.files[file];
  if (!fs || !fs.choices) return;
  fs.choices.forEach(c => {
    c.mode = mode;
    if (mode === 'both' && !c.order) c.order = 'OT';
  });
  _crvRenderFileList();
  if (file === state.conflictsView.activeFile) _crvRenderResolver();
}

// ── Resolver right pane (toolbar + Ours/Theirs + Output) ──
function _crvRenderResolver() {
  const cv = state.conflictsView;
  if (!cv) return;
  const host = $('#crv-resolver');
  if (!host) return; // resolver was torn down
  const file = cv.activeFile;
  const fs = file && cv.files[file];
  if (!file) { host.innerHTML = '<div class="crv-empty">Pick a file from the left to start resolving.</div>'; return; }
  if (!fs || fs.error) {
    host.innerHTML = `<div class="crv-empty crv-err">Could not read <strong>${escapeHtml(file)}</strong>${fs?.error ? ': ' + escapeHtml(fs.error) : ''}</div>`;
    return;
  }
  if (!fs.parsed.blocks.length) {
    host.innerHTML = `
      <div class="crv-empty">
        <strong>${escapeHtml(file)}</strong> has no conflict markers, but Git still considers it conflicted
        — likely a structural conflict (binary file, add/delete, rename/rename).
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;">
          <button class="csh-action" id="crv-struct-ours">Keep ours</button>
          <button class="csh-action" id="crv-struct-theirs">Keep theirs</button>
          <button class="csh-action" id="crv-struct-open">Open file…</button>
        </div>
      </div>
    `;
    $('#crv-struct-ours').onclick = async () => {
      const r = await window.api.checkoutSide({ side: 'ours', file });
      if (r.ok) await _crvAfterFileResolved(file);
      else toast(r.error || 'Could not keep ours', 'error');
    };
    $('#crv-struct-theirs').onclick = async () => {
      const r = await window.api.checkoutSide({ side: 'theirs', file });
      if (r.ok) await _crvAfterFileResolved(file);
      else toast(r.error || 'Could not keep theirs', 'error');
    };
    $('#crv-struct-open').onclick = () => { openFileInEditor(file, true); };
    return;
  }
  const headRef = state.status?.current || 'HEAD';
  const theirsLabel = fs.parsed.blocks[0]?.theirsLabel || 'incoming';
  const fileName = file.split(/[\\/]/).pop() || file;
  host.innerHTML = `
    <div class="crv-pane-toolbar">
      <strong title="${escapeHtml(file)}">${escapeHtml(fileName)}</strong>
      <span class="crv-nav">
        <button id="crv-prev" title="Previous conflict (k)">▲</button>
        <span id="crv-nav-text">conflict 1 of ${fs.parsed.blocks.length}</span>
        <button id="crv-next" title="Next conflict (j)">▼</button>
      </span>
      <span class="crv-status" id="crv-status"></span>
      <span class="crv-spacer"></span>
      <button class="csh-action" id="crv-all-ours" title="Take ours for every conflict in this file">All ours</button>
      <button class="csh-action" id="crv-all-theirs" title="Take theirs for every conflict in this file">All theirs</button>
      <button class="csh-action" id="crv-all-both" title="Take both, ours-first">All both</button>
      <button class="csh-action crv-save" id="crv-mark-resolved" title="Save the resolved file and stage it (Ctrl+S)">Save &amp; mark resolved</button>
    </div>
    <div class="crv-top">
      <div class="crv-pane">
        <div class="crv-pane-header">
          <span class="cr-badge a">A</span>
          <span>Ours</span>
          <span class="crv-pane-sub">on <strong>${escapeHtml(headRef)}</strong></span>
        </div>
        <div class="crv-pane-body crv-side-pane" id="crv-ours"></div>
      </div>
      <div class="crv-pane">
        <div class="crv-pane-header">
          <span class="cr-badge b">B</span>
          <span>Theirs</span>
          <span class="crv-pane-sub">${escapeHtml(theirsLabel)}</span>
        </div>
        <div class="crv-pane-body crv-side-pane" id="crv-theirs"></div>
      </div>
    </div>
    <div class="crv-bottom">
      <div class="crv-pane">
        <div class="crv-pane-header">
          <span>Result</span>
          <span class="crv-pane-sub">click an action on each conflict — output will be written when you save</span>
        </div>
        <div class="crv-output-wrap">
          <div class="crv-pane-body crv-output" id="crv-output"></div>
          <div class="crv-minimap" id="crv-minimap" title="Click a tick to jump to that conflict"></div>
        </div>
      </div>
    </div>
  `;

  _crvRenderSides();
  _crvRenderOutput();
  _crvRenderMinimap();
  _crvUpdateStatus();
  _crvHighlightActive();

  // Sync scroll between Ours and Theirs (both directions).
  const ours = $('#crv-ours');
  const theirs = $('#crv-theirs');
  let syncing = false;
  const link = (a, b) => a.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    b.scrollTop = a.scrollTop;
    requestAnimationFrame(() => { syncing = false; });
  });
  link(ours, theirs);
  link(theirs, ours);

  $('#crv-prev').onclick = () => _crvJump(-1);
  $('#crv-next').onclick = () => _crvJump(+1);
  $('#crv-all-ours').onclick = () => { fs.choices.forEach(c => { c.mode = 'ours'; }); _crvRefreshOutputOnly(); };
  $('#crv-all-theirs').onclick = () => { fs.choices.forEach(c => { c.mode = 'theirs'; }); _crvRefreshOutputOnly(); };
  $('#crv-all-both').onclick = () => { fs.choices.forEach(c => { c.mode = 'both'; c.order = c.order || 'OT'; }); _crvRefreshOutputOnly(); };
  $('#crv-mark-resolved').onclick = () => _crvSaveActiveFile();
}

function _crvActive() {
  const cv = state.conflictsView;
  if (!cv || !cv.activeFile) return null;
  return cv.files[cv.activeFile] || null;
}

function _crvBgFor(side, mode) {
  if (side === 'ours') return 'bg-ours';
  if (side === 'theirs') return 'bg-theirs';
  // output
  if (mode === 'ours') return 'bg-ours';
  if (mode === 'theirs') return 'bg-theirs';
  if (mode === 'both') return 'bg-both';
  if (mode === 'custom') return 'bg-custom';
  if (mode === 'none') return 'bg-none';
  return 'bg-pending';
}

// Render the Ours / Theirs side panes. They're read-only — interaction lives
// in the output pane. Conflict regions get a colored background and a header
// row that says "◢ conflict N".
function _crvRenderSides() {
  const fs = _crvActive();
  if (!fs) return;
  const oursView = buildSideView(fs.parsed, 'ours');
  const theirsView = buildSideView(fs.parsed, 'theirs');
  // Per-block intraline word-diff: for the (rare-ish) common case where ours
  // and theirs differ by a few tokens on the same line, highlight those.
  const wordDiffsByBlock = new Map();
  fs.parsed.blocks.forEach((b, bi) => {
    // Only attempt when both sides have the same line count and at least one
    // line — otherwise diff renders as noise.
    if (b.ours.length === b.theirs.length && b.ours.length > 0 && b.ours.length <= 200) {
      const pairs = b.ours.map((line, i) => {
        if (line === b.theirs[i]) return null;
        try { return intralineDiff(line, b.theirs[i]); }
        catch { return null; }
      });
      wordDiffsByBlock.set(bi, pairs);
    }
  });
  $('#crv-ours').innerHTML = _crvRenderSidePaneHtml(oursView, 'ours', wordDiffsByBlock, fs);
  $('#crv-theirs').innerHTML = _crvRenderSidePaneHtml(theirsView, 'theirs', wordDiffsByBlock, fs);
}

function _crvRenderSidePaneHtml(view, side, wordDiffsByBlock, fs) {
  const idxToRange = new Map();
  view.ranges.forEach(r => {
    if (!r.empty) for (let i = r.startIdx; i <= r.endIdx; i++) idxToRange.set(i, r);
  });
  const blocksSeen = new Set();
  let html = '';
  view.lines.forEach((line, idx) => {
    const range = idxToRange.get(idx);
    if (range && !blocksSeen.has(range.blockIdx)) {
      blocksSeen.add(range.blockIdx);
      const bg = _crvBgFor(side);
      html += `<div class="cr-line crv-conflict-marker conflict-region ${bg}" data-conflict="${range.blockIdx}">
        <span class="cr-lineno"></span>
        <span class="cr-content">◢ conflict ${range.blockIdx + 1}</span>
      </div>`;
    }
    const bg = range && !range.empty ? _crvBgFor(side) : '';
    const conflictAttr = range ? `data-conflict="${range.blockIdx}"` : '';
    const classes = `cr-line${range && !range.empty ? ` conflict-region ${bg}` : ''}`;
    // Intraline word diff (only when paired line-by-line)
    let content = escapeHtml(line);
    if (range && !range.empty) {
      const pairs = wordDiffsByBlock.get(range.blockIdx);
      if (pairs) {
        const localIdx = idx - range.startIdx;
        const pair = pairs[localIdx];
        if (pair) {
          content = side === 'ours'
            ? intralineRender(pair[0], 'rem')
            : intralineRender(pair[1], 'add');
        }
      }
    }
    html += `<div class="${classes}" ${conflictAttr}>
      <span class="cr-lineno">${idx + 1}</span>
      <span class="cr-content">${content || '&nbsp;'}</span>
    </div>`;
  });
  return html;
}

// Render the Output pane as a sequence of segments: read-only context
// segments and conflict-card segments. Each conflict card has its own action
// bar (Ours/Theirs/Both/None/Edit) and its own content area.
function _crvRenderOutput() {
  const fs = _crvActive();
  if (!fs) return;
  const { lines, blocks } = fs.parsed;
  const host = $('#crv-output');
  host.innerHTML = '';

  let cursor = 0;
  const byStart = new Map(blocks.map((b, idx) => [b.startMarkerLine, idx]));

  const emitContext = (from, toExclusive) => {
    if (from >= toExclusive) return;
    const frag = document.createElement('div');
    frag.className = 'crv-out-context';
    let h = '';
    for (let i = from; i < toExclusive; i++) {
      h += `<div class="cr-line"><span class="cr-lineno">${i + 1}</span><span class="cr-content">${escapeHtml(lines[i]) || '&nbsp;'}</span></div>`;
    }
    frag.innerHTML = h;
    host.appendChild(frag);
  };

  for (let i = 0; i < lines.length; ) {
    if (byStart.has(i)) {
      const bi = byStart.get(i);
      emitContext(cursor, i);
      const block = blocks[bi];
      host.appendChild(_crvBuildConflictCard(bi, block, fs));
      i = block.endMarkerLine + 1;
      cursor = i;
    } else {
      i++;
    }
  }
  emitContext(cursor, lines.length);
}

function _crvBuildConflictCard(bi, block, fs) {
  const choice = fs.choices[bi];
  const card = document.createElement('div');
  const bgCls = _crvBgFor('output', choice.mode);
  card.className = `crv-conflict-card ${bgCls}` + (choice.mode == null ? ' is-pending' : '');
  card.dataset.conflict = bi;

  const swapBtn = choice.mode === 'both'
    ? `<button class="crv-act-btn crv-act-swap" data-act="swap" title="Swap order (currently ${choice.order === 'TO' ? 'theirs → ours' : 'ours → theirs'})">${choice.order === 'TO' ? '⇄ T→O' : '⇄ O→T'}</button>`
    : '';

  card.innerHTML = `
    <div class="crv-card-header">
      <span class="crv-card-tag">⚔ conflict ${bi + 1}</span>
      <span class="crv-card-status">${_crvCardStatusText(choice)}</span>
      <span class="crv-spacer"></span>
      <button class="crv-act-btn ${choice.mode === 'ours' ? 'sel' : ''}" data-act="ours"   title="Take ours (1)">Ours</button>
      <button class="crv-act-btn ${choice.mode === 'theirs' ? 'sel' : ''}" data-act="theirs" title="Take theirs (2)">Theirs</button>
      <button class="crv-act-btn ${choice.mode === 'both' ? 'sel' : ''}" data-act="both"   title="Take both (3)">Both</button>
      ${swapBtn}
      <button class="crv-act-btn ${choice.mode === 'none' ? 'sel' : ''}" data-act="none"   title="Drop the section (4)">None</button>
      <button class="crv-act-btn ${choice.mode === 'custom' ? 'sel' : ''}" data-act="custom" title="Edit the resolution by hand">${choice.mode === 'custom' ? '✎ Editing' : '✎ Edit'}</button>
    </div>
    <div class="crv-card-body"></div>
  `;

  // Body
  const body = card.querySelector('.crv-card-body');
  if (choice.mode === 'custom') {
    const ta = document.createElement('textarea');
    ta.className = 'crv-card-edit';
    ta.spellcheck = false;
    ta.value = choice.custom || _resolvedLinesForChoice(block, { ...choice, mode: 'both', order: choice.order || 'OT' }).join('\n');
    // Save initial value so first keypress doesn't drop "ours" content.
    if (!choice.custom) choice.custom = ta.value;
    ta.addEventListener('input', () => {
      choice.custom = ta.value;
      // Autoresize.
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight + 4) + 'px';
    });
    // Initial autoresize after attach.
    requestAnimationFrame(() => {
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight + 4) + 'px';
    });
    body.appendChild(ta);
  } else {
    const resolvedLines = _resolvedLinesForChoice(block, choice);
    if (resolvedLines.length === 0) {
      body.innerHTML = `<div class="crv-empty-block">(empty — this section will be removed from the output)</div>`;
    } else {
      // Distinguish "ours" vs "theirs" portions when both are selected so the
      // user can see what's coming from where.
      let h = '';
      if (choice.mode === 'both') {
        const first = choice.order === 'TO' ? block.theirs : block.ours;
        const second = choice.order === 'TO' ? block.ours : block.theirs;
        const firstTag = choice.order === 'TO' ? 'theirs' : 'ours';
        const secondTag = choice.order === 'TO' ? 'ours' : 'theirs';
        first.forEach((ln, i) => {
          h += `<div class="cr-line crv-out-line bg-${firstTag}"><span class="cr-lineno">${i + 1}</span><span class="cr-content">${escapeHtml(ln) || '&nbsp;'}</span></div>`;
        });
        second.forEach((ln, i) => {
          h += `<div class="cr-line crv-out-line bg-${secondTag}"><span class="cr-lineno">${first.length + i + 1}</span><span class="cr-content">${escapeHtml(ln) || '&nbsp;'}</span></div>`;
        });
      } else {
        resolvedLines.forEach((ln, i) => {
          h += `<div class="cr-line crv-out-line"><span class="cr-lineno">${i + 1}</span><span class="cr-content">${escapeHtml(ln) || '&nbsp;'}</span></div>`;
        });
      }
      body.innerHTML = h;
    }
  }

  // Wire the action buttons.
  card.querySelectorAll('.crv-act-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'swap') {
        choice.order = choice.order === 'TO' ? 'OT' : 'TO';
      } else {
        choice.mode = act;
        if (act === 'both' && !choice.order) choice.order = 'OT';
        if (act === 'custom' && !choice.custom) {
          choice.custom = _resolvedLinesForChoice(block, { ...choice, mode: 'both', order: choice.order || 'OT' }).join('\n');
        }
      }
      // Re-render just the card and the minimap; sidebar progress; status.
      const fresh = _crvBuildConflictCard(bi, block, fs);
      card.replaceWith(fresh);
      _crvRenderMinimap();
      _crvRenderFileList();
      _crvUpdateStatus();
      _crvRenderToolbar();
      fs.activeIdx = bi;
      _crvHighlightActive();
    };
  });

  // Click to activate.
  card.addEventListener('click', () => {
    fs.activeIdx = bi;
    _crvHighlightActive();
  });

  return card;
}

function _crvCardStatusText(choice) {
  switch (choice.mode) {
    case 'ours':   return 'using ours';
    case 'theirs': return 'using theirs';
    case 'both':   return choice.order === 'TO' ? 'using both (theirs → ours)' : 'using both (ours → theirs)';
    case 'none':   return 'section removed';
    case 'custom': return 'custom resolution';
    default:       return 'unresolved';
  }
}

function _crvRefreshOutputOnly() {
  _crvRenderOutput();
  _crvRenderMinimap();
  _crvRenderFileList();
  _crvUpdateStatus();
  _crvRenderToolbar();
  _crvHighlightActive();
}

function _crvRenderMinimap() {
  const fs = _crvActive();
  const mm = $('#crv-minimap');
  if (!fs || !mm) return;
  const n = fs.parsed.blocks.length;
  if (!n) { mm.innerHTML = ''; return; }
  // Even vertical distribution.
  mm.innerHTML = fs.choices.map((c, i) => {
    const top = `${(i / Math.max(1, n - 1)) * 100}%`;
    const cls = `crv-tick mode-${c.mode || 'none'}` + (fs.activeIdx === i ? ' active' : '');
    return `<button class="${cls}" style="top:${top}" data-conflict="${i}" title="Conflict ${i + 1} — ${_crvCardStatusText(c)}"></button>`;
  }).join('');
  $$('.crv-tick', mm).forEach(t => {
    t.onclick = () => _crvJumpTo(parseInt(t.dataset.conflict, 10));
  });
}

function _crvUpdateStatus() {
  const fs = _crvActive();
  if (!fs) return;
  const total = fs.parsed.blocks.length;
  const unresolved = fs.choices.filter(c => !_choiceTouched(c)).length;
  const noneCount = fs.choices.filter(c => c.mode === 'none').length;
  const el = $('#crv-status');
  if (!el) return;
  if (total === 0) { el.textContent = '— no markers —'; el.className = 'crv-status'; return; }
  if (unresolved > 0) { el.textContent = `${unresolved} of ${total} unresolved`; el.className = 'crv-status warn'; return; }
  if (noneCount > 0) { el.textContent = `${total} chosen · ${noneCount} dropped`; el.className = 'crv-status ok-warn'; return; }
  el.textContent = `✓ all ${total} chosen`;
  el.className = 'crv-status ok';
}

function _crvHighlightActive() {
  const fs = _crvActive();
  if (!fs) return;
  const idx = fs.activeIdx;
  $$('.crv-conflict-card').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.conflict, 10) === idx);
  });
  $$('#crv-ours .conflict-region, #crv-theirs .conflict-region').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.conflict, 10) === idx);
  });
  $$('.crv-tick', $('#crv-minimap')).forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.conflict, 10) === idx);
  });
  const navText = $('#crv-nav-text');
  if (navText) navText.textContent = `conflict ${idx + 1} of ${fs.parsed.blocks.length}`;
}

function _crvJump(delta) {
  const fs = _crvActive();
  if (!fs) return;
  const next = Math.max(0, Math.min(fs.parsed.blocks.length - 1, fs.activeIdx + delta));
  _crvJumpTo(next);
}
function _crvJumpTo(idx) {
  const fs = _crvActive();
  if (!fs) return;
  fs.activeIdx = idx;
  _crvHighlightActive();
  // Scroll into view in all three panes.
  const card = document.querySelector(`.crv-conflict-card[data-conflict="${idx}"]`);
  if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Match Ours/Theirs to the conflict marker rows.
  const oursMarker = document.querySelector(`#crv-ours .crv-conflict-marker[data-conflict="${idx}"]`);
  const theirsMarker = document.querySelector(`#crv-theirs .crv-conflict-marker[data-conflict="${idx}"]`);
  if (oursMarker) oursMarker.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (theirsMarker) theirsMarker.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── Active conflict actions (used by both clicks and keyboard) ──
function _crvSetActiveMode(mode) {
  const fs = _crvActive();
  if (!fs) return;
  const choice = fs.choices[fs.activeIdx];
  if (!choice) return;
  choice.mode = mode;
  if (mode === 'both' && !choice.order) choice.order = 'OT';
  // Re-render just the affected card.
  const card = document.querySelector(`.crv-conflict-card[data-conflict="${fs.activeIdx}"]`);
  if (card) {
    const fresh = _crvBuildConflictCard(fs.activeIdx, fs.parsed.blocks[fs.activeIdx], fs);
    card.replaceWith(fresh);
  }
  _crvRenderMinimap();
  _crvRenderFileList();
  _crvUpdateStatus();
  _crvRenderToolbar();
  _crvHighlightActive();
}

// ── Save the active file and stage it ──
async function _crvSaveActiveFile() {
  const cv = state.conflictsView;
  if (!cv || !cv.activeFile) return;
  const fs = cv.files[cv.activeFile];
  if (!fs) return;
  const unresolved = fs.choices.filter(c => !_choiceTouched(c)).length;
  const dropped = fs.choices.filter(c => c.mode === 'none').length;
  const doSave = async () => {
    const lines = buildResolvedContent(fs.parsed, fs.choices);
    const eol = fs.parsed.usesCRLF ? '\r\n' : '\n';
    const content = lines.join(eol);
    // Sanity check — if the result still has conflict markers, refuse to stage
    // so we don't half-stage a half-resolved file.
    if (/^<{7}|^={7}|^>{7}/m.test(content)) {
      toast('Output still has conflict markers — fix custom regions before saving.', 'error');
      return;
    }
    showLoading('Saving…', cv.activeFile);
    const w = await window.api.writeFile({ path: cv.activeFile, content });
    if (!w.ok) { hideLoading(); toast(w.error, 'error'); return; }
    const a = await window.api.stage([cv.activeFile]);
    hideLoading();
    if (!a.ok) { toast(a.error, 'error'); return; }
    toast(`${cv.activeFile} resolved & staged`, 'ok');
    fs.saved = true;
    fs.resolved = true;
    await _crvAfterFileResolved(cv.activeFile);
  };
  if (unresolved > 0) {
    modal({
      title: 'UNRESOLVED CONFLICTS',
      body: `<p>${unresolved} conflict(s) have no choice yet. Save anyway?</p>`,
      okText: 'SAVE ANYWAY',
      onOk: doSave,
    });
    return;
  }
  if (dropped > 0) {
    modal({
      title: 'DROPPING SECTIONS',
      body: `<p>${dropped} conflict(s) are marked "None" — those sections will be <strong>removed</strong> from the file.</p><p>Save anyway?</p>`,
      okText: 'SAVE',
      onOk: doSave,
    });
    return;
  }
  await doSave();
}

async function _crvAfterFileResolved(file) {
  await refreshAll();
  const cv = state.conflictsView;
  if (!cv) return;
  // refreshAll may have closed the view if the last file resolved — guard.
  const remaining = state.status?.conflicted || [];
  if (remaining.length === 0) {
    _crvRenderToolbar();
    // Highlight the Continue button.
    const cont = $('#crv-continue');
    if (cont) {
      cont.disabled = false;
      cont.classList.add('primary', 'crv-pulse');
      setTimeout(() => cont.classList.remove('crv-pulse'), 1200);
    }
    toast('All files resolved — review and Continue when ready.', 'ok', 4500);
    return;
  }
  // Auto-advance to the next remaining file.
  const next = remaining.find(f => f !== file) || remaining[0];
  cv.activeFile = next;
  // Re-parse the next file if we don't have it yet.
  if (!cv.files[next]) {
    const r = await window.api.readFile(next);
    if (r.ok) _ensureFileState(next, parseConflictsByLine(r.data));
  }
  _crvRenderFileList();
  _crvRenderResolver();
  _crvRenderToolbar();
}

// ── Continue/Abort ──
async function _crvOnContinue() {
  const cv = state.conflictsView;
  if (!cv) return;
  const op = cv.opKind;
  if (!op) { toast('No operation in progress', 'warn'); return; }
  setStatus('Continuing…', 'busy');
  let r;
  if (op === 'merge') r = await window.api.mergeContinue();
  else if (op === 'rebase') r = await window.api.rebaseContinue();
  else if (op === 'cherryPick') r = await window.api.cherryPickContinue();
  else r = { ok: false, error: 'No op handler' };
  if (r.ok) {
    toast(`${_opTitle(op)} continued ♥`, 'ok');
    closeConflictResolver();
    await refreshAll();
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
}

async function _crvOnAbort() {
  const cv = state.conflictsView;
  if (!cv) return;
  const op = cv.opKind;
  modal({
    title: 'ABORT OPERATION?',
    body: `<p>Abort the current ${_opTitle(op)}? Your branch will return to its prior state and all in-progress resolutions will be lost.</p>`,
    okText: 'ABORT',
    onOk: async () => {
      setStatus('Aborting…', 'busy');
      let r;
      if (op === 'merge') r = await window.api.mergeAbort();
      else if (op === 'rebase') r = await window.api.rebaseAbort();
      else if (op === 'cherryPick') r = await window.api.cherryPickAbort();
      else r = { ok: false, error: 'No op handler' };
      if (r.ok) {
        toast(`${_opTitle(op)} aborted`, 'ok');
        closeConflictResolver();
        await refreshAll();
      } else {
        toast(r.error, 'error');
        setStatus('Idle', 'error');
        return false;
      }
    },
  });
}

// ── Keyboard shortcuts (only active when the resolver is up) ──
document.addEventListener('keydown', (e) => {
  if (!state.conflictsView || !state.conflictsView.open) return;
  // Only intercept when the editor tab is the active center tab and the resolver
  // is in the DOM. Avoids stealing keys from other parts of the app.
  if (state.activeCenterTab !== 'editor') return;
  if (!document.querySelector('#editor-body .conflict-resolver')) return;
  // Don't grab keys while the user is typing into a textarea/input.
  const ae = document.activeElement;
  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if (inInput) {
    // Allow Ctrl+S even from inside the custom textarea.
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      _crvSaveActiveFile();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      _crvSaveActiveFile();
    }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); _crvJump(+1); return; }
  if (k === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); _crvJump(-1); return; }
  if (k === '1') { e.preventDefault(); _crvSetActiveMode('ours'); return; }
  if (k === '2') { e.preventDefault(); _crvSetActiveMode('theirs'); return; }
  if (k === '3') { e.preventDefault(); _crvSetActiveMode('both'); return; }
  if (k === '4') { e.preventDefault(); _crvSetActiveMode('none'); return; }
  if (k === 'e') { e.preventDefault(); _crvSetActiveMode('custom'); return; }
  if (k === 's' && !e.shiftKey) { e.preventDefault(); _crvSaveActiveFile(); return; }
});
