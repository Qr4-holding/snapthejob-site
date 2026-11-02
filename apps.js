// Connected apps: a client's own app (Snap Lite) publishes to this hub, server to server, with a key that belongs to that app.
// The owner adds an app at /admin/apps and gets its key once. The client accepts the carrier terms in their own app, which makes and
// links their carrier account under their own details; they need no separate hub login. They choose each video; nothing is automatic.
// While HUB_OPEN is off a client can link, but publishing is refused.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const multer = require('multer');

const MEDIA_DIR = process.env.MEDIA_DIR || '/data/media';
const TMP_DIR = path.join(MEDIA_DIR, 'tmp');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sha = k => crypto.createHash('sha256').update(k).digest('hex');
const initialsOf = n => (String(n).match(/[A-Za-z0-9]+/g) || ['C', 'U']).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// the wording lives in legal/carrier-terms.md, first line "Version: N". A new version means every client accepts again before publishing.
function loadTerms() {
  const raw = fs.readFileSync(path.join(__dirname, 'legal', 'carrier-terms.md'), 'utf8'), m = raw.match(/^\s*Version:\s*(\d+)\s*\n/i);
  const text = m ? raw.slice(m[0].length) : raw;
  return { version: m ? +m[1] : 1, title: (text.match(/^#\s+(.*)/m) || [])[1] || 'Carrier terms', text };
}

module.exports = function setupApps({ app, pool, esc, slugify, SKIN, TRADES, auth, sameOrigin, hubOpen, jobsAdmin, approve, ORIGIN }) {
  const TERMS = loadTerms();
  const upload = multer({ dest: TMP_DIR, limits: { fileSize: 200 * 1024 * 1024, files: 2, fields: 12, fieldSize: 2000 },
    fileFilter: (req, file, cb) => cb(null, (file.fieldname === 'video' && /^video\//.test(file.mimetype)) || (file.fieldname === 'cover' && /^image\//.test(file.mimetype))) });

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS connected_apps (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, key_tail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'on',
      biz_id INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used TIMESTAMPTZ)`);
    // the record of who accepted which version, and when. Kept when a client turns publishing off.
    await pool.query(`CREATE TABLE IF NOT EXISTS carrier_terms_acceptances (
      id BIGSERIAL PRIMARY KEY, app_id INT NOT NULL, biz_id INT NOT NULL, business TEXT NOT NULL, accepted_by TEXT NOT NULL, version INT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reg_number TEXT');
    await pool.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reg_expiry TEXT');
    await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS app_id INT');
    await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id TEXT');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS jobs_app_external ON jobs (app_id, external_id) WHERE app_id IS NOT NULL');
  }

  // ---------- the key ----------
  const bad = new Map(), used = new Map();
  const count = (map, k, ms) => { const now = Date.now(), l = (map.get(k) || []).filter(t => now - t < ms); l.push(now); map.set(k, l); if (map.size > 5000) map.clear(); return l.length; };
  async function appAuth(req, res, next) {
    try {
      if (((bad.get(req.ip) || []).filter(t => Date.now() - t < 15 * 60e3)).length >= 10) return res.status(429).json({ error: 'too_many' });
      const m = /^Bearer (cup_[a-f0-9]{48})$/.exec(req.get('authorization') || '');
      const a = m && (await pool.query('SELECT * FROM connected_apps WHERE key_hash=$1', [sha(m[1])])).rows[0];
      if (!a) { count(bad, req.ip, 15 * 60e3); return res.status(401).json({ error: 'key' }); }
      if (a.status !== 'on') return res.status(403).json({ error: 'off' });
      if (count(used, a.id, 3600e3) > 600) return res.status(429).json({ error: 'too_many' });
      pool.query('UPDATE connected_apps SET last_used=now() WHERE id=$1', [a.id]).catch(() => {});
      req.capp = a; next();
    } catch (e) { next(e); }
  }
  const carrierOf = async a => a.biz_id ? (await pool.query("SELECT * FROM businesses WHERE id=$1 AND status='active'", [a.biz_id])).rows[0] : null;
  const accepted = async b => { const r = (await pool.query('SELECT max(version) v FROM carrier_terms_acceptances WHERE biz_id=$1', [b.id])).rows[0]; return +(r && r.v || 0) >= TERMS.version; };
  const carrierJson = b => b ? { name: b.name, email: b.email, town: b.town || '', whatsapp: b.whatsapp || '', slug: b.slug } : null;

  // ---------- what the client's app asks ----------
  app.get('/api/app/status', appAuth, async (req, res, next) => { try {
    const b = await carrierOf(req.capp);
    res.set('Cache-Control', 'no-store').json({ ok: true, hub: SKIN.name, origin: ORIGIN, hub_open: hubOpen(), terms: TERMS, categories: TRADES, linked: !!b, terms_ok: b ? await accepted(b) : false, carrier: carrierJson(b) });
  } catch (e) { next(e); } });

  // turn on, or change the details: makes the carrier account under the client's own details. Allowed while the hub is closed; nothing public happens.
  app.post('/api/app/link', appAuth, express.json({ limit: '10kb' }), async (req, res, next) => { try {
    const b = req.body || {}, a = req.capp;
    const name = clean(b.business, 80), email = clean(b.email, 120).toLowerCase(), town = clean(b.town, 60), reg = clean(b.reg_number, 20).toUpperCase(), regExp = clean(b.reg_expiry, 10), by = clean(b.accepted_by, 120).toLowerCase();
    let raw = clean(b.whatsapp, 30), d = raw.replace(/\D/g, ''); if (/^0\d{9,10}$/.test(d)) d = '44' + d.slice(1);
    if (!name || !EMAIL.test(email) || !by) return res.status(400).json({ error: 'details' });
    if (raw && !/^\d{10,15}$/.test(d)) return res.status(400).json({ error: 'whatsapp' });
    if (!reg) return res.status(400).json({ error: 'registration' });
    const cur = a.biz_id ? (await pool.query('SELECT * FROM businesses WHERE id=$1', [a.biz_id])).rows[0] : null;
    const isNewAccept = b.accept_terms === true;
    if (isNewAccept && +b.terms_version !== TERMS.version) return res.status(409).json({ error: 'terms_changed', terms: TERMS });
    if (!isNewAccept && (!cur || cur.status !== 'active' || !(await accepted(cur)))) return res.status(409).json({ error: 'terms_needed', terms: TERMS });
    const others = cur ? cur.id : 0;
    if ((await pool.query('SELECT 1 FROM businesses WHERE email=$1 AND id<>$2', [email, others])).rows.length) return res.status(409).json({ error: 'email_taken' });
    if ((await pool.query('SELECT 1 FROM businesses WHERE lower(name)=lower($1) AND id<>$2', [name, others])).rows.length) return res.status(409).json({ error: 'name_taken' });
    let id = others;
    if (cur) {
      await pool.query("UPDATE businesses SET name=$1, email=$2, town=$3, whatsapp=$4, reg_number=$5, reg_expiry=$6, status='active', last_seen=now() WHERE id=$7", [name, email, town, raw || null, reg, regExp, id]);
      await pool.query('UPDATE jobs SET biz=$1, initials=$2 WHERE biz_id=$3', [name, initialsOf(name), id]);
    } else {
      let slug = slugify(name) || 'business', i = 2; const base = slug;
      while ((await pool.query('SELECT 1 FROM businesses WHERE slug=$1', [slug])).rows.length) slug = `${base}-${i++}`;
      id = (await pool.query("INSERT INTO businesses (slug,name,email,pass_hash,town,whatsapp,reg_number,reg_expiry,last_seen) VALUES ($1,$2,$3,'!',$4,$5,$6,$7,now()) RETURNING id", [slug, name, email, town, raw || null, reg, regExp])).rows[0].id;   // pass_hash '!' can never match: there is no hub login
      await pool.query('UPDATE connected_apps SET biz_id=$1 WHERE id=$2', [id, a.id]);
    }
    if (isNewAccept) await pool.query('INSERT INTO carrier_terms_acceptances (app_id,biz_id,business,accepted_by,version) VALUES ($1,$2,$3,$4,$5)', [a.id, id, name, by, TERMS.version]);
    await jobsAdmin.reload();
    res.json({ ok: true, carrier: carrierJson((await pool.query('SELECT * FROM businesses WHERE id=$1', [id])).rows[0]) });
  } catch (e) { next(e); } });

  // publish one video the client chose. The same external_id again replaces the video. Refused while the hub is closed.
  const readyToPublish = async (req, res, next) => { try {
    if (!hubOpen()) return res.status(423).json({ error: 'closed' });
    const b = await carrierOf(req.capp);
    if (!b) return res.status(409).json({ error: 'not_linked' });
    if (!(await accepted(b))) return res.status(409).json({ error: 'terms_needed', terms: TERMS });
    req.biz = b; next();
  } catch (e) { next(e); } };
  const uploadSafe = (req, res, next) => upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }])(req, res, e => e ? res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'file' }) : next());
  const seconds = f => new Promise(r => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], (e, so) => r(e ? 0 : parseFloat(so) || 0)));
  app.post('/api/app/jobs', appAuth, readyToPublish, uploadSafe, async (req, res, next) => {
    const vid = req.files && req.files.video && req.files.video[0], cov = req.files && req.files.cover && req.files.cover[0];
    const bin = () => { for (const f of [vid, cov]) if (f) fs.unlink(f.path, () => {}); };
    try {
      const b = req.body || {}, a = req.capp, biz = req.biz, ext = clean(b.external_id, 40), title = clean(b.title, 80), trade = TRADES.includes(b.trade) ? b.trade : '';
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(ext) || !title || !trade || !vid || b.confirm !== '1') { bin(); return res.status(400).json({ error: 'details' }); }
      const secs = await seconds(vid.path);
      if (!(secs > 0 && secs <= 300)) { bin(); return res.status(400).json({ error: 'video' }); }
      const stages = ['BEFORE', 'DURING', 'AFTER'].filter(s => String(b.stages || '').split(',').includes(s)), desc = clean(b.description, 300), voice = b.voice === '1';
      const old = (await pool.query('SELECT * FROM jobs WHERE app_id=$1 AND external_id=$2', [a.id, ext])).rows[0];
      let id, slug;
      if (old) {
        ({ id, slug } = old);
        await pool.query("UPDATE jobs SET title=$1, trade=$2, description=$3, stages=$4, voice=$5, status='processing' WHERE id=$6", [title, trade, desc, stages.length ? stages : old.stages, voice, id]);
      } else {
        slug = await jobsAdmin.uniqueSlug(title);
        const top = (await pool.query('SELECT coalesce(max(sort),0)+1 n FROM jobs')).rows[0].n;
        id = (await pool.query(`INSERT INTO jobs (slug,title,biz,initials,trade,description,services,stages,voice,demo,status,sort,biz_id,approved,app_id,external_id)
          VALUES ($1,$2,$3,$4,$5,$6,'{}',$7,$8,false,'processing',$9,$10,false,$11,$12) RETURNING id`, [slug, title, biz.name, initialsOf(biz.name), trade, desc, stages.length ? stages : ['BEFORE', 'AFTER'], voice, top, biz.id, a.id, ext])).rows[0].id;
      }
      res.status(202).json({ ok: true, slug, url: `${ORIGIN}/job/${slug}` });
      await jobsAdmin.processVideo(id, vid.path, cov ? cov.path : null);
      const now = (await pool.query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0];
      if (now && now.status === 'ready') {
        if (old) { for (const u of new Set([old.video, old.play_video, old.cover, old.play_cover])) jobsAdmin.removeFile(u); await pool.query('UPDATE jobs SET approved=true, hidden=false WHERE id=$1', [id]); await jobsAdmin.reload(); }
        else await approve(id);                // goes live, followers get the alert
      }
    } catch (e) {
      bin();
      if (res.headersSent) return console.error('App publish failed', e.message);
      if (e.code === '23505') return res.status(409).json({ error: 'busy' });      // the same video, sent twice at once
      next(e);
    }
  });

  const dropJobs = async (where, val) => { for (const r of (await pool.query(`DELETE FROM jobs WHERE ${where} RETURNING *`, val)).rows) for (const u of new Set([r.video, r.play_video, r.cover, r.play_cover])) jobsAdmin.removeFile(u); await jobsAdmin.reload(); };
  // take one video down (allowed while the hub is closed)
  app.delete('/api/app/jobs/:ext', appAuth, async (req, res, next) => { try {
    await dropJobs('app_id=$1 AND external_id=$2', [req.capp.id, String(req.params.ext).slice(0, 40)]);
    res.json({ ok: true });
  } catch (e) { next(e); } });
  // turn off: every video from this app comes down and the account stops. The record of what was accepted stays.
  app.post('/api/app/unlink', appAuth, async (req, res, next) => { try {
    await dropJobs('app_id=$1', [req.capp.id]);
    if (req.capp.biz_id) await pool.query("UPDATE businesses SET status='left' WHERE id=$1", [req.capp.biz_id]);
    await jobsAdmin.reload();
    res.json({ ok: true });
  } catch (e) { next(e); } });

  // ---------- owner: /admin/apps ----------
  const newKey = () => { const k = 'cup_' + crypto.randomBytes(24).toString('hex'); return { key: k, hash: sha(k), tail: k.slice(-4) }; };
  const when = d => d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : 'never';
  const shell = body => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Connected apps · admin</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;background:#F6F6F3;color:#1F2124"><p style="margin:0 0 10px"><a href="/admin" style="color:#1F2124">← Admin</a></p><h1 style="margin:0 0 6px">Connected apps</h1>${body}</body></html>`;
  const box = 'border:1px solid #DCDDD8;border-radius:14px;padding:14px;margin:0 0 12px;background:#fff';
  const btn = 'padding:10px 18px;border:0;border-radius:20px;background:#1F2124;color:#fff;font:inherit;font-weight:600;cursor:pointer';
  const btn2 = 'padding:8px 14px;border:1px solid #C9CBC5;border-radius:18px;background:#fff;color:#1F2124;font:inherit;font-size:14px;cursor:pointer';
  const showKey = (name, key) => shell(`<div style="${box}"><b>Key for ${esc(name)}</b><p style="margin:6px 0">Paste it into that app's /admin. It is not shown again.</p><code style="display:block;overflow-wrap:anywhere;background:#F6F6F3;padding:10px;border-radius:10px">${esc(key)}</code></div><a href="/admin/apps" style="${btn};display:inline-block;text-decoration:none">Done</a>`);
  app.get('/admin/apps', auth, async (req, res, next) => { try {
    const rows = (await pool.query(`SELECT a.*, b.name AS carrier, b.email, b.status AS bstatus, (SELECT count(*) FROM jobs j WHERE j.app_id=a.id)::int AS videos,
      (SELECT accepted_at FROM carrier_terms_acceptances t WHERE t.app_id=a.id ORDER BY id DESC LIMIT 1) AS acc_at, (SELECT version FROM carrier_terms_acceptances t WHERE t.app_id=a.id ORDER BY id DESC LIMIT 1) AS acc_v
      FROM connected_apps a LEFT JOIN businesses b ON b.id=a.biz_id ORDER BY a.id`)).rows;
    res.set('Cache-Control', 'no-store').send(shell(`<p style="color:#5d6066;margin:0 0 14px">Each client app has its own key. Switching an app off stops its key and hides its videos; switching it on brings them back.</p>
${rows.map(a => `<div style="${box}"><b style="font-size:17px">${esc(a.name)}</b> <span style="color:${a.status === 'on' ? '#1a7f37' : '#B42318'};font-weight:600">${a.status === 'on' ? 'On' : 'Off'}</span>
<div style="color:#5d6066;font-size:14px;margin:2px 0 10px;overflow-wrap:anywhere">Key ends ${esc(a.key_tail)} · last used ${when(a.last_used)} · ${a.videos} video${a.videos === 1 ? '' : 's'}<br>${a.carrier ? `${esc(a.carrier)} · ${esc(a.email)}${a.bstatus !== 'active' ? ' · turned off by the client' : ''}${a.acc_at ? ` · accepted terms version ${a.acc_v} on ${when(a.acc_at)}` : ''}` : 'Client has not turned publishing on'}</div>
<div style="display:flex;gap:8px;flex-wrap:wrap"><form method="post" action="/admin/apps/${a.id}/switch" style="margin:0"><button style="${btn2}" type="submit">${a.status === 'on' ? 'Switch off' : 'Switch on'}</button></form>
<form method="post" action="/admin/apps/${a.id}/rekey" onsubmit="return confirm('Make a new key? The old one stops working at once.')" style="margin:0"><button style="${btn2}" type="submit">New key</button></form></div></div>`).join('') || '<p>No apps yet.</p>'}
<form method="post" action="/admin/apps" style="${box};display:grid;gap:8px"><label style="font-weight:600">Add an app: the client's name<input name="name" maxlength="80" required style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #C9CBC5;border-radius:10px;font:inherit"></label><button type="submit" style="${btn};justify-self:start">Add app and make its key</button></form>`));
  } catch (e) { next(e); } });
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  app.post('/admin/apps', auth, sameOrigin, form, async (req, res, next) => { try {
    const name = clean((req.body || {}).name, 80); if (!name) return res.redirect(303, '/admin/apps');
    const k = newKey();
    await pool.query('INSERT INTO connected_apps (name,key_hash,key_tail) VALUES ($1,$2,$3)', [name, k.hash, k.tail]);
    res.set('Cache-Control', 'no-store').send(showKey(name, k.key));
  } catch (e) { next(e); } });
  app.post('/admin/apps/:id/rekey', auth, sameOrigin, async (req, res, next) => { try {
    const k = newKey(), r = (await pool.query('UPDATE connected_apps SET key_hash=$1, key_tail=$2 WHERE id=$3 RETURNING name', [k.hash, k.tail, parseInt(req.params.id, 10) || 0])).rows[0];
    if (!r) return res.redirect(303, '/admin/apps');
    res.set('Cache-Control', 'no-store').send(showKey(r.name, k.key));
  } catch (e) { next(e); } });
  app.post('/admin/apps/:id/switch', auth, sameOrigin, async (req, res, next) => { try {
    const id = parseInt(req.params.id, 10) || 0, r = (await pool.query("UPDATE connected_apps SET status=CASE WHEN status='on' THEN 'off' ELSE 'on' END WHERE id=$1 RETURNING status", [id])).rows[0];
    if (r) { await pool.query('UPDATE jobs SET hidden=$1 WHERE app_id=$2', [r.status === 'off', id]); await jobsAdmin.reload(); }
    res.redirect(303, '/admin/apps');
  } catch (e) { next(e); } });

  return { init, TERMS };
};
