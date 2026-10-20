// SnapTheJob public site + waiting list API
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), geolocation=()'
  });
  next();
});

// ---------- database ----------
async function initDb(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('customer','trade')),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        postcode TEXT,
        business TEXT,
        trade TEXT,
        town TEXT,
        job TEXT,
        gallery TEXT,
        source_page TEXT,
        consent BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        topic TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      console.log('Database ready');
      return;
    } catch (e) {
      console.log('Waiting for database…', e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Database not reachable');
}

// ---------- waiting list ----------
const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now(), hour = 3600e3;
  const list = (hits.get(ip) || []).filter(t => now - t < hour);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/waitlist', express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill this
  if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Please try again later.' });
  const row = {
    kind: b.kind === 'trade' ? 'trade' : 'customer',
    name: clean(b.name, 120),
    email: clean(b.email, 200).toLowerCase(),
    postcode: clean(b.postcode, 12).toUpperCase(),
    business: clean(b.business, 160),
    trade: clean(b.trade, 80),
    town: clean(b.town, 80),
    job: clean(b.job, 1000),
    gallery: clean(b.gallery, 20),
    source_page: clean(b.source, 200),
    consent: b.consent === true
  };
  if (!row.name || !EMAIL.test(row.email) || !row.consent) {
    return res.status(400).json({ ok: false, error: 'Please add your name, a valid email and tick the box.' });
  }
  if (row.kind === 'trade' && (!row.business || !row.trade)) {
    return res.status(400).json({ ok: false, error: 'Please add your business name and trade.' });
  }
  try {
    await pool.query(
      `INSERT INTO waitlist (kind,name,email,postcode,business,trade,town,job,gallery,source_page,consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.kind, row.name, row.email, row.postcode, row.business, row.trade, row.town, row.job, row.gallery, row.source_page, row.consent]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/contact', express.json({ limit: '20kb' }), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Please try again later.' });
  const name = clean(b.name, 120), email = clean(b.email, 200).toLowerCase(), topic = clean(b.topic, 80), message = clean(b.message, 4000);
  if (!name || !EMAIL.test(email) || message.length < 2) {
    return res.status(400).json({ ok: false, error: 'Please add your name, a valid email and a message.' });
  }
  try {
    await pool.query('INSERT INTO messages (name,email,topic,message) VALUES ($1,$2,$3,$4)', [name, email, topic, message]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// ---------- admin (owner only) ----------
function auth(req, res, next) {
  const [type, value] = (req.headers.authorization || '').split(' ');
  if (ADMIN_PASSWORD && type === 'Basic' && value) {
    const [u, ...p] = Buffer.from(value, 'base64').toString().split(':');
    if (u === ADMIN_USER && p.join(':') === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="SnapTheJob admin"').status(401).send('Sign in required');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.get('/admin', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 1000');
  const msgs = (await pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 500')).rows;
  const when = d => esc(new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const mtr = msgs.map(m => `<tr><td>${when(m.created_at)}</td><td>${esc(m.topic)}</td><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td style="white-space:pre-wrap">${esc(m.message)}</td></tr>`).join('');
  const count = k => rows.filter(r => r.kind === k).length;
  const tr = rows.map(r => `<tr><td>${esc(new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }))}</td><td>${r.kind === 'trade' ? '<b>Trade</b>' : 'Customer'}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.business)}</td><td>${esc(r.trade)}</td><td>${esc(r.town)}</td><td>${esc(r.postcode)}</td><td>${esc(r.gallery)}</td><td>${esc(r.job)}</td><td>${esc(r.source_page)}</td></tr>`).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waiting list · SnapTheJob</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff}h1{margin:0 0 4px}.k{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.k div{border:1px solid #D9381E;border-radius:12px;padding:10px 16px}.k b{font-size:24px;display:block}a.b{display:inline-block;background:#D9381E;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;font-weight:700}.w{overflow-x:auto;margin-top:14px}table{border-collapse:collapse;font-size:14px;min-width:900px}th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;vertical-align:top}th{background:#FDF1EE}</style></head>
<body><h1>Waiting list</h1><div class="k"><div><b>${rows.length}</b>Total</div><div><b>${count('trade')}</b>Trades</div><div><b>${count('customer')}</b>Customers</div><div><b>${msgs.length}</b>Messages</div></div>
<h2 style="margin:18px 0 0">Contact messages</h2>
<div class="w"><table><thead><tr><th>When</th><th>Topic</th><th>Name</th><th>Email</th><th>Message</th></tr></thead><tbody>${mtr || '<tr><td colspan="5">No messages yet.</td></tr>'}</tbody></table></div>
<h2 style="margin:24px 0 8px">Sign-ups</h2>
<a class="b" href="/admin/waitlist.csv">Download as CSV</a>
<div class="w"><table><thead><tr><th>When</th><th>Type</th><th>Name</th><th>Email</th><th>Business</th><th>Trade</th><th>Town</th><th>Postcode</th><th>Old jobs</th><th>Job / notes</th><th>From page</th></tr></thead><tbody>${tr || '<tr><td colspan="11">No sign-ups yet.</td></tr>'}</tbody></table></div></body></html>`);
});

app.get('/admin/waitlist.csv', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM waitlist ORDER BY created_at DESC');
  const cols = ['created_at', 'kind', 'name', 'email', 'business', 'trade', 'town', 'postcode', 'gallery', 'job', 'source_page', 'consent'];
  const q = v => {
    let s = v instanceof Date ? v.toISOString() : String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="snapthejob-waitlist.csv"', 'Cache-Control': 'no-store' }).send(csv);
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- static site ----------
app.use('/media', express.static(path.join(__dirname, 'public/media'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public/index.html')));

initDb().then(() => app.listen(PORT, () => console.log('SnapTheJob on port ' + PORT))).catch(e => { console.error(e); process.exit(1); });
