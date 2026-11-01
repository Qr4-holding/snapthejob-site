// Founder form tests. Needs a Postgres: DATABASE_URL=postgres://... node test/founders.js
// The Environment Agency register is replaced by a fake so every case (tiers, dates, unknown numbers, register down) can be tested.
process.env.MAIL_TEST = '1';
const express = require('express');
const { Pool } = require('pg');
const F = require('../founders');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

// ---- pure rules
ok('postcodes are tidied and give a district', JSON.stringify(F.postcode(' ls12 2py ')) === '{"full":"LS12 2PY","area":"LS12"}' && F.postcode('LS1 1UR').area === 'LS1' && F.postcode('M1 1AE').area === 'M1' && F.postcode('EC1A 1BB').area === 'EC1A' && F.postcode('nonsense') === null && F.postcode('') === null);
ok('mobiles are tidied; landlines and short numbers refused', F.mobile('07123 456789') === '07123 456789' && F.mobile('+44 7123 456789') === '07123 456789' && F.mobile('0044 7123456789') === '07123 456789' && F.mobile('0113 496 0000') === null && F.mobile('0712345') === null && F.mobile('') === null);
ok('CBDU plus six numbers passes', F.registration('cbdu 123456').ok && F.registration('CBDU123456').number === 'CBDU123456');
ok('a lower-tier number gets the upper-tier message', /upper-tier carriers/.test(F.registration('CBDL123456').error));
ok('a badly shaped number says what it should look like', /CBDU followed by six numbers/.test(F.registration('CBDU12').error) && /CBDU123456/.test(F.registration('').error));

const REG = {
  CBDU111111: { tier: 'Upper', name: 'Dale Valley Clearances Ltd', expiry: '2099-01-01' },
  CBDU222222: { tier: 'Upper', name: 'Hill Top Waste', expiry: '2099-01-01' },
  CBDU333333: { tier: 'Lower', name: 'Lower Tier Co', expiry: '2099-01-01' },
  CBDU444444: { tier: 'Upper', name: 'Ran Out Ltd', expiry: '2020-01-01' }
};
let down = false;
const fakeFetch = async url => {
  if (down) throw new Error('down');
  const n = (/registration\/([A-Z0-9]+)\.json/.exec(url) || [])[1], r = REG[n];
  if (!r) return { status: 404, ok: false, json: async () => ({}) };
  return { status: 200, ok: true, json: async () => ({ items: [{ registrationNumber: n, tier: { notation: r.tier }, holder: { name: r.name }, registrationDate: '2024-01-01', expiryDate: r.expiry }] }) };
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS founders');
  const app = express(); app.set('trust proxy', 1);
  const auth = (req, res, next) => (req.headers.authorization === 'Basic ' + Buffer.from('admin:pw').toString('base64') ? next() : res.status(401).end());
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = F({ app, pool, auth, sameOrigin: (q, s, n) => n(), esc, SKIN: {}, limited: () => false, ORIGIN: 'https://x.test', express, fetchImpl: fakeFetch });
  await f.init();
  const server = app.listen(0); const B = 'http://localhost:' + server.address().port;
  const post = async b => { const r = await fetch(B + '/api/founders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
  const good = (o = {}) => ({ name: 'Dave Dale', postcode: 'LS12 2PY', business: 'Dale Valley Clearances', mobile: '07123 456789', email: 'Dave@Dale.example', registration: 'CBDU111111', support: true, crew: false, consent: true, ...o });
  const rows = async () => (await pool.query('SELECT * FROM founders ORDER BY id')).rows;

  let r = await post(good({ postcode: 'xx' })); ok('bad postcode: plain words, names the field, nothing saved', r.s === 400 && r.j.field === 'postcode' && /postcode doesn't look right/.test(r.j.error) && (await rows()).length === 0);
  r = await post(good({ business: ' ' })); ok('missing business name', r.j.field === 'business' && /business name/.test(r.j.error));
  r = await post(good({ mobile: '0113 496 0000' })); ok('a landline is not a mobile', r.j.field === 'mobile' && /UK mobile starts 07/.test(r.j.error));
  r = await post(good({ registration: 'CBDL123456' })); ok('lower-tier number: "Founder places are for upper-tier carriers"', r.j.field === 'registration' && /Founder places are for upper-tier carriers/.test(r.j.error));
  r = await post(good({ registration: 'CBDU999999' })); ok('unknown number: says so and saves nothing', r.s === 400 && /can't find that number on the Environment Agency register/.test(r.j.error) && (await rows()).length === 0);
  r = await post(good({ registration: 'CBDU333333' })); ok('a number the register says is lower tier is refused', /upper-tier/.test(r.j.error) && (await rows()).length === 0);
  r = await post(good({ registration: 'CBDU444444' })); ok('an expired registration is refused with its date', /ran out on 01\/01\/2020/.test(r.j.error) && (await rows()).length === 0);
  down = true; r = await post(good()); ok('register unreachable: try again later, nothing saved', r.s === 503 && /couldn't reach the Environment Agency register/.test(r.j.error) && (await rows()).length === 0); down = false;
  r = await post({ ...good(), website: 'http://spam' }); ok('the hidden spam field is ignored and saves nothing', r.j.ok === true && (await rows()).length === 0);

  r = await post(good()); let d = (await rows())[0];
  ok('a good application takes place 1 of 10 for the district', r.s === 200 && r.j.message === "You're founder place 1 of 10 for LS12. We'll text you when your place is confirmed." && d.position === 1 && d.area === 'LS12');
  ok('the saved row holds postcode, area, business, mobile, registration, register name, tier, date and position', d.postcode === 'LS12 2PY' && d.business === 'Dale Valley Clearances' && d.mobile === '07123 456789' && d.registration === 'CBDU111111' && d.register_name === 'Dale Valley Clearances Ltd' && d.tier === 'upper' && !!d.created_at);
  r = await post(good()); ok('applying again with the same registration does not take a second place', /already applied/.test(r.j.message) && /place 1 of 10/.test(r.j.message) && (await rows()).length === 1);
  r = await post(good({ registration: 'CBDU222222', postcode: 'ls12 9zz', business: 'Hill Top' })); ok('the next person in the same district is place 2', /place 2 of 10 for LS12/.test(r.j.message));
  r = await post(good({ registration: 'CBDU222222', postcode: 'M1 1AE' })); ok('a different district is counted separately (same carrier is not duplicated)', /already applied/.test(r.j.message));

  // ---- the agreed sign-up form: name, email, the three tick boxes, consent record, share link
  d = (await rows())[0];
  ok('name, email (lower-cased), support tick, no crew, consent wording and date are stored', d.name === 'Dave Dale' && d.email === 'dave@dale.example' && d.support_cleanupuk === true && d.crew === false && d.consent_text === F.CONSENT_TEXT && d.consent_at instanceof Date && Math.abs(Date.now() - d.consent_at) < 60000);
  ok('the consent wording is the exact line on the page', F.CONSENT_TEXT === 'Text and email me about my founder place.');
  ok('the first application got a share code (6 letters and numbers)', /^[a-z0-9]{6}$/.test(d.ref));
  r = await post(good({ name: ' ' })); ok('missing name', r.j.field === 'name' && /name/.test(r.j.error));
  r = await post(good({ email: 'dave@' })); ok('a bad email says so', r.j.field === 'email' && /email address doesn't look right/.test(r.j.error));
  r = await post(good({ registration: 'CBDU222222', support: false })); ok('the Clean Up UK tick is required', r.j.field === 'support' && /I support Clean Up UK/.test(r.j.error));
  r = await post(good({ registration: 'CBDU222222', consent: false })); ok('the consent tick is required', r.j.field === 'consent' && /text and email you/.test(r.j.error));
  r = await post(good({ registration: 'CBDU222222', support: 'yes' })); ok('only a real tick counts (not the word "yes")', r.j.field === 'support');
  REG.CBDU700001 = { tier: 'Upper', name: 'Crew Man Ltd', expiry: '2099-01-01' }; REG.CBDU700002 = { tier: 'Upper', name: 'Friend Ltd', expiry: '2099-01-01' }; REG.CBDU700003 = { tier: 'Upper', name: 'Stranger Ltd', expiry: '2099-01-01' };
  r = await post(good({ registration: 'CBDU700001', name: 'Cathy Crew', business: 'Crew Man', postcode: 'B1 1AA', crew: true })); const crewRow = (await rows()).find(x => x.registration === 'CBDU700001');
  ok('the Clean Up Crew tick is stored and the success message is unchanged, with a share link', crewRow.crew === true && /place 1 of 10 for B1\. We'll text you when your place is confirmed\.$/.test(r.j.message) && r.j.link === 'https://x.test/?ref=' + crewRow.ref && r.j.ref === crewRow.ref);
  r = await post(good({ registration: 'CBDU700002', name: 'Fred Friend', business: 'Friend', postcode: 'B1 2AA', ref: crewRow.ref.toUpperCase() })); const friend = (await rows()).find(x => x.registration === 'CBDU700002');
  ok('a friend who joins with the share link is stored against the person who sent it', friend.referred_by === crewRow.ref && friend.ref && friend.ref !== crewRow.ref);
  r = await post(good({ registration: 'CBDU700003', name: 'Sam Stranger', business: 'Stranger', postcode: 'B1 3AA', ref: 'zzzzzz' })); const stranger = (await rows()).find(x => x.registration === 'CBDU700003');
  ok('a made-up share code is ignored (still saved, referred by nobody)', stranger && stranger.referred_by === null);
  const adm0 = await (await fetch(B + '/admin/founders', { headers: { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') } })).text();
  ok('the admin list shows who referred whom and who is in the Clean Up Crew', />Cathy Crew \(/.test(adm0) && new RegExp('Cathy Crew \\(' + crewRow.ref + '\\)').test(adm0) && /<b>Yes<\/b>/.test(adm0) && /dave@dale\.example/.test(adm0));
  const order = [...adm0.matchAll(/<tr><td>(\d+)<\/td><td>(\d+)<\/td>.*?<td>(Cathy Crew|Fred Friend|Sam Stranger)<\/td>/g)].filter(m => true).map(m => m[3] + ':' + m[1]);
  ok('the person who brought a friend moves up the list in their area (B1: Cathy 1st, Fred 2nd, Sam 3rd)', order.join() === 'Cathy Crew:1,Fred Friend:2,Sam Stranger:3', order.join());
  const pg = await (await fetch(B + '/founders')).text();
  ok('the page form has the fields in order, the three tick boxes and the exact wording', pg.indexOf('id="fname"') < pg.indexOf('id="business"') && pg.indexOf('id="business"') < pg.indexOf('id="mobile"') && pg.indexOf('id="mobile"') < pg.indexOf('id="email"') && pg.indexOf('id="email"') < pg.indexOf('id="reg"') && pg.indexOf('id="reg"') < pg.indexOf('id="postcode"') && pg.indexOf('id="postcode"') < pg.indexOf('id="support"') && pg.includes('I support Clean Up UK') && pg.includes("I'm a registered waste carrier and keep my registration current. Every load goes to a licensed site and I keep the ticket. I log every job in the app. I don't fly-tip, and I report it when I see it. If fly-tipping is proven against me, I'm off Clean Up UK and off the app.") && pg.includes('Add me to the Clean Up Crew') && pg.includes("Clear up to one fly-tip a month in your area when we ask. You're paid in free quote requests from customers near you, and you go to the front of the queue in that area for 30 days after each clearance.") && pg.includes(F.CONSENT_TEXT));
  ok('the page says locked for 12 months and never 24', /locked for 12 months/.test(pg) && !/24 months/.test(pg));
  ok('the page says Know another registered carrier ... you move up the list', /Know another registered carrier\? Send them this\.<\/b> When they join, you move up the list\./.test(pg));

  // fill LS12 with the rest, and race: many at once must get distinct places
  for (let i = 0; i < 12; i++) REG['CBDU5' + String(10000 + i)] = { tier: 'Upper', name: 'Race ' + i, expiry: '2099-01-01' };
  const race = await Promise.all(Array.from({ length: 12 }, (_, i) => post(good({ registration: 'CBDU5' + (10000 + i), business: 'Race ' + i, postcode: 'LS12 3AA' }))));
  const pos = (await pool.query("SELECT position FROM founders WHERE area='LS12' ORDER BY position")).rows.map(x => x.position);
  ok('12 applications at the same moment get 12 different places (no duplicates, no gaps)', race.every(x => x.s === 200) && JSON.stringify(pos) === JSON.stringify(Array.from({ length: 14 }, (_, i) => i + 1)), pos.join(','));
  const full = race.map(x => x.j.message).filter(m => /taken/.test(m));
  ok('after place 10 the person is told the area is full and where they are on the waiting list', full.length === 4 && full.every(m => /The 10 founder places for LS12 are taken\. You're number \d+ on the waiting list for LS12/.test(m)), JSON.stringify(full));
  r = await post(good({ registration: 'CBDU222222', postcode: 'LS1 1UR' })); ok('(already applied) message after the area filled', /already applied/.test(r.j.message));
  REG.CBDU611111 = { tier: 'Upper', name: 'Leeds Centre', expiry: '2099-01-01' };
  r = await post(good({ registration: 'CBDU611111', postcode: 'LS1 1UR' })); ok('a new district starts again at place 1', /place 1 of 10 for LS1\./.test(r.j.message));

  // admin
  ok('the admin list needs the admin sign-in', (await fetch(B + '/admin/founders')).status === 401);
  const html = await (await fetch(B + '/admin/founders', { headers: { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') } })).text();
  ok('the admin list shows applications by area with the count per area', />LS12</.test(html) && /10 of 10 places taken, 4 waiting/.test(html) && />LS1</.test(html) && /1 of 10 places taken/.test(html) && /Race 3/.test(html) && /CBDU611111/.test(html));
  ok('names are escaped in the admin list', !/<script/.test(html));
  const x = await post(good({ registration: 'CBDU222222', business: '<script>alert(1)</script>' }));
  const html2 = await (await fetch(B + '/admin/founders', { headers: { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') } })).text();
  ok('an <script> in a business name cannot reach the admin page', !/<script>alert/.test(html2));

  server.close(); await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
