// ═══════════════════════════════════════════════════════════════════════════
//  Custom theme editor - lets users override CSS variables and persist them
//  as state.settings.customTheme. Triggered by Ctrl+Shift+Y.
//  Shares global scope: reuses modal, toast, $, $$, escapeHtml, state,
//  applyTheme, THEMES, saveSettings.
// ═══════════════════════════════════════════════════════════════════════════

// Hardcoded list of brand/surface/text/status/lane CSS variables to expose.
const THEME_EDITOR_VARS = [
  '--bg', '--bg-2', '--bg-3', '--bg-elev',
  '--text', '--text-2', '--text-3',
  '--pink', '--pink-soft', '--pink-deep',
  '--cyan', '--cyan-deep',
  '--ok', '--warn', '--err',
  '--lane-1', '--lane-2', '--lane-3', '--lane-4',
  '--lane-5', '--lane-6', '--lane-7', '--lane-8',
];

// Register the 'custom' theme option (idempotent).
if (Array.isArray(THEMES) && !THEMES.some(t => t.id === 'custom')) {
  THEMES.push({ id: 'custom', name: 'Custom' });
}

// Monkey-patch applyTheme so that after the normal theme is applied,
// any saved custom-theme overrides are layered on top.
const _origApplyTheme = applyTheme;
applyTheme = function () {
  _origApplyTheme();
  if (state.settings.theme === 'custom' && state.settings.customTheme) {
    for (const [k, v] of Object.entries(state.settings.customTheme)) {
      document.body.style.setProperty(k, v);
    }
  }
};

// Pick up a usable hex from a computed CSS value, else fall back to #000000.
function _themeEditorReadHex(name) {
  const raw = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return { hex: raw.toLowerCase(), raw };
  return { hex: '#000000', raw };
}

function openCustomThemeEditor() {
  const rowsHtml = THEME_EDITOR_VARS.map((name, i) => {
    const { hex, raw } = _themeEditorReadHex(name);
    return `
      <div class="theme-editor-row">
        <label title="${escapeHtml(name)}">${escapeHtml(name)}</label>
        <input type="color" data-var="${escapeHtml(name)}" data-idx="${i}" value="${hex}" />
        <input type="text" data-vartext="${escapeHtml(name)}" value="${escapeHtml(raw || hex)}" spellcheck="false" />
      </div>
    `;
  }).join('');

  modal({
    title: 'CUSTOM THEME',
    body: `
      <div class="theme-editor-hint">Pick colors for core CSS variables. "Apply (preview)" updates the UI live; "Save" persists and switches the active theme to Custom.</div>
      <div class="theme-editor-grid" id="theme-editor-grid">${rowsHtml}</div>
      <div class="theme-editor-actions">
        <button class="modal-btn" id="theme-editor-apply">Apply (preview)</button>
      </div>
    `,
    okText: 'SAVE',
    cancelText: 'CLOSE',
    onOk: async () => {
      const customTheme = {};
      for (const name of THEME_EDITOR_VARS) {
        const txt = document.querySelector(`#theme-editor-grid input[data-vartext="${name}"]`);
        const val = txt ? txt.value.trim() : '';
        if (val) customTheme[name] = val;
      }
      state.settings.customTheme = customTheme;
      state.settings.theme = 'custom';
      await saveSettings();
      applyTheme();
      toast('Custom theme saved', 'ok');
    },
  });

  // Keep color picker and text input in sync per row.
  const grid = $('#theme-editor-grid');
  if (grid) {
    grid.querySelectorAll('input[type="color"]').forEach(picker => {
      picker.addEventListener('input', () => {
        const name = picker.dataset.var;
        const txt = grid.querySelector(`input[data-vartext="${name}"]`);
        if (txt) txt.value = picker.value;
      });
    });
    grid.querySelectorAll('input[type="text"]').forEach(txt => {
      txt.addEventListener('input', () => {
        const name = txt.dataset.vartext;
        const picker = grid.querySelector(`input[data-var="${name}"]`);
        if (picker && /^#[0-9a-fA-F]{6}$/.test(txt.value.trim())) {
          picker.value = txt.value.trim().toLowerCase();
        }
      });
    });
  }

  const applyBtn = $('#theme-editor-apply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      for (const name of THEME_EDITOR_VARS) {
        const txt = grid && grid.querySelector(`input[data-vartext="${name}"]`);
        const val = txt ? txt.value.trim() : '';
        if (val) document.body.style.setProperty(name, val);
      }
      toast('Preview applied', 'ok', 1400);
    };
  }
}

// Ctrl+Shift+Y opens the editor.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
    e.preventDefault();
    openCustomThemeEditor();
  }
});
