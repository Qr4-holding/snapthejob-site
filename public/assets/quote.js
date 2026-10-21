/* Snap-to-quote flow (CleanUpSnap "Snap your rubbish"). Settings come from window.SITE.quote.
   Photos are shrunk on the phone before upload; the server re-encodes them again and drops all
   hidden data (including location) before anything is stored. */
(function () {
  'use strict';
  const SITE = window.SITE || {}, Q = SITE.quote;
  if (!Q) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d, size = 18, stroke = 'currentColor', w = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const track = (t, extra = {}) => { try { navigator.sendBeacon('/api/e', JSON.stringify(Object.assign({ t, p: location.pathname, r: document.referrer }, extra))); } catch (e) {} };
  const CAM = 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z';
  const MIN = Q.minPhotos || 1, MAX = Q.maxPhotos || 6;

  const STEPS = [
    { key: 'photos', say: Q.intro },
    { key: 'type', say: 'What sort of rubbish is it? Pick all that fit.' },
    { key: 'size', say: 'Roughly how much is there?' },
    { key: 'access', say: 'Where is it? It helps the crew plan.' },
    { key: 'who', say: 'Is this for your home or a business, and is it a one-off?' },
    { key: 'contact', say: 'Nearly done. Where is it, and how should the waste team get back to you?' },
    { key: 'check', say: "Here's what I'll send. Check it over, then tap Send." }
  ];

  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="qz" hidden>
  <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="qzTitle">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
      <h2 class="disp" id="qzTitle" style="margin:0">Snap your rubbish</h2>
      <button class="x" type="button" data-qclose aria-label="Close">${svg('M6 6l12 12M18 6L6 18', 18, '#111214', 2.4)}</button>
    </div>
    <div class="qz" id="qzBody">
      <div class="qz-bar" aria-hidden="true"><i id="qzBar"></i></div>
      <div class="bubble"><span class="bface" aria-hidden="true">B</span><div><span id="qzSay"></span><small>${esc(Q.label || 'Brenda · AI assistant')}</small></div></div>
      <div id="qzStep"></div>
      <div class="err" id="qzErr" role="alert"></div>
      <div class="qnav"><button class="btn" type="button" id="qzBack">Back</button><button class="send disp" type="button" id="qzNext">Next</button></div>
      <p class="small" style="margin:0;text-align:center">Free to ask. No obligation. <a href="/privacy">How we use your photos and details</a></p>
    </div>
    <div class="done" id="qzDone" hidden>
      <span class="tick">${svg('M5 12l5 5 9-10', 36, '#fff', 2.6)}</span>
      <span class="disp" style="font-size:26px">Thanks, that's with us</span>
      <span id="qzDoneText" style="font-size:16px;line-height:1.5"></span>
      <button class="btn" type="button" data-qclose>Back to the videos</button>
    </div>
  </div>
</div>`);

  const ov = $('#qz');
  let st, lastFocus = null;
  const blank = () => ({ step: 0, biz: '', photos: [], type: [], size: '', access: '', who: '', freq: '', name: '', email: '', phone: '', postcode: '', notes: '', hazOk: false, beforeOk: false, consent: false, website: '' });

  // ---------- photos: shrink on the phone (also strips hidden data) ----------
  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
      if (blob) return blob;
    } catch (e) { /* the server will handle it */ }
    return file;
  }
  async function addFiles(files) {
    for (const f of files) {
      if (st.photos.length >= MAX) break;
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) continue;
      const blob = await shrink(f);
      st.photos.push({ blob, url: URL.createObjectURL(blob) });
    }
    draw();
  }

  // ---------- steps ----------
  const opts = (group, list, multi) => `<div class="opts" data-group="${group}"${multi ? ' data-multi' : ''}>` +
    list.map(o => { const on = multi ? st[group].includes(o) : st[group] === o; return `<button type="button" class="opt" aria-pressed="${on}" data-v="${esc(o)}">${esc(o)}</button>`; }).join('') + '</div>';
  const thumbs = (rm) => st.photos.length ? `<div class="phs">${st.photos.map((p, i) => `<figure><img src="${p.url}" alt="Your photo ${i + 1}">${rm ? `<button type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button>` : ''}</figure>`).join('')}</div>` : '';
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';

  function body() {
    switch (STEPS[st.step].key) {
      case 'photos': return `
        <label class="drop">${svg(CAM, 34)}<span>${st.photos.length ? 'Add another photo' : 'Take or add photos of the rubbish'}</span>
          <small>The photo is the quote: the more we can see, the better. ${MIN === 1 ? 'At least 1' : 'At least ' + MIN}, up to ${MAX}.</small>
          <input type="file" id="qzFile" accept="image/*" multiple ${st.photos.length >= MAX ? 'disabled' : ''}></label>
        ${thumbs(true)}`;
      case 'type': return `${opts('type', Q.types, true)}
        <label class="consent haz"><input type="checkbox" id="qzHaz" ${st.hazOk ? 'checked' : ''}><span>There's no hazardous waste in it (${esc(Q.hazardous)}). We can't take those through ${esc(SITE.name)}.</span></label>`;
      case 'size': return opts('size', Q.sizes);
      case 'access': return opts('access', Q.access);
      case 'who': return `<p class="qh">Home or business?</p>${opts('who', Q.who)}<p class="qh">One-off or regular?</p>${opts('freq', Q.freq)}`;
      case 'contact': return `
        <label class="hp" aria-hidden="true">Website<input id="qzWeb" tabindex="-1" autocomplete="off"></label>
        <div class="row"><label class="f">Postcode of the rubbish<input id="qzPc" autocomplete="postal-code" autocapitalize="characters" value="${esc(st.postcode)}"></label>
        <label class="f">Your name<input id="qzName" autocomplete="name" value="${esc(st.name)}"></label></div>
        <div class="row"><label class="f">Email<input id="qzEmail" type="email" inputmode="email" autocomplete="email" value="${esc(st.email)}"></label>
        <label class="f">Mobile <span style="font-weight:400;color:var(--muted)">(optional)</span><input id="qzPhone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(st.phone)}"></label></div>
        <label class="f">Anything else? <span style="font-weight:400;color:var(--muted)">(optional)</span><textarea id="qzNotes" placeholder="For example: parking is tight, or it needs collecting by Friday">${esc(st.notes)}</textarea></label>
        <label class="consent"><input type="checkbox" id="qzBefore" ${st.beforeOk ? 'checked' : ''}><span>If they do the job, the waste team may use my photo as the "before" in their video (no address shown).</span></label>
        <label class="consent"><input type="checkbox" id="qzConsent" ${st.consent ? 'checked' : ''}><span>Send my photos and details to ${st.biz ? esc(st.biz) : 'a local waste team'} so they can quote. <a href="/privacy">Privacy</a></span></label>`;
      case 'check': return `<div class="sum">${thumbs(false)}<dl>
        ${row('Sending to', st.biz || 'A local waste team')}${row('What', st.type.join(', '))}${row('How much', st.size)}${row('Where', st.access)}
        ${row('For', [st.who, st.freq].filter(Boolean).join(', '))}${row('Postcode', st.postcode)}${row('Name', st.name)}${row('Email', st.email)}${row('Mobile', st.phone)}${row('Notes', st.notes)}
        ${row('Photo as "before"', st.beforeOk ? 'Yes' : 'No')}</dl></div>`;
    }
  }
  function draw() {
    const s = STEPS[st.step];
    $('#qzSay').textContent = s.say;
    $('#qzStep').innerHTML = body();
    $('#qzErr').textContent = '';
    $('#qzBar').style.width = Math.round((st.step + 1) / STEPS.length * 100) + '%';
    $('#qzBack').hidden = st.step === 0;
    $('#qzNext').textContent = s.key === 'check' ? 'Send for a quote' : 'Next';
    const fi = $('#qzFile'); if (fi) fi.addEventListener('change', e => { addFiles([...e.target.files]); });
  }
  function save() {
    const v = id => ($(id) ? $(id).value.trim() : '');
    if (STEPS[st.step].key === 'type') st.hazOk = $('#qzHaz').checked;
    if (STEPS[st.step].key === 'contact') Object.assign(st, { postcode: v('#qzPc').toUpperCase(), name: v('#qzName'), email: v('#qzEmail'), phone: v('#qzPhone'), notes: v('#qzNotes'), website: v('#qzWeb'), beforeOk: $('#qzBefore').checked, consent: $('#qzConsent').checked });
  }
  function check() {
    switch (STEPS[st.step].key) {
      case 'photos': return st.photos.length >= MIN ? '' : 'Please add at least one photo of the rubbish. In waste, the photo is the quote.';
      case 'type': return !st.type.length ? 'Please pick at least one type.' : !st.hazOk ? 'Please tick the box to confirm there is no hazardous waste.' : '';
      case 'size': return st.size ? '' : 'Please pick one. "Not sure" is fine.';
      case 'access': return st.access ? '' : 'Please pick where the rubbish is.';
      case 'who': return st.who && st.freq ? '' : 'Please answer both questions.';
      case 'contact':
        if (!/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(st.postcode)) return 'Please add the full postcode where the rubbish is.';
        if (!st.name) return 'Please add your name.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(st.email)) return 'Please add a valid email so the quote can reach you.';
        if (!st.consent) return 'Please tick the box so we can send your photos and details for a quote.';
        return '';
    }
    return '';
  }
  async function send() {
    const btn = $('#qzNext'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const fd = new FormData();
      const { photos, step, ...data } = st;
      fd.append('data', JSON.stringify(Object.assign(data, { source: location.pathname })));
      photos.forEach((p, i) => fd.append('photos', p.blob, `photo-${i + 1}.jpg`));
      const r = await fetch('/api/quote', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      track('quote_sent', { d: st.biz || 'home' });
      $('#qzBody').hidden = true; $('#qzDone').hidden = false;
      $('#qzDoneText').textContent = `${st.biz ? st.biz : 'A local waste team'} will look at your photos and email you a quote. Keep an eye on your inbox, including junk mail.`;
    } catch (ex) { $('#qzErr').textContent = ex.message; }
    finally { btn.disabled = false; if (!$('#qzBody').hidden) btn.textContent = 'Send for a quote'; }
  }

  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-qclose]')) return close();
    const o = e.target.closest('.opt');
    if (o) {
      const g = o.parentElement.dataset.group, v = o.dataset.v;
      if (o.parentElement.hasAttribute('data-multi')) st[g] = st[g].includes(v) ? st[g].filter(x => x !== v) : [...st[g], v];
      else st[g] = v;
      save(); draw(); return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.preventDefault(); const p = st.photos.splice(+rm.dataset.rm, 1)[0]; if (p) URL.revokeObjectURL(p.url); draw(); }
  });
  $('#qzNext').addEventListener('click', () => {
    save();
    const err = check(); if (err) { $('#qzErr').textContent = err; return; }
    if (STEPS[st.step].key === 'check') return send();
    st.step++; draw(); $('#qzSay').scrollIntoView({ block: 'nearest' });
  });
  $('#qzBack').addEventListener('click', () => { save(); st.step = Math.max(0, st.step - 1); draw(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) { e.stopImmediatePropagation(); close(); } }, true);

  function close() { ov.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  window.openQuote = function (o = {}) {
    if (st) st.photos.forEach(p => URL.revokeObjectURL(p.url));
    st = blank(); st.biz = o.biz || '';
    $('#qzTitle').textContent = st.biz ? `Snap your rubbish for ${st.biz}` : 'Snap your rubbish';
    $('#qzBody').hidden = false; $('#qzDone').hidden = true;
    lastFocus = document.activeElement;
    ov.hidden = false; document.body.style.overflow = 'hidden';
    draw();
    setTimeout(() => $('[data-qclose]').focus(), 30);
  };
})();
