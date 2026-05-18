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
  $('#op-resolve')?.addEventListener('click', () => openConflictsModal());
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

// ─────────────────────── Conflict resolution UI ───────────────────────
const CONFLICT_RE = /^<{7} (.+?)\r?\n([\s\S]*?)^={7}\r?\n([\s\S]*?)^>{7} (.+?)\r?\n/gm;

function parseConflicts(text) {
  const blocks = [];
  let m;
  CONFLICT_RE.lastIndex = 0;
  while ((m = CONFLICT_RE.exec(text))) {
    blocks.push({
      start: m.index,
      end: CONFLICT_RE.lastIndex,
      oursLabel: m[1],
      ours: m[2],
      theirs: m[3],
      theirsLabel: m[4],
      resolved: null, // null = unresolved; otherwise the chosen text
    });
  }
  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Three-pane conflict resolver — GitKraken-style. Lives in the editor area
//  rather than a modal so it has room for OURS / THEIRS / OUTPUT side-by-side.
// ═══════════════════════════════════════════════════════════════════════════

function parseConflictsByLine(content) {
  // CRLF-safe: split on \r?\n and remember the line-ending so we can write
  // back with the same style. Without this, "=======\r" never matches the
  // marker regex on Windows and the entire block falls into OURS.
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
      if (i < lines.length) i++; // skip the ======= line
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

// Build the "if we picked side X for every conflict" view of the file.
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

function buildOutputView(parsed, choices) {
  const { lines, blocks } = parsed;
  const out = [];
  const ranges = [];
  let i = 0;
  const byStart = new Map(blocks.map((b, idx) => [b.startMarkerLine, idx]));
  while (i < lines.length) {
    if (byStart.has(i)) {
      const bi = byStart.get(i);
      const block = blocks[bi];
      const choice = choices[bi];
      const startIdx = out.length;
      const tags = [];
      if (choice.includeOurs) { out.push(...block.ours); tags.push('ours'); }
      if (choice.includeTheirs) { out.push(...block.theirs); tags.push('theirs'); }
      const endIdx = out.length - 1;
      ranges.push({ startIdx, endIdx, blockIdx: bi, tags, empty: tags.length === 0 });
      i = block.endMarkerLine + 1;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return { lines: out, ranges };
}

function _bgClassForSide(side, tags) {
  if (side === 'ours') return 'bg-ours';
  if (side === 'theirs') return 'bg-theirs';
  if (side === 'output') {
    if (!tags || tags.length === 0) return 'bg-none';
    if (tags.includes('ours') && tags.includes('theirs')) return 'bg-both';
    return tags.includes('ours') ? 'bg-ours' : 'bg-theirs';
  }
  return '';
}

function renderPaneHtml(view, side, choices) {
  // Build a quick index: line idx → range
  const idxToRange = new Map();
  view.ranges.forEach(r => {
    if (r.empty) {
      idxToRange.set(`empty-${r.blockIdx}`, r);
    } else {
      for (let i = r.startIdx; i <= r.endIdx; i++) idxToRange.set(i, r);
    }
  });

  const renderedBlocks = new Set();
  let html = '';
  view.lines.forEach((line, idx) => {
    const range = idxToRange.get(idx);
    if (range && !renderedBlocks.has(range.blockIdx)) {
      renderedBlocks.add(range.blockIdx);
      const checkboxHtml = (side === 'ours' || side === 'theirs')
        ? (() => {
            const key = side === 'ours' ? 'includeOurs' : 'includeTheirs';
            const checked = choices[range.blockIdx][key] ? 'checked' : '';
            return `<input type="checkbox" class="cr-toggle" data-block="${range.blockIdx}" data-side="${side}" ${checked} />`;
          })()
        : '';
      // Marker row at the start of each block — holds the checkbox
      const bg = _bgClassForSide(side, range.tags);
      const blockTag = `<div class="cr-line conflict-region ${bg}" data-conflict="${range.blockIdx}" data-marker="1"><span class="cr-checkbox">${checkboxHtml}</span><span class="cr-lineno"></span><span class="cr-content" style="color: var(--text-mute); font-style: italic;">&nbsp;◢ conflict ${range.blockIdx + 1}${range.empty ? ' (empty)' : ''}</span></div>`;
      html += blockTag;
    }
    const bg = range && !range.empty ? _bgClassForSide(side, range.tags) : '';
    const conflictAttr = range ? `data-conflict="${range.blockIdx}"` : '';
    const classes = `cr-line${range && !range.empty ? ` conflict-region ${bg}` : ''}`;
    html += `<div class="${classes}" ${conflictAttr}><span class="cr-checkbox"></span><span class="cr-lineno">${idx + 1}</span><span class="cr-content">${escapeHtml(line) || '&nbsp;'}</span></div>`;
  });
  return html;
}

function _conflictPaneRefresh(idsOnly) {
  const cr = state.conflictResolver;
  if (!cr) return;
  const oursView = buildSideView(cr.parsed, 'ours');
  const theirsView = buildSideView(cr.parsed, 'theirs');
  const outputView = buildOutputView(cr.parsed, cr.choices);
  if (!idsOnly || idsOnly.includes('ours'))
    $('#cr-ours').innerHTML = renderPaneHtml(oursView, 'ours', cr.choices);
  if (!idsOnly || idsOnly.includes('theirs'))
    $('#cr-theirs').innerHTML = renderPaneHtml(theirsView, 'theirs', cr.choices);
  if (!idsOnly || idsOnly.includes('output'))
    $('#cr-output').innerHTML = renderPaneHtml(outputView, 'output', cr.choices);

  // Wire checkboxes (after any pane that has them was rebuilt)
  if (!idsOnly || idsOnly.includes('ours') || idsOnly.includes('theirs')) {
    $$('.cr-toggle').forEach(cb => {
      cb.onchange = () => {
        const b = parseInt(cb.dataset.block, 10);
        const k = cb.dataset.side === 'ours' ? 'includeOurs' : 'includeTheirs';
        cr.choices[b][k] = cb.checked;
        _conflictPaneRefresh(['output']);
        _crUpdateStatus();
      };
    });
  }
  highlightActiveConflict();
}

function highlightActiveConflict() {
  const cr = state.conflictResolver;
  if (!cr) return;
  const idx = cr.activeIdx;
  $$('.cr-line.conflict-region').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.conflict, 10) === idx);
  });
}

function jumpConflict(delta) {
  const cr = state.conflictResolver;
  if (!cr) return;
  cr.activeIdx = Math.max(0, Math.min(cr.parsed.blocks.length - 1, cr.activeIdx + delta));
  $('#cr-nav-text').textContent = `conflict ${cr.activeIdx + 1} of ${cr.parsed.blocks.length}`;
  highlightActiveConflict();
  ['cr-ours', 'cr-theirs', 'cr-output'].forEach(id => {
    const el = document.querySelector(`#${id} .cr-line.conflict-region.active`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function _crUpdateStatus() {
  const cr = state.conflictResolver;
  if (!cr) return;
  const unresolved = cr.choices.filter(c => !c.includeOurs && !c.includeTheirs).length;
  const el = $('#cr-status');
  if (!el) return;
  if (unresolved === 0) { el.textContent = `✓ all ${cr.choices.length} conflicts resolved`; el.className = 'cr-status ok'; }
  else { el.textContent = `${unresolved} of ${cr.choices.length} still unresolved`; el.className = 'cr-status warn'; }
}

async function openConflictResolverInEditor(filePath) {
  const r = await window.api.readFile(filePath);
  if (!r.ok) { toast(r.error, 'error'); return; }
  const parsed = parseConflictsByLine(r.data);
  if (!parsed.blocks.length) {
    toast('No conflict markers in this file', 'warn');
    return;
  }

  state.conflictResolver = {
    path: filePath,
    parsed,
    choices: parsed.blocks.map(() => ({ includeOurs: true, includeTheirs: false })),
    activeIdx: 0,
  };

  state.editorFile = {
    path: filePath,
    fileType: 'text',
    mode: 'conflict',
    editable: false,
    dirty: false,
  };

  $('#editor-tab').classList.remove('hidden');
  $('#editor-tab-label').textContent = '⚠ ' + (filePath.split(/[\\/]/).pop() || filePath);
  $('#editor-tab').title = filePath + ' (conflict)';
  $('#editor-bar-path').textContent = filePath + ' — resolve conflict';
  $('#editor-bar-status').textContent = '';
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.add('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = true;
  switchCenterTab('editor');

  // Tear down any prior editor panes; preserve textarea.
  detachEditorTextarea();
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  $('#editor-media').classList.add('hidden');
  $('#editor-binary').classList.add('hidden');
  $$('#editor-body .hunk-panel, #editor-body .conflict-wrap, #editor-body .editor-edit-wrap, #editor-body .image-diff, #editor-body .conflict-resolver').forEach(n => n.remove());

  const root = document.createElement('div');
  root.className = 'conflict-resolver';
  const headRef = state.status?.current || 'HEAD';
  root.innerHTML = `
    <div class="cr-toolbar">
      <strong>${escapeHtml(filePath.split(/[\\/]/).pop() || filePath)}</strong>
      <span class="cr-nav">
        <button id="cr-prev" title="Previous conflict">▲</button>
        <span id="cr-nav-text">conflict 1 of ${parsed.blocks.length}</span>
        <button id="cr-next" title="Next conflict">▼</button>
      </span>
      <span class="cr-status" id="cr-status"></span>
      <span class="cr-spacer"></span>
      <button class="csh-action" id="cr-all-ours">Use all ours</button>
      <button class="csh-action" id="cr-all-theirs">Use all theirs</button>
      <button class="csh-action" id="cr-all-both">Use both for all</button>
      <button class="csh-action" id="cr-mark-resolved" style="background: var(--pink); color: #fff; border-color: var(--pink);">Save & Mark Resolved</button>
    </div>
    <div class="cr-top">
      <div class="cr-pane">
        <div class="cr-pane-header"><span class="cr-badge a">A</span> Ours <span class="cr-pane-sub">on <strong>${escapeHtml(headRef)}</strong></span></div>
        <div class="cr-pane-body" id="cr-ours"></div>
      </div>
      <div class="cr-pane">
        <div class="cr-pane-header"><span class="cr-badge b">B</span> Theirs <span class="cr-pane-sub">${escapeHtml(parsed.blocks[0]?.theirsLabel || 'incoming')}</span></div>
        <div class="cr-pane-body" id="cr-theirs"></div>
      </div>
    </div>
    <div class="cr-bottom">
      <div class="cr-pane">
        <div class="cr-pane-header">Output <span class="cr-pane-sub">(what gets written)</span></div>
        <div class="cr-pane-body" id="cr-output"></div>
      </div>
    </div>
  `;
  $('#editor-body').appendChild(root);
  _conflictPaneRefresh();
  _crUpdateStatus();

  $('#cr-prev').onclick = () => jumpConflict(-1);
  $('#cr-next').onclick = () => jumpConflict(+1);
  $('#cr-all-ours').onclick = () => {
    state.conflictResolver.choices.forEach(c => { c.includeOurs = true; c.includeTheirs = false; });
    _conflictPaneRefresh();
    _crUpdateStatus();
  };
  $('#cr-all-theirs').onclick = () => {
    state.conflictResolver.choices.forEach(c => { c.includeOurs = false; c.includeTheirs = true; });
    _conflictPaneRefresh();
    _crUpdateStatus();
  };
  $('#cr-all-both').onclick = () => {
    state.conflictResolver.choices.forEach(c => { c.includeOurs = true; c.includeTheirs = true; });
    _conflictPaneRefresh();
    _crUpdateStatus();
  };
  $('#cr-mark-resolved').onclick = () => saveConflictResolution();
}

// Tear down the three-pane resolver entirely. Safe to call multiple times.
function closeConflictResolver() {
  state.conflictResolver = null;
  // Clear the editor file state only if it was the conflict mode — don't blast
  // away an unrelated file that happens to be open.
  if (state.editorFile?.mode === 'conflict') state.editorFile = null;
  $$('#editor-body .conflict-resolver').forEach(n => n.remove());
  $('#editor-tab')?.classList.add('hidden');
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.remove('hidden'));
  $('#editor-save').disabled = true;
  $('#editor-revert').disabled = false;
  if (state.activeCenterTab === 'editor') switchCenterTab('history');
}

async function saveConflictResolution() {
  const cr = state.conflictResolver;
  if (!cr) return;
  const unresolved = cr.choices.filter(c => !c.includeOurs && !c.includeTheirs).length;
  const doSave = async () => {
    const outputView = buildOutputView(cr.parsed, cr.choices);
    const eol = cr.parsed.usesCRLF ? '\r\n' : '\n';
    const content = outputView.lines.join(eol);
    showLoading('Saving…', cr.path);
    const w = await window.api.writeFile({ path: cr.path, content });
    if (!w.ok) { hideLoading(); toast(w.error, 'error'); return; }
    const a = await window.api.stage([cr.path]);
    hideLoading();
    if (!a.ok) { toast(a.error, 'error'); return; }
    toast(`${cr.path} resolved & staged`, 'ok');
    closeConflictResolver();
    await refreshAll();
    // If more conflicted files remain, show the picker again.
    if ((state.status?.conflicted?.length || 0) > 0) {
      setTimeout(() => openConflictsModal(), 250);
    }
  };
  if (unresolved > 0) {
    modal({
      title: 'UNRESOLVED CONFLICTS',
      body: `<p>${unresolved} conflict(s) have neither side selected. Those sections will be <strong>missing</strong> from the output.</p><p>Save anyway?</p>`,
      okText: 'SAVE ANYWAY',
      onOk: doSave,
    });
    return;
  }
  await doSave();
}

async function openConflictsModal() {
  const files = state.status?.conflicted || [];
  if (!files.length) { toast('No conflicted files', 'warn'); return; }
  // If there's only one, skip the picker and go straight to the resolver.
  if (files.length === 1) {
    return openConflictResolverInEditor(files[0]);
  }
  // Count conflicts per file (cheap parse) so the user sees what's pending.
  const counts = await Promise.all(files.map(async (f) => {
    const r = await window.api.readFile(f);
    if (!r.ok) return { file: f, count: '?' };
    return { file: f, count: parseConflictsByLine(r.data).blocks.length };
  }));
  modal({
    title: 'RESOLVE CONFLICTS',
    body: `
      <p style="color: var(--text-3); margin-bottom: 10px;">${files.length} file(s) need conflict resolution. Pick one to open in the editor:</p>
      <div id="conflict-file-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
      <p style="margin-top: 12px; font-size: 11px; color: var(--text-3);">Each file opens in the three-pane resolver (ours / theirs / output).</p>
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });
  $('#conflict-file-list').innerHTML = counts.map(({ file, count }) => `
    <button class="csh-action" data-file="${escapeHtml(file)}" style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; text-align: left;">
      <span style="flex: 1; color: var(--text); font-family: 'Consolas', monospace; font-size: 12px;">${escapeHtml(file)}</span>
      <span style="color: var(--warn); font-size: 11px;">${count} conflict${count === 1 ? '' : 's'}</span>
      <span style="color: var(--pink);">→</span>
    </button>
  `).join('');
  $$('#conflict-file-list button').forEach(b => {
    b.onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      openConflictResolverInEditor(b.dataset.file);
    };
  });
}
