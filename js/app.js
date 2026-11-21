/**
 * app.js
 * Entry point. Loads the project, builds the canvas and panels, wires the
 * toolbars, dialogs, keyboard shortcuts, onboarding tour, PWA install and
 * service worker, and keeps everything rendered from the Store.
 */
import {
  Store, createEmptyProject, migrate, uid, clone, STATUSES, LAYERS, formatLen, parseLen, findEntity, newScenario
} from './state.js';
import { loadProject, scheduleSave, flushSave, setItem, loadBackup, saveBackup } from './storage.js';
import { PlanCanvas, PALETTES } from './canvas.js';
import { loadLibrary, renderLibrary, renderFixedPalette, makeItem, makeFixed, customItemDialog } from './library.js';
import { renderShopping, renderRemove, renderTodo, renderNotes } from './lists.js';
import { renderProps } from './props.js';
import { createShareLink, handleIncomingLink, exportProjectFile, importProjectFile, Sync, syncDialog, describeDialog } from './share.js';
import { exportPNG, exportSVG, exportPDF, exportCSV } from './export.js';
import { el, icon, field, modal, toast, contextMenu, confirmDialog, promptDialog, pickFile } from './ui.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const isPhone = () => window.matchMedia('(max-width: 899px)').matches;

const ui = { ltab: 'library', rtab: 'item', highlightId: null, sheet: null, libUnits: null, scrollToHl: false, warnedStorage: false };
let store, canvas, sync, installPrompt = null, renderQueued = 0;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  injectIcons(document);
  let project = createEmptyProject();
  let notice = null;
  try {
    const saved = await loadProject();
    if (saved) {
      try { project = migrate(saved); }
      catch (e) {
        notice = 'Your saved project could not be read, so a fresh project was started. The unreadable copy was kept in browser storage. If you have a project file, open it from More, then Open project file.';
        await setItem('unreadable-' + Date.now(), saved);
      }
    }
  } catch (e) {
    notice = 'Browser storage is not available. Your work will not be saved automatically. Use More, then Save project file, to keep a copy.';
  }
  store = new Store(project);
  applyTheme();
  syncPanelClasses();
  await loadLibrary();

  canvas = new PlanCanvas($('#canvas-wrap'), store, {
    onSelect, onContextMenu: openEntityMenu, onDrawState: () => { renderModebar(); renderEmptyHint(); },
    onSlopeRect: slopeDialog, onCalibrate: calibrateDialog, onNotePlace: placeNote, onEntityTap,
    theme: resolvedTheme
  });
  sync = new Sync(store, renderSyncChip);
  store.on(onStoreEvent);
  bindChrome();
  bindKeys();
  renderAll();
  requestAnimationFrame(() => canvas.fit());
  if (notice) modal({ title: 'Heads up', body: notice });

  await handleIncomingLink(store, afterLoad);
  if (store.state.settings.sync.enabled) sync.start();
  if (!store.state.settings.tourDone && !notice) setTimeout(startTour, 700);

  registerServiceWorker();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => flushSave());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); queueRender(); });
  window.addEventListener('hashchange', () => handleIncomingLink(store, afterLoad));
}

function injectIcons(root) {
  for (const n of root.querySelectorAll('[data-icon]')) {
    if (n.querySelector(':scope > .ic')) continue;
    n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon));
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('service-worker.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (nw) nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready. Reload the page to update.', 'info', 7000);
      });
    });
  }).catch(() => { /* offline support is optional */ });
}

function resolvedTheme() {
  const t = store ? store.state.settings.theme : 'auto';
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('room-studio:theme', store.state.settings.theme); } catch (e) { /* storage blocked */ }
  const meta = document.querySelectorAll('meta[name="theme-color"]');
  meta.forEach(m => m.setAttribute('content', PALETTES[t].bg));
}

function onSaved(result) {
  if (result === 'none' && !ui.warnedStorage) {
    ui.warnedStorage = true;
    modal({ title: 'Not saved', body: 'This browser blocked local storage (private mode or full storage). Your changes are not being saved. Use More, then Save project file, to keep your work.' });
  }
}

function onStoreEvent(ev) {
  scheduleSave(() => store.state, onSaved);
  if (ev.type === 'change' && (ev.source === 'local' || ev.source === 'history')) sync.push();
  if (ev.type === 'settings' && ev.key === 'theme') applyTheme();
  queueRender();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = requestAnimationFrame(() => { renderQueued = 0; renderAll(); });
}

function renderAll() {
  canvas.render();
  renderTopbar();
  renderLeft(false);
  renderRight();
  renderModebar();
  renderEmptyHint();
  renderFilterBadge();
}

function afterLoad() {
  canvas.setCompare(null);
  canvas.select([], true);
  canvas.setMode('select');
  canvas.fitted.clear();
  ui.libUnits = null;
  applyTheme();
  renderAll();
  requestAnimationFrame(() => canvas.fit());
}

/** Re-render while keeping focus, caret and scroll position in panels. */
function preserveFocus(fn) {
  const a = document.activeElement;
  const key = a && a.dataset ? a.dataset.fk : null;
  let caret = null;
  try { if (key && typeof a.selectionStart === 'number') caret = [a.selectionStart, a.selectionEnd]; } catch (e) { caret = null; }
  const scrolls = $$('.panel-body').map(p => p.scrollTop);
  fn();
  $$('.panel-body').forEach((p, i) => { p.scrollTop = scrolls[i]; });
  if (key) {
    const n = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (n && n !== document.activeElement) {
      n.focus({ preventScroll: true });
      try { if (caret) n.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text input */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Top bar, panels and sheets                                          */
/* ------------------------------------------------------------------ */

function bindChrome() {
  $$('.floor-tab').forEach(b => b.addEventListener('click', () => setFloor(b.dataset.floor)));
  $('#scenario-select').addEventListener('change', e => {
    const id = e.target.value;
    canvas.select([], true);
    store.apply('Switch layout', () => { store.floor.activeScenario = id; });
  });
  $('#btn-scenarios').addEventListener('click', scenarioDialog);
  $('#sync-chip').addEventListener('click', () => syncDialog(store, sync));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    action(b.dataset.action, b);
  });
  $$('[data-ltab]').forEach(b => b.addEventListener('click', () => { ui.ltab = b.dataset.ltab; renderLeft(true); }));
  $$('[data-rtab]').forEach(b => b.addEventListener('click', () => {
    ui.rtab = b.dataset.rtab;
    renderRight();
    if (isPhone()) $('#right').classList.toggle('peek', ui.rtab === 'item');
    if (isPhone() && ui.sheet === 'right') $('#backdrop').hidden = ui.rtab === 'item';
  }));
  $$('.sheet-close').forEach(b => b.addEventListener('click', () => closeSheets()));
  $('#backdrop').addEventListener('click', () => closeSheets());
  for (const side of ['left', 'right']) bindSheetDrag($('#' + side));
  window.addEventListener('resize', () => { if (!isPhone()) closeSheets(); });
}

function bindSheetDrag(panel) {
  const grab = panel.querySelector('.sheet-grab');
  let y0 = null, dy = 0;
  grab.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); panel.style.transition = 'none'; });
  grab.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) closeSheets();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

function action(name, btn) {
  switch (name) {
    case 'select': setMode('select'); closeSheets(); break;
    case 'draw': setMode(['wall', 'slope', 'note'].includes(canvas.mode) ? 'select' : 'wall'); break;
    case 'note': setMode(canvas.mode === 'note' ? 'select' : 'note'); break;
    case 'add': ui.sheet === 'left' ? closeSheets() : openSheet('left', 'library'); break;
    case 'lists': ui.sheet === 'right' && ui.rtab !== 'item' ? closeSheets() : openSheet('right', ui.rtab === 'item' ? 'shop' : ui.rtab); break;
    case 'more': openMore(btn); break;
    case 'undo': store.undo(); break;
    case 'redo': store.redo(); break;
    case 'zoom-in': canvas.zoomBy(1.25); break;
    case 'zoom-out': canvas.zoomBy(0.8); break;
    case 'fit': canvas.fit(); break;
    case 'clearance': store.setSetting('clearance', !store.state.settings.clearance); toast(store.state.settings.clearance ? 'Clearance checker on: red marks walkways under 90 cm and blocked doors or stairs' : 'Clearance checker off'); break;
    case 'multi': canvas.multi = !canvas.multi; toast(canvas.multi ? 'Multi-select on: tap items to add or remove them' : 'Multi-select off'); renderTopbar(); break;
    case 'toggle-left': store.setSetting('leftOpen', !store.state.settings.leftOpen); syncPanelClasses(); break;
    case 'toggle-right': store.setSetting('rightOpen', !store.state.settings.rightOpen); syncPanelClasses(); break;
    case 'show-all':
      store.setSetting('statusFilter', Object.fromEntries(STATUSES.map(s => [s.id, true])));
      store.setSetting('layers', Object.fromEntries(LAYERS.map(l => [l.id, true])));
      break;
    default: break;
  }
}

function syncPanelClasses() {
  document.body.classList.toggle('left-closed', !store.state.settings.leftOpen);
  document.body.classList.toggle('right-closed', !store.state.settings.rightOpen);
}

function openSheet(side, tab) {
  if (side === 'left') { if (tab) ui.ltab = tab; renderLeft(true); }
  else { if (tab) ui.rtab = tab; renderRight(); }
  if (!isPhone()) {
    const key = side === 'left' ? 'leftOpen' : 'rightOpen';
    if (!store.state.settings[key]) { store.setSetting(key, true); syncPanelClasses(); }
    return;
  }
  closeSheets(side);
  const p = $('#' + side);
  p.classList.add('open');
  p.classList.toggle('peek', side === 'right' && ui.rtab === 'item');
  $('#backdrop').hidden = side === 'right' && ui.rtab === 'item';
  ui.sheet = side;
  renderTopbar();
}

function closeSheets(except) {
  for (const side of ['left', 'right']) if (side !== except) $('#' + side).classList.remove('open');
  $('#backdrop').hidden = true;
  ui.sheet = except || null;
  if (store) renderTopbar();
}

function setFloor(id) {
  if (store.floorId === id) return;
  canvas.setCompare(null);
  canvas.select([], true);
  canvas.setMode('select');
  ui.highlightId = null;
  store.setSetting('floorId', id);
  requestAnimationFrame(() => requestAnimationFrame(() => canvas.fitIfNeeded()));
}

function setMode(m) {
  canvas.setMode(m);
  if (m !== 'select' && isPhone()) closeSheets();
  if (m === 'wall' && !store.floor.walls.length) toast('Tap the first corner of the room. Points snap to the grid.');
  renderTopbar();
}

function renderTopbar() {
  const st = store.state.settings;
  $$('.floor-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.floor === store.floorId)));
  const sel = $('#scenario-select');
  sel.replaceChildren(...store.floor.scenarios.map(s => el('option', { value: s.id, text: s.name })));
  sel.value = store.floor.activeScenario;
  const drawing = ['wall', 'slope', 'calibrate', 'movebg'].includes(canvas.mode);
  $$('[data-action="select"]').forEach(b => b.classList.toggle('on', canvas.mode === 'select' && !ui.sheet));
  $$('[data-action="draw"]').forEach(b => b.classList.toggle('on', drawing));
  $$('[data-action="note"]').forEach(b => b.classList.toggle('on', canvas.mode === 'note'));
  $$('[data-action="clearance"]').forEach(b => b.classList.toggle('on', !!st.clearance));
  $$('[data-action="multi"]').forEach(b => b.classList.toggle('on', !!canvas.multi));
  $$('[data-action="add"]').forEach(b => b.classList.toggle('on', ui.sheet === 'left'));
  $$('[data-action="lists"]').forEach(b => b.classList.toggle('on', ui.sheet === 'right' && ui.rtab !== 'item'));
  $$('[data-action="undo"]').forEach(b => { b.disabled = !store.canUndo; });
  $$('[data-action="redo"]').forEach(b => { b.disabled = !store.canRedo; });
}

/* ---------- left panel ---------- */

function renderLeft(force) {
  $$('[data-ltab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ltab === ui.ltab)));
  const body = $('#left-body');
  if (ui.ltab === 'library') {
    if (!force && body.dataset.tab === 'library' && ui.libUnits === store.units) return;
    renderLibrary(body, {
      units: () => store.units,
      newStatus: () => store.state.settings.newStatus || 'buy',
      setNewStatus: v => store.setSetting('newStatus', v),
      onAdd: addItem,
      onCustom: () => customItemDialog(store.units, addItem)
    });
    ui.libUnits = store.units;
  } else if (ui.ltab === 'structure') preserveFocus(() => renderStructure(body));
  else preserveFocus(() => renderView(body));
  body.dataset.tab = ui.ltab;
}

function renderStructure(body) {
  const wrap = el('div');
  renderFixedPalette(wrap, {
    units: () => store.units,
    onAddFixed: addFixed,
    onTapWalls: () => setMode('wall'),
    onTypeWalls: typeWallsDialog,
    onSlope: () => { setMode('slope'); toast('Tap two opposite corners of the sloped area.'); }
  });
  const thick = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(store.state.settings.wallThickness || 12, store.units), dataset: { fk: 'wallthick' } });
  thick.addEventListener('change', () => {
    const v = parseLen(thick.value, store.units);
    if (v > 0 && v < 200) store.setSetting('wallThickness', v);
    else toast('Enter a wall thickness such as 12 cm.', 'error');
  });
  body.replaceChildren(wrap, field('Default thickness for new walls', thick), traceSection());
}

function traceSection() {
  const bg = store.floor.background;
  const sec = el('section', { class: 'trace' }, el('h3', { class: 'sec-title', html: icon('image') + '<span>Background trace</span>' }));
  if (!bg.image) {
    sec.append(
      el('p', { class: 'hint', text: 'Upload a photo of your hand sketch or the official floor plan, then calibrate it by tapping two points a known distance apart.' }),
      el('button', { class: 'btn', html: icon('upload') + '<span>Upload image</span>', onclick: uploadBackground }));
    return sec;
  }
  const opacity = el('input', { type: 'range', min: 5, max: 100, value: Math.round(bg.opacity * 100), 'aria-label': 'Background opacity' });
  opacity.addEventListener('input', () => { store.begin(); store.floor.background.opacity = opacity.value / 100; canvas.render(); });
  opacity.addEventListener('change', () => store.commit('Background opacity'));
  const chk = (key, label) => {
    const cb = el('input', { type: 'checkbox', checked: !!bg[key] });
    cb.addEventListener('change', () => store.apply(label, () => { store.floor.background[key] = cb.checked; }));
    return el('label', { class: 'check' }, cb, el('span', { text: label }));
  };
  const widthIn = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(bg.w * bg.scale, store.units), dataset: { fk: 'bgwidth' } });
  widthIn.addEventListener('change', () => {
    const v = parseLen(widthIn.value, store.units);
    if (!(v > 0)) { toast('Enter a width such as 800 cm.', 'error'); return; }
    store.apply('Scale background', () => { const b = store.floor.background; b.scale = v / b.w; });
  });
  sec.append(
    el('img', { class: 'trace-prev', src: bg.image, alt: 'Background trace image' }),
    field(`Opacity`, opacity),
    el('div', { class: 'toggles' }, chk('visible', 'Visible'), chk('locked', 'Locked')),
    field('Image width on the plan', widthIn, 'Calibrating sets this for you.'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn small primary', html: icon('target') + '<span>Calibrate</span>', onclick: () => { if (!store.floor.background.visible) store.apply('Show background', () => { store.floor.background.visible = true; }); setMode('calibrate'); } }),
      el('button', { class: 'btn small', html: icon('move') + '<span>Move</span>', disabled: bg.locked, onclick: () => setMode('movebg') }),
      el('button', { class: 'btn small', html: icon('upload') + '<span>Replace</span>', onclick: uploadBackground }),
      el('button', { class: 'btn small danger', html: icon('trash') + '<span>Remove</span>', onclick: async () => { if (await confirmDialog('Remove the background image from this floor?', { ok: 'Remove', danger: true })) store.apply('Remove background', () => { store.floor.background.image = null; }); } })));
  return sec;
}

async function uploadBackground() {
  const file = await pickFile('image/*');
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
  try {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image format is not supported.')); i.src = url; });
    const max = 2400, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    const center = canvas.getViewCenter();
    const scale = 600 / c.width;
    store.apply('Add background', () => {
      const bg = store.floor.background;
      Object.assign(bg, { image: data, w: c.width, h: c.height, scale, opacity: 0.5, visible: true, locked: false, offset: { x: Math.round(center.x - 300), y: Math.round(center.y - (c.height * scale) / 2) } });
    });
    store.setSetting('layers', { ...store.state.settings.layers, background: true });
    toast('Image added. Now tap Calibrate and tap two points a known distance apart.', 'info', 5000);
  } catch (e) { toast('Could not use this image: ' + e.message, 'error'); }
}

function seg(label, options, value, onPick) {
  return el('div', { class: 'field' },
    el('span', { class: 'label', text: label }),
    el('div', { class: 'seg', role: 'group', 'aria-label': label }, ...options.map(([v, t]) => el('button', {
      type: 'button', text: t, 'aria-pressed': String(v === value), onclick: () => onPick(v)
    }))));
}

function renderView(body) {
  const st = store.state.settings, p = store.state.project;
  const name = el('input', { type: 'text', value: p.name, dataset: { fk: 'projname' } });
  name.addEventListener('change', () => store.apply('Rename project', s => { s.project.name = name.value.trim() || 'My apartment'; }));
  const tog = (key, label) => {
    const cb = el('input', { type: 'checkbox', checked: st[key] !== false && !!(st[key] ?? true) });
    cb.addEventListener('change', () => store.setSetting(key, cb.checked));
    return el('label', { class: 'check' }, cb, el('span', { text: label }));
  };
  const layerBoxes = LAYERS.map(l => {
    const cb = el('input', { type: 'checkbox', checked: st.layers[l.id] !== false });
    cb.addEventListener('change', () => store.setSetting('layers', { ...st.layers, [l.id]: cb.checked }));
    return el('label', { class: 'check' }, cb, el('span', { text: l.label }));
  });
  const pal = PALETTES[resolvedTheme()];
  const statusBoxes = STATUSES.map(s => {
    const cb = el('input', { type: 'checkbox', checked: st.statusFilter[s.id] !== false });
    cb.addEventListener('change', () => store.setSetting('statusFilter', { ...st.statusFilter, [s.id]: cb.checked }));
    return el('label', { class: 'check' }, cb, el('span', { class: 'status-dot', style: { borderColor: pal.status[s.id] } }), el('span', { text: s.label }));
  });
  body.replaceChildren(
    field('Project name', name),
    seg('Units', [['cm', 'cm'], ['ftin', 'ft-in']], p.units, v => store.apply('Change units', s => { s.project.units = v; })),
    seg('Grid size', [[5, '5 cm'], [10, '10 cm'], [25, '25 cm'], [50, '50 cm']], st.grid, v => store.setSetting('grid', v)),
    el('div', { class: 'toggles' },
      tog('snap', 'Snap to grid'), tog('showGrid', 'Show grid'),
      tog('rulers', 'Rulers'), tog('labels', 'Labels and dimensions'),
      tog('clearance', 'Clearance checker'), tog('sketch', 'Sketch style')),
    seg('Theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme, v => store.setSetting('theme', v)),
    el('h3', { class: 'sec-title', html: icon('layers') + '<span>Layers</span>' }),
    el('div', { class: 'toggles' }, ...layerBoxes),
    el('h3', { class: 'sec-title', html: icon('eye') + '<span>Show items by status</span>' }),
    el('div', {}, ...statusBoxes),
    el('p', { class: 'hint', text: 'Outline colors: neutral for keep, blue dashed for move, red dotted for remove, terracotta for to buy, green for bought.' }));
}

/* ---------- right panel ---------- */

function listCtx() {
  return {
    highlightId: ui.highlightId,
    onLocate: (floorId, sel) => {
      if (floorId !== store.floorId) {
        setFloor(floorId);
        setTimeout(() => locate(sel), 80);
      } else locate(sel);
    },
    onGoFloor: id => { setFloor(id); if (isPhone()) closeSheets(); },
    onAddNote: () => { setMode('note'); toast('Tap where the note should go.'); },
    onExportCSV: () => exportCSV(store)
  };
}

function locate(sel) {
  if (!findEntity(store.state, store.floorId, sel)) { toast('This item is hidden or not in the current layout.'); return; }
  ui.highlightId = sel.id;
  canvas.select([sel], true);
  canvas.highlight(sel);
  if (isPhone()) closeSheets();
  renderRight();
}

function renderRight() {
  const rows = store.floor && store.state.floors.flatMap(f => f.scenarios.filter(s => s.id === f.activeScenario).flatMap(s => s.items));
  const counts = {
    shop: rows.filter(i => i.status === 'buy').length,
    remove: rows.filter(i => i.status === 'remove').length,
    todo: store.state.lists.todo.filter(t => !t.done).length,
    notes: store.scenario.notes.length
  };
  $$('[data-rtab]').forEach(b => {
    const t = b.dataset.rtab;
    b.setAttribute('aria-selected', String(t === ui.rtab));
    const label = { item: 'Item', shop: 'Shopping', remove: 'Remove', todo: 'To-do', notes: 'Notes' }[t];
    b.innerHTML = label + (counts[t] ? `<span class="count">${counts[t]}</span>` : '');
  });
  const body = $('#right-body');
  preserveFocus(() => {
    if (ui.rtab === 'item') renderProps(body, store, canvas.selection, ops);
    else if (ui.rtab === 'shop') renderShopping(body, store, listCtx());
    else if (ui.rtab === 'remove') renderRemove(body, store, listCtx());
    else if (ui.rtab === 'todo') renderTodo(body, store, listCtx());
    else renderNotes(body, store, listCtx());
  });
  if (ui.scrollToHl) {
    ui.scrollToHl = false;
    const r = body.querySelector('.row.hl');
    if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function rowExists(sel) {
  if (!sel) return false;
  const f = findEntity(store.state, store.floorId, sel);
  if (!f) return false;
  if (ui.rtab === 'shop') return sel.kind === 'item' && (f.obj.status === 'buy' || f.obj.status === 'bought');
  if (ui.rtab === 'remove') return sel.kind === 'item' && f.obj.status === 'remove';
  if (ui.rtab === 'notes') return sel.kind === 'note';
  return false;
}

function onSelect(selection) {
  const one = selection.length === 1 ? selection[0] : null;
  ui.highlightId = one ? one.id : null;
  if (ui.rtab !== 'item') {
    if (rowExists(one)) ui.scrollToHl = true;
    else if (selection.length && !isPhone()) ui.rtab = 'item';
  }
  if (!selection.length && isPhone() && ui.sheet === 'right' && ui.rtab === 'item') closeSheets();
  renderRight();
  renderTopbar();
}

function onEntityTap(sel) {
  if (!isPhone()) return;
  if (!(ui.sheet === 'right' && ui.rtab === 'item')) openSheet('right', 'item');
  canvas.focusTop(sel, 0.24);
}

/* ------------------------------------------------------------------ */
/* Mode bar, empty state, filter badge, sync chip                      */
/* ------------------------------------------------------------------ */

function mb(label, ic, onClick, { on = false, primary = false, keep = false } = {}) {
  return el('button', { class: 'mb-btn' + (on ? ' on' : '') + (primary ? ' primary' : '') + (keep ? ' keep-label' : ''), html: icon(ic) + `<span>${label}</span>`, 'aria-label': label, title: label, 'aria-pressed': on ? 'true' : null, onclick: onClick });
}

function renderModebar() {
  const bar = $('#modebar'), m = canvas.mode, parts = [];
  if (canvas.compareId) {
    const other = store.floor.scenarios.find(s => s.id === canvas.compareId);
    parts.push(
      el('span', { class: 'mb-msg', text: `Comparing "${store.scenario.name}" (left, editable) with "${other ? other.name : ''}" (view only)` }),
      mb('Swap', 'flip', swapCompare, { keep: true }),
      mb('Stop comparing', 'close', () => { canvas.setCompare(null); renderModebar(); }, { keep: true }));
    if (m !== 'select') parts.push(el('span', { class: 'sep' }));
  }
  if (['wall', 'slope', 'note'].includes(m)) {
    parts.push(
      mb('Tap walls', 'draw', () => setMode('wall'), { on: m === 'wall' }),
      mb('Type lengths', 'keyboard', typeWallsDialog),
      mb('Sloped ceiling', 'slope', () => setMode('slope'), { on: m === 'slope' }),
      mb('Note', 'note', () => setMode('note'), { on: m === 'note' }));
    if (m === 'wall') {
      const n = canvas.drawPts.length;
      parts.push(el('span', { class: 'sep' }), mb('Right angles', 'ortho', () => { canvas.ortho = !canvas.ortho; renderModebar(); }, { on: canvas.ortho }));
      if (n) parts.push(mb('Undo point', 'undo', () => canvas.undoWallPoint()));
      if (n >= 3) parts.push(mb('Close shape', 'polygon', () => canvas.closeWalls()));
      if (n) parts.push(mb('Finish', 'check', () => canvas.finishWalls()));
    }
    parts.push(mb('Done', 'check', () => setMode('select'), { primary: true, keep: true }));
    const msg = {
      wall: canvas.drawPts.length ? 'Tap the next corner. Tap the last point again, or Finish, to end the chain.' : 'Tap the first corner. Points snap to the grid and to wall ends. Two fingers pan and zoom.',
      slope: 'Tap two opposite corners of the sloped ceiling area.',
      note: 'Tap where the sticky note should go.'
    }[m];
    parts.push(el('span', { class: 'mb-msg', text: msg }));
  } else if (m === 'calibrate') {
    parts.push(el('span', { class: 'mb-msg', text: 'Tap two points on the background image that are a known distance apart, for example both ends of a wall.' }), mb('Cancel', 'close', () => setMode('select'), { keep: true }));
  } else if (m === 'movebg') {
    parts.push(el('span', { class: 'mb-msg', text: 'Drag to move the background image.' }), mb('Done', 'check', () => setMode('select'), { primary: true, keep: true }));
  }
  bar.hidden = !parts.length;
  bar.replaceChildren(...parts);
}

function swapCompare() {
  const a = store.floor.activeScenario, b = canvas.compareId;
  canvas.compareId = a;
  canvas.select([], true);
  store.apply('Swap compared layouts', () => { store.floor.activeScenario = b; });
}

function renderEmptyHint() {
  const f = store.floor, box = $('#empty-hint');
  const empty = !f.walls.length && !f.fixed.length && !store.scenario.items.length && !f.background.image;
  const show = empty && canvas.mode === 'select' && !canvas.compareId;
  box.hidden = !show;
  if (!show) return;
  box.replaceChildren(
    el('h2', { text: `No walls on ${f.label} yet` }),
    el('p', { text: 'Enter your exact measurements: type wall lengths and turns, tap corners on the grid, or trace a photo of the floor plan.' }),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', html: icon('keyboard') + '<span>Type lengths</span>', onclick: typeWallsDialog }),
      el('button', { class: 'btn', html: icon('draw') + '<span>Tap corners</span>', onclick: () => setMode('wall') }),
      el('button', { class: 'btn', html: icon('image') + '<span>Trace a photo</span>', onclick: () => { openSheet('left', 'structure'); uploadBackground(); } })));
}

function renderFilterBadge() {
  const st = store.state.settings, b = $('#filter-badge');
  const hiddenStatus = STATUSES.filter(s => st.statusFilter[s.id] === false).length;
  const hiddenLayers = LAYERS.filter(l => st.layers[l.id] === false).length;
  b.hidden = !hiddenStatus && !hiddenLayers;
  if (b.hidden) return;
  b.replaceChildren(
    el('span', { text: [hiddenStatus ? `${hiddenStatus} status${hiddenStatus > 1 ? 'es' : ''} hidden` : '', hiddenLayers ? `${hiddenLayers} layer${hiddenLayers > 1 ? 's' : ''} hidden` : ''].filter(Boolean).join(', ') + '. ' }),
    el('button', { class: 'linklike', 'data-action': 'show-all', text: 'Show all' }));
}

function renderSyncChip(s) {
  const chip = $('#sync-chip');
  chip.hidden = s.state === 'off';
  if (chip.hidden) return;
  chip.className = 'sync-chip ' + s.state;
  let text = { live: 'Live', connecting: 'Connecting', error: 'Sync error' }[s.state] || s.state;
  if (s.state === 'live') {
    const names = s.onlineNames();
    text += names.length ? `: ${names.join(', ')}` : '';
    const at = store.state.meta.updatedAt;
    if (at) text += `. Edited ${timeAgo(at)}${store.state.meta.updatedBy ? ' by ' + store.state.meta.updatedBy : ''}`;
  }
  chip.textContent = text;
  chip.title = s.msg || text;
}

function timeAgo(t) {
  const d = Math.max(0, Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.round(d / 60) + ' min ago';
  if (d < 86400) return Math.round(d / 3600) + ' h ago';
  return new Date(t).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/* Adding things                                                       */
/* ------------------------------------------------------------------ */

function placementPoint() {
  const c = canvas.getViewCenter();
  const n = store.scenario.items.length % 5;
  return { x: c.x + n * 15, y: c.y + n * 15 };
}

function addItem(preset) {
  const it = makeItem(preset, placementPoint(), store.floorId, store.state.settings.newStatus || 'buy');
  store.apply('Add ' + it.name, () => { store.scenario.items.push(it); });
  if (!store.state.settings.layers[it.layer]) store.setSetting('layers', { ...store.state.settings.layers, [it.layer]: true });
  if (!store.state.settings.statusFilter[it.status]) store.setSetting('statusFilter', { ...store.state.settings.statusFilter, [it.status]: true });
  canvas.select([{ kind: 'item', id: it.id }]);
  if (isPhone()) closeSheets();
  toast(`${it.name} added`);
}

function addFixed(preset) {
  if (preset.type === 'stairs') {
    const existing = store.floor.fixed.find(f => f.type === 'stairs');
    if (existing) { toast('The staircase is already on this floor. It is linked to the other floor.'); canvas.select([{ kind: 'fixed', id: existing.id }]); canvas.centerOn({ kind: 'fixed', id: existing.id }); return; }
  }
  const e = makeFixed(preset, placementPoint());
  store.apply('Add ' + e.name, () => { store.floor.fixed.push(e); });
  if (!store.state.settings.layers.structure) store.setSetting('layers', { ...store.state.settings.layers, structure: true });
  canvas.select([{ kind: 'fixed', id: e.id }]);
  if (isPhone()) closeSheets();
  toast(e.type === 'stairs' ? 'Staircase added on both floors' : `${e.name} added. Drag it near a wall to snap.`);
}

/** Parse a typed wall sequence like "412 cm, 90 deg, 356 cm, R, 412". */
function parseSequence(text, units) {
  const tokens = text.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
  const out = [];
  let expect = 'len';
  for (const t of tokens) {
    let m;
    if (/^(r|right)$/i.test(t)) { out.push({ turn: 90 }); expect = 'len'; continue; }
    if (/^(l|left)$/i.test(t)) { out.push({ turn: -90 }); expect = 'len'; continue; }
    if ((m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:deg|degrees|°|d)$/i))) { out.push({ turn: parseFloat(m[1]) }); expect = 'len'; continue; }
    if (expect === 'turn' && /^[+-]?\d+(?:\.\d+)?$/.test(t)) { out.push({ turn: parseFloat(t) }); expect = 'len'; continue; }
    const v = parseLen(t, units);
    if (v == null || v <= 0) return { error: `Could not read "${t}". Use lengths like 412 or 13' 6" and turns like 90 deg, R or L.` };
    out.push({ len: v });
    expect = 'turn';
  }
  return { steps: out };
}

function buildWalls(steps, start, dirDeg, thickness, close) {
  let x = start.x, y = start.y, dir = dirDeg;
  const walls = [];
  for (const s of steps) {
    if (s.turn != null) { dir += s.turn; continue; }
    const r = (dir * Math.PI) / 180;
    const nx = Math.round((x + Math.cos(r) * s.len) * 100) / 100, ny = Math.round((y + Math.sin(r) * s.len) * 100) / 100;
    walls.push({ id: uid('w'), x1: x, y1: y, x2: nx, y2: ny, thickness });
    x = nx; y = ny;
  }
  const gap = Math.hypot(x - start.x, y - start.y);
  if (close && walls.length >= 2 && gap > 0.5) walls.push({ id: uid('w'), x1: x, y1: y, x2: start.x, y2: start.y, thickness });
  return { walls, gap };
}

function typeWallsDialog() {
  const f = store.floor, units = store.units, last = f.walls[f.walls.length - 1];
  const sx = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(last ? last.x2 : 0, units) });
  const sy = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(last ? last.y2 : 0, units) });
  const dir = el('select', {}, ...[[0, 'Right'], [90, 'Down'], [180, 'Left'], [270, 'Up']].map(([v, t]) => el('option', { value: v, text: t })));
  const seq = el('textarea', { rows: 4, placeholder: units === 'ftin' ? '13\' 6", 90 deg, 11\' 8", 90 deg, 13\' 6", 90 deg, 11\' 8"' : '412 cm, 90 deg, 356 cm, 90 deg, 412 cm, 90 deg, 356 cm' });
  const thick = el('input', { type: 'text', inputmode: 'decimal', value: formatLen(store.state.settings.wallThickness || 12, units) });
  const close = el('input', { type: 'checkbox', checked: true });
  const preview = el('p', { class: 'muted', 'aria-live': 'polite', text: 'Enter lengths and turns.' });
  const update = () => {
    const r = parseSequence(seq.value, units);
    if (r.error) { preview.textContent = r.error; preview.className = 'error'; return null; }
    const x = parseLen(sx.value, units), y = parseLen(sy.value, units), t = parseLen(thick.value, units);
    if (x == null || y == null || !(t > 0)) { preview.textContent = 'Check the start point and thickness.'; preview.className = 'error'; return null; }
    const { walls, gap } = buildWalls(r.steps, { x, y }, Number(dir.value), t, close.checked);
    const total = walls.reduce((a, w) => a + Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 0);
    preview.className = 'muted';
    preview.textContent = walls.length
      ? `${walls.length} wall${walls.length > 1 ? 's' : ''}, ${formatLen(total, units)} in total. The typed path ends ${formatLen(gap, units)} from the start${close.checked && gap > 0.5 ? ', so a closing wall is added' : ''}.`
      : 'Enter at least one length.';
    return walls.length ? walls : null;
  };
  [seq, sx, sy, thick, dir, close].forEach(n => n.addEventListener('input', update));
  close.addEventListener('change', update);
  const body = el('div', {},
    el('p', { class: 'hint', text: 'Lengths and turns alternate. Positive turns go clockwise (to the right on screen), negative turns go counterclockwise. You can also type R or L for 90 degree turns. Plain numbers alternate between length and turn.' }),
    field('Sequence', seq),
    el('div', { class: 'grid3' }, field('Start X', sx), field('Start Y', sy), field('First wall goes', dir)),
    el('div', { class: 'grid2' }, field('Wall thickness', thick), el('label', { class: 'check' }, close, el('span', { text: 'Close the shape' }))),
    preview);
  modal({
    title: 'Type wall lengths', body, wide: true,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add walls', primary: true, onClick: () => {
          const walls = update();
          if (!walls) return false;
          store.apply(`Add ${walls.length} walls`, () => { store.floor.walls.push(...walls); });
          setMode('select');
          requestAnimationFrame(() => requestAnimationFrame(() => canvas.fit()));
          toast('Walls added. Tap any wall to type an exact length.');
          return true;
        }
      }
    ]
  });
}

function slopeDialog(rect) {
  const units = store.units;
  const low = el('input', { type: 'text', inputmode: 'decimal', placeholder: units === 'ftin' ? 'e.g. 4\'' : 'e.g. 120' });
  const high = el('input', { type: 'text', inputmode: 'decimal', placeholder: units === 'ftin' ? 'e.g. 8\'' : 'e.g. 240' });
  const side = el('select', {}, ...[['top', 'Top edge'], ['bottom', 'Bottom edge'], ['left', 'Left edge'], ['right', 'Right edge']].map(([v, t]) => el('option', { value: v, text: t })));
  const err = el('p', { class: 'error', role: 'alert' });
  modal({
    title: 'Sloped ceiling heights',
    body: el('div', {},
      el('p', { class: 'muted', text: `Zone ${formatLen(rect.width, units)} by ${formatLen(rect.depth, units)}. Enter the ceiling height at the low edge and at the high edge.` }),
      el('div', { class: 'grid2' }, field('Height at low edge', low), field('Height at high edge', high)),
      field('Which edge is low?', side), err),
    actions: [
      { label: 'Cancel', onClick: () => setMode('select') },
      {
        label: 'Add zone', primary: true, onClick: () => {
          const lo = parseLen(low.value, units), hi = parseLen(high.value, units);
          if (!(lo > 0) || !(hi > 0)) { err.textContent = 'Enter both heights.'; return false; }
          if (hi < lo) { err.textContent = 'The high edge must be at least as high as the low edge.'; return false; }
          const z = { id: uid('sz'), ...rect, rotation: 0, low: lo, high: hi, lowSide: side.value, locked: false };
          store.apply('Add sloped ceiling', () => { store.floor.slopeZones.push(z); });
          setMode('select');
          canvas.select([{ kind: 'slope', id: z.id }]);
          return true;
        }
      }
    ]
  });
}

async function calibrateDialog(a, b) {
  const units = store.units;
  const measured = Math.hypot(b.x - a.x, b.y - a.y);
  if (measured < 1) { toast('The two points are too close together. Try again.', 'error'); return; }
  const v = await promptDialog('Calibrate scale', 'Real distance between the two points', '', { hint: `Currently ${formatLen(measured, units)} on the plan. Type the true distance, for example 412 or 13' 6".` });
  setMode('select');
  if (v == null) return;
  const real = parseLen(v, units);
  if (!(real > 0)) { toast('That distance could not be read.', 'error'); return; }
  const r = real / measured;
  store.apply('Calibrate background', () => {
    const bg = store.floor.background;
    bg.scale *= r;
    bg.offset = { x: a.x - (a.x - bg.offset.x) * r, y: a.y - (a.y - bg.offset.y) * r };
  });
  toast('Background calibrated. Lock it from the Structure tab when it lines up.');
}

async function placeNote(pt) {
  const text = await promptDialog('Sticky note', 'Note', '', { multiline: true, placeholder: 'e.g. Plant shelf here? Check outlet height.' });
  setMode('select');
  if (text == null || !text.trim()) return;
  const n = { id: uid('nt'), x: pt.x, y: pt.y, text: text.trim(), color: '#F3DD9B' };
  store.apply('Add note', () => { store.scenario.notes.push(n); });
  if (!store.state.settings.layers.notes) store.setSetting('layers', { ...store.state.settings.layers, notes: true });
}

/* ------------------------------------------------------------------ */
/* Selection operations                                                */
/* ------------------------------------------------------------------ */

const PREFIX = { item: 'it', fixed: 'fx', slope: 'sz', note: 'nt', wall: 'w' };

function selected() {
  return canvas.selection.map(sel => ({ sel, f: findEntity(store.state, store.floorId, sel) })).filter(x => x.f);
}

const ops = {
  duplicate() {
    const sels = selected().filter(x => x.sel.kind !== 'wall' && !(x.sel.kind === 'fixed' && x.f.obj.linkId));
    if (!sels.length) { toast('Nothing to duplicate here. The staircase and walls cannot be duplicated.'); return; }
    const step = store.state.settings.grid || 25, groupMap = {}, out = [];
    store.apply('Duplicate', () => {
      for (const { sel } of sels) {
        const r = findEntity(store.state, store.floorId, sel);
        if (!r) continue;
        const c = clone(r.obj);
        c.id = uid(PREFIX[sel.kind]);
        delete c.u;
        c.x += step; c.y += step;
        if (c.groupId) c.groupId = groupMap[c.groupId] || (groupMap[c.groupId] = uid('g'));
        r.list.push(c);
        out.push({ kind: sel.kind, id: c.id });
      }
    });
    canvas.select(out);
  },
  remove() {
    const sels = selected();
    if (!sels.length) return;
    store.apply(sels.length > 1 ? `Delete ${sels.length} things` : 'Delete', p => {
      for (const { sel } of sels) {
        const r = findEntity(p, store.floorId, sel);
        if (!r) continue;
        const i = r.list.indexOf(r.obj);
        if (i >= 0) r.list.splice(i, 1);
        delete p.lists.comments[sel.id];
      }
    });
    canvas.select([]);
    toast('Deleted. Undo brings it back.');
  },
  forward() { ops.reorder(1); },
  back() { ops.reorder(-1); },
  reorder(d) {
    const one = selected()[0];
    if (!one || one.sel.kind !== 'item') return;
    store.apply(d > 0 ? 'Bring forward' : 'Send back', () => {
      const list = store.scenario.items, i = list.findIndex(x => x.id === one.sel.id);
      let j = i + d;
      while (j >= 0 && j < list.length && list[j].layer !== list[i].layer) j += d;
      if (j < 0 || j >= list.length) return;
      const [it] = list.splice(i, 1);
      list.splice(j, 0, it);
    });
  },
  toggleLock() {
    const sels = selected().filter(x => x.sel.kind !== 'wall');
    if (!sels.length) return;
    const lock = !sels.every(x => x.f.obj.locked);
    store.apply(lock ? 'Lock' : 'Unlock', p => { for (const { sel } of sels) { const r = findEntity(p, store.floorId, sel); if (r) r.obj.locked = lock; } });
    toast(lock ? 'Locked' : 'Unlocked');
  },
  group() {
    const items = selected().filter(x => x.sel.kind === 'item');
    if (items.length < 2) { toast('Select two or more items to group them.'); return; }
    const g = uid('g');
    store.apply('Group', p => { for (const { sel } of items) { const r = findEntity(p, store.floorId, sel); if (r) r.obj.groupId = g; } });
    toast('Grouped. They now move together.');
  },
  ungroup() {
    const groups = new Set(selected().map(x => x.f.obj.groupId).filter(Boolean));
    if (!groups.size) return;
    store.apply('Ungroup', () => { for (const it of store.scenario.items) if (groups.has(it.groupId)) delete it.groupId; });
    toast('Ungrouped');
  },
  rotate(deg) {
    const sels = selected().filter(x => ['item', 'fixed', 'slope'].includes(x.sel.kind) && !x.f.obj.locked);
    if (!sels.length) return;
    store.apply('Rotate', p => { for (const { sel } of sels) { const r = findEntity(p, store.floorId, sel); if (r) r.obj.rotation = (((r.obj.rotation || 0) + deg) % 360 + 360) % 360; } });
  },
  setStatus(status) {
    const items = selected().filter(x => x.sel.kind === 'item');
    store.apply('Set status', p => { for (const { sel } of items) { const r = findEntity(p, store.floorId, sel); if (r) r.obj.status = status; } });
  },
  nudge(dx, dy) {
    const sels = selected().filter(x => !x.f.obj.locked);
    if (!sels.length) return;
    store.apply('Nudge', p => {
      for (const { sel } of sels) {
        const r = findEntity(p, store.floorId, sel);
        if (!r) continue;
        if (sel.kind === 'wall') { r.obj.x1 += dx; r.obj.x2 += dx; r.obj.y1 += dy; r.obj.y2 += dy; }
        else { r.obj.x += dx; r.obj.y += dy; }
      }
    });
  },
  drawWalls: () => setMode('wall'),
  typeWalls: () => typeWallsDialog()
};

function openEntityMenu(sel, pt) {
  const f = findEntity(store.state, store.floorId, sel);
  if (!f) return;
  const o = f.obj, items = [];
  const showProps = () => { ui.rtab = 'item'; openSheet('right', 'item'); };
  if (sel.kind === 'wall') {
    items.push({ label: 'Edit exact length', icon: 'keyboard', onClick: () => { showProps(); requestAnimationFrame(() => document.querySelector(`[data-fk="${CSS.escape(o.id + 'length')}"]`)?.focus()); } });
  } else {
    items.push({ label: 'Edit details', icon: 'settings', onClick: showProps });
    if (sel.kind === 'item' || (sel.kind === 'fixed' && !o.linkId) || sel.kind === 'note' || sel.kind === 'slope') items.push({ label: 'Duplicate', icon: 'copy', onClick: ops.duplicate });
    if (sel.kind !== 'note') items.push({ label: 'Rotate 90 degrees', icon: 'rotate', onClick: () => ops.rotate(90) });
    if (sel.kind === 'item') {
      items.push({ label: 'Bring forward', icon: 'up', onClick: ops.forward }, { label: 'Send back', icon: 'down', onClick: ops.back });
      items.push({ label: 'Set status', icon: 'lists', onClick: () => contextMenu(pt.x, pt.y, STATUSES.map(s => ({ label: s.label + (o.status === s.id ? ' (current)' : ''), onClick: () => ops.setStatus(s.id) }))) });
      if (o.groupId) items.push({ label: 'Ungroup', icon: 'ungroup', onClick: ops.ungroup });
      else if (canvas.selection.length > 1) items.push({ label: 'Group selected', icon: 'group', onClick: ops.group });
      items.push({ label: 'Comments', icon: 'comment', onClick: () => { showProps(); requestAnimationFrame(() => document.querySelector(`[data-fk="${CSS.escape(o.id + 'comment')}"]`)?.focus()); } });
    }
    if (sel.kind !== 'note') items.push({ label: o.locked ? 'Unlock' : 'Lock', icon: o.locked ? 'unlock' : 'lock', onClick: ops.toggleLock });
  }
  items.push('sep', { label: 'Delete', icon: 'trash', danger: true, onClick: ops.remove });
  contextMenu(pt.x, pt.y, items);
}

/* ------------------------------------------------------------------ */
/* Layouts (scenarios) and compare                                     */
/* ------------------------------------------------------------------ */

function cloneScenario(sc, name) {
  const c = clone(sc);
  c.id = uid('sc');
  c.name = name;
  delete c.u;
  const gmap = {};
  for (const it of c.items) { it.id = uid('it'); delete it.u; if (it.groupId) it.groupId = gmap[it.groupId] || (gmap[it.groupId] = uid('g')); }
  for (const n of c.notes) { n.id = uid('nt'); delete n.u; }
  return c;
}

function scenarioDialog() {
  const body = el('div');
  const draw = () => {
    const f = store.floor;
    const rows = f.scenarios.map(sc => {
      const name = el('input', { type: 'text', value: sc.name, 'aria-label': 'Layout name' });
      name.addEventListener('change', () => store.apply('Rename layout', () => { const s = store.floor.scenarios.find(x => x.id === sc.id); if (s) s.name = name.value.trim() || 'Layout'; }));
      const active = sc.id === f.activeScenario;
      return el('li', { class: 'row' + (active ? ' hl' : '') },
        el('div', { class: 'row-main' }, name,
          active ? el('span', { class: 'pri', text: 'Active' }) : el('button', { class: 'btn small', text: 'Open', onclick: () => { canvas.select([], true); store.apply('Switch layout', () => { store.floor.activeScenario = sc.id; }); draw(); } })),
        el('div', { class: 'btn-row' },
          el('span', { class: 'muted small', text: `${sc.items.length} items, ${sc.notes.length} notes` }),
          el('button', {
            class: 'btn small', html: icon('copy') + '<span>Duplicate</span>', onclick: async () => {
              const n = await promptDialog('Duplicate layout', 'Name for the copy', `${sc.name} copy`);
              if (n == null) return;
              const c = cloneScenario(sc, n.trim() || `${sc.name} copy`);
              store.apply('Duplicate layout', () => { store.floor.scenarios.push(c); store.floor.activeScenario = c.id; });
              draw();
            }
          }),
          !active ? el('button', { class: 'btn small', html: icon('compare') + '<span>Compare</span>', onclick: () => { canvas.setCompare(sc.id); renderModebar(); m.close(); } }) : null,
          f.scenarios.length > 1 ? el('button', {
            class: 'btn small danger', html: icon('trash') + '<span>Delete</span>', onclick: async () => {
              if (!(await confirmDialog(`Delete the layout "${sc.name}" and its ${sc.items.length} items? You can undo this.`, { ok: 'Delete', danger: true }))) return;
              if (canvas.compareId === sc.id) canvas.setCompare(null);
              store.apply('Delete layout', () => {
                const fl = store.floor;
                fl.scenarios = fl.scenarios.filter(x => x.id !== sc.id);
                if (fl.activeScenario === sc.id) fl.activeScenario = fl.scenarios[0].id;
              });
              draw();
            }
          }) : null));
    });
    body.replaceChildren(
      el('p', { class: 'muted', text: 'Each floor can hold several named layouts, such as Current, Option A and Option B. Walls and fixed elements are shared; furniture and notes belong to each layout.' }),
      el('ul', { class: 'rows' }, ...rows),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn', html: icon('add') + '<span>New empty layout</span>', onclick: async () => {
            const n = await promptDialog('New layout', 'Name', `Option ${String.fromCharCode(64 + f.scenarios.length)}`);
            if (n == null) return;
            const sc = newScenario(n.trim() || 'Layout');
            store.apply('New layout', () => { store.floor.scenarios.push(sc); store.floor.activeScenario = sc.id; });
            draw();
          }
        })));
  };
  draw();
  const m = modal({ title: `Layouts for ${store.floor.label}`, body, wide: true, actions: [{ label: 'Done', primary: true }] });
}

function compareDialog() {
  const others = store.floor.scenarios.filter(s => s.id !== store.floor.activeScenario);
  if (!others.length) {
    toast('Create or duplicate a second layout first.');
    scenarioDialog();
    return;
  }
  if (others.length === 1) { canvas.setCompare(others[0].id); renderModebar(); return; }
  const sel = el('select', {}, ...others.map(s => el('option', { value: s.id, text: s.name })));
  modal({
    title: 'Compare layouts', body: field(`Compare "${store.scenario.name}" with`, sel),
    actions: [{ label: 'Cancel' }, { label: 'Compare', primary: true, onClick: () => { canvas.setCompare(sel.value); renderModebar(); } }]
  });
}

/* ------------------------------------------------------------------ */
/* More menu                                                           */
/* ------------------------------------------------------------------ */

function openMore(btn) {
  const r = btn.getBoundingClientRect();
  const items = [
    { label: 'Layouts', icon: 'layers', onClick: scenarioDialog },
    canvas.compareId ? { label: 'Stop comparing', icon: 'compare', onClick: () => { canvas.setCompare(null); renderModebar(); } } : { label: 'Compare layouts', icon: 'compare', onClick: compareDialog },
    { label: 'Structure and background trace', icon: 'image', onClick: () => openSheet('left', 'structure') },
    { label: 'View, units and layers', icon: 'eye', onClick: () => openSheet('left', 'view') },
    { label: store.state.settings.clearance ? 'Hide clearance checker' : 'Show clearance checker', icon: 'warning', onClick: () => action('clearance') },
    isPhone() ? { label: canvas.multi ? 'Multi-select off' : 'Multi-select on', icon: 'copy', onClick: () => action('multi') } : null,
    'sep',
    { label: 'Share link', icon: 'share', onClick: () => createShareLink(store) },
    { label: 'Live sync', icon: 'cloud', onClick: () => syncDialog(store, sync) },
    { label: 'Describe for AI', icon: 'text', onClick: () => describeDialog(store) },
    'sep',
    { label: 'Export PNG', icon: 'image', onClick: () => exportPNG(store) },
    { label: 'Export SVG', icon: 'plan', onClick: () => exportSVG(store) },
    { label: 'Export PDF (plans and shopping list)', icon: 'pdf', onClick: () => exportPDF(store) },
    { label: 'Export shopping list CSV', icon: 'csv', onClick: () => exportCSV(store) },
    'sep',
    { label: 'Save project file', icon: 'download', onClick: () => exportProjectFile(store) },
    { label: 'Open project file', icon: 'upload', onClick: () => importProjectFile(store, afterLoad) },
    { label: 'Restore backup', icon: 'undo', onClick: restoreBackup },
    { label: 'Start a new empty project', icon: 'trash', danger: true, onClick: resetProject },
    'sep',
    installPrompt ? { label: 'Install app', icon: 'download', onClick: install } : null,
    { label: 'Help and tour', icon: 'help', onClick: startTour },
    !isPhone() ? { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: shortcutsDialog } : null
  ].filter(Boolean);
  if (isPhone()) contextMenu(window.innerWidth, window.innerHeight, items);
  else contextMenu(r.right - 240, r.bottom + 6, items);
}

async function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch (e) { /* dismissed */ }
  installPrompt = null;
}

async function restoreBackup() {
  const b = await loadBackup();
  if (!b || !b.project) { toast('No backup yet. A backup is made automatically before you import or open a shared link.'); return; }
  let p;
  try { p = migrate(b.project); } catch (e) { modal({ title: 'Backup unreadable', body: e.message }); return; }
  if (!(await confirmDialog(`Restore the backup from ${new Date(b.savedAt).toLocaleString()}? Your current project becomes the new backup, so you can switch back.`, { ok: 'Restore' }))) return;
  await saveBackup(store.state);
  p.settings = store.state.settings;
  store.replace(p, 'Restore backup');
  afterLoad();
  toast('Backup restored');
}

async function resetProject() {
  if (!(await confirmDialog('Start over with an empty project? The current project is saved as a backup first, and you can restore it from More.', { ok: 'Start over', danger: true }))) return;
  await saveBackup(store.state);
  const p = createEmptyProject();
  p.settings = { ...store.state.settings, floorId: '126' };
  store.replace(p, 'New project');
  afterLoad();
}

function shortcutsDialog() {
  const rows = [
    ['Ctrl or Cmd + Z', 'Undo'], ['Ctrl or Cmd + Shift + Z, or Ctrl + Y', 'Redo'], ['Delete or Backspace', 'Delete selection'],
    ['Ctrl or Cmd + D', 'Duplicate'], ['Ctrl or Cmd + G', 'Group (add Shift to ungroup)'], ['Arrow keys', 'Nudge (Shift for larger steps)'],
    ['R / Shift + R', 'Rotate 15 degrees'], ['L', 'Lock or unlock'], ['V', 'Select tool'], ['W', 'Draw walls'], ['N', 'Sticky note'],
    ['C', 'Clearance checker'], ['F', 'Fit to screen'], ['+ / -', 'Zoom'], ['[ and ]', 'Select previous or next item'],
    ['Shift + click', 'Add to selection'], ['Shift while dragging', 'Free move or rotate without snapping'], ['Escape', 'Cancel drawing or clear selection']
  ];
  modal({ title: 'Keyboard shortcuts', body: el('dl', { class: 'stats' }, ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])) });
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function bindKeys() {
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.modal-back, .ctx-menu, .tour-tip')) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey, lower = k.toLowerCase();
    if (mod && lower === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && lower === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod && lower === 'd') { e.preventDefault(); ops.duplicate(); return; }
    if (mod && lower === 'g') { e.preventDefault(); if (e.shiftKey) ops.ungroup(); else ops.group(); return; }
    if (mod || e.altKey) return;
    const st = store.state.settings;
    const step = st.snap ? st.grid : 1;
    const nudges = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (nudges[k] && canvas.selection.length) {
      e.preventDefault();
      const m = e.shiftKey ? (st.snap ? 4 : 10) : 1;
      ops.nudge(nudges[k][0] * step * m, nudges[k][1] * step * m);
      return;
    }
    switch (k) {
      case 'Delete': case 'Backspace': if (canvas.selection.length) { e.preventDefault(); ops.remove(); } break;
      case 'Escape':
        if (canvas.mode === 'wall' && canvas.drawPts.length) canvas.finishWalls();
        else if (canvas.mode !== 'select') setMode('select');
        else canvas.select([]);
        break;
      case 'r': case 'R': ops.rotate(e.shiftKey ? -15 : 15); break;
      case 'l': case 'L': ops.toggleLock(); break;
      case 'v': case 'V': setMode('select'); break;
      case 'w': case 'W': setMode('wall'); break;
      case 'n': case 'N': setMode('note'); break;
      case 'c': case 'C': action('clearance'); break;
      case 'f': case 'F': canvas.fit(); break;
      case '+': case '=': canvas.zoomBy(1.2); break;
      case '-': case '_': canvas.zoomBy(1 / 1.2); break;
      case '[': case ']': {
        const list = store.scenario.items;
        if (!list.length) break;
        const cur = canvas.selection[0];
        let i = cur ? list.findIndex(x => x.id === cur.id) : -1;
        i = (i + (k === ']' ? 1 : -1) + list.length) % list.length;
        const sel = { kind: 'item', id: list[i].id };
        canvas.select([sel]);
        canvas.centerOn(sel);
        break;
      }
      case '?': shortcutsDialog(); break;
      default: break;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Onboarding tour                                                     */
/* ------------------------------------------------------------------ */

const TOUR = [
  { key: 'floors', title: 'Two floors, one apartment', text: 'Switch between 126 (Lower) and 226 (Upper). The staircase you add is linked and sits in the same spot on both floors.' },
  { key: 'draw', title: 'Draw rooms to scale', text: 'Tap corners on the grid, or type exact lengths and turns. Tap any wall later to type its exact length.' },
  { key: 'library', title: 'Add furniture', text: 'Presets have real sizes you can edit, or make a custom item. Drag to move, use the handles to resize and rotate, and long-press for more.' },
  { key: 'lists', title: 'Lists tied to the plan', text: 'Mark items To Buy and they appear in the shopping list and budget. Get-rid-of, to-do and notes live here too.' },
  { key: 'more', title: 'Layouts, sharing and export', text: 'Save layout options and compare them, share a link, sync live, export a PDF, or describe the plan for an AI assistant. Reopen this tour from Help.' }
];

function startTour() {
  const root = $('#tour-root');
  let i = 0;
  const end = () => {
    root.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', show);
    if (!store.state.settings.tourDone) store.setSetting('tourDone', true);
  };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); i--; show(); }
  }
  const next = () => { if (i < TOUR.length - 1) { i++; show(); } else end(); };
  function show() {
    const step = TOUR[i];
    const target = $$(`[data-tour="${step.key}"]`).find(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && n.closest('.panel:not(.open)') === null) ||
      $$(`[data-tour="${step.key}"]`).find(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && !(isPhone() && n.closest('.panel')));
    const tip = el('div', { class: 'tour-tip', role: 'dialog', 'aria-modal': 'true', 'aria-label': step.title },
      el('h3', { text: step.title }),
      el('p', { text: step.text }),
      el('div', { class: 'tour-foot' },
        el('span', { class: 'tour-step', text: `${i + 1} of ${TOUR.length}` }),
        el('button', { class: 'btn small', text: 'Skip', onclick: end }),
        i > 0 ? el('button', { class: 'btn small', text: 'Back', onclick: () => { i--; show(); } }) : null,
        el('button', { class: 'btn small primary', text: i === TOUR.length - 1 ? 'Done' : 'Next', onclick: next })));
    const nodes = [tip];
    if (target) {
      const r = target.getBoundingClientRect(), pad = 6;
      nodes.unshift(el('div', { class: 'tour-spot', style: { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` } }));
      root.replaceChildren(...nodes);
      const tr = tip.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      let top = r.bottom + 14;
      if (top + tr.height > vh - 12) top = r.top - tr.height - 14;
      tip.style.top = `${Math.max(12, top)}px`;
      tip.style.left = `${Math.max(12, Math.min(vw - tr.width - 12, r.left + r.width / 2 - tr.width / 2))}px`;
    } else {
      root.replaceChildren(el('div', { class: 'tour-spot', style: { left: '50%', top: '50%', width: '0', height: '0' } }), tip);
      const tr = tip.getBoundingClientRect();
      tip.style.top = `${(window.innerHeight - tr.height) / 2}px`;
      tip.style.left = `${(window.innerWidth - tr.width) / 2}px`;
    }
    tip.querySelector('.primary').focus();
  }
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', show);
  show();
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-back"><div class="modal"><div class="modal-head"><h2>Something went wrong</h2></div><div class="modal-body"><p>The app could not start: ${String(err && err.message || err).replace(/[<>&]/g, '')}. Try reloading the page.</p></div></div></div>`);
});
