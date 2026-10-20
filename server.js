// SnapTheJob public site + waiting list API
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '';
const PUSH_ON = !!(VAPID_PUBLIC && process.env.VAPID_PRIVATE);
if (PUSH_ON) webpush.setVapidDetails('https://snapthejob.co.uk/contact', VAPID_PUBLIC, process.env.VAPID_PRIVATE);
const BACKUP_DIR = '/backups';

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
      await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS push_follows (
        endpoint TEXT NOT NULL,
        keys JSONB NOT NULL,
        target TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (endpoint, target)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS email_follows (
        email TEXT NOT NULL,
        target TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (email, target)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        type TEXT NOT NULL,
        path TEXT, job TEXT, detail TEXT, ref TEXT, device TEXT, visitor TEXT
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS events_ts ON events (ts)');
      await pool.query("DELETE FROM events WHERE ts < now() - interval '13 months'");
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

// ---------- follow (push notifications or email) ----------
const TARGET = /^[a-z0-9-]{1,60}$/;
app.get('/api/push-key', (req, res) => res.json({ key: PUSH_ON ? VAPID_PUBLIC : '' }));
app.post('/api/follow', express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Please try again later.' });
  const target = clean(b.target, 60);
  if (!TARGET.test(target)) return res.status(400).json({ ok: false, error: 'Unknown business.' });
  try {
    const sub = b.subscription;
    if (sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.keys && sub.keys.p256dh && sub.keys.auth) {
      await pool.query(`INSERT INTO push_follows (endpoint, keys, target) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [sub.endpoint.slice(0, 1000), JSON.stringify({ p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }), target]);
      return res.json({ ok: true, via: 'push' });
    }
    const email = clean(b.email, 200).toLowerCase();
    if (!EMAIL.test(email) || b.consent !== true) return res.status(400).json({ ok: false, error: 'Please add a valid email and tick the box.' });
    await pool.query(`INSERT INTO email_follows (email, target) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [email, target]);
    res.json({ ok: true, via: 'email' });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' }); }
});
app.post('/api/unfollow', express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body || {}, target = clean(b.target, 60);
  if (!TARGET.test(target) || typeof b.endpoint !== 'string') return res.status(400).json({ ok: false });
  await pool.query('DELETE FROM push_follows WHERE endpoint=$1 AND target=$2', [b.endpoint, target]).catch(() => {});
  res.json({ ok: true });
});
async function sendPush(target, payload) {
  if (!PUSH_ON) return { sent: 0, gone: 0, failed: 0 };
  const q = target === 'everyone'
    ? 'SELECT DISTINCT ON (endpoint) endpoint, keys FROM push_follows'
    : 'SELECT endpoint, keys FROM push_follows WHERE target=$1';
  const { rows } = await pool.query(q, target === 'everyone' ? [] : [target]);
  let sent = 0, gone = 0, failed = 0;
  await Promise.all(rows.map(async r => {
    try { await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, JSON.stringify(payload), { TTL: 86400 }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { gone++; await pool.query('DELETE FROM push_follows WHERE endpoint=$1', [r.endpoint]).catch(() => {}); }
      else failed++;
    }
  }));
  return { sent, gone, failed };
}

// ---------- admin (owner only) ----------
let adminHash = null; // set when the owner changes the password in /admin
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw) {
  if (adminHash) {
    const [salt, h] = adminHash.split(':');
    const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex')), b = Buffer.from(h);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return !!ADMIN_PASSWORD && pw === ADMIN_PASSWORD;
}
const fails = new Map();
function auth(req, res, next) {
  const [type, value] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && value) {
    const f = (fails.get(req.ip) || []).filter(t => Date.now() - t < 15 * 60e3);
    if (f.length >= 10) return res.status(429).send('Too many tries. Wait 15 minutes.');
    const [u, ...p] = Buffer.from(value, 'base64').toString().split(':');
    if (u === ADMIN_USER && checkPw(p.join(':'))) return next();
    f.push(Date.now()); fails.set(req.ip, f);
  }
  res.set('WWW-Authenticate', 'Basic realm="SnapTheJob admin"').status(401).send('Sign in required');
}
// stop other websites posting forms to the admin
function sameOrigin(req, res, next) {
  const o = req.get('origin');
  if (o && new URL(o).host !== req.get('host')) return res.status(403).send('Not allowed');
  next();
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const slugify = t => String(t).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
function listBackups() {
  try { return fs.readdirSync(BACKUP_DIR).filter(f => /^stj-[\d-]+\.sql\.gz$/.test(f)).sort().reverse(); } catch (e) { return []; }
}
app.get('/admin', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 1000');
  const msgs = (await pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 500')).rows;
  const pf = (await pool.query('SELECT target, count(*)::int n FROM push_follows GROUP BY target')).rows;
  const ef = (await pool.query('SELECT target, count(*)::int n FROM email_follows GROUP BY target')).rows;
  const people = (await pool.query('SELECT (SELECT count(DISTINCT endpoint) FROM push_follows)::int p, (SELECT count(DISTINCT email) FROM email_follows)::int e')).rows[0];
  const targets = [...new Set(['snapthejob', ...JOBS.map(j => slugify(j.biz)), ...pf.map(r => r.target), ...ef.map(r => r.target)])];
  const nameOf = t => t === 'snapthejob' ? 'SnapTheJob (everything)' : (JOBS.find(j => slugify(j.biz) === t) || {}).biz || t;
  const ftr = targets.map(t => `<tr><td>${esc(nameOf(t))}</td><td>${(pf.find(r => r.target === t) || { n: 0 }).n}</td><td>${(ef.find(r => r.target === t) || { n: 0 }).n}</td></tr>`).join('');
  const backups = listBackups();
  const days = (await pool.query(`SELECT to_char(d, 'YYYY-MM-DD') day,
      (SELECT count(DISTINCT visitor) FROM events WHERE ts::date = d)::int visitors,
      (SELECT count(*) FROM events WHERE ts::date = d AND type='view')::int views,
      (SELECT count(*) FROM events WHERE ts::date = d AND type='play')::int plays,
      (SELECT count(*) FROM events WHERE ts::date = d AND type IN ('share','share_app'))::int shares,
      (SELECT count(*) FROM events WHERE ts::date = d AND type='quote')::int quotes,
      (SELECT count(*) FROM events WHERE ts::date = d AND type='follow')::int follows,
      (SELECT count(*) FROM waitlist WHERE created_at::date = d)::int signups
    FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d DESC`)).rows;
  const topJobs = (await pool.query("SELECT job, count(*)::int n FROM events WHERE type='play' AND ts > now() - interval '30 days' AND job <> '' GROUP BY job ORDER BY n DESC LIMIT 10")).rows;
  const topRefs = (await pool.query("SELECT ref, count(DISTINCT visitor)::int n FROM events WHERE type='view' AND ref <> '' AND ts > now() - interval '30 days' GROUP BY ref ORDER BY n DESC LIMIT 10")).rows;
  const shareApps = (await pool.query("SELECT detail, count(*)::int n FROM events WHERE type='share_app' AND ts > now() - interval '30 days' GROUP BY detail ORDER BY n DESC")).rows;
  const devices = (await pool.query("SELECT device, count(DISTINCT visitor)::int n FROM events WHERE type='view' AND ts > now() - interval '30 days' GROUP BY device ORDER BY n DESC")).rows;
  const sum = k => days.reduce((a, d) => a + d[k], 0);
  const maxV = Math.max(1, ...days.map(d => d.visitors));
  const bars = days.slice().reverse().map((d, i) => `<rect x="${i * 20 + 2}" y="${100 - Math.round(d.visitors / maxV * 90)}" width="16" height="${Math.round(d.visitors / maxV * 90)}" fill="#D9381E"><title>${d.day}: ${d.visitors} visitors</title></rect>`).join('');
  const jobName = slug => (JOBS.find(j => j.slug === slug) || {}).title || slug;
  const mini = (rows, label, key) => `<table style="min-width:0"><thead><tr><th>${label}</th><th>30 days</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(key(r))}</td><td>${r.n}</td></tr>`).join('') || '<tr><td colspan="2">Nothing yet</td></tr>'}</tbody></table>`;
  const statsHtml = `<h2>Visitors (last 30 days)</h2>
<div class="k"><div><b>${sum('visitors')}</b>Visitors*</div><div><b>${sum('views')}</b>Page views</div><div><b>${sum('plays')}</b>Videos watched</div><div><b>${sum('shares')}</b>Shares</div><div><b>${sum('quotes')}</b>Quote clicks</div><div><b>${sum('follows')}</b>New follows</div></div>
<svg viewBox="0 0 600 104" width="100%" style="max-width:600px;display:block;border-bottom:1px solid #ddd" role="img" aria-label="Visitors per day, last 30 days">${bars}</svg>
<p class="n">Bars: visitors per day, oldest on the left. *A visitor is counted once per day; no cookies are used.</p>
<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
${mini(topJobs, 'Most watched', r => jobName(r.job))}
${mini(topRefs, 'Came from', r => r.ref)}
${mini(shareApps, 'Shared to', r => r.detail)}
${mini(devices, 'Device', r => r.device)}
</div>
<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Day by day</summary><div class="w"><table><thead><tr><th>Day</th><th>Visitors</th><th>Page views</th><th>Watched</th><th>Shares</th><th>Quote clicks</th><th>Follows</th><th>Sign-ups</th></tr></thead><tbody>${days.map(d => `<tr><td>${d.day}</td><td>${d.visitors}</td><td>${d.views}</td><td>${d.plays}</td><td>${d.shares}</td><td>${d.quotes}</td><td>${d.follows}</td><td>${d.signups}</td></tr>`).join('')}</tbody></table></div></details>`;
  const flash = { sent: 'Notification sent.', pw: 'Password changed. Use the new one next time you sign in.', pwbad: 'Password not changed: current password wrong, or new ones did not match / too short (min 12 characters).' }[req.query.m] || '';
  const sentInfo = req.query.m === 'sent' ? ` (${esc(req.query.n || 0)} phones)` : '';
  const when = d => esc(new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const mtr = msgs.map(m => `<tr><td>${when(m.created_at)}</td><td>${esc(m.topic)}</td><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td style="white-space:pre-wrap">${esc(m.message)}</td></tr>`).join('');
  const count = k => rows.filter(r => r.kind === k).length;
  const tr = rows.map(r => `<tr><td>${when(r.created_at)}</td><td>${r.kind === 'trade' ? '<b>Trade</b>' : 'Customer'}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.business)}</td><td>${esc(r.trade)}</td><td>${esc(r.town)}</td><td>${esc(r.postcode)}</td><td>${esc(r.gallery)}</td><td>${esc(r.job)}</td><td>${esc(r.source_page)}</td></tr>`).join('');
  const opts = ['everyone', ...targets].map(t => `<option value="${esc(t)}">${t === 'everyone' ? 'Everyone who allowed alerts' : esc(nameOf(t)) + ' followers'}</option>`).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · SnapTheJob</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff;max-width:1200px}h1{margin:0 0 4px}h2{margin:28px 0 8px}.k{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.k div{border:1px solid #D9381E;border-radius:12px;padding:10px 16px}.k b{font-size:24px;display:block}a.b,button{display:inline-block;background:#D9381E;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;font-weight:700;border:none;font:inherit;font-weight:700;cursor:pointer}.w{overflow-x:auto;margin-top:10px}table{border-collapse:collapse;font-size:14px;min-width:600px}th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;vertical-align:top}th{background:#FDF1EE}form.card{border:1px solid #F0B8AE;border-radius:14px;padding:14px;display:grid;gap:10px;max-width:560px}label{display:grid;gap:4px;font-weight:600;font-size:14px}input,select,textarea{font:inherit;padding:10px;border:1px solid #C9CBC5;border-radius:10px}.flash{background:#FDF1EE;border:1px solid #D9381E;border-radius:12px;padding:10px 14px;font-weight:600}.n{color:#5E6168;font-size:14px}</style></head>
<body><h1>SnapTheJob admin</h1>
${flash ? `<p class="flash">${esc(flash)}${sentInfo}</p>` : ''}
<div class="k"><div><b>${rows.length}</b>Waiting list</div><div><b>${count('trade')}</b>Trades</div><div><b>${count('customer')}</b>Customers</div><div><b>${msgs.length}</b>Messages</div><div><b>${people.p}</b>Phones with alerts on</div><div><b>${people.e}</b>Email followers</div></div>

${statsHtml}

<h2>Contact messages</h2>
<div class="w"><table><thead><tr><th>When</th><th>Topic</th><th>Name</th><th>Email</th><th>Message</th></tr></thead><tbody>${mtr || '<tr><td colspan="5">No messages yet.</td></tr>'}</tbody></table></div>

<h2>Followers</h2>
<div class="w"><table><thead><tr><th>Following</th><th>Phone alerts</th><th>Email</th></tr></thead><tbody>${ftr}</tbody></table></div>

<h2>Send a phone notification</h2>
<form class="card" method="post" action="/admin/notify">
<label>Send to<select name="target">${opts}</select></label>
<label>Title<input name="title" maxlength="60" required placeholder="New job from PS Plastering"></label>
<label>Message<input name="body" maxlength="140" required placeholder="Full room re-plaster: watch the before and after"></label>
<label>Opens this page when tapped<input name="url" value="/" maxlength="200"></label>
<button type="submit">Send notification</button>
<span class="n">Only reaches people who allowed alerts. Email followers get the weekly round-up once email sending is set up.</span>
</form>

<h2>Sign-ups</h2>
<a class="b" href="/admin/waitlist.csv">Download as CSV</a>
<div class="w"><table style="min-width:900px"><thead><tr><th>When</th><th>Type</th><th>Name</th><th>Email</th><th>Business</th><th>Trade</th><th>Town</th><th>Postcode</th><th>Old jobs</th><th>Job / notes</th><th>From page</th></tr></thead><tbody>${tr || '<tr><td colspan="11">No sign-ups yet.</td></tr>'}</tbody></table></div>

<h2>Backups</h2>
<p class="n">A full copy of the database is made every night and kept for 14 days. Download one now and then to keep a copy off the server.</p>
<ul>${backups.map(f => `<li><a href="/admin/backup/${esc(f)}">${esc(f)}</a></li>`).join('') || '<li>The first backup appears after tonight.</li>'}</ul>

<h2>Change admin password</h2>
<form class="card" method="post" action="/admin/password">
<input type="hidden" name="username" value="admin" autocomplete="username">
<label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
<label>New password (at least 12 characters)<input name="next" type="password" autocomplete="new-password" minlength="12" required></label>
<label>New password again<input name="again" type="password" autocomplete="new-password" minlength="12" required></label>
<button type="submit">Change password</button>
</form>
</body></html>`);
});
const form = express.urlencoded({ extended: false, limit: '10kb' });
app.post('/admin/notify', auth, sameOrigin, form, async (req, res) => {
  const target = clean(req.body.target, 60);
  if (target !== 'everyone' && !TARGET.test(target)) return res.redirect(303, '/admin');
  let url = clean(req.body.url, 200) || '/';
  if (!url.startsWith('/')) url = '/';
  const r = await sendPush(target, { title: clean(req.body.title, 60), body: clean(req.body.body, 140), url });
  res.redirect(303, '/admin?m=sent&n=' + r.sent);
});
app.post('/admin/password', auth, sameOrigin, form, async (req, res) => {
  const { current = '', next = '', again = '' } = req.body;
  if (!checkPw(current) || next.length < 12 || next !== again) return res.redirect(303, '/admin?m=pwbad');
  adminHash = hashPw(next);
  await pool.query(`INSERT INTO settings (key, value) VALUES ('admin_hash', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [adminHash]);
  res.redirect(303, '/admin?m=pw');
});
app.get('/admin/backup/:file', auth, (req, res) => {
  const f = req.params.file;
  if (!listBackups().includes(f)) return res.status(404).send('Not found');
  res.download(path.join(BACKUP_DIR, f));
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

// ---------- private visitor stats (no cookies; visitors counted with a daily-changing anonymous code) ----------
const EV_TYPES = new Set(['view', 'play', 'share', 'share_app', 'quote', 'follow', 'trade']);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget/i;
let saltDay = '', salt = '';
function visitorCode(req) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== saltDay) { saltDay = day; salt = crypto.randomBytes(16).toString('hex'); }
  return crypto.createHash('sha256').update(salt + req.ip + (req.get('user-agent') || '')).digest('hex').slice(0, 16);
}
app.post('/api/e', express.text({ type: '*/*', limit: '2kb' }), (req, res) => {
  res.status(204).end();
  const ua = req.get('user-agent') || '';
  if (BOT.test(ua)) return;
  let b; try { b = JSON.parse(req.body || '{}'); } catch (e) { return; }
  if (!EV_TYPES.has(b.t)) return;
  let ref = clean(b.r, 300);
  try { ref = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch (e) { ref = ''; }
  if (ref === 'snapthejob.co.uk') ref = '';
  const device = /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Computer';
  pool.query('INSERT INTO events (type,path,job,detail,ref,device,visitor) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [b.t, clean(b.p, 200), clean(b.j, 80), clean(b.d, 80), ref, device, visitorCode(req)]).catch(() => {});
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- jobs, trades and search-engine pages ----------
const JOBS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/jobs.json'), 'utf8'));
const TRADES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/trades.json'), 'utf8'));
const tradeSlug = t => slugify(t);
const ORIGIN = 'https://snapthejob.co.uk';
const jobsJs = 'window.STJ_JOBS = ' + JSON.stringify(JOBS) + ';';
app.get('/assets/jobs.js', (req, res) => res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=60' }).send(jobsJs));

const tpl = { index: fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8'), job: fs.readFileSync(path.join(__dirname, 'public/job.html'), 'utf8') };
const tradeLinks = '<nav class="tradelinks" aria-label="All trades"><b>Browse trades:</b> ' +
  TRADES.map(t => `<a href="/trades/${tradeSlug(t)}">${esc(t)}</a>`).join(' · ') + '</nav>';
function page(html, { title, desc, url, image, extra = '' }) {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ORIGIN}${image || '/media/ps-plastering.jpg'}">
<meta property="og:url" content="${ORIGIN}${url}">
<meta property="og:site_name" content="SnapTheJob">
<link rel="canonical" href="${ORIGIN}${url}">
<meta name="twitter:card" content="summary_large_image">${extra}`)
    .replace('<!--TRADE_LINKS-->', tradeLinks);
}
const ld = o => `\n<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const isoDur = d => { const [m, s] = d.split(':').map(Number); return `PT${m ? m + 'M' : ''}${s}S`; };

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'public, max-age=60').send(page(tpl.index, {
    title: 'SnapTheJob · Before and after videos from UK trades',
    desc: 'Watch real before and after videos of jobs by local plumbers, builders, plasterers, roofers, waste removal and more. Then get a quote.',
    url: '/',
    extra: ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'SnapTheJob', url: ORIGIN + '/', potentialAction: { '@type': 'SearchAction', target: ORIGIN + '/?q={search_term_string}', 'query-input': 'required name=search_term_string' } })
  }));
});
app.get('/trades/:t', (req, res, next) => {
  const t = TRADES.find(x => tradeSlug(x) === req.params.t);
  if (!t) return next();
  const n = JOBS.filter(j => j.trade === t).length;
  res.set('Cache-Control', 'public, max-age=60').send(page(tpl.index, {
    title: `${t} before and after videos · SnapTheJob`,
    desc: n ? `Watch before and after videos of real ${t.toLowerCase()} jobs by local trades, then get a quote.` : `Before and after videos of ${t.toLowerCase()} jobs are coming soon to SnapTheJob. Trades: be the first to post yours.`,
    url: `/trades/${tradeSlug(t)}`
  }));
});
app.get(['/job', '/job.html'], (req, res) => {
  const j = JOBS.find(x => x.slug === req.query.j);
  res.redirect(301, j ? `/job/${j.slug}` : '/');
});
app.get('/job/:slug', (req, res, next) => {
  const j = JOBS.find(x => x.slug === req.params.slug);
  if (!j) return next();
  const title = `${j.title} by ${j.biz} · SnapTheJob`;
  const desc = j.description || `Before and after video by ${j.biz}, ${j.trade}. Watch it on SnapTheJob.`;
  res.set('Cache-Control', 'public, max-age=60').send(page(tpl.job, {
    title, desc, url: `/job/${j.slug}`, image: j.cover,
    extra: `\n<meta property="og:type" content="video.other">\n<meta property="og:video" content="${ORIGIN}${j.video}">` + ld({
      '@context': 'https://schema.org', '@type': 'VideoObject',
      name: `${j.title} by ${j.biz}`, description: desc,
      thumbnailUrl: [ORIGIN + j.cover], uploadDate: j.date, duration: isoDur(j.dur),
      contentUrl: ORIGIN + (j.playVideo || j.video), embedUrl: `${ORIGIN}/job/${j.slug}`,
      publisher: { '@type': 'Organization', name: 'SnapTheJob', logo: { '@type': 'ImageObject', url: ORIGIN + '/assets/icon-512.png' } }
    })
  }));
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /signature\n\nSitemap: ${ORIGIN}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', ...TRADES.map(t => `/trades/${tradeSlug(t)}`), ...JOBS.map(j => `/job/${j.slug}`), '/contact', '/privacy'];
  const vid = j => `<video:video><video:thumbnail_loc>${ORIGIN}${j.cover}</video:thumbnail_loc><video:title>${esc(j.title + ' by ' + j.biz)}</video:title><video:description>${esc(j.description || j.title)}</video:description><video:content_loc>${ORIGIN}${j.playVideo || j.video}</video:content_loc><video:publication_date>${j.date}</video:publication_date></video:video>`;
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n` +
    urls.map(u => { const j = JOBS.find(x => u === `/job/${x.slug}`); return `<url><loc>${ORIGIN}${u}</loc>${j ? vid(j) : ''}</url>`; }).join('\n') + '\n</urlset>\n');
});

// ---------- static site ----------
app.use('/media', express.static(path.join(__dirname, 'public/media'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1m' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public/index.html')));

initDb().then(async () => {
  const r = await pool.query("SELECT value FROM settings WHERE key='admin_hash'");
  if (r.rows[0]) adminHash = r.rows[0].value;
}).then(() => app.listen(PORT, () => console.log('SnapTheJob on port ' + PORT))).catch(e => { console.error(e); process.exit(1); });
