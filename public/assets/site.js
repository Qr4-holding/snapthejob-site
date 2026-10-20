/* SnapTheJob front end */
(function () {
  'use strict';

  // ---------- data ----------
  const ICON = {
    'All': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    'Waste removal': 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 21a2 2 0 100-4 2 2 0 000 4zM17 21a2 2 0 100-4 2 2 0 000 4z',
    'Plumber': 'M3 9h9a4 4 0 014 4v2M8 9V5M5 5h6M16 19v2',
    'Electrician': 'M13 2L4 14h7l-1 8 9-12h-7z',
    'Roofer': 'M2 13l10-8 10 8M5 11v9h14v-9',
    'Builder': 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6',
    'Gardener': 'M12 21v-8M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 11c0-3 2-5 6-5 0 3-2 5-6 5zM7 21h10',
    'Painter / Decorator': 'M5 4h12v5H5zM17 6h2v6h-7v3M11 15h2v6h-2z',
    'Landscaper': 'M12 22v-6M12 16a6 6 0 006-6c0-4-3-7-6-8-3 1-6 4-6 8a6 6 0 006 6z',
    'Carpenter': 'M14 6l4 4M3 21l9-9M11 5l4-2 6 6-2 4z',
    'Plasterer': 'M3 14h13l5-5H8zM12 14v3M10 17h4v4h-4z',
    'Driveways / Patios': 'M8 3L4 21M16 3l4 18M12 5v3M12 11v3M12 17v3',
    'Fencing / Gates': 'M5 21V6l2-3 2 3v15M15 21V6l2-3 2 3v15M3 10h18M3 16h18',
    'Tree Surgeon': 'M12 22V13M6 13h12L12 3z',
    'Bathrooms': 'M3 12h18v3a5 5 0 01-5 5H8a5 5 0 01-5-5zM6 12V6a2 2 0 014 0M7 20l-1 2M17 20l1 2',
    'Tiler': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    'Central Heating': 'M5 5v14M9 5v14M13 5v14M17 5v14M3 19h18'
  };
  const TRADES = Object.keys(ICON).filter(t => t !== 'All');
  const SHARE = 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13';

  const JOBS = window.STJ_JOBS || [];

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d, size = 18, stroke = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  // ---------- waiting-list modal ----------
  const tradeOptions = TRADES.map(t => `<option>${esc(t)}</option>`).join('') + '<option>Other</option>';
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="wl" hidden>
  <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="wlTitle">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="soonpill">COMING SOON</span>
        <h2 class="disp" id="wlTitle"></h2>
      </div>
      <button class="x" type="button" data-close aria-label="Close">${svg('M6 6l12 12M18 6L6 18', 18, '#1F2124')}</button>
    </div>
    <form id="wlForm" novalidate style="display:flex;flex-direction:column;gap:14px">
      <p id="wlIntro" style="margin:0;font-size:16px;line-height:1.5"></p>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="row">
        <label class="f">Your name<input name="name" autocomplete="name" required></label>
        <label class="f">Email<input name="email" type="email" autocomplete="email" inputmode="email" required></label>
      </div>
      <div data-for="trade" class="row">
        <label class="f">Business name<input name="business" autocomplete="organization"></label>
        <label class="f">Your trade<select name="trade"><option value="">Choose…</option>${tradeOptions}</select></label>
      </div>
      <div class="row">
        <label class="f" data-for="trade">Town<input name="town" autocomplete="address-level2"></label>
        <label class="f">Postcode<input name="postcode" autocomplete="postal-code" autocapitalize="characters"></label>
      </div>
      <label class="f" data-for="trade">How many old before/after jobs are on your phone?
        <select name="gallery"><option value="">Choose…</option><option>None yet</option><option>1–10</option><option>11–50</option><option>50+</option></select>
      </label>
      <label class="f" data-for="customer">What job do you need doing? <span style="font-weight:400;color:#5E6168">(optional)</span>
        <textarea name="job" placeholder="For example: clear a garage, or re-skim a bedroom ceiling"></textarea>
      </label>
      <label class="consent"><input type="checkbox" name="consent"><span id="wlConsent"></span></label>
      <div class="err" id="wlErr" role="alert"></div>
      <button class="send disp" type="submit" id="wlSend">Get on the waiting list</button>
      <p class="small" style="margin:0;text-align:center">We'll only use your details for this. <a href="/privacy">Privacy</a></p>
    </form>
    <div class="done" id="wlDone" hidden>
      <span class="tick">${svg('M5 12l5 5 9-10', 36, '#fff')}</span>
      <span class="disp" style="font-size:26px">You're on the list</span>
      <span id="wlDoneText" style="font-size:16px;line-height:1.5"></span>
      <button class="btn" type="button" data-close>Back to SnapTheJob</button>
    </div>
  </div>
</div>`);

  const ov = $('#wl'), form = $('#wlForm');
  let current = { kind: 'customer', source: '' };
  let lastFocus = null;

  function openWaitlist(kind, opts = {}) {
    current = { kind, source: opts.source || location.pathname + location.search };
    form.reset();
    $('#wlErr').textContent = '';
    form.hidden = false; $('#wlDone').hidden = true;
    form.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== kind; });
    if (kind === 'trade') {
      $('#wlTitle').textContent = 'Get your jobs on SnapTheJob';
      $('#wlIntro').textContent = "We're opening to trades soon. Join the waiting list for early access, with your first 3 quote requests free.";
      $('#wlConsent').textContent = 'Email me about early access to SnapTheJob. I can unsubscribe at any time.';
      $('#wlDoneText').textContent = "We'll email you when your early access is ready.";
      if (opts.trade) form.trade.value = opts.trade;
    } else {
      $('#wlTitle').textContent = opts.biz ? `Quotes from ${opts.biz} are coming soon` : 'Get up to 3 quotes: coming soon';
      $('#wlIntro').textContent = opts.biz
        ? `We're switching on Get a quote very soon. Join the waiting list and we'll email you the moment you can ask ${opts.biz} for a quote.`
        : "Soon you'll be able to describe your job once and get up to 3 quotes from local trades. Join the waiting list and we'll email you when it's live.";
      $('#wlConsent').textContent = 'Email me when quotes go live. I can unsubscribe at any time.';
      $('#wlDoneText').textContent = "We'll email you as soon as quotes are switched on.";
    }
    lastFocus = document.activeElement;
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => form.name.focus(), 30);
  }
  function closeWaitlist() {
    ov.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) closeWaitlist(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) { e.stopImmediatePropagation(); closeWaitlist(); } });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = form, err = $('#wlErr');
    const data = {
      kind: current.kind, source: current.source, website: f.website.value,
      name: f.name.value, email: f.email.value, postcode: f.postcode.value,
      business: f.business.value, trade: f.trade.value, town: f.town.value,
      gallery: f.gallery.value, job: f.job.value, consent: f.consent.checked
    };
    if (!data.name.trim()) return (err.textContent = 'Please add your name.', f.name.focus());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return (err.textContent = 'Please add a valid email address.', f.email.focus());
    if (current.kind === 'trade' && !data.business.trim()) return (err.textContent = 'Please add your business name.', f.business.focus());
    if (current.kind === 'trade' && !data.trade) return (err.textContent = 'Please choose your trade.', f.trade.focus());
    if (!data.consent) return (err.textContent = 'Please tick the box so we can email you.', f.consent.focus());
    err.textContent = '';
    const btn = $('#wlSend'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      form.hidden = true; $('#wlDone').hidden = false;
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Get on the waiting list';
    }
  });

  // any element with data-waitlist="trade|customer"
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-waitlist]');
    if (!t) return;
    e.preventDefault();
    openWaitlist(t.dataset.waitlist, { biz: t.dataset.biz, trade: t.dataset.trade });
  });

  // ---------- share sheet: our own list of apps (works the same on phone and laptop) ----------
  const NET = [
    { id: 'whatsapp', name: 'WhatsApp', bg: '#25D366', mark: svg('M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-4-1z', 24, '#fff'), href: (u, t) => 'https://wa.me/?text=' + encodeURIComponent(t + ' ' + u) },
    { id: 'facebook', name: 'Facebook', bg: '#1877F2', mark: '<b>f</b>', href: u => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u) },
    { id: 'x', name: 'X', bg: '#000000', mark: '<b>X</b>', href: (u, t) => 'https://x.com/intent/post?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u) },
    { id: 'linkedin', name: 'LinkedIn', bg: '#0A66C2', mark: '<b>in</b>', href: u => 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u) },
    { id: 'pinterest', name: 'Pinterest', bg: '#E60023', mark: '<b>P</b>', href: (u, t, img) => 'https://pinterest.com/pin/create/button/?url=' + encodeURIComponent(u) + '&media=' + encodeURIComponent(img) + '&description=' + encodeURIComponent(t) },
    { id: 'sms', name: 'Text', bg: '#5E6168', mark: svg('M4 5h16v11H8l-4 4z', 22, '#fff'), href: (u, t) => 'sms:?&body=' + encodeURIComponent(t + ' ' + u), same: true },
    { id: 'email', name: 'Email', bg: '#5E6168', mark: svg('M3 6h18v12H3zM3 7l9 7 9-7', 22, '#fff'), href: (u, t) => 'mailto:?subject=' + encodeURIComponent(t) + '&body=' + encodeURIComponent(t + '\n' + u), same: true }
  ];
  document.body.insertAdjacentHTML('beforeend', `
<div class="sh" id="sh" hidden>
  <div class="sh-box" role="dialog" aria-modal="true" aria-labelledby="shTitle">
    <div class="sh-head"><b id="shTitle" class="disp">Share this job</b>
      <button class="x" type="button" data-shclose aria-label="Close">${svg('M6 6l12 12M18 6L6 18', 18, '#1F2124')}</button></div>
    <div class="sh-grid" id="shGrid"></div>
    <div class="sh-copy"><input id="shUrl" readonly aria-label="Link to this job"><button class="btn btn-red" type="button" id="shCopy">Copy link</button></div>
    <button class="link" type="button" id="shMore" hidden>More options on this device</button>
  </div>
</div>`);
  const sh = $('#sh');
  let shLast = null, shData = null;
  function openShare(path, title, img) {
    const url = new URL(path, location.origin).href;
    const text = title + ' · Before, After, Share. on SnapTheJob';
    shData = { url, title, text };
    $('#shGrid').innerHTML = NET.map(n => `<a class="sh-app" href="${esc(n.href(url, text, new URL(img || '/media/ps-plastering.jpg', location.origin).href))}" ${n.same ? '' : 'target="_blank" rel="noopener"'}><span style="background:${n.bg}">${n.mark}</span>${n.name}</a>`).join('');
    $('#shUrl').value = url;
    $('#shCopy').textContent = 'Copy link';
    $('#shMore').hidden = !navigator.share;
    shLast = document.activeElement;
    sh.hidden = false;
    setTimeout(() => $('#shCopy').focus(), 30);
  }
  function closeShare() { sh.hidden = true; if (shLast) shLast.focus(); }
  sh.addEventListener('click', e => { if (e.target === sh || e.target.closest('[data-shclose]')) closeShare(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sh.hidden) { e.stopImmediatePropagation(); closeShare(); } }, true);
  $('#shCopy').addEventListener('click', async () => {
    const inp = $('#shUrl');
    try { await navigator.clipboard.writeText(inp.value); }
    catch (ex) { inp.select(); try { document.execCommand('copy'); } catch (e2) {} }
    $('#shCopy').textContent = 'Copied ✓';
  });
  $('#shMore').addEventListener('click', () => {
    if (navigator.share && shData) navigator.share({ title: shData.title, text: shData.text, url: shData.url }).catch(() => {});
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    e.preventDefault();
    openShare(b.dataset.share, b.dataset.title || 'SnapTheJob', b.dataset.img);
  });

  // search box: filter on the home page, or go home with the query
  const sf = $('#searchForm');
  if (sf) sf.addEventListener('submit', e => {
    const q = sf.q.value.trim();
    if (!$('#grid')) return; // let it go to /?q=
    e.preventDefault();
    state.q = q.toLowerCase(); render();
  });

  // ---------- home feed ----------
  const state = { trade: (new URLSearchParams(location.search).get('trade') && ICON[new URLSearchParams(location.search).get('trade')]) ? new URLSearchParams(location.search).get('trade') : 'All', q: new URLSearchParams(location.search).get('q')?.toLowerCase() || '', view: 'grid' };
  try { state.view = localStorage.getItem('stj-view') || 'grid'; } catch (e) {}

  function card(j) {
    return `<article class="card">
      <a class="thumb" data-play="${j.slug}" href="/job?j=${j.slug}" aria-label="Watch: ${esc(j.title)} by ${esc(j.biz)}">
        <img src="${j.cover}" alt="${esc(j.alt)}" loading="lazy">
        <span class="demo">DEMO</span><span class="dur">${j.dur}</span>
      </a>
      <div class="meta"><span class="av" aria-hidden="true">${j.initials}</span>
        <div style="min-width:0"><a class="t" data-play="${j.slug}" href="/job?j=${j.slug}">${esc(j.title)}</a><span class="s">${esc(j.biz)} · ${esc(j.trade)}</span></div></div>
      <div class="cta"><button class="btn btn-red" type="button" data-waitlist="customer" data-biz="${esc(j.biz)}">Get a quote</button>
      <button class="btn share" type="button" data-share="/job?j=${j.slug}" data-title="${esc(j.title)} by ${esc(j.biz)}" data-img="${j.cover}" aria-label="Share this job">${svg(SHARE, 19)}</button></div>
    </article>`;
  }
  function soon(trade) {
    return `<article class="card soon">
      <button class="thumb" type="button" data-waitlist="trade" data-trade="${esc(trade)}" aria-label="Are you a ${esc(trade)}? Join the waiting list">
        ${svg(ICON[trade] || ICON.All, 34)}<span>Be the first<br>${esc(trade)}<br>on SnapTheJob</span>
      </button>
      <div class="meta"><div style="min-width:0"><span class="t">${esc(trade)}</span><span class="s">Coming soon</span></div></div>
      <button class="btn" type="button" data-waitlist="trade" data-trade="${esc(trade)}">I'm a ${esc(trade.split(' /')[0].toLowerCase())}</button>
    </article>`;
  }
  function render() {
    const grid = $('#grid'); if (!grid) return;
    let jobs = JOBS.filter(j => (state.trade === 'All' || j.trade === state.trade) &&
      (!state.q || (j.title + ' ' + j.biz + ' ' + j.trade + ' ' + j.services.join(' ')).toLowerCase().includes(state.q)));
    let html = jobs.map(card).join('');
    if (state.trade === 'All' && !state.q) {
      html += ['Roofer', 'Bathrooms', 'Builder', 'Driveways / Patios', 'Electrician', 'Plumber', 'Landscaper', 'Painter / Decorator', 'Fencing / Gates', 'Tree Surgeon'].map(soon).join('');
    } else if (!jobs.length) {
      html = state.q
        ? `<div class="empty"><b class="disp" style="font-size:22px">No jobs match "${esc(state.q)}" yet</b><p class="small">We're adding trades every week.</p><button class="btn btn-red" type="button" data-waitlist="customer">Get on the quotes waiting list</button></div>`
        : soon(state.trade);
    }
    grid.innerHTML = html;
    grid.classList.toggle('list', state.view === 'list');
    document.querySelectorAll('#chips .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.trade === state.trade));
    document.querySelectorAll('.toggle button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === state.view));
    const h = $('#feedTitle'); if (h) h.textContent = state.q ? `Results for "${state.q}"` : state.trade === 'All' ? 'Latest jobs' : state.trade;
  }
  const chips = $('#chips');
  if (chips) {
    chips.innerHTML = ['All', ...TRADES].map(t => `<button class="chip" type="button" data-trade="${esc(t)}" aria-pressed="false">${svg(ICON[t], 17)}${esc(t)}</button>`).join('');
    chips.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.trade = c.dataset.trade; state.q = ''; if (sf) sf.q.value = ''; render(); });
    document.querySelectorAll('.toggle button').forEach(b => b.addEventListener('click', () => {
      state.view = b.dataset.view; try { localStorage.setItem('stj-view', state.view); } catch (e) {} render();
    }));
    if (sf && state.q) sf.q.value = state.q;
    render();
  }

  // ---------- job page ----------
  const jobEl = $('#job');
  if (jobEl) {
    const slug = new URLSearchParams(location.search).get('j');
    const j = JOBS.find(x => x.slug === slug) || JOBS[0];
    document.title = `${j.title} by ${j.biz} · SnapTheJob`;
    const tagClass = { BEFORE: 'b', DURING: 'd', AFTER: 'a' };
    jobEl.innerHTML = `
      <div class="player"><video src="${j.video}" poster="${j.cover}" controls playsinline preload="metadata" aria-label="${esc(j.alt)}"></video></div>
      <div class="info">
        <div class="crumb"><a href="/">Jobs</a> › <a href="/?q=${encodeURIComponent(j.trade.toLowerCase())}">${esc(j.trade)}</a> › ${esc(j.title)}</div>
        <h1 class="disp">${esc(j.title)}</h1>
        <div class="tags">${j.stages.map(s => `<span class="tag ${tagClass[s]}">${s}</span>`).join('')}
          <span class="small" style="font-weight:600">${j.stages.length} photos · ${j.dur.replace('0:', '')} seconds${j.voice ? ' · AI voice' : ''} · Demo</span></div>
        <div class="biz"><span class="av" aria-hidden="true">${j.initials}</span>
          <div style="flex:1 1 160px;min-width:0"><div style="font-weight:700;font-size:19px">${esc(j.biz)}</div><div class="small" style="font-size:15px">${esc(j.trade)}</div></div>
          <div class="services"><span style="background:none;font-weight:700;padding:6px 4px 6px 0">Services:</span>${j.services.map(s => `<span>${esc(s)}</span>`).join('')}</div>
        </div>
        <button class="bigq disp" type="button" data-waitlist="customer" data-biz="${esc(j.biz)}">Get a quote from ${esc(j.biz)}</button>
        <div class="small" style="text-align:center;margin-top:-8px">Free for you. Takes a minute.</div>
        <button class="btn bigshare disp" type="button" data-share="/job?j=${j.slug}" data-title="${esc(j.title)} by ${esc(j.biz)}" data-img="${j.cover}">${svg(SHARE, 22)}Share this job</button>
        <p class="small" style="margin:0;border-top:1px solid var(--line);padding-top:14px">Posted by ${esc(j.biz)}. SnapTheJob hosts this video; it does not check or vouch for the work. Demo video shown while we launch.</p>
      </div>`;
    const more = $('#more');
    if (more) more.innerHTML = JOBS.filter(x => x !== j).map(card).join('') + ['Roofer', 'Bathrooms', 'Builder'].map(soon).join('');
  }

  // ---------- full-screen player, laid out like Shorts ----------
  document.body.insertAdjacentHTML('beforeend', `
<div class="vw" id="vw" hidden role="dialog" aria-modal="true" aria-label="Video player">
  <div class="vw-top">
    <button class="vw-x" type="button" id="vwClose" aria-label="Back to jobs">${svg('M15 18l-6-6 6-6', 26, 'currentColor')}</button>
    <a class="logo vw-logo" href="/" aria-hidden="true" tabindex="-1"><span class="mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span><span class="word"><b class="disp">Snap<span class="red">The</span>Job</b></span></a>
  </div>
  <nav class="vw-side" aria-label="Browse">
    <a href="/">${svg('M3 11l9-7 9 7v9H3z', 22)}Home</a>
    <button type="button" data-waitlist="customer">${svg('M4 5h16v11H8l-4 4z', 22)}Get 3 quotes</button>
    <button type="button" data-waitlist="trade">${svg('M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z', 22)}I'm a trade</button>
    <div class="vw-side-h">Popular trades</div>
    ${['Waste removal', 'Plasterer', 'Roofer', 'Builder', 'Plumber', 'Electrician', 'Bathrooms', 'Landscaper'].map(t => `<a href="/?trade=${encodeURIComponent(t)}">${svg(ICON[t], 20)}${esc(t)}</a>`).join('')}
  </nav>
  <div class="vw-main">
    <div class="vw-stage" id="vwStage">
      <video id="vwVideo" playsinline preload="auto"></video>
      <span class="vw-paused" aria-hidden="true">${svg('M8 5v14l11-7z', 44, '#fff')}</span>
      <div class="vw-info">
        <a class="vw-biz" id="vwBiz" href="#"><span class="av" id="vwAv"></span><b id="vwName"></b></a>
        <div class="vw-title" id="vwTitle"></div>
      </div>
    </div>
    <div class="vw-rail">
      <button class="vw-act vw-quote" type="button" id="vwQuote" data-waitlist="customer"><span>${svg('M4 5h16v11H8l-4 4z', 24, '#fff')}</span>Get a quote</button>
      <button class="vw-act" type="button" id="vwShare"><span>${svg('M14 5l7 7-7 7M21 12H9a6 6 0 00-6 6', 24, 'currentColor')}</span>Share</button>
    </div>
  </div>
  <div class="vw-navs">
    <button class="vw-nav" type="button" id="vwPrev" aria-label="Previous video">${svg('M12 19V5M5 12l7-7 7 7', 26, 'currentColor')}</button>
    <button class="vw-nav" type="button" id="vwNext" aria-label="Next video">${svg('M12 5v14M5 12l7 7 7-7', 26, 'currentColor')}</button>
  </div>
</div>`);
  const vw = $('#vw'), vid = $('#vwVideo');
  let list = [], idx = 0, openedHere = false, vwLast = null;
  vid.addEventListener('click', () => { vid.paused ? vid.play().catch(() => {}) : vid.pause(); });
  vid.addEventListener('pause', () => vw.classList.add('is-paused'));
  vid.addEventListener('play', () => vw.classList.remove('is-paused'));
  function show(i) {
    idx = (i + list.length) % list.length;
    const j = list[idx];
    vid.src = j.playVideo || j.video; vid.poster = j.playCover || j.cover; vid.setAttribute('aria-label', j.alt);
    $('#vwAv').textContent = j.initials;
    $('#vwName').textContent = j.biz;
    $('#vwBiz').href = '/job?j=' + j.slug;
    $('#vwTitle').textContent = j.title;
    $('#vwQuote').dataset.biz = j.biz;
    const s = $('#vwShare'); s.dataset.share = '/job?j=' + j.slug; s.dataset.title = j.title + ' by ' + j.biz; s.dataset.img = j.cover;
    $('#vwPrev').hidden = $('#vwNext').hidden = list.length < 2;
    vid.play().catch(() => {});
  }
  function openViewer(slug, slugs) {
    list = (slugs && slugs.length ? slugs : JOBS.map(j => j.slug)).map(s => JOBS.find(j => j.slug === s)).filter(Boolean);
    if (!list.length) return;
    vwLast = document.activeElement;
    vw.hidden = false; document.body.style.overflow = 'hidden';
    history.pushState({ stjViewer: true }, ''); openedHere = true;
    show(Math.max(0, list.findIndex(j => j.slug === slug)));
    $('#vwClose').focus();
  }
  function closeViewer(fromHistory) {
    if (vw.hidden) return;
    vid.pause(); vid.removeAttribute('src'); vid.load();
    vw.hidden = true; document.body.style.overflow = '';
    if (!fromHistory && openedHere) { openedHere = false; history.back(); }
    openedHere = false;
    if (vwLast) vwLast.focus();
  }
  window.addEventListener('popstate', () => closeViewer(true));
  $('#vwClose').addEventListener('click', () => closeViewer(false));
  $('#vwNext').addEventListener('click', () => show(idx + 1));
  $('#vwPrev').addEventListener('click', () => show(idx - 1));
  $('#vwQuote').addEventListener('click', () => vid.pause());
  $('#vwShare').addEventListener('click', () => vid.pause());
  document.addEventListener('keydown', e => {
    if (vw.hidden || !ov.hidden || !sh.hidden) return;
    if (e.key === 'Escape') closeViewer(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); show(idx - 1); }
  });
  let ty = null, tx = null;
  $('#vwStage').addEventListener('touchstart', e => { ty = e.touches[0].clientY; tx = e.touches[0].clientX; }, { passive: true });
  $('#vwStage').addEventListener('touchend', e => {
    if (ty === null) return;
    const dy = e.changedTouches[0].clientY - ty, dx = e.changedTouches[0].clientX - tx; ty = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) && list.length > 1) show(idx + (dy < 0 ? 1 : -1));
  }, { passive: true });
  let wheelLock = 0;
  vw.addEventListener('wheel', e => {
    if (list.length < 2 || Math.abs(e.deltaY) < 30 || Date.now() < wheelLock) return;
    wheelLock = Date.now() + 700; show(idx + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });
  vid.addEventListener('ended', () => { if (list.length > 1) show(idx + 1); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-play]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const scope = a.closest('.grid') || document;
    openViewer(a.dataset.play, [...new Set([...scope.querySelectorAll('[data-play]')].map(x => x.dataset.play))]);
  });

  // ---------- contact page ----------
  const cf = $('#contactForm');
  if (cf) cf.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#cErr');
    const data = { website: cf.website.value, name: cf.name.value, email: cf.email.value, topic: cf.topic.value, message: cf.message.value };
    if (!data.name.trim()) return (err.textContent = 'Please add your name.', cf.name.focus());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return (err.textContent = 'Please add a valid email address.', cf.email.focus());
    if (data.message.trim().length < 2) return (err.textContent = 'Please write a message.', cf.message.focus());
    err.textContent = '';
    const b = $('#cSend'); b.disabled = true; b.textContent = 'Sending…';
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      cf.hidden = true; $('#cDone').hidden = false;
    } catch (ex) { err.textContent = ex.message; }
    finally { b.disabled = false; b.textContent = 'Send message'; }
  });
})();
