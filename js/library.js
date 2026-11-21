/**
 * library.js
 * Furniture library: loads presets, renders the searchable library panel and
 * the fixed-element palette, builds new items, and the custom item dialog.
 */
import { el, icon, field, modal, toast } from './ui.js';
import { uid, formatLen, parseLen, FIXED_TYPES } from './state.js';

let LIB = { categories: [], items: [], fixed: [] };

export async function loadLibrary() {
  try {
    const r = await fetch('data/furniture-library.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    LIB = {
      categories: Array.isArray(data.categories) ? data.categories : [],
      items: Array.isArray(data.items) ? data.items : [],
      fixed: Array.isArray(data.fixed) ? data.fixed : []
    };
  } catch (e) {
    toast('Could not load the furniture library. Reload once you are online.', 'error');
  }
  return LIB;
}

export const library = () => LIB;

/** Create a furniture item from a preset at a world position. */
export function makeItem(preset, pos, floorId, status = 'buy') {
  return {
    id: uid('it'), type: preset.id || 'custom', name: preset.name || 'Item',
    x: Math.round(pos.x), y: Math.round(pos.y),
    width: preset.width, depth: preset.depth, height: preset.height || 0, rotation: 0,
    shape: preset.shape || 'rect', armWidth: preset.armWidth, color: preset.color || '#D9CCB6',
    status, room: floorId, price: null, store: '', link: '', priority: 'Should', notes: preset.notes || '',
    locked: false, layer: preset.layer || 'furniture', decor: preset.decor, plant: preset.plant,
    disposition: 'Undecided'
  };
}

/** Create a fixed element (door, window, stairs and so on) at a world position. */
export function makeFixed(preset, pos) {
  const e = {
    id: uid('fx'), type: preset.type, name: preset.name || FIXED_TYPES[preset.type],
    x: Math.round(pos.x), y: Math.round(pos.y), width: preset.width, depth: preset.depth,
    height: preset.height || 0, rotation: 0, shape: preset.shape || 'rect', locked: false, notes: ''
  };
  if (e.type === 'door') Object.assign(e, { hinge: 'left', swing: 'in', entry: false });
  if (e.type === 'stairs') Object.assign(e, { stairStyle: preset.stairStyle || 'winding', stairTurn: 'right', linkId: uid('link') });
  return e;
}

function preview(p) {
  const max = Math.max(p.width, p.depth), k = 34 / max;
  const w = Math.max(4, p.width * k), d = Math.max(4, p.depth * k);
  const x = (40 - w) / 2, y = (40 - d) / 2;
  let shape;
  if (p.decor === 'plant') {
    shape = `<circle cx="20" cy="20" r="${w / 2 * 0.55}" fill="#B5603C" opacity=".8"/>` +
      Array.from({ length: 7 }, (_, i) => `<ellipse cx="${20 + w * 0.25}" cy="20" rx="${w * 0.25}" ry="${w * 0.1}" fill="${p.color}" transform="rotate(${i * 51} 20 20)"/>`).join('');
  } else if (p.shape === 'circle') shape = `<ellipse cx="20" cy="20" rx="${w / 2}" ry="${d / 2}" fill="${p.color}" stroke="currentColor" stroke-width="1"/>`;
  else if (p.shape === 'lshape') {
    const a = (p.armWidth || Math.min(p.width, p.depth) * 0.45) * k;
    shape = `<path d="M${x} ${y}h${w}v${a}h${-(w - a)}v${d - a}h${-a}z" fill="${p.color}" stroke="currentColor" stroke-width="1"/>`;
  } else shape = `<rect x="${x}" y="${y}" width="${w}" height="${d}" rx="2" fill="${p.color}" stroke="currentColor" stroke-width="1"/>`;
  return `<svg viewBox="0 0 40 40" class="lib-prev" aria-hidden="true">${shape}</svg>`;
}

const dims = (p, units) => `${formatLen(p.width, units, true)} x ${formatLen(p.depth, units, true)}${p.height > 1 ? ' x ' + formatLen(p.height, units, true) : ''}`;

/**
 * Render the library panel.
 * opts: { units(), newStatus(), setNewStatus(v), onAdd(preset), onCustom() }
 */
export function renderLibrary(root, opts) {
  let query = '', cat = 'all';
  const search = el('input', { type: 'search', placeholder: 'Search furniture', 'aria-label': 'Search furniture', class: 'search' });
  const chips = el('div', { class: 'chips', role: 'tablist', 'aria-label': 'Categories' });
  const grid = el('div', { class: 'lib-grid' });
  const statusSel = el('select', { 'aria-label': 'Status for new items' },
    el('option', { value: 'buy', text: 'To Buy' }), el('option', { value: 'keep', text: 'Existing-Keep' }),
    el('option', { value: 'move', text: 'Existing-Move' }));
  statusSel.value = opts.newStatus();
  statusSel.addEventListener('change', () => opts.setNewStatus(statusSel.value));

  const cats = [{ id: 'all', label: 'All' }, ...LIB.categories];
  for (const c of cats) {
    chips.append(el('button', {
      class: 'chip' + (c.id === cat ? ' on' : ''), role: 'tab', 'aria-selected': String(c.id === cat), text: c.label,
      onclick: e => {
        cat = c.id;
        chips.querySelectorAll('.chip').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); });
        e.currentTarget.classList.add('on');
        e.currentTarget.setAttribute('aria-selected', 'true');
        draw();
      }
    }));
  }

  function draw() {
    const q = query.trim().toLowerCase();
    const list = LIB.items.filter(p => (cat === 'all' || p.category === cat) && (!q || p.name.toLowerCase().includes(q) || p.category.includes(q)));
    grid.replaceChildren(...list.map(p => el('button', {
      class: 'lib-card', title: `Add ${p.name}`,
      'aria-label': `Add ${p.name}, ${dims(p, opts.units())}`,
      html: `${preview(p)}<span class="lib-name">${p.name}</span><span class="lib-dims">${dims(p, opts.units())}</span>`,
      onclick: () => opts.onAdd(p)
    })));
    if (!list.length) grid.append(el('p', { class: 'muted', text: 'No presets match. Try another word or create a custom item.' }));
  }
  search.addEventListener('input', () => { query = search.value; draw(); });
  draw();
  root.replaceChildren(
    el('div', { class: 'lib-head' }, search,
      el('button', { class: 'btn small', html: icon('add') + '<span>Custom</span>', onclick: opts.onCustom })),
    field('New items are added as', statusSel),
    chips, grid);
}

/** Render the fixed-element palette (structure). opts: { units(), onAddFixed(preset), onTypeWalls(), onTapWalls(), onSlope() } */
export function renderFixedPalette(root, opts) {
  const grid = el('div', { class: 'lib-grid fixed' });
  for (const p of LIB.fixed) {
    grid.append(el('button', {
      class: 'lib-card', 'aria-label': `Add ${p.name}`,
      html: `${fixedIcon(p.type)}<span class="lib-name">${p.name}</span><span class="lib-dims">${formatLen(p.width, opts.units(), true)} x ${formatLen(p.depth, opts.units(), true)}</span>`,
      onclick: () => opts.onAddFixed(p)
    }));
  }
  root.replaceChildren(
    el('h3', { class: 'sec-title', text: 'Walls' }),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', html: icon('draw') + '<span>Tap points</span>', onclick: opts.onTapWalls }),
      el('button', { class: 'btn', html: icon('keyboard') + '<span>Type lengths</span>', onclick: opts.onTypeWalls }),
      el('button', { class: 'btn', html: icon('slope') + '<span>Sloped ceiling</span>', onclick: opts.onSlope })),
    el('p', { class: 'hint', text: 'Doors, windows, radiators and outlets snap onto the nearest wall while you drag them. Hold Shift to place freely.' }),
    el('h3', { class: 'sec-title', text: 'Fixed elements' }),
    grid);
}

function fixedIcon(type) {
  const paths = {
    door: 'M8 32V8M8 8a24 24 0 0 1 24 24', window: 'M4 16h32v8H4zM4 20h32', radiator: 'M6 14h28v12H6zM12 14v12M18 14v12M24 14v12M30 14v12',
    ac: 'M6 12h28v16H6zM10 17h20M10 21h20M10 25h20', fireplace: 'M4 10h32v20H4zM12 16h16v14H12zM2 30h36', counter: 'M4 12h32v16H4zM4 25h32',
    fridge: 'M10 4h20v32H10zM10 26h20', stove: 'M6 8h28v24H6zM14 16a3 3 0 1 0 .1 0M26 16a3 3 0 1 0 .1 0M14 26a3 3 0 1 0 .1 0M26 26a3 3 0 1 0 .1 0',
    closet: 'M6 10h28v20H6zM9 20h22M6 28h28', washroom: 'M6 6h28v28H6zM12 12h8v12h-8zM26 26a3 3 0 1 0 .1 0', stairs: 'M8 4h24v32H8zM8 12h24M8 20h24M8 28h24',
    outlet: 'M20 12a8 8 0 1 0 .1 0M17 17v6M23 17v6', light: 'M20 10a10 10 0 1 0 .1 0M13 13l14 14M27 13L13 27'
  };
  return `<svg viewBox="0 0 40 40" class="lib-prev" aria-hidden="true"><path d="${paths[type] || 'M6 6h28v28H6z'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Dialog to create a custom item. onCreate(preset) receives a preset-shaped object. */
export function customItemDialog(units, onCreate) {
  const u = units === 'ftin' ? 'e.g. 6\' 2" or 74' : 'e.g. 120';
  const name = el('input', { type: 'text', placeholder: 'e.g. Vintage trunk', autocomplete: 'off' });
  const w = el('input', { type: 'text', inputmode: 'decimal', placeholder: u });
  const d = el('input', { type: 'text', inputmode: 'decimal', placeholder: u });
  const h = el('input', { type: 'text', inputmode: 'decimal', placeholder: u });
  const shape = el('select', {}, el('option', { value: 'rect', text: 'Rectangle' }), el('option', { value: 'circle', text: 'Circle or oval' }), el('option', { value: 'lshape', text: 'L-shape' }));
  const arm = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Arm depth for L-shape' });
  const color = el('input', { type: 'color', value: '#D9CCB6' });
  const layer = el('select', {}, ...[['furniture', 'Furniture'], ['rugs', 'Rug'], ['lighting', 'Lighting'], ['plants', 'Plant']].map(([v, t]) => el('option', { value: v, text: t })));
  const notes = el('textarea', { rows: 2, placeholder: 'Optional notes' });
  const armField = field('L-shape arm depth', arm);
  armField.hidden = true;
  shape.addEventListener('change', () => { armField.hidden = shape.value !== 'lshape'; });
  const err = el('p', { class: 'error', role: 'alert' });
  const body = el('div', { class: 'form-grid' },
    field('Name', name), field('Shape', shape),
    field('Width', w), field('Depth', d), field('Height', h, 'Used for sloped ceiling warnings'), armField,
    field('Color', color), field('Layer', layer), el('div', { class: 'span2' }, field('Notes', notes)), el('div', { class: 'span2' }, err));
  modal({
    title: 'Custom item', body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add to plan', primary: true, onClick: () => {
          const W = parseLen(w.value, units), D = parseLen(d.value, units), H = h.value.trim() ? parseLen(h.value, units) : 0;
          if (!name.value.trim()) { err.textContent = 'Please enter a name.'; return false; }
          if (!(W > 0) || !(D > 0) || H == null || H < 0) { err.textContent = 'Please enter a valid width, depth and height.'; return false; }
          const A = shape.value === 'lshape' && arm.value.trim() ? parseLen(arm.value, units) : undefined;
          onCreate({
            id: 'custom', name: name.value.trim(), width: W, depth: D, height: H, shape: shape.value,
            armWidth: A || undefined, color: color.value, layer: layer.value,
            decor: layer.value === 'plants' ? 'plant' : layer.value === 'rugs' ? 'rug' : undefined,
            plant: layer.value === 'plants' ? 'generic' : undefined, notes: notes.value
          });
          return true;
        }
      }
    ]
  });
}
