// ─────────────────────────────────────────────────────────────────────────────
// SharePoint Connector — People Delivery Plan 2026
//
// Setup checklist (one-time):
//   1. Register an app in Azure AD (portal.azure.com → App registrations → New)
//      • Supported account types: "Single tenant"
//      • Redirect URIs (SPA): add BOTH of:
//          https://<your-tenant>.sharepoint.com/sites/<your-site>/SitePages/<your-page>.aspx
//          https://<your-github-username>.github.io/Program-Delivery-Dashboard/people_delivery_plan_2026.html
//      • API permissions: Microsoft Graph → Delegated → Sites.ReadWrite.All
//      • Grant admin consent
//   2. Note your Client ID and Tenant ID from the app overview page
//   3. In SharePoint, create four Lists (see LIST SCHEMAS below)
//   4. Fill in the CONFIG section below
//
// LIST SCHEMAS — create these in your SharePoint site:
//
//   List: "DeliveryRows"
//     • Title       (single line)   ← task title
//     • RowId       (number)        ← matches ROWS[].id
//     • Environment (choice: QA, Prod)
//     • Status      (choice: done, prog, plan)
//     • TargetDate  (single line)
//     • Owner       (single line)
//     • ADORef      (single line)
//     • Notes       (multiple lines)
//
//   List: "DeliveryGantt"
//     • Title       (single line)   ← task label
//     • RowId       (number)
//     • StartMonth  (number)
//     • EndMonth    (number)
//     • Status      (choice: done, prog, plan)
//
//   List: "DeliveryIterations"
//     • Title       (single line)   ← iterLabel e.g. "Jun 23, 2026 (current)"
//     • IterKey     (single line)   ← e.g. "jun23"
//     • Section     (single line)
//     • Name        (single line)
//     • Sub         (single line)
//     • Team        (single line)
//     • Owner       (single line)
//     • Health      (choice: Green, Amber, Red)
//     • StatusText  (single line)
//     • StateJSON   (multiple lines) ← JSON.stringify(state array)
//     • RisksJSON   (multiple lines)
//     • NextJSON    (multiple lines)
//     • ImpactJSON  (multiple lines)
//     • Link        (single line)
//
//   List: "DeliveryFiles"           ← for Excel/additional files
//     • Title       (single line)   ← file description
//     • FileURL     (single line)   ← SharePoint file URL
//     • Category    (single line)
//     • LastUpdated (date)
// ─────────────────────────────────────────────────────────────────────────────

const SP_CONFIG = {
  clientId:    '195dadf0-daa5-4059-8e98-82f54d880974',
  tenantId:    '62ccb864-6a1a-4b5d-8e1c-397dec1a8258',
  siteHostname:'trten.sharepoint.com',
  sitePath:    '/sites/WTR-HerTechQuestHackathon',
  rowsListName:    'DeliveryRows',
  ganttListName:   'DeliveryGantt',
  iterListName:    'DeliveryIterations',
  filesListName:   'DeliveryFiles',
};

const _msalApp = new msal.PublicClientApplication({
  auth: {
    clientId:    SP_CONFIG.clientId,
    authority:   `https://login.microsoftonline.com/${SP_CONFIG.tenantId}`,
    redirectUri: window.location.origin + window.location.pathname,
  },
  cache: { cacheLocation: 'sessionStorage' },
});

const _scopes = ['https://graph.microsoft.com/Sites.ReadWrite.All'];

async function _getToken() {
  const accounts = _msalApp.getAllAccounts();
  if (accounts.length) {
    try {
      const r = await _msalApp.acquireTokenSilent({ scopes: _scopes, account: accounts[0] });
      return r.accessToken;
    } catch (_) {}
  }
  const r = await _msalApp.acquireTokenPopup({ scopes: _scopes });
  return r.accessToken;
}

let _siteId = null;

async function _getSiteId(token) {
  if (_siteId) return _siteId;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SP_CONFIG.siteHostname}:${SP_CONFIG.sitePath}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  _siteId = data.id;
  return _siteId;
}

async function _getListItems(token, listName) {
  const siteId = await _getSiteId(token);
  const items = [];
  let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listName}/items?expand=fields&$top=999`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    items.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }
  return items.map(i => i.fields);
}

async function _upsertListItem(token, listName, fields, graphItemId) {
  const siteId = await _getSiteId(token);
  const base = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listName}/items`;
  const opts = {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  };
  if (graphItemId) return fetch(`${base}/${graphItemId}`, { ...opts, method: 'PATCH' });
  return fetch(base, { ...opts, method: 'POST' });
}

function _fieldsToRow(f) {
  return { id: f.RowId, e: f.Environment, t: f.Title, s: f.Status, d: f.TargetDate, o: f.Owner, a: f.ADORef || '', n: f.Notes || '' };
}
function _rowToFields(row) {
  return { RowId: row.id, Environment: row.e, Title: row.t, Status: row.s, TargetDate: row.d, Owner: row.o, ADORef: row.a, Notes: row.n };
}
function _fieldsToGantt(f) {
  return { id: f.RowId, l: f.Title, s: f.StartMonth, e: f.EndMonth, st: f.Status };
}
function _ganttToFields(g) {
  return { RowId: g.id, Title: g.l, StartMonth: g.s, EndMonth: g.e, Status: g.st };
}
function _fieldsToIter(f) {
  const safeParse = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  return {
    section: f.Section, name: f.Name, sub: f.Sub || '', team: f.Team, owner: f.Owner,
    health: f.Health, status: f.StatusText, iterLabel: f.Title,
    state: safeParse(f.StateJSON), risks: safeParse(f.RisksJSON),
    next: safeParse(f.NextJSON), impact: safeParse(f.ImpactJSON),
    link: f.Link || '', _iterKey: f.IterKey, _graphId: f.id,
  };
}
function _iterToFields(key, item) {
  return {
    Title: item.iterLabel, IterKey: key, Section: item.section, Name: item.name,
    Sub: item.sub || '', Team: item.team, Owner: item.owner, Health: item.health,
    StatusText: item.status,
    StateJSON: JSON.stringify(item.state || []), RisksJSON: JSON.stringify(item.risks || []),
    NextJSON: JSON.stringify(item.next || []), ImpactJSON: JSON.stringify(item.impact || []),
    Link: item.link || '',
  };
}

const SharePointDB = {
  async load() {
    _showBanner('Connecting to SharePoint…', 'info');
    try {
      await _msalApp.handleRedirectPromise();
      const token = await _getToken();
      _showBanner('Loading data from SharePoint…', 'info');
      const [rowFields, ganttFields, iterFields] = await Promise.all([
        _getListItems(token, SP_CONFIG.rowsListName),
        _getListItems(token, SP_CONFIG.ganttListName),
        _getListItems(token, SP_CONFIG.iterListName),
      ]);
      if (rowFields.length)  window.ROWS    = rowFields.map(_fieldsToRow).sort((a,b) => a.id - b.id);
      if (ganttFields.length) window.GANTT  = ganttFields.map(_fieldsToGantt).sort((a,b) => a.id - b.id);
      if (iterFields.length) {
        const iters = iterFields.map(_fieldsToIter);
        window.ALL_ITER = {};
        iters.forEach(it => { window.ALL_ITER[it._iterKey] = window.ALL_ITER[it._iterKey] || []; window.ALL_ITER[it._iterKey].push(it); });
      }
      _showBanner('Live data loaded from SharePoint', 'success');
      setTimeout(_hideBanner, 3000);
      if (typeof buildOv    === 'function') buildOv();
      if (typeof buildRm    === 'function') buildRm();
      if (typeof buildGantt === 'function') buildGantt();
    } catch (err) {
      console.error('[SharePointDB] load error:', err);
      _showBanner('SharePoint load failed — showing cached data. ' + (err.message || ''), 'error');
    }
  },
  async seedFromHardcodedData() {
    if (!confirm('Write all hardcoded dashboard data into SharePoint Lists. Run once only. Continue?')) return;
    const token = await _getToken();
    _showBanner('Seeding SharePoint Lists…', 'info');
    await Promise.all([
      ...window.ROWS.map(row  => _upsertListItem(token, SP_CONFIG.rowsListName,  _rowToFields(row))),
      ...window.GANTT.map(g   => _upsertListItem(token, SP_CONFIG.ganttListName, _ganttToFields(g))),
      ...Object.entries(window.ALL_ITER).flatMap(([key, items]) =>
        items.map(item => _upsertListItem(token, SP_CONFIG.iterListName, _iterToFields(key, item)))
      ),
    ]);
    _showBanner('Seed complete! Reload the page to pull from SharePoint.', 'success');
  },
};

function _showBanner(msg, type) {
  let b = document.getElementById('sp-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'sp-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 16px;font-size:13px;font-family:sans-serif;text-align:center;transition:opacity .3s';
    document.body.prepend(b);
  }
  const colors = { info:'#1e3a5f', success:'#166534', error:'#991b1b' };
  b.style.background = colors[type] || colors.info;
  b.style.color = '#fff';
  b.style.opacity = '1';
  b.textContent = msg;
}
function _hideBanner() {
  const b = document.getElementById('sp-banner');
  if (b) b.style.opacity = '0';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SharePointDB.load());
} else {
  SharePointDB.load();
}
window.SharePointDB = SharePointDB;
