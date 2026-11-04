// Chronicle player companion: a static, read-only view of what Chronicle publishes.
// Data comes from data/index.json + data/<campaign>.json (usually encrypted with the party password)
// or demo.json when the page is opened with ?demo. Nothing here calls an AI or a server.
(() => {
  'use strict';

  /* ---------- small helpers ---------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const lsGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const lsSet = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const lsDel = key => { try { localStorage.removeItem(key); } catch {} };
  const pad2 = n => String(n).padStart(2, '0');
  const clock = seconds => { const s = Math.max(0, Math.round(seconds || 0)); return `${pad2(Math.floor(s/3600))}:${pad2(Math.floor(s/60)%60)}:${pad2(s%60)}`; };
  const words = text => (String(text).match(/\S+/g) || []).length;
  const titleCase = key => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

  const ICONS = {
    emblem:'<g stroke-width="1.15"><path d="M12 1.6l1.5 5.3 5.2 1.6-5.2 1.6L12 15.4l-1.5-5.3L5.3 8.5l5.2-1.6z" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="8.5" r="4.9"/><path d="M3 17.3c3-1.3 6-1.3 9 .7 3-2 6-2 9-.7M3 20c3-1.3 6-1.3 9 .7 3-2 6-2 9-.7M12 18v2.7"/></g>',
    home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    people:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>',
    person:'<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    bag:'<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    bookmark:'<path d="M7 3h10v18l-5-4-5 4z"/>',
    pin:'<path d="M12 21s-6-6.1-6-11a6 6 0 0 1 12 0c0 4.9-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    timeline:'<path d="M12 3v18"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><path d="M14 7h6M4 17h6"/>',
    scroll:'<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10"/><path d="M7 4a2 2 0 0 0-2 2v11"/><path d="M8.5 9h5M8.5 12.5h5"/>',
    book:'<path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5v13c-3.5-2-6.5-2-9-1z"/><path d="M21 5.5c-2.5-1-5.5-1-9 1v13c3.5-2 6.5-2 9-1z"/>',
    lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    spark:'<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>',
    send:'<path d="M4 4.5l16 7.5-16 7.5 3-7.5z" fill="currentColor" stroke="none"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    play:'<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
    stop:'<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
    star:'<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    quote:'<path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h5zM10 12c0 3-1.5 5-4.5 5.5M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h5zM19 12c0 3-1.5 5-4.5 5.5"/>',
    shield:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
    banner:'<path d="M6 3v18"/><path d="M6 4h12l-3 4 3 4H6"/>',
    key:'<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M18 12v3M15 12v2"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    note:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
    flask:'<path d="M10 3h4M10.5 3v5.5L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3l-5-9.5V3"/><path d="M7.5 15h9"/>',
    coins:'<ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><ellipse cx="15" cy="14" rx="5" ry="2.5"/><path d="M10 14v3.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V14"/>',
    sword:'<path d="M14.5 4H20v5.5L9 20.5 3.5 15z"/><path d="M6 12.5l5.5 5.5M4 20l2.5-2.5"/>',
    gem:'<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
    lantern:'<path d="M9 5h6M12 2v3M8 8h8l-1 11H9z"/><path d="M8 8l1-3h6l1 3M10 12v4M14 12v4"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.spark}</svg>`;
  function hydrateIcons(root = document) {
    for (const el of root.querySelectorAll('[data-icon]:not([data-done])')) { el.innerHTML = icon(el.dataset.icon); el.dataset.done = '1'; }
  }

  const KIND = {
    pc:{ label:'Player character', plural:'Party', icon:'shield' }, npc:{ label:'NPC', plural:'NPCs', icon:'person' },
    item:{ label:'Item', plural:'Items', icon:'key' }, location:{ label:'Place', plural:'Places', icon:'pin' },
    faction:{ label:'Faction', plural:'Factions', icon:'banner' }, quest:{ label:'Quest', plural:'Quests', icon:'bookmark' },
    event:{ label:'Event', plural:'Events', icon:'timeline' }, moment:{ label:'Moment', plural:'Moments', icon:'scroll' },
    award:{ label:'Award', plural:'Awards', icon:'star' }, quote:{ label:'Quote', plural:'Quotes', icon:'quote' },
    artifact:{ label:'Handout', plural:'Handouts', icon:'scroll' }, arc:{ label:'Character arc', plural:'Arcs', icon:'book' },
    collection:{ label:'Collection', plural:'Collections', icon:'book' }, journal:{ label:'Journal', plural:'Journals', icon:'book' },
  };
  const kindOf = kind => KIND[kind] || { label:titleCase(kind), plural:titleCase(kind), icon:'spark' };
  const STATUS = { in_progress:'In progress', planned:'Planned', blocked:'Blocked', done:'Done', failed:'Failed',
    carried:'Carried', stored:'Stored', dropped:'Dropped', given:'Given away', sold:'Sold', used:'Used up', lost:'Lost' };

  /* ---------- state ---------- */
  const S = { index:[], entry:null, data:null, demo:false, byId:new Map(), byName:new Map(), sessions:[], sessionById:new Map(), links:[], docs:null, speaking:null };

  function buildIndexes(data) {
    S.data = data; S.byId = new Map(); S.byName = new Map(); S.docs = null;
    S.sessions = [...(data.sessions || [])].sort((a, b) => (a.number || 0) - (b.number || 0));
    S.sessionById = new Map(S.sessions.map(s => [s.id, s]));
    for (const record of data.records || []) {
      S.byId.set(record.id, record);
      for (const name of [record.name, ...(Array.isArray(record.properties?.aliases) ? record.properties.aliases : [])])
        if (typeof name === 'string' && name.trim() && !S.byName.has(name.trim().toLowerCase())) S.byName.set(name.trim().toLowerCase(), record);
    }
    S.links = (data.links || []).filter(link => S.byId.has(link.from) && S.byId.has(link.to));
  }
  const records = (...kinds) => (S.data.records || []).filter(r => !kinds.length || kinds.includes(r.kind));
  const sessionLabel = id => { const s = S.sessionById.get(id); return s ? `Session ${pad2(s.number)}` : 'Earlier session'; };
  const sessionNumber = id => S.sessionById.get(id)?.number || 0;
  const firstSession = record => Math.min(...(record.sources || []).map(s => sessionNumber(s.session)).filter(Boolean), Infinity);
  const lastSession = record => Math.max(0, ...(record.sources || []).map(s => sessionNumber(s.session)));
  const latestSession = () => S.sessions.at(-1) || null;
  const inSession = (record, id) => (record.sources || []).some(s => s.session === id);
  const entryHref = record => `#/entry/${encodeURIComponent(record.id)}`;
  const sessionHref = id => `#/session/${encodeURIComponent(id)}`;
  const date = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }); };
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const asList = value => Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];

  /** A property value that may be a record ID, a name, or plain text. */
  function refHtml(value, { chip = false } = {}) {
    if (typeof value === 'string' && S.byId.has(value)) {
      const record = S.byId.get(value);
      return chip ? `<a class="chip" href="${entryHref(record)}">${icon(recordIcon(record))}${esc(record.name)}</a>` : `<a class="wikilink" href="${entryHref(record)}">${esc(record.name)}</a>`;
    }
    if (typeof value === 'string' && S.byName.has(value.trim().toLowerCase())) return refHtml(S.byName.get(value.trim().toLowerCase()).id, { chip });
    if (value && typeof value === 'object') return esc(value.text || value.name || JSON.stringify(value));
    return chip ? `<span class="chip">${esc(value)}</span>` : esc(value);
  }
  const refText = value => typeof value === 'string' && S.byId.has(value) ? S.byId.get(value).name : typeof value === 'object' && value ? (value.text || value.name || '') : String(value ?? '');

  /* ---------- tiny, safe markdown ---------- */
  function inline(text) {
    return String(text).split(/(\[\[[^\]]+\]\])/g).map(part => {
      const link = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
      if (link) {
        const target = S.byName.get(link[1].trim().toLowerCase()), label = (link[2] || link[1]).trim();
        return target ? `<a class="wikilink" href="${entryHref(target)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
      }
      return esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    }).join('');
  }
  function md(text) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { close(); continue; }
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { close(); const level = Math.min(3, m[1].length + 1); out.push(`<h${level}>${inline(m[2])}</h${level}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      close(); out.push(`<p>${inline(line)}</p>`);
    }
    close();
    return out.join('');
  }
  const plain = text => String(text || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/[*#`>]/g, '').replace(/\s+/g, ' ').trim();
  function bullets(text, max = 3) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.match(/^\s*[-*•]\s+(.*)$/)?.[1]).filter(Boolean);
    if (lines.length) return lines.slice(0, max);
    return (plain(text).match(/[^.!?]+[.!?]+/g) || [plain(text)]).slice(0, max).map(s => s.trim()).filter(Boolean);
  }
  const snippet = (text, max = 150) => { const p = plain(text); return p.length > max ? p.slice(0, max).replace(/\s+\S*$/, '') + '…' : p; };

  /* ---------- loading and unlocking ---------- */
  async function fetchJSON(url) {
    const response = await fetch(url, { cache:'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  const fromB64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  async function decrypt(envelope, passphrase) {
    if (!envelope.encrypted) return envelope.data;
    if (!window.crypto?.subtle || typeof DecompressionStream === 'undefined') throw Object.assign(new Error('This browser cannot unlock the page. Try an up-to-date Chrome, Edge, Firefox or Safari over https.'), { fatal:true });
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt:fromB64(envelope.kdf.salt), iterations:envelope.kdf.iterations }, base, { name:'AES-GCM', length:256 }, false, ['decrypt']);
    const bytes = await crypto.subtle.decrypt({ name:'AES-GCM', iv:fromB64(envelope.cipher.iv) }, key, fromB64(envelope.data));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  async function boot() {
    hydrateIcons();
    wireChrome();
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      try {
        const envelope = await fetchJSON('demo.json');
        S.demo = true; $('#demo-banner').hidden = false;
        return openCampaign(envelope.data, { slug:'demo', title:envelope.data.campaign.name, updated:envelope.data.generated });
      } catch { return showUnlock({ message:'The demo campaign could not be loaded.' }); }
    }
    try { S.index = (await fetchJSON('data/index.json')).campaigns || []; } catch { S.index = []; }
    if (!S.index.length) return showUnlock({ empty:true });
    const wanted = params.get('c') || lsGet('chronicle:last');
    await loadCampaign(S.index.find(c => c.slug === wanted) || S.index[0]);
  }

  let pending = null;
  async function loadCampaign(entry) {
    let envelope;
    try { envelope = await fetchJSON(`${entry.file}?v=${encodeURIComponent(entry.updated || '')}`); }
    catch { return showUnlock({ entry, message:'This campaign file could not be loaded. Try again in a minute.' }); }
    if (!envelope.encrypted) return openCampaign(envelope.data, entry);
    const remembered = lsGet(`chronicle:pass:${entry.slug}`);
    if (remembered) {
      try { return openCampaign(await decrypt(envelope, remembered), entry); }
      catch { lsDel(`chronicle:pass:${entry.slug}`); }
    }
    pending = { entry, envelope };
    showUnlock({ entry });
  }

  function showUnlock({ entry = null, empty = false, message = '' } = {}) {
    $('#app').hidden = true; $('#unlock').hidden = false;
    $('#unlock-campaign').textContent = entry ? entry.title : 'Player companion';
    $('#unlock-title').textContent = empty ? 'Nothing published yet.' : 'Your adventure, remembered.';
    $('#unlock-help').textContent = empty ? 'Once a session is approved and published from Chronicle, it shows up here.' : "Enter the party password from your campaign's Discord channel.";
    $('#unlock-pass-field').hidden = empty; $('#unlock-submit').hidden = empty; $('.check', $('#unlock')).hidden = empty;
    const picker = $('#unlock-picker'), select = $('#unlock-select');
    picker.hidden = S.index.length < 2;
    select.innerHTML = S.index.map(c => `<option value="${esc(c.slug)}"${entry && c.slug === entry.slug ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
    const error = $('#unlock-error'); error.hidden = !message; error.textContent = message;
    if (!empty) setTimeout(() => $('#unlock-pass').focus(), 0);
  }

  async function submitUnlock(event) {
    event.preventDefault();
    if (!pending) return;
    const pass = $('#unlock-pass').value, button = $('#unlock-submit'), error = $('#unlock-error');
    button.disabled = true; button.textContent = 'Unlocking…'; error.hidden = true;
    try {
      const data = await decrypt(pending.envelope, pass);
      if ($('#unlock-remember').checked) lsSet(`chronicle:pass:${pending.entry.slug}`, pass);
      $('#unlock-pass').value = '';
      openCampaign(data, pending.entry);
    } catch (problem) {
      error.textContent = problem.fatal ? problem.message : "That password didn't open this campaign. Check it in your Discord channel and try again.";
      error.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Open the chronicle'; }
  }

  function openCampaign(data, entry) {
    buildIndexes(data); S.entry = entry; pending = null;
    if (!S.demo) lsSet('chronicle:last', entry.slug);
    $('#unlock').hidden = true; $('#app').hidden = false;
    const select = $('#campaign-select');
    const options = S.demo ? [{ slug:'demo', title:data.campaign.name }] : S.index;
    select.innerHTML = options.map(c => `<option value="${esc(c.slug)}"${c.slug === entry.slug ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
    select.disabled = options.length < 2;
    const when = data.generated ? new Date(data.generated) : null;
    $('#status-text').textContent = when ? `Updated ${when.toLocaleDateString(undefined, { month:'short', day:'numeric' })}` : 'Loaded';
    $('#lock-btn').hidden = S.demo || !entry.encrypted;
    document.title = `${data.campaign.name} · Chronicle`;
    route();
  }

  /* ---------- chrome ---------- */
  function wireChrome() {
    $('#unlock-form').addEventListener('submit', submitUnlock);
    $('#unlock-select').addEventListener('change', event => { const entry = S.index.find(c => c.slug === event.target.value); if (entry) loadCampaign(entry); });
    $('#campaign-select').addEventListener('change', event => { const entry = S.index.find(c => c.slug === event.target.value); if (entry) { location.hash = '#/'; loadCampaign(entry); } });
    $('#lock-btn').addEventListener('click', () => { if (S.entry) lsDel(`chronicle:pass:${S.entry.slug}`); stopSpeaking(); location.hash = ''; location.reload(); });
    const toggleNav = open => { $('#app').classList.toggle('nav-open', open); $('#scrim').hidden = !open; $('#menu-btn').setAttribute('aria-expanded', String(open)); };
    $('#menu-btn').addEventListener('click', () => toggleNav(!$('#app').classList.contains('nav-open')));
    $('#scrim').addEventListener('click', () => toggleNav(false));
    $('#nav').addEventListener('click', () => toggleNav(false));
    const search = (event, input) => { event.preventDefault(); const q = input.value.trim(); if (q) location.hash = `#/search/${encodeURIComponent(q)}`; };
    $('#top-search').addEventListener('submit', event => search(event, $('#top-search-input')));
    $('#ask-form').addEventListener('submit', event => search(event, $('#ask-input')));
    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !$('#app').hidden) { event.preventDefault(); $('#top-search-input').focus(); }
    });
  }

  const PAGES = { overview:'Overview', sessions:'Sessions', people:'People', inventory:'Inventory', quests:'Quests', places:'Places', compendium:'Compendium', artifacts:'Artifacts', timeline:'Timeline', moments:'From the table', notes:'My notes', search:'Search' };
  function route() {
    if (!S.data) return;
    stopSpeaking();
    const [, page = '', ...rest] = (location.hash || '#/').split('/');
    const arg = decodeURIComponent(rest.join('/'));
    const view = $('#view');
    let html, current = page || 'overview', crumb = PAGES[current];
    try {
      if (!page) html = viewOverview();
      else if (page === 'sessions') html = viewSessions();
      else if (page === 'session') { html = viewSession(arg); current = 'sessions'; crumb = S.sessionById.has(arg) ? sessionLabel(arg) : 'Session'; }
      else if (page === 'people') html = viewPeople(arg);
      else if (page === 'inventory') html = viewInventory();
      else if (page === 'quests') html = viewQuests();
      else if (page === 'places') html = viewPlaces();
      else if (page === 'compendium') html = viewCompendium(arg);
      else if (page === 'artifacts') html = viewArtifacts();
      else if (page === 'timeline') html = viewTimeline();
      else if (page === 'moments') html = viewMoments();
      else if (page === 'notes') html = viewNotes();
      else if (page === 'entry') { const record = S.byId.get(arg); html = viewEntry(record); current = navFor(record); crumb = record?.name || 'Entry'; }
      else if (page === 'search') { html = viewSearch(arg); $('#top-search-input').value = arg; }
      else html = notFound();
    } catch (error) { console.error(error); html = `<div class="card"><p>Something on this page could not be shown. ${esc(error.message)}</p></div>`; }
    view.innerHTML = html;
    hydrateIcons(view);
    wireView(view);
    for (const link of document.querySelectorAll('#nav a')) {
      if (link.dataset.route === (current || 'overview')) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    $('#crumbs').innerHTML = `<span>${esc(S.data.campaign.name)}</span><span aria-hidden="true">/</span><b>${esc(crumb || 'Overview')}</b>`;
    window.scrollTo(0, 0); view.focus({ preventScroll:true });
  }
  const navFor = record => !record ? '' : ['pc','npc','faction'].includes(record.kind) ? 'people' : record.kind === 'item' ? 'inventory' : record.kind === 'quest' ? 'quests' : record.kind === 'location' ? 'places' : record.kind === 'event' ? 'timeline' : record.kind === 'artifact' ? 'artifacts' : ['moment','award','quote'].includes(record.kind) ? 'moments' : 'compendium';
  const notFound = () => `<div class="card"><h2>Not found</h2><p class="muted">That page isn't in this campaign. <a href="#/">Back to the overview</a>.</p></div>`;

  function wireView(view) {
    for (const link of view.querySelectorAll('a[href^="#/entry/"]')) {
      const id = decodeURIComponent(link.getAttribute('href').slice('#/entry/'.length));
      const record = S.byId.get(id), holder = link.querySelector('.portrait, .parch, .thumb');
      if (record?.kind === 'location') link.classList.add('place-card');
      if (record?.image && holder && !holder.querySelector('img')) holder.innerHTML = `<img src="${esc(record.image)}" alt="">`;
    }
    for (const button of view.querySelectorAll('[data-listen]')) {
      if (!('speechSynthesis' in window)) { button.hidden = true; continue; }
      button.addEventListener('click', () => toggleSpeech(button, S.sessionById.get(button.dataset.listen)));
    }
    for (const button of view.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { location.hash = `#/people/${button.dataset.filter}`; });
    for (const button of view.querySelectorAll('[data-compendium-filter]')) button.addEventListener('click', () => { location.hash = `#/compendium/${button.dataset.compendiumFilter}`; });
    for (const area of view.querySelectorAll('textarea[data-note]')) {
      const key = `chronicle:note:${S.entry.slug}`;
      area.value = lsGet(key) || '';
      area.addEventListener('input', () => { lsSet(key, area.value); const saved = area.parentElement.querySelector('[data-saved]'); if (saved) saved.textContent = 'Saved on this device'; });
    }
  }

  /* ---------- speech ("Listen to recap") ---------- */
  function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); S.speaking = null; }
  function toggleSpeech(button, session) {
    if (!session) return;
    const label = button.querySelector('[data-label]'), glyph = button.querySelector('[data-glyph]');
    const reset = () => { label.textContent = 'Listen to recap'; glyph.innerHTML = icon('play'); };
    if (S.speaking === session.id) { stopSpeaking(); reset(); return; }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(`${session.title}. ${plain(session.recap)}`);
    utterance.rate = 0.98; utterance.onend = utterance.onerror = () => { if (S.speaking === session.id) S.speaking = null; reset(); };
    S.speaking = session.id; label.textContent = 'Stop'; glyph.innerHTML = icon('stop');
    speechSynthesis.speak(utterance);
  }
  const listenButton = session => `<button class="btn btn-olive" type="button" data-listen="${esc(session.id)}"><span data-glyph>${icon('play')}</span><span data-label>Listen to recap</span></button>`;
  const minutes = text => `${Math.max(1, Math.round(words(plain(text))/150))} min`;

  /* ---------- reusable pieces ---------- */
  const ITEM_ICONS = [[/key/i, 'key'], [/potion|elixir|vial|flask|tonic/i, 'flask'], [/coin|silver|gold|copper|platinum|gem|jewel|ruby|diamond/i, 'coins'],
    [/sword|blade|dagger|axe|bow|spear|mace|hammer|weapon/i, 'sword'], [/letter|scroll|map|note|book|page|deed/i, 'scroll'], [/lantern|lamp|torch|candle/i, 'lantern'], [/crystal|orb|stone|amulet|ring/i, 'gem']];
  const recordIcon = record => record.kind === 'item' ? (ITEM_ICONS.find(([pattern]) => pattern.test(record.name))?.[1] || 'bag') : kindOf(record.kind).icon;
  const thumb = record => `<span class="thumb">${record.image ? `<img src="${esc(record.image)}" alt="">` : icon(recordIcon(record))}</span>`;
  const portrait = (record, cls = record.kind === 'location' ? 'portrait place-portrait' : 'portrait') => `<span class="${cls}">${record.image ? `<img src="${esc(record.image)}" alt="">` : esc(initials(record.name))}</span>`;
  const statusPill = status => status ? `<span class="pill ${esc(status)}">${esc(STATUS[status] || titleCase(status))}</span>` : '';
  const card = (title, iconName, body, foot = '', extra = '') => `<section class="card ${extra}"><div class="card-head"><h2>${icon(iconName)}${esc(title)}</h2></div>${body}${foot ? `<div class="card-foot">${foot}</div>` : ''}</section>`;
  const more = (href, text) => `<a class="link-arrow" href="${href}">${esc(text)} ${icon('arrow')}</a>`;
  const empty = text => `<p class="empty">${esc(text)}</p>`;
  const connections = record => {
    const ids = [];
    for (const link of S.links) { if (link.from === record.id) ids.push(link.to); if (link.to === record.id) ids.push(link.from); }
    return [...new Set(ids)].map(id => S.byId.get(id)).filter(Boolean);
  };
  const quotesBy = record => records('quote').filter(q => q.properties?.speaker === record.id || refText(q.properties?.speaker).toLowerCase() === record.name.toLowerCase());
  const sourceLine = source => `${esc(sessionLabel(source.session))}${source.at !== undefined ? ` · ${clock(source.at)}` : ''}`;
  function itemLine(item) {
    const p = item.properties || {}, parts = [];
    if (Number(p.quantity) > 1) parts.push(`${Number(p.quantity)} ${p.holder && /party|shared/i.test(refText(p.holder)) ? 'shared' : 'carried'}`);
    if (p.holder && !/party|shared/i.test(refText(p.holder))) parts.push(`Held by ${refText(p.holder)}`);
    else if (!p.holder && p.location) parts.push(`${STATUS[p.status] || 'At'} ${['dropped','stored','lost'].includes(p.status) ? 'at ' : ''}${refText(p.location)}`);
    if (!parts.length && p.status) parts.push(STATUS[p.status] || titleCase(p.status));
    return parts.join(' · ') || kindOf('item').label;
  }
  const carried = item => { const p = item.properties || {}; return !['dropped','stored','given','sold','used','lost'].includes(p.status) && (p.holder || !p.location); };

  /* ---------- views ---------- */
  function viewOverview() {
    const latest = latestSession();
    const head = `<div class="page-head"><div><h1>Your adventure, remembered.</h1>${latest ? `<p class="sub">${icon('arrow')}<a href="${sessionHref(latest.id)}">${esc(sessionLabel(latest.id))} · ${esc(latest.title)}</a></p>` : ''}</div></div>`;
    if (!latest) return head + `<div class="card">${empty('No approved sessions yet. After the first session is reviewed and published, its recap shows up here.')}</div>`;
    const items = records('item').filter(carried).sort((a, b) => lastSession(b) - lastSession(a) || a.name.localeCompare(b.name)).slice(0, 4);
    const threads = records('quest').filter(q => !['done','failed'].includes(q.properties?.status)).sort((a, b) => lastSession(b) - lastSession(a)).slice(0, 4);
    const featured = featuredPerson(latest);
    const latestBackdrop = latest && records().find(record => record.properties?.session === latest.id && record.image);
    let tableBits = records('moment','award','artifact').filter(r => inSession(r, latest.id));
    if (!tableBits.length) tableBits = records('moment','award','artifact').sort((a, b) => lastSession(b) - lastSession(a));
    const left = `<div class="stack">
      <section class="hero" aria-labelledby="latest-title">
        ${latestBackdrop ? `<img class="scene session-backdrop" src="${esc(latestBackdrop.image)}" alt="${esc(latestBackdrop.name || 'Session backdrop')}">` : sceneSvg()}
        <p class="eyebrow">Latest session</p>
        <h2 id="latest-title">${esc(latest.title)}</h2>
        <ul>${bullets(latest.recap).map(b => `<li>${inline(b)}</li>`).join('')}</ul>
        <div class="hero-actions">${listenButton(latest)}<span class="muted">${minutes(latest.recap)}</span><span class="sep" aria-hidden="true"></span><a class="link-arrow" href="${sessionHref(latest.id)}">${icon('book')} Read full recap</a></div>
        <span class="badge badge-corner">${esc(sessionLabel(latest.id))}</span>
      </section>
      <div class="two-up">
        ${card('Party inventory', 'bag', items.length ? `<div class="rows">${items.map(item => `<a class="row" href="${entryHref(item)}">${thumb(item)}<span><span class="row-title">${esc(item.name)}</span><br><span class="row-sub">${esc(itemLine(item))}</span></span><span></span></a>`).join('')}</div>` : empty('Nothing tracked yet.'), more('#/inventory', 'View inventory'))}
        ${card('Open threads', 'bookmark', threads.length ? `<div>${threads.map(q => `<a class="thread" href="${entryHref(q)}"><span class="box" aria-hidden="true"></span><span class="thread-title">${esc(q.name)}</span>${statusPill(q.properties?.status)}</a>`).join('')}</div>` : empty('No open quests. Enjoy it while it lasts.'), more('#/quests', 'Open quest log'))}
      </div>
      ${card('From the table', 'scroll', tableBits.length ? `<div class="tiles">${tableBits.slice(0, 2).map(tile).join('')}</div>` : empty('Moments, awards and handouts from your sessions appear here.'), more('#/moments', 'View all'))}
    </div>`;
    const right = `<div class="stack">
      ${featured ? profileCard(featured) : ''}
      <section class="card note-card"><p class="note-label">${icon('lock')} My note</p>
        <textarea data-note aria-label="My private note" placeholder="Before next session: who wrote the letter?"></textarea>
        <p class="small muted" data-saved>Only saved in this browser. Nobody else can see it.</p></section>
    </div>`;
    return head + `<div class="grid-overview">${left}${right}</div>`;
  }

  function featuredPerson(latest) {
    const people = records('npc');
    if (!people.length) return records('pc')[0] || null;
    const score = person => (inSession(person, latest.id) ? 10 : 0) + (quotesBy(person).length ? 5 : 0) + asList(person.properties?.history).length + lastSession(person)/100;
    return [...people].sort((a, b) => score(b) - score(a))[0];
  }

  function profileCard(person) {
    const p = person.properties || {};
    const meta = [p.role || p.class || kindOf(person.kind).label, p.home ? refText(p.home) : p.species].filter(Boolean);
    const likes = asList(p.likes);
    const history = asList(p.history).filter(h => h && typeof h === 'object' ? h.text : h);
    const last = history.at(-1);
    const quote = quotesBy(person).sort((a, b) => lastSession(b) - lastSession(a))[0];
    const linked = connections(person).filter(r => !['quote','moment','award'].includes(r.kind)).slice(0, 4);
    const lastSource = (person.sources || []).filter(s => S.sessionById.has(s.session)).sort((a, b) => sessionNumber(b.session) - sessionNumber(a.session))[0];
    const facts = [
      likes.length ? `<div class="fact"><span class="eyebrow">Known likes</span><span class="chips">${likes.map(v => `<span class="chip">${esc(refText(v))}</span>`).join('')}</span></div>` : '',
      last ? `<div class="fact"><span class="eyebrow">Last interaction</span><span>${esc(typeof last === 'object' ? last.text : last)}${typeof last === 'object' && last.session ? ` <span class="muted">· ${esc(sessionLabel(last.session))}</span>` : ''}</span></div>`
        : lastSource ? `<div class="fact"><span class="eyebrow">Last seen</span><span>${esc(sessionLabel(lastSource.session))}</span></div>` : '',
      quote ? `<div class="fact" style="grid-template-columns:1fr"><span class="eyebrow">Words to remember</span><span><span class="quote">“${esc(plain(quote.body))}”</span>${quote.sources?.[0] ? `<span class="quote-meta" style="display:block">${sourceLine(quote.sources[0])}</span>` : ''}</span></div>` : '',
      linked.length ? `<div class="fact"><span class="muted" style="display:flex;gap:10px;align-items:center">${icon('link')} Connected to</span><span class="chips">${linked.map(r => refHtml(r.id, { chip:true })).join('')}</span></div>` : '',
    ].join('');
    return `<section class="card"><p class="eyebrow" style="display:flex;gap:10px;align-items:center">${icon('person')} People / saved profile</p>
      <div class="profile-top">${portrait(person)}<div><h3>${esc(person.name)}</h3><p class="profile-meta">${meta.map(esc).join(' · ')}</p><p>${esc(snippet(person.body, 140))}</p></div></div>
      <div class="facts">${facts}</div>
      <div style="display:flex;justify-content:center"><a class="btn btn-outline" href="${entryHref(person)}">Open profile ${icon('arrow')}</a></div></section>`;
  }

  function tile(record) {
    const first = (record.sources || []).find(s => S.sessionById.has(s.session));
    return `<a class="shared-tile" href="${entryHref(record)}">${record.image ? `<img src="${esc(record.image)}" alt="">` : `<span class="shared-tile-icon">${icon(kindOf(record.kind).icon)}</span>`}<span class="shared-tile-body"><span class="eyebrow">${esc(kindOf(record.kind).label)}</span><h3>${esc(record.name)}</h3><p class="row-sub">${first ? esc(sessionLabel(first.session)) : esc(snippet(record.body, 90))}</p></span></a>`;
    return `<a class="tile" href="${entryHref(record)}"><span class="parch${record.kind === 'moment' ? ' seal' : ''}">${icon(kindOf(record.kind).icon)}</span><span><h3>${esc(record.name)}</h3><p class="row-sub">${esc(kindOf(record.kind).label)}${first ? ` · ${esc(sessionLabel(first.session))}` : ''}</p></span></a>`;
  }

  function viewSessions() {
    const rows = [...S.sessions].reverse().map(s => {
      const count = records().filter(r => inSession(r, s.id)).length;
      return `<a class="session-row" href="${sessionHref(s.id)}"><span class="session-num">${pad2(s.number)}</span><span><h3>${esc(s.title)}</h3><span class="row-sub">${esc(date(s.date))} · ${esc(snippet(s.recap, 110))}</span></span><span class="muted small">${count} ${count === 1 ? 'entry' : 'entries'}</span></a>`;
    }).join('');
    return `<div class="page-head"><div><p class="eyebrow">Sessions</p><h1>Every night at the table</h1></div></div><section class="card">${rows || empty('No approved sessions yet.')}</section>`;
  }

  function viewSession(id) {
    const session = S.sessionById.get(id);
    if (!session) return notFound();
    const mentioned = records().filter(r => inSession(r, id) && r.kind !== 'quote');
    const quotes = records('quote').filter(r => inSession(r, id));
    const groups = ['pc','npc','location','faction','item','quest','event','moment','award','artifact'].map(kind => [kind, mentioned.filter(r => r.kind === kind)]).filter(([, list]) => list.length);
    const prev = S.sessions.find(s => s.number === session.number - 1), next = S.sessions.find(s => s.number === session.number + 1);
    const transcript = Array.isArray(session.transcript) && session.transcript.length ? `<section class="card"><details><summary class="eyebrow" style="cursor:pointer">Transcript (${session.transcript.length} lines)</summary><div class="transcript" style="margin-top:12px">${session.transcript.map(line => `<p><span class="t">${clock(line.at)}</span><span class="s">${esc(line.speaker)}</span><span class="x">${esc(line.text)}</span></p>`).join('')}</div></details></section>` : '';
    return `<div class="page-head"><div><p class="eyebrow">${esc(sessionLabel(id))} · ${esc(date(session.date))}</p><h1>${esc(session.title)}</h1></div>
        <div class="hero-actions">${listenButton(session)}<span class="muted">${minutes(session.recap)}</span></div></div>
      <div class="grid-overview">
        <section class="card"><div class="prose">${md(session.recap) || empty('No recap was saved for this session.')}</div></section>
        <div class="stack">
          ${quotes.length ? card('Words to remember', 'quote', quotes.map(q => `<div><p class="quote">“${esc(plain(q.body))}”</p>${q.sources?.find(s => s.session === id) ? `<p class="quote-meta">${sourceLine(q.sources.find(s => s.session === id))}</p>` : ''}</div>`).join('')) : ''}
          ${card('In this session', 'book', groups.length ? groups.map(([kind, list]) => `<div><p class="eyebrow" style="margin-bottom:6px">${esc(kindOf(kind).plural)}</p><div class="chips">${list.map(r => refHtml(r.id, { chip:true })).join('')}</div></div>`).join('') : empty('Nothing was added to the campaign record from this session.'))}
        </div>
      </div>
      ${transcript}
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">${prev ? `<a class="link-arrow" href="${sessionHref(prev.id)}">← ${esc(sessionLabel(prev.id))}: ${esc(prev.title)}</a>` : '<span></span>'}${next ? more(sessionHref(next.id), `${sessionLabel(next.id)}: ${next.title}`) : ''}</div>`;
  }

  function viewPeople(filter) {
    const tabs = [['all', 'Everyone'], ['pc', 'Party'], ['npc', 'NPCs'], ['faction', 'Factions']];
    const active = tabs.some(([key]) => key === filter) ? filter : 'all';
    const list = records(...(active === 'all' ? ['pc','npc','faction'] : [active])).sort((a, b) => (a.kind === 'pc' ? -1 : 0) - (b.kind === 'pc' ? -1 : 0) || lastSession(b) - lastSession(a) || a.name.localeCompare(b.name));
    return `<div class="page-head"><div><p class="eyebrow">People</p><h1>Friends, foes and everyone between</h1></div>
        <div class="filters" role="group" aria-label="Filter people">${tabs.map(([key, label]) => `<button type="button" data-filter="${key}" aria-pressed="${key === active}">${label}</button>`).join('')}</div></div>
      <section class="card">${list.length ? `<div class="cards">${list.map(r => { const p = r.properties || {}; const meta = [kindOf(r.kind).label, p.role || p.class, p.species].filter(Boolean); return `<a class="person" href="${entryHref(r)}">${portrait(r)}<span><h3>${esc(r.name)}</h3><span class="row-sub">${meta.map(esc).join(' · ')}</span><br><span class="small">${esc(snippet(r.body, 90))}</span></span></a>`; }).join('')}</div>` : empty('Nobody here yet.')}</section>`;
  }

  function viewInventory() {
    const items = records('item');
    const held = items.filter(carried), left = items.filter(i => !carried(i));
    const lastSeen = item => { const n = lastSession(item); return n ? `Session ${pad2(n)}` : ''; };
    const table = (list, columns) => `<div class="table-wrap"><table class="inv"><thead><tr>${columns.map(c => `<th scope="col">${c[0]}</th>`).join('')}</tr></thead><tbody>${list.map(item => `<tr>${columns.map(c => `<td${c[2] ? ` class="${c[2]}"` : ''}>${c[1](item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const name = item => `<a href="${entryHref(item)}" style="display:inline-flex;gap:10px;align-items:center">${thumb(item)}<span class="row-title">${esc(item.name)}</span></a>`;
    const qty = item => esc(item.properties?.quantity ?? '1');
    return `<div class="page-head"><div><p class="eyebrow">Inventory</p><h1>What the party carries</h1></div></div>
      ${card('Carried', 'bag', held.length ? table(held, [['Item', name], ['Qty', qty, 'num'], ['Held by', i => i.properties?.holder ? refHtml(i.properties.holder) : '<span class="muted">Unassigned</span>'], ['Last seen', i => esc(lastSeen(i))]]) : empty('Nothing carried yet.'))}
      ${card('Left behind, stored or gone', 'pin', left.length ? table(left, [['Item', name], ['Qty', qty, 'num'], ['Status', i => statusPill(i.properties?.status)], ['Where', i => i.properties?.location ? refHtml(i.properties.location) : i.properties?.holder ? refHtml(i.properties.holder) : '<span class="muted">Unknown</span>'], ['Last seen', i => esc(lastSeen(i))]]) : empty('Nothing has been dropped, stored or traded away.'))}`;
  }

  function questCard(quest) {
    const p = quest.properties || {}, objectives = asList(p.objectives).filter(o => o && o.text);
    return `<section class="card"><div class="card-head"><h2 style="font-size:1.35rem">${icon('bookmark')}<a href="${entryHref(quest)}">${esc(quest.name)}</a></h2>${statusPill(p.status)}</div>
      ${quest.body ? `<p>${inline(quest.body)}</p>` : ''}
      ${objectives.length ? `<ul class="log">${objectives.map(o => `<li style="grid-template-columns:22px 1fr;align-items:center"><span class="box${o.status === 'done' ? ' done' : ''}" aria-label="${esc(STATUS[o.status] || o.status || '')}"></span><span>${esc(o.text)} ${o.status && o.status !== 'done' ? statusPill(o.status) : ''}</span></li>`).join('')}</ul>` : ''}
      <dl class="props">${p.giver ? `<dt>Given by</dt><dd>${refHtml(p.giver)}</dd>` : ''}${p.nextAction ? `<dt>Next step</dt><dd>${esc(p.nextAction)}</dd>` : ''}${p.successCondition ? `<dt>Success when</dt><dd>${esc(p.successCondition)}</dd>` : ''}</dl></section>`;
  }
  function viewQuests() {
    const order = ['in_progress', 'planned', 'blocked', 'done', 'failed'];
    const quests = records('quest');
    const sections = order.map(status => [status, quests.filter(q => (q.properties?.status || 'planned') === status)]).filter(([, list]) => list.length);
    return `<div class="page-head"><div><p class="eyebrow">Quests</p><h1>Promises, plans and loose ends</h1></div></div>
      ${sections.map(([status, list]) => `<h2 style="font-size:1.6rem;color:var(--gold-2)">${esc(STATUS[status])} <span class="muted small">(${list.length})</span></h2><div class="two-up">${list.map(questCard).join('')}</div>`).join('') || `<div class="card">${empty('No quests recorded yet.')}</div>`}`;
  }

  function viewPlaces() {
    const places = records('location').sort((a, b) => lastSession(b) - lastSession(a) || a.name.localeCompare(b.name));
    return `<div class="page-head"><div><p class="eyebrow">Places</p><h1>Where the road has led</h1></div></div>
      <section class="card">${places.length ? `<div class="cards">${places.map(r => { const n = firstSession(r); return `<a class="person" href="${entryHref(r)}"><span class="portrait">${icon('pin')}</span><span><h3>${esc(r.name)}</h3><span class="row-sub">${esc([r.properties?.region, Number.isFinite(n) ? `First seen in Session ${pad2(n)}` : ''].filter(Boolean).join(' · '))}</span><br><span class="small">${esc(snippet(r.body, 90))}</span></span></a>`; }).join('')}</div>` : empty('No places recorded yet.')}</section>`;
  }

  function viewCompendium(filter = 'all') {
    const filters = [['all','All'],['people','People'],['location','Places'],['item','Items'],['quest','Quests'],['event','Events'],['story','Story'],['artifact','Handouts']];
    const selected = filters.some(([key]) => key === filter) ? filter : 'all';
    const buckets = { people:['pc','npc','faction'], story:['moment','award','quote','arc','collection'] };
    const allowed = selected === 'all' ? null : buckets[selected] || [selected];
    const groups = ['pc','npc','faction','item','location','quest','event','moment','award','quote','artifact','arc','collection'].filter(kind => !allowed || allowed.includes(kind)).map(kind => [kind, records(kind).sort((a, b) => a.name.localeCompare(b.name))]).filter(([, list]) => list.length);
    return `<div class="page-head"><div><p class="eyebrow">Compendium</p><h1>Everything the party has learned</h1><p class="sub">The shared campaign archive, including people, places, items, quests, and story details.</p></div><div class="filters" role="group" aria-label="Filter compendium">${filters.map(([key, label]) => `<button type="button" data-compendium-filter="${key}" aria-pressed="${key === selected}">${label}</button>`).join('')}</div></div>${groups.map(([kind, list]) => `<section class="card"><div class="card-head"><h2>${icon(kindOf(kind).icon)}${esc(kindOf(kind).plural)}</h2></div><div class="tiles">${list.map(tile).join('')}</div></section>`).join('') || `<div class="card">${empty('Nothing matches this filter.')}</div>`}`;
  }

  function viewArtifacts() {
    const list = records('artifact').sort((a, b) => lastSession(b) - lastSession(a) || a.name.localeCompare(b.name));
    return `<div class="page-head"><div><p class="eyebrow">Artifacts</p><h1>Handouts and things worth keeping</h1><p class="sub">Reference images and other campaign artifacts shared with the party.</p></div></div><section class="card"><div class="card-head"><h2>${icon('spark')}Artifacts</h2></div>${list.length ? `<div class="tiles">${list.map(tile).join('')}</div>` : empty('No artifacts have been published yet.')}</section>`;
  }

  function viewTimeline() {
    const events = records('event').sort((a, b) => firstSession(a) - firstSession(b) || (Number(a.properties?.step) || 0) - (Number(b.properties?.step) || 0) || (Number(a.properties?.offset) || 0) - (Number(b.properties?.offset) || 0));
    return `<div class="page-head"><div><p class="eyebrow">Timeline</p><h1>The story so far</h1></div></div>
      <section class="card">${events.length ? `<ol class="timeline">${events.map(e => { const first = (e.sources || []).find(s => S.sessionById.has(s.session)); return `<li><span class="chapter">${esc([e.properties?.chapter, e.properties?.scene].filter(Boolean).join(' · ') || 'Event')}</span><h3><a href="${entryHref(e)}">${esc(e.name)}</a></h3>${e.body ? `<p>${inline(e.body)}</p>` : ''}${first ? `<a class="small" href="${sessionHref(first.session)}">${sourceLine(first)}</a>` : ''}</li>`; }).join('')}</ol>` : empty('No timeline events yet.')}</section>`;
  }

  function viewMoments() {
    const bits = records('moment','award','artifact').sort((a, b) => lastSession(b) - lastSession(a));
    const quotes = records('quote').sort((a, b) => lastSession(b) - lastSession(a));
    return `<div class="page-head"><div><p class="eyebrow">From the table</p><h1>Moments worth keeping</h1></div></div>
      ${card('Moments, awards and handouts', 'scroll', bits.length ? `<div class="tiles">${bits.map(tile).join('')}</div>` : empty('Nothing here yet.'))}
      ${card('Words to remember', 'quote', quotes.length ? quotes.map(q => `<div><p class="quote">“${esc(plain(q.body))}”</p><p class="quote-meta">${q.properties?.speaker ? `${refHtml(q.properties.speaker)} · ` : ''}${q.sources?.[0] ? sourceLine(q.sources[0]) : ''}</p></div>`).join('') : empty('No quotes saved yet.'))}`;
  }

  function viewNotes() {
    return `<div class="page-head"><div><p class="eyebrow">My notes</p><h1>Just for you</h1></div></div>
      <section class="card note-card"><p class="note-label">${icon('lock')} Private to this browser</p>
        <textarea data-note style="min-height:320px" aria-label="My private notes" placeholder="Theories, reminders, things your character would never say out loud…"></textarea>
        <p class="small muted" data-saved>Saved only on this device. It isn't uploaded, shared with the party, or seen by the DM.</p></section>`;
  }

  const HANDLED = new Set(['aliases','history','progressLog','objectives','firstSession','lastSession','likes','status','quantity','holder','location','giver','nextAction','successCondition','speaker']);
  function viewEntry(record) {
    if (!record) return notFound();
    const p = record.properties || {}, kind = kindOf(record.kind);
    const aliases = asList(p.aliases).filter(a => typeof a === 'string');
    const meta = [kind.label, p.role || p.class, p.species, p.region].filter(Boolean);
    const props = Object.entries(p).filter(([key, value]) => !HANDLED.has(key) && value !== '' && value !== null && !(Array.isArray(value) && !value.length));
    const history = [...asList(p.history), ...asList(p.progressLog)].filter(Boolean);
    const sources = (record.sources || []).filter(s => S.sessionById.has(s.session));
    const linked = connections(record);
    const quotes = ['pc','npc'].includes(record.kind) ? quotesBy(record) : [];
    const keyFacts = [
      record.kind === 'item' ? `<dt>Quantity</dt><dd>${esc(p.quantity ?? 1)}</dd>${p.holder ? `<dt>Held by</dt><dd>${refHtml(p.holder)}</dd>` : ''}${p.location ? `<dt>Location</dt><dd>${refHtml(p.location)}</dd>` : ''}${p.status ? `<dt>Status</dt><dd>${statusPill(p.status)}</dd>` : ''}` : '',
      asList(p.likes).length ? `<dt>Likes</dt><dd class="chips">${asList(p.likes).map(v => `<span class="chip">${esc(refText(v))}</span>`).join('')}</dd>` : '',
      ...props.map(([key, value]) => `<dt>${esc(titleCase(key))}</dt><dd>${Array.isArray(value) ? `<span class="chips">${value.map(v => refHtml(v, { chip:true })).join('')}</span>` : value && typeof value === 'object' ? esc(JSON.stringify(value)) : refHtml(value)}</dd>`),
      record.kind === 'quote' && p.speaker ? `<dt>Said by</dt><dd>${refHtml(p.speaker)}</dd>` : '',
    ].join('');
     return `<div class="entry-head">${record.image ? portrait(record) : record.kind === 'location' ? `<span class="portrait">${icon('pin')}</span>` : ['pc','npc','faction'].includes(record.kind) ? portrait(record) : `<span class="portrait">${icon(kind.icon)}</span>`}
        <div><p class="eyebrow">${esc(meta.join(' · '))}</p><h1>${esc(record.name)}</h1>${aliases.length ? `<p class="muted">Also known as ${aliases.map(esc).join(', ')}</p>` : ''}</div></div>
      <div class="grid-overview">
        <div class="stack">
          ${record.kind === 'quest' ? questCard(record) : `<section class="card"><div class="prose">${record.kind === 'quote' ? `<p class="quote">“${esc(plain(record.body))}”</p>` : md(record.body) || empty('No description yet.')}</div></section>`}
          ${history.length ? card('History', 'timeline', `<ul class="log">${history.map(h => `<li><span class="when">${typeof h === 'object' && h.session ? `<a href="${sessionHref(h.session)}">${esc(sessionLabel(h.session))}</a>` : ''}</span><span>${esc(typeof h === 'object' ? (h.text || h.note || JSON.stringify(h)) : h)}</span></li>`).join('')}</ul>`) : ''}
          ${quotes.length ? card('Words to remember', 'quote', quotes.map(q => `<div><p class="quote">“${esc(plain(q.body))}”</p>${q.sources?.[0] ? `<p class="quote-meta">${sourceLine(q.sources[0])}</p>` : ''}</div>`).join('')) : ''}
        </div>
        <div class="stack">
          ${keyFacts ? card('Details', 'note', `<dl class="props">${keyFacts}</dl>`) : ''}
          ${linked.length ? card('Connected to', 'link', `<div class="chips">${linked.map(r => refHtml(r.id, { chip:true })).join('')}</div>`) : ''}
          ${sources.length ? card('Appears in', 'calendar', `<ul class="log">${sources.map(s => `<li><span class="when"><a href="${sessionHref(s.session)}">${esc(sessionLabel(s.session))}</a></span><span>${esc(S.sessionById.get(s.session).title)}${s.at !== undefined ? ` <span class="muted">· ${clock(s.at)}</span>` : ''}</span></li>`).join('')}</ul>`) : ''}
        </div>
      </div>`;
  }

  /* ---------- search (local, no AI) ---------- */
  const STOP = new Set('a an and are as at be by did do does for from had has have he her him his how i in is it its me my of on or our she so that the their them they this to us was we were what when where which who whom why will with you your'.split(' '));
  function docs() {
    if (S.docs) return S.docs;
    S.docs = [
      ...S.sessions.map(s => ({ kind:'Session', title:`${sessionLabel(s.id)} · ${s.title}`, names:[s.title], text:plain(s.recap), href:sessionHref(s.id) })),
      ...records().map(r => ({ kind:kindOf(r.kind).label, title:r.name, names:[r.name, ...asList(r.properties?.aliases).filter(a => typeof a === 'string')],
        text:[plain(r.body), ...Object.entries(r.properties || {}).filter(([k]) => !['firstSession','lastSession'].includes(k)).map(([k, v]) => `${titleCase(k)}: ${asList(v).map(x => typeof x === 'object' ? (x.text || '') : refText(x)).join(', ')}`)].join(' · '), href:entryHref(r) })),
      ...S.sessions.flatMap(s => asList(s.transcript).map(line => ({ kind:'Transcript', title:`${line.speaker} · ${sessionLabel(s.id)} · ${clock(line.at)}`, names:[], text:line.text, href:sessionHref(s.id) }))),
    ];
    return S.docs;
  }
  function search(query) {
    const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).filter(t => t.length > 1 && !STOP.has(t)))];
    if (!terms.length) return { terms, results:[] };
    const phrase = query.toLowerCase().trim();
    const results = docs().map(doc => {
      const names = doc.names.join(' ').toLowerCase(), text = doc.text.toLowerCase();
      let score = 0, hits = 0;
      for (const term of terms) {
        const inName = names.includes(term), count = text.split(term).length - 1;
        if (inName || count) hits++;
        score += (inName ? 6 : 0) + Math.min(count, 3);
      }
      if (phrase.length > 3 && (text.includes(phrase) || names.includes(phrase))) score += 5;
      if (doc.kind === 'Transcript') score -= 0.5;
      return { doc, score: hits >= Math.ceil(terms.length/2) ? score : 0 };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 40);
    return { terms, results };
  }
  function highlight(text, terms) {
    const lower = text.toLowerCase(), at = Math.max(0, Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0), text.length));
    const start = Math.max(0, at - 70), piece = (start ? '…' : '') + text.slice(start, start + 200) + (start + 200 < text.length ? '…' : '');
    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return esc(piece).replace(pattern, '<mark>$1</mark>');
  }
  function viewSearch(query) {
    const { terms, results } = search(query);
    return `<div class="page-head"><div><p class="eyebrow">Search</p><h1>“${esc(query)}”</h1><p class="sub muted">${results.length} result${results.length === 1 ? '' : 's'} on this page. For an answer written from all the evidence, ask <code>/ask</code> in Discord.</p></div></div>
      <section class="card">${results.length ? `<div class="results">${results.map(({ doc }) => `<a class="result" href="${doc.href}"><h3><span>${esc(doc.title)}</span><span class="kind">${esc(doc.kind)}</span></h3><p class="small muted">${highlight(doc.text, terms)}</p></a>`).join('')}</div>` : empty(terms.length ? 'Nothing matched. Try a name, a place or an item.' : 'Type a few words to search.')}</section>`;
  }

  /* ---------- decoration ---------- */
  function sceneSvg() {
    // A rainy inn at night, drawn with shapes so the site needs no image files.
    const rain = Array.from({ length:38 }, (_, i) => { const x = (i*53)%420, y = (i*37)%220; return `<line x1="${x}" y1="${y}" x2="${x-6}" y2="${y+18}"/>`; }).join('');
    return `<svg class="scene" viewBox="0 0 420 260" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
      <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a2420"/><stop offset="1" stop-color="#15110d"/></linearGradient></defs>
      <g stroke="#9fb3c8" stroke-opacity=".18" stroke-width="1">${rain}</g>
      <path d="M150 260V130l70-58 70 58v130z" fill="url(#wall)"/><path d="M140 134l80-70 80 70" fill="none" stroke="#3b3128" stroke-width="10"/>
      <path d="M270 260V150l55-40 60 40v110z" fill="#1b1612"/><path d="M262 154l63-48 68 48" fill="none" stroke="#352b23" stroke-width="8"/>
      <rect x="250" y="40" width="14" height="60" fill="#211b16"/>
      <g fill="#f2b45a"><rect x="175" y="150" width="20" height="26" rx="2"/><rect x="245" y="150" width="20" height="26" rx="2"/><rect x="300" y="170" width="16" height="22" rx="2"/><rect x="345" y="170" width="16" height="22" rx="2"/><rect x="208" y="100" width="24" height="22" rx="2"/></g>
      <g fill="url(#glow)" opacity=".7"><circle cx="185" cy="163" r="26"/><circle cx="255" cy="163" r="26"/><circle cx="220" cy="111" r="22"/><circle cx="308" cy="181" r="18"/><circle cx="353" cy="181" r="18"/><circle cx="118" cy="199" r="20"/></g>
      <rect x="203" y="205" width="34" height="55" rx="3" fill="#120e0b" stroke="#3b3128"/>
      <path d="M118 175v-14M110 188h16l-2 22h-12z" stroke="#4a3d30" stroke-width="2" fill="#f7c46a" fill-opacity=".85"/>
      <path d="M0 252c90-14 220-12 420 2v6H0z" fill="#0f0c0a"/><path d="M60 250c40-4 90-4 140 0" stroke="#f2b45a" stroke-opacity=".25" stroke-width="2"/>
    </svg>`;
  }

  boot();
})();
