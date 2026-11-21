/**
 * share.js
 * Working together: compressed share links (lz-string), project file export
 * and import, optional live sync through a Firebase Realtime Database (REST and
 * server-sent events, no SDK), and the "Describe for AI" text export.
 */
import { el, field, modal, toast, download, loadScript, CDN, pickFile, copyText, confirmDialog } from './ui.js';
import { migrate, mergeProjects, clone, formatLen, activeScenario, STATUS_LABEL, FIXED_TYPES, formatMoney, uid } from './state.js';
import { saveBackup } from './storage.js';
import { wallLength } from './canvas.js';

/* ------------------------------------------------------------------ */
/* Share link                                                          */
/* ------------------------------------------------------------------ */

/** Project copy without local-only data (settings, background images, history). */
function portable(p, { keepImages = false } = {}) {
  const c = clone(p);
  delete c.settings;
  if (!keepImages) for (const f of c.floors) f.background = { ...f.background, image: null };
  return c;
}

export async function createShareLink(store) {
  try {
    await loadScript(CDN.lz);
    const data = portable(store.state);
    const hadImages = store.state.floors.some(f => f.background.image);
    const code = window.LZString.compressToEncodedURIComponent(JSON.stringify(data));
    const url = `${location.origin}${location.pathname}#p=${code}`;
    const input = el('textarea', { rows: 4, readonly: true, value: url, 'aria-label': 'Share link' });
    const body = el('div', {},
      el('p', { text: 'Anyone who opens this link gets their own editable copy of the project. To share changes back, they send you a new link.' }),
      input,
      el('p', { class: 'muted small', text: `${(url.length / 1000).toFixed(1)}k characters.${hadImages ? ' Background trace images are not included in links; use a project file for those.' : ''}${url.length > 8000 ? ' This link is long; some messaging apps may cut it. A project file is more reliable.' : ''}` }));
    const actions = [{ label: 'Close' }, { label: 'Copy link', primary: true, onClick: async () => { toast((await copyText(url)) ? 'Link copied' : 'Select the link and copy it manually'); return false; } }];
    if (navigator.share) actions.splice(1, 0, { label: 'Share', onClick: async () => { try { await navigator.share({ title: store.state.project.name, url }); } catch (e) { /* user cancelled */ } return false; } });
    modal({ title: 'Share link', body, actions });
    requestAnimationFrame(() => input.select());
  } catch (e) {
    toast('Could not create a link: ' + e.message, 'error');
  }
}

/** If the page was opened with a #p= share link, offer to load it. */
export async function handleIncomingLink(store, onLoaded) {
  const m = location.hash.match(/^#p=(.+)$/);
  if (!m) return;
  const clear = () => history.replaceState(null, '', location.pathname + location.search);
  try {
    await loadScript(CDN.lz);
    const json = window.LZString.decompressFromEncodedURIComponent(m[1]);
    if (!json) throw new Error('The link is incomplete or damaged.');
    const incoming = migrate(JSON.parse(json));
    const ok = await confirmDialog(`Open the shared project "${incoming.project.name}" as your working copy? Your current project is saved as a backup first, and you can restore it from More, then Restore backup.`, { title: 'Open shared project', ok: 'Open copy' });
    clear();
    if (!ok) return;
    await saveBackup(store.state);
    incoming.settings = store.state.settings;
    store.replace(incoming, 'Open shared link');
    onLoaded();
    toast('Shared project opened. Your previous project is in the backup.');
  } catch (e) {
    clear();
    modal({ title: 'Could not open link', body: 'This share link could not be read. ' + (e.message || '') + ' Ask the sender for a new link or a project file.' });
  }
}

/* ------------------------------------------------------------------ */
/* Project file                                                        */
/* ------------------------------------------------------------------ */

export function exportProjectFile(store) {
  const data = clone(store.state);
  data.exportedAt = new Date().toISOString();
  const name = (store.state.project.name || 'room-studio').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  download(`${name}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  toast('Project file saved');
}

export async function importProjectFile(store, onLoaded) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error('The file is larger than 60 MB.');
    const text = await file.text();
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON. It may be damaged or not a Room Studio project.'); }
    const p = migrate(raw);
    const ok = await confirmDialog(`Replace the current project with "${p.project.name}" from ${file.name}? Your current project is saved as a backup first.`, { title: 'Import project', ok: 'Import' });
    if (!ok) return;
    await saveBackup(store.state);
    p.settings = { ...store.state.settings, ...(p.settings || {}), sync: store.state.settings.sync, floorId: p.settings?.floorId === '226' ? '226' : '126' };
    store.replace(p, 'Import project');
    onLoaded();
    toast('Project imported');
  } catch (e) {
    modal({ title: 'Import failed', body: e.message || 'This file could not be imported.' });
  }
}

/* ------------------------------------------------------------------ */
/* Live sync (Firebase Realtime Database over REST)                    */
/* ------------------------------------------------------------------ */

const CLIENT_ID = uid('c');

/** Stable, order-insensitive serialization. Firebase drops nulls and empty arrays and reorders keys. */
function stable(v) {
  if (Array.isArray(v)) {
    const arr = v.every(x => x && typeof x === 'object' && x.id) ? [...v].sort((a, b) => (a.id < b.id ? -1 : 1)) : v;
    return '[' + arr.map(stable).join(',') + ']';
  }
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined && v[k] !== null && !(Array.isArray(v[k]) && !v[k].length) && !(typeof v[k] === 'object' && !Array.isArray(v[k]) && !Object.keys(v[k]).length))
      .map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Signature of the shared content only (ignores local view state and metadata). */
function syncSig(p) {
  const c = clone(p);
  for (const k of ['settings', 'meta', 'writer', 'writtenAt', 'exportedAt']) delete c[k];
  for (const f of c.floors || []) { delete f.background; delete f.activeScenario; }
  return stable(c);
}

export class Sync {
  constructor(store, onStatus) {
    this.store = store;
    this.onStatus = onStatus;
    this.es = null;
    this.remote = null;
    this.online = {};
    this.state = 'off';
    this.lastPush = 0;
    this.pushTimer = null;
    this.presenceTimer = null;
    this.applying = false;
  }

  get cfg() { return this.store.state.settings.sync; }
  get base() { return `${this.cfg.dbUrl.replace(/\/+$/, '')}/rooms/${encodeURIComponent(this.cfg.room)}`; }

  status(state, msg) { this.state = state; this.msg = msg || ''; this.onStatus(this); }

  start() {
    this.stop();
    const c = this.cfg;
    if (!c.enabled || !c.dbUrl || !c.room) { this.status('off'); return; }
    if (!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)$/i.test(c.dbUrl.replace(/\/+$/, ''))) {
      this.status('error', 'The database URL should look like https://your-project-default-rtdb.firebaseio.com');
      return;
    }
    this.status('connecting');
    try {
      this.es = new EventSource(`${this.base}.json`);
    } catch (e) { this.status('error', e.message); return; }
    const handle = ev => {
      try {
        const msg = JSON.parse(ev.data);
        this.onRemote(msg.path, msg.data, ev.type);
      } catch (e) { console.error(e); }
    };
    this.es.addEventListener('put', handle);
    this.es.addEventListener('patch', handle);
    this.es.addEventListener('open', () => this.status('live'));
    this.es.addEventListener('cancel', () => this.status('error', 'The database refused access. Check the security rules in the README.'));
    this.es.addEventListener('auth_revoked', () => this.status('error', 'Access revoked'));
    this.es.onerror = () => { if (this.state !== 'error') this.status('connecting', 'Reconnecting'); };
    this.beat();
    this.presenceTimer = setInterval(() => this.beat(), 25000);
    window.addEventListener('pagehide', this.leave);
  }

  stop() {
    if (this.es) { this.es.close(); this.es = null; }
    clearInterval(this.presenceTimer);
    clearTimeout(this.pushTimer);
    window.removeEventListener('pagehide', this.leave);
    if (this.state !== 'off') this.leave();
    this.online = {};
    this.remote = null;
    this.status('off');
  }

  leave = () => {
    try { fetch(`${this.base}/presence/${CLIENT_ID}.json`, { method: 'DELETE', keepalive: true }); } catch (e) { /* offline */ }
  };

  beat() {
    const name = this.store.state.settings.userName || 'Someone';
    fetch(`${this.base}/presence/${CLIENT_ID}.json`, { method: 'PUT', body: JSON.stringify({ name, ts: Date.now() }) }).catch(() => {});
  }

  onRemote(path, data, type) {
    if (path === '/') {
      this.online = (data && data.presence) || {};
      if (data && data.doc) this.applyRemote(data.doc);
      else { this.status('live'); this.push(true); }
    } else if (path === '/doc') {
      if (data) this.applyRemote(data);
    } else if (path.startsWith('/presence')) {
      const id = path.split('/')[2];
      if (id) { if (data) this.online[id] = type === 'patch' ? { ...(this.online[id] || {}), ...data } : data; else delete this.online[id]; }
      else this.online = data || {};
    } else if (path.startsWith('/doc')) {
      this.fetchDoc();
      return;
    }
    this.onStatus(this);
  }

  async fetchDoc() {
    try {
      const r = await fetch(`${this.base}/doc.json`);
      const d = await r.json();
      if (d) this.applyRemote(d);
    } catch (e) { /* offline: the stream will catch up */ }
  }

  applyRemote(doc) {
    if (!doc || typeof doc !== 'object') return;
    this.remote = doc;
    this.remoteMeta = { by: doc.meta?.updatedBy || '', at: doc.meta?.updatedAt || 0 };
    if (doc.writer === CLIENT_ID && doc.writtenAt === this.lastPush) { this.onStatus(this); return; }
    let incoming;
    try { incoming = migrate({ ...doc, settings: undefined, schemaVersion: doc.schemaVersion || 1 }); } catch (e) { this.status('error', 'Remote data is not readable: ' + e.message); return; }
    const local = this.store.state;
    const merged = mergeProjects(local, incoming);
    merged.settings = local.settings;
    for (const f of merged.floors) {
      const lf = local.floors.find(x => x.id === f.id);
      if (lf) { f.background = lf.background; f.activeScenario = f.scenarios.some(s => s.id === lf.activeScenario) ? lf.activeScenario : f.scenarios[0].id; }
    }
    merged.meta = { ...local.meta, updatedAt: Math.max(local.meta.updatedAt || 0, doc.meta?.updatedAt || 0), updatedBy: doc.meta?.updatedBy || local.meta.updatedBy };
    const mergedSig = syncSig(merged);
    if (mergedSig === syncSig(local)) { this.onStatus(this); return; }
    this.applying = true;
    this.store.begin();
    this.store.state = merged;
    this.store.commit('Sync from partner', { source: 'remote', stamp: false });
    this.applying = false;
    if (mergedSig !== syncSig(incoming)) this.push();
  }

  /** Called after local changes. Debounced write of the merged document. */
  push(now = false) {
    if (this.state === 'off' || this.state === 'error' || this.applying) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(async () => {
      const local = this.store.state;
      const doc = this.remote ? mergeProjects(local, migrate({ ...this.remote, schemaVersion: this.remote.schemaVersion || 1 })) : clone(local);
      const out = portable(doc);
      for (const f of out.floors) delete f.background;
      out.meta = { ...local.meta };
      out.writer = CLIENT_ID;
      out.writtenAt = this.lastPush = Date.now();
      try {
        const r = await fetch(`${this.base}/doc.json`, { method: 'PUT', body: JSON.stringify(out) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.remote = out;
        if (this.state !== 'live') this.status('live');
      } catch (e) {
        this.status('connecting', 'Could not save to the shared database. Retrying when you edit again.');
      }
    }, now ? 0 : 900);
  }

  onlineNames() {
    const now = Date.now();
    return Object.entries(this.online || {}).filter(([id, v]) => v && now - (v.ts || 0) < 70000).map(([id, v]) => (id === CLIENT_ID ? `${v.name} (you)` : v.name));
  }
}

export function syncDialog(store, sync) {
  const c = store.state.settings.sync;
  const cfg = el('textarea', { rows: 4, value: c.dbUrl, placeholder: 'Paste your Firebase config, or just the databaseURL, e.g. https://my-room-default-rtdb.firebaseio.com', 'aria-label': 'Firebase config' });
  const suggestion = 'baker-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  const room = el('input', { type: 'text', value: c.room || suggestion, autocomplete: 'off' });
  const name = el('input', { type: 'text', value: store.state.settings.userName, placeholder: 'Shown to the other person' });
  const err = el('p', { class: 'error', role: 'alert' });
  const st = el('p', { class: 'muted', text: sync.state === 'off' ? 'Live sync is off.' : `Status: ${sync.state}. ${sync.msg || ''}` });
  const body = el('div', {},
    el('p', { text: 'Optional. Connect a free Firebase Realtime Database so two people can edit the same plan at once. Follow the README for the five minute setup. Background trace images stay on each device.' }),
    field('Firebase config or database URL', cfg),
    field('Room code (share this with your partner, keep it hard to guess)', room),
    field('Your name', name), st, err);
  const parseUrl = v => {
    const m = v.match(/https:\/\/[a-z0-9.-]+\.(?:firebaseio\.com|firebasedatabase\.app)/i);
    return m ? m[0] : '';
  };
  modal({
    title: 'Live sync', body, wide: true,
    actions: [
      { label: 'Close' },
      sync.state !== 'off' ? { label: 'Turn off', onClick: () => { store.setSetting('sync', { ...c, enabled: false }); sync.stop(); toast('Live sync turned off'); } } : null,
      {
        label: 'Connect', primary: true, onClick: () => {
          const url = parseUrl(cfg.value.trim());
          const code = room.value.trim().replace(/[.#$[\]/]/g, '-');
          if (!url) { err.textContent = 'Could not find a databaseURL ending in firebaseio.com or firebasedatabase.app.'; return false; }
          if (code.length < 12) { err.textContent = 'Use a room code of at least 12 characters so it is hard to guess.'; return false; }
          if (name.value.trim()) store.setSetting('userName', name.value.trim());
          store.setSetting('sync', { enabled: true, dbUrl: url, room: code });
          sync.start();
          toast('Connecting to live sync');
          return true;
        }
      }
    ].filter(Boolean)
  });
}

/* ------------------------------------------------------------------ */
/* Describe for AI                                                     */
/* ------------------------------------------------------------------ */

export function describeFloor(store) {
  const p = store.state, f = store.floor, sc = activeScenario(f), u = p.project.units;
  const L = v => formatLen(v, u);
  const pos = e => `center at x ${L(e.x)}, y ${L(e.y)}, rotation ${Math.round(e.rotation || 0)} deg`;
  const lines = [];
  lines.push(`ROOM PLAN: ${p.project.name}`);
  lines.push(`Floor: ${f.label}. Layout scenario: "${sc.name}". Units: ${u === 'ftin' ? 'feet and inches' : 'centimeters'}.`);
  lines.push('Coordinate system: x increases to the right, y increases downward (top-down view). Rotation is clockwise in degrees. Width is along the item\'s own x axis, depth along its y axis.');
  if (f.id === '126') lines.push('Room 126 is the lower level and the only entrance. An internal winding staircase leads up to Room 226.');
  else lines.push('Room 226 is the upper level, reached by the internal winding staircase from Room 126.');
  lines.push('Style goals: minimalist and warm, natural wood, macrame wall hangings, floor cushions, many indoor plants (Tradescantia pallida, Callisia fragrans, pothos, spider plants). Existing finishes: red-brown brick fireplace, dark wood doors and trim, cream walls.');
  lines.push('');
  lines.push(`WALLS (${f.walls.length}):`);
  if (!f.walls.length) lines.push('- none drawn yet');
  f.walls.forEach((w, i) => lines.push(`- W${i + 1}: from (${L(w.x1)}, ${L(w.y1)}) to (${L(w.x2)}, ${L(w.y2)}), length ${L(wallLength(w))}, thickness ${L(w.thickness)}`));
  lines.push('');
  lines.push(`FIXED ELEMENTS (${f.fixed.length}):`);
  if (!f.fixed.length) lines.push('- none');
  for (const e of f.fixed) {
    let extra = '';
    if (e.type === 'door') extra = `, hinge ${e.hinge || 'left'}, swings ${e.swing === 'out' ? 'outward' : 'inward'}${e.entry ? ', main entrance' : ''}`;
    if (e.type === 'stairs') extra = `, style ${e.stairStyle || 'winding'}`;
    lines.push(`- ${e.name} (${FIXED_TYPES[e.type]}): ${L(e.width)} wide x ${L(e.depth)} deep${e.height ? ' x ' + L(e.height) + ' high' : ''}, ${pos(e)}${extra}${e.notes ? '. Notes: ' + e.notes : ''}`);
  }
  if (f.slopeZones.length) {
    lines.push('');
    lines.push('SLOPED CEILING ZONES:');
    for (const z of f.slopeZones) lines.push(`- ${L(z.width)} x ${L(z.depth)}, ${pos(z)}; ceiling ${L(z.low)} at the ${z.lowSide} edge rising to ${L(z.high)} at the opposite edge`);
  }
  lines.push('');
  lines.push(`FURNITURE AND ITEMS (${sc.items.length}):`);
  if (!sc.items.length) lines.push('- none placed yet');
  for (const it of sc.items) {
    const shop = it.status === 'buy' || it.status === 'bought' ? `, priority ${it.priority}${it.price != null ? ', price ' + formatMoney(it.price) : ''}${it.store ? ', store ' + it.store : ''}` : '';
    lines.push(`- ${it.name} [${STATUS_LABEL[it.status]}]: ${L(it.width)} x ${L(it.depth)}${it.height ? ' x ' + L(it.height) + ' high' : ''}, shape ${it.shape}, ${pos(it)}${shop}${it.status === 'remove' ? ', plan: ' + it.disposition : ''}${it.locked ? ', locked' : ''}${it.notes ? '. Notes: ' + it.notes : ''}`);
  }
  if (sc.notes.length) {
    lines.push('');
    lines.push('STICKY NOTES:');
    for (const n of sc.notes) lines.push(`- at (${L(n.x)}, ${L(n.y)}): ${n.text}`);
  }
  const b = p.project.budget;
  lines.push('');
  lines.push(`Budget for purchases across both rooms: ${formatMoney(b.min)} to ${formatMoney(b.max)}.`);
  lines.push('');
  lines.push('Please suggest layout ideas that respect walkway clearances of at least 90 cm, keep door swings, the staircase and the entry clear, and fit the style goals.');
  return lines.join('\n');
}

export function describeDialog(store) {
  const text = describeFloor(store);
  const ta = el('textarea', { rows: 16, readonly: true, value: text, class: 'mono', 'aria-label': 'Plan description' });
  modal({
    title: 'Describe for AI', wide: true,
    body: el('div', {}, el('p', { text: 'Copy this structured description of the current floor and paste it into an AI assistant to brainstorm layouts.' }), ta),
    actions: [
      { label: 'Close' },
      { label: 'Download .txt', onClick: () => { download(`plan-${store.floor.id}.txt`, text, 'text/plain'); return false; } },
      { label: 'Copy text', primary: true, onClick: async () => { toast((await copyText(text)) ? 'Copied' : 'Select the text and copy it manually'); return false; } }
    ]
  });
}

