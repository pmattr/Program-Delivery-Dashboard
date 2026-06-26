// ─────────────────────────────────────────────────────────────────────────────
// GitHub JSON Connector — People Delivery Plan 2026
// ─────────────────────────────────────────────────────────────────────────────

const GH_CONFIG = {
  owner:  'pmattr',
  repo:   'Program-Delivery-Dashboard',
  path:   'data.json',
  branch: 'main',
};

// ─── Session ──────────────────────────────────────────────────────────────────

function _getSession() {
  return {
    token: localStorage.getItem('gh_pat')    || '',
    user:  localStorage.getItem('gh_user')   || '',
  };
}

function _setSession(user, token) {
  localStorage.setItem('gh_pat',  token);
  localStorage.setItem('gh_user', user);
  _updateUserChip(user);
}

function _clearSession() {
  localStorage.removeItem('gh_pat');
  localStorage.removeItem('gh_user');
  const chip = document.getElementById('gh-user-chip');
  if (chip) { chip.textContent = ''; chip.style.display = 'none'; }
}

function _updateUserChip(user) {
  const chip = document.getElementById('gh-user-chip');
  if (chip) { chip.textContent = '👤 ' + user; chip.style.display = 'block'; }
}

// ─── Login modal ──────────────────────────────────────────────────────────────

function _showLoginModal(onSuccess) {
  document.getElementById('gh-login-overlay') && document.getElementById('gh-login-overlay').remove();

  const overlay = document.createElement('div');
  overlay.id = 'gh-login-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:36px 32px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:20px;font-weight:700;color:#1e3a5f;margin-bottom:4px">Sign in to edit</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:24px">Read-only access is available without signing in.</div>

      <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Username</label>
      <input id="gh-li-user" placeholder="Enter your username" autocomplete="username"
        style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d1d5db;border-radius:7px;font-size:14px;margin-bottom:14px">

      <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Password</label>
      <input id="gh-li-pass" type="password" placeholder="••••••••••••••••" autocomplete="current-password"
        style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d1d5db;border-radius:7px;font-size:14px;margin-bottom:6px">

      <div id="gh-li-err" style="color:#991b1b;font-size:12px;min-height:18px;margin-bottom:10px"></div>

      <button id="gh-li-btn"
        style="width:100%;padding:11px;background:#1e3a5f;color:#fff;border:none;border-radius:7px;font-size:14px;font-weight:600;cursor:pointer">
        Sign in
      </button>
      <button onclick="document.getElementById('gh-login-overlay').remove()"
        style="width:100%;padding:9px;background:none;border:none;color:#64748b;font-size:13px;cursor:pointer;margin-top:6px">
        Continue read-only
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const doLogin = async () => {
    const username = document.getElementById('gh-li-user').value.trim();
    const password = document.getElementById('gh-li-pass').value.trim();
    const errEl    = document.getElementById('gh-li-err');
    const btn      = document.getElementById('gh-li-btn');

    if (!username) { errEl.textContent = 'Please enter your username'; return; }
    if (!password) { errEl.textContent = 'Please enter your password'; return; }

    btn.textContent = 'Signing in…'; btn.disabled = true; errEl.textContent = '';
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.path}?ref=${GH_CONFIG.branch}`, {
        headers: { Authorization: `Bearer ${password}`, Accept: 'application/vnd.github+json' }
      });
      if (res.status === 401 || res.status === 403) throw new Error('Incorrect password');
      if (!res.ok) throw new Error(`Error (${res.status})`);
      _setSession(username, password);
      overlay.remove();
      onSuccess(password);
    } catch (err) {
      errEl.textContent = err.message;
      btn.textContent = 'Sign in'; btn.disabled = false;
    }
  };

  document.getElementById('gh-li-btn').onclick = doLogin;
  document.getElementById('gh-li-pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  setTimeout(() => { const el = document.getElementById('gh-li-user'); if (el) el.focus(); }, 50);
}

// ─── Token getter (returns promise, shows modal if needed) ───────────────────

function _requireToken() {
  const { token } = _getSession();
  if (token) return Promise.resolve(token);
  return new Promise(resolve => _showLoginModal(resolve));
}

// ─── Local cache (offline fallback) ──────────────────────────────────────────

const _CACHE_KEY = `gh_data_${GH_CONFIG.owner}_${GH_CONFIG.repo}`;

function _saveCache(data) {
  try { localStorage.setItem(_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function _loadCache() {
  try {
    const raw = localStorage.getItem(_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return { data, ageMin: (Date.now() - ts) / 60000 };
  } catch { return null; }
}

// ─── GitHub read / write ──────────────────────────────────────────────────────

const _apiUrl = `https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.path}`;

async function _readFile() {
  const url = `https://raw.githubusercontent.com/${GH_CONFIG.owner}/${GH_CONFIG.repo}/${GH_CONFIG.branch}/${GH_CONFIG.path}?_=${Date.now()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Read failed (${res.status})`);
    return res.json();
  } finally { clearTimeout(t); }
}

async function _writeFile(data) {
  const token = await _requireToken();
  const metaRes = await fetch(`${_apiUrl}?ref=${GH_CONFIG.branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!metaRes.ok) {
    if (metaRes.status === 401) { _clearSession(); throw new Error('Session expired — please sign in again'); }
    throw new Error(`GitHub error (${metaRes.status})`);
  }
  const { sha } = await metaRes.json();
  const res = await fetch(_apiUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Dashboard update ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
      sha, branch: GH_CONFIG.branch,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Write failed (${res.status})`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const GitHubDB = {
  _data: null,

  async load() {
    _showBanner('Loading…', 'info');
    try {
      const data = await _readFile();
      GitHubDB._data = data;
      _saveCache(data);
      _applyData(data);
      _showBanner('Data loaded', 'success');
      setTimeout(_hideBanner, 2000);
    } catch (err) {
      console.error('[GitHubDB] load:', err);
      const cached = _loadCache();
      if (cached) {
        _applyData(cached.data);
        const age = cached.ageMin < 60 ? `${Math.round(cached.ageMin)}m ago` : `${Math.round(cached.ageMin/60)}h ago`;
        _showBanner(`⚠️ Offline — showing cached data (${age})`, 'warning');
        setTimeout(_hideBanner, 6000);
      } else {
        _showBanner('⚠️ Could not load data', 'warning');
        setTimeout(_hideBanner, 5000);
      }
    }
  },

  async save() {
    _showBanner('Saving…', 'info');
    try {
      const payload = { rows: window.ROWS || [], gantt: window.GANTT || [], iterations: window.ALL_ITER || {} };
      await _writeFile(payload);
      GitHubDB._data = payload;
      _saveCache(payload);
      _showBanner('✓ Saved', 'success');
      setTimeout(_hideBanner, 2500);
    } catch (err) {
      console.error('[GitHubDB] save:', err);
      _showBanner('Save failed: ' + err.message, 'error');
    }
  },

  logout() { _clearSession(); _showBanner('Logged out', 'info'); setTimeout(_hideBanner, 2500); },
};

function _applyData(data) {
  if (data.rows       && data.rows.length)                     window.ROWS     = data.rows;
  if (data.gantt      && data.gantt.length)                    window.GANTT    = data.gantt;
  if (data.iterations && Object.keys(data.iterations).length)  window.ALL_ITER = data.iterations;
  if (typeof buildOv          === 'function') buildOv();
  if (typeof buildRm          === 'function') buildRm();
  if (typeof buildGantt       === 'function') buildGantt();
  if (typeof renderRoadmap    === 'function') renderRoadmap();
  if (typeof renderIterations === 'function') renderIterations();
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

let _editMode = false;
let _pendingRows = {}, _pendingIters = {};

const _STATUS_OPTS = [{v:'done',l:'Done'},{v:'prog',l:'In Progress'},{v:'plan',l:'Planned'}];
const _HEALTH_OPTS = ['Green','Amber','Red'];
const _ITER_STATUS = ['Not Started','In Progress','Complete','On Hold','Blocked'];

function _injectStyles() {
  if (document.getElementById('gh-edit-styles')) return;
  const s = document.createElement('style');
  s.id = 'gh-edit-styles';
  s.textContent = `
    #gh-edit-btn{position:fixed;bottom:24px;right:24px;z-index:9000;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.2);transition:all .2s}
    #gh-edit-btn.off{background:#1e3a5f;color:#fff}
    #gh-edit-btn.on{background:#f97316;color:#fff}
    #gh-save-bar{position:fixed;bottom:70px;right:24px;z-index:9000;display:none;flex-direction:row;gap:8px;align-items:center;background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:8px 14px;box-shadow:0 2px 12px rgba(0,0,0,.12);font-size:13px}
    #gh-save-bar .save{background:#166534;color:#fff;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600}
    #gh-save-bar .discard{background:#f3f4f6;color:#374151;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px}
    #gh-change-count{color:#92400e;font-weight:600}
    .gh-editable{background:#fffbeb!important;outline:1px solid #f59e0b;border-radius:3px;padding:2px 4px!important}
    .gh-editable:focus{outline:2px solid #f97316}
    .gh-select{border:1px solid #d1d5db;border-radius:4px;padding:2px 6px;font-size:12px;background:#fffbeb}
    tr.gh-dirty td{background:#fffbeb!important}
    #gh-banner{position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 16px;font-size:13px;font-family:sans-serif;text-align:center;color:#fff;display:none;transition:opacity .3s}
    #gh-user-chip{position:fixed;bottom:24px;left:24px;z-index:9000;background:#1e3a5f;color:#fff;padding:7px 14px;border-radius:8px;font-size:13px;display:none;cursor:pointer}
  `;
  document.head.appendChild(s);
}

function _injectUI() {
  _injectStyles();
  const btn = document.createElement('button');
  btn.id = 'gh-edit-btn'; btn.className = 'off'; btn.textContent = '✎ Edit';
  btn.onclick = _toggleEdit;
  document.body.appendChild(btn);

  const bar = document.createElement('div');
  bar.id = 'gh-save-bar';
  bar.innerHTML = `<span id="gh-change-count">0 changes</span><button class="discard" id="gh-discard">Discard</button><button class="save" id="gh-save">Save</button>`;
  document.body.appendChild(bar);

  const banner = document.createElement('div');
  banner.id = 'gh-banner';
  document.body.appendChild(banner);

  const chip = document.createElement('div');
  chip.id = 'gh-user-chip';
  chip.title = 'Click to log out';
  chip.onclick = () => { if (confirm('Log out?')) GitHubDB.logout(); };
  document.body.appendChild(chip);

  document.getElementById('gh-save').onclick    = _saveAll;
  document.getElementById('gh-discard').onclick = _discard;

  const saved = _getSession();
  if (saved.user) _updateUserChip(saved.user);
}

function _toggleEdit() {
  _editMode = !_editMode;
  const btn = document.getElementById('gh-edit-btn');
  btn.className   = _editMode ? 'on' : 'off';
  btn.textContent = _editMode ? '✎ Editing' : '✎ Edit';
  _editMode ? _activateEdit() : _deactivateEdit();
}

function _activateEdit() {
  document.querySelectorAll('table tbody tr').forEach(tr => {
    if (tr.dataset.rowId) return;
    const cells = tr.querySelectorAll('td');
    if (cells.length < 4) return;
    const rowId = parseInt(cells[0] && cells[0].textContent.trim());
    const row = window.ROWS && window.ROWS.find(r => r.id === rowId);
    if (!row) return;
    tr.dataset.rowId = row.id;
    const COL_MAP = {3:'status', 4:'date', 5:'owner', 7:'notes'};
    cells.forEach((td, i) => { if (COL_MAP[i]) td.dataset.col = COL_MAP[i]; });
  });

  document.querySelectorAll('tr[data-row-id]').forEach(tr => {
    const id  = parseInt(tr.dataset.rowId);
    const row = (window.ROWS || []).find(r => r.id === id);
    if (!row) return;
    tr.querySelectorAll('td[data-col]').forEach(td => {
      const col = td.dataset.col;
      if (col === 'status') {
        const sel = document.createElement('select'); sel.className = 'gh-select';
        _STATUS_OPTS.forEach(o => { const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l; if (o.v === row.s) opt.selected = true; sel.appendChild(opt); });
        sel.onchange = () => { row.s = sel.value; _dirtyRow(id, tr); };
        td.innerHTML = ''; td.appendChild(sel);
      }
      if (col === 'owner' || col === 'date' || col === 'notes') {
        td.contentEditable = 'true'; td.classList.add('gh-editable');
        td.oninput = () => { if (col==='owner') row.o=td.textContent.trim(); if (col==='date') row.d=td.textContent.trim(); if (col==='notes') row.n=td.textContent.trim(); _dirtyRow(id, tr); };
      }
    });
  });

  document.querySelectorAll('[data-col][data-iter-key]').forEach(el => {
    const key=el.dataset.iterKey, name=el.dataset.iterName, col=el.dataset.col;
    const item=((window.ALL_ITER||{})[key]||[]).find(i=>i.name===name);
    if (!item) return;
    if (col==='health') { el.style.cursor='pointer'; el.title='Click to cycle'; el.onclick=()=>{ const next=_HEALTH_OPTS[(_HEALTH_OPTS.indexOf(item.health)+1)%_HEALTH_OPTS.length]; item.health=next; el.textContent=next; el.className=el.className.replace(/health-\w+/,'health-'+next); _dirtyIter(key,name); }; }
    if (col==='status') { const sel=document.createElement('select'); sel.className='gh-select'; _ITER_STATUS.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;if(v===item.status)o.selected=true;sel.appendChild(o);}); sel.onchange=()=>{item.status=sel.value;_dirtyIter(key,name);}; el.replaceWith(sel); Object.assign(sel.dataset,{col,iterKey:key,iterName:name}); }
  });
}

function _deactivateEdit() {
  document.querySelectorAll('.gh-editable').forEach(td => { td.contentEditable='false'; td.classList.remove('gh-editable'); });
  document.querySelectorAll('tr[data-row-id]').forEach(tr => tr.classList.remove('gh-dirty'));
  _pendingRows={}; _pendingIters={};
  _refreshCount();
}

function _dirtyRow(id, tr)     { _pendingRows[id]=true; tr.classList.add('gh-dirty'); _refreshCount(); }
function _dirtyIter(key, name) { _pendingIters[key+'|'+name]=true; _refreshCount(); }

function _refreshCount() {
  const n = Object.keys(_pendingRows).length + Object.keys(_pendingIters).length;
  const bar = document.getElementById('gh-save-bar');
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  const cnt = document.getElementById('gh-change-count');
  if (cnt) cnt.textContent = n + ' unsaved change' + (n!==1?'s':'');
}

async function _saveAll() {
  _pendingRows={}; _pendingIters={};
  document.querySelectorAll('tr.gh-dirty').forEach(tr => tr.classList.remove('gh-dirty'));
  _refreshCount();
  await GitHubDB.save();
}

function _discard() { _editMode=true; _toggleEdit(); }

// ─── Banner ───────────────────────────────────────────────────────────────────

function _showBanner(msg, type) {
  const colors = {info:'#1e3a5f', success:'#166534', error:'#991b1b', warning:'#92400e'};
  const b = document.getElementById('gh-banner');
  if (!b) return;
  b.style.background = colors[type] || colors.info;
  b.style.display = 'block'; b.style.opacity = '1';
  b.textContent = msg;
}
function _hideBanner() {
  const b = document.getElementById('gh-banner');
  if (b) { b.style.opacity='0'; setTimeout(()=>b.style.display='none', 300); }
}

// ─── Live polling (30s) ───────────────────────────────────────────────────────

let _lastSha = null;

async function _getSha() {
  try {
    const res = await fetch(`${_apiUrl}?ref=${GH_CONFIG.branch}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return (await res.json()).sha || null;
  } catch { return null; }
}

async function _poll() {
  if (_editMode) return;
  const sha = await _getSha();
  if (sha && _lastSha && sha !== _lastSha) {
    _lastSha = sha;
    _showBanner('🔄 New data — refreshing…', 'info');
    await GitHubDB.load();
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function _init() {
  _injectUI();
  _lastSha = await _getSha();
  await GitHubDB.load();
  setInterval(_poll, 30_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}

const _origSave = GitHubDB.save.bind(GitHubDB);
GitHubDB.save = async function() {
  await _origSave();
  _lastSha = await _getSha();
};

window.GitHubDB = GitHubDB;
