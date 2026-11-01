// CleanUpPic founder places: the /founders page, the application form (checked against the Environment Agency register),
// the founders table, an email to the team, and the admin list. Only switched on for skins with "founders": true.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ea = require('./ea');
const mail = require('./mail');

const PLACES = 10;                       // founder places per area
const PAGE = path.join(__dirname, 'founders', 'page.html');

// ---------- plain-words checks (pure, so they can be tested without a server) ----------
// UK postcode, tidied to "LS12 2PY"; the area is the postcode district ("LS12")
function postcode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(s);
  return m ? { full: m[1] + ' ' + m[2], area: m[1] } : null;
}
// UK mobile, tidied to 07xxx xxxxxx (accepts +44 7... and 0044 7...)
function mobile(raw) {
  let s = String(raw || '').replace(/[\s().-]/g, '');
  if (s.startsWith('+44')) s = '0' + s.slice(3); else if (s.startsWith('0044')) s = '0' + s.slice(4);
  return /^07\d{9}$/.test(s) ? s.slice(0, 5) + ' ' + s.slice(5) : null;
}
// the person's name: at least two characters, with a letter in it
function personName(raw) {
  const n = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return n.length >= 2 && /\p{L}/u.test(n) ? n : null;
}
// an email address, lower-cased
function emailOf(raw) {
  const e = String(raw || '').trim().toLowerCase().slice(0, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
// the wording of the consent tick box: stored with the application, and shown on the page exactly like this
const CONSENT_TEXT = 'Text and email me about my founder place.';
// a short share code (no look-alike letters or numbers)
const REF_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newRef = () => Array.from(crypto.randomBytes(6), b => REF_CHARS[b % REF_CHARS.length]).join('');
const REF_OK = /^[a-z0-9]{4,12}$/;
// what the person typed as the carrier registration: { ok, number } or { ok:false, error }
function registration(raw) {
  const n = ea.normNumber(raw);
  if (!n) return { ok: false, error: 'Add your carrier registration number. It looks like CBDU123456.' };
  if (/^CBDL\d+$/.test(n)) return { ok: false, error: 'Founder places are for upper-tier carriers. A number starting CBDL is lower tier.' };
  if (!/^CBDU\d{6}$/.test(n)) return { ok: false, error: 'A carrier registration is CBDU followed by six numbers, like CBDU123456. Check it and try again.' };
  return { ok: true, number: n };
}

module.exports = function setupFounders({ app, pool, auth, sameOrigin, esc, SKIN, limited, ORIGIN, express, fetchImpl, brand, getJobs, hubOpen, noindex }) {
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const lookup = number => ea.lookup(number, fetchImpl ? { fetchImpl } : {});
  const TO = process.env.FOUNDERS_EMAIL || 'hello@cleanuppic.co.uk';

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS founders (
      id SERIAL PRIMARY KEY, postcode TEXT NOT NULL, area TEXT NOT NULL, business TEXT NOT NULL, mobile TEXT NOT NULL,
      registration TEXT NOT NULL UNIQUE, register_name TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '', register_expiry TEXT NOT NULL DEFAULT '',
      position INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const c of ["name TEXT NOT NULL DEFAULT ''", "email TEXT NOT NULL DEFAULT ''", 'support_cleanupuk BOOLEAN NOT NULL DEFAULT false', 'crew BOOLEAN NOT NULL DEFAULT false',
      "consent_text TEXT NOT NULL DEFAULT ''", 'consent_at TIMESTAMPTZ', 'ref TEXT', 'referred_by TEXT']) await pool.query('ALTER TABLE founders ADD COLUMN IF NOT EXISTS ' + c);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS founders_ref ON founders (ref)');
    await pool.query('CREATE INDEX IF NOT EXISTS founders_area ON founders (area, position)');
  }

  const placeText = (area, position) => position <= PLACES
    ? `You're founder place ${position} of ${PLACES} for ${area}. We'll text you when your place is confirmed.`
    : `The ${PLACES} founder places for ${area} are taken. You're number ${position - PLACES} on the waiting list for ${area}, and we'll text you if a place opens.`;

  // ---------- "Latest clear-ups": the four newest real jobs from the hub's own job feed ----------
  // On the live site this is the local job list. A preview with its own empty database sets FOUNDERS_FEED_URL
  // (e.g. https://cleanuppic.co.uk/assets/jobs.js) and the same four jobs are read from there, cached for 5 minutes.
  const FEED = process.env.FOUNDERS_FEED_URL || '';
  const fetchF = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  let cache = { at: 0, jobs: [] };
  async function newest(n = 4) {
    let jobs;
    if (!FEED) jobs = getJobs ? getJobs() : [];
    else if (Date.now() - cache.at < 300000 && cache.jobs.length) jobs = cache.jobs;
    else {
      jobs = cache.jobs;
      try {
        const r = await fetchF(FEED, { signal: AbortSignal.timeout(6000) });
        const body = await r.text();
        const list = JSON.parse(body.slice(body.indexOf('=') + 1).trim().replace(/;$/, ''));
        const base = new URL(FEED).origin;
        const abs = u => (typeof u === 'string' && u.startsWith('/') ? base + u : u);
        jobs = list.map(j => Object.assign({}, j, { video: abs(j.video), playVideo: abs(j.playVideo), cover: abs(j.cover), playCover: abs(j.playCover) }));
        cache = { at: Date.now(), jobs };
      } catch (e) { console.error('Founders feed:', e.message); }
    }
    return (jobs || []).filter(j => j && !j.demo).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, n);
  }
  const card = j => `<article class="card">
      <a class="thumb" data-play="${esc(j.slug)}" href="/job/${esc(j.slug)}" aria-label="Watch: ${esc(j.title)} by ${esc(j.biz)}"><img src="${esc(j.cover)}" alt="${esc(j.alt || j.title)}" loading="lazy"><span class="dur">${esc(j.dur || '')}</span></a>
      <div class="meta"><span class="av" aria-hidden="true">${esc(j.initials || '')}</span><div style="min-width:0"><a class="t" data-play="${esc(j.slug)}" href="/job/${esc(j.slug)}">${esc(j.title)}</a><span class="s">${esc(j.biz)} · ${esc(j.trade)}</span></div></div>
      <div class="cta"><button class="btn btn-red" type="button" data-waitlist="customer" data-biz="${esc(j.biz)}">Get a quote</button></div>
    </article>`;

  // The page is the hub's own shell (fonts, site.css, skin.css, header, quote flow), so it is the same site.
  // Until the hub is opened it is the home page (/) and /founders points to / as its canonical address; once open it stays at /founders.
  const serve = canonical => async (req, res, next) => { try {
    const jobs = await newest();
    const url = ORIGIN + canonical;
    const head = `<link rel="canonical" href="${url}">\n<meta property="og:title" content="CleanUpPic · more leads from the jobs you already do">\n<meta property="og:description" content="A finished, speaking video of every job you do, with a Get a quote button. Founder places for upper-tier registered waste carriers.">\n<meta property="og:image" content="${ORIGIN}/founders/real-job.jpg">\n<meta property="og:url" content="${url}">\n<meta property="og:type" content="website">`;
    let html = fs.readFileSync(PAGE, 'utf8').replace('{{CLEARUPS}}', jobs.map(card).join('\n')).replace('{{CANON}}', head).replace('{{ROBOTS}}', noindex ? '<meta name="robots" content="noindex,nofollow">' : '');
    if (brand) html = brand(html);
    res.set({ 'Cache-Control': 'no-cache' }).type('html').send(html);
  } catch (e) { next(e); } };
  app.get('/founders', (req, res, next) => serve(hubOpen && hubOpen() ? '/founders' : '/')(req, res, next));
  const home = serve('/');
  // The same four jobs as the hub's jobs.js, so the hub's own video player opens them.
  app.get('/founders/jobs.js', async (req, res, next) => { try {
    const jobs = await newest();
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).send('window.STJ_JOBS = ' + JSON.stringify(jobs).replace(/</g, '\\u003c') + ';');
  } catch (e) { next(e); } });
  // The two founder videos (voiced, 9:16) live in founders/assets
  app.use('/founders/media', express.static(path.join(__dirname, 'founders', 'assets'), { maxAge: '1h', index: false }));

  app.post('/api/founders', express.json({ limit: '5kb' }), async (req, res) => {
    const b = req.body || {};
    const fail = (error, field, status = 400) => res.status(status).json({ ok: false, error, field });
    if (b.website) return res.json({ ok: true, message: 'Thank you.' });                     // honeypot: bots fill this
    if (limited(req.ip)) return fail('Too many tries from this connection. Please try again in an hour.', undefined, 429);
    const nm = personName(b.name), business = clean(b.business, 120), mob = mobile(b.mobile), em = emailOf(b.email), reg = registration(b.registration), pc = postcode(b.postcode);
    if (!nm) return fail('Add your name.', 'name');
    if (business.length < 2) return fail('Add your business name.', 'business');
    if (!mob) return fail('That mobile number doesn\'t look right. A UK mobile starts 07 and has 11 numbers, like 07123 456789.', 'mobile');
    if (!em) return fail("That email address doesn't look right. Check it and try again.", 'email');
    if (!reg.ok) return fail(reg.error, 'registration');
    if (!pc) return fail("That postcode doesn't look right. Use your business postcode, like LS1 1UR.", 'postcode');
    if (b.support !== true) return fail('Please tick "I support Clean Up UK" to carry on.', 'support');
    if (b.consent !== true) return fail('Please tick the last box, so we can text and email you about your place.', 'consent');
    const crew = b.crew === true;
    const refIn = typeof b.ref === 'string' && REF_OK.test(b.ref.trim().toLowerCase()) ? b.ref.trim().toLowerCase() : '';
    // is it on the register?
    const r = await lookup(reg.number);
    if (r.status === 'notfound') return fail("We can't find that number on the Environment Agency register, so we haven't saved anything. Check it and try again.", 'registration');
    if (r.status !== 'found') return fail("We couldn't reach the Environment Agency register just now, so we haven't saved anything. Please try again in a few minutes.", undefined, 503);
    if (r.tier !== 'upper') return fail('Founder places are for upper-tier carriers. That registration is lower tier.', 'registration');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    if (r.expiry && r.expiry < today) return fail('The register shows that registration ran out on ' + r.expiry.split('-').reverse().join('/') + '. Renew it with the Environment Agency, then apply again.', 'registration');
    // take a place: one at a time per area, so two people cannot get the same number
    const db = await pool.connect();
    let row, again = false;
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['founders:' + pc.area]);
      const had = (await db.query('SELECT * FROM founders WHERE registration=$1', [reg.number])).rows[0];
      if (had) {
        row = had; again = true;
        if (!row.ref) row = (await db.query('UPDATE founders SET ref=$1 WHERE id=$2 RETURNING *', [newRef(), row.id])).rows[0];
      } else {
        const pos = (await db.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM founders WHERE area=$1', [pc.area])).rows[0].p;
        const by = refIn ? (await db.query('SELECT ref FROM founders WHERE ref=$1', [refIn])).rows[0] : null;   // only a real code counts
        for (let i = 0; ; i++) {
          try {
            await db.query('SAVEPOINT ins');
            row = (await db.query(`INSERT INTO founders (postcode,area,business,mobile,registration,register_name,tier,register_expiry,position,name,email,support_cleanupuk,crew,consent_text,consent_at,ref,referred_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,now(),$14,$15) RETURNING *`,
              [pc.full, pc.area, business, mob, reg.number, r.name || '', r.tier, r.expiry || '', pos, nm, em, crew, CONSENT_TEXT, newRef(), by ? by.ref : null])).rows[0];
            break;
          } catch (e) { await db.query('ROLLBACK TO SAVEPOINT ins'); if (!/founders_ref/.test(e.message) || i > 5) throw e; }  // share code clash: try another
        }
      }
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); console.error('founders save failed', e.message); return fail('Something went wrong on our side, and nothing was saved. Please try again.', undefined, 500); }
    finally { db.release(); }
    if (!again) {
      const by = row.referred_by ? (await pool.query('SELECT name, business FROM founders WHERE ref=$1', [row.referred_by]).catch(() => ({ rows: [] }))).rows[0] : null;
      const text = `New founder application\n\nName: ${row.name}\nBusiness: ${row.business}\nMobile: ${row.mobile}\nEmail: ${row.email}\nRegister name: ${row.register_name}\nRegistration: ${row.registration} (${row.tier} tier, expires ${row.register_expiry})\nPostcode: ${row.postcode}\nArea: ${row.area}\nPlace: ${row.position} of ${PLACES}${row.position > PLACES ? ' (waiting list)' : ''}\n\nSupports Clean Up UK: yes\nClean Up Crew: ${row.crew ? 'YES, add to the Crew' : 'no'}\nConsent to text and email: yes (${new Date(row.consent_at).toISOString()}): "${row.consent_text}"\nReferred by: ${by ? by.name + ', ' + by.business + ' (' + row.referred_by + ')' : 'nobody'}\nShare code: ${row.ref}\n\nAll applications: ${ORIGIN}/admin/founders`;
      mail.send({ to: TO, subject: `Founder application: ${row.business} (${row.area}, place ${row.position})`, text }).catch(() => {});
    }
    res.json({ ok: true, position: row.position, area: row.area, ref: row.ref, link: ORIGIN + '/?ref=' + row.ref, message: (again ? 'You have already applied. ' : '') + placeText(row.area, row.position) });
  });

  // ---------- admin: applications by area, with the count per area ----------
  app.get('/admin/founders', auth, async (req, res, next) => { try {
    const rows = (await pool.query('SELECT * FROM founders ORDER BY area, position')).rows;
    const areas = [...new Set(rows.map(r => r.area))];
    const when = d => new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' });
    // "Order" puts people who brought other carriers higher up their area's list: joined place minus the carriers who joined with their link
    const nRef = r => rows.filter(x => x.referred_by && x.referred_by === r.ref).length;
    const who = code => { const x = rows.find(y => y.ref === code); return x ? `${esc(x.name || x.business)} (${esc(code)})` : ''; };
    const blocks = areas.map(a => { const rs = rows.filter(r => r.area === a).sort((x, y) => (x.position - nRef(x)) - (y.position - nRef(y)) || x.position - y.position), taken = Math.min(rs.length, PLACES);
      return `<h2>${esc(a)} <small>${taken} of ${PLACES} places taken${rs.length > PLACES ? `, ${rs.length - PLACES} waiting` : ''}</small></h2>
<div class="w"><table style="min-width:1100px"><thead><tr><th>Order</th><th>Joined as</th><th>When</th><th>Name</th><th>Business</th><th>Mobile</th><th>Email</th><th>Registration</th><th>Register name</th><th>Postcode</th><th>Clean Up Crew</th><th>Referred by</th><th>Brought in</th><th>Texts OK</th><th></th></tr></thead><tbody>${rs.map((r, i) => `<tr><td>${i + 1}${i + 1 > PLACES ? ' (waiting)' : ''}</td><td>${r.position}</td><td>${when(r.created_at)}</td><td>${esc(r.name)}</td><td>${esc(r.business)}</td><td>${esc(r.mobile)}</td><td>${esc(r.email)}</td><td>${esc(r.registration)}</td><td>${esc(r.register_name)}</td><td>${esc(r.postcode)}</td><td>${r.crew ? '<b>Yes</b>' : ''}</td><td>${who(r.referred_by)}</td><td>${nRef(r) || ''}</td><td>${r.consent_at ? when(r.consent_at) : ''}</td><td><form method="post" action="/admin/founders/delete" onsubmit="return confirm('Delete this application?')"><input type="hidden" name="id" value="${r.id}"><button type="submit">Delete</button></form></td></tr>`).join('')}</tbody></table></div>`; }).join('');
    const summary = areas.map(a => { const n = rows.filter(r => r.area === a).length; return `<tr><td>${esc(a)}</td><td>${Math.min(n, PLACES)} of ${PLACES}</td><td>${n > PLACES ? n - PLACES : ''}</td></tr>`; }).join('');
    res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Founders · admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff;max-width:1200px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}nav a{padding:8px 14px;border-radius:18px;border:1px solid #F0B8AE;color:#1F2124;text-decoration:none;font-weight:600}nav a.on{background:#1F2124;color:#fff}h2{margin:26px 0 8px}h2 small{font-weight:400;color:#555;font-size:15px}.w{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e5e5e5}th{background:#f6f6f6}</style></head><body>
<nav><a href="/admin">Overview</a><a href="/admin/founders" class="on">Founders</a><a href="/founders" target="_blank" rel="noopener">View page</a></nav>
<h1>Founder applications</h1><p>${rows.length} application${rows.length === 1 ? '' : 's'} in ${areas.length} area${areas.length === 1 ? '' : 's'}.</p>
${rows.length ? `<h2>Places by area</h2><div class="w"><table><thead><tr><th>Area</th><th>Places taken</th><th>Waiting</th></tr></thead><tbody>${summary}</tbody></table></div>${blocks}` : '<p>No applications yet.</p>'}
</body></html>`);
  } catch (e) { next(e); } });

  // delete one application (a test, or a mistake); the register number is free to apply again
  app.post('/admin/founders/delete', auth, sameOrigin, express.urlencoded({ extended: false, limit: '1kb' }), async (req, res, next) => { try {
    const id = parseInt(req.body && req.body.id, 10);
    if (id > 0) await pool.query('DELETE FROM founders WHERE id=$1', [id]);
    res.redirect('/admin/founders');
  } catch (e) { next(e); } });

  return { init, placeText, home };
};
module.exports.postcode = postcode; module.exports.mobile = mobile; module.exports.registration = registration; module.exports.PLACES = PLACES; module.exports.personName = personName; module.exports.emailOf = emailOf; module.exports.CONSENT_TEXT = CONSENT_TEXT;
