/**
 * props.js
 * Properties panel for the current selection (item, fixed element, wall,
 * sloped ceiling zone, note, or several items) and per-item comment threads.
 */
import { el, icon, field, toast, escapeHtml } from './ui.js';
import {
  STATUSES, PRIORITIES, DISPOSITIONS, FIXED_TYPES, formatLen, parseLen, findEntity, uid, formatMoney
} from './state.js';
import { wallLength, minCeilingOver } from './canvas.js';

const SWATCHES = ['#E8DFD0', '#EDE4D6', '#D9CCB6', '#C49A6C', '#8B6B4E', '#A7B59A', '#8A9A7B', '#C9855F', '#F3EBDD', '#4A4540'];

function patch(store, sel, values, label) {
  store.apply(label, p => {
    const f = findEntity(p, store.floorId, sel);
    if (f) Object.assign(f.obj, values);
  });
}

function lenField(store, sel, key, value, label, { min = 1, onSet } = {}) {
  const units = store.units;
  const inp = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(value, units), autocomplete: 'off', dataset: { fk: sel.id + key } });
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  inp.addEventListener('change', () => {
    const v = parseLen(inp.value, units);
    if (v == null || v < min) {
      toast(units === 'ftin' ? 'Enter a length like 13\' 6" or 162 (inches).' : 'Enter a length like 412 or 412 cm.', 'error');
      inp.value = formatLen(value, units);
      return;
    }
    if (onSet) onSet(v); else patch(store, sel, { [key]: v }, 'Edit ' + label.toLowerCase());
  });
  return field(label, inp);
}

function numField(store, sel, key, value, label, { step = 1, suffix = '', onSet } = {}) {
  const inp = el('input', { type: 'number', step, value: Math.round(value * 10) / 10, inputmode: 'decimal', dataset: { fk: sel.id + key } });
  inp.addEventListener('change', () => {
    const v = Number(inp.value);
    if (!isFinite(v)) { inp.value = value; return; }
    if (onSet) onSet(v); else patch(store, sel, { [key]: v }, 'Edit ' + label.toLowerCase());
  });
  return field(label + (suffix ? ` (${suffix})` : ''), inp);
}

function textField(store, sel, key, value, label, { multiline = false, type = 'text', placeholder = '' } = {}) {
  const inp = multiline
    ? el('textarea', { rows: 3, value: value || '', placeholder, dataset: { fk: sel.id + key } })
    : el('input', { type, value: value || '', placeholder, autocomplete: 'off', dataset: { fk: sel.id + key } });
  inp.addEventListener('change', () => patch(store, sel, { [key]: inp.value }, 'Edit ' + label.toLowerCase()));
  return field(label, inp);
}

function selectField(store, sel, key, value, label, options, onSet) {
  const s = el('select', { dataset: { fk: sel.id + key } }, ...options.map(([v, t]) => el('option', { value: v, text: t })));
  s.value = value;
  s.addEventListener('change', () => (onSet ? onSet(s.value) : patch(store, sel, { [key]: s.value }, 'Edit ' + label.toLowerCase())));
  return field(label, s);
}

function toggleField(store, sel, key, value, label) {
  const cb = el('input', { type: 'checkbox', checked: !!value });
  cb.addEventListener('change', () => patch(store, sel, { [key]: cb.checked }, label));
  return el('label', { class: 'check' }, cb, el('span', { text: label }));
}

function actionBar(buttons) {
  return el('div', { class: 'action-bar' }, ...buttons.filter(Boolean).map(b => el('button', {
    class: 'btn small' + (b.danger ? ' danger' : ''), html: icon(b.icon) + `<span>${b.label}</span>`, onclick: b.onClick, title: b.title || b.label
  })));
}

function colorField(store, sel, value) {
  const input = el('input', { type: 'color', value, 'aria-label': 'Custom color' });
  input.addEventListener('change', () => patch(store, sel, { color: input.value }, 'Change color'));
  const sw = SWATCHES.map(c => el('button', {
    class: 'swatch' + (c.toLowerCase() === value.toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': 'Color ' + c,
    onclick: () => patch(store, sel, { color: c }, 'Change color')
  }));
  return el('div', { class: 'field' }, el('span', { class: 'label', text: 'Color' }), el('div', { class: 'swatches' }, ...sw, input));
}

/**
 * Change a wall's length or direction, keeping its start point fixed.
 * The wall joined at its end slides along (keeping its own length and angle),
 * and the wall after that stretches, so a rectangle stays a rectangle.
 */
function setWall(store, id, { length, angle, thickness }) {
  store.apply(thickness != null ? 'Edit wall thickness' : 'Edit wall', () => {
    const f = store.floor, w = f.walls.find(x => x.id === id);
    if (!w) return;
    if (thickness != null) { w.thickness = thickness; return; }
    const L = wallLength(w) || 1;
    const a = angle != null ? (angle * Math.PI) / 180 : Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
    const len = length != null ? length : L;
    const nx = Math.round((w.x1 + Math.cos(a) * len) * 100) / 100, ny = Math.round((w.y1 + Math.sin(a) * len) * 100) / 100;
    const ox = w.x2, oy = w.y2, dx = nx - ox, dy = ny - oy;
    const near = (o, end, x, y) => Math.hypot(o['x' + end] - x, o['y' + end] - y) < 0.5;
    const moved = new Set([w]);
    w.x2 = nx; w.y2 = ny;
    for (const o of f.walls) {
      if (moved.has(o)) continue;
      for (const end of ['1', '2']) {
        if (!near(o, end, ox, oy)) continue;
        const other = end === '1' ? '2' : '1', px = o['x' + other], py = o['y' + other];
        o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy;
        moved.add(o);
        for (const q of f.walls) {
          if (moved.has(q)) continue;
          for (const e2 of ['1', '2']) if (near(q, e2, px, py)) { q['x' + e2] += dx; q['y' + e2] += dy; }
        }
        break;
      }
    }
  });
}

/** Comment thread for one entity. */
function comments(store, id, ops) {
  const thread = store.state.lists.comments[id] || [];
  const list = el('ul', { class: 'comments', 'aria-label': 'Comments' });
  for (const c of thread) {
    list.append(el('li', { class: 'comment' },
      el('div', { class: 'c-head' },
        el('strong', { text: c.author || 'Someone' }),
        el('span', { class: 'muted', text: new Date(c.ts || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }),
        el('button', {
          class: 'icon-btn tiny', 'aria-label': 'Delete comment', html: icon('close'),
          onclick: () => store.apply('Delete comment', p => {
            p.lists.comments[id] = (p.lists.comments[id] || []).filter(x => x.id !== c.id);
            if (!p.lists.comments[id].length) delete p.lists.comments[id];
          })
        })),
      el('p', { html: escapeHtml(c.text).replace(/\n/g, '<br>') })));
  }
  const ta = el('textarea', { rows: 2, placeholder: 'Add a comment for whoever you share this with', 'aria-label': 'New comment', dataset: { fk: id + 'comment' } });
  const nameIn = el('input', { type: 'text', placeholder: 'Your name', value: store.state.settings.userName, 'aria-label': 'Your name', class: 'compact' });
  const post = () => {
    const text = ta.value.trim();
    if (!text) return;
    const author = nameIn.value.trim() || 'Me';
    if (author !== store.state.settings.userName) store.setSetting('userName', author);
    store.apply('Add comment', p => {
      (p.lists.comments[id] = p.lists.comments[id] || []).push({ id: uid('cm'), author, text, ts: Date.now() });
    });
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } });
  return el('section', { class: 'comments-wrap' },
    el('h3', { class: 'sec-title', html: icon('comment') + `<span>Comments (${thread.length})</span>` }),
    thread.length ? list : el('p', { class: 'muted', text: 'No comments yet. Discuss options here.' }),
    ta,
    el('div', { class: 'btn-row' }, nameIn, el('button', { class: 'btn small primary', text: 'Post', onclick: post })));
}

/**
 * Render the properties panel.
 * ops: { duplicate, remove, forward, back, toggleLock, group, ungroup, rotate, setStatus, drawWalls, typeWalls, openLibrary }
 */
export function renderProps(root, store, selection, ops) {
  const units = store.units;
  const sels = selection.map(sel => ({ sel, f: findEntity(store.state, store.floorId, sel) })).filter(x => x.f);
  if (!sels.length) return renderNone(root, store, ops);
  if (sels.length > 1) {
    const items = sels.filter(x => x.sel.kind === 'item');
    const grouped = items.length && items.every(x => x.f.obj.groupId && x.f.obj.groupId === items[0].f.obj.groupId);
    const statusSel = el('select', {}, el('option', { value: '', text: 'Set status for all items' }), ...STATUSES.map(s => el('option', { value: s.id, text: s.label })));
    statusSel.addEventListener('change', () => { if (statusSel.value) ops.setStatus(statusSel.value); });
    root.replaceChildren(...[
      el('h2', { class: 'panel-title', text: `${sels.length} selected` }),
      el('p', { class: 'muted', text: 'Drag any of them to move together. Shift-click or use Multi-select to add or remove.' }),
      items.length ? field('Status', statusSel) : null,
      actionBar([
        items.length > 1 && !grouped ? { icon: 'group', label: 'Group', onClick: ops.group } : null,
        grouped ? { icon: 'ungroup', label: 'Ungroup', onClick: ops.ungroup } : null,
        { icon: 'copy', label: 'Duplicate', onClick: ops.duplicate },
        { icon: 'lock', label: 'Lock or unlock', onClick: ops.toggleLock },
        { icon: 'trash', label: 'Delete', danger: true, onClick: ops.remove }
      ])].filter(Boolean));
    return;
  }
  const { sel, f } = sels[0];
  const o = f.obj;
  const nodes = [];
  if (sel.kind === 'item') {
    const nameIn = el('input', { type: 'text', value: o.name, class: 'title-input', 'aria-label': 'Item name', dataset: { fk: o.id + 'name' } });
    nameIn.addEventListener('change', () => patch(store, sel, { name: nameIn.value.trim() || 'Item' }, 'Rename item'));
    nodes.push(nameIn);
    const ceil = minCeilingOver(store.floor, o);
    if (ceil != null && o.height > ceil) {
      nodes.push(el('div', { class: 'alert', role: 'alert', html: icon('warning') + `<span>This item is ${formatLen(o.height, units)} tall but the ceiling here is only ${formatLen(ceil, units)}.</span>` }));
    }
    nodes.push(
      selectField(store, sel, 'status', o.status, 'Status', STATUSES.map(s => [s.id, s.label])),
      el('div', { class: 'grid3' },
        lenField(store, sel, 'width', o.width, 'Width'),
        lenField(store, sel, 'depth', o.depth, 'Depth'),
        lenField(store, sel, 'height', o.height, 'Height', { min: 0 })),
      el('div', { class: 'grid3' },
        lenField(store, sel, 'x', o.x, 'X', { min: -1e7 }),
        lenField(store, sel, 'y', o.y, 'Y', { min: -1e7 }),
        numField(store, sel, 'rotation', o.rotation, 'Rotation', { suffix: 'deg', onSet: v => patch(store, sel, { rotation: ((v % 360) + 360) % 360 }, 'Rotate') })),
      el('div', { class: 'grid2' },
        selectField(store, sel, 'shape', o.shape, 'Shape', [['rect', 'Rectangle'], ['circle', 'Circle or oval'], ['lshape', 'L-shape']]),
        selectField(store, sel, 'layer', o.layer, 'Layer', [['furniture', 'Furniture'], ['rugs', 'Rugs'], ['lighting', 'Lighting'], ['plants', 'Plants']])),
      o.shape === 'lshape' ? lenField(store, sel, 'armWidth', o.armWidth || Math.min(o.width, o.depth) * 0.45, 'L-shape arm depth') : null,
      colorField(store, sel, o.color),
      selectField(store, sel, 'room', o.room || store.floorId, 'Room', [['126', '126 (Lower)'], ['226', '226 (Upper)']]));
    if (o.status === 'buy' || o.status === 'bought') {
      const priceIn = el('input', { type: 'number', min: 0, step: '0.01', value: o.price ?? '', placeholder: '0', inputmode: 'decimal', dataset: { fk: o.id + 'price' } });
      priceIn.addEventListener('change', () => patch(store, sel, { price: priceIn.value === '' ? null : Math.max(0, Number(priceIn.value)) }, 'Edit price'));
      nodes.push(el('div', { class: 'card sub' },
        el('h3', { class: 'sec-title', text: 'Shopping' }),
        el('div', { class: 'grid2' }, field('Price (USD)', priceIn), selectField(store, sel, 'priority', o.priority, 'Priority', PRIORITIES.map(x => [x, x]))),
        textField(store, sel, 'store', o.store, 'Store', { placeholder: 'e.g. IKEA, Target' }),
        textField(store, sel, 'link', o.link, 'Product link', { type: 'url', placeholder: 'https://' })));
    }
    if (o.status === 'remove') nodes.push(selectField(store, sel, 'disposition', o.disposition, 'What happens to it', DISPOSITIONS.map(x => [x, x])));
    nodes.push(
      textField(store, sel, 'notes', o.notes, 'Notes', { multiline: true }),
      toggleField(store, sel, 'locked', o.locked, 'Locked (cannot be moved)'),
      actionBar([
        { icon: 'copy', label: 'Duplicate', onClick: ops.duplicate },
        { icon: 'rotate', label: 'Rotate 90', onClick: () => ops.rotate(90) },
        { icon: 'up', label: 'Forward', onClick: ops.forward, title: 'Bring forward' },
        { icon: 'down', label: 'Back', onClick: ops.back, title: 'Send back' },
        o.groupId ? { icon: 'ungroup', label: 'Ungroup', onClick: ops.ungroup } : null,
        { icon: 'trash', label: 'Delete', danger: true, onClick: ops.remove }
      ]),
      comments(store, o.id, ops));
  } else if (sel.kind === 'fixed') {
    nodes.push(
      el('div', { class: 'panel-kicker', text: FIXED_TYPES[o.type] + (o.linkId ? ' . linked on both floors' : '') }),
      (() => {
        const nameIn = el('input', { type: 'text', value: o.name, class: 'title-input', 'aria-label': 'Name', dataset: { fk: o.id + 'name' } });
        nameIn.addEventListener('change', () => patch(store, sel, { name: nameIn.value.trim() || FIXED_TYPES[o.type] }, 'Rename'));
        return nameIn;
      })(),
      el('div', { class: 'grid3' },
        lenField(store, sel, 'width', o.width, o.type === 'door' ? 'Opening' : 'Width'),
        lenField(store, sel, 'depth', o.depth, 'Depth'),
        lenField(store, sel, 'height', o.height, 'Height', { min: 0 })),
      el('div', { class: 'grid3' },
        lenField(store, sel, 'x', o.x, 'X', { min: -1e7 }),
        lenField(store, sel, 'y', o.y, 'Y', { min: -1e7 }),
        numField(store, sel, 'rotation', o.rotation, 'Rotation', { suffix: 'deg', onSet: v => patch(store, sel, { rotation: ((v % 360) + 360) % 360 }, 'Rotate') })));
    if (o.type === 'door') {
      nodes.push(el('div', { class: 'grid2' },
        selectField(store, sel, 'hinge', o.hinge || 'left', 'Hinge side', [['left', 'Left'], ['right', 'Right']]),
        selectField(store, sel, 'swing', o.swing || 'in', 'Swings', [['in', 'Inward'], ['out', 'Outward']])),
      toggleField(store, sel, 'entry', o.entry, 'This is the entrance (keep 90 cm clear inside)'));
    }
    if (o.type === 'stairs') {
      nodes.push(el('div', { class: 'grid2' },
        selectField(store, sel, 'stairStyle', o.stairStyle || 'winding', 'Style', [['winding', 'Winding (quarter turn)'], ['spiral', 'Spiral'], ['straight', 'Straight']]),
        selectField(store, sel, 'stairTurn', o.stairTurn || 'right', 'Turns', [['right', 'Right'], ['left', 'Left']])),
      el('p', { class: 'hint', text: 'The staircase is linked: moving or resizing it here updates the other floor too.' }));
    }
    nodes.push(
      textField(store, sel, 'notes', o.notes, 'Notes', { multiline: true }),
      toggleField(store, sel, 'locked', o.locked, 'Locked (cannot be moved)'),
      actionBar([
        o.type !== 'stairs' ? { icon: 'copy', label: 'Duplicate', onClick: ops.duplicate } : null,
        { icon: 'rotate', label: 'Rotate 90', onClick: () => ops.rotate(90) },
        o.type === 'door' ? { icon: 'flip', label: 'Flip hinge', onClick: () => patch(store, sel, { hinge: o.hinge === 'right' ? 'left' : 'right' }, 'Flip door') } : null,
        { icon: 'trash', label: 'Delete', danger: true, onClick: ops.remove }
      ]),
      comments(store, o.id, ops));
  } else if (sel.kind === 'wall') {
    const len = wallLength(o), ang = (Math.atan2(o.y2 - o.y1, o.x2 - o.x1) * 180) / Math.PI;
    nodes.push(
      el('h2', { class: 'panel-title', text: 'Wall' }),
      lenField(store, sel, 'length', len, 'Length', { onSet: v => setWall(store, o.id, { length: v }) }),
      el('p', { class: 'hint', text: 'The start point stays fixed. The next wall slides along with the end point and keeps its length, and the wall after it stretches, so rectangles stay square.' }),
      el('div', { class: 'grid2' },
        numField(store, sel, 'angle', ang, 'Direction', { suffix: 'deg', onSet: v => setWall(store, o.id, { angle: v }) }),
        lenField(store, sel, 'thickness', o.thickness, 'Thickness', { onSet: v => setWall(store, o.id, { thickness: v }) })),
      el('p', { class: 'muted small', text: `Start ${formatLen(o.x1, units)}, ${formatLen(o.y1, units)}. End ${formatLen(o.x2, units)}, ${formatLen(o.y2, units)}.` }),
      actionBar([{ icon: 'trash', label: 'Delete wall', danger: true, onClick: ops.remove }]));
  } else if (sel.kind === 'slope') {
    nodes.push(
      el('h2', { class: 'panel-title', text: 'Sloped ceiling zone' }),
      el('div', { class: 'grid2' },
        lenField(store, sel, 'low', o.low, 'Low height'),
        lenField(store, sel, 'high', o.high, 'High height')),
      selectField(store, sel, 'lowSide', o.lowSide, 'Low side', [['top', 'Top edge'], ['bottom', 'Bottom edge'], ['left', 'Left edge'], ['right', 'Right edge']]),
      el('div', { class: 'grid2' }, lenField(store, sel, 'width', o.width, 'Width'), lenField(store, sel, 'depth', o.depth, 'Depth')),
      el('p', { class: 'hint', text: `Shading is darker where the ceiling is lower. The red dashed line marks ${formatLen(190, units)} of headroom. Items taller than the ceiling above them are flagged.` }),
      toggleField(store, sel, 'locked', o.locked, 'Locked'),
      actionBar([{ icon: 'trash', label: 'Delete zone', danger: true, onClick: ops.remove }]));
  } else if (sel.kind === 'note') {
    const ta = el('textarea', { rows: 4, value: o.text, 'aria-label': 'Note text', dataset: { fk: o.id + 'text' } });
    ta.addEventListener('change', () => patch(store, sel, { text: ta.value }, 'Edit note'));
    const colors = ['#F3DD9B', '#E9C4B0', '#C9D6BC', '#D6CFE6'];
    nodes.push(
      el('h2', { class: 'panel-title', text: 'Sticky note' }),
      field('Text', ta),
      el('div', { class: 'swatches' }, ...colors.map(c => el('button', { class: 'swatch' + ((o.color || colors[0]) === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Note color', onclick: () => patch(store, sel, { color: c }, 'Note color') }))),
      actionBar([{ icon: 'trash', label: 'Delete note', danger: true, onClick: ops.remove }]));
  }
  root.replaceChildren(...nodes.filter(Boolean));
}

function renderNone(root, store, ops) {
  const f = store.floor, sc = store.scenario, units = store.units;
  const perim = f.walls.reduce((a, w) => a + wallLength(w), 0);
  const toBuy = sc.items.filter(i => i.status === 'buy');
  const spend = toBuy.reduce((a, i) => a + (Number(i.price) || 0), 0);
  root.replaceChildren(...[
    el('h2', { class: 'panel-title', text: f.label }),
    el('p', { class: 'muted', text: `Layout: ${sc.name}` }),
    el('dl', { class: 'stats' },
      el('dt', { text: 'Walls' }), el('dd', { text: f.walls.length ? `${f.walls.length} (${formatLen(perim, units)} total)` : 'None yet' }),
      el('dt', { text: 'Fixed elements' }), el('dd', { text: String(f.fixed.length) }),
      el('dt', { text: 'Items in this layout' }), el('dd', { text: String(sc.items.length) }),
      el('dt', { text: 'To buy here' }), el('dd', { text: `${toBuy.length} (${formatMoney(spend) || '$0'})` })),
    !f.walls.length ? el('div', { class: 'card sub' },
      el('h3', { class: 'sec-title', text: 'Start with the walls' }),
      el('p', { text: 'Type exact lengths and turns, or tap points on the grid. You can fix any length afterwards by tapping the wall.' }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', html: icon('keyboard') + '<span>Type lengths</span>', onclick: ops.typeWalls }),
        el('button', { class: 'btn', html: icon('draw') + '<span>Tap points</span>', onclick: ops.drawWalls }))) : null,
    el('p', { class: 'hint', text: 'Tap anything on the plan to edit it. Long-press or right-click for more actions.' })].filter(Boolean));
}
