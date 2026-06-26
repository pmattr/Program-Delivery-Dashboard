// ─────────────────────────────────────────────────────────────────────────────
// API Connector — talks to the Express backend (server.js)
// Replaces github-connector.js once deployed to Render.
// Set API_BASE to your Render app URL, e.g. https://your-app.onrender.com
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = window.location.origin; // works locally and on Render

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _token = sessionStorage.getItem('api_token') || null;
let _currentUser = sessionStorage.getItem('api_user') || null;

function _getToken() { return _token; }

function _clearToken() {
  _token = null; _currentUser = null;
  sessionStorage.removeItem('api_token');
  sessionStorage.removeItem('api_user');
}

async function _login() {
  const username = prompt('Username:');
  if (!username) throw new Error('No username');
  const password = prompt('Password:');
  if (!password) throw new Error('No password');

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Login failed');
  }
  const data = await res.json();
  _token = data.token;
  _currentUser = data.username;
  sessionStorage.setItem('api_token', _token);
  sessionStorage.setItem('api_user', _currentUser);
  return _token;
}

async function _ensureToken() {
  if (_token) return _token;
  return _login();
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function _readData() {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  return res.json();
}

async function _writeData(data) {
  const token = await _ensureToken();
  const res = await fetch(`${API_BASE}/api/data`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(data),
  });
  if (res.status === 401) { _clearToken(); throw new Error('Session expired — please save again to log in'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Save failed (${res.status})`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DashboardDB = {
  _data: null,

  async load() {
    _showBanner('Loading data…', 'info');
    try {
      const data = await _readData();
      DashboardDB._data = data;
      _applyData(data);
      _showBanner('Data loaded', 'success');
      setTimeout(_hideBanner, 2500);
    } catch (err) {
      console.error('[DashboardDB] load error:', err);
      _showBanner('Load failed — using built-in data. ' + err.message, 'warning');
      setTimeout(_hideBanner, 5000);
    }
  },

  async save() {
    _showBanner('Saving…', 'info');
    try {
      const payload = {
        rows:       window.ROWS     || [],
        gantt:      window.GANTT    || [],
        iterations: window.ALL_ITER || {},
      };
      await _writeData(payload);
      DashboardDB._data = payload;
      _showBanner('✓ Saved', 'success');
      setTimeout(_hideBanner, 2500);
    } catch (err) {
      console.error('[DashboardDB] save error:', err);
      _showBanner('Save failed: ' + err.message, 'error');
    }
  },

  logout() {
    _clearToken();
    _showBanner('Logged out', 'info');
    setTimeout(_hideBanner, 2500);
  },
};

function _applyData(data) {
  if (data.rows       && data.rows.length)                       window.ROWS     = data.rows;
  if (data.gantt      && data.gantt.length)                      window.GANTT    = data.gantt;
  if (data.iterations && Object.keys(data.iterations).length)    window.ALL_ITER = data.iterations;
  if (typeof buildOv          === 'function') buildOv();
  if (typeof buildRm          === 'function') buildRm();
  if (typeof buildGantt       === 'function') buildGantt();
  if (typeof renderRoadmap    === 'function') renderRoadmap();
  if (typeof renderIterations === 'function') renderIterations();
}

// ─── SSE — live updates from server ──────────────────────────────────────────

function _connectSSE() {
  const es = new EventSource(`${API_BASE}/api/events`);
  es.addEventListener('data-changed', e => {
    const data = JSON.parse(e.data);
    DashboardDB._data = data;
    _showBanner('🔄 New data — refreshing…', 'info');
    _applyData(data);
    setTimeout(_hideBanner, 2500);
  });
  es.onerror = () => setTimeout(_connectSSE, 5000); // reconnect on drop
}

// ─── Edit mode (same as github-connector) ────────────────────────────────────

let _editMode = false;
let _pendingRows  = {};
let _pendingIters = {};

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
    #gh-save-bar .discard{background:#f3f4f6;color:#374151;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600}
    #gh-change-count{color:#92400e;font-weight:600}
    .gh-editable{background:#fffbeb!important;outline:1px solid #f59e0b;border-radius:3px;padding:2px 4px!important}
    .gh-editable:focus{outline:2px solid #f97316}
    .gh-select{border:1px solid #d1d5db;border-radius:4px;padding:2px 6px;font-size:12px;background:#fffbeb}
    tr.gh-dirty td{background:#fffbeb!important}
    #gh-banner{position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 16px;font-size:13px;font-family:sans-serif;text-align:center;color:#fff;display:none;transition:opacity .3s}
    #gh-user-chip{position:fixed;bottom:24px;left:24px;z-index:9000;background:#1e3a5f;color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;display:none}
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
  document.body.appendChild(chip);

  document.getElementById('gh-save').onclick    = _saveAll;
  document.getElementById('gh-discard').onclick = _discard;
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
  await DashboardDB.save();
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

// ─── Init ─────────────────────────────────────────────────────────────────────

async function _init() {
  _injectUI();
  await DashboardDB.load();
  _connectSSE();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}

window.DashboardDB = DashboardDB;
