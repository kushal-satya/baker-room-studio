/**
 * state.js
 * Project data model (versioned schema), unit conversion, the undoable Store,
 * change stamping for sync, and the last-write-wins merge used by live sync.
 * Everything is stored internally in centimeters.
 */

export const SCHEMA_VERSION = 1;

export const STATUSES = [
  { id: 'keep', label: 'Existing-Keep' },
  { id: 'move', label: 'Existing-Move' },
  { id: 'remove', label: 'Existing-Remove' },
  { id: 'buy', label: 'To Buy' },
  { id: 'bought', label: 'Bought' }
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.id, s.label]));

export const LAYERS = [
  { id: 'structure', label: 'Structure' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'rugs', label: 'Rugs' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'plants', label: 'Plants' },
  { id: 'notes', label: 'Notes' },
  { id: 'background', label: 'Background trace' }
];

export const PRIORITIES = ['Must', 'Should', 'Nice'];
export const DISPOSITIONS = ['Undecided', 'Sell', 'Donate', 'Move to storage', 'Reuse elsewhere', 'Recycle or trash'];

export const FIXED_TYPES = {
  door: 'Door', window: 'Window', radiator: 'Radiator', ac: 'AC unit', fireplace: 'Fireplace and mantel',
  counter: 'Kitchen counter', fridge: 'Fridge', stove: 'Stove', closet: 'Closet', washroom: 'Washroom',
  stairs: 'Staircase', outlet: 'Outlet', light: 'Light fixture'
};

/** Geometry keys copied between floors for linked elements such as the staircase. */
const LINK_KEYS = ['x', 'y', 'width', 'depth', 'rotation', 'stairStyle', 'stairTurn', 'name', 'shape'];

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export function defaultSettings() {
  return {
    floorId: '126',
    grid: 25,
    snap: true,
    rulers: true,
    labels: true,
    clearance: false,
    sketch: false,
    theme: 'auto',
    layers: Object.fromEntries(LAYERS.map(l => [l.id, true])),
    statusFilter: Object.fromEntries(STATUSES.map(s => [s.id, true])),
    userName: '',
    tourDone: false,
    leftOpen: true,
    rightOpen: true,
    sync: { enabled: false, dbUrl: '', room: '' }
  };
}

export function newScenario(name) {
  return { id: uid('sc'), name, items: [], notes: [] };
}

function newBackground() {
  return { image: null, w: 0, h: 0, scale: 1, offset: { x: 0, y: 0 }, opacity: 0.5, locked: false, visible: true };
}

function newFloor(id, label) {
  const sc = newScenario('Current');
  return { id, label, walls: [], fixed: [], slopeZones: [], background: newBackground(), scenarios: [sc], activeScenario: sc.id };
}

/**
 * Measured room outline (from on-site measurements, Nov 2026): walls of
 * 460, 426, 463 and 403 cm, drawn clockwise from the top-left corner.
 * The last corner is solved so all four lengths close exactly, which makes
 * the left wall lean about 2 cm. Used as the starting outline on both floors.
 */
const MEASURED_CORNERS = [[0, 0], [460, 0], [460, 426], [-2.43, 402.99]];

function measuredWalls() {
  return MEASURED_CORNERS.map(([x1, y1], i) => {
    const [x2, y2] = MEASURED_CORNERS[(i + 1) % MEASURED_CORNERS.length];
    return { id: uid('w'), x1, y1, x2, y2, thickness: 12 };
  });
}

/*
 * Starter layout: a draft to drag around, not a measured plan.
 * Each row: [name, width, depth, height, x, y, rotation, shape, color, layer, decor, plant].
 * Rotation 0 puts an item's back against the top wall; 90 right wall, 180 bottom, 270 left.
 */
const S = { linen: '#D9CCB6', oak: '#C49A6C', walnut: '#8B6B4E', rug: '#E6D8C3', lamp: '#F1E3B9', sage: '#A7B59A', clay: '#C9A27E', bed: '#E8DFD0' };
const STARTER = {
  // 126 (Lower): entry and living room.
  '126': [
    ['Rug 8 x 5 ft', 244, 152, 1, 240, 175, 0, 'rect', S.rug, 'rugs', 'rug'],
    ['Sofa', 213, 91, 86, 240, 52, 0, 'rect', S.linen, 'furniture', 'sofa'],
    ['Coffee table', 107, 61, 46, 240, 175, 0, 'rect', S.oak, 'furniture'],
    ['Armchair', 81, 86, 86, 110, 185, 270, 'rect', '#CDBFA6', 'furniture', 'armchair'],
    ['Side table', 46, 46, 56, 110, 32, 0, 'rect', S.oak, 'furniture'],
    ['Floor lamp', 40, 40, 165, 372, 35, 0, 'circle', S.lamp, 'lighting', 'lamp'],
    ['TV stand', 152, 41, 56, 240, 388, 180, 'rect', S.walnut, 'furniture'],
    ['TV (55 in)', 123, 8, 71, 240, 392, 180, 'rect', '#3A3530', 'furniture', 'tv'],
    ['Floor cushion', 61, 61, 15, 378, 130, 0, 'rect', S.clay, 'furniture', 'cushion'],
    ['Pouf', 46, 46, 41, 300, 290, 0, 'circle', '#CBB89A', 'furniture', 'cushion'],
    ['Shoe rack', 80, 30, 50, 21, 270, 270, 'rect', S.oak, 'furniture', 'shelves'],
    ['Coat rack', 50, 50, 180, 32, 105, 0, 'circle', S.walnut, 'furniture'],
    ['Plant (tall)', 50, 50, 160, 425, 40, 0, 'circle', '#5E7F55', 'plants', 'plant', 'generic'],
    ['Pothos', 30, 30, 40, 430, 110, 0, 'circle', '#5E8C4A', 'plants', 'plant', 'pothos'],
    ['Spider plant', 35, 35, 35, 160, 32, 0, 'circle', '#7BA05B', 'plants', 'plant', 'spider']
  ],
  // 226 (Upper): bedroom and study.
  '226': [
    ['Rug 8 x 5 ft', 244, 152, 1, 275, 140, 0, 'rect', S.rug, 'rugs', 'rug'],
    ['Bed (queen)', 152, 203, 55, 300, 108, 0, 'rect', S.bed, 'furniture', 'bed'],
    ['Nightstand', 46, 41, 61, 199, 27, 0, 'rect', S.oak, 'furniture'],
    ['Nightstand', 46, 41, 61, 401, 27, 0, 'rect', S.oak, 'furniture'],
    ['Macrame wall hanging', 60, 3, 90, 300, 8, 0, 'rect', '#EFE6D6', 'furniture', 'macrame'],
    ['Desk', 120, 60, 75, 36, 125, 270, 'rect', S.oak, 'furniture'],
    ['Office chair', 66, 66, 110, 102, 125, 270, 'circle', '#9A958B', 'furniture', 'chair'],
    ['Bookshelf', 80, 30, 180, 21, 245, 270, 'rect', S.oak, 'furniture', 'shelves'],
    ['Dresser', 152, 51, 81, 200, 381, 180, 'rect', S.walnut, 'furniture', 'drawers'],
    ['Floor cushion', 61, 61, 15, 105, 300, 0, 'rect', S.sage, 'furniture', 'cushion'],
    ['Floor lamp', 40, 40, 165, 110, 205, 0, 'circle', S.lamp, 'lighting', 'lamp'],
    ['Tradescantia pallida', 30, 30, 30, 199, 27, 0, 'circle', '#7A527F', 'plants', 'plant', 'tradescantia'],
    ['Callisia fragrans', 35, 35, 45, 425, 150, 0, 'circle', '#7FA36B', 'plants', 'plant', 'callisia'],
    ['Spider plant', 35, 35, 35, 100, 30, 0, 'circle', '#7BA05B', 'plants', 'plant', 'spider'],
    ['Plant (tall)', 50, 50, 160, 35, 360, 0, 'circle', '#5E7F55', 'plants', 'plant', 'generic']
  ]
};

function starterItems(floorId) {
  return (STARTER[floorId] || []).map(([name, width, depth, height, x, y, rotation, shape, color, layer, decor, plant]) => ({
    id: uid('it'), type: 'starter', name, x, y, width, depth, height, rotation, shape, color,
    status: 'keep', room: floorId, price: null, store: '', link: '', priority: 'Should', notes: '',
    locked: false, layer, decor, plant, disposition: 'Undecided'
  }));
}

/** Point on the bottom wall of the measured outline at a given x. */
function bottomWallY(x) {
  const [[ax, ay], [bx, by]] = [MEASURED_CORNERS[3], MEASURED_CORNERS[2]];
  return ay + ((x - ax) / (bx - ax)) * (by - ay);
}

/**
 * Seed defaults once per project: the measured outline on floors without walls,
 * then a starter layout (staircase on both floors, entry door on 126, and
 * furniture) wherever a floor or layout is still empty.
 */
function seedDefaults(p) {
  if (!p.meta.defaultsSeeded) {
    for (const f of p.floors) if (!f.walls.length) f.walls = measuredWalls();
    p.meta.defaultsSeeded = true;
  }
  if (p.meta.layoutSeeded) return;
  const linkId = uid('link');
  const stairsLinked = p.floors.find(f => f.fixed.some(e => e.type === 'stairs'))?.fixed.find(e => e.type === 'stairs');
  for (const f of p.floors) {
    if (!stairsLinked) {
      f.fixed.push({ id: uid('fx'), type: 'stairs', name: 'Staircase', x: 409, y: 320, width: 90, depth: 200, height: 0, rotation: 0, shape: 'rect', locked: false, notes: '', stairStyle: 'winding', stairTurn: 'right', linkId });
    }
    if (f.id === '126' && !f.fixed.some(e => e.type === 'door')) {
      const wallAngle = (Math.atan2(MEASURED_CORNERS[3][1] - MEASURED_CORNERS[2][1], MEASURED_CORNERS[3][0] - MEASURED_CORNERS[2][0]) * 180) / Math.PI;
      f.fixed.push({ id: uid('fx'), type: 'door', name: 'Entry door', x: 80, y: Math.round(bottomWallY(80) * 10) / 10, width: 81, depth: 5, height: 203, rotation: Math.round(((wallAngle % 360) + 360) % 360 * 10) / 10, shape: 'rect', locked: false, notes: '', hinge: 'right', swing: 'in', entry: true });
    }
    const sc = f.scenarios.find(s => s.id === f.activeScenario) || f.scenarios[0];
    if (sc && !sc.items.length) sc.items = starterItems(f.id);
  }
  p.meta.layoutSeeded = true;
}

/** Starter project: two floors with the measured outline, no furniture. */
export function createEmptyProject() {
  const p = {
    schemaVersion: SCHEMA_VERSION,
    project: { name: 'Baker Tower 126 and 226', units: 'cm', budget: { min: 1000, max: 2000 } },
    settings: defaultSettings(),
    floors: [newFloor('126', '126 (Lower)'), newFloor('226', '226 (Upper)')],
    lists: { todo: [], comments: {} },
    tomb: {},
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  seedDefaults(p);
  return p;
}

/* ------------------------------------------------------------------ */
/* Migration and validation                                            */
/* ------------------------------------------------------------------ */

/**
 * Upgrade functions keyed by the version they upgrade FROM.
 * When the schema changes, add MIGRATIONS[1] = p => { ...; p.schemaVersion = 2; return p; }
 * and bump SCHEMA_VERSION. migrate() runs them in order.
 */
const MIGRATIONS = {};

/** Validate, upgrade and normalize any project-like object. Throws a friendly Error. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('This file does not look like a Room Studio project.');
  }
  let p = clone(raw);
  if (typeof p.schemaVersion !== 'number' || !Array.isArray(p.floors)) {
    throw new Error('This file is missing the project structure (schemaVersion and floors).');
  }
  if (p.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of the app. Reload the page to update, then try again.');
  }
  while (p.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[p.schemaVersion];
    if (!step) throw new Error('No upgrade path from schema version ' + p.schemaVersion + '.');
    p = step(p);
  }
  return normalize(p);
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));

function normBox(e, kindPrefix) {
  if (!e || typeof e !== 'object') return null;
  e.id = str(e.id) || uid(kindPrefix);
  e.x = num(e.x, 0); e.y = num(e.y, 0);
  e.width = Math.max(1, num(e.width, 50));
  e.depth = Math.max(1, num(e.depth, 50));
  e.height = Math.max(0, num(e.height, 0));
  e.rotation = num(e.rotation, 0);
  return e;
}

function normItem(it) {
  if (!normBox(it, 'it')) return null;
  it.type = str(it.type, 'custom');
  it.name = str(it.name, 'Item');
  it.shape = ['rect', 'circle', 'lshape'].includes(it.shape) ? it.shape : 'rect';
  it.color = /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : '#D9CCB6';
  it.status = STATUS_LABEL[it.status] ? it.status : 'keep';
  it.room = str(it.room);
  it.price = it.price === '' || it.price == null ? null : num(Number(it.price), null);
  it.store = str(it.store);
  it.link = str(it.link);
  it.priority = PRIORITIES.includes(it.priority) ? it.priority : 'Should';
  it.notes = str(it.notes);
  it.locked = !!it.locked;
  it.layer = ['furniture', 'rugs', 'lighting', 'plants'].includes(it.layer) ? it.layer : 'furniture';
  it.disposition = DISPOSITIONS.includes(it.disposition) ? it.disposition : 'Undecided';
  return it;
}

function normalize(p) {
  const base = createEmptyProject();
  p.project = Object.assign({}, base.project, p.project || {});
  p.project.name = str(p.project.name, base.project.name);
  p.project.units = p.project.units === 'ftin' ? 'ftin' : 'cm';
  p.project.budget = {
    min: num(Number(p.project.budget?.min), 1000),
    max: num(Number(p.project.budget?.max), 2000)
  };
  const s = Object.assign(defaultSettings(), p.settings || {});
  s.layers = Object.assign(defaultSettings().layers, s.layers || {});
  s.statusFilter = Object.assign(defaultSettings().statusFilter, s.statusFilter || {});
  s.sync = Object.assign(defaultSettings().sync, s.sync || {});
  if (![5, 10, 25, 50].includes(s.grid)) s.grid = 25;
  p.settings = s;

  const floors = [];
  for (const def of base.floors) {
    const f = p.floors.find(x => x && x.id === def.id) || def;
    f.label = def.label;
    f.walls = (Array.isArray(f.walls) ? f.walls : []).filter(w => w && [w.x1, w.y1, w.x2, w.y2].every(v => typeof v === 'number' && isFinite(v)))
      .map(w => ({ ...w, id: str(w.id) || uid('w'), thickness: Math.max(1, num(w.thickness, 12)) }));
    f.fixed = (Array.isArray(f.fixed) ? f.fixed : []).map(e => {
      if (!normBox(e, 'fx')) return null;
      e.type = FIXED_TYPES[e.type] ? e.type : 'closet';
      e.name = str(e.name, FIXED_TYPES[e.type]);
      e.locked = !!e.locked;
      return e;
    }).filter(Boolean);
    f.slopeZones = (Array.isArray(f.slopeZones) ? f.slopeZones : []).map(z => {
      if (!normBox(z, 'sz')) return null;
      z.low = num(Number(z.low), 120); z.high = num(Number(z.high), 240);
      z.lowSide = ['top', 'bottom', 'left', 'right'].includes(z.lowSide) ? z.lowSide : 'top';
      return z;
    }).filter(Boolean);
    f.background = Object.assign(newBackground(), f.background || {});
    f.background.offset = { x: num(f.background.offset?.x, 0), y: num(f.background.offset?.y, 0) };
    f.background.scale = num(f.background.scale, 1) || 1;
    f.background.opacity = Math.min(1, Math.max(0.05, num(f.background.opacity, 0.5)));
    if (typeof f.background.image !== 'string' || !f.background.image.startsWith('data:image/')) f.background.image = null;
    f.scenarios = (Array.isArray(f.scenarios) ? f.scenarios : []).filter(sc => sc && typeof sc === 'object').map(sc => ({
      ...sc,
      id: str(sc.id) || uid('sc'),
      name: str(sc.name, 'Layout'),
      items: (Array.isArray(sc.items) ? sc.items : []).map(normItem).filter(Boolean),
      notes: (Array.isArray(sc.notes) ? sc.notes : []).filter(n => n && typeof n === 'object')
        .map(n => ({ ...n, id: str(n.id) || uid('nt'), x: num(n.x, 0), y: num(n.y, 0), text: str(n.text) }))
    }));
    if (!f.scenarios.length) f.scenarios = [newScenario('Current')];
    if (!f.scenarios.some(sc => sc.id === f.activeScenario)) f.activeScenario = f.scenarios[0].id;
    floors.push(f);
  }
  p.floors = floors;
  p.lists = p.lists && typeof p.lists === 'object' ? p.lists : {};
  p.lists.todo = (Array.isArray(p.lists.todo) ? p.lists.todo : []).filter(t => t && typeof t === 'object')
    .map(t => ({ ...t, id: str(t.id) || uid('td'), text: str(t.text), done: !!t.done, due: str(t.due) }));
  const comments = {};
  for (const [k, arr] of Object.entries(p.lists.comments || {})) {
    if (Array.isArray(arr)) comments[k] = arr.filter(c => c && typeof c === 'object').map(c => ({ ...c, id: str(c.id) || uid('cm'), text: str(c.text), author: str(c.author) }));
  }
  p.lists.comments = comments;
  p.tomb = p.tomb && typeof p.tomb === 'object' ? p.tomb : {};
  p.meta = Object.assign({ createdAt: Date.now(), updatedAt: Date.now() }, p.meta || {});
  seedDefaults(p);
  p.schemaVersion = SCHEMA_VERSION;
  return p;
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

/** Format centimeters for display in the chosen units ('cm' or 'ftin'). */
export function formatLen(cm, units, short = false) {
  if (cm == null || !isFinite(cm)) return '';
  if (units === 'ftin') {
    const total = cm / 2.54;
    const sign = total < 0 ? '-' : '';
    const halfIn = Math.round(Math.abs(total) * 2) / 2;
    const ft = Math.floor(halfIn / 12);
    const inch = halfIn - ft * 12;
    const inStr = Number.isInteger(inch) ? String(inch) : inch.toFixed(1);
    if (!ft) return `${sign}${inStr}"`;
    return short && inch === 0 ? `${sign}${ft}'` : `${sign}${ft}' ${inStr}"`;
  }
  const v = Math.round(cm * 10) / 10;
  return short ? String(v) : `${v} cm`;
}

/**
 * Parse a typed length into centimeters. Accepts 412, 412cm, 4.12m, 13'6", 13ft 6in, 6", 13 6.
 * A plain number means centimeters in cm mode and inches in ft-in mode. Returns null if invalid.
 */
export function parseLen(input, units) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/’|′/g, "'").replace(/”|″/g, '"');
  if (!s) return null;
  const n = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  let m = s.match(new RegExp(`^${n}\\s*(?:'|ft|feet|foot)\\s*(?:${n}\\s*(?:"|in|inch|inches)?)?$`));
  if (m) return (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * 2.54;
  m = s.match(new RegExp(`^${n}\\s*(?:"|in|inch|inches)$`));
  if (m) return parseFloat(m[1]) * 2.54;
  m = s.match(new RegExp(`^${n}\\s*(cm|mm|m)$`));
  if (m) { const v = parseFloat(m[1]); return m[2] === 'mm' ? v / 10 : m[2] === 'm' ? v * 100 : v; }
  if (units === 'ftin') {
    m = s.match(new RegExp(`^(\\d+)\\s+${n}$`));
    if (m) return (parseFloat(m[1]) * 12 + parseFloat(m[2])) * 2.54;
  }
  m = s.match(new RegExp(`^${n}$`));
  if (m) { const v = parseFloat(m[1]); return units === 'ftin' ? v * 2.54 : v; }
  return null;
}

export const formatMoney = v => (v == null || !isFinite(v) ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

/* ------------------------------------------------------------------ */
/* Accessors                                                           */
/* ------------------------------------------------------------------ */

export const getFloor = (p, id) => p.floors.find(f => f.id === id) || p.floors[0];
export const activeScenario = f => f.scenarios.find(s => s.id === f.activeScenario) || f.scenarios[0];

/** Find an entity by selection { kind, id } on a floor. Returns { obj, list } or null. */
export function findEntity(p, floorId, sel) {
  const f = getFloor(p, floorId);
  const sc = activeScenario(f);
  const lists = { item: sc.items, note: sc.notes, fixed: f.fixed, slope: f.slopeZones, wall: f.walls };
  const list = lists[sel.kind];
  if (!list) return null;
  const obj = list.find(e => e.id === sel.id);
  return obj ? { obj, list, floor: f, scenario: sc } : null;
}

/** All items across floors in each floor's active scenario, with floor reference. */
export function activeItems(p) {
  const out = [];
  for (const f of p.floors) for (const it of activeScenario(f).items) out.push({ item: it, floor: f });
  return out;
}

/* ------------------------------------------------------------------ */
/* Change stamping and merge (for live sync)                           */
/* ------------------------------------------------------------------ */

function sigOf(e, skip) {
  const o = {};
  for (const k in e) if (k !== 'u' && !(skip && skip.includes(k))) o[k] = e[k];
  return JSON.stringify(o);
}

function entityIndex(p) {
  const idx = new Map();
  const add = (e, skip) => { if (e && e.id) idx.set(e.id, { e, sig: sigOf(e, skip) }); };
  for (const f of p.floors || []) {
    for (const k of ['walls', 'fixed', 'slopeZones']) for (const e of f[k] || []) add(e);
    for (const sc of f.scenarios || []) {
      add(sc, ['items', 'notes']);
      for (const k of ['items', 'notes']) for (const e of sc[k] || []) add(e);
    }
  }
  for (const t of p.lists?.todo || []) add(t);
  for (const arr of Object.values(p.lists?.comments || {})) for (const c of arr) add(c);
  return idx;
}

/** Give every entity that changed between prev and next a fresh timestamp; record deletions. */
export function stampChanges(prev, next) {
  const now = Date.now();
  const a = entityIndex(prev), b = entityIndex(next);
  for (const [id, { e, sig }] of b) {
    const old = a.get(id);
    if (!old || old.sig !== sig) e.u = now;
  }
  next.tomb = next.tomb || {};
  for (const id of a.keys()) if (!b.has(id)) next.tomb[id] = now;
  for (const id of b.keys()) if (next.tomb[id] && next.tomb[id] < (b.get(id).e.u || 0)) delete next.tomb[id];
  if (sigOf(prev.project || {}) !== sigOf(next.project || {})) next.project.u = now;
  const cutoff = now - 1000 * 60 * 60 * 24 * 45;
  for (const [id, t] of Object.entries(next.tomb)) if (t < cutoff) delete next.tomb[id];
}

function mergeList(a = [], b = [], tomb, both) {
  const remote = new Map((b || []).map(e => [e.id, e]));
  const seen = new Set();
  const res = [];
  for (const le of a || []) {
    const re = remote.get(le.id);
    let w = le;
    if (re) {
      w = (re.u || 0) > (le.u || 0) ? clone(re) : le;
      if (both) w = both(le, re, w);
    }
    seen.add(le.id);
    res.push(w);
  }
  for (const re of b || []) if (!seen.has(re.id)) res.push(clone(re));
  return res.filter(e => !(tomb[e.id] && tomb[e.id] >= (e.u || 0)));
}

/**
 * Last-write-wins merge per entity. Settings, background images and the
 * active scenario choice stay local.
 */
export function mergeProjects(local, remote) {
  const out = clone(local);
  const tomb = { ...(local.tomb || {}) };
  for (const [id, t] of Object.entries(remote.tomb || {})) tomb[id] = Math.max(tomb[id] || 0, t);
  out.tomb = tomb;
  if ((remote.project?.u || 0) > (local.project?.u || 0)) out.project = clone(remote.project);
  for (const rf of remote.floors || []) {
    const lf = out.floors.find(f => f.id === rf.id);
    if (!lf) continue;
    for (const k of ['walls', 'fixed', 'slopeZones']) lf[k] = mergeList(lf[k], rf[k], tomb);
    lf.scenarios = mergeList(lf.scenarios, rf.scenarios, tomb, (l, r, w) => {
      w.items = mergeList(l.items, r.items, tomb);
      w.notes = mergeList(l.notes, r.notes, tomb);
      return w;
    });
    if (!lf.scenarios.length) lf.scenarios = [newScenario('Current')];
    if (!lf.scenarios.some(s => s.id === lf.activeScenario)) lf.activeScenario = lf.scenarios[0].id;
  }
  out.lists.todo = mergeList(out.lists.todo, remote.lists?.todo, tomb);
  const comments = {};
  const keys = new Set([...Object.keys(out.lists.comments || {}), ...Object.keys(remote.lists?.comments || {})]);
  for (const k of keys) {
    const merged = mergeList(out.lists.comments[k], remote.lists?.comments?.[k], tomb);
    if (merged.length) comments[k] = merged.sort((x, y) => (x.ts || 0) - (y.ts || 0));
  }
  out.lists.comments = comments;
  return out;
}

/** Copy linked element geometry (staircase) from the active floor to the others. */
function propagateLinked(p) {
  const src = getFloor(p, p.settings.floorId);
  for (const f of p.floors) {
    if (f === src) continue;
    for (const e of src.fixed) {
      if (!e.linkId) continue;
      const t = f.fixed.find(x => x.linkId === e.linkId);
      if (t) { for (const k of LINK_KEYS) if (e[k] !== undefined) t[k] = e[k]; }
      else f.fixed.push({ ...clone(e), id: uid('fx'), locked: e.locked });
    }
    f.fixed = f.fixed.filter(x => !x.linkId || src.fixed.some(e => e.linkId === x.linkId));
  }
}

/* ------------------------------------------------------------------ */
/* Store with undo and redo                                            */
/* ------------------------------------------------------------------ */

/** Snapshot without UI settings so undo never reverts view preferences. */
function snap(p) {
  const { settings, ...rest } = p;
  return JSON.stringify(rest);
}

export class Store {
  constructor(project) {
    this.state = project;
    this.undoStack = [];
    this.redoStack = [];
    this.max = 150;
    this.pending = null;
    this.listeners = new Set();
    this.lastSnap = snap(project);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error(e); }
    }
  }

  get floorId() { return this.state.settings.floorId; }
  get floor() { return getFloor(this.state, this.floorId); }
  get scenario() { return activeScenario(this.floor); }
  get units() { return this.state.project.units; }

  /** Mark the start of a multi-step edit (a drag). */
  begin() { if (this.pending == null) this.pending = this.lastSnap; }

  /** Abort an edit started with begin() and restore the state before it. */
  cancel() {
    if (this.pending == null) return;
    this.restore(this.pending);
    this.pending = null;
    this.emit({ type: 'change', label: 'Cancel', source: 'history' });
  }

  /** Finish an edit: record undo, stamp changes, notify listeners. */
  commit(label = 'Edit', { source = 'local', stamp = true } = {}) {
    const before = this.pending ?? this.lastSnap;
    this.pending = null;
    propagateLinked(this.state);
    if (stamp) stampChanges(JSON.parse(before), this.state);
    let after = snap(this.state);
    if (after === before) return false;
    this.state.meta.updatedAt = Date.now();
    this.state.meta.updatedBy = this.state.settings.userName || '';
    after = snap(this.state);
    this.undoStack.push(before);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack.length = 0;
    this.lastSnap = after;
    this.emit({ type: 'change', label, source });
    return true;
  }

  /** Run a mutation as one undoable step. */
  apply(label, fn) {
    this.begin();
    try { fn(this.state); }
    catch (e) { this.cancel(); throw e; }
    return this.commit(label);
  }

  restore(s) {
    const settings = this.state.settings;
    this.state = JSON.parse(s);
    this.state.settings = settings;
    this.lastSnap = s;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() { this.step(this.undoStack, this.redoStack, 'Undo'); }
  redo() { this.step(this.redoStack, this.undoStack, 'Redo'); }

  step(from, to, label) {
    if (!from.length) return;
    const prev = JSON.parse(this.lastSnap);
    to.push(this.lastSnap);
    this.restore(from.pop());
    stampChanges(prev, this.state);
    this.lastSnap = snap(this.state);
    this.emit({ type: 'change', label, source: 'history' });
  }

  /** Replace the whole project (import, share link). Clears history. */
  replace(project, label = 'Load') {
    const settings = this.state.settings;
    this.state = project;
    if (!project.settings) project.settings = settings;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.lastSnap = snap(project);
    this.emit({ type: 'change', label, source: 'load' });
  }

  /** Change a UI setting (not undoable, still saved). */
  setSetting(key, value) {
    this.state.settings[key] = value;
    this.emit({ type: 'settings', key });
  }
}
