// ═══════════════════════════════════════════════════════════════════════════
//  Custom avatars + Discord deep-link + Build & install
// ═══════════════════════════════════════════════════════════════════════════

// New people model: { people: [{ id, displayName, emails:[], avatarPath, discordUserId,
//                       discordUsername, discordAvatarUrl, discordCachedName, discordCachedAt }],
//                     discordBotToken: '' }
state.people = { people: [], discordBotToken: '' };
const _avatarDataCache = new Map();
const _discordFetchInFlight = new Set(); // user IDs being fetched, to dedupe

function _newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function _migratePeople(raw) {
  if (!raw || typeof raw !== 'object') return { people: [], discordBotToken: '' };
  if (Array.isArray(raw.people)) {
    return {
      people: raw.people.map(p => ({
        id: p.id || _newId(),
        displayName: p.displayName || (p.emails?.[0] || ''),
        emails: Array.isArray(p.emails) ? p.emails.map(e => e.toLowerCase()) : [],
        names: Array.isArray(p.names) ? p.names : [],
        avatarPath: p.avatarPath || '',
        discordUserId: p.discordUserId || '',
        discordUsername: p.discordUsername || '',
        discordAvatarUrl: p.discordAvatarUrl || '',
        discordCachedName: p.discordCachedName || '',
        discordCachedAt: p.discordCachedAt || 0,
      })),
      discordBotToken: raw.discordBotToken || '',
    };
  }
  // Old format — convert
  const people = [];
  for (const [email, info] of Object.entries(raw.byEmail || {})) {
    people.push({
      id: _newId(),
      displayName: info.discordUsername || email,
      emails: [email.toLowerCase()],
      names: [],
      avatarPath: info.avatarPath || '',
      discordUserId: info.discordUserId || '',
      discordUsername: info.discordUsername || '',
      discordAvatarUrl: '',
      discordCachedName: '',
      discordCachedAt: 0,
    });
  }
  for (const [name, info] of Object.entries(raw.byName || {})) {
    people.push({
      id: _newId(),
      displayName: name,
      emails: [],
      names: [name],
      avatarPath: info.avatarPath || '',
      discordUserId: info.discordUserId || '',
      discordUsername: info.discordUsername || '',
      discordAvatarUrl: '',
      discordCachedName: '',
      discordCachedAt: 0,
    });
  }
  return { people, discordBotToken: '' };
}

async function loadPeople() {
  try {
    const raw = await window.api.peopleRead();
    state.people = _migratePeople(raw);
  } catch { state.people = { people: [], discordBotToken: '' }; }
}
async function savePeople() {
  try { await window.api.peopleWrite(state.people); } catch {}
}

function lookupPerson(name, email) {
  const lcEmail = (email || '').toLowerCase().trim();
  if (lcEmail) {
    const p = state.people.people.find(p => p.emails.some(e => e === lcEmail));
    if (p) return p;
  }
  if (name) {
    const p = state.people.people.find(p => p.names?.includes(name) || p.displayName === name);
    if (p) return p;
  }
  return null;
}

async function fetchDiscordForPerson(person, { force = false } = {}) {
  if (!person?.discordUserId) return { ok: false, error: 'no Discord ID' };
  if (!state.people.discordBotToken) return { ok: false, error: 'no Discord bot token configured' };
  // Cache freshness: 24 hours unless force
  if (!force && person.discordAvatarUrl && person.discordCachedAt && Date.now() - person.discordCachedAt < 24 * 3600 * 1000) {
    return { ok: true, fromCache: true };
  }
  if (_discordFetchInFlight.has(person.discordUserId)) return { ok: false, error: 'in-flight' };
  _discordFetchInFlight.add(person.discordUserId);
  try {
    const r = await window.api.discordFetchUser({
      token: state.people.discordBotToken,
      userId: person.discordUserId,
    });
    if (!r.ok) return r;
    person.discordAvatarUrl = r.data.avatarUrl;
    person.discordCachedName = r.data.globalName || r.data.username;
    if (!person.discordUsername) person.discordUsername = r.data.username;
    person.discordCachedAt = Date.now();
    await savePeople();
    return { ok: true, data: r.data };
  } finally {
    _discordFetchInFlight.delete(person.discordUserId);
  }
}

async function avatarPathToDataUri(absPath) {
  if (!absPath) return null;
  if (_avatarDataCache.has(absPath)) return _avatarDataCache.get(absPath);
  try {
    const r = await window.api.readAbsBinary(absPath);
    if (!r.ok) return null;
    const uri = `data:${r.mime};base64,${r.data}`;
    _avatarDataCache.set(absPath, uri);
    return uri;
  } catch { return null; }
}

// Patch avatarHtml: per-person custom file → Discord cached URL → (auto-fetch if
// token+id) → fall through to existing GitHub/Gravatar/Initials chain.
const _origAvatarHtml = avatarHtml;
avatarHtml = function (name, email, size = 'sm') {
  if (!state.settings.showAvatars) return '';
  const cls = size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  const peep = lookupPerson(name, email);
  if (peep) {
    // 1) Local custom avatar — render initials placeholder, async-swap to image
    if (peep.avatarPath) {
      const seed = (email || name || '?').toLowerCase().trim();
      const bg = avatarColor(seed);
      const slotId = 'dva-pa-' + Math.random().toString(36).slice(2, 9);
      const initialsText = escapeHtml(initials(peep.discordCachedName || name));
      setTimeout(async () => {
        const uri = await avatarPathToDataUri(peep.avatarPath);
        const el = document.getElementById(slotId);
        if (uri && el) el.innerHTML = `<img loading="lazy" src="${uri}" alt=""/>`;
      }, 0);
      return `<span id="${slotId}" class="${cls}" style="background:${bg};">${initialsText}</span>`;
    }
    // 2) Cached Discord avatar
    if (peep.discordAvatarUrl) {
      return `<span class="${cls}"><img loading="lazy" src="${peep.discordAvatarUrl}" alt=""/></span>`;
    }
    // 3) Auto-fetch if we have ID + token
    if (peep.discordUserId && state.people.discordBotToken) {
      const slotId = 'dva-dc-' + Math.random().toString(36).slice(2, 9);
      const seed = (email || name || '?').toLowerCase().trim();
      const bg = avatarColor(seed);
      const initialsText = escapeHtml(initials(name));
      setTimeout(async () => {
        const r = await fetchDiscordForPerson(peep);
        if (r.ok && peep.discordAvatarUrl) {
          const el = document.getElementById(slotId);
          if (el) el.innerHTML = `<img loading="lazy" src="${peep.discordAvatarUrl}" alt=""/>`;
        }
      }, 0);
      return `<span id="${slotId}" class="${cls}" style="background:${bg};">${initialsText}</span>`;
    }
  }
  return _origAvatarHtml(name, email, size);
};

// Replace the cached-display-name preference: if a person has a discord-cached
// name, prefer it in the "AUTHOR" column.
function displayNameFor(name, email) {
  const p = lookupPerson(name, email);
  return p?.discordCachedName || name;
}

// Right-click on commit author/avatar in graph rows: edit person / discord dm
function attachAuthorContextMenus() {
  $$('#graph-body .graph-row').forEach(row => {
    const authorCol = row.querySelector('.gr-col-author');
    if (!authorCol || authorCol.dataset.dvaCtx) return;
    authorCol.dataset.dvaCtx = '1';
    authorCol.classList.add('author-with-discord');
    authorCol.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hash = row.dataset.hash;
      const c = state.commits.find(c => c.hash === hash);
      if (!c) return;
      const name = c.author_name || '';
      const email = c.author_email || '';
      const peep = lookupPerson(name, email);
      const items = [
        { label: peep ? 'Edit person…' : `Add "${name}" to People…`, icon: '✎', action: () => openPersonEditor(name, email) },
      ];
      if (peep?.discordUserId) {
        items.push({ separator: true });
        items.push({ label: `Discord DM (${peep.discordUsername || peep.discordUserId})`, icon: '💬', action: () => openDiscordDM(peep.discordUserId) });
      }
      items.push({ separator: true });
      items.push({ label: 'Copy email', icon: '⧉', action: () => copyText(email) });
      items.push({ label: 'Manage People…', icon: '👥', action: openPeopleManager });
      showContextMenu(e.clientX, e.clientY, items);
    });
  });
}
const _origRenderGraph_people = renderGraph;
renderGraph = function () {
  _origRenderGraph_people();
  attachAuthorContextMenus();
};

async function openDiscordDM(userId) {
  if (!userId) { toast('No Discord ID configured', 'warn'); return; }
  // Try desktop client first; fall back to web after a short delay.
  await window.api.openExternal(`discord://-/users/${userId}`);
  // Fallback: also offer the web URL via a toast click is overkill; just
  // attempt both. The web URL only works if logged into Discord in browser.
  setTimeout(() => { window.api.openExternal(`https://discord.com/users/${userId}`); }, 500);
}

function _findOrStubPerson(seedName, seedEmail) {
  const existing = lookupPerson(seedName, seedEmail);
  if (existing) return { person: existing, isNew: false };
  return {
    person: {
      id: _newId(),
      displayName: seedName || seedEmail || 'Unnamed',
      emails: seedEmail ? [seedEmail.toLowerCase()] : [],
      names: seedName ? [seedName] : [],
      avatarPath: '',
      discordUserId: '',
      discordUsername: '',
      discordAvatarUrl: '',
      discordCachedName: '',
      discordCachedAt: 0,
    },
    isNew: true,
  };
}

function openPersonEditor(seedName, seedEmail) {
  const { person, isNew } = _findOrStubPerson(seedName, seedEmail);
  // Local working copy — only persist on Save
  const draft = JSON.parse(JSON.stringify(person));
  if (seedName && !draft.names.includes(seedName)) draft.names.push(seedName);

  const renderChips = () => {
    const chipsHtml = draft.emails.map((em, i) => `
      <span class="email-chip ${i === 0 ? 'primary' : ''}" data-em="${escapeHtml(em)}">
        ${escapeHtml(em)}
        <span class="chip-remove" data-rm="${escapeHtml(em)}">✕</span>
      </span>
    `).join('');
    $('#modal-pp-emails').innerHTML = chipsHtml + `<input class="email-add-input" id="modal-pp-email-add" placeholder="add an email…"/>`;
    $$('#modal-pp-emails .chip-remove').forEach(x => {
      x.onclick = (e) => {
        e.stopPropagation();
        draft.emails = draft.emails.filter(em => em !== x.dataset.rm);
        renderChips();
      };
    });
    $('#modal-pp-email-add').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        const v = e.target.value.trim().toLowerCase().replace(/,$/, '');
        if (v && !draft.emails.includes(v)) {
          draft.emails.push(v);
          e.target.value = '';
          renderChips();
          // Re-focus the new input
          setTimeout(() => $('#modal-pp-email-add')?.focus(), 0);
        }
        e.preventDefault();
      }
    };
  };

  const renderDiscordPreview = () => {
    const el = $('#modal-pp-dc-status');
    if (!el) return;
    const url = draft.discordAvatarUrl;
    const dn = draft.discordCachedName;
    const at = draft.discordCachedAt ? new Date(draft.discordCachedAt).toLocaleString() : '';
    if (url) {
      el.className = 'discord-status ok';
      el.innerHTML = `<span class="discord-preview-avatar" style="background-image:url('${url}')"></span>
        <span><strong>${escapeHtml(dn || '?')}</strong> · cached ${escapeHtml(at)}</span>`;
    } else if (!draft.discordUserId) {
      el.className = 'discord-status';
      el.textContent = 'No Discord ID set.';
    } else if (!state.people.discordBotToken) {
      el.className = 'discord-status err';
      el.textContent = 'No bot token configured (Settings → Discord bot token).';
    } else {
      el.className = 'discord-status';
      el.textContent = 'Not yet fetched — click Fetch.';
    }
  };

  modal({
    title: `EDIT PERSON — ${escapeHtml(draft.displayName || '(unnamed)')}`,
    body: `
      <label>DISPLAY NAME</label>
      <input id="modal-pp-display" value="${escapeHtml(draft.displayName)}"/>
      <label>EMAILS (Enter / comma to add — first is primary)</label>
      <div class="email-chips" id="modal-pp-emails"></div>
      <p style="font-size: 11px; color: var(--text-3); margin-top: 4px;">Any of these emails will match this person across repos.</p>

      <label>CUSTOM AVATAR (local file path — takes priority over Discord)</label>
      <div class="form-row" style="display:flex; gap:6px;">
        <input id="modal-pp-avatar" value="${escapeHtml(draft.avatarPath)}" placeholder="C:\\path\\to\\avatar.png"/>
        <button class="csh-action" id="modal-pp-pick">Pick…</button>
        <button class="csh-action" id="modal-pp-clear">Clear</button>
      </div>

      <hr style="border:none; border-top:1px solid var(--line); margin: 14px 0;"/>
      <label>DISCORD USER ID (right-click their profile in Discord → Copy ID)</label>
      <div class="form-row" style="display:flex; gap:6px;">
        <input id="modal-pp-did" value="${escapeHtml(draft.discordUserId)}" placeholder="e.g. 192873918273918273"/>
        <button class="csh-action" id="modal-pp-fetch">Fetch from Discord</button>
      </div>
      <label>DISCORD USERNAME (label / fallback if no ID)</label>
      <input id="modal-pp-duname" value="${escapeHtml(draft.discordUsername)}" placeholder="username"/>
      <div class="discord-status" id="modal-pp-dc-status">Not yet fetched.</div>
      <p style="font-size: 11px; color: var(--text-3); margin-top: 6px;">Bot token from Settings is sent to <code>discord.com/api/v10/users/&lt;id&gt;</code>. The bot does <strong>not</strong> need to share a server with the user.</p>
    `,
    okText: 'SAVE',
    onOk: async () => {
      draft.displayName = $('#modal-pp-display').value.trim() || draft.displayName;
      draft.avatarPath = $('#modal-pp-avatar').value.trim();
      draft.discordUserId = $('#modal-pp-did').value.trim();
      draft.discordUsername = $('#modal-pp-duname').value.trim();
      // Drain any pending text in the email-add input as a final chip
      const pending = $('#modal-pp-email-add')?.value.trim().toLowerCase();
      if (pending && !draft.emails.includes(pending)) draft.emails.push(pending);
      // Persist back to the actual person (or push if new)
      Object.assign(person, draft);
      if (isNew) state.people.people.push(person);
      // Clear stale custom-avatar cache so next render reloads
      if (person.avatarPath) _avatarDataCache.delete(person.avatarPath);
      await savePeople();
      renderGraph();
      if (state.selectedCommit) selectCommit(state.selectedCommit);
      toast('Person saved', 'ok');
    },
  });

  renderChips();
  renderDiscordPreview();

  $('#modal-pp-pick').onclick = async () => {
    const p = await window.api.pickImage();
    if (p) $('#modal-pp-avatar').value = p;
  };
  $('#modal-pp-clear').onclick = () => { $('#modal-pp-avatar').value = ''; };

  $('#modal-pp-fetch').onclick = async () => {
    draft.discordUserId = $('#modal-pp-did').value.trim();
    if (!draft.discordUserId) { toast('Enter a Discord user ID first', 'warn'); return; }
    if (!state.people.discordBotToken) {
      toast('Set a bot token in Settings first', 'warn');
      return;
    }
    $('#modal-pp-dc-status').className = 'discord-status';
    $('#modal-pp-dc-status').textContent = 'Fetching…';
    const r = await window.api.discordFetchUser({
      token: state.people.discordBotToken,
      userId: draft.discordUserId,
    });
    if (!r.ok) {
      $('#modal-pp-dc-status').className = 'discord-status err';
      $('#modal-pp-dc-status').textContent = r.error;
      return;
    }
    draft.discordAvatarUrl = r.data.avatarUrl;
    draft.discordCachedName = r.data.globalName || r.data.username;
    draft.discordCachedAt = Date.now();
    if (!draft.discordUsername) {
      draft.discordUsername = r.data.username;
      $('#modal-pp-duname').value = draft.discordUsername;
    }
    if (!draft.displayName || draft.displayName === '(unnamed)') {
      draft.displayName = draft.discordCachedName;
      $('#modal-pp-display').value = draft.displayName;
    }
    renderDiscordPreview();
    toast('Fetched from Discord', 'ok');
  };
}

function openPeopleManager() {
  const peeps = state.people.people || [];

  // Suggest authors from current repo that aren't mapped yet
  const mappedEmails = new Set();
  for (const p of peeps) for (const e of p.emails) mappedEmails.add(e);
  const suggestions = [];
  const seenSugg = new Set();
  for (const c of (state.commits || [])) {
    const em = (c.author_email || '').toLowerCase();
    const nm = c.author_name || '';
    if (em && !mappedEmails.has(em) && !seenSugg.has(em)) {
      suggestions.push({ name: nm, email: em });
      seenSugg.add(em);
    }
    if (suggestions.length >= 20) break;
  }

  const rowsHtml = peeps.length === 0
    ? '<p style="color: var(--text-3); padding: 6px;">No people configured yet.</p>'
    : `<div class="people-list">${peeps.map((p, i) => {
        const emails = p.emails || [];
        const primaryEmail = emails[0] || '(no email)';
        const extra = emails.length > 1 ? ` <span style="color: var(--text-3);">+${emails.length - 1} more</span>` : '';
        return `
          <div class="people-row" data-i="${i}">
            <span class="avatar" id="pp-row-av-${i}">${escapeHtml(initials(p.discordCachedName || p.displayName))}</span>
            <span class="people-identity">
              <span class="pp-name">${escapeHtml(p.discordCachedName || p.displayName)}</span>
              <span class="pp-email">${escapeHtml(primaryEmail)}${extra}</span>
            </span>
            <span class="pp-email" style="color: var(--text-3); font-size: 11px;">${escapeHtml(p.discordUsername || '')}</span>
            <span class="pp-email" style="color: var(--cyan); font-size: 11px;">${escapeHtml(p.discordUserId || '')}</span>
            <span class="people-row-actions">
              <button class="csh-action" data-act="edit">Edit</button>
              ${p.discordUserId && state.people.discordBotToken ? '<button class="csh-action" data-act="refresh" title="Refresh Discord avatar">↻</button>' : ''}
              ${p.discordUserId ? '<button class="csh-action" data-act="dm">DM</button>' : ''}
              <button class="csh-action danger" data-act="del">✕</button>
            </span>
          </div>`;
      }).join('')}</div>`;

  modal({
    title: 'PEOPLE',
    body: `
      <div style="display: flex; gap: 6px; margin-bottom: 10px;">
        <button class="csh-action" id="pp-add-new">+ New person</button>
        ${peeps.some(p => p.discordUserId) ? '<button class="csh-action" id="pp-refresh-all">Refresh all Discord avatars</button>' : ''}
      </div>
      ${rowsHtml}
      ${suggestions.length ? `<hr style="border:none; border-top:1px solid var(--line); margin: 14px 0;"/>
        <label>UNMAPPED AUTHORS IN THIS REPO</label>
        <div class="people-list" style="margin-top: 6px;">${suggestions.map(s => `
          <div class="people-row" data-sug>
            <span class="avatar" style="background:${avatarColor((s.email || s.name).toLowerCase())};">${escapeHtml(initials(s.name))}</span>
            <span class="people-identity"><span class="pp-name">${escapeHtml(s.name)}</span><span class="pp-email">${escapeHtml(s.email)}</span></span>
            <span></span>
            <span></span>
            <span class="people-row-actions"><button class="csh-action" data-act="add" data-name="${escapeHtml(s.name)}" data-email="${escapeHtml(s.email)}">Add…</button></span>
          </div>
        `).join('')}</div>` : ''}
    `,
    cancelText: 'Close',
    hideOk: true,
    onOk: () => {},
  });

  $('#pp-add-new').onclick = () => { $('#modal-backdrop').classList.add('hidden'); openPersonEditor('', ''); };

  const refreshAllBtn = $('#pp-refresh-all');
  if (refreshAllBtn) {
    refreshAllBtn.onclick = async () => {
      if (!state.people.discordBotToken) { toast('Set a bot token in Settings first', 'warn'); return; }
      let okN = 0, errN = 0;
      for (const p of peeps) {
        if (!p.discordUserId) continue;
        const r = await fetchDiscordForPerson(p, { force: true });
        if (r.ok) okN++; else errN++;
      }
      await savePeople();
      toast(`Refreshed ${okN} avatar(s)${errN ? ` · ${errN} error(s)` : ''}`, errN ? 'warn' : 'ok');
      $('#modal-backdrop').classList.add('hidden');
      openPeopleManager();
      renderGraph();
    };
  }

  $$('#modal-body .people-row[data-i]').forEach(row => {
    const i = parseInt(row.dataset.i, 10);
    const p = peeps[i];
    const avEl = document.getElementById(`pp-row-av-${i}`);
    if (avEl) {
      if (p.avatarPath) {
        avatarPathToDataUri(p.avatarPath).then(uri => { if (uri) avEl.innerHTML = `<img src="${uri}" alt=""/>`; });
      } else if (p.discordAvatarUrl) {
        avEl.innerHTML = `<img src="${p.discordAvatarUrl}" alt=""/>`;
      } else {
        avEl.style.background = avatarColor((p.emails[0] || p.displayName || '').toLowerCase());
      }
    }
    row.querySelector('[data-act="edit"]').onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      openPersonEditor(p.displayName, p.emails[0] || '');
    };
    row.querySelector('[data-act="del"]').onclick = async () => {
      state.people.people = state.people.people.filter(x => x.id !== p.id);
      await savePeople();
      $('#modal-backdrop').classList.add('hidden');
      openPeopleManager();
      renderGraph();
    };
    const dm = row.querySelector('[data-act="dm"]');
    if (dm) dm.onclick = () => openDiscordDM(p.discordUserId);
    const rf = row.querySelector('[data-act="refresh"]');
    if (rf) rf.onclick = async () => {
      const r = await fetchDiscordForPerson(p, { force: true });
      if (r.ok) { toast('Refreshed', 'ok'); $('#modal-backdrop').classList.add('hidden'); openPeopleManager(); renderGraph(); }
      else toast(r.error, 'error');
    };
  });
  $$('#modal-body .people-row[data-sug] [data-act="add"]').forEach(btn => {
    btn.onclick = () => {
      $('#modal-backdrop').classList.add('hidden');
      openPersonEditor(btn.dataset.name, btn.dataset.email);
    };
  });
}

// Settings: add People + Build + Discord bot token rows
const _origOpenSettingsModal3 = openSettingsModal;
openSettingsModal = function () {
  _origOpenSettingsModal3();
  const body = $('#modal-body');
  if (!body) return;
  const tokenMasked = state.people.discordBotToken ? '•'.repeat(Math.min(40, state.people.discordBotToken.length)) : '';
  const extra = document.createElement('div');
  extra.innerHTML = `
    <hr style="border: none; border-top: 1px solid var(--line); margin: 14px 0;"/>
    <label>DISCORD BOT TOKEN</label>
    <div class="form-row" style="display:flex; gap:6px;">
      <input id="set-discord-token" type="password" placeholder="${tokenMasked || 'paste bot token (kept encrypted on disk)'}" value="${escapeHtml(state.people.discordBotToken || '')}"/>
      <button class="csh-action" id="set-discord-clear">Clear</button>
    </div>
    <p style="font-size: 11px; color: var(--text-3); margin-top: 4px;">Create a bot at <code>discord.com/developers/applications</code> → Bot → Reset Token. No intents required for <code>/users/&lt;id&gt;</code>. Stored via OS keychain when available.</p>
    <div class="settings-row" style="margin-top: 14px;">
      <div><div class="settings-label">People (custom avatars + Discord)</div><div class="settings-sub">One person, multiple emails, Discord auto-fetch.</div></div>
      <button class="csh-action" id="set-open-people">Manage…</button>
    </div>
  `;
  body.appendChild(extra);
  $('#set-discord-clear').onclick = () => { $('#set-discord-token').value = ''; };
  $('#set-open-people').onclick = () => { $('#modal-backdrop').classList.add('hidden'); openPeopleManager(); };

  // Wrap the OK handler to capture the token before the inner save runs
  const okBtn = $('#modal-ok');
  const origOk = okBtn.onclick;
  okBtn.onclick = async (ev) => {
    const t = $('#set-discord-token').value.trim();
    state.people.discordBotToken = t;
    await savePeople();
    if (origOk) await origOk(ev);
  };
};

// Load People at startup
loadPeople();
