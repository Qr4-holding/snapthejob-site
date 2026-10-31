// CleanUpPic founder places: the /founders page, the application form (checked against the Environment Agency register),
// the founders table, an email to the team, and the admin list. Only switched on for skins with "founders": true.
const fs = require('fs');
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
// what the person typed as the carrier registration: { ok, number } or { ok:false, error }
function registration(raw) {
  const n = ea.normNumber(raw);
  if (!n) return { ok: false, error: 'Add your carrier registration number. It looks like CBDU123456.' };
  if (/^CBDL\d+$/.test(n)) return { ok: false, error: 'Founder places are for upper-tier carriers. A number starting CBDL is lower tier.' };
  if (!/^CBDU\d{6}$/.test(n)) return { ok: false, error: 'A carrier registration is CBDU followed by six numbers, like CBDU123456. Check it and try again.' };
  return { ok: true, number: n };
}

module.exports = function setupFounders({ app, pool, auth, sameOrigin, esc, SKIN, limited, ORIGIN, express, fetchImpl }) {
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const lookup = number => ea.lookup(number, fetchImpl ? { fetchImpl } : {});
  const TO = process.env.FOUNDERS_EMAIL || 'hello@cleanuppic.co.uk';

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS founders (
      id SERIAL PRIMARY KEY, postcode TEXT NOT NULL, area TEXT NOT NULL, business TEXT NOT NULL, mobile TEXT NOT NULL,
      registration TEXT NOT NULL UNIQUE, register_name TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '', register_expiry TEXT NOT NULL DEFAULT '',
      position INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('CREATE INDEX IF NOT EXISTS founders_area ON founders (area, position)');
  }

  const placeText = (area, position) => position <= PLACES
    ? `You're founder place ${position} of ${PLACES} for ${area}. We'll text you when your place is confirmed.`
    : `The ${PLACES} founder places for ${area} are taken. You're number ${position - PLACES} on the waiting list for ${area}, and we'll text you if a place opens.`;

  app.get('/founders', (req, res) => res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' }).type('html').send(fs.readFileSync(PAGE, 'utf8')));

  app.post('/api/founders', express.json({ limit: '5kb' }), async (req, res) => {
    const b = req.body || {};
    const fail = (error, field, status = 400) => res.status(status).json({ ok: false, error, field });
    if (b.website) return res.json({ ok: true, message: 'Thank you.' });                     // honeypot: bots fill this
    if (limited(req.ip)) return fail('Too many tries from this connection. Please try again in an hour.', undefined, 429);
    const pc = postcode(b.postcode), business = clean(b.business, 120), mob = mobile(b.mobile), reg = registration(b.registration);
    if (!pc) return fail("That postcode doesn't look right. Use your business postcode, like LS1 1UR.", 'postcode');
    if (business.length < 2) return fail('Add your business name.', 'business');
    if (!mob) return fail('That mobile number doesn\'t look right. A UK mobile starts 07 and has 11 numbers, like 07123 456789.', 'mobile');
    if (!reg.ok) return fail(reg.error, 'registration');
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
      if (had) { row = had; again = true; }
      else {
        const pos = (await db.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM founders WHERE area=$1', [pc.area])).rows[0].p;
        row = (await db.query(`INSERT INTO founders (postcode,area,business,mobile,registration,register_name,tier,register_expiry,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [pc.full, pc.area, business, mob, reg.number, r.name || '', r.tier, r.expiry || '', pos])).rows[0];
      }
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); console.error('founders save failed', e.message); return fail('Something went wrong on our side, and nothing was saved. Please try again.', undefined, 500); }
    finally { db.release(); }
    if (!again) {
      const text = `New founder application\n\nBusiness: ${row.business}\nRegister name: ${row.register_name}\nRegistration: ${row.registration} (${row.tier} tier, expires ${row.register_expiry})\nMobile: ${row.mobile}\nPostcode: ${row.postcode}\nArea: ${row.area}\nPlace: ${row.position} of ${PLACES}${row.position > PLACES ? ' (waiting list)' : ''}\n\nAll applications: ${ORIGIN}/admin/founders`;
      mail.send({ to: TO, subject: `Founder application: ${row.business} (${row.area}, place ${row.position})`, text }).catch(() => {});
    }
    res.json({ ok: true, position: row.position, area: row.area, message: (again ? 'You have already applied. ' : '') + placeText(row.area, row.position) });
  });

  // ---------- admin: applications by area, with the count per area ----------
  app.get('/admin/founders', auth, async (req, res, next) => { try {
    const rows = (await pool.query('SELECT * FROM founders ORDER BY area, position')).rows;
    const areas = [...new Set(rows.map(r => r.area))];
    const when = d => new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' });
    const blocks = areas.map(a => { const rs = rows.filter(r => r.area === a), taken = Math.min(rs.length, PLACES);
      return `<h2>${esc(a)} <small>${taken} of ${PLACES} places taken${rs.length > PLACES ? `, ${rs.length - PLACES} waiting` : ''}</small></h2>
<div class="w"><table><thead><tr><th>Place</th><th>When</th><th>Business</th><th>Register name</th><th>Registration</th><th>Mobile</th><th>Postcode</th></tr></thead><tbody>${rs.map(r => `<tr><td>${r.position}${r.position > PLACES ? ' (waiting)' : ''}</td><td>${when(r.created_at)}</td><td>${esc(r.business)}</td><td>${esc(r.register_name)}</td><td>${esc(r.registration)}</td><td>${esc(r.mobile)}</td><td>${esc(r.postcode)}</td></tr>`).join('')}</tbody></table></div>`; }).join('');
    const summary = areas.map(a => { const n = rows.filter(r => r.area === a).length; return `<tr><td>${esc(a)}</td><td>${Math.min(n, PLACES)} of ${PLACES}</td><td>${n > PLACES ? n - PLACES : ''}</td></tr>`; }).join('');
    res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Founders · admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff;max-width:1200px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}nav a{padding:8px 14px;border-radius:18px;border:1px solid #F0B8AE;color:#1F2124;text-decoration:none;font-weight:600}nav a.on{background:#1F2124;color:#fff}h2{margin:26px 0 8px}h2 small{font-weight:400;color:#555;font-size:15px}.w{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e5e5e5}th{background:#f6f6f6}</style></head><body>
<nav><a href="/admin">Overview</a><a href="/admin/founders" class="on">Founders</a><a href="/founders" target="_blank" rel="noopener">View page</a></nav>
<h1>Founder applications</h1><p>${rows.length} application${rows.length === 1 ? '' : 's'} in ${areas.length} area${areas.length === 1 ? '' : 's'}.</p>
${rows.length ? `<h2>Places by area</h2><div class="w"><table><thead><tr><th>Area</th><th>Places taken</th><th>Waiting</th></tr></thead><tbody>${summary}</tbody></table></div>${blocks}` : '<p>No applications yet.</p>'}
</body></html>`);
  } catch (e) { next(e); } });

  return { init, placeText };
};
module.exports.postcode = postcode; module.exports.mobile = mobile; module.exports.registration = registration; module.exports.PLACES = PLACES;
