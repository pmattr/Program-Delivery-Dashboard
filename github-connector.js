// ─────────────────────────────────────────────────────────────────────────────
// GitHub JSON Connector — People Delivery Plan 2026
//
// Setup (2 steps):
//   1. Upload data.json to your GitHub repo (same folder as the HTML)
//   2. Create a GitHub Personal Access Token:
//        github.com → Settings → Developer settings → Personal access tokens
//        → Tokens (classic) → Generate new token
//        → Scopes: check "repo"
//        → Copy the token (starts with ghp_...)
//      Paste it when prompted on first load, or hardcode it in GH_CONFIG below.
//
// How it works:
//   • READ  — fetches raw data.json from GitHub (no auth, works on public repos)
//   • WRITE — uses GitHub Contents API with your PAT to commit updated data.json
// ─────────────────────────────────────────────────────────────────────────────

const GH_CONFIG = {
  owner: 'pmattr',
  repo:  'pmdashboard',
  path:  'data.json',
  branch: 'main',
  token: '',   // leave blank to be prompted, or paste your ghp_... token here
};

// ─── Token handling ───────────────────────────────────────────────────────────

function _getToken() {
  if (GH_CONFIG.token) return GH_CONFIG.token;
  let t = sessionStorage.getItem('gh_pat');
  if (!t) {
    t = prompt('Enter your GitHub Personal Access Token (ghp_...):\n\nGet one at: github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)\nRequired scope: repo');
    if (!t) throw new Error('No token provided — read-only mode');
    sessionStorage.setItem('gh_pat', t.trim());
  }
  return t.trim();
}

function _clearToken() {
  sessionStorage.removeItem('gh_pat');
  GH_CONFIG.token = '';
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

const _apiBase = `https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.path}`;

async function _readFile() {
  // Use raw URL — no auth needed for public repos, much faster
  const url = `https://raw.githubusercontent.com/${GH_CONFIG.owner}/${GH_CONFIG.repo}/${GH_CONFIG.branch}/${GH_CONFIG.path}?_=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read data.json (${res.status})`);
  return res.json();
}

async function _writeFile(data) {
  const token = _getToken();

  // First get the current file SHA (required by GitHub API to update a file)
  const metaRes = await fetch(`${_apiBase}?ref=${GH_CONFIG.branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!metaRes.ok) {
    if (metaRes.status === 401) { _clearToken(); throw new Error('Invalid token — please reload and try again'); }
    throw new Error(`GitHub API error (${metaRes.status})`);
  }
  const meta = await metaRes.json();

  // Commit the updated JSON
  const body = {
    message: `Dashboard update ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    sha: meta.sha,
    branch: GH_CONFIG.branch,
  };

  const putRes = await fetch(_apiBase, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `Write failed (${putRes.status})`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const GitHubDB = {

  _data: null,  // in-memory cache of the full data.json

  // Load data from GitHub and update the dashboard globals
  async load() {
    _showBanner('Loading data from GitHub…', 'info');
    try {
      const data = await _readFile();
      GitHubDB._data = data;

      if (data.rows       && data.rows.length)       window.ROWS     = data.rows;
      if (data.gantt      && data.gantt.length)       window.GANTT    = data.gantt;
      if (data.iterations && Object.keys(data.iterations).length) window.ALL_ITER = data.iterations;

      _showBanner('Data loaded from GitHub', 'success');
      setTimeout(_hideBanner, 2500);

      if (typeof buildOv    === 'function') buildOv();
      if (typeof buildRm    === 'function') buildRm();
      if (typeof buildGantt === 'function') buildGantt();

    } catch (err) {
      console.error('[GitHubDB] load error:', err);
      _showBanner('GitHub load failed — using built-in data. ' + err.message, 'warning');
      setTimeout(_hideBanner, 5000);
    }
  },

  // Save everything back to GitHub as one commit
  async save() {
    _showBanner('Saving to GitHub…', 'info');
    try {
      const payload = {
        rows:       window.ROWS  || [],
        gantt:      window.GANTT || [],
        iterations: window.ALL_ITER || {},
      };
      await _writeFile(payload);
      GitHubDB._data = payload;
      _showBanner('Saved to GitHub', 'success');
      setTimeout(_hideBanner, 2500);
    } catch (err) {
      console.error('[GitHubDB] save error:', err);
      _showBanner('Save failed: ' + err.message, 'error');
    }
  },

  // Change the PAT (e.g. if it expired)
  resetToken() {
    _clearToken();
    _showBanner('Token cleared — you will be prompted on next save', 'info');
    setTimeout(_hideBanner, 3000);
  },
};

// ─── Edit mode ────────────────────────────────────────────────────────────────

let _editMode = false;
let _pendingRows  = {};
let _pendingIters = {};

const _STATUS_OPTS  = [{v:'done',l:'Done'},{v:'prog',l:'In Progress'},{v:'plan',l:'Planned'}];
const _HEALTH_OPTS  = ['Green','Amber','Red'];
const _ITER_STATUS  = ['Not Started','In Progress','Complete','On Hold','Blocked'];

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
    .gh-card-dirty{border-color:#f59e0b!important;background:#fffbeb!important}
    #gh-banner{position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 16px;font-size:13px;font-family:sans-serif;text-align:center;color:#fff;display:none;transition:opacity .3s}
  `;
  document.head.appendChild(s);
}

function _injectUI() {
  _injectStyles();

  const btn = document.createElement('button');
  btn.id = 'gh-edit-btn';
  btn.className = 'off';
  btn.textContent = '✎ Edit';
  btn.onclick = _toggleEdit;
  document.body.appendChild(btn);

  const bar = document.createElement('div');
  bar.id = 'gh-save-bar';
  bar.innerHTML = `<span id="gh-change-count">0 changes</span><button class="discard" id="gh-discard">Discard</button><button class="save" id="gh-save">Save to GitHub</button>`;
  document.body.appendChild(bar);

  const banner = document.createElement('div');
  banner.id = 'gh-banner';
  document.body.appendChild(banner);

  document.getElementById('gh-save').onclick    = _saveAll;
  document.getElementById('gh-discard').onclick = _discard;
}

function _toggleEdit() {
  _editMode = !_editMode;
  const btn = document.getElementById('gh-edit-btn');
  btn.className = _editMode ? 'on' : 'off';
  btn.textContent = _editMode ? '✎ Editing' : '✎ Edit';
  _editMode ? _activateEdit() : _deactivateEdit();
}

function _activateEdit() {
  // Stamp data-row-id and data-col onto table rows
  document.querySelectorAll('table tbody tr').forEach(tr => {
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
        const sel = document.createElement('select');
        sel.className = 'gh-select';
        _STATUS_OPTS.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.v; opt.textContent = o.l;
          if (o.v === row.s) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.onchange = () => { row.s = sel.value; _dirtyRow(id, tr); };
        td.innerHTML = ''; td.appendChild(sel);
      }
      if (col === 'owner' || col === 'date' || col === 'notes') {
        td.contentEditable = 'true';
        td.classList.add('gh-editable');
        td.oninput = () => {
          if (col === 'owner') row.o = td.textContent.trim();
          if (col === 'date')  row.d = td.textContent.trim();
          if (col === 'notes') row.n = td.textContent.trim();
          _dirtyRow(id, tr);
        };
      }
    });
  });

  // Iteration health + status
  document.querySelectorAll('[data-col][data-iter-key]').forEach(el => {
    const key  = el.dataset.iterKey;
    const name = el.dataset.iterName;
    const col  = el.dataset.col;
    const item = ((window.ALL_ITER || {})[key] || []).find(i => i.name === name);
    if (!item) return;

    if (col === 'health') {
      el.style.cursor = 'pointer';
      el.title = 'Click to cycle health';
      el.onclick = () => {
        const next = _HEALTH_OPTS[(_HEALTH_OPTS.indexOf(item.health) + 1) % _HEALTH_OPTS.length];
        item.health = next;
        el.textContent = next;
        el.className = el.className.replace(/health-\w+/, 'health-' + next);
        _dirtyIter(key, name);
      };
    }
    if (col === 'status') {
      const sel = document.createElement('select');
      sel.className = 'gh-select';
      _ITER_STATUS.forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        if (v === item.status) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => { item.status = sel.value; _dirtyIter(key, name); };
      el.replaceWith(sel);
      Object.assign(sel.dataset, {col, iterKey: key, iterName: name});
    }
  });
}

function _deactivateEdit() {
  document.querySelectorAll('.gh-editable').forEach(td => {
    td.contentEditable = 'false';
    td.classList.remove('gh-editable');
  });
  document.querySelectorAll('tr[data-row-id]').forEach(tr => tr.classList.remove('gh-dirty'));
  _pendingRows = {}; _pendingIters = {};
  _refreshCount();
}

function _dirtyRow(id, tr) {
  _pendingRows[id] = true;
  tr.classList.add('gh-dirty');
  _refreshCount();
}

function _dirtyIter(key, name) {
  _pendingIters[key + '|' + name] = true;
  _refreshCount();
}

function _refreshCount() {
  const n = Object.keys(_pendingRows).length + Object.keys(_pendingIters).length;
  const bar = document.getElementById('gh-save-bar');
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  const cnt = document.getElementById('gh-change-count');
  if (cnt) cnt.textContent = n + ' unsaved change' + (n !== 1 ? 's' : '');
}

async function _saveAll() {
  _pendingRows = {}; _pendingIters = {};
  document.querySelectorAll('tr.gh-dirty').forEach(tr => tr.classList.remove('gh-dirty'));
  _refreshCount();
  await GitHubDB.save();
}

function _discard() {
  _editMode = true;
  _toggleEdit();
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function _showBanner(msg, type) {
  const colors = {info:'#1e3a5f', success:'#166534', error:'#991b1b', warning:'#92400e'};
  const b = document.getElementById('gh-banner');
  if (!b) return;
  b.style.background = colors[type] || colors.info;
  b.style.display = 'block';
  b.style.opacity = '1';
  b.textContent = msg;
}

function _hideBanner() {
  const b = document.getElementById('gh-banner');
  if (b) { b.style.opacity = '0'; setTimeout(() => b.style.display = 'none', 300); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function _init() {
  _injectUI();
  await GitHubDB.load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}

window.GitHubDB = GitHubDB;
