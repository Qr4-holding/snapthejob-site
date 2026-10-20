// Jobs: stored in the database, videos and thumbnails on the server's disk.
// Admin can add, edit, hide and delete jobs at /admin/jobs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const multer = require('multer');

const MEDIA_DIR = process.env.MEDIA_DIR || '/data/media';
const JOB_DIR = path.join(MEDIA_DIR, 'jobs');
const TMP_DIR = path.join(MEDIA_DIR, 'tmp');

module.exports = function setupJobs({ app, pool, auth, sameOrigin, esc, slugify, sendPush, TRADES, onChange }) {
  for (const d of [JOB_DIR, TMP_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
  app.use('/uploads', require('express').static(MEDIA_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));

  const upload = multer({
    dest: TMP_DIR,
    limits: { fileSize: 400 * 1024 * 1024, files: 2, fields: 30 },
    fileFilter: (req, file, cb) => {
      const ok = file.fieldname === 'video' ? /^video\//.test(file.mimetype) : file.fieldname === 'thumb' ? /^image\//.test(file.mimetype) : false;
      cb(null, ok);
    }
  });

  const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 1 << 24 }, (e, so, se) => e ? reject(new Error(se || e.message)) : resolve(so)));
  const probeSeconds = async f => parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])) || 0;
  const fmtDur = s => { s = Math.max(1, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const initialsOf = n => (String(n).match(/[A-Za-z0-9]+/g) || ['S', 'J']).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'SJ';
  const coverArgs = ['-vf', 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960', '-frames:v', '1', '-q:v', '4'];

  async function makeThumbFromImage(src, out) { await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, ...coverArgs, out]); }
  async function makeThumbFromVideo(src, out, at = 0.3) { await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(at), '-i', src, ...coverArgs, out]); }

  // ---------- data ----------
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, biz TEXT NOT NULL, initials TEXT, trade TEXT NOT NULL,
      description TEXT, services TEXT[] DEFAULT '{}', stages TEXT[] DEFAULT '{BEFORE,AFTER}', voice BOOLEAN DEFAULT false,
      video TEXT, play_video TEXT, cover TEXT, play_cover TEXT, dur TEXT,
      demo BOOLEAN DEFAULT true, hidden BOOLEAN DEFAULT false, status TEXT DEFAULT 'ready', error TEXT,
      sort INT DEFAULT 0, job_date DATE DEFAULT current_date, created_at TIMESTAMPTZ DEFAULT now()
    )`);
    const { rows } = await pool.query('SELECT count(*)::int n FROM jobs');
    if (rows[0].n === 0) {
      const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/jobs.json'), 'utf8'));
      let i = seed.length;
      for (const j of seed) {
        await pool.query(`INSERT INTO jobs (slug,title,biz,initials,trade,description,services,stages,voice,video,play_video,cover,play_cover,dur,demo,sort,job_date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15,$16) ON CONFLICT (slug) DO NOTHING`,
          [j.slug, j.title, j.biz, j.initials, j.trade, j.description || '', j.services || [], j.stages || ['BEFORE', 'AFTER'], !!j.voice,
           j.video, j.playVideo || j.video, j.cover, j.playCover || j.cover, j.dur, i--, j.date || null]);
      }
    }
    await reload();
  }
  let ALL = [];
  const toPublic = r => ({
    slug: r.slug, title: r.title, biz: r.biz, initials: r.initials || initialsOf(r.biz), trade: r.trade,
    description: r.description || '', services: r.services || [], stages: r.stages || [], voice: !!r.voice,
    video: r.video, playVideo: r.play_video || r.video, cover: r.cover, playCover: r.play_cover || r.cover,
    dur: r.dur || '0:15', demo: !!r.demo, date: (r.job_date ? new Date(r.job_date) : new Date(r.created_at)).toISOString().slice(0, 10),
    alt: `${r.stages && r.stages.includes('DURING') ? 'Before, during and after' : 'Before and after'}: ${r.title}`
  });
  async function reload() {
    ALL = (await pool.query('SELECT * FROM jobs ORDER BY sort DESC, created_at DESC')).rows;
    onChange(ALL.filter(r => !r.hidden && r.status === 'ready').map(toPublic));
  }

  // ---------- processing (runs in the background after upload) ----------
  async function processVideo(id, tmpVideo, thumb) {
    const base = path.join(JOB_DIR, `${id}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmpVideo,
        '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', base + '.mp4']);
      const secs = await probeSeconds(base + '.mp4');
      if (thumb) await makeThumbFromImage(thumb, base + '.jpg'); else await makeThumbFromVideo(base + '.mp4', base + '.jpg', Math.min(0.3, secs / 2));
      const url = p => '/uploads/jobs/' + path.basename(p);
      await pool.query(`UPDATE jobs SET video=$1, play_video=$1, cover=$2, play_cover=$2, dur=$3, status='ready', error=NULL WHERE id=$4`,
        [url(base + '.mp4'), url(base + '.jpg'), fmtDur(secs), id]);
    } catch (e) {
      console.error('Video processing failed', e.message);
      await pool.query(`UPDATE jobs SET status='failed', error=$1 WHERE id=$2`, [String(e.message).slice(0, 500), id]).catch(() => {});
    } finally {
      for (const f of [tmpVideo, thumb]) if (f) fs.unlink(f, () => {});
      await reload().catch(() => {});
    }
  }
  const removeFile = u => { if (u && u.startsWith('/uploads/')) fs.unlink(path.join(MEDIA_DIR, u.slice('/uploads/'.length)), () => {}); };

  // ---------- admin pages ----------
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = v => clean(v, 600).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  const stagesOf = b => ['BEFORE', 'DURING', 'AFTER'].filter(s => b['stage_' + s]);
  const tradeOptions = sel => (sel ? '' : '<option value="">Choose…</option>') + TRADES.map(t => `<option${t === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');

  const shell = (title, body, flash = '') => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SnapTheJob admin</title>
<style>
[hidden]{display:none!important}
body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1F2124;background:#fff;max-width:1100px}
nav.top{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}nav.top a{padding:8px 14px;border-radius:18px;border:1px solid #F0B8AE;text-decoration:none;color:#1F2124;font-weight:600}nav.top a.on{background:#1F2124;color:#fff;border-color:#1F2124}
h1{margin:0 0 10px}h2{margin:24px 0 8px}
.flash{background:#FDF1EE;border:1px solid #D9381E;border-radius:12px;padding:10px 14px;font-weight:600}
form.card{border:1px solid #F0B8AE;border-radius:14px;padding:14px;display:grid;gap:12px;max-width:720px}
label{display:grid;gap:4px;font-weight:600;font-size:14px}input,select,textarea{font:inherit;padding:10px;border:1px solid #C9CBC5;border-radius:10px;background:#fff}
textarea{min-height:70px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){.row{grid-template-columns:1fr}}
.checks{display:flex;gap:16px;flex-wrap:wrap;font-weight:600}.checks label{display:flex;gap:6px;align-items:center}
button,a.b{display:inline-block;background:#D9381E;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;font:inherit;font-weight:700;border:none;cursor:pointer}
button.sec{background:#fff;color:#1F2124;border:1px solid #C9CBC5}button.del{background:#fff;color:#A1260F;border:1px solid #F0B8AE}
.n{color:#5E6168;font-size:14px}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.job{border:1px solid #eee;border-radius:12px;padding:8px;display:grid;gap:6px}.job img{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px;background:#eee}
.pill{font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;background:#eee;justify-self:start}.pill.red{background:#FDF1EE;color:#A1260F}.pill.dark{background:#1F2124;color:#fff}
fieldset{border:1px solid #eee;border-radius:12px;padding:10px 12px;display:grid;gap:10px}legend{font-weight:700}
.picker{display:grid;gap:8px}.picker video{max-width:240px;width:100%;aspect-ratio:9/16;background:#000;border-radius:8px}
.picker canvas{max-width:120px;border-radius:8px;border:2px solid #D9381E}
</style></head><body>
<nav class="top"><a href="/admin">Overview</a><a href="/admin/jobs" class="on">Jobs</a><a href="/" target="_blank" rel="noopener">View site</a></nav>
${flash ? `<p class="flash">${esc(flash)}</p>` : ''}${body}</body></html>`;

  // Thumbnail chooser (shared by add and edit)
  const thumbChooser = (videoUrl) => `<fieldset><legend>Thumbnail (the picture people tap)</legend>
<div class="checks">
<label><input type="radio" name="thumbmode" value="auto" checked> ${videoUrl ? 'Keep current' : 'Automatic (first frame)'}</label>
<label><input type="radio" name="thumbmode" value="frame"> Pick a frame from the video</label>
<label><input type="radio" name="thumbmode" value="upload"> Upload my own picture</label>
</div>
<div class="picker" data-mode="frame" hidden>
<video id="pv" playsinline muted preload="auto" ${videoUrl ? `src="${esc(videoUrl)}"` : ''}></video>
<input type="range" id="pt" min="0" max="100" step="0.1" value="0" aria-label="Move through the video">
<button type="button" class="sec" id="grab">Use this frame</button>
<canvas id="pc" width="540" height="960" hidden></canvas>
<span class="n" id="pn">${videoUrl ? 'Slide to the best moment, then tap Use this frame.' : 'Choose the video above first, then slide to the best moment.'}</span>
</div>
<label data-mode="upload" hidden>Picture (JPG or PNG; it will be cropped to a tall 9:16 shape)<input type="file" name="thumb" id="thumbFile" accept="image/*"></label>
</fieldset>`;

  const pickerScript = `<script>
(function(){
  const f=document.querySelector('form.card'); if(!f) return;
  const show=()=>{const m=(f.querySelector('[name=thumbmode]:checked')||{}).value;f.querySelectorAll('[data-mode]').forEach(el=>el.hidden=el.dataset.mode!==m);};
  f.querySelectorAll('[name=thumbmode]').forEach(r=>r.addEventListener('change',show)); show();
  const v=document.getElementById('pv'), t=document.getElementById('pt'), c=document.getElementById('pc'), n=document.getElementById('pn');
  const vf=f.querySelector('[name=video]');
  if(vf) vf.addEventListener('change',()=>{ if(vf.files[0]){ v.src=URL.createObjectURL(vf.files[0]); n.textContent='Slide to the best moment, then tap Use this frame.'; }});
  v.addEventListener('loadedmetadata',()=>{ t.max=v.duration||0; v.currentTime=Math.min(0.3,(v.duration||1)/2); });
  t.addEventListener('input',()=>{ v.currentTime=parseFloat(t.value)||0; });
  document.getElementById('grab').addEventListener('click',()=>{
    if(!v.videoWidth){ n.textContent='The video has not loaded yet. Try again in a moment.'; return; }
    const W=540,H=960,s=Math.max(W/v.videoWidth,H/v.videoHeight),w=v.videoWidth*s,h=v.videoHeight*s;
    const x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,W,H); x.drawImage(v,(W-w)/2,(H-h)/2,w,h);
    c.toBlob(b=>{ const dt=new DataTransfer(); dt.items.add(new File([b],'frame.jpg',{type:'image/jpeg'})); document.getElementById('thumbFile').files=dt.files; c.hidden=false; n.textContent='Frame chosen. It will be used when you save.'; },'image/jpeg',0.9);
  });
  f.addEventListener('submit',e=>{ const b=f.querySelector('button[type=submit]'); if(b){ b.disabled=true; b.textContent='Uploading… please keep this page open'; } });
})();
</script>`;

  const jobFields = (j = {}) => `<div class="row">
<label>Title<input name="title" maxlength="80" required value="${esc(j.title || '')}" placeholder="Full room re-plaster"></label>
<label>Trade<select name="trade" required>${tradeOptions(j.trade)}</select></label></div>
<div class="row">
<label>Business name<input name="biz" maxlength="80" required value="${esc(j.biz || '')}" placeholder="PS Plastering"></label>
<label>Services (separate with commas)<input name="services" maxlength="600" value="${esc((j.services || []).join(', '))}" placeholder="Re-plastering, Skimming, Ceilings"></label></div>
<label>Short description (shown on the job page and in Google)<textarea name="description" maxlength="400">${esc(j.description || '')}</textarea></label>
<div class="checks"><span>Shows:</span>${['BEFORE', 'DURING', 'AFTER'].map(s => `<label><input type="checkbox" name="stage_${s}" ${(j.stages || ['BEFORE', 'AFTER']).includes(s) ? 'checked' : ''}> ${s[0] + s.slice(1).toLowerCase()}</label>`).join('')}
<label><input type="checkbox" name="voice" ${j.voice ? 'checked' : ''}> Has AI voice</label></div>
<div class="checks"><label><input type="checkbox" name="demo" ${j.demo === false ? '' : 'checked'}> Show "DEMO" label</label></div>`;

  app.get('/admin/jobs', auth, async (req, res, next) => { try {
    await reload();
    const flash = { added: 'Job added. The video is being prepared; it appears on the site in a minute or two.', saved: 'Saved.', deleted: 'Job deleted.', bad: 'Please fill in the title, business and trade, and choose a video.' }[req.query.m] || '';
    const cards = ALL.map(r => `<div class="job">
<img src="${esc(r.cover || '')}" alt="">
<b>${esc(r.title)}</b><span class="n">${esc(r.biz)} · ${esc(r.trade)}</span>
${r.status === 'processing' ? '<span class="pill">Preparing video…</span>' : r.status === 'failed' ? '<span class="pill red">Video failed: try another file</span>' : r.hidden ? '<span class="pill">Hidden</span>' : '<span class="pill dark">Live</span>'}${r.demo ? ' <span class="pill">Demo</span>' : ''}
<a class="b" href="/admin/jobs/${r.id}" style="text-align:center">Edit</a></div>`).join('');
    res.set('Cache-Control', 'no-store').send(shell('Jobs', `<h1>Jobs</h1>
<div class="thumbs">${cards || '<p>No jobs yet.</p>'}</div>
<h2>Add a job</h2>
<form class="card" method="post" action="/admin/jobs" enctype="multipart/form-data">
<label>Video (MP4 or MOV from your phone or laptop, up to 400 MB)<input type="file" name="video" accept="video/*" required></label>
${jobFields()}
${thumbChooser('')}
<div class="checks"><label><input type="checkbox" name="notify"> Send a phone alert to this business's followers when it goes live</label></div>
<button type="submit">Add job</button>
<span class="n">Upload on Wi-Fi if you can. The video is converted so it plays on every phone; this takes a minute or two after uploading.</span>
</form>${pickerScript}`, flash));
  } catch (e) { next(e); } });

  async function uniqueSlug(title) {
    const base = slugify(title) || 'job';
    let s = base, i = 2;
    while ((await pool.query('SELECT 1 FROM jobs WHERE slug=$1', [s])).rows.length) s = `${base}-${i++}`;
    return s;
  }

  app.post('/admin/jobs', auth, sameOrigin, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), async (req, res, next) => { try {
    const b = req.body || {}, vid = req.files && req.files.video && req.files.video[0], th = req.files && req.files.thumb && req.files.thumb[0];
    const title = clean(b.title, 80), biz = clean(b.biz, 80), trade = TRADES.includes(b.trade) ? b.trade : '';
    if (!title || !biz || !trade || !vid) { for (const f of [vid, th]) if (f) fs.unlink(f.path, () => {}); return res.redirect(303, '/admin/jobs?m=bad'); }
    const slug = await uniqueSlug(title);
    const top = (await pool.query('SELECT coalesce(max(sort),0)+1 n FROM jobs')).rows[0].n;
    const { rows } = await pool.query(`INSERT INTO jobs (slug,title,biz,initials,trade,description,services,stages,voice,demo,status,sort)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing',$11) RETURNING id`,
      [slug, title, biz, initialsOf(biz), trade, clean(b.description, 400), list(b.services), stagesOf(b).length ? stagesOf(b) : ['BEFORE', 'AFTER'], !!b.voice, !!b.demo, top]);
    const id = rows[0].id;
    const useThumb = b.thumbmode !== 'auto' && th ? th.path : null;
    if (th && !useThumb) fs.unlink(th.path, () => {});
    processVideo(id, vid.path, useThumb).then(async () => {
      if (b.notify && sendPush) {
        const r = (await pool.query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0];
        if (r && r.status === 'ready') await sendPush(slugify(biz), { title: `New job from ${biz}`, body: `${title}: watch the before and after`, url: `/job/${slug}` }).catch(() => {});
      }
    });
    await reload();
    res.redirect(303, '/admin/jobs?m=added');
  } catch (e) { next(e); } });

  app.get('/admin/jobs/:id', auth, async (req, res, next) => { try {
    const r = (await pool.query('SELECT * FROM jobs WHERE id=$1', [parseInt(req.params.id, 10) || 0])).rows[0];
    if (!r) return res.redirect(303, '/admin/jobs');
    res.set('Cache-Control', 'no-store').send(shell('Edit job', `<h1>Edit job</h1>
<p><a href="/admin/jobs">← All jobs</a> · <a href="/job/${esc(r.slug)}" target="_blank" rel="noopener">View on site</a></p>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
<img src="${esc(r.cover || '')}" alt="Current thumbnail" style="width:150px;aspect-ratio:9/16;object-fit:cover;border-radius:10px;background:#eee">
<form class="card" method="post" action="/admin/jobs/${r.id}" enctype="multipart/form-data" style="flex:1;min-width:280px">
<label>Replace the video (optional)<input type="file" name="video" accept="video/*"></label>
${jobFields(r)}
<div class="checks"><label><input type="checkbox" name="hidden" ${r.hidden ? 'checked' : ''}> Hide from the site</label></div>
${thumbChooser(r.video)}
<button type="submit">Save changes</button>
</form></div>
<h2>Delete this job</h2>
<form method="post" action="/admin/jobs/${r.id}/delete" onsubmit="return confirm('Delete this job and its video for good?')"><button class="del" type="submit">Delete job</button></form>
${pickerScript}`, req.query.m === 'saved' ? (r.status === 'processing' ? 'Saved. The new video is being prepared and replaces the old one in a minute or two.' : 'Saved.') : ''));
  } catch (e) { next(e); } });

  app.post('/admin/jobs/:id', auth, sameOrigin, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), async (req, res, next) => { try {
    const id = parseInt(req.params.id, 10) || 0, b = req.body || {}, th = req.files && req.files.thumb && req.files.thumb[0], vid = req.files && req.files.video && req.files.video[0];
    const r = (await pool.query('SELECT * FROM jobs WHERE id=$1', [id])).rows[0];
    if (!r) { for (const f of [th, vid]) if (f) fs.unlink(f.path, () => {}); return res.redirect(303, '/admin/jobs'); }
    const title = clean(b.title, 80) || r.title, biz = clean(b.biz, 80) || r.biz, trade = TRADES.includes(b.trade) ? b.trade : r.trade;
    await pool.query(`UPDATE jobs SET title=$1, biz=$2, initials=$3, trade=$4, description=$5, services=$6, stages=$7, voice=$8, demo=$9, hidden=$10 WHERE id=$11`,
      [title, biz, initialsOf(biz), trade, clean(b.description, 400), list(b.services), stagesOf(b).length ? stagesOf(b) : r.stages, !!b.voice, !!b.demo, !!b.hidden, id]);
    if (vid) {
      // new video: convert it in the background, then remove the old files
      await pool.query(`UPDATE jobs SET status='processing' WHERE id=$1`, [id]);
      const keepThumb = th && b.thumbmode !== 'auto' ? th.path : null;
      if (th && !keepThumb) fs.unlink(th.path, () => {});
      processVideo(id, vid.path, keepThumb).then(async () => {
        const now = (await pool.query('SELECT status FROM jobs WHERE id=$1', [id])).rows[0];
        if (now && now.status === 'ready') for (const u of new Set([r.video, r.play_video, r.cover, r.play_cover])) removeFile(u);
      });
      await reload();
      return res.redirect(303, `/admin/jobs/${id}?m=saved`);
    }
    if (th && b.thumbmode !== 'auto') {
      const out = path.join(JOB_DIR, `${id}-${crypto.randomBytes(4).toString('hex')}.jpg`);
      try {
        await makeThumbFromImage(th.path, out);
        const u = '/uploads/jobs/' + path.basename(out);
        // keep the original seeded covers; only remove files we created
        if (r.cover !== r.play_cover) removeFile(r.play_cover);
        removeFile(r.cover);
        await pool.query('UPDATE jobs SET cover=$1, play_cover=$1 WHERE id=$2', [u, id]);
      } catch (e) { console.error('Thumbnail failed', e.message); }
    }
    if (th) fs.unlink(th.path, () => {});
    await reload();
    res.redirect(303, `/admin/jobs/${id}?m=saved`);
  } catch (e) { next(e); } });

  app.post('/admin/jobs/:id/delete', auth, sameOrigin, async (req, res, next) => { try {
    const r = (await pool.query('DELETE FROM jobs WHERE id=$1 RETURNING *', [parseInt(req.params.id, 10) || 0])).rows[0];
    if (r) for (const u of new Set([r.video, r.play_video, r.cover, r.play_cover])) removeFile(u);
    await reload();
    res.redirect(303, '/admin/jobs?m=deleted');
  } catch (e) { next(e); } });

  return { init, reload };
};
