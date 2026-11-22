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

/*
 * Baseline plan for 126 and 226: the rooms as they are today, from the
 * original floor plans, on-site measurements and photos (Nov 2026).
 * All walls are straight. Coordinates are cm; x grows east, y grows south;
 * the main room's north wall is y = 0.
 *
 * Main room (both floors): 407 cm wide by 457 cm (126) or 461 cm (226).
 * Chimney breast on the west wall: 135 cm of wall from the north corner, then
 * the breast (194 cm wide, 31 cm deep), then the rest of the wall.
 *
 * 126 north wall, west to east: door to the entry hall, the kitchen alcove
 * (fridge, small counter, stove, microwave above), door to the staircase.
 * The hall leads north through the 85 cm brick arch to the alcove and the
 * building door. 226 north wall: closet door and the door to the stairs.
 * 226 has sloped ceilings along both long walls: 108 cm knee walls rising
 * to the flat ceiling.
 */
const W = 407, NORTH = 202, BREAST = { top: 135, width: 194, depth: 31 };
const ALCOVE = { x1: 115, x2: 305, depth: 70 };

function seg(x1, y1, x2, y2) { return { id: uid('w'), x1, y1, x2, y2, thickness: 12 }; }

function mainRoom(len, northBreaks) {
  const b1 = BREAST.top, b2 = BREAST.top + BREAST.width;
  const out = [
    seg(W, 0, W, len), seg(W, len, 0, len),
    seg(0, len, 0, b2), seg(0, b2, BREAST.depth, b2), seg(BREAST.depth, b2, BREAST.depth, b1), seg(BREAST.depth, b1, 0, b1), seg(0, b1, 0, 0)
  ];
  if (!northBreaks) out.push(seg(0, 0, W, 0));
  return out;
}

function planWalls(floorId) {
  if (floorId === '126') {
    const a = ALCOVE;
    return [
      ...mainRoom(457, true),
      // North wall with the kitchen alcove.
      seg(0, 0, a.x1, 0), seg(a.x1, 0, a.x1, -a.depth), seg(a.x1, -a.depth, a.x2, -a.depth), seg(a.x2, -a.depth, a.x2, 0), seg(a.x2, 0, W, 0),
      // Entry hall (west) and staircase (east) north of the room.
      seg(0, 0, 0, -NORTH), seg(0, -NORTH, 15, -NORTH), seg(100, -NORTH, W, -NORTH), seg(W, -NORTH, W, 0),
      seg(a.x1, -a.depth, a.x1, -NORTH), seg(a.x2, -a.depth, a.x2, -NORTH),
      // Brick alcove behind the 85 cm arch.
      seg(-15, -NORTH, -15, -NORTH - 147), seg(-15, -NORTH - 147, 130, -NORTH - 147), seg(130, -NORTH - 147, 130, -NORTH),
      seg(-15, -NORTH, 15, -NORTH), seg(100, -NORTH, 130, -NORTH)
    ];
  }
  return [
    ...mainRoom(461, false),
    seg(0, 0, 0, -NORTH), seg(0, -NORTH, W, -NORTH), seg(W, -NORTH, W, 0),
    // Closet (west) and stair landing (east).
    seg(150, 0, 150, -NORTH)
  ];
}

function fx(type, name, x, y, width, depth, rotation, extra = {}) {
  return { id: uid('fx'), type, name, x, y, width, depth, height: 0, rotation, shape: 'rect', locked: false, notes: '', ...extra };
}

function planFixed(floorId, linkId) {
  const len = floorId === '126' ? 457 : 461;
  const out = [
    fx('stairs', 'Staircase', 356, -101, 90, 190, 0, { stairStyle: 'winding', stairTurn: 'left', linkId }),
    fx('fireplace', 'Fireplace and mantel', BREAST.depth + 6 + 23, BREAST.top + BREAST.width / 2, 152, 46, 270, { height: 110 })
  ];
  if (floorId === '126') {
    out.push(
      fx('door', 'Door to entry hall', 62.5, 0, 81, 5, 0, { hinge: 'left', swing: 'out', height: 203 }),
      fx('door', 'Door to stairs', 350, 0, 76, 5, 0, { hinge: 'right', swing: 'out', height: 203 }),
      fx('door', 'Building door', -15, -NORTH - 80, 81, 5, 90, { hinge: 'left', swing: 'in', height: 203, entry: true }),
      fx('fridge', 'Fridge', 150, -40, 60, 60, 0, { height: 150 }),
      fx('counter', 'Counter', 202, -38, 44, 64, 0, { height: 91 }),
      fx('stove', 'Stove (microwave above)', 262, -39, 76, 62, 0, { height: 91 }),
      fx('window', 'Window (AC unit)', W, 300, 150, 12, 90, { height: 120 }),
      fx('ac', 'AC unit (in window)', W - 14, 330, 60, 18, 90, { height: 40 }),
      fx('window', 'Window', 260, len, 150, 12, 180, { height: 120 }),
      fx('radiator', 'Radiator', 260, len - 13, 140, 15, 180, { height: 60 })
    );
  } else {
    out.push(
      fx('door', 'Closet door', 85, 0, 76, 5, 0, { hinge: 'left', swing: 'in', height: 203 }),
      fx('door', 'Door to stairs', 195, 0, 81, 5, 0, { hinge: 'right', swing: 'in', height: 203 }),
      fx('closet', 'Closet', 75, -101, 138, 178, 0, { height: 200 }),
      fx('window', 'Window', 215, len, 230, 12, 180, { height: 120 }),
      fx('radiator', 'Radiator', 215, len - 13, 230, 15, 180, { height: 60 })
    );
  }
  return out;
}

/** 226 sloped ceilings: knee walls 108 cm high on the east and west walls. */
function planSlopes(floorId) {
  if (floorId !== '226') return [];
  const len = 461;
  const z = (x, lowSide) => ({ id: uid('sz'), x, y: len / 2, width: 145, depth: len, rotation: 0, low: 108, high: 240, lowSide, locked: false });
  return [z(72.5, 'left'), z(W - 72.5, 'right')];
}

/*
 * Baseline furniture, placed as in the photos.
 * Each row: [name, width, depth, height, x, y, rotation, shape, color, layer, decor, plant].
 * Rotation 0 puts an item's back to the north wall; 90 east, 180 south, 270 west.
 */
const S = { linen: '#D9CCB6', oak: '#C49A6C', walnut: '#6E4B33', rug: '#E6D8C3', sage: '#A7B59A', bed: '#E8DFD0', cream: '#EFE6D6' };
const STARTER = {
  '126': [
    ['Kitchen vinyl floor', 210, 134, 1, 210, 67, 0, 'rect', '#E3C98F', 'rugs'],
    ['Kitchen island (drop-leaf table)', 90, 120, 91, 210, 190, 0, 'rect', S.walnut, 'furniture'],
    ['Bar stool', 41, 41, 76, 140, 170, 0, 'circle', '#BFB3A0', 'furniture'],
    ['Bar stool', 41, 41, 76, 210, 285, 0, 'circle', '#BFB3A0', 'furniture'],
    ['Drop-leaf table', 50, 110, 76, 376, 110, 0, 'rect', S.walnut, 'furniture'],
    ['Dining chair', 46, 50, 86, 330, 110, 90, 'rect', '#B08A62', 'furniture', 'chair'],
    ['Striped rug', 152, 244, 1, 255, 330, 0, 'rect', '#E9C46A', 'rugs', 'rug'],
    ['Sofa', 200, 90, 86, 356, 300, 90, 'rect', '#DDE5DA', 'furniture', 'sofa'],
    ['Coffee table', 60, 60, 46, 270, 330, 0, 'rect', '#F4F1EA', 'furniture'],
    ['Side table', 46, 46, 56, 375, 420, 0, 'rect', S.walnut, 'furniture'],
    ['Armchair', 85, 85, 86, 300, 405, 200, 'rect', '#E7EDF5', 'furniture', 'armchair'],
    ['Plant shelf', 60, 35, 150, 205, 434, 180, 'rect', '#B07A3A', 'furniture', 'shelves'],
    ['Shelving and storage', 45, 110, 90, 60, 400, 270, 'rect', '#3F362F', 'furniture', 'shelves'],
    ['Pothos', 30, 30, 40, 205, 434, 0, 'circle', '#5E8C4A', 'plants', 'plant', 'pothos'],
    ['Plant (medium)', 35, 35, 70, 250, 430, 0, 'circle', '#6F8F5E', 'plants', 'plant', 'generic'],
    ['Spider plant', 35, 35, 35, 390, 380, 0, 'circle', '#7BA05B', 'plants', 'plant', 'spider'],
    ['Plant (medium)', 35, 35, 70, 60, 335, 0, 'circle', '#6F8F5E', 'plants', 'plant', 'generic'],
    ['Trash can', 30, 30, 60, 40, -170, 0, 'rect', '#9C948A', 'furniture'],
    ['Coat rack', 50, 50, 180, 100, -310, 0, 'circle', S.walnut, 'furniture'],
    ['Shoe rack', 80, 30, 50, 30, -270, 270, 'rect', S.oak, 'furniture', 'shelves']
  ],
  '226': [
    ['Bed (full)', 137, 191, 55, 305.5, 220, 90, 'rect', S.bed, 'furniture', 'bed'],
    ['Nightstand', 46, 41, 61, 380.5, 102, 90, 'rect', S.oak, 'furniture'],
    ['Nightstand desk', 90, 45, 76, 330, 28.5, 0, 'rect', S.oak, 'furniture', 'drawers'],
    ['Floor mirror', 60, 4, 160, 260, 10, 0, 'rect', '#D5DEDF', 'furniture', 'mirror'],
    ['Desk', 100, 50, 75, 345, 430, 180, 'rect', S.oak, 'furniture'],
    ['Office chair', 55, 55, 100, 345, 385, 180, 'circle', '#9A958B', 'furniture', 'chair'],
    ['Round rug', 120, 120, 1, 215, 360, 0, 'circle', '#9DB7D5', 'rugs', 'rug'],
    ['Dresser (low)', 110, 45, 75, 28.5, 72, 270, 'rect', S.oak, 'furniture', 'drawers'],
    ['Towel rack', 60, 30, 90, 110, 260, 270, 'rect', '#3F362F', 'furniture'],
    ['Elephant wall hanging', 80, 3, 60, 8, 385, 270, 'rect', '#8E4A33', 'furniture', 'macrame'],
    ['Plant (medium)', 35, 35, 70, 30, 440, 0, 'circle', '#6F8F5E', 'plants', 'plant', 'generic']
  ]
};

function starterItems(floorId) {
  return (STARTER[floorId] || []).map(([name, width, depth, height, x, y, rotation, shape, color, layer, decor, plant]) => ({
    id: uid('it'), type: 'starter', name, x, y, width, depth, height, rotation, shape, color,
    status: 'keep', room: floorId, price: null, store: '', link: '', priority: 'Should', notes: '',
    locked: false, layer, decor, plant, disposition: 'Undecided'
  }));
}

const activeSc = f => f.scenarios.find(s => s.id === f.activeScenario) || f.scenarios[0];

/**
 * Apply the baseline plan once per project (planV5). Earlier default drafts
 * are replaced: walls, fixed elements, slope zones and starter furniture on
 * both floors. Furniture you added yourself is kept.
 */
function seedDefaults(p) {
  if (p.meta.planV5) return;
  const linkId = uid('link');
  for (const f of p.floors) {
    f.walls = planWalls(f.id);
    f.fixed = planFixed(f.id, linkId);
    f.slopeZones = planSlopes(f.id);
    const sc = activeSc(f);
    if (sc) {
      sc.name = sc.name === 'Current' ? 'Current (as is)' : sc.name;
      sc.items = [...sc.items.filter(it => it.type !== 'starter'), ...starterItems(f.id)];
    }
  }
  p.meta.planV5 = true;
}

/** Starter project: both floors with the default plan and starter furniture. */
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
