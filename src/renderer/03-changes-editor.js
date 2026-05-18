// ─────────────────────── Changes Tab ───────────────────────
function renderChanges() {
  if (!state.status) return;

  const unstaged = [];
  const staged = [];
  if (state.status.files) {
    state.status.files.forEach(f => {
      const idx = f.index || ' ';
      const wt = f.working_dir || ' ';
      if (idx !== ' ' && idx !== '?') staged.push({ path: f.path, code: idx });
      if (wt !== ' ' || (idx === '?' && wt === '?')) unstaged.push({ path: f.path, code: (idx === '?' ? '??' : wt) });
    });
  }

  const renderItem = (f, isStaged) => `
    <div class="change-item" data-path="${escapeHtml(f.path)}" data-staged="${isStaged}">
      ${statusIconHtml(f.code)}
      ${lfsBadgeHtml(f.path)}
      <span class="ci-path">${escapeHtml(f.path)}</span>
      <span class="ci-actions">
        ${isStaged
          ? `<button class="ci-act-btn" data-act="unstage">−</button>
             <button class="ci-act-btn" data-act="open" title="Open">↗</button>`
          : `<button class="ci-act-btn" data-act="stage">+</button>
             <button class="ci-act-btn" data-act="open" title="Open">↗</button>
             <button class="ci-act-btn" data-act="discard" title="Discard">✕</button>`
        }
      </span>
    </div>
  `;

  // don't dump 50k rows into the DOM, it freezes
  const MAX_ROWS = 2000;
  const listHtml = (arr, isStaged) => {
    const shown = arr.slice(0, MAX_ROWS).map(f => renderItem(f, isStaged)).join('');
    if (arr.length > MAX_ROWS) {
      return shown + `<div style="padding: 12px 16px; color: var(--text-mute); font-size: 12px;">Showing ${MAX_ROWS.toLocaleString()} of ${arr.length.toLocaleString()} files. Use the bulk actions or commit to handle them all.</div>`;
    }
    return shown;
  };

  $('#unstaged-list').innerHTML = unstaged.length
    ? listHtml(unstaged, false)
    : '<div style="padding: 16px; text-align: center; color: var(--text-mute); font-size: 12px;">Clean working tree ♥</div>';

  $('#staged-list').innerHTML = staged.length
    ? listHtml(staged, true)
    : '<div style="padding: 16px; text-align: center; color: var(--text-mute); font-size: 12px;">No staged changes</div>';

  // one listener per list instead of one per row (was slow with lots of files)
  bindChangesDelegation();

  $('#commit-btn').disabled = staged.length === 0 && !$('#amend-check').checked;
}

let _changesDelegationBound = false;
function bindChangesDelegation() {
  if (_changesDelegationBound) return;
  _changesDelegationBound = true;

  ['#unstaged-list', '#staged-list'].forEach(sel => {
    const list = $(sel);
    if (!list) return;
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.change-item');
      if (!item || !list.contains(item)) return;
      const path = item.dataset.path;
      const isStaged = item.dataset.staged === 'true';

      const btn = e.target.closest('.ci-act-btn');
      if (btn) {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'stage') stageFiles([path]);
        else if (act === 'unstage') unstageFiles([path]);
        else if (act === 'discard') discardFile(path);
        else if (act === 'open') openFileInEditor(path, true);
        return;
      }

      openFileInEditor(path, /*editable=*/ true);
      selectFileDiff(path, isStaged);
    });
  });
}

async function selectFileDiff(path, staged) {
  state.selectedFile = path;
  state.selectedFileStaged = staged;
  $$('.change-item').forEach(el => el.classList.toggle('selected',
    el.dataset.path === path && (el.dataset.staged === 'true') === staged));

  // put the diff in the details pane. no tab switch, main page already has the file
  const r = await window.api.diff({ file: path, staged });
  if (r.ok) {
    $('#inspector-body').innerHTML = `
      <div style="padding: 10px 14px; color: var(--text-3); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--line);">
        ${staged ? 'Staged' : 'Unstaged'} • ${escapeHtml(path)}
      </div>
      ${r.data
        ? renderDiff(r.data)
        : '<div style="color: var(--text-mute); padding: 12px;">No diff (binary or unchanged).</div>'}
    `;
  } else {
    $('#inspector-body').innerHTML = `<div style="color: var(--err); padding: 12px;">Error: ${escapeHtml(r.error)}</div>`;
  }
}

function renderDiff(text) {
  if (!text) return '<div style="color: var(--text-mute); padding: 12px;">Empty diff.</div>';
  const lines = text.split('\n');
  let html = '';
  let inFile = false;
  let lang = null;
  // Highlight a content line while preserving its leading +/-/space prefix.
  const hl = (line) => {
    const prefix = line.slice(0, 1);
    return escapeHtml(prefix) + (highlightCode(line.slice(1), lang) || '');
  };
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (inFile) html += '</div>';
      const parts = line.match(/b\/(.+)$/);
      const fname = parts ? parts[1] : line;
      lang = detectLang(fname);
      html += `<div class="diff-block"><div class="diff-file-header">▼ ${escapeHtml(fname)}</div>`;
      inFile = true;
      continue;
    }
    if (!inFile) {
      html += `<div class="diff-block">`;
      inFile = true;
    }
    if (line.startsWith('@@')) {
      html += `<div class="diff-line diff-line-hunk">${escapeHtml(line)}</div>`;
    } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) {
      html += `<div class="diff-line diff-line-meta">${escapeHtml(line)}</div>`;
    } else if (line.startsWith('+')) {
      html += `<div class="diff-line diff-line-add">${hl(line)}</div>`;
    } else if (line.startsWith('-')) {
      html += `<div class="diff-line diff-line-rem">${hl(line)}</div>`;
    } else {
      html += `<div class="diff-line">${hl(line)}</div>`;
    }
  }
  if (inFile) html += '</div>';
  return html;
}

// ─────────────────────── File Editor (main page) ───────────────────────
async function openFileInEditor(relPath, editable = true, atCommit = null) {
  setStatus('Loading file...', 'busy');
  const fileType = getFileType(relPath);

  // Hide all panes initially
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');
  $('#editor-media').classList.add('hidden');
  $('#editor-binary').classList.add('hidden');

  // Common tab setup
  $('#editor-tab').classList.remove('hidden');
  $('#editor-tab-label').textContent = relPath.split(/[\\/]/).pop() || relPath;
  $('#editor-tab').title = relPath;
  $('#editor-bar-path').textContent = atCommit ? `${relPath} @ ${atCommit.slice(0, 7)}` : relPath;
  $('#editor-bar-status').textContent = '';

  $('#editor-lfs-badge').classList.toggle('hidden', !isLfsPath(relPath));

  // ── Media path
  if (fileType !== 'text' && !atCommit) {
    const r = await window.api.readBinary(relPath);
    if (!r.ok) {
      toast(r.error, 'error');
      setStatus('Idle', 'error');
      return;
    }
    const dataUri = `data:${mimeFor(relPath)};base64,${r.data}`;
    state.editorFile = { path: relPath, fileType, atCommit, editable: false, dirty: false, mode: 'media' };
    renderMediaPane(fileType, dataUri, r.size);
    $('#editor-media').classList.remove('hidden');
    // Disable mode toggle, save, revert
    $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.toggle('hidden', true));
    $('#editor-save').disabled = true;
    $('#editor-revert').disabled = true;
    switchCenterTab('editor');
    setStatus('Ready');
    return;
  }

  // Re-show mode toggle (in case previously hidden by media)
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.remove('hidden'));
  $('#editor-revert').disabled = false;

  // ── Text path
  let content = '';
  if (atCommit) {
    // file as it was at that commit, fall back to working copy if that fails
    const r = await window.api.showText({ ref: atCommit, file: relPath });
    if (r.ok) content = r.data;
    else {
      const w = await window.api.readFile(relPath);
      if (w.ok) content = w.data;
    }
    editable = false;
  } else {
    const r = await window.api.readFile(relPath);
    if (!r.ok) {
      // Possibly a binary text file
      $('#editor-binary').innerHTML = `
        <div class="editor-binary-icon">▢</div>
        <div>Cannot open <strong>${escapeHtml(relPath)}</strong></div>
        <div style="font-size: 11px;">${escapeHtml(r.error)}</div>
      `;
      $('#editor-binary').classList.remove('hidden');
      state.editorFile = { path: relPath, fileType: 'binary', mode: 'binary', editable: false, dirty: false };
      switchCenterTab('editor');
      setStatus('Idle', 'error');
      return;
    }
    content = r.data;
  }

  state.editorFile = {
    path: relPath,
    content,
    original: content,
    dirty: false,
    editable,
    atCommit,
    fileType: 'text',
    mode: atCommit ? 'hunks' : 'edit',
  };

  // Set initial mode pane
  await applyEditorMode(state.editorFile.mode);
  switchCenterTab('editor');
  setStatus('Ready');
}

function renderMediaPane(fileType, dataUri, size) {
  const el = $('#editor-media');
  const sizeKb = size ? ` · ${(size / 1024).toFixed(1)} KB` : '';
  if (fileType === 'image') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <img src="${dataUri}" alt=""/>
      <div class="editor-media-info">${escapeHtml(fileType)}${sizeKb}</div>
    </div>`;
  } else if (fileType === 'video') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <video src="${dataUri}" controls preload="metadata"></video>
      <div class="editor-media-info">${escapeHtml(fileType)}${sizeKb}</div>
    </div>`;
  } else if (fileType === 'audio') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <audio src="${dataUri}" controls preload="metadata"></audio>
      <div class="editor-media-info">${escapeHtml(fileType)}${sizeKb}</div>
    </div>`;
  } else {
    el.innerHTML = `<div class="editor-binary"><div class="editor-binary-icon">▢</div><div>Binary file</div></div>`;
  }
}

async function applyEditorMode(mode) {
  if (!state.editorFile) return;
  state.editorFile.mode = mode;

  // Toggle mode button visual
  $$('.editor-mode-toggle .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  // Hide panes
  $('#editor-textarea').classList.add('hidden');
  $('#editor-diff-view').classList.add('hidden');

  if (mode === 'edit') {
    $('#editor-textarea').classList.remove('hidden');
    const ta = $('#editor-textarea');
    ta.value = state.editorFile.content;
    ta.readOnly = !!state.editorFile.atCommit;
    $('#editor-save').disabled = !state.editorFile.dirty || !!state.editorFile.atCommit;
    $('#editor-revert').disabled = !!state.editorFile.atCommit;
    $('#editor-bar-status').textContent = state.editorFile.dirty ? '• modified' : '';
    return;
  }

  // Diff modes: fetch diff if we don't have it cached, then render
  $('#editor-save').disabled = true;
  $('#editor-diff-view').classList.remove('hidden');
  $('#editor-diff-view').innerHTML = '<div style="padding: 16px; color: var(--text-3);">Loading diff…</div>';

  // Determine staged status of the file (if it's a tracked change)
  const staged = state.selectedFileStaged === true && state.selectedFile === state.editorFile.path;
  const r = await window.api.diff({ file: state.editorFile.path, staged });
  const diffText = r.ok ? (r.data || '') : '';

  if (mode === 'file') {
    renderWholeFileDiff(state.editorFile.content, diffText);
  } else if (mode === 'hunks') {
    renderHunksOnly(diffText);
  }
}

// Parse unified diff into hunks. Each hunk: { oldStart, oldCount, newStart, newCount, lines: [{kind, text}] }
function parseDiffHunks(diffText) {
  const hunks = [];
  if (!diffText) return hunks;
  const lines = diffText.split('\n');
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      current = {
        oldStart: parseInt(m[1], 10),
        oldCount: m[2] ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newCount: m[4] ? parseInt(m[4], 10) : 1,
        lines: [],
        header: line,
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) continue;
    if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) current.lines.push({ kind: 'rem', text: line.slice(1) });
    else current.lines.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return hunks;
}

// whole file, with added lines marked and removed lines shown where they were
function renderWholeFileDiff(newContent, diffText) {
  const lang = detectLang(state.editorFile?.path);
  const hunks = parseDiffHunks(diffText);
  const newLines = newContent.split('\n');
  // Build a map: newLineNumber → 'added' (1-indexed)
  const addedSet = new Set();
  // And a map: newLineNumber → [removed text rows that go before it]
  const removedBefore = new Map(); // key: newLineNumber (1-indexed), value: array of texts

  for (const h of hunks) {
    let nLine = h.newStart;
    let pendingRemoved = [];
    for (const ln of h.lines) {
      if (ln.kind === 'add') {
        // Attach any pending removed rows so they appear adjacent
        if (pendingRemoved.length) {
          const arr = removedBefore.get(nLine) || [];
          arr.push(...pendingRemoved);
          removedBefore.set(nLine, arr);
          pendingRemoved = [];
        }
        addedSet.add(nLine);
        nLine++;
      } else if (ln.kind === 'ctx') {
        if (pendingRemoved.length) {
          const arr = removedBefore.get(nLine) || [];
          arr.push(...pendingRemoved);
          removedBefore.set(nLine, arr);
          pendingRemoved = [];
        }
        nLine++;
      } else if (ln.kind === 'rem') {
        pendingRemoved.push(ln.text);
      }
    }
    // Trailing removes at end of hunk: anchor to current nLine (which is past last)
    if (pendingRemoved.length) {
      const arr = removedBefore.get(nLine) || [];
      arr.push(...pendingRemoved);
      removedBefore.set(nLine, arr);
    }
  }

  let html = '';
  for (let i = 0; i < newLines.length; i++) {
    const lineNo = i + 1;
    const rems = removedBefore.get(lineNo);
    if (rems) {
      for (const t of rems) {
        html += `<div class="diff-row removed"><span class="diff-row-lineno">−</span><span class="diff-row-content">${highlightCode(t, lang) || '&nbsp;'}</span></div>`;
      }
    }
    const cls = addedSet.has(lineNo) ? 'added' : '';
    html += `<div class="diff-row ${cls}"><span class="diff-row-lineno">${lineNo}</span><span class="diff-row-content">${highlightCode(newLines[i], lang) || '&nbsp;'}</span></div>`;
  }
  // Trailing removes at end of file
  const tail = removedBefore.get(newLines.length + 1);
  if (tail) {
    for (const t of tail) {
      html += `<div class="diff-row removed"><span class="diff-row-lineno">−</span><span class="diff-row-content">${highlightCode(t, lang) || '&nbsp;'}</span></div>`;
    }
  }
  $('#editor-diff-view').innerHTML = html || '<div style="padding:16px;color:var(--text-3);">No changes — file matches HEAD.</div>';
}

function renderHunksOnly(diffText) {
  const hunks = parseDiffHunks(diffText);
  if (!hunks.length) {
    $('#editor-diff-view').innerHTML = '<div style="padding:16px;color:var(--text-3);">No changes for this file.</div>';
    return;
  }
  let html = '';
  for (const h of hunks) {
    html += `<div class="diff-row hunk-header"><span class="diff-row-lineno">@@</span><span class="diff-row-content">${escapeHtml(h.header)}</span></div>`;
    let nLine = h.newStart;
    let oLine = h.oldStart;
    for (const ln of h.lines) {
      if (ln.kind === 'add') {
        html += `<div class="diff-row added"><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${escapeHtml(ln.text) || '&nbsp;'}</span></div>`;
        nLine++;
      } else if (ln.kind === 'rem') {
        html += `<div class="diff-row removed"><span class="diff-row-lineno">${oLine}</span><span class="diff-row-content">${escapeHtml(ln.text) || '&nbsp;'}</span></div>`;
        oLine++;
      } else {
        html += `<div class="diff-row"><span class="diff-row-lineno">${nLine}</span><span class="diff-row-content">${escapeHtml(ln.text) || '&nbsp;'}</span></div>`;
        nLine++; oLine++;
      }
    }
  }
  $('#editor-diff-view').innerHTML = html;
}

$('#editor-textarea').addEventListener('input', () => {
  if (!state.editorFile || state.editorFile.mode !== 'edit') return;
  state.editorFile.content = $('#editor-textarea').value;
  state.editorFile.dirty = state.editorFile.content !== state.editorFile.original;
  $('#editor-bar-status').textContent = state.editorFile.dirty ? '• modified' : '';
  $('#editor-save').disabled = !state.editorFile.dirty;
});

$$('.editor-mode-toggle .mode-btn').forEach(btn => {
  btn.onclick = () => {
    if (!state.editorFile || state.editorFile.fileType !== 'text') return;
    if (state.editorFile.dirty && btn.dataset.mode !== 'edit') {
      modal({
        title: 'Unsaved changes',
        body: `<p>You have unsaved changes. Switching to diff view will keep them in memory but show the on-disk diff.</p>`,
        okText: 'CONTINUE',
        onOk: () => applyEditorMode(btn.dataset.mode),
      });
      return;
    }
    applyEditorMode(btn.dataset.mode);
  };
});

$('#editor-save').onclick = async () => {
  if (!state.editorFile || !state.editorFile.dirty || state.editorFile.mode !== 'edit') return;
  setStatus('Saving...', 'busy');
  const r = await window.api.writeFile({ path: state.editorFile.path, content: state.editorFile.content });
  if (r.ok) {
    state.editorFile.original = state.editorFile.content;
    state.editorFile.dirty = false;
    $('#editor-bar-status').textContent = '';
    $('#editor-save').disabled = true;
    toast(`Saved ${state.editorFile.path}`, 'ok');
    await refreshStatus();
    renderChanges();
    renderCenterHeader();
    setStatus('Ready');
  } else {
    toast(r.error, 'error');
    setStatus('Idle', 'error');
  }
};

$('#editor-revert').onclick = async () => {
  if (!state.editorFile || state.editorFile.atCommit) return;
  const r = await window.api.readFile(state.editorFile.path);
  if (r.ok) {
    state.editorFile.content = r.data;
    state.editorFile.original = r.data;
    state.editorFile.dirty = false;
    if (state.editorFile.mode === 'edit') $('#editor-textarea').value = r.data;
    else applyEditorMode(state.editorFile.mode);
    $('#editor-bar-status').textContent = '';
    $('#editor-save').disabled = true;
    toast('Reverted from disk', 'ok');
  } else {
    toast(r.error, 'error');
  }
};

$('#editor-tab-close').onclick = (e) => {
  e.stopPropagation();
  if (state.editorFile?.dirty) {
    modal({
      title: 'Discard unsaved changes?',
      body: `<p>You have unsaved changes in <strong>${escapeHtml(state.editorFile.path)}</strong>. Close anyway?</p>`,
      okText: 'CLOSE',
      onOk: () => {
        state.editorFile = null;
        $('#editor-tab').classList.add('hidden');
        switchCenterTab('history');
      },
    });
  } else {
    state.editorFile = null;
    $('#editor-tab').classList.add('hidden');
    switchCenterTab('history');
  }
};

// ─────────────────────── Files tree (main page) ───────────────────────
async function renderFilesTree() {
  const cont = $('#files-tree');
  cont.innerHTML = '<div style="padding: 12px; color: var(--text-3);">Loading…</div>';
  const trackedOnly = !!$('#files-tracked-only')?.checked;
  const r = await window.api.repoTree({ trackedOnly });
  if (!r.ok) {
    cont.innerHTML = `<div style="padding: 12px; color: var(--err);">${escapeHtml(r.error)}</div>`;
    return;
  }
  cont.innerHTML = renderTreeNodes(r.data, 0);
  attachTreeHandlers(cont);
  if (typeof applyFilesSearch === 'function') applyFilesSearch();
}

function renderTreeNodes(nodes, depth) {
  if (!nodes || nodes.length === 0) return '<div style="padding: 8px 18px; color: var(--text-mute); font-style: italic;">— empty —</div>';
  return nodes.map(n => {
    const padding = 12 + depth * 14;
    if (n.type === 'dir') {
      return `
        <div class="tree-row dir" data-path="${escapeHtml(n.path)}" data-type="dir" style="padding-left: ${padding}px;">
          <span class="tree-arrow">▸</span>
          <span class="tree-icon">📁</span>
          <span class="tree-label">${escapeHtml(n.path.split('/').pop())}</span>
        </div>
        <div class="tree-children">${renderTreeNodes(n.children, depth + 1)}</div>
      `;
    }
    return `
      <div class="tree-row file" data-path="${escapeHtml(n.path)}" data-type="file" style="padding-left: ${padding}px;">
        <span class="tree-arrow"></span>
        <span class="tree-icon">📄</span>
        <span class="tree-label">${escapeHtml(n.path.split('/').pop())}</span>
      </div>
    `;
  }).join('');
}

function attachTreeHandlers(cont) {
  $$('.tree-row', cont).forEach(row => {
    row.onclick = () => {
      if (row.dataset.type === 'dir') {
        row.classList.toggle('expanded');
        const arrow = row.querySelector('.tree-arrow');
        if (arrow) arrow.textContent = row.classList.contains('expanded') ? '▾' : '▸';
      } else {
        openFileInEditor(row.dataset.path, true);
      }
    };
  });
}

$('#refresh-tree-btn').onclick = renderFilesTree;
