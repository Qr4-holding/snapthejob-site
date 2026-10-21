// Quote requests with customer photos ("Snap your rubbish"). Only switched on for skins with a "quote" section.
// Photos: re-encoded on arrival (which drops all hidden data, including GPS location), shrunk, and stored
// OUTSIDE the public media folder; only the signed-in admin can see them. They are deleted after quote.photoDays.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const QUOTE_DIR = process.env.QUOTE_DIR || '/data/quotes';
const STATUSES = ['New', 'Sent to operator', 'Quoted', 'Won', 'Closed'];

module.exports = function setupQuotes({ app, pool, auth, sameOrigin, esc, SKIN, getJobs, limited }) {
  const Q = SKIN.quote;
  try { fs.mkdirSync(path.join(QUOTE_DIR, 'tmp'), { recursive: true }); } catch (e) {}
  const upload = multer({
    dest: path.join(QUOTE_DIR, 'tmp'),
    limits: { fileSize: 15 * 1024 * 1024, files: Q.maxPhotos || 6, fields: 5, fieldSize: 20000 },
    fileFilter: (req, file, cb) => cb(null, file.fieldname === 'photos')
  });
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const pick = (v, list) => (list.includes(v) ? v : '');

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS quotes (
      id SERIAL PRIMARY KEY, ref TEXT UNIQUE NOT NULL,
      biz TEXT, routed_to TEXT NOT NULL,
      waste_types TEXT[] NOT NULL, size TEXT, access TEXT, who TEXT, freq TEXT,
      postcode TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, notes TEXT,
      before_ok BOOLEAN NOT NULL DEFAULT false, consent BOOLEAN NOT NULL,
      photos INT NOT NULL DEFAULT 0, photos_deleted BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'New', source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS quotes_created ON quotes (created_at DESC)');
    await purge();
    setInterval(() => purge().catch(() => {}), 6 * 3600e3).unref();
  }
  // keep customer photos only as long as needed
  async function purge() {
    const { rows } = await pool.query(`SELECT ref FROM quotes WHERE NOT photos_deleted AND created_at < now() - ($1 || ' days')::interval`, [String(Q.photoDays || 90)]);
    for (const r of rows) {
      fs.rmSync(path.join(QUOTE_DIR, r.ref), { recursive: true, force: true });
      await pool.query('UPDATE quotes SET photos_deleted = true WHERE ref = $1', [r.ref]);
    }
  }

  app.post('/api/quote', (req, res, next) => {
    if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Please try again later.' });
    next();
  }, (req, res, next) => upload.array('photos', Q.maxPhotos || 6)(req, res, err => {
    if (err) return res.status(400).json({ ok: false, error: err.code === 'LIMIT_FILE_SIZE' ? 'One of the photos is too big. Please use photos under 15 MB.' : `Please add up to ${Q.maxPhotos || 6} photos.` });
    next();
  }), async (req, res) => {
    const files = req.files || [];
    const tidy = () => files.forEach(f => fs.unlink(f.path, () => {}));
    let b; try { b = JSON.parse(req.body.data || '{}'); } catch (e) { b = {}; }
    if (b.website) { tidy(); return res.json({ ok: true }); } // bots fill the hidden field
    const jobs = getJobs();
    const biz = jobs.some(j => j.biz === b.biz) ? b.biz : '';
    const row = {
      biz, routed_to: biz || Q.defaultOperator || 'Unassigned',
      waste_types: (Array.isArray(b.type) ? b.type : []).map(t => pick(t, Q.types)).filter(Boolean),
      size: pick(b.size, Q.sizes), access: pick(b.access, Q.access), who: pick(b.who, Q.who), freq: pick(b.freq, Q.freq),
      postcode: clean(b.postcode, 10).toUpperCase(), name: clean(b.name, 120), email: clean(b.email, 200).toLowerCase(),
      phone: clean(b.phone, 30).replace(/[^\d +()-]/g, ''), notes: clean(b.notes, 1000),
      before_ok: b.beforeOk === true, consent: b.consent === true, source: clean(b.source, 200)
    };
    const bad =
      files.length < (Q.minPhotos || 1) ? 'Please add at least one photo of the rubbish.' :
      !row.waste_types.length || b.hazOk !== true ? 'Please say what the rubbish is and confirm there is no hazardous waste.' :
      !row.size || !row.access || !row.who || !row.freq ? 'Please answer all the questions.' :
      !/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(row.postcode) ? 'Please add the full postcode.' :
      !row.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email) ? 'Please add your name and a valid email.' :
      !row.consent ? 'Please tick the box so we can send your request.' : '';
    if (bad) { tidy(); return res.status(400).json({ ok: false, error: bad }); }

    const ref = new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex');
    const dir = path.join(QUOTE_DIR, ref);
    try {
      fs.mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const f of files) {
        n++;
        // .rotate() applies the phone's orientation; sharp writes NO metadata (EXIF/GPS) unless asked to
        const img = sharp(f.path, { failOn: 'none', limitInputPixels: 60e6 }).rotate();
        await img.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(dir, `${n}.jpg`));
        await img.clone().resize(400, 400, { fit: 'cover' }).jpeg({ quality: 72 }).toFile(path.join(dir, `${n}-t.jpg`));
      }
      await pool.query(`INSERT INTO quotes (ref,biz,routed_to,waste_types,size,access,who,freq,postcode,name,email,phone,notes,before_ok,consent,photos,source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [ref, row.biz, row.routed_to, row.waste_types, row.size, row.access, row.who, row.freq, row.postcode, row.name, row.email, row.phone, row.notes, row.before_ok, row.consent, n, row.source]);
      res.json({ ok: true, ref });
    } catch (e) {
      console.error('Quote failed', e.message);
      fs.rmSync(dir, { recursive: true, force: true });
      res.status(400).json({ ok: false, error: /unsupported|Input file/i.test(e.message) ? 'We could not read one of the photos. Please use a JPG or PNG photo.' : 'Something went wrong. Please try again.' });
    } finally { tidy(); }
  });

  // ---------- admin ----------
  const when = d => esc(new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const REF = /^\d{6}-[0-9a-f]{6}$/;
  app.get('/admin/quotes', auth, async (req, res, next) => { try {
    const { rows } = await pool.query('SELECT * FROM quotes ORDER BY created_at DESC LIMIT 300');
    const flash = { saved: 'Saved.', deleted: 'Deleted.', photo: 'Photo removed.' }[req.query.m] || '';
    const cards = rows.map(r => {
      const pics = r.photos_deleted ? '<p class="n">Photos deleted after ' + esc(Q.photoDays || 90) + ' days.</p>' :
        `<div class="pics">${Array.from({ length: r.photos }, (_, i) => i + 1).filter(i => fs.existsSync(path.join(QUOTE_DIR, r.ref, `${i}.jpg`))).map(i => `<figure><a href="/admin/quotes/photo/${r.ref}/${i}" target="_blank" rel="noopener"><img src="/admin/quotes/photo/${r.ref}/${i}-t" alt="Photo ${i}" loading="lazy"></a>
          <form method="post" action="/admin/quotes/photo-delete" onsubmit="return confirm('Remove this photo for good?')"><input type="hidden" name="ref" value="${r.ref}"><input type="hidden" name="n" value="${i}"><button class="del" type="submit">Remove</button></form></figure>`).join('')}</div>`;
      return `<article class="q"><header><b>${esc(r.waste_types.join(', '))}</b> · ${esc(r.size)} · ${esc(r.postcode)}<span class="n">${when(r.created_at)} · ref ${esc(r.ref)}</span></header>
        ${pics}
        <dl><dt>For</dt><dd>${esc(r.biz || 'Home page / Brenda')} → <b>${esc(r.routed_to)}</b></dd><dt>Where</dt><dd>${esc(r.access)}</dd><dt>Customer</dt><dd>${esc(r.who)}, ${esc(r.freq)}</dd>
        <dt>Name</dt><dd>${esc(r.name)}</dd><dt>Email</dt><dd>${esc(r.email)}</dd><dt>Mobile</dt><dd>${esc(r.phone || '–')}</dd><dt>Notes</dt><dd style="white-space:pre-wrap">${esc(r.notes || '–')}</dd>
        <dt>Photo as "before"</dt><dd>${r.before_ok ? 'Yes, allowed' : 'No'}</dd></dl>
        <footer><form method="post" action="/admin/quotes/status"><input type="hidden" name="ref" value="${r.ref}"><select name="status">${STATUSES.map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select><button type="submit">Save</button></form>
        <form method="post" action="/admin/quotes/delete" onsubmit="return confirm('Delete this quote request and its photos for good?')"><input type="hidden" name="ref" value="${r.ref}"><button class="del" type="submit">Delete request</button></form></footer></article>`;
    }).join('');
    res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Quote requests · SnapTheJob admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff;max-width:1100px}nav a{padding:8px 14px;border-radius:18px;border:1px solid #F0B8AE;text-decoration:none;color:#1F2124;font-weight:600;display:inline-block;margin:0 6px 6px 0}nav a.on{background:#1F2124;color:#fff;border-color:#1F2124}
.n{color:#5E6168;font-size:14px;display:block}.flash{background:#FDF1EE;border:1px solid #D9381E;border-radius:12px;padding:10px 14px;font-weight:600}
.q{border:1px solid #F0B8AE;border-radius:14px;padding:14px;margin:0 0 14px;display:grid;gap:10px}.pics{display:flex;gap:8px;flex-wrap:wrap}.pics figure{margin:0;display:grid;gap:4px}.pics img{width:120px;height:120px;object-fit:cover;border-radius:10px;display:block}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0;font-size:15px}dt{color:#5E6168}dd{margin:0}footer{display:flex;gap:10px;flex-wrap:wrap;align-items:center}footer form{display:flex;gap:8px;margin:0}
button{background:#D9381E;color:#fff;border:none;border-radius:18px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer}button.del{background:#fff;color:#A1260F;border:1px solid #F0B8AE;padding:5px 10px;font-size:13px}select{font:inherit;padding:7px;border-radius:10px;border:1px solid #C9CBC5}</style></head><body>
<nav><a href="/admin">Overview</a><a href="/admin/jobs">Jobs</a><a href="/admin/quotes" class="on">Quote requests</a><a href="/" target="_blank" rel="noopener">View site</a></nav>
<h1 style="margin:6px 0">Quote requests (${rows.length})</h1>
<p class="n">Home-page and Brenda requests go to ${esc(Q.defaultOperator || 'the local operator')}; requests from a video go to that business. Customer photos have their location data removed and are deleted after ${esc(Q.photoDays || 90)} days. Email alerts to operators switch on once email sending is set up.</p>
${flash ? `<p class="flash">${esc(flash)}</p>` : ''}${cards || '<p>No quote requests yet.</p>'}</body></html>`);
  } catch (e) { next(e); } });

  app.get('/admin/quotes/photo/:ref/:n', auth, (req, res) => {
    const { ref, n } = req.params;
    if (!REF.test(ref) || !/^\d{1,2}(-t)?$/.test(n)) return res.status(404).send('Not found');
    const f = path.join(QUOTE_DIR, ref, n + '.jpg');
    if (!fs.existsSync(f)) return res.status(404).send('Not found');
    res.set('Cache-Control', 'private, no-store').type('image/jpeg').sendFile(f);
  });
  const form = require('express').urlencoded({ extended: false, limit: '5kb' });
  app.post('/admin/quotes/status', auth, sameOrigin, form, async (req, res) => {
    if (REF.test(req.body.ref || '') && STATUSES.includes(req.body.status)) await pool.query('UPDATE quotes SET status=$1 WHERE ref=$2', [req.body.status, req.body.ref]);
    res.redirect(303, '/admin/quotes?m=saved');
  });
  app.post('/admin/quotes/photo-delete', auth, sameOrigin, form, (req, res) => {
    const ref = req.body.ref || '', n = req.body.n || '';
    if (REF.test(ref) && /^\d{1,2}$/.test(n)) for (const f of [n, n + '-t']) fs.rmSync(path.join(QUOTE_DIR, ref, f + '.jpg'), { force: true });
    res.redirect(303, '/admin/quotes?m=photo');
  });
  app.post('/admin/quotes/delete', auth, sameOrigin, form, async (req, res) => {
    const ref = req.body.ref || '';
    if (REF.test(ref)) { fs.rmSync(path.join(QUOTE_DIR, ref), { recursive: true, force: true }); await pool.query('DELETE FROM quotes WHERE ref=$1', [ref]); }
    res.redirect(303, '/admin/quotes?m=deleted');
  });

  return { init };
};
