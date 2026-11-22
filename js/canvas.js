/**
 * canvas.js
 * SVG floor plan: world rendering (walls, fixed elements, slope zones, furniture,
 * plants, notes, labels, clearance overlay), geometry helpers, and the
 * interactive PlanCanvas (pan, pinch-zoom, select, drag, resize, rotate,
 * wall drawing, calibration, rulers, distance readouts, compare pane).
 * World units are centimeters. Overlay units are screen pixels.
 */
import { formatLen, findEntity, uid, activeScenario } from './state.js';
import { loadScript, CDN, toast } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const HEADROOM = 190;
const MIN_S = 0.04, MAX_S = 10;
const BOX_KINDS = new Set(['item', 'fixed', 'slope']);

/** Create an SVG element. */
export function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/* ------------------------------------------------------------------ */
/* Palettes and SVG styles                                             */
/* ------------------------------------------------------------------ */

export const PALETTES = {
  light: {
    bg: '#F6F1E9', grid: '#E5DBCA', gridMajor: '#D3C4AD', wall: '#3B332C', wallLabel: '#2E2A26', halo: '#F6F1E9',
    fixedFill: '#EEE5D6', fixedStroke: '#6B5442', wood: '#5A3E2B', brick: '#8E4A33', mortar: '#C79F86',
    counter: '#DCD2C3', glass: '#BFD3D6', label: '#2E2A26', sub: '#5F574E', sel: '#B5603C', danger: '#C0392B',
    slope: '#7F9070', noteFill: '#F3DD9B', noteStroke: '#A8853A', ruler: '#EDE4D6', rulerInk: '#5F574E', pot: '#B5603C',
    status: { keep: '#5C544B', move: '#2F6690', remove: '#B23A3A', buy: '#B5603C', bought: '#4F7340' }
  },
  dark: {
    bg: '#1F1A16', grid: '#2E2823', gridMajor: '#3D352E', wall: '#E6DDD0', wallLabel: '#EDE6DC', halo: '#1F1A16',
    fixedFill: '#2E2721', fixedStroke: '#BCA58D', wood: '#C9A27E', brick: '#A65A40', mortar: '#5C3A2C',
    counter: '#3A322B', glass: '#4F6E74', label: '#EDE6DC', sub: '#BDB2A4', sel: '#E08A62', danger: '#E8685F',
    slope: '#9FB08F', noteFill: '#C9A94F', noteStroke: '#8C7330', ruler: '#2A241F', rulerInk: '#BDB2A4', pot: '#C46C47',
    status: { keep: '#C7BDB0', move: '#7FB0D8', remove: '#EC8276', buy: '#E8916A', bought: '#A3C690' }
  }
};

export const STATUS_DASH = { keep: null, move: '6 4', remove: '3 3', buy: null, bought: null };

/** CSS for the plan SVG. inv is a CSS expression or number for 1/zoom (keeps labels a constant screen size). */
export function svgCss(pal, inv = null) {
  const f = px => (inv == null ? `calc(${px}px * var(--inv, 1))` : `${(px * inv).toFixed(3)}px`);
  return `
  .world path, .world rect, .world circle, .world ellipse, .world polygon, .world polyline, .world line:not(.wall) { vector-effect: non-scaling-stroke; }
  text { font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .sketch text { font-family: Caveat, 'Segoe Print', 'Bradley Hand', cursive; }
  .lbl { font-size: ${f(12)}; font-weight: 600; fill: ${pal.label}; text-anchor: middle; dominant-baseline: central;
    paint-order: stroke; stroke: ${pal.halo}; stroke-width: ${f(3)}; stroke-linejoin: round; pointer-events: none; }
  .lbl.sub { font-size: ${f(10)}; font-weight: 500; fill: ${pal.sub}; }
  .lbl.note { text-anchor: start; font-weight: 500; }
  .lbl.warn { fill: ${pal.danger}; }
  .sketch .lbl { font-size: ${f(15)}; } .sketch .lbl.sub { font-size: ${f(13)}; }
  .wlbl { font-size: ${f(11)}; font-weight: 600; fill: ${pal.wallLabel}; text-anchor: middle; dominant-baseline: central;
    paint-order: stroke; stroke: ${pal.halo}; stroke-width: ${f(3)}; stroke-linejoin: round; pointer-events: none; }
  .sketch .wlbl { font-size: ${f(14)}; }
  .clr { font-size: ${f(11)}; font-weight: 700; fill: ${pal.danger}; text-anchor: middle; dominant-baseline: central;
    paint-order: stroke; stroke: ${pal.halo}; stroke-width: ${f(3)}; pointer-events: none; }
  .zl .lbl.sub { display: none; }
  .ent { cursor: grab; }
  .ent.locked { cursor: default; }
  `;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rad = d => (d * Math.PI) / 180;
export function rot(x, y, deg) {
  const r = rad(deg), c = Math.cos(r), sn = Math.sin(r);
  return { x: x * c - y * sn, y: x * sn + y * c };
}
export const toLocal = (e, px, py) => rot(px - e.x, py - e.y, -(e.rotation || 0));
export function toWorldPt(e, lx, ly) {
  const p = rot(lx, ly, e.rotation || 0);
  return { x: p.x + e.x, y: p.y + e.y };
}

export function localPoly(e) {
  const w = e.width, d = e.depth, hw = w / 2, hd = d / 2;
  if (e.shape === 'circle') {
    const pts = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hd }); }
    return pts;
  }
  if (e.shape === 'lshape') {
    const a = clamp(e.armWidth || Math.min(w, d) * 0.45, 5, Math.min(w, d));
    return [{ x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: -hd + a }, { x: -hw + a, y: -hd + a }, { x: -hw + a, y: hd }, { x: -hw, y: hd }];
  }
  return [{ x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd }];
}
export const worldPoly = e => localPoly(e).map(p => toWorldPt(e, p.x, p.y));

export function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polysIntersect(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) if (segIntersect(a1, a2, B[j], B[(j + 1) % B.length])) return true;
  }
  return pointInPoly(A[0], B) || pointInPoly(B[0], A);
}

function closestOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { q, d: Math.hypot(p.x - q.x, p.y - q.y), t };
}

/** Shortest gap between two polygons. d is 0 when they overlap. */
export function polyDistance(A, B) {
  if (polysIntersect(A, B)) return { d: 0 };
  let best = { d: Infinity };
  for (const p of A) for (let j = 0; j < B.length; j++) {
    const r = closestOnSeg(p, B[j], B[(j + 1) % B.length]);
    if (r.d < best.d) best = { d: r.d, p, q: r.q };
  }
  for (const p of B) for (let j = 0; j < A.length; j++) {
    const r = closestOnSeg(p, A[j], A[(j + 1) % A.length]);
    if (r.d < best.d) best = { d: r.d, p: r.q, q: p };
  }
  return best;
}

export function wallLength(w) { return Math.hypot(w.x2 - w.x1, w.y2 - w.y1); }

/** Rectangle polygon covering a wall's thickness (with square caps). */
export function wallPoly(w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy) || 1, h = w.thickness / 2;
  const ux = dx / L, uy = dy / L, nx = -uy * h, ny = ux * h, ex = ux * h, ey = uy * h;
  return [
    { x: w.x1 - ex + nx, y: w.y1 - ey + ny }, { x: w.x2 + ex + nx, y: w.y2 + ey + ny },
    { x: w.x2 + ex - nx, y: w.y2 + ey - ny }, { x: w.x1 - ex - nx, y: w.y1 - ey - ny }
  ];
}

/** Cast a ray; return distance to the nearest wall face, or null. */
export function rayHit(o, dir, walls) {
  let best = Infinity, thick = 0;
  for (const w of walls) {
    const sx = w.x2 - w.x1, sy = w.y2 - w.y1;
    const den = dir.x * sy - dir.y * sx;
    if (Math.abs(den) < 1e-9) continue;
    const ax = w.x1 - o.x, ay = w.y1 - o.y;
    const t = (ax * sy - ay * sx) / den;
    const u = (ax * dir.y - ay * dir.x) / den;
    if (u >= 0 && u <= 1 && t >= -w.thickness / 2 && t < best) { best = t; thick = w.thickness; }
  }
  return best === Infinity ? null : { t: best, d: best - thick / 2 };
}

/** Ceiling height at a point, from slope zones (null if no zone covers it). */
export function ceilingAt(floor, x, y) {
  let h = null;
  for (const z of floor.slopeZones) {
    const l = toLocal(z, x, y), hw = z.width / 2, hd = z.depth / 2;
    if (Math.abs(l.x) > hw + 0.01 || Math.abs(l.y) > hd + 0.01) continue;
    const t = { top: (l.y + hd) / z.depth, bottom: (hd - l.y) / z.depth, left: (l.x + hw) / z.width, right: (hw - l.x) / z.width }[z.lowSide];
    const v = z.low + (z.high - z.low) * clamp(t, 0, 1);
    h = h == null ? v : Math.min(h, v);
  }
  return h;
}

/** Minimum ceiling height over an item's footprint (null if not under a slope). */
export function minCeilingOver(floor, it) {
  let h = null;
  for (const p of [...worldPoly(it), { x: it.x, y: it.y }]) {
    const c = ceilingAt(floor, p.x, p.y);
    if (c != null) h = h == null ? c : Math.min(h, c);
  }
  return h;
}

export function itemVisible(it, settings) {
  return settings.layers[it.layer] !== false && settings.statusFilter[it.status] !== false;
}

export function ceilingWarnings(floor, scenario) {
  const out = new Map();
  if (!floor.slopeZones.length) return out;
  for (const it of scenario.items) {
    const c = minCeilingOver(floor, it);
    if (c != null && it.height > c) out.set(it.id, c);
  }
  return out;
}

const CLEAR_EXEMPT_TYPES = new Set(['wall-shelf', 'mirror', 'tv', 'macrame']);
const FIXED_NON_OBSTACLE = new Set(['door', 'window', 'outlet', 'light', 'ac']);
export const MIN_WALKWAY = 90;

/** Door swing sector polygon (world). */
export function doorSwingPoly(door) {
  const hw = door.width / 2, hx = door.hinge === 'right' ? hw : -hw, sgn = door.swing === 'out' ? -1 : 1;
  const pts = [{ x: hx, y: 0 }];
  const a1 = Math.atan2(sgn * door.width, 0), a2 = Math.atan2(0, -hx - hx);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  for (let i = 0; i <= 8; i++) {
    const a = a1 + (delta * i) / 8;
    pts.push({ x: hx + Math.cos(a) * door.width, y: Math.sin(a) * door.width });
  }
  return pts.map(p => toWorldPt(door, p.x, p.y));
}

/** Clear zone inside an entry door. */
function entryZone(door) {
  const sgn = door.swing === 'out' ? -1 : 1, hw = door.width / 2 + 10;
  const pts = [{ x: -hw, y: 0 }, { x: hw, y: 0 }, { x: hw, y: sgn * MIN_WALKWAY }, { x: -hw, y: sgn * MIN_WALKWAY }];
  return pts.map(p => toWorldPt(door, p.x, p.y));
}

/** Walkway and blocking analysis for the clearance overlay. */
export function computeClearance(floor, scenario, settings) {
  const items = scenario.items.filter(it => itemVisible(it, settings) && it.layer !== 'rugs' && it.layer !== 'lighting' && !CLEAR_EXEMPT_TYPES.has(it.type));
  const polys = items.map(it => ({ it, poly: worldPoly(it) }));
  const fixedObs = floor.fixed.filter(f => !FIXED_NON_OBSTACLE.has(f.type)).map(f => worldPoly(f));
  const wallPolys = floor.walls.map(wallPoly);
  const gaps = [], blocked = new Set(), zones = [];
  for (let i = 0; i < polys.length; i++) {
    const others = [...polys.slice(i + 1).map(p => p.poly), ...fixedObs, ...wallPolys];
    for (const o of others) {
      const r = polyDistance(polys[i].poly, o);
      if (r.d > 3 && r.d < MIN_WALKWAY && r.p) gaps.push(r);
    }
  }
  for (const door of floor.fixed.filter(f => f.type === 'door')) {
    const zs = [doorSwingPoly(door)];
    if (door.entry) zs.push(entryZone(door));
    for (const z of zs) {
      let hit = false;
      for (const p of polys) if (polysIntersect(p.poly, z)) { blocked.add(p.it.id); hit = true; }
      zones.push({ poly: z, hit });
    }
  }
  for (const st of floor.fixed.filter(f => f.type === 'stairs')) {
    const z = worldPoly({ ...st, width: st.width + 60, depth: st.depth + 60 });
    let hit = false;
    for (const p of polys) if (polysIntersect(p.poly, z)) { blocked.add(p.it.id); hit = true; }
    zones.push({ poly: z, hit, stairs: true });
  }
  return { gaps, blocked, zones };
}

/** Bounding box of everything drawn on a floor. */
export function contentBounds(floor, scenario, withBg = true) {
  const pts = [];
  for (const w of floor.walls) pts.push(...wallPoly(w));
  for (const e of [...floor.fixed, ...floor.slopeZones, ...scenario.items]) pts.push(...worldPoly(e));
  for (const n of scenario.notes) pts.push({ x: n.x - 20, y: n.y - 20 }, { x: n.x + 120, y: n.y + 20 });
  const bg = floor.background;
  if (withBg && bg.image && bg.visible) pts.push({ x: bg.offset.x, y: bg.offset.y }, { x: bg.offset.x + bg.w * bg.scale, y: bg.offset.y + bg.h * bg.scale });
  return pts.length ? bboxOf(pts) : null;
}

/* ------------------------------------------------------------------ */
/* World rendering                                                     */
/* ------------------------------------------------------------------ */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000 + 1;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => clamp(Math.round(v + amt * 255), 0, 255));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

const tf = e => `translate(${e.x} ${e.y}) rotate(${e.rotation || 0})`;

/** Draw a primitive, hand-sketched when sketch mode has a Rough.js instance. */
function shp(ctx, kind, a, st, parent) {
  let node;
  if (ctx.rc && !st.crisp) {
    const o = {
      stroke: st.stroke || 'none', strokeWidth: st.sw ?? 1, roughness: st.rough ?? 1.1, bowing: 1, seed: ctx.seed || 1,
      fill: st.fill && st.fill !== 'none' ? shade(st.fill, -0.12) : undefined, fillStyle: 'hachure', hachureGap: st.gap || 6, fillWeight: 0.6
    };
    if (st.dash) o.strokeLineDash = st.dash.split(' ').map(Number);
    if (st.fill && st.fill !== 'none') {
      const under = kind === 'rect' ? s('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: st.fill, opacity: 0.55 })
        : kind === 'ellipse' ? s('ellipse', { cx: a.cx, cy: a.cy, rx: a.w / 2, ry: a.h / 2, fill: st.fill, opacity: 0.55 })
          : kind === 'polygon' ? s('polygon', { points: a.pts.map(p => `${p.x},${p.y}`).join(' '), fill: st.fill, opacity: 0.55 }) : null;
      if (under) parent.appendChild(under);
    }
    if (kind === 'rect') node = ctx.rc.rectangle(a.x, a.y, a.w, a.h, o);
    else if (kind === 'ellipse') node = ctx.rc.ellipse(a.cx, a.cy, a.w, a.h, o);
    else if (kind === 'polygon') node = ctx.rc.polygon(a.pts.map(p => [p.x, p.y]), o);
    else if (kind === 'line') node = ctx.rc.line(a.x1, a.y1, a.x2, a.y2, o);
    else node = ctx.rc.path(a.d, o);
  } else {
    const c = { fill: st.fill || 'none', stroke: st.stroke || 'none', 'stroke-width': st.sw ?? 1, 'stroke-dasharray': st.dash || null, opacity: st.op ?? null, 'stroke-linecap': 'round' };
    if (kind === 'rect') node = s('rect', { x: a.x, y: a.y, width: a.w, height: a.h, rx: a.rx || 0, ...c });
    else if (kind === 'ellipse') node = s('ellipse', { cx: a.cx, cy: a.cy, rx: a.w / 2, ry: a.h / 2, ...c });
    else if (kind === 'polygon') node = s('polygon', { points: a.pts.map(p => `${p.x},${p.y}`).join(' '), ...c });
    else if (kind === 'line') node = s('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...c });
    else node = s('path', { d: a.d, ...c });
  }
  parent.appendChild(node);
  return node;
}

function bodyShape(e, ctx, st, g) {
  const w = e.width, d = e.depth;
  if (e.shape === 'circle') return shp(ctx, 'ellipse', { cx: 0, cy: 0, w, h: d }, st, g);
  if (e.shape === 'lshape') return shp(ctx, 'polygon', { pts: localPoly(e) }, st, g);
  return shp(ctx, 'rect', { x: -w / 2, y: -d / 2, w, h: d, rx: Math.min(4, w / 10, d / 10) }, st, g);
}

const PLANT_STYLE = {
  generic: { n: 8, rx: 0.5, ry: 0.2, c: ['#5E7F55', '#7C9A6A'] },
  pothos: { n: 7, rx: 0.42, ry: 0.3, c: ['#5E8C4A', '#B9CC6E'] },
  spider: { n: 16, rx: 0.56, ry: 0.07, c: ['#7BA05B', '#E5E8C2'] },
  tradescantia: { n: 9, rx: 0.5, ry: 0.15, c: ['#6D4C7D', '#9067A3'] },
  callisia: { n: 8, rx: 0.48, ry: 0.2, c: ['#7FA36B', '#A2BE8B'] }
};

function drawPlant(e, ctx, g, stc, dash) {
  const r = Math.min(e.width, e.depth) / 2;
  const sp = PLANT_STYLE[e.plant] || PLANT_STYLE.generic;
  s('circle', { r: r * 0.55, fill: ctx.pal.pot, opacity: 0.85 }, g);
  const off = hash(e.id) % 40;
  for (let i = 0; i < sp.n; i++) {
    const a = off + (i * 360) / sp.n;
    const lr = r * (i % 2 ? 0.86 : 1);
    s('ellipse', { cx: lr * sp.rx, cy: 0, rx: lr * sp.rx, ry: lr * sp.ry, fill: sp.c[i % 2], stroke: shade(sp.c[0], -0.15), 'stroke-width': 0.6, transform: `rotate(${a})` }, g);
  }
  s('circle', { r, fill: 'none', stroke: stc, 'stroke-width': 1.2, 'stroke-dasharray': dash || '2 3' }, g);
}

function decorate(e, ctx, g) {
  const w = e.width, d = e.depth, hw = w / 2, hd = d / 2, ln = { stroke: ctx.pal.sub, sw: 1, op: 0.75 };
  switch (e.decor) {
    case 'sofa': case 'armchair':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d * 0.24 }, ln, g);
      shp(ctx, 'rect', { x: -hw, y: -hd, w: Math.min(w * 0.13, 22), h: d }, ln, g);
      shp(ctx, 'rect', { x: hw - Math.min(w * 0.13, 22), y: -hd, w: Math.min(w * 0.13, 22), h: d }, ln, g);
      break;
    case 'bed': {
      const m = w * 0.06, two = w > 110, pw = two ? (w - 3 * m) / 2 : w - 2 * m, ph = d * 0.12;
      shp(ctx, 'rect', { x: -hw + m, y: -hd + m, w: pw, h: ph, rx: 4 }, { ...ln, fill: '#FBF8F2', op: 0.95 }, g);
      if (two) shp(ctx, 'rect', { x: -hw + 2 * m + pw, y: -hd + m, w: pw, h: ph, rx: 4 }, { ...ln, fill: '#FBF8F2', op: 0.95 }, g);
      shp(ctx, 'line', { x1: -hw, y1: -hd + d * 0.32, x2: hw, y2: -hd + d * 0.32 }, ln, g);
      break;
    }
    case 'rug': {
      const i = Math.min(10, w * 0.07, d * 0.07);
      if (e.shape === 'circle') shp(ctx, 'ellipse', { cx: 0, cy: 0, w: w - 2 * i, h: d - 2 * i }, { ...ln, dash: '4 3' }, g);
      else shp(ctx, 'rect', { x: -hw + i, y: -hd + i, w: w - 2 * i, h: d - 2 * i }, { ...ln, dash: '4 3' }, g);
      break;
    }
    case 'lamp':
      s('ellipse', { rx: hw * 0.45, ry: hd * 0.45, fill: '#FFF6D6', stroke: ctx.pal.sub, 'stroke-width': 0.8 }, g);
      s('circle', { r: Math.min(hw, hd) * 0.12, fill: ctx.pal.sub }, g);
      break;
    case 'chair':
      shp(ctx, 'rect', { x: -hw * 0.8, y: -hd, w: w * 0.8, h: d * 0.18, rx: 2 }, ln, g);
      break;
    case 'drawers':
      shp(ctx, 'line', { x1: -hw, y1: hd - d * 0.14, x2: hw, y2: hd - d * 0.14 }, ln, g);
      shp(ctx, 'line', { x1: 0, y1: -hd, x2: 0, y2: hd - d * 0.14 }, ln, g);
      break;
    case 'shelves': {
      const n = Math.max(1, Math.round(w / 35));
      for (let i = 1; i < n; i++) { const x = -hw + (w * i) / n; shp(ctx, 'line', { x1: x, y1: -hd, x2: x, y2: hd }, ln, g); }
      break;
    }
    case 'mirror':
      shp(ctx, 'line', { x1: -hw * 0.5, y1: hd, x2: -hw * 0.2, y2: -hd }, ln, g);
      shp(ctx, 'line', { x1: hw * 0.1, y1: hd, x2: hw * 0.4, y2: -hd }, ln, g);
      break;
    case 'macrame': {
      const n = Math.max(4, Math.round(w / 6));
      for (let i = 0; i <= n; i++) { const x = -hw + (w * i) / n; s('line', { x1: x, y1: hd, x2: x, y2: hd + 8, stroke: ctx.pal.sub, 'stroke-width': 0.8 }, g); }
      break;
    }
    case 'cushion':
      if (e.shape === 'circle') s('ellipse', { rx: hw * 0.65, ry: hd * 0.65, fill: 'none', stroke: ctx.pal.sub, 'stroke-width': 0.8, opacity: 0.7 }, g);
      else shp(ctx, 'rect', { x: -hw * 0.7, y: -hd * 0.7, w: w * 0.7, h: d * 0.7, rx: 6 }, ln, g);
      s('circle', { r: Math.min(hw, hd) * 0.08, fill: ctx.pal.sub, opacity: 0.7 }, g);
      break;
    case 'tv':
      shp(ctx, 'line', { x1: -hw * 0.9, y1: hd + 4, x2: hw * 0.9, y2: hd + 4 }, { ...ln, dash: '2 2' }, g);
      break;
    default: break;
  }
}

function buildItem(it, ctx) {
  const g = s('g', { class: 'ent item' + (it.locked ? ' locked' : ''), 'data-kind': 'item', 'data-id': it.id, transform: tf(it) });
  ctx.seed = hash(it.id);
  const stc = ctx.pal.status[it.status] || ctx.pal.status.keep;
  const dash = STATUS_DASH[it.status];
  const sw = it.status === 'keep' ? 1.3 : 2;
  if (it.decor === 'plant') drawPlant(it, ctx, g, stc, dash);
  else {
    bodyShape(it, ctx, { fill: it.color, stroke: stc, sw, dash }, g);
    decorate(it, ctx, g);
  }
  if (it.status === 'remove') {
    const hw = it.width / 2 * 0.6, hd = it.depth / 2 * 0.6;
    s('path', { d: `M${-hw} ${-hd}L${hw} ${hd}M${hw} ${-hd}L${-hw} ${hd}`, stroke: stc, 'stroke-width': 1.5, opacity: 0.7, fill: 'none' }, g);
  }
  if (ctx.warn.has(it.id) || ctx.blocked.has(it.id)) {
    bodyShape(it, { ...ctx, rc: null }, { stroke: ctx.pal.danger, sw: 2.5, dash: '5 3', fill: 'none' }, g);
  }
  if (it.depth < 14 || it.width < 14) {
    s('rect', { x: -Math.max(it.width, 14) / 2, y: -Math.max(it.depth, 14) / 2, width: Math.max(it.width, 14), height: Math.max(it.depth, 14), fill: 'transparent' }, g);
  }
  return g;
}

function arcPath(cx, cy, r, from, to) {
  const a1 = Math.atan2(from.y - cy, from.x - cx), a2 = Math.atan2(to.y - cy, to.x - cx);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return `M${from.x} ${from.y}A${r} ${r} 0 0 ${delta > 0 ? 1 : 0} ${to.x} ${to.y}`;
}

function buildStairs(e, ctx, g) {
  const w = e.width, d = e.depth, hw = w / 2, hd = d / 2, pal = ctx.pal;
  const ln = { stroke: pal.fixedStroke, sw: 1 };
  const inner = s('g', { transform: e.stairTurn === 'left' ? 'scale(-1 1)' : null }, g);
  if (e.stairStyle === 'spiral') {
    shp(ctx, 'ellipse', { cx: 0, cy: 0, w, h: d }, { fill: pal.fixedFill, stroke: pal.fixedStroke, sw: 1.5 }, inner);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; shp(ctx, 'line', { x1: 0, y1: 0, x2: Math.cos(a) * hw, y2: Math.sin(a) * hd }, ln, inner); }
    s('circle', { r: Math.min(8, hw * 0.15), fill: pal.fixedStroke }, inner);
    s('path', { d: arcPath(0, 0, hw * 0.6, { x: hw * 0.6, y: 0 }, { x: 0, y: -hd * 0.6 }), fill: 'none', stroke: pal.sel, 'stroke-width': 1.5 }, inner);
  } else if (e.stairStyle === 'straight') {
    shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: pal.fixedFill, stroke: pal.fixedStroke, sw: 1.5 }, inner);
    const n = Math.max(3, Math.round(d / 25));
    for (let i = 1; i < n; i++) { const y = -hd + (d * i) / n; shp(ctx, 'line', { x1: -hw, y1: y, x2: hw, y2: y }, ln, inner); }
    s('path', { d: `M0 ${hd * 0.85}L0 ${-hd * 0.8}M${-hw * 0.2} ${-hd * 0.6}L0 ${-hd * 0.8}L${hw * 0.2} ${-hd * 0.6}`, fill: 'none', stroke: pal.sel, 'stroke-width': 1.5 }, inner);
  } else {
    shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: pal.fixedFill, stroke: pal.fixedStroke, sw: 1.5 }, inner);
    const c = { x: -hw, y: hd };
    const n = 11;
    for (let i = 1; i < n; i++) {
      const a = -Math.PI / 2 + ((Math.PI / 2) * i) / n;
      const dx = Math.cos(a), dy = Math.sin(a);
      const t = Math.min(dx > 1e-6 ? w / dx : Infinity, dy < -1e-6 ? d / -dy : Infinity);
      shp(ctx, 'line', { x1: c.x, y1: c.y, x2: c.x + dx * t, y2: c.y + dy * t }, ln, inner);
    }
    const r = Math.min(w, d) * 0.55;
    s('path', { d: arcPath(c.x, c.y, r, { x: c.x, y: c.y - r }, { x: c.x + r, y: c.y }), fill: 'none', stroke: pal.sel, 'stroke-width': 1.5 }, inner);
  }
}

function buildFixed(e, ctx) {
  const g = s('g', { class: 'ent fixed' + (e.locked ? ' locked' : ''), 'data-kind': 'fixed', 'data-id': e.id, transform: tf(e) });
  ctx.seed = hash(e.id);
  const w = e.width, d = e.depth, hw = w / 2, hd = d / 2, pal = ctx.pal;
  const base = { fill: pal.fixedFill, stroke: pal.fixedStroke, sw: 1.5 };
  const ln = { stroke: pal.fixedStroke, sw: 1 };
  switch (e.type) {
    case 'door': {
      s('rect', { x: -hw, y: -hd - 1, width: w, height: d + 2, fill: pal.bg }, g);
      const hx = e.hinge === 'right' ? hw : -hw, sg = e.swing === 'out' ? -1 : 1;
      s('line', { x1: -hw, y1: -hd, x2: -hw, y2: hd, stroke: pal.wood, 'stroke-width': 2 }, g);
      s('line', { x1: hw, y1: -hd, x2: hw, y2: hd, stroke: pal.wood, 'stroke-width': 2 }, g);
      shp(ctx, 'line', { x1: hx, y1: 0, x2: hx, y2: sg * w }, { stroke: pal.wood, sw: 2.5 }, g);
      shp(ctx, 'path', { d: arcPath(hx, 0, w, { x: hx, y: sg * w }, { x: -hx, y: 0 }) }, { stroke: pal.wood, sw: 1, dash: '4 3' }, g);
      s('rect', { x: -hw, y: Math.min(0, sg * w), width: w, height: w, fill: 'transparent' }, g);
      break;
    }
    case 'window':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: pal.glass, stroke: pal.wall, sw: 1.2 }, g);
      shp(ctx, 'line', { x1: -hw, y1: 0, x2: hw, y2: 0 }, { stroke: pal.wall, sw: 1 }, g);
      break;
    case 'radiator': {
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
      const n = Math.max(2, Math.round(w / 8));
      for (let i = 1; i < n; i++) { const x = -hw + (w * i) / n; s('line', { x1: x, y1: -hd + 2, x2: x, y2: hd - 2, stroke: pal.fixedStroke, 'stroke-width': 0.8 }, g); }
      break;
    }
    case 'ac':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
      for (let i = 1; i < 4; i++) { const y = -hd + (d * i) / 4; s('line', { x1: -hw + 4, y1: y, x2: hw - 4, y2: y, stroke: pal.fixedStroke, 'stroke-width': 0.8 }, g); }
      break;
    case 'fireplace':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: `url(#${ctx.prefix}brick)`, stroke: pal.brick, sw: 1.5, crisp: !ctx.rc }, g);
      if (ctx.rc) shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { stroke: pal.brick, sw: 1.5 }, g);
      s('rect', { x: -hw * 0.5, y: -hd * 0.5, width: w * 0.5, height: d * 0.55, fill: '#3A2A22', rx: 2 }, g);
      shp(ctx, 'rect', { x: -hw - 6, y: hd - 7, w: w + 12, h: 7 }, { fill: pal.wood, stroke: pal.wood, sw: 1 }, g);
      break;
    case 'counter':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: pal.counter, stroke: pal.fixedStroke, sw: 1.5 }, g);
      shp(ctx, 'line', { x1: -hw, y1: hd - 4, x2: hw, y2: hd - 4 }, ln, g);
      break;
    case 'fridge':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
      shp(ctx, 'line', { x1: -hw, y1: hd - d * 0.12, x2: hw, y2: hd - d * 0.12 }, ln, g);
      break;
    case 'stove':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
      for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s('circle', { cx: px * w * 0.24, cy: py * d * 0.22, r: Math.min(w, d) * 0.14, fill: 'none', stroke: pal.fixedStroke, 'stroke-width': 1 }, g);
      break;
    case 'closet':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
      shp(ctx, 'line', { x1: -hw + 6, y1: 0, x2: hw - 6, y2: 0 }, { ...ln, dash: '6 4' }, g);
      shp(ctx, 'line', { x1: -hw, y1: hd - 3, x2: hw, y2: hd - 3 }, { stroke: pal.wood, sw: 2 }, g);
      break;
    case 'washroom':
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { fill: `url(#${ctx.prefix}tile)`, stroke: pal.fixedStroke, sw: 1.5, crisp: !ctx.rc }, g);
      if (ctx.rc) shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, { stroke: pal.fixedStroke, sw: 1.5 }, g);
      break;
    case 'stairs':
      buildStairs(e, ctx, g);
      break;
    case 'outlet': {
      const r = Math.min(w, 12) / 2;
      s('circle', { r, fill: pal.fixedFill, stroke: pal.fixedStroke, 'stroke-width': 1.2 }, g);
      s('path', { d: `M${-r * 0.35} ${-r * 0.4}V${r * 0.4}M${r * 0.35} ${-r * 0.4}V${r * 0.4}`, stroke: pal.fixedStroke, 'stroke-width': 1, fill: 'none' }, g);
      break;
    }
    case 'light': {
      const r = Math.min(w, d) / 2;
      s('circle', { r, fill: '#FFF3C8', stroke: pal.fixedStroke, 'stroke-width': 1.2, opacity: 0.9 }, g);
      const k = r * 0.7;
      s('path', { d: `M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}`, stroke: pal.fixedStroke, 'stroke-width': 1, fill: 'none' }, g);
      break;
    }
    default:
      shp(ctx, 'rect', { x: -hw, y: -hd, w, h: d }, base, g);
  }
  if (e.width < 14 || e.depth < 14) s('rect', { x: -Math.max(w, 16) / 2, y: -Math.max(d, 16) / 2, width: Math.max(w, 16), height: Math.max(d, 16), fill: 'transparent' }, g);
  return g;
}

function slopeT(z, h) { return clamp((h - z.low) / ((z.high - z.low) || 1), 0, 1); }

function buildSlope(z, ctx) {
  const g = s('g', { class: 'ent slope' + (z.locked ? ' locked' : ''), 'data-kind': 'slope', 'data-id': z.id, transform: tf(z) });
  const gid = `${ctx.prefix}sg-${z.id}`;
  const dir = { top: [0, 0, 0, 1], bottom: [0, 1, 0, 0], left: [0, 0, 1, 0], right: [1, 0, 0, 0] }[z.lowSide];
  const grad = s('linearGradient', { id: gid, x1: dir[0], y1: dir[1], x2: dir[2], y2: dir[3] }, ctx.defs);
  s('stop', { offset: 0, 'stop-color': ctx.pal.slope, 'stop-opacity': 0.6 }, grad);
  s('stop', { offset: 1, 'stop-color': ctx.pal.slope, 'stop-opacity': 0.04 }, grad);
  const w = z.width, d = z.depth, hw = w / 2, hd = d / 2;
  s('rect', { x: -hw, y: -hd, width: w, height: d, fill: `url(#${gid})`, stroke: ctx.pal.slope, 'stroke-width': 1.2, 'stroke-dasharray': '6 4' }, g);
  if (z.low < HEADROOM && z.high > HEADROOM) {
    const t = slopeT(z, HEADROOM);
    const line = {
      top: [-hw, -hd + t * d, hw, -hd + t * d], bottom: [-hw, hd - t * d, hw, hd - t * d],
      left: [-hw + t * w, -hd, -hw + t * w, hd], right: [hw - t * w, -hd, hw - t * w, hd]
    }[z.lowSide];
    s('line', { x1: line[0], y1: line[1], x2: line[2], y2: line[3], stroke: ctx.pal.danger, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, g);
  }
  return g;
}

function buildNote(n, ctx) {
  const g = s('g', { class: 'ent note', 'data-kind': 'note', 'data-id': n.id, transform: `translate(${n.x} ${n.y})` });
  const k = 12 * ctx.noteScale;
  s('path', { d: `M${-k} ${-k}H${k}V${k * 0.4}L${k * 0.4} ${k}H${-k}Z`, fill: n.color || ctx.pal.noteFill, stroke: ctx.pal.noteStroke, 'stroke-width': 1, transform: 'rotate(-4)' }, g);
  s('path', { d: `M${k} ${k * 0.4}H${k * 0.4}V${k}`, fill: 'none', stroke: ctx.pal.noteStroke, 'stroke-width': 1, transform: 'rotate(-4)' }, g);
  s('rect', { x: -k * 1.6, y: -k * 1.6, width: k * 3.2, height: k * 3.2, fill: 'transparent' }, g);
  return g;
}

function wrapText(text, max = 26) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}

function labelGroup(id, x, y, parent) {
  return s('g', { class: 'lblg', 'data-for': id, transform: `translate(${x} ${y})` }, parent);
}

function buildItemLabel(it, ctx, parent) {
  const g = labelGroup(it.id, it.x, it.y, parent);
  const warn = ctx.warn.get(it.id);
  const t = s('text', { class: 'lbl' + (warn != null ? ' warn' : ''), y: 0, dy: '-0.5em' }, g);
  t.textContent = it.name + (it.groupId ? ' *' : '');
  const sub = s('text', { class: 'lbl sub' + (warn != null ? ' warn' : ''), y: 0, dy: '0.85em' }, g);
  sub.textContent = warn != null
    ? `Too tall: ceiling ${formatLen(warn, ctx.units)}`
    : `${formatLen(it.width, ctx.units, true)} x ${formatLen(it.depth, ctx.units, true)}`;
  return g;
}

/**
 * Render one floor and scenario into a group.
 * ctx: { pal, settings, units, rc, prefix, floorId, noteScale }
 */
export function renderWorld(g, floor, scenario, ctx) {
  g.replaceChildren();
  const pal = ctx.pal, st = ctx.settings, L = st.layers;
  const defs = s('defs', {}, g);
  ctx.defs = defs;
  const brick = s('pattern', { id: ctx.prefix + 'brick', width: 20, height: 10, patternUnits: 'userSpaceOnUse' }, defs);
  s('rect', { width: 20, height: 10, fill: pal.brick }, brick);
  s('path', { d: 'M0 0H20M0 5H20M5 0V5M15 5V10', stroke: pal.mortar, 'stroke-width': 0.8, fill: 'none' }, brick);
  const tile = s('pattern', { id: ctx.prefix + 'tile', width: 15, height: 15, patternUnits: 'userSpaceOnUse' }, defs);
  s('rect', { width: 15, height: 15, fill: pal.fixedFill }, tile);
  s('path', { d: 'M0 0H15M0 0V15', stroke: pal.grid, 'stroke-width': 1, fill: 'none' }, tile);

  ctx.warn = ceilingWarnings(floor, scenario);
  const clear = st.clearance ? computeClearance(floor, scenario, st) : null;
  ctx.blocked = clear ? clear.blocked : new Set();
  const layer = n => s('g', { class: 'layer layer-' + n }, g);
  const gSlope = layer('slope'), gRugs = layer('rugs'), gWalls = layer('walls'), gFixed = layer('fixed'),
    gFurn = layer('furniture'), gPlants = layer('plants'), gLight = layer('lighting'),
    gClear = layer('clearance'), gNotes = layer('notes'), gLabels = layer('labels');
  const byLayer = { rugs: gRugs, furniture: gFurn, plants: gPlants, lighting: gLight };

  if (L.structure) {
    for (const z of floor.slopeZones) gSlope.appendChild(buildSlope(z, ctx));
    for (const w of floor.walls) {
      ctx.seed = hash(w.id);
      let node;
      if (ctx.rc) {
        node = s('g', { 'data-kind': 'wall', 'data-id': w.id, class: 'ent wall-g' });
        shp(ctx, 'polygon', { pts: wallPoly(w) }, { fill: pal.wall, stroke: pal.wall, sw: 1.4, gap: 3 }, node);
      } else {
        node = s('line', { class: 'ent wall', 'data-kind': 'wall', 'data-id': w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, stroke: pal.wall, 'stroke-width': w.thickness, 'stroke-linecap': 'square' });
      }
      gWalls.appendChild(node);
      const len = wallLength(w);
      if (len > 1 && st.labels !== false) {
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2, ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len;
        const off = w.thickness / 2 + 16;
        let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
        if (ang > 90 || ang <= -90) ang += 180;
        const t = s('text', { class: 'wlbl', x: 0, y: 0, transform: `translate(${mx + uy * off} ${my - ux * off}) rotate(${ang})` }, gLabels);
        t.textContent = formatLen(len, ctx.units);
      }
    }
    for (const e of floor.fixed) {
      gFixed.appendChild(buildFixed(e, ctx));
      if (st.labels !== false && !['outlet', 'light', 'door', 'window'].includes(e.type) && e.width > 30) {
        const lg = labelGroup(e.id, e.x, e.y, gLabels);
        const t = s('text', { class: 'lbl sub' }, lg);
        t.textContent = e.type === 'stairs' ? `${e.name} (${ctx.floorId === '126' ? 'Up' : 'Down'})` : e.name;
      } else if (st.labels !== false && e.type === 'door' && e.entry) {
        const lg = labelGroup(e.id, e.x, e.y, gLabels);
        s('text', { class: 'lbl sub' }, lg).textContent = 'Entry';
      }
    }
    for (const z of floor.slopeZones) {
      if (st.labels === false) continue;
      const lg = labelGroup(z.id, z.x, z.y, gLabels);
      s('text', { class: 'lbl sub' }, lg).textContent = `Ceiling ${formatLen(z.low, ctx.units)} to ${formatLen(z.high, ctx.units)}`;
    }
  }

  for (const it of scenario.items) {
    if (!itemVisible(it, st)) continue;
    (byLayer[it.layer] || gFurn).appendChild(buildItem(it, ctx));
    if (st.labels !== false) buildItemLabel(it, ctx, gLabels);
  }

  if (clear) {
    for (const z of clear.zones) {
      s('polygon', { points: z.poly.map(p => `${p.x},${p.y}`).join(' '), fill: z.hit ? pal.danger : pal.slope, 'fill-opacity': z.hit ? 0.18 : 0.08, stroke: z.hit ? pal.danger : 'none', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, gClear);
    }
    for (const gp of clear.gaps) {
      s('line', { x1: gp.p.x, y1: gp.p.y, x2: gp.q.x, y2: gp.q.y, stroke: pal.danger, 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }, gClear);
      const t = s('text', { class: 'clr', x: (gp.p.x + gp.q.x) / 2, y: (gp.p.y + gp.q.y) / 2 }, gClear);
      t.textContent = formatLen(gp.d, ctx.units);
    }
  }

  if (L.notes) {
    for (const n of scenario.notes) {
      gNotes.appendChild(buildNote(n, ctx));
      if (!n.text) continue;
      const lg = labelGroup(n.id, n.x, n.y, gLabels);
      wrapText(n.text).forEach((line, i) => {
        const t = s('text', { class: 'lbl note', x: 16 * ctx.noteScale, y: 0, dy: `${i * 1.25 - 0.2}em` }, lg);
        t.textContent = line;
      });
    }
  }
  return { clear };
}

export function renderBackground(g, floor, settings) {
  g.replaceChildren();
  const bg = floor.background;
  if (!bg.image || !bg.visible || settings.layers.background === false) return;
  s('image', { href: bg.image, x: bg.offset.x, y: bg.offset.y, width: bg.w * bg.scale, height: bg.h * bg.scale, opacity: bg.opacity, preserveAspectRatio: 'none' }, g);
}

/* ------------------------------------------------------------------ */
/* Interactive canvas                                                  */
/* ------------------------------------------------------------------ */

export class PlanCanvas {
  /**
   * hooks: onSelect(sel[]), onContextMenu(sel, {x,y}), onDrawState(), onSlopeRect(rect),
   *        onCalibrate(p1, p2), onNotePlace(pt), theme()
   */
  constructor(wrap, store, hooks) {
    this.wrap = wrap;
    this.store = store;
    this.hooks = hooks;
    this.views = {};
    this.fitted = new Set();
    this.selection = [];
    this.mode = 'select';
    this.drawPts = [];
    this.tmpPts = [];
    this.ortho = true;
    this.multi = false;
    this.hover = null;
    this.pointers = new Map();
    this.g = null;
    this.pinch = null;
    this.rc = null;
    this.compareId = null;
    this.cmp = null;
    this.highlightSel = null;
    this.styleKey = '';
    this.main = this.makePane('m', true);
    wrap.appendChild(this.main.svg);
    this.ro = new ResizeObserver(() => { this.applyView(); });
    this.ro.observe(wrap);
  }

  get st() { return this.store.state; }
  get settings() { return this.store.state.settings; }
  get floor() { return this.store.floor; }
  get pal() { return PALETTES[this.hooks.theme()] || PALETTES.light; }
  get view() {
    const id = this.store.floorId;
    if (!this.views[id]) this.views[id] = { tx: 60, ty: 60, s: 1 };
    return this.views[id];
  }
  panes() { return [this.main, this.cmp].filter(Boolean); }

  makePane(pid, interactive) {
    const svg = s('svg', { class: 'plan' + (interactive ? '' : ' compare'), tabindex: interactive ? 0 : -1, role: 'application', 'aria-label': interactive ? 'Floor plan canvas. Use arrow keys to nudge the selection.' : 'Comparison plan, view only' });
    const style = s('style', {}, svg);
    const defs = s('defs', {}, svg);
    const minPat = s('pattern', { id: pid + 'gmin', patternUnits: 'userSpaceOnUse', width: 25, height: 25 }, defs);
    const minPath = s('path', { d: 'M25 0L0 0 0 25', fill: 'none' }, minPat);
    const majPat = s('pattern', { id: pid + 'gmaj', patternUnits: 'userSpaceOnUse', width: 100, height: 100 }, defs);
    const majPath = s('path', { d: 'M100 0L0 0 0 100', fill: 'none' }, majPat);
    const viewport = s('g', { class: 'viewport' }, svg);
    const gridRect = s('rect', { x: -50000, y: -50000, width: 100000, height: 100000, fill: `url(#${pid}gmin)` }, viewport);
    const gridMajor = s('rect', { x: -50000, y: -50000, width: 100000, height: 100000, fill: `url(#${pid}gmaj)` }, viewport);
    const bg = s('g', { class: 'bg' }, viewport);
    const ghost = s('g', { class: 'ghost', 'pointer-events': 'none' }, viewport);
    const world = s('g', { class: 'world' }, viewport);
    const overlay = s('g', { class: 'overlay' }, svg);
    const pane = { pid, svg, style, defs, minPat, minPath, majPat, majPath, viewport, gridRect, gridMajor, bg, ghost, world, overlay, interactive, bgKey: '' };
    svg.addEventListener('pointerdown', e => this.onDown(e, pane));
    svg.addEventListener('pointermove', e => this.onMove(e, pane));
    svg.addEventListener('pointerup', e => this.onUp(e, pane));
    svg.addEventListener('pointercancel', e => this.onUp(e, pane, true));
    svg.addEventListener('pointerleave', () => { if (this.hover && !this.pointers.size) { this.hover = null; this.renderOverlay(); } });
    svg.addEventListener('wheel', e => this.onWheel(e, pane), { passive: false });
    svg.addEventListener('contextmenu', e => this.onContext(e, pane));
    return pane;
  }

  /* ---------- rendering ---------- */

  makeCtx(floor, prefix) {
    return { pal: this.pal, settings: this.settings, units: this.store.units, rc: this.settings.sketch ? this.rc : null, prefix, floorId: floor.id, noteScale: 1 };
  }

  ensureRough() {
    if (!this.settings.sketch) { this.rc = null; return; }
    if (window.rough) { this.rc = this.rc || window.rough.svg(this.main.svg); return; }
    if (this.roughLoading) return;
    this.roughLoading = true;
    loadScript(CDN.rough).then(() => { this.roughLoading = false; this.render(); })
      .catch(err => { this.roughLoading = false; toast(err.message, 'error'); });
  }

  render() {
    const floor = this.floor, sc = activeScenario(floor);
    this.ensureRough();
    const theme = this.hooks.theme();
    for (const p of this.panes()) {
      const key = theme;
      if (p.styleKey !== key) { p.style.textContent = svgCss(this.pal); p.styleKey = key; }
      p.minPath.setAttribute('stroke', this.pal.grid);
      p.majPath.setAttribute('stroke', this.pal.gridMajor);
      p.svg.classList.toggle('sketch', !!this.settings.sketch);
    }
    renderWorld(this.main.world, floor, sc, this.makeCtx(floor, 'm'));
    this.renderGhost(this.main, floor);
    this.renderBg(this.main, floor);
    if (this.compareId) {
      const csc = floor.scenarios.find(x => x.id === this.compareId);
      if (!csc || csc.id === sc.id) this.setCompare(null);
      else {
        renderWorld(this.cmp.world, floor, csc, this.makeCtx(floor, 'c'));
        this.renderBg(this.cmp, floor);
        this.cmp.caption = csc.name;
      }
    }
    this.selection = this.selection.filter(sel => findEntity(this.st, this.store.floorId, sel));
    this.applyView();
  }

  /** The other floor's walls and staircase, faint and dashed: the two floors sit directly on top of each other. */
  renderGhost(pane, floor) {
    const g = pane.ghost;
    g.replaceChildren();
    if (this.settings.showOtherFloor === false) return;
    const other = this.st.floors.find(f => f.id !== floor.id);
    if (!other) return;
    const pal = this.pal;
    for (const w of other.walls) {
      s('line', { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, stroke: pal.sub, 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: 0.45, 'vector-effect': 'non-scaling-stroke' }, g);
    }
    for (const e of other.fixed.filter(x => x.type === 'stairs' || x.type === 'window' || x.type === 'door')) {
      s('polygon', { points: worldPoly(e).map(q => `${q.x},${q.y}`).join(' '), fill: 'none', stroke: pal.sub, 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0.4, 'vector-effect': 'non-scaling-stroke' }, g);
    }
  }

  renderBg(pane, floor) {
    const bg = floor.background;
    const key = [floor.id, bg.image ? bg.image.length : 0, bg.offset.x, bg.offset.y, bg.scale, bg.opacity, bg.visible, this.settings.layers.background].join('|');
    if (pane.bgKey === key) return;
    pane.bgKey = key;
    renderBackground(pane.bg, floor, this.settings);
  }

  applyView() {
    const v = this.view, grid = this.settings.grid;
    for (const p of this.panes()) {
      p.viewport.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.s})`);
      p.svg.style.setProperty('--inv', String(1 / v.s));
      p.minPat.setAttribute('width', grid); p.minPat.setAttribute('height', grid);
      p.minPath.setAttribute('d', `M${grid} 0L0 0 0 ${grid}`);
      p.minPath.setAttribute('stroke-width', 0.8 / v.s);
      p.majPath.setAttribute('stroke-width', 1.2 / v.s);
      const showGrid = this.settings.showGrid !== false;
      p.gridRect.style.display = showGrid && grid * v.s >= 6 ? '' : 'none';
      p.gridMajor.style.display = showGrid && 100 * v.s >= 8 && grid < 100 ? '' : 'none';
      p.svg.classList.toggle('zl', v.s < 0.5);
    }
    this.renderOverlay();
  }

  toScreen(x, y) { const v = this.view; return { x: x * v.s + v.tx, y: y * v.s + v.ty }; }
  toWorld(p) { const v = this.view; return { x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s }; }
  localPt(e, pane) { const r = pane.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  size() { const r = this.main.svg.getBoundingClientRect(); return { w: r.width, h: r.height }; }

  getViewCenter() { const { w, h } = this.size(); return this.toWorld({ x: w / 2, y: h / 2 }); }

  /** Fit the floor contents (or an empty 6 m by 4.5 m area) into view. */
  fit() {
    const floor = this.floor, sc = activeScenario(floor);
    const b = contentBounds(floor, sc) || { minX: 0, minY: 0, maxX: 600, maxY: 450 };
    const { w, h } = this.size();
    if (!w || !h) return;
    const pad = 40 + (this.settings.rulers ? 22 : 0);
    const bw = Math.max(50, b.maxX - b.minX), bh = Math.max(50, b.maxY - b.minY);
    const v = this.view;
    v.s = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), MIN_S, 4);
    v.tx = (w - bw * v.s) / 2 - b.minX * v.s + (this.settings.rulers ? 10 : 0);
    v.ty = (h - bh * v.s) / 2 - b.minY * v.s + (this.settings.rulers ? 10 : 0);
    this.fitted.add(this.store.floorId);
    this.applyView();
  }

  fitIfNeeded() { if (!this.fitted.has(this.store.floorId)) this.fit(); else this.applyView(); }

  zoomAt(sx, sy, factor) {
    const v = this.view;
    const wx = (sx - v.tx) / v.s, wy = (sy - v.ty) / v.s;
    v.s = clamp(v.s * factor, MIN_S, MAX_S);
    v.tx = sx - wx * v.s;
    v.ty = sy - wy * v.s;
    this.applyView();
  }

  zoomBy(factor) { const { w, h } = this.size(); this.zoomAt(w / 2, h / 2, factor); }

  centerOn(sel) {
    const f = findEntity(this.st, this.store.floorId, sel);
    if (!f) return;
    const o = f.obj;
    const c = sel.kind === 'wall' ? { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 } : { x: o.x, y: o.y };
    const sp = this.toScreen(c.x, c.y), { w, h } = this.size();
    if (sp.x < 60 || sp.y < 60 || sp.x > w - 60 || sp.y > h - 60) {
      const v = this.view;
      v.tx = w / 2 - c.x * v.s;
      v.ty = h / 2 - c.y * v.s;
      this.applyView();
    }
  }

  /** Pan so an entity sits in the upper part of the view (phone, with a sheet open below). */
  focusTop(sel, frac = 0.25) {
    const f = findEntity(this.st, this.store.floorId, sel);
    if (!f || sel.kind === 'wall') return;
    const { w, h } = this.size(), v = this.view;
    v.tx = w / 2 - f.obj.x * v.s;
    v.ty = h * frac - f.obj.y * v.s;
    this.applyView();
  }

  highlight(sel) {
    this.highlightSel = sel;
    this.centerOn(sel);
    this.renderOverlay();
    clearTimeout(this.hlTimer);
    this.hlTimer = setTimeout(() => { this.highlightSel = null; this.renderOverlay(); }, 2400);
  }

  setCompare(scenarioId) {
    this.compareId = scenarioId;
    if (scenarioId && !this.cmp) {
      this.cmp = this.makePane('c', false);
      this.wrap.appendChild(this.cmp.svg);
    }
    if (!scenarioId && this.cmp) { this.cmp.svg.remove(); this.cmp = null; }
    this.wrap.classList.toggle('split', !!scenarioId);
    if (scenarioId) this.render();
    else this.applyView();
  }

  /* ---------- selection ---------- */

  expandGroups(arr) {
    const sc = activeScenario(this.floor);
    const out = [];
    const add = x => { if (!out.some(y => y.kind === x.kind && y.id === x.id)) out.push(x); };
    for (const sel of arr) {
      add(sel);
      if (sel.kind === 'item') {
        const it = sc.items.find(i => i.id === sel.id);
        if (it && it.groupId) for (const o of sc.items) if (o.groupId === it.groupId) add({ kind: 'item', id: o.id });
      }
    }
    return out;
  }

  select(arr, silent = false) {
    this.selection = this.expandGroups(arr);
    this.renderOverlay();
    if (!silent) this.hooks.onSelect(this.selection);
  }

  isSelected(sel) { return this.selection.some(x => x.kind === sel.kind && x.id === sel.id); }

  toggleSel(sel) {
    if (this.isSelected(sel)) {
      const grp = this.expandGroups([sel]);
      this.select(this.selection.filter(x => !grp.some(g => g.kind === x.kind && g.id === x.id)));
    } else this.select([...this.selection, sel]);
  }

  setMode(mode) {
    this.mode = mode;
    this.drawPts = [];
    this.tmpPts = [];
    this.hover = null;
    this.main.svg.dataset.mode = mode;
    this.renderOverlay();
    this.hooks.onDrawState();
  }

  /* ---------- pointer input ---------- */

  onDown(e, pane) {
    if (e.button === 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    try { pane.svg.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    pane.svg.focus({ preventScroll: true });
    const p = this.localPt(e, pane);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) { this.startPinch(); return; }
    if (this.pointers.size > 2) return;
    const w = this.toWorld(p);
    const base = { id: e.pointerId, start: p, startW: w, moved: false, pane, pointerType: e.pointerType, v0: { ...this.view } };
    if (!pane.interactive || e.button === 1) { this.g = { ...base, type: 'pan' }; return; }
    if (this.mode !== 'select') {
      if (this.mode === 'movebg') { this.g = { ...base, type: 'bg', o0: { ...this.floor.background.offset } }; return; }
      this.g = { ...base, type: 'pan', tap: this.mode };
      return;
    }
    let handle = e.target.closest && e.target.closest('[data-handle]');
    let entEl = e.target.closest && e.target.closest('.world [data-kind]');
    if (handle && handle.dataset.cx != null && this.selection.length === 1) {
      // Inside the item body and away from the handle center: prefer moving over resizing.
      const f = findEntity(this.st, this.store.floorId, this.selection[0]);
      const far = Math.hypot(p.x - Number(handle.dataset.cx), p.y - Number(handle.dataset.cy)) > 9;
      if (f && far && pointInPoly(w, worldPoly(f.obj))) {
        handle = null;
        entEl = this.main.world.querySelector(`[data-id="${f.obj.id}"]`);
      }
    }
    if (handle) { this.g = { ...base, type: 'handle', handle: handle.dataset.handle }; return; }
    if (entEl) {
      const sel = { kind: entEl.dataset.kind, id: entEl.dataset.id };
      const already = this.isSelected(sel);
      if (e.shiftKey || e.metaKey || e.ctrlKey || this.multi) this.toggleSel(sel);
      else if (!already) this.select([sel]);
      else this.hooks.onSelect(this.selection);
      this.g = { ...base, type: 'press', sel };
      clearTimeout(this.lpTimer);
      const cx = e.clientX, cy = e.clientY;
      this.lpTimer = setTimeout(() => {
        if (this.g && this.g.type === 'press' && !this.g.moved) {
          this.g = null;
          this.hooks.onContextMenu(sel, { x: cx, y: cy });
        }
      }, 520);
      return;
    }
    this.g = { ...base, type: 'pan', tap: 'clear', additive: e.shiftKey || this.multi };
  }

  onMove(e, pane) {
    const p = this.localPt(e, pane);
    if (!this.pointers.has(e.pointerId)) {
      if (pane.interactive && ['wall', 'slope', 'calibrate'].includes(this.mode)) {
        this.hover = this.snapPoint(this.toWorld(p), this.mode === 'wall');
        this.scheduleFrame(() => this.renderOverlay());
      }
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pinch) { this.scheduleFrame(() => this.updatePinch()); return; }
    const g = this.g;
    if (!g || g.id !== e.pointerId) return;
    const dist = Math.hypot(p.x - g.start.x, p.y - g.start.y);
    if (!g.moved && dist < (g.pointerType === 'mouse' ? 3 : 8)) return;
    if (!g.moved) {
      g.moved = true;
      clearTimeout(this.lpTimer);
      this.startGesture(g);
    }
    const shift = e.shiftKey || e.altKey;
    this.scheduleFrame(() => this.moveGesture(g, p, shift));
  }

  onUp(e, pane, cancelled = false) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) { this.pinch = null; this.g = null; }
      return;
    }
    clearTimeout(this.lpTimer);
    const g = this.g;
    if (!g || g.id !== e.pointerId) return;
    this.g = null;
    this.flushFrame();
    if (!g.moved) { if (!cancelled) this.onTap(g); return; }
    const labels = { move: 'Move', resize: 'Resize', rotate: 'Rotate', wallpt: 'Move wall point', bg: 'Move background' };
    if (labels[g.type]) {
      if (cancelled) this.store.cancel();
      else this.store.commit(labels[g.type]);
    }
    this.readouts = null;
    this.renderOverlay();
  }

  onWheel(e, pane) {
    e.preventDefault();
    const p = this.localPt(e, pane);
    if (e.shiftKey && !e.ctrlKey) {
      const v = this.view;
      v.tx -= e.deltaY || e.deltaX;
      this.applyView();
      return;
    }
    const k = e.ctrlKey ? 0.012 : 0.0018;
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomAt(p.x, p.y, Math.exp(-dy * k));
  }

  onContext(e, pane) {
    e.preventDefault();
    if (!pane.interactive || this.mode !== 'select') return;
    const entEl = e.target.closest && e.target.closest('.world [data-kind]');
    if (!entEl) return;
    const sel = { kind: entEl.dataset.kind, id: entEl.dataset.id };
    if (!this.isSelected(sel)) this.select([sel]);
    clearTimeout(this.lpTimer);
    this.g = null;
    this.hooks.onContextMenu(sel, { x: e.clientX, y: e.clientY });
  }

  scheduleFrame(fn) {
    this.frameFn = fn;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; const f = this.frameFn; this.frameFn = null; if (f) f(); });
  }

  flushFrame() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const f = this.frameFn; this.frameFn = null; if (f) f();
  }

  startPinch() {
    clearTimeout(this.lpTimer);
    if (this.g && this.g.moved && ['move', 'resize', 'rotate', 'wallpt', 'bg'].includes(this.g.type)) this.store.cancel();
    this.g = null;
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...this.view } };
  }

  updatePinch() {
    if (!this.pinch || this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { d0, m0, v0 } = this.pinch;
    const v = this.view;
    v.s = clamp((v0.s * d) / d0, MIN_S, MAX_S);
    const wx = (m0.x - v0.tx) / v0.s, wy = (m0.y - v0.ty) / v0.s;
    v.tx = m.x - wx * v.s;
    v.ty = m.y - wy * v.s;
    this.applyView();
  }

  /** Begin an edit gesture once the pointer has moved past the threshold. */
  startGesture(g) {
    const floor = this.floor;
    if (g.type === 'press') {
      const targets = [], wallPts = [];
      for (const sel of this.selection) {
        const f = findEntity(this.st, this.store.floorId, sel);
        if (!f || f.obj.locked) continue;
        if (sel.kind === 'wall') { wallPts.push({ x: f.obj.x1, y: f.obj.y1 }, { x: f.obj.x2, y: f.obj.y2 }); continue; }
        targets.push({ sel, obj: f.obj, x0: f.obj.x, y0: f.obj.y, r0: f.obj.rotation });
      }
      if (!targets.length && !wallPts.length) { g.type = 'pan'; return; }
      this.store.begin();
      g.type = 'move';
      g.targets = targets;
      g.primary = targets.find(t => t.sel.id === g.sel.id) || targets[0] || null;
      g.wallRefs = [];
      for (const w of floor.walls) for (const end of ['1', '2']) {
        const px = w['x' + end], py = w['y' + end];
        if (wallPts.some(q => Math.hypot(q.x - px, q.y - py) < 0.5)) g.wallRefs.push({ w, end, px, py });
      }
    } else if (g.type === 'handle') {
      const [kind, a, b, c] = g.handle.split(':');
      if (kind === 'wp') {
        const w = floor.walls.find(x => x.id === a);
        if (!w) { g.type = 'pan'; return; }
        const px = w['x' + b], py = w['y' + b];
        this.store.begin();
        g.type = 'wallpt';
        g.refs = [];
        for (const o of floor.walls) for (const end of ['1', '2']) if (Math.hypot(o['x' + end] - px, o['y' + end] - py) < 0.5) g.refs.push({ w: o, end });
        g.exclude = new Set(g.refs.map(r => r.w.id + r.end));
        return;
      }
      const sel = this.selection[0];
      const f = sel && findEntity(this.st, this.store.floorId, sel);
      if (!f) { g.type = 'pan'; return; }
      this.store.begin();
      g.ent = f.obj;
      g.sel = sel;
      g.orig = { x: f.obj.x, y: f.obj.y, width: f.obj.width, depth: f.obj.depth, rotation: f.obj.rotation || 0, shape: f.obj.shape };
      if (kind === 'rot') g.type = 'rotate';
      else { g.type = 'resize'; g.sx = Number(a); g.sy = Number(b); g.keep = c === 'u'; }
    } else if (g.type === 'bg') {
      if (this.floor.background.locked) { g.type = 'pan'; return; }
      this.store.begin();
    }
  }

  moveGesture(g, p, free) {
    const v = this.view, w = this.toWorld(p), st = this.settings, grid = st.grid;
    switch (g.type) {
      case 'pan':
        v.tx = g.v0.tx + (p.x - g.start.x);
        v.ty = g.v0.ty + (p.y - g.start.y);
        this.applyView();
        break;
      case 'move': this.dragMove(g, w, free); break;
      case 'resize': {
        const o = g.orig, loc = toLocal(o, w.x, w.y);
        const ax = -g.sx * o.width / 2, ay = -g.sy * o.depth / 2;
        const step = st.snap && !free ? (grid >= 10 ? 5 : 1) : 1;
        let nw = g.sx ? Math.max(5, (loc.x - ax) * g.sx) : o.width;
        let nd = g.sy ? Math.max(5, (loc.y - ay) * g.sy) : o.depth;
        nw = Math.max(step, Math.round(nw / step) * step);
        nd = Math.max(step, Math.round(nd / step) * step);
        if (o.shape === 'circle' && g.sx && g.sy && Math.abs(o.width - o.depth) < 0.5) nw = nd = Math.max(nw, nd);
        const cl = { x: g.sx ? ax + (g.sx * nw) / 2 : 0, y: g.sy ? ay + (g.sy * nd) / 2 : 0 };
        const c = toWorldPt(o, cl.x, cl.y);
        Object.assign(g.ent, { x: c.x, y: c.y, width: nw, depth: nd });
        this.redrawWorld();
        break;
      }
      case 'rotate': {
        const e = g.ent;
        let a = (Math.atan2(w.y - e.y, w.x - e.x) * 180) / Math.PI + 90;
        if (!free) a = Math.round(a / 15) * 15;
        e.rotation = ((a % 360) + 360) % 360;
        this.updateNode(g.sel.kind, e);
        this.renderOverlay();
        break;
      }
      case 'wallpt': {
        const q = this.snapPoint(w, false, g.exclude);
        for (const r of g.refs) { r.w['x' + r.end] = q.x; r.w['y' + r.end] = q.y; }
        this.redrawWorld();
        break;
      }
      case 'bg': {
        const bg = this.floor.background;
        bg.offset = { x: g.o0.x + (p.x - g.start.x) / v.s, y: g.o0.y + (p.y - g.start.y) / v.s };
        this.renderBg(this.main, this.floor);
        break;
      }
      default: break;
    }
  }

  dragMove(g, w, free) {
    const st = this.settings, grid = st.grid;
    let dx = w.x - g.startW.x, dy = w.y - g.startW.y;
    const prim = g.primary;
    this.readouts = null;
    if (prim && BOX_KINDS.has(prim.sel.kind)) {
      let nx = prim.x0 + dx, ny = prim.y0 + dy;
      const obj = prim.obj;
      const mount = prim.sel.kind === 'fixed' ? MOUNTS[obj.type] : null;
      let mounted = false;
      if (mount && !free) {
        const m = this.wallMountSnap(obj, nx, ny, mount);
        if (m) { nx = m.x; ny = m.y; obj.rotation = m.rotation; mounted = true; }
        else obj.rotation = prim.r0;
      }
      if (!mounted && st.snap && !free) {
        const bb = bboxOf(worldPoly({ ...obj, x: nx, y: ny }));
        nx += Math.round(bb.minX / grid) * grid - bb.minX;
        ny += Math.round(bb.minY / grid) * grid - bb.minY;
      }
      if (!mounted && !free) {
        const f = this.flushSnap({ ...obj, x: nx, y: ny });
        nx += f.dx; ny += f.dy;
      }
      dx = nx - prim.x0; dy = ny - prim.y0;
      if (prim.sel.kind !== 'slope') this.readouts = { obj, dist: this.wallDistances({ ...obj, x: nx, y: ny }) };
    } else if (st.snap && !free) {
      dx = Math.round(dx / grid) * grid;
      dy = Math.round(dy / grid) * grid;
    }
    for (const t of g.targets) {
      t.obj.x = t.x0 + dx;
      t.obj.y = t.y0 + dy;
      this.updateNode(t.sel.kind, t.obj);
    }
    if (g.wallRefs.length) {
      for (const r of g.wallRefs) { r.w['x' + r.end] = r.px + dx; r.w['y' + r.end] = r.py + dy; }
      this.redrawWorld();
    } else this.renderOverlay();
  }

  /** Move an entity's nodes without a full re-render (fast path while dragging). */
  updateNode(kind, obj) {
    const world = this.main.world;
    const node = world.querySelector(`[data-id="${obj.id}"]`);
    if (node) node.setAttribute('transform', kind === 'note' ? `translate(${obj.x} ${obj.y})` : tf(obj));
    const lbl = world.querySelector(`[data-for="${obj.id}"]`);
    if (lbl) lbl.setAttribute('transform', `translate(${obj.x} ${obj.y})`);
  }

  redrawWorld() {
    const floor = this.floor;
    renderWorld(this.main.world, floor, activeScenario(floor), this.makeCtx(floor, 'm'));
    this.renderOverlay();
  }

  wallDistances(obj) {
    const walls = this.floor.walls;
    if (!walls.length) return [];
    const bb = bboxOf(worldPoly(obj)), cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    const rays = [
      { side: 'left', o: { x: bb.minX, y: cy }, dir: { x: -1, y: 0 } },
      { side: 'right', o: { x: bb.maxX, y: cy }, dir: { x: 1, y: 0 } },
      { side: 'up', o: { x: cx, y: bb.minY }, dir: { x: 0, y: -1 } },
      { side: 'down', o: { x: cx, y: bb.maxY }, dir: { x: 0, y: 1 } }
    ];
    return rays.map(r => ({ ...r, hit: rayHit(r.o, r.dir, walls) })).filter(r => r.hit && r.hit.d < 3000);
  }

  flushSnap(obj) {
    const tol = Math.min(15, 10 / this.view.s);
    let dx = 0, dy = 0, bx = tol, by = tol;
    for (const r of this.wallDistances(obj)) {
      const d = r.hit.d;
      if (Math.abs(d) >= (r.dir.x ? bx : by)) continue;
      if (r.side === 'left') { dx = -d; bx = Math.abs(d); }
      if (r.side === 'right') { dx = d; bx = Math.abs(d); }
      if (r.side === 'up') { dy = -d; by = Math.abs(d); }
      if (r.side === 'down') { dy = d; by = Math.abs(d); }
    }
    return { dx, dy };
  }

  /** Snap doors, windows and wall-hung fixtures onto the nearest wall. */
  wallMountSnap(obj, x, y, mount) {
    let best = null;
    const tol = Math.max(40, 24 / this.view.s);
    for (const w of this.floor.walls) {
      const r = closestOnSeg({ x, y }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      if (r.d < tol && (!best || r.d < best.r.d)) best = { w, r };
    }
    if (!best) return null;
    const { w, r } = best;
    const L = wallLength(w) || 1, ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
    const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (mount === 'center') {
      const cur = obj.rotation || 0;
      const diff = a => Math.abs((((cur - a) % 360) + 540) % 360 - 180);
      const rotation = diff(ang) <= diff(ang + 180) ? ang : ang + 180;
      return { x: r.q.x, y: r.q.y, rotation: ((rotation % 360) + 360) % 360 };
    }
    const cross = ux * (y - w.y1) - uy * (x - w.x1);
    const side = cross >= 0 ? 1 : -1;
    const nx = -uy * side, ny = ux * side;
    const off = w.thickness / 2 + obj.depth / 2;
    const rotation = (Math.atan2(-nx, ny) * 180) / Math.PI;
    return { x: r.q.x + nx * off, y: r.q.y + ny * off, rotation: ((rotation % 360) + 360) % 360 };
  }

  /** Snap a world point to wall endpoints, ortho angles and the grid. */
  snapPoint(w, forWall, exclude) {
    const tol = 14 / this.view.s;
    let best = null, bd = tol;
    for (const wl of this.floor.walls) for (const end of ['1', '2']) {
      if (exclude && exclude.has(wl.id + end)) continue;
      const x = wl['x' + end], y = wl['y' + end], d = Math.hypot(x - w.x, y - w.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (forWall && this.drawPts.length > 1) {
      const f = this.drawPts[0], d = Math.hypot(f.x - w.x, f.y - w.y);
      if (d < bd) { bd = d; best = { ...f }; }
    }
    if (best) return best;
    const grid = this.settings.grid, snap = this.settings.snap;
    const last = forWall ? this.drawPts[this.drawPts.length - 1] : null;
    if (last && this.ortho) {
      let len = Math.hypot(w.x - last.x, w.y - last.y);
      const ang = Math.round(Math.atan2(w.y - last.y, w.x - last.x) / (Math.PI / 4)) * (Math.PI / 4);
      len = snap ? Math.round(len / grid) * grid : Math.round(len);
      return { x: last.x + Math.cos(ang) * len, y: last.y + Math.sin(ang) * len };
    }
    if (snap) return { x: Math.round(w.x / grid) * grid, y: Math.round(w.y / grid) * grid };
    return { x: Math.round(w.x), y: Math.round(w.y) };
  }

  onTap(g) {
    if (g.type === 'press') { if (this.hooks.onEntityTap) this.hooks.onEntityTap(g.sel); return; }
    const w = this.toWorld(g.start);
    switch (g.tap) {
      case 'clear': if (!g.additive) this.select([]); break;
      case 'wall': this.addWallPoint(this.snapPoint(w, true)); break;
      case 'slope': {
        this.tmpPts.push(this.snapPoint(w, false));
        if (this.tmpPts.length === 2) {
          const [a, b] = this.tmpPts;
          this.tmpPts = [];
          const rect = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: Math.abs(a.x - b.x), depth: Math.abs(a.y - b.y) };
          if (rect.width > 5 && rect.depth > 5) this.hooks.onSlopeRect(rect);
          else toast('Tap two opposite corners of the sloped area.');
        }
        this.renderOverlay();
        break;
      }
      case 'calibrate': {
        this.tmpPts.push({ x: w.x, y: w.y });
        if (this.tmpPts.length === 2) {
          const [a, b] = this.tmpPts;
          this.tmpPts = [];
          this.hooks.onCalibrate(a, b);
        }
        this.renderOverlay();
        break;
      }
      case 'note': this.hooks.onNotePlace(this.snapPoint(w, false)); break;
      default: break;
    }
  }

  addWallPoint(pt) {
    const pts = this.drawPts;
    if (pts.length) {
      const last = pts[pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1) { this.finishWalls(); return; }
      const thickness = this.settings.wallThickness || 12;
      this.store.apply('Draw wall', () => {
        this.floor.walls.push({ id: uid('w'), x1: last.x, y1: last.y, x2: pt.x, y2: pt.y, thickness });
      });
      const first = pts[0];
      if (pts.length >= 2 && Math.hypot(pt.x - first.x, pt.y - first.y) < 1) {
        this.drawPts = [];
        toast('Shape closed. Tap to start another wall chain.');
        this.hooks.onDrawState();
        this.renderOverlay();
        return;
      }
    }
    this.drawPts.push(pt);
    this.hooks.onDrawState();
    this.renderOverlay();
  }

  closeWalls() {
    if (this.drawPts.length >= 3) this.addWallPoint({ ...this.drawPts[0] });
  }

  finishWalls() {
    this.drawPts = [];
    this.hooks.onDrawState();
    this.renderOverlay();
  }

  undoWallPoint() {
    if (!this.drawPts.length) return;
    if (this.drawPts.length > 1) this.store.undo();
    this.drawPts.pop();
    this.hooks.onDrawState();
    this.renderOverlay();
  }

  /* ---------- overlay (screen space) ---------- */

  renderOverlay() {
    const o = this.main.overlay;
    o.replaceChildren();
    const pal = this.pal, units = this.store.units;
    const sels = this.selection.map(sel => ({ sel, f: findEntity(this.st, this.store.floorId, sel) })).filter(x => x.f);
    const polyPts = pts => pts.map(p => { const q = this.toScreen(p.x, p.y); return `${q.x},${q.y}`; }).join(' ');
    const label = (x, y, text, angle = 0, cls = 'ov-lbl') => {
      const t = s('text', { class: cls, x: 0, y: 0, transform: `translate(${x} ${y}) rotate(${angle})` }, o);
      t.textContent = text;
      return t;
    };

    if (this.highlightSel) {
      const f = findEntity(this.st, this.store.floorId, this.highlightSel);
      if (f && this.highlightSel.kind !== 'wall') {
        const pts = this.highlightSel.kind === 'note' ? worldPoly({ x: f.obj.x, y: f.obj.y, width: 40, depth: 40, rotation: 0 }) : worldPoly(f.obj);
        s('polygon', { class: 'pulse', points: polyPts(pts), fill: 'none', stroke: pal.sel, 'stroke-width': 4 }, o);
      }
    }

    for (const { sel, f } of sels) {
      const obj = f.obj;
      if (sel.kind === 'wall') {
        const a = this.toScreen(obj.x1, obj.y1), b = this.toScreen(obj.x2, obj.y2);
        s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: pal.sel, 'stroke-width': 3, 'stroke-dasharray': '6 4' }, o);
        if (sels.length === 1) {
          for (const [end, q] of [['1', a], ['2', b]]) {
            const hg = s('g', { 'data-handle': `wp:${obj.id}:${end}`, class: 'handle' }, o);
            s('circle', { cx: q.x, cy: q.y, r: 22, fill: 'transparent' }, hg);
            s('circle', { cx: q.x, cy: q.y, r: 7, fill: '#fff', stroke: pal.sel, 'stroke-width': 2 }, hg);
          }
        }
        continue;
      }
      if (sel.kind === 'note') {
        const q = this.toScreen(obj.x, obj.y);
        s('circle', { cx: q.x, cy: q.y, r: 22, fill: 'none', stroke: pal.sel, 'stroke-width': 2, 'stroke-dasharray': '5 4' }, o);
        continue;
      }
      s('polygon', { points: polyPts(worldPoly(obj)), fill: 'none', stroke: pal.sel, 'stroke-width': 2, 'stroke-dasharray': obj.locked ? '3 4' : null }, o);
      if (sels.length !== 1) continue;
      const hw = obj.width / 2, hd = obj.depth / 2, vs = this.view.s;
      const readable = a => ((((a + 90) % 180) + 180) % 180) - 90;
      const rotA = obj.rotation || 0;
      const tw = toWorldPt(obj, 0, -hd - 16 / vs), sp1 = this.toScreen(tw.x, tw.y);
      label(sp1.x, sp1.y, formatLen(obj.width, units), readable(rotA));
      const rd = toWorldPt(obj, hw + 16 / vs, 0), sp2 = this.toScreen(rd.x, rd.y);
      label(sp2.x, sp2.y, formatLen(obj.depth, units), readable(rotA + 90));
      if (obj.locked) continue;
      const scrW = obj.width * vs, scrD = obj.depth * vs;
      const handles = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (scrW > 90 && scrD > 90) handles.push([0, -1], [1, 0], [0, 1], [-1, 0]);
      const push = Math.max(0, 18 - Math.min(scrW, scrD) / 4) / vs;
      const hitR = Math.min(scrW, scrD) < 70 ? 15 : 22;
      for (const [sx, sy] of handles) {
        const wp = toWorldPt(obj, sx * (hw + push), sy * (hd + push)), q = this.toScreen(wp.x, wp.y);
        const hg = s('g', { 'data-handle': `r:${sx}:${sy}`, 'data-cx': q.x, 'data-cy': q.y, class: 'handle' }, o);
        s('circle', { cx: q.x, cy: q.y, r: hitR, fill: 'transparent' }, hg);
        s(sx && sy ? 'circle' : 'rect', sx && sy
          ? { cx: q.x, cy: q.y, r: 6.5, fill: '#fff', stroke: pal.sel, 'stroke-width': 2 }
          : { x: q.x - 5, y: q.y - 5, width: 10, height: 10, rx: 2, fill: '#fff', stroke: pal.sel, 'stroke-width': 2 }, hg);
      }
      if (sel.kind !== 'slope') {
        const top = toWorldPt(obj, 0, -hd), hp = toWorldPt(obj, 0, -hd - 34 / vs);
        const a = this.toScreen(top.x, top.y), b = this.toScreen(hp.x, hp.y);
        s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: pal.sel, 'stroke-width': 1.5 }, o);
        const hg = s('g', { 'data-handle': 'rot', class: 'handle' }, o);
        s('circle', { cx: b.x, cy: b.y, r: 22, fill: 'transparent' }, hg);
        s('circle', { cx: b.x, cy: b.y, r: 9, fill: pal.sel }, hg);
        s('path', { d: `M${b.x + 4} ${b.y - 1}a4 4 0 1 1 -1.6 -3.2M${b.x + 4} ${b.y - 5}v4h-4`, fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, hg);
      }
    }

    if (this.readouts) {
      for (const r of this.readouts.dist) {
        const a = this.toScreen(r.o.x, r.o.y);
        const t = Math.max(0, r.hit.d);
        const b = this.toScreen(r.o.x + r.dir.x * t, r.o.y + r.dir.y * t);
        s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: pal.sel, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, o);
        label((a.x + b.x) / 2 + (r.dir.y ? 4 : 0), (a.y + b.y) / 2 - (r.dir.x ? 10 : 0), formatLen(r.hit.d, units), 0, 'ov-lbl ' + (r.dir.y ? 'left' : ''));
      }
    }

    if (this.mode === 'wall') {
      const pts = [...this.drawPts];
      if (this.hover && pts.length) pts.push(this.hover);
      if (pts.length > 1) s('polyline', { points: polyPts(pts), fill: 'none', stroke: pal.sel, 'stroke-width': 2, 'stroke-dasharray': '6 4' }, o);
      for (const p of this.drawPts) { const q = this.toScreen(p.x, p.y); s('circle', { cx: q.x, cy: q.y, r: 5, fill: pal.sel }, o); }
      if (this.hover) {
        const q = this.toScreen(this.hover.x, this.hover.y);
        s('circle', { cx: q.x, cy: q.y, r: 6, fill: 'none', stroke: pal.sel, 'stroke-width': 2 }, o);
        const last = this.drawPts[this.drawPts.length - 1];
        if (last) {
          const len = Math.hypot(this.hover.x - last.x, this.hover.y - last.y);
          const m = this.toScreen((last.x + this.hover.x) / 2, (last.y + this.hover.y) / 2);
          label(m.x, m.y - 14, formatLen(len, units));
        }
      }
    }
    if ((this.mode === 'slope' || this.mode === 'calibrate') && this.tmpPts.length) {
      const a = this.tmpPts[0], b = this.hover;
      const qa = this.toScreen(a.x, a.y);
      s('circle', { cx: qa.x, cy: qa.y, r: 6, fill: pal.sel }, o);
      if (b) {
        const qb = this.toScreen(b.x, b.y);
        if (this.mode === 'slope') s('rect', { x: Math.min(qa.x, qb.x), y: Math.min(qa.y, qb.y), width: Math.abs(qa.x - qb.x), height: Math.abs(qa.y - qb.y), fill: pal.slope, 'fill-opacity': 0.2, stroke: pal.slope, 'stroke-dasharray': '6 4' }, o);
        else s('line', { x1: qa.x, y1: qa.y, x2: qb.x, y2: qb.y, stroke: pal.sel, 'stroke-width': 2, 'stroke-dasharray': '6 4' }, o);
      }
    }

    if (this.settings.rulers) this.drawRulers(o);
    if (this.cmp) {
      const co = this.cmp.overlay;
      co.replaceChildren();
      const t = s('text', { class: 'ov-cap', x: 14, y: 26 }, co);
      t.textContent = `Comparing: ${this.cmp.caption || ''} (view only)`;
    }
  }

  drawRulers(o) {
    const { w, h } = this.size();
    if (!w) return;
    const v = this.view, pal = this.pal, units = this.store.units, R = 20;
    const steps = units === 'ftin'
      ? [1, 2, 6, 12, 24, 36, 60, 120, 240, 600, 1200].map(x => x * 2.54)
      : [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const step = steps.find(x => x * v.s >= 64) || steps[steps.length - 1];
    const g = s('g', { class: 'rulers' }, o);
    s('rect', { x: 0, y: 0, width: w, height: R, fill: pal.ruler }, g);
    s('rect', { x: 0, y: 0, width: R, height: h, fill: pal.ruler }, g);
    const ticks = [];
    const x0 = (R - v.tx) / v.s, x1 = (w - v.tx) / v.s;
    for (let k = Math.ceil(x0 / step) * step; k <= x1; k += step) {
      const sx = k * v.s + v.tx;
      ticks.push(`M${sx} ${R - 7}V${R}`);
      const t = s('text', { class: 'ruler-t', x: sx + 3, y: 11 }, g);
      t.textContent = formatLen(k, units, true);
    }
    const y0 = (R - v.ty) / v.s, y1 = (h - v.ty) / v.s;
    for (let k = Math.ceil(y0 / step) * step; k <= y1; k += step) {
      const sy = k * v.s + v.ty;
      ticks.push(`M${R - 7} ${sy}H${R}`);
      const t = s('text', { class: 'ruler-t', x: 0, y: 0, transform: `translate(11 ${sy - 3}) rotate(-90)` }, g);
      t.textContent = formatLen(k, units, true);
    }
    s('path', { d: ticks.join(''), stroke: pal.rulerInk, 'stroke-width': 1, fill: 'none' }, g);
    s('rect', { x: 0, y: 0, width: R, height: R, fill: pal.ruler }, g);
    const u = s('text', { class: 'ruler-t', x: 3, y: 13 }, g);
    u.textContent = units === 'ftin' ? 'ft' : 'cm';
  }
}

/** How fixed elements attach to walls while dragging. */
export const MOUNTS = { door: 'center', window: 'center', radiator: 'face', ac: 'face', fireplace: 'face', counter: 'face', fridge: 'face', stove: 'face', closet: 'face', outlet: 'face' };
