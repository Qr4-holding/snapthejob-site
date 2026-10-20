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

  const JOBS = [
    {
      slug: 'room-re-plaster', title: 'Full room re-plaster', biz: 'PS Plastering', initials: 'PS', trade: 'Plasterer',
      video: '/media/ps-plastering.mp4', cover: '/media/ps-plastering.jpg', dur: '0:15', stages: ['BEFORE', 'DURING', 'AFTER'], voice: true,
      services: ['Re-plastering', 'Skimming', 'Ceilings', 'Patch repairs', 'Artex removal'],
      alt: 'Before, during and after: bare brick and blown plaster, then smooth new plaster'
    },
    {
      slug: 'garden-house-clearance', title: 'Drive cleared: sofa, carpet and bags', biz: 'Your Waste Removal', initials: 'YW', trade: 'Waste removal',
      video: '/media/waste-clearance.mp4', cover: '/media/waste-clearance.jpg', dur: '0:09', stages: ['BEFORE', 'AFTER'], voice: false,
      services: ['House clearance', 'Garden waste', 'Trade waste', 'Garage clearance', 'Furniture removal'],
      alt: 'Before and after: a driveway piled with a sofa and rubbish, then cleared'
    }
  ];

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
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) closeWaitlist(); });

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

  // search box: filter on the home page, or go home with the query
  const sf = $('#searchForm');
  if (sf) sf.addEventListener('submit', e => {
    const q = sf.q.value.trim();
    if (!$('#grid')) return; // let it go to /?q=
    e.preventDefault();
    state.q = q.toLowerCase(); render();
  });

  // ---------- home feed ----------
  const state = { trade: 'All', q: new URLSearchParams(location.search).get('q')?.toLowerCase() || '', view: 'grid' };
  try { state.view = localStorage.getItem('stj-view') || 'grid'; } catch (e) {}

  function card(j) {
    return `<article class="card">
      <a class="thumb" href="/job?j=${j.slug}" aria-label="Watch: ${esc(j.title)} by ${esc(j.biz)}">
        <img src="${j.cover}" alt="${esc(j.alt)}" loading="lazy">
        <span class="demo">DEMO</span><span class="dur">${j.dur}</span>
      </a>
      <div class="meta"><span class="av" aria-hidden="true">${j.initials}</span>
        <div style="min-width:0"><a class="t" href="/job?j=${j.slug}">${esc(j.title)}</a><span class="s">${esc(j.biz)} · ${esc(j.trade)}</span></div></div>
      <button class="btn btn-red" type="button" data-waitlist="customer" data-biz="${esc(j.biz)}">Get a quote</button>
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
        <div class="links"><button class="link" type="button" id="copyLink">Copy link</button></div>
        <p class="small" style="margin:0;border-top:1px solid var(--line);padding-top:14px">Posted by ${esc(j.biz)}. SnapTheJob hosts this video; it does not check or vouch for the work. Demo video shown while we launch.</p>
      </div>`;
    $('#copyLink').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Link copied'; }
      catch (ex) { e.target.textContent = 'Copy the address bar link'; }
    });
    const more = $('#more');
    if (more) more.innerHTML = JOBS.filter(x => x !== j).map(card).join('') + ['Roofer', 'Bathrooms', 'Builder'].map(soon).join('');
  }
})();
