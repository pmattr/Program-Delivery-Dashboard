const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const fetch   = (...a) => import('node-fetch').then(({default: f}) => f(...a));
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Config from env ─────────────────────────────────────────────────────────
const {
  GH_TOKEN,                          // GitHub PAT — set in Render dashboard
  GH_OWNER  = 'pmattr',
  GH_REPO   = 'Program-Delivery-Dashboard',
  GH_PATH   = 'data.json',
  GH_BRANCH = 'main',
  JWT_SECRET = 'change-me-in-production',
  PORT      = 3000,
} = process.env;

// Users: set USERS env var as JSON, e.g. [{"u":"patricia","p":"secret123"}]
const USERS = JSON.parse(process.env.USERS || '[{"u":"admin","p":"dashboard2026"}]');

const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
const GH_RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_PATH}`;

// ─── In-memory cache ─────────────────────────────────────────────────────────
let _cache    = null;
let _cacheSha = null;

async function ghRead() {
  const res = await fetch(`${GH_RAW}?_=${Date.now()}`);
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json();
}

async function ghGetSha() {
  const res = await fetch(`${GH_API}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) return null;
  return (await res.json()).sha || null;
}

async function ghWrite(data) {
  const sha = await ghGetSha();
  const body = {
    message: `Dashboard update ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    branch:  GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(GH_API, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub write failed (${res.status})`);
  }
  _cacheSha = (await res.json()).content?.sha || null;
}

// ─── SSE — live push to all connected clients ─────────────────────────────────
const _clients = new Set();

function _broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  _clients.forEach(res => { try { res.write(msg); } catch {} });
}

// Poll GitHub every 30s for external changes
setInterval(async () => {
  try {
    const sha = await ghGetSha();
    if (sha && _cacheSha && sha !== _cacheSha) {
      _cacheSha = sha;
      _cache    = await ghRead();
      _broadcast('data-changed', _cache);
    }
  } catch {}
}, 30_000);

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.u === username && u.p === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username });
});

// Get data (public)
app.get('/api/data', async (req, res) => {
  try {
    if (!_cache) {
      _cache    = await ghRead();
      _cacheSha = await ghGetSha();
    }
    res.json(_cache);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Save data (auth required)
app.put('/api/data', requireAuth, async (req, res) => {
  try {
    const data = req.body;
    await ghWrite(data);
    _cache = data;
    _broadcast('data-changed', data);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// SSE — live updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  _clients.add(res);
  req.on('close', () => _clients.delete(res));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
