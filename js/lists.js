/**
 * lists.js
 * Lists tied to the design: shopping list with budget tracker, get-rid-of list,
 * to-do list with drag reordering, and sticky notes. Every list is sortable and
 * filterable, and rows link back to items on the plan.
 */
import { el, icon, field, confirmDialog } from './ui.js';
import {
  activeItems, getFloor, activeScenario, formatLen, formatMoney, PRIORITIES, DISPOSITIONS, uid
} from './state.js';

const view = {
  shop: { sort: 'room', status: 'all', priority: 'all' },
  remove: { sort: 'room', disposition: 'all' },
  todo: { sort: 'manual', filter: 'open' }
};

const PRI_RANK = { Must: 0, Should: 1, Nice: 2 };

/** Apply a patch to an item, found fresh by id so undo-restored state is respected. */
function editItem(store, floorId, id, patch, label = 'Edit item') {
  store.apply(label, p => {
    const it = activeScenario(getFloor(p, floorId)).items.find(x => x.id === id);
    if (it) Object.assign(it, patch);
  });
}

function sortSelect(value, options, onChange, label) {
  const sel = el('select', { 'aria-label': label, class: 'compact' }, ...options.map(([v, t]) => el('option', { value: v, text: t })));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function roomLabel(floorId) { return floorId === '226' ? '226' : floorId === '126' ? '126' : floorId || 'Unassigned'; }

/* ------------------------------------------------------------------ */
/* Shopping list and budget                                            */
/* ------------------------------------------------------------------ */

export function shoppingRows(p) {
  return activeItems(p).filter(({ item }) => item.status === 'buy' || item.status === 'bought');
}

export function budgetSummary(p) {
  const rows = shoppingRows(p);
  const sum = arr => arr.reduce((a, r) => a + (Number(r.item.price) || 0), 0);
  const byRoom = {}, byPriority = {};
  for (const r of rows) {
    const room = r.item.room || r.floor.id;
    byRoom[room] = (byRoom[room] || 0) + (Number(r.item.price) || 0);
    byPriority[r.item.priority] = (byPriority[r.item.priority] || 0) + (Number(r.item.price) || 0);
  }
  return {
    planned: sum(rows), spent: sum(rows.filter(r => r.item.status === 'bought')),
    unpriced: rows.filter(r => r.item.price == null).length, count: rows.length, byRoom, byPriority
  };
}

function budgetBlock(store, ctx) {
  const p = store.state, b = p.project.budget, sum = budgetSummary(p);
  const scaleMax = Math.max(b.max, sum.planned, 1) * 1.1;
  const pct = v => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const state = sum.planned > b.max ? 'over' : sum.planned >= b.min ? 'within' : 'under';
  const msg = { over: `Over budget by ${formatMoney(sum.planned - b.max)}`, within: 'Within your budget range', under: `${formatMoney(b.min - sum.planned)} below your minimum` }[state];
  const minIn = el('input', { type: 'number', min: 0, step: 50, value: b.min, inputmode: 'decimal', dataset: { fk: 'bmin' } });
  const maxIn = el('input', { type: 'number', min: 0, step: 50, value: b.max, inputmode: 'decimal', dataset: { fk: 'bmax' } });
  const saveB = () => {
    let mn = Number(minIn.value), mx = Number(maxIn.value);
    if (!isFinite(mn) || mn < 0) mn = 0;
    if (!isFinite(mx) || mx < mn) mx = mn;
    store.apply('Edit budget', s => { s.project.budget = { min: mn, max: mx }; });
  };
  minIn.addEventListener('change', saveB);
  maxIn.addEventListener('change', saveB);
  const sub = (title, obj, order) => el('div', { class: 'subtotals' },
    el('h4', { text: title }),
    ...(order || Object.keys(obj)).filter(k => obj[k] != null).map(k => el('div', { class: 'sub-row' }, el('span', { text: k }), el('span', { text: formatMoney(obj[k]) }))));
  return el('section', { class: 'budget card', 'aria-label': 'Budget' },
    el('div', { class: 'budget-top' },
      el('div', {}, el('div', { class: 'big', text: formatMoney(sum.planned) }), el('div', { class: 'muted', text: `planned, ${formatMoney(sum.spent)} bought` })),
      el('div', { class: 'budget-in' }, field('Min $', minIn), field('Max $', maxIn))),
    el('div', { class: 'bar', role: 'img', 'aria-label': `Planned ${formatMoney(sum.planned)} against a budget of ${formatMoney(b.min)} to ${formatMoney(b.max)}` },
      el('div', { class: 'bar-fill ' + state, style: { width: pct(sum.planned) } }),
      el('div', { class: 'bar-spent', style: { width: pct(sum.spent) } }),
      el('div', { class: 'bar-mark', style: { left: pct(b.min) }, title: 'Minimum' }),
      el('div', { class: 'bar-mark max', style: { left: pct(b.max) }, title: 'Maximum' })),
    el('div', { class: 'budget-msg ' + state, text: msg + (sum.unpriced ? `. ${sum.unpriced} item${sum.unpriced > 1 ? 's' : ''} without a price.` : '.') }),
    el('div', { class: 'sub-grid' },
      sub('By room', Object.fromEntries(Object.entries(sum.byRoom).map(([k, v]) => ['Room ' + roomLabel(k), v]))),
      sub('By priority', sum.byPriority, PRIORITIES)),
    el('button', { class: 'btn small', html: icon('csv') + '<span>Export CSV</span>', onclick: ctx.onExportCSV }));
}

export function renderShopping(root, store, ctx) {
  const v = view.shop, units = store.units;
  let rows = shoppingRows(store.state);
  if (v.status !== 'all') rows = rows.filter(r => r.item.status === v.status);
  if (v.priority !== 'all') rows = rows.filter(r => r.item.priority === v.priority);
  const cmp = {
    room: (a, b) => (a.item.room || '').localeCompare(b.item.room || '') || a.item.name.localeCompare(b.item.name),
    priority: (a, b) => PRI_RANK[a.item.priority] - PRI_RANK[b.item.priority],
    price: (a, b) => (Number(b.item.price) || 0) - (Number(a.item.price) || 0),
    status: (a, b) => a.item.status.localeCompare(b.item.status),
    name: (a, b) => a.item.name.localeCompare(b.item.name)
  }[v.sort];
  rows.sort(cmp);
  const rerender = () => renderShopping(root, store, ctx);
  const controls = el('div', { class: 'list-controls' },
    sortSelect(v.sort, [['room', 'Sort: room'], ['priority', 'Sort: priority'], ['price', 'Sort: price'], ['status', 'Sort: status'], ['name', 'Sort: name']], x => { v.sort = x; rerender(); }, 'Sort shopping list'),
    sortSelect(v.status, [['all', 'All'], ['buy', 'To buy'], ['bought', 'Bought']], x => { v.status = x; rerender(); }, 'Filter by status'),
    sortSelect(v.priority, [['all', 'Any priority'], ...PRIORITIES.map(x => [x, x])], x => { v.priority = x; rerender(); }, 'Filter by priority'));

  const list = el('ul', { class: 'rows', 'aria-label': 'Shopping list' });
  for (const { item: it, floor } of rows) {
    const fid = floor.id;
    const bought = el('input', { type: 'checkbox', checked: it.status === 'bought', 'aria-label': `Bought: ${it.name}` });
    bought.addEventListener('change', () => editItem(store, fid, it.id, { status: bought.checked ? 'bought' : 'buy' }, bought.checked ? 'Mark bought' : 'Mark to buy'));
    const storeIn = el('input', { type: 'text', value: it.store, placeholder: 'Store', 'aria-label': 'Store', dataset: { fk: it.id + 'store' } });
    storeIn.addEventListener('change', () => editItem(store, fid, it.id, { store: storeIn.value.trim() }));
    const linkIn = el('input', { type: 'url', value: it.link, placeholder: 'Product link', 'aria-label': 'Product link', dataset: { fk: it.id + 'link' } });
    linkIn.addEventListener('change', () => editItem(store, fid, it.id, { link: linkIn.value.trim() }));
    const priceIn = el('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: it.price ?? '', placeholder: 'Price', 'aria-label': 'Price in USD', dataset: { fk: it.id + 'price' } });
    priceIn.addEventListener('change', () => editItem(store, fid, it.id, { price: priceIn.value === '' ? null : Math.max(0, Number(priceIn.value)) }));
    const pri = el('select', { 'aria-label': 'Priority' }, ...PRIORITIES.map(x => el('option', { value: x, text: x })));
    pri.value = it.priority;
    pri.addEventListener('change', () => editItem(store, fid, it.id, { priority: pri.value }));
    const safeLink = /^https?:\/\//i.test(it.link) ? it.link : null;
    const li = el('li', { class: 'row' + (ctx.highlightId === it.id ? ' hl' : '') + (it.status === 'bought' ? ' done' : ''), dataset: { id: it.id } },
      el('div', { class: 'row-main' },
        bought,
        el('button', { class: 'row-title', onclick: () => ctx.onLocate(fid, { kind: 'item', id: it.id }), title: 'Show on plan' },
          el('span', { class: 'name', text: it.name }),
          el('span', { class: 'meta', text: `${formatLen(it.width, units, true)} x ${formatLen(it.depth, units, true)}${it.height > 1 ? ' x ' + formatLen(it.height, units, true) : ''} . Room ${roomLabel(it.room || fid)}` })),
        el('span', { class: 'pri pri-' + it.priority.toLowerCase(), text: it.priority })),
      el('div', { class: 'row-fields' },
        storeIn,
        el('div', { class: 'link-wrap' }, linkIn, safeLink ? el('a', { class: 'icon-btn', href: safeLink, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open product link', html: icon('link') }) : null),
        priceIn, pri));
    list.append(li);
  }
  root.replaceChildren(
    budgetBlock(store, ctx),
    controls,
    rows.length ? list : el('p', { class: 'empty', text: 'Items marked To Buy or Bought appear here automatically. Add furniture from the library, then set its status.' }));
}

/* ------------------------------------------------------------------ */
/* Get-rid-of list                                                     */
/* ------------------------------------------------------------------ */

export function renderRemove(root, store, ctx) {
  const v = view.remove;
  let rows = activeItems(store.state).filter(r => r.item.status === 'remove');
  if (v.disposition !== 'all') rows = rows.filter(r => r.item.disposition === v.disposition);
  rows.sort({
    room: (a, b) => (a.item.room || '').localeCompare(b.item.room || '') || a.item.name.localeCompare(b.item.name),
    name: (a, b) => a.item.name.localeCompare(b.item.name),
    disposition: (a, b) => a.item.disposition.localeCompare(b.item.disposition)
  }[v.sort]);
  const rerender = () => renderRemove(root, store, ctx);
  const controls = el('div', { class: 'list-controls' },
    sortSelect(v.sort, [['room', 'Sort: room'], ['name', 'Sort: name'], ['disposition', 'Sort: plan']], x => { v.sort = x; rerender(); }, 'Sort list'),
    sortSelect(v.disposition, [['all', 'Any plan'], ...DISPOSITIONS.map(x => [x, x])], x => { v.disposition = x; rerender(); }, 'Filter by plan'));
  const list = el('ul', { class: 'rows', 'aria-label': 'Get rid of list' });
  for (const { item: it, floor } of rows) {
    const disp = el('select', { 'aria-label': `What happens to ${it.name}` }, ...DISPOSITIONS.map(x => el('option', { value: x, text: x })));
    disp.value = it.disposition;
    disp.addEventListener('change', () => editItem(store, floor.id, it.id, { disposition: disp.value }));
    const notes = el('input', { type: 'text', value: it.notes, placeholder: 'Notes (buyer, pickup date)', 'aria-label': 'Notes', dataset: { fk: it.id + 'rnotes' } });
    notes.addEventListener('change', () => editItem(store, floor.id, it.id, { notes: notes.value }));
    list.append(el('li', { class: 'row' + (ctx.highlightId === it.id ? ' hl' : ''), dataset: { id: it.id } },
      el('div', { class: 'row-main' },
        el('button', { class: 'row-title', onclick: () => ctx.onLocate(floor.id, { kind: 'item', id: it.id }), title: 'Show on plan' },
          el('span', { class: 'name', text: it.name }), el('span', { class: 'meta', text: `Room ${roomLabel(it.room || floor.id)}` }))),
      el('div', { class: 'row-fields two' }, disp, notes)));
  }
  root.replaceChildren(controls, rows.length ? list : el('p', { class: 'empty', text: 'Mark items as Existing-Remove to plan what happens to them: sell, donate, store or reuse.' }));
}

/* ------------------------------------------------------------------ */
/* To-do list                                                          */
/* ------------------------------------------------------------------ */

function linkOptions(store) {
  const opts = [['', 'No link'], ['room:126', 'Room 126'], ['room:226', 'Room 226']];
  for (const { item, floor } of activeItems(store.state)) opts.push([`item:${floor.id}:${item.id}`, `${item.name} (${floor.id})`]);
  return opts;
}

function linkText(store, link) {
  if (!link) return '';
  const [kind, a, b] = link.split(':');
  if (kind === 'room') return 'Room ' + a;
  const it = activeScenario(getFloor(store.state, a)).items.find(x => x.id === b);
  return it ? it.name : '';
}

export function renderTodo(root, store, ctx) {
  const v = view.todo;
  const all = store.state.lists.todo;
  let rows = all.slice();
  if (v.filter === 'open') rows = rows.filter(t => !t.done);
  if (v.filter === 'done') rows = rows.filter(t => t.done);
  if (v.sort === 'due') rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  if (v.sort === 'status') rows.sort((a, b) => Number(a.done) - Number(b.done));
  if (v.sort === 'room') rows.sort((a, b) => (a.link || 'z').localeCompare(b.link || 'z'));
  const canDrag = v.sort === 'manual';
  const rerender = () => renderTodo(root, store, ctx);

  const text = el('input', { type: 'text', placeholder: 'New task, e.g. Measure window in 226', 'aria-label': 'New task', dataset: { fk: 'newtodo' } });
  const due = el('input', { type: 'date', 'aria-label': 'Due date' });
  const link = el('select', { 'aria-label': 'Link task to', class: 'compact' }, ...linkOptions(store).map(([val, t]) => el('option', { value: val, text: t })));
  const add = () => {
    if (!text.value.trim()) { text.focus(); return; }
    const t = { id: uid('td'), text: text.value.trim(), done: false, due: due.value, link: link.value };
    store.apply('Add task', p => { p.lists.todo.unshift(t); });
    requestAnimationFrame(() => root.querySelector('[data-fk="newtodo"]')?.focus());
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const form = el('div', { class: 'todo-add card' }, text, el('div', { class: 'todo-add-row' }, due, link, el('button', { class: 'btn primary small', text: 'Add', onclick: add })));

  const controls = el('div', { class: 'list-controls' },
    sortSelect(v.sort, [['manual', 'Sort: my order'], ['due', 'Sort: due date'], ['status', 'Sort: status'], ['room', 'Sort: room or item']], x => { v.sort = x; rerender(); }, 'Sort tasks'),
    sortSelect(v.filter, [['open', 'Open'], ['done', 'Done'], ['all', 'All']], x => { v.filter = x; rerender(); }, 'Filter tasks'));

  const list = el('ul', { class: 'rows todo', 'aria-label': 'To-do list' });
  const saveOrder = () => {
    const order = [...list.children].map(r => r.dataset.id);
    store.apply('Reorder tasks', p => {
      const visible = p.lists.todo.filter(t => order.includes(t.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      let i = 0;
      p.lists.todo = p.lists.todo.map(t => (order.includes(t.id) ? visible[i++] : t));
    });
  };
  const edit = (id, patch, label = 'Edit task') => store.apply(label, p => { const t = p.lists.todo.find(x => x.id === id); if (t) Object.assign(t, patch); });

  for (const t of rows) {
    const handle = el('button', { class: 'grip', 'aria-label': `Reorder ${t.text}. Use arrow up and down.`, html: icon('grip'), disabled: !canDrag, title: canDrag ? 'Drag to reorder' : 'Switch to My order to reorder' });
    const cb = el('input', { type: 'checkbox', checked: t.done, 'aria-label': `Done: ${t.text}` });
    cb.addEventListener('change', () => edit(t.id, { done: cb.checked }, cb.checked ? 'Complete task' : 'Reopen task'));
    const txt = el('input', { type: 'text', value: t.text, class: 'todo-text', 'aria-label': 'Task', dataset: { fk: t.id + 'text' } });
    txt.addEventListener('change', () => edit(t.id, { text: txt.value }));
    const d = el('input', { type: 'date', value: t.due || '', 'aria-label': 'Due date', class: 'compact' });
    d.addEventListener('change', () => edit(t.id, { due: d.value }));
    const overdue = t.due && !t.done && t.due < new Date().toISOString().slice(0, 10);
    const lt = linkText(store, t.link);
    const row = el('li', { class: 'row todo-row' + (t.done ? ' done' : '') + (overdue ? ' overdue' : ''), dataset: { id: t.id } },
      el('div', { class: 'row-main' }, handle, cb, txt,
        el('button', { class: 'icon-btn', 'aria-label': 'Delete task', html: icon('trash'), onclick: () => store.apply('Delete task', p => { p.lists.todo = p.lists.todo.filter(x => x.id !== t.id); }) })),
      el('div', { class: 'row-fields two' }, d,
        lt ? el('button', {
          class: 'chip on', text: lt, onclick: () => {
            const [kind, a, b] = t.link.split(':');
            if (kind === 'item') ctx.onLocate(a, { kind: 'item', id: b });
            else ctx.onGoFloor(a);
          }
        }) : el('span', { class: 'muted', text: overdue ? 'Overdue' : '' })));
    if (canDrag) attachDrag(handle, row, list, saveOrder);
    list.append(row);
  }
  root.replaceChildren(form, controls, rows.length ? list : el('p', { class: 'empty', text: v.filter === 'open' ? 'No open tasks. Add one above.' : 'Nothing here yet.' }));
}

/** Pointer-based drag reorder that works with touch, plus arrow-key reordering. */
function attachDrag(handle, row, list, onDone) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    const move = ev => {
      const y = ev.clientY;
      const others = [...list.children].filter(r => r !== row);
      const before = others.find(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
      if (before) list.insertBefore(row, before); else list.append(row);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      onDone();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && row.previousElementSibling) { e.preventDefault(); list.insertBefore(row, row.previousElementSibling); onDone(); }
    if (e.key === 'ArrowDown' && row.nextElementSibling) { e.preventDefault(); list.insertBefore(row.nextElementSibling, row); onDone(); }
  });
}

/* ------------------------------------------------------------------ */
/* Sticky notes                                                        */
/* ------------------------------------------------------------------ */

export function renderNotes(root, store, ctx) {
  const floor = store.floor, sc = store.scenario;
  const list = el('ul', { class: 'rows', 'aria-label': 'Sticky notes' });
  for (const n of sc.notes) {
    const ta = el('textarea', { rows: 2, value: n.text, 'aria-label': 'Note text', dataset: { fk: n.id + 'note' } });
    ta.addEventListener('change', () => store.apply('Edit note', () => { const x = store.scenario.notes.find(q => q.id === n.id); if (x) x.text = ta.value; }));
    list.append(el('li', { class: 'row' + (ctx.highlightId === n.id ? ' hl' : ''), dataset: { id: n.id } },
      el('div', { class: 'row-main' }, ta,
        el('div', { class: 'col' },
          el('button', { class: 'icon-btn', 'aria-label': 'Show note on plan', html: icon('target'), onclick: () => ctx.onLocate(floor.id, { kind: 'note', id: n.id }) }),
          el('button', {
            class: 'icon-btn', 'aria-label': 'Delete note', html: icon('trash'),
            onclick: async () => { if (await confirmDialog('Delete this note?', { ok: 'Delete', danger: true })) store.apply('Delete note', () => { store.scenario.notes = store.scenario.notes.filter(q => q.id !== n.id); }); }
          })))));
  }
  root.replaceChildren(
    el('div', { class: 'list-controls' },
      el('span', { class: 'muted', text: `${floor.label}, ${sc.name}` }),
      el('button', { class: 'btn small primary', html: icon('note') + '<span>Drop a note</span>', onclick: ctx.onAddNote })),
    sc.notes.length ? list : el('p', { class: 'empty', text: 'Sticky notes live on the plan. Tap Drop a note, then tap where it should go.' }));
}

