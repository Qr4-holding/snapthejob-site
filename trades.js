// Trades / waste carriers: sign in once on their phone, post a job from photos, see their jobs.
// Photos are re-rendered into the brand's before/after video by video/engine.py (so no hidden
// photo data such as location is ever published), and the job waits for the owner's approval in /admin/jobs.
// Switched on by "trades": true in the skin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const multer = require('multer');
const sharp = require('sharp');

const MEDIA_DIR = process.env.MEDIA_DIR || '/data/media';
const JOB_DIR = path.join(MEDIA_DIR, 'jobs');
const WORK_DIR = path.join(MEDIA_DIR, 'render');
const ENGINE = path.join(__dirname, 'video', 'engine.py');
const PYTHON = process.env.PYTHON || 'python3';
const DAY = 864e5;

module.exports = function setupTrades({ app, pool, esc, slugify, SKIN, TRADES, limited, reloadJobs, sendPush, page, tpl }) {
  for (const d of [JOB_DIR, WORK_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
  const C = Object.assign({ iAm: "I'm a trade", noun: 'trade', nounCap: 'Trade', catLabel: 'Trade', jobWord: 'job' }, SKIN.tradeCopy || {});
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
  const checkPw = (pw, stored) => {
    const [salt, h] = String(stored || ':').split(':');
    if (!salt || !h) return false;
    const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex')), b = Buffer.from(h);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => execFile(cmd, args, Object.assign({ maxBuffer: 1 << 24 }, opts), (e, so, se) => e ? reject(new Error((se || '').trim() || e.message)) : resolve(so)));
  const upload = multer({
    dest: WORK_DIR,
    limits: { fileSize: 25 * 1024 * 1024, files: 6, fields: 10, fieldSize: 5000 },
    fileFilter: (req, file, cb) => cb(null, (['before', 'during', 'after'].includes(file.fieldname) && /^image\//.test(file.mimetype)) || (file.fieldname === 'voice' && /^(audio|video)\//.test(file.mimetype)))
  });

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
      trade TEXT, services TEXT[] DEFAULT '{}', town TEXT, status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS biz_sessions (token TEXT PRIMARY KEY, biz_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, expires TIMESTAMPTZ NOT NULL)`);
    await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS biz_id INT');
    await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT true');
    await pool.query("DELETE FROM biz_sessions WHERE expires < now()").catch(() => {});
    // a render that was cut off by a restart would stay "processing" for ever: mark it failed so the carrier can post again
    await pool.query(`UPDATE jobs SET status='failed', error='The server restarted while the video was being made. Please post it again.' WHERE status='processing' AND biz_id IS NOT NULL AND created_at < now() - interval '20 minutes'`).catch(() => {});
  }

  // ---------- sessions (a cookie on the carrier's phone; they sign in once) ----------
  const cookies = req => Object.fromEntries((req.get('cookie') || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  async function current(req) {
    const t = cookies(req).tsess;
    if (!t || !/^[a-f0-9]{48}$/.test(t)) return null;
    const r = (await pool.query('SELECT b.* FROM biz_sessions s JOIN businesses b ON b.id=s.biz_id WHERE s.token=$1 AND s.expires > now() AND b.status=$2', [t, 'active'])).rows[0];
    return r || null;
  }
  async function signIn(res, bizId) {
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query('INSERT INTO biz_sessions (token,biz_id,expires) VALUES ($1,$2,now() + interval \'180 days\')', [token, bizId]);
    res.append('Set-Cookie', `tsess=${token}; Path=/; Max-Age=${180 * 86400}; HttpOnly; Secure; SameSite=Lax`);
    res.append('Set-Cookie', `trade=1; Path=/; Max-Age=${180 * 86400}; Secure; SameSite=Lax`); // readable by the page: shows "Post a job"
  }
  const signOut = (res, token) => {
    if (token) pool.query('DELETE FROM biz_sessions WHERE token=$1', [token]).catch(() => {});
    res.append('Set-Cookie', 'tsess=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    res.append('Set-Cookie', 'trade=; Path=/; Max-Age=0; Secure; SameSite=Lax');
  };
  const sameOrigin = (req, res, next) => { const o = req.get('origin'); if (o && new URL(o).host !== req.get('host')) return res.status(403).send('Not allowed'); next(); };

  // ---------- pages (use the site's own look: header, footer and tab bar come from the shared template) ----------
  const wrap = (title, body) => page(tpl.app, { title: `${title} · ${SKIN.name}`, desc: `${C.nounCap} area on ${SKIN.name}.`, url: '/trade' })
    .replace(/<main class="wrap app-page">[\s\S]*?<\/main>/, `<main class="wrap trade-page"><meta name="robots" content="noindex">${body}</main>`);
  const field = (label, inner) => `<label class="f">${label}${inner}</label>`;
  const err = m => m ? `<p class="err" role="alert" style="margin:0 0 10px">${esc(m)}</p>` : '';
  const signInPage = (msg = '', tab = 'in', vals = {}) => wrap(C.iAm, `
<h1 class="disp" style="font-size:30px;margin:0 0 6px">${esc(C.iAm)}</h1>
<p style="margin:0 0 16px">Sign in once on this phone. After that, ${SKIN.name} remembers you and the big button on the home page becomes <b>Post a ${esc(C.jobWord)}</b>.</p>
<div class="seg" role="tablist"><a href="/trade" role="tab" aria-selected="${tab === 'in'}">Sign in</a><a href="/trade?new=1" role="tab" aria-selected="${tab === 'new'}">Create account</a></div>
${err(msg)}
<form method="post" action="${tab === 'in' ? '/trade/login' : '/trade/signup'}" class="tform">
<label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
${tab === 'new' ? field('Business name', `<input name="name" required maxlength="80" autocomplete="organization" value="${esc(vals.name || '')}">`) : ''}
${field('Email', `<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(vals.email || '')}">`)}
${field(tab === 'new' ? 'Choose a password (8 or more characters)' : 'Password', `<input name="password" type="password" required minlength="${tab === 'new' ? 8 : 1}" autocomplete="${tab === 'new' ? 'new-password' : 'current-password'}">`)}
${tab === 'new' ? field(C.catLabel, `<select name="trade" required><option value="">Choose…</option>${TRADES.map(t => `<option${t === vals.trade ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`) + field('Town or area you cover', `<input name="town" maxlength="60" value="${esc(vals.town || '')}">`) : ''}
<button class="send disp" type="submit">${tab === 'new' ? 'Create account' : 'Sign in'}</button>
<p class="small" style="margin:0;text-align:center">${tab === 'new' ? `By creating an account you agree your ${esc(C.jobWord)} videos can be shown on ${esc(SKIN.name)} once approved. <a href="/privacy">Privacy</a>` : `No account yet? <a href="/trade?new=1">Create one</a>. Forgotten your password? <a href="/contact">Contact us</a>.`}</p>
</form>`);

  const statusPill = r => r.status === 'processing' ? '<span class="tpill">Making your video…</span>' : r.status === 'failed' ? '<span class="tpill bad">Video failed. Try again with clearer photos.</span>' : !r.approved ? '<span class="tpill wait">Waiting for approval</span>' : r.hidden ? '<span class="tpill">Hidden</span>' : '<span class="tpill live">Live</span>';
  const jobsPage = (biz, jobs, msg = '', bad = '') => wrap('My ' + C.jobWord + 's', `${jobs.some(r => r.status === 'processing') ? '<meta http-equiv="refresh" content="8">' : ''}
<div class="trade-head"><div><h1 class="disp" style="font-size:28px;margin:0">${esc(biz.name)}</h1><p class="small" style="margin:2px 0 0">${esc(biz.trade || '')}${biz.town ? ' · ' + esc(biz.town) : ''}</p></div>
<form method="post" action="/trade/logout" style="margin:0"><button class="btn" type="submit" style="min-height:40px">Sign out</button></form></div>
${msg ? `<p class="tflash">${esc(msg)}</p>` : ''}
<section id="post" class="tpost">
<h2 class="disp" style="font-size:22px;margin:0 0 4px">Post a ${esc(C.jobWord)}</h2>
<p class="small" style="margin:0 0 12px">Take the photos now or pick them from your gallery. We turn them into your before and after video; it goes live once ${esc(SKIN.name)} has checked it.</p>
${err(bad)}
<form method="post" action="/trade/jobs" enctype="multipart/form-data" class="tform" id="postForm">
<div class="shots">
<label class="shot"><span class="shot-l before">BEFORE</span><input type="file" name="before" accept="image/*" required><span class="shot-h">Tap to add</span><img alt="" hidden></label>
<label class="shot"><span class="shot-l during">DURING</span><input type="file" name="during" accept="image/*"><span class="shot-h">Optional</span><img alt="" hidden></label>
<label class="shot"><span class="shot-l after">AFTER</span><input type="file" name="after" accept="image/*" required><span class="shot-h">Tap to add</span><img alt="" hidden></label>
<label class="shot extra" hidden><span class="shot-l during">DURING</span><input type="file" name="during" accept="image/*"><span class="shot-h">Optional</span><img alt="" hidden></label>
<label class="shot extra" hidden><span class="shot-l during">DURING</span><input type="file" name="during" accept="image/*"><span class="shot-h">Optional</span><img alt="" hidden></label>
</div>
<button type="button" class="btn" id="moreShots" style="align-self:flex-start;min-height:40px">+ Add more "during" photos (up to 5 in all)</button>
<fieldset class="voice"><legend>Voiceover (optional)</legend>
<div class="vrow">
<button type="button" class="btn btn-red" id="recBtn">Record with my mic</button>
<span class="small" id="recState">Say what the job was, in your own words. Up to 30 seconds.</span>
</div>
<audio id="recPlay" controls hidden style="width:100%;margin-top:8px"></audio>
<button type="button" class="btn tdel" id="recClear" hidden style="min-height:36px;margin-top:6px">Remove recording</button>
<input type="file" name="voice" id="voiceFile" accept="audio/*" hidden>
<p class="small" style="margin:8px 0 0">AI voice (Brenda): coming soon.</p>
</fieldset>
${field('What was the ' + esc(C.jobWord) + '? (shown as the title)', `<input name="title" required maxlength="80" placeholder="${esc(C.titleHint || 'Garden cleared: old shed and green waste')}">`)}
${field(C.catLabel, `<select name="trade" required>${TRADES.map(t => `<option${t === biz.trade ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`)}
${field('Anything else? (optional)', `<textarea name="description" maxlength="300" rows="2" placeholder="Area, what you took, how long it took"></textarea>`)}
<label class="chk"><input type="checkbox" name="confirm" required> These are my own photos of my own work, with no house numbers, number plates or people's faces showing.</label>
<button class="send disp" type="submit" id="postBtn">Make my video</button>
</form>
</section>
<h2 class="disp" style="font-size:22px;margin:22px 0 8px">My ${esc(C.jobWord)}s</h2>
${jobs.length ? `<div class="tjobs">${jobs.map(r => `<div class="tjob"><img src="${esc(r.cover || '')}" alt=""><div><b>${esc(r.title)}</b><span class="small">${esc(r.trade)} · ${new Date(r.created_at).toLocaleDateString('en-GB')}</span>${statusPill(r)}
<div class="tjob-a">${r.status === 'ready' && r.approved && !r.hidden ? `<a class="btn" href="/job/${esc(r.slug)}">View</a><a class="btn btn-red" href="${esc(r.video)}" download>Save video</a>` : ''}<form method="post" action="/trade/jobs/${r.id}/delete" onsubmit="return confirm('Delete this ${esc(C.jobWord)} and its video?')" style="margin:0"><button class="btn tdel" type="submit">Delete</button></form></div></div></div>`).join('')}</div>` : `<p class="small">Nothing yet. Your first ${esc(C.jobWord)} will appear here.</p>`}
<script>
(function(){
  document.querySelectorAll('.shot input').forEach(function(i){ i.addEventListener('change', function(){ var f=i.files[0], img=i.parentNode.querySelector('img'), h=i.parentNode.querySelector('.shot-h'); if(!f) return; img.src=URL.createObjectURL(f); img.hidden=false; h.textContent='Change'; i.parentNode.classList.add('has'); }); });
  var f=document.getElementById('postForm'); f.addEventListener('submit', function(){ var b=document.getElementById('postBtn'); b.disabled=true; b.textContent='Uploading… keep this page open'; });
  var more=document.getElementById('moreShots'); more.addEventListener('click', function(){ var n=document.querySelector('.shot.extra[hidden]'); if(n) n.hidden=false; if(!document.querySelector('.shot.extra[hidden]')) more.hidden=true; });
  // mic voiceover: recorded in the browser, sent with the photos
  var rb=document.getElementById('recBtn'), st=document.getElementById('recState'), pl=document.getElementById('recPlay'), cl=document.getElementById('recClear'), vf=document.getElementById('voiceFile'), rec=null, chunks=[], timer=null;
  if(!window.MediaRecorder||!navigator.mediaDevices){ rb.disabled=true; st.textContent='Recording is not available in this browser.'; }
  rb.addEventListener('click', async function(){
    if(rec&&rec.state==='recording'){ rec.stop(); return; }
    try{ var stream=await navigator.mediaDevices.getUserMedia({audio:true}); }catch(e){ st.textContent='Microphone not allowed. Check the browser permission and try again.'; return; }
    var type=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(function(t){ return MediaRecorder.isTypeSupported(t); })||'';
    rec=new MediaRecorder(stream, type?{mimeType:type}:{}); chunks=[];
    rec.ondataavailable=function(e){ if(e.data.size) chunks.push(e.data); };
    rec.onstop=function(){ stream.getTracks().forEach(function(t){ t.stop(); }); clearTimeout(timer);
      var blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'}); var ext=(rec.mimeType||'').indexOf('mp4')>-1?'m4a':(rec.mimeType||'').indexOf('ogg')>-1?'ogg':'webm';
      var dt=new DataTransfer(); dt.items.add(new File([blob],'voice.'+ext,{type:blob.type})); vf.files=dt.files;
      pl.src=URL.createObjectURL(blob); pl.hidden=false; cl.hidden=false; rb.textContent='Record again'; rb.classList.remove('rec-on'); st.textContent='Recorded. Play it back to check, or record again.'; };
    rec.start(); rb.textContent='Stop'; rb.classList.add('rec-on'); st.textContent='Recording… tap Stop when you have finished.';
    timer=setTimeout(function(){ if(rec.state==='recording') rec.stop(); },30000);
  });
  cl.addEventListener('click', function(){ vf.value=''; pl.hidden=true; pl.src=''; cl.hidden=true; rb.textContent='Record with my mic'; st.textContent='Say what the job was, in your own words. Up to 30 seconds.'; });
})();
</script>`);

  // ---------- routes ----------
  app.get('/trade', async (req, res, next) => { try {
    if (await current(req)) return res.redirect(302, '/trade/jobs');
    res.set('Cache-Control', 'no-store').send(signInPage(req.query.m === 'bye' ? 'Signed out.' : '', req.query.new ? 'new' : 'in'));
  } catch (e) { next(e); } });

  const form = require('express').urlencoded({ extended: false, limit: '10kb' });
  app.post('/trade/signup', sameOrigin, form, async (req, res, next) => { try {
    const b = req.body || {};
    if (b.website) return res.redirect(303, '/trade?new=1');
    if (limited && limited(req.ip)) return res.status(429).send(signInPage('Too many tries. Please wait an hour.', 'new', b));
    const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), pw = String(b.password || ''), trade = TRADES.includes(b.trade) ? b.trade : '', town = clean(b.town, 60);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || pw.length < 8 || !trade) return res.status(400).send(signInPage('Please fill in every box; the password needs 8 or more characters.', 'new', b));
    if ((await pool.query('SELECT 1 FROM businesses WHERE email=$1', [email])).rows.length) return res.status(400).send(signInPage('There is already an account with that email. Sign in instead.', 'in', { email }));
    let slug = slugify(name) || 'business', i = 2; const base = slug;
    while ((await pool.query('SELECT 1 FROM businesses WHERE slug=$1', [slug])).rows.length) slug = `${base}-${i++}`;
    const r = (await pool.query('INSERT INTO businesses (slug,name,email,pass_hash,trade,town,last_seen) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id', [slug, name, email, hashPw(pw), trade, town])).rows[0];
    await signIn(res, r.id);
    res.redirect(303, '/trade/jobs?m=welcome');
  } catch (e) { next(e); } });

  app.post('/trade/login', sameOrigin, form, async (req, res, next) => { try {
    const b = req.body || {};
    if (b.website) return res.redirect(303, '/trade');
    if (limited && limited(req.ip)) return res.status(429).send(signInPage('Too many tries. Please wait an hour.', 'in', b));
    const email = clean(b.email, 120).toLowerCase();
    const r = (await pool.query('SELECT * FROM businesses WHERE email=$1', [email])).rows[0];
    if (!r || !checkPw(String(b.password || ''), r.pass_hash) || r.status !== 'active') return res.status(401).send(signInPage('Wrong email or password.', 'in', { email }));
    await pool.query('UPDATE businesses SET last_seen=now() WHERE id=$1', [r.id]);
    await signIn(res, r.id);
    res.redirect(303, '/trade/jobs');
  } catch (e) { next(e); } });

  app.post('/trade/logout', sameOrigin, (req, res) => { signOut(res, cookies(req).tsess); res.redirect(303, '/trade?m=bye'); });

  app.get('/trade/jobs', async (req, res, next) => { try {
    const biz = await current(req);
    if (!biz) return res.redirect(302, '/trade');
    const jobs = (await pool.query('SELECT * FROM jobs WHERE biz_id=$1 ORDER BY created_at DESC', [biz.id])).rows;
    const msg = { welcome: `Welcome to ${SKIN.name}. Post your first ${C.jobWord} below.`, posted: `Got it. Your video is being made now (a minute or two; this page updates by itself). It goes live once ${SKIN.name} has checked it.`, deleted: 'Deleted.' }[req.query.m] || '';
    const bad = { bad: 'Please add a before photo, an after photo, a title and tick the box.', big: 'One of the photos is too large (25 MB max).' }[req.query.m] || '';
    res.set('Cache-Control', 'no-store').send(jobsPage(biz, jobs, msg, bad));
  } catch (e) { next(e); } });

  const uploadSafe = (req, res, next) => upload.fields([{ name: 'before', maxCount: 1 }, { name: 'during', maxCount: 3 }, { name: 'after', maxCount: 1 }, { name: 'voice', maxCount: 1 }])(req, res, e => e ? res.redirect(303, '/trade/jobs?m=' + (e.code === 'LIMIT_FILE_SIZE' ? 'big' : 'bad')) : next());
  app.post('/trade/jobs', sameOrigin, uploadSafe, async (req, res, next) => {
    const files = [].concat(...Object.values(req.files || {}));
    const bin = () => files.forEach(f => fs.unlink(f.path, () => {}));
    try {
      const biz = await current(req);
      if (!biz) { bin(); return res.redirect(302, '/trade'); }
      const b = req.body || {};
      const before = (req.files.before || [])[0], after = (req.files.after || [])[0], during = (req.files.during || []).slice(0, 3), voice = (req.files.voice || [])[0];
      const title = clean(b.title, 80), trade = TRADES.includes(b.trade) ? b.trade : biz.trade;
      if (!before || !after || !title || !b.confirm || !trade) { bin(); return res.redirect(303, '/trade/jobs?m=bad'); }
      let slug = slugify(title) || 'job', i = 2; const base = slug;
      while ((await pool.query('SELECT 1 FROM jobs WHERE slug=$1', [slug])).rows.length) slug = `${base}-${i++}`;
      const initials = (biz.name.match(/[A-Za-z0-9]+/g) || ['S', 'J']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      const stages = during.length ? ['BEFORE', 'DURING', 'AFTER'] : ['BEFORE', 'AFTER'];
      const files = [before, ...during, after];
      const top = (await pool.query('SELECT coalesce(max(sort),0)+1 n FROM jobs')).rows[0].n;
      const { rows } = await pool.query(`INSERT INTO jobs (slug,title,biz,initials,trade,description,services,stages,voice,demo,status,sort,biz_id,approved)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$11,false,'processing',$9,$10,false) RETURNING id`,
        [slug, title, biz.name, initials, trade, clean(b.description, 300), biz.services || [], stages, top, biz.id, !!voice]);
      const id = rows[0].id;
      render(id, { biz, title, trade, photos: files, voice }).catch(e => console.error('Render failed', e.message));
      await reloadJobs();
      res.redirect(303, '/trade/jobs?m=posted');
    } catch (e) { bin(); next(e); }
  });

  app.post('/trade/jobs/:id/delete', sameOrigin, async (req, res, next) => { try {
    const biz = await current(req);
    if (!biz) return res.redirect(302, '/trade');
    const r = (await pool.query('DELETE FROM jobs WHERE id=$1 AND biz_id=$2 RETURNING *', [parseInt(req.params.id, 10) || 0, biz.id])).rows[0];
    if (r) for (const u of new Set([r.video, r.play_video, r.cover, r.play_cover])) if (u && u.startsWith('/uploads/')) fs.unlink(path.join(MEDIA_DIR, u.slice('/uploads/'.length)), () => {});
    await reloadJobs();
    res.redirect(303, '/trade/jobs?m=deleted');
  } catch (e) { next(e); } });

  // ---------- rendering: photos -> job.json -> video/engine.py -> social + site videos and covers ----------
  async function render(id, { biz, title, trade, photos, voice }) {
    const dir = path.join(WORK_DIR, `job-${id}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const m = photos.length - 2; // number of during photos
      const labels = ['BEFORE', ...Array.from({ length: m }, (_, i) => m === 1 ? 'DURING' : `DURING ${i + 1}/${m}`), 'AFTER'];
      const cfg = {
        out: 'job.mp4', business: biz.name, job_type: trade,
        services_line: (biz.services || []).slice(0, 3).join('  ·  ') || biz.town || '',
        add_labels: true, photos: [], brand: SKIN.video || {}
      };
      for (let i = 0; i < photos.length; i++) {
        const out = path.join(dir, `p${i}.jpg`);
        // re-encode (drops hidden data such as GPS), auto-rotate, cap size
        await sharp(photos[i].path, { failOn: 'none' }).rotate().resize({ width: 2160, height: 2160, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(out);
        cfg.photos.push({ src: `p${i}.jpg`, label: labels[i] });
      }
      if (voice) {
        // mic recording -> plain AAC file the engine can time against
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', voice.path, '-vn', '-t', '35', '-c:a', 'aac', '-b:a', '128k', path.join(dir, 'voice.m4a')]);
        cfg.voice = 'voice.m4a'; cfg.voice_free = true;
      }
      fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(cfg));
      await run(PYTHON, [ENGINE, path.join(dir, 'job.json')], { env: Object.assign({}, process.env, { STJ_PRESET: process.env.STJ_PRESET || 'veryfast' }), timeout: 15 * 60e3 });
      const tag = `${id}-${crypto.randomBytes(4).toString('hex')}`;
      const outs = { social: `${tag}.mp4`, site: `${tag}-site.mp4`, cover: `${tag}.jpg`, siteCover: `${tag}-site.jpg` };
      fs.renameSync(path.join(dir, 'job.mp4'), path.join(JOB_DIR, outs.social));
      fs.renameSync(path.join(dir, 'job_site.mp4'), path.join(JOB_DIR, outs.site));
      await sharp(path.join(dir, 'job_cover.jpg')).resize(540, 960).jpeg({ quality: 85 }).toFile(path.join(JOB_DIR, outs.cover));
      await sharp(path.join(dir, 'job_site_cover.jpg')).resize(540, 960).jpeg({ quality: 85 }).toFile(path.join(JOB_DIR, outs.siteCover));
      const secs = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(JOB_DIR, outs.site)])) || 10;
      const dur = `${Math.floor(secs / 60)}:${String(Math.round(secs) % 60).padStart(2, '0')}`;
      const u = f => '/uploads/jobs/' + f;
      await pool.query(`UPDATE jobs SET video=$1, play_video=$2, cover=$3, play_cover=$4, dur=$5, status='ready', error=NULL WHERE id=$6`,
        [u(outs.social), u(outs.site), u(outs.cover), u(outs.siteCover), dur, id]);
    } catch (e) {
      console.error('Video render failed', e.message);
      await pool.query(`UPDATE jobs SET status='failed', error=$1 WHERE id=$2`, [String(e.message).slice(0, 500), id]).catch(() => {});
    } finally {
      for (const f of [...photos, voice]) if (f) fs.unlink(f.path, () => {});
      fs.rm(dir, { recursive: true, force: true }, () => {});
      await reloadJobs().catch(() => {});
    }
  }

  // used by /admin: approve a carrier's job (goes live, followers get the alert)
  async function approve(id) {
    const r = (await pool.query(`UPDATE jobs SET approved=true, hidden=false WHERE id=$1 RETURNING *`, [id])).rows[0];
    if (r && sendPush) {
      const payload = { title: `New ${C.jobWord} from ${r.biz}`, body: `${r.title}: watch the before and after`, url: `/job/${r.slug}` };
      await sendPush(slugify(r.biz), payload).catch(() => {});
      await sendPush(SKIN.id, payload).catch(() => {});
    }
    await reloadJobs();
    return r;
  }

  return { init, approve, current };
};
