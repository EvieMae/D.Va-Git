// Repo stats panel (Ctrl+Shift+S)
// Reuses shared globals: modal, toast, $, $$, escapeHtml, state.

function formatRepoStatsBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' ' + units[i];
}

function renderRepoStatsBody(d) {
  const cell = 'padding:6px 10px;border-bottom:1px solid var(--line);';
  const head = 'padding:6px 10px;border-bottom:1px solid var(--line);color:var(--pink);text-align:left;font-weight:600;';
  const section = 'margin:10px 0;padding:10px;background:var(--bg-elev);border:1px solid var(--line);border-radius:6px;color:var(--text);';
  const h = 'margin:0 0 8px 0;color:var(--pink);font-size:13px;letter-spacing:0.5px;text-transform:uppercase;';

  const contribRows = (d.contributors || []).map(c => `
    <tr>
      <td style="${cell}">${escapeHtml(c.name || '')}</td>
      <td style="${cell};color:#aaa;">${escapeHtml(c.email || '')}</td>
      <td style="${cell};text-align:right;">${c.commits}</td>
    </tr>
  `).join('') || `<tr><td style="${cell}" colspan="3">No contributors found.</td></tr>`;

  const extRows = ((d.files && d.files.byExt) || []).map(e => `
    <tr>
      <td style="${cell}">.${escapeHtml(e.ext)}</td>
      <td style="${cell};text-align:right;">${e.count}</td>
    </tr>
  `).join('') || `<tr><td style="${cell}" colspan="2">No tracked files.</td></tr>`;

  return `
    <div style="${section}">
      <div style="${h}">Objects</div>
      <div>Object count: <b>${(d.objectCount || 0).toLocaleString()}</b></div>
      <div>Total size on disk: <b>${formatRepoStatsBytes(d.sizeBytes || 0)}</b></div>
    </div>
    <div style="${section}">
      <div style="${h}">Refs</div>
      <div>Local branches: <b>${(d.branches && d.branches.local) || 0}</b></div>
      <div>Remote branches: <b>${(d.branches && d.branches.remote) || 0}</b></div>
      <div>Tags: <b>${d.tags || 0}</b></div>
    </div>
    <div style="${section}">
      <div style="${h}">Top contributors (max 20)</div>
      <div style="max-height:260px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr>
            <th style="${head}">Name</th>
            <th style="${head}">Email</th>
            <th style="${head};text-align:right;">Commits</th>
          </tr></thead>
          <tbody>${contribRows}</tbody>
        </table>
      </div>
    </div>
    <div style="${section}">
      <div style="${h}">Tracked files</div>
      <div>Total tracked: <b>${(d.files && d.files.total) || 0}</b></div>
      <div style="margin-top:8px;max-height:260px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr>
            <th style="${head}">Extension</th>
            <th style="${head};text-align:right;">Files</th>
          </tr></thead>
          <tbody>${extRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function openRepoStatsModal() {
  if (!state || !state.repo) {
    if (typeof toast === 'function') toast('No repository opened');
    return;
  }
  modal({
    title: 'Repo stats',
    body: '<div style="color:var(--text);padding:8px;">Loading repo stats...</div>',
    okText: 'CLOSE',
    hideOk: false,
    cancelText: 'CLOSE',
  });
  // Hide the cancel button to give a single-action modal.
  try { $('#modal-cancel').style.display = 'none'; } catch (e) {}
  try {
    const res = await window.api.repoStatsRead();
    if (!res || !res.ok) {
      $('#modal-body').innerHTML = `<div style="color:var(--text);padding:8px;">Failed to read stats: ${escapeHtml((res && res.error) || 'unknown error')}</div>`;
      return;
    }
    $('#modal-body').innerHTML = renderRepoStatsBody(res.data || {});
  } catch (e) {
    $('#modal-body').innerHTML = `<div style="color:var(--text);padding:8px;">Error: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'S' || e.key === 's')) {
    e.preventDefault();
    openRepoStatsModal();
  }
});
