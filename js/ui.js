/**
 * ui.js
 * Small DOM helpers shared by every module: element builder, line icons,
 * modal dialogs, toasts, context menus, file download and lazy script loading.
 */

/** Line icons (24 x 24, stroked with currentColor). */
export const ICONS = {
  select: 'M5 3l14 8-6.2 1.8L11 19z',
  draw: 'M4 18L10 6l10 8',
  add: 'M12 5v14M5 12h14',
  lists: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  zoomIn: 'M10.5 3.5a7 7 0 100 14 7 7 0 000-14zM20.5 20.5l-5-5M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 3.5a7 7 0 100 14 7 7 0 000-14zM20.5 20.5l-5-5M7.5 10.5h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  lock: 'M6 11h12v9H6zM8 11V7a4 4 0 018 0v4',
  unlock: 'M6 11h12v9H6zM8 11V7a4 4 0 017.6-1.8',
  rotate: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  group: 'M3 3h8v8H3zM13 13h8v8h-8zM7 11v4a2 2 0 002 2h4',
  ungroup: 'M3 3h8v8H3zM13 13h8v8h-8z',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
  download: 'M4 17v3h16v-3M12 4v12M7 11l5 5 5-5',
  upload: 'M4 17v3h16v-3M12 16V4M7 9l5-5 5 5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3 3.9M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 004.5-1.1M9.9 9.9a3 3 0 004.2 4.2',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  comment: 'M4 5h16v11H9l-5 4z',
  help: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 9.2a2.6 2.6 0 115 1c-.6 1.2-2.5 1.6-2.5 3.3M12 17h.01',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  cloud: 'M7 18h10a4 4 0 00.6-8A6 6 0 006 9.3 4.4 4.4 0 007 18z',
  compare: 'M4 4h16v16H4zM12 4v16',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  search: 'M10.5 3.5a7 7 0 100 14 7 7 0 000-14zM20.5 20.5l-5-5',
  text: 'M4 6h16M4 10h16M4 14h10M4 18h7',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  sidebarLeft: 'M4 4h16v16H4zM9 4v16',
  sidebarRight: 'M4 4h16v16H4zM15 4v16',
  stairs: 'M4 20h4v-4h4v-4h4V8h4V4',
  door: 'M6 20V4h9v16M3 20h18M12 12h.01',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  slope: 'M3 19L21 7v12z',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 16a4 4 0 100-8 4 4 0 000 8z',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  polygon: 'M5 5h14v14H5z',
  ortho: 'M5 19V5M5 19h14',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM3 21a6 6 0 0112 0M16 3.1a4 4 0 010 7.8M21 21a6 6 0 00-4-5.7',
  plan: 'M3 4h18v16H3zM3 12h7M13 4v8M13 16v4M10 12v8',
  folder: 'M3 6h6l2 2h10v11H3z',
  pdf: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  csv: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h6M9 15h6M9 18h4',
  flip: 'M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5'
};

/** Return inline SVG markup for an icon. */
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name] || ''}"/></svg>`;
}

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'htmlFor', 'indeterminate', 'multiple']);

/** Build an HTML element: el('button', { class, text, onclick }, ...children). */
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : String(c));
  }
  return e;
}

/** Labeled form field wrapper. */
export function field(label, control, hint) {
  const id = control.id || ('f_' + Math.random().toString(36).slice(2, 9));
  control.id = id;
  return el('div', { class: 'field' },
    el('label', { htmlFor: id, text: label }),
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null);
}

let toastTimer = null;
/** Show a short status message at the bottom of the screen. */
export function toast(msg, kind = 'info', ms = 2800) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.replaceChildren(el('div', { class: 'toast ' + kind, role: 'status', text: msg }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.replaceChildren(), ms);
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Open a modal dialog.
 * actions: [{ label, primary, danger, onClick }] where onClick may return false to keep it open.
 */
export function modal({ title, body, actions = [{ label: 'Close' }], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const content = el('div', { class: 'modal-body' });
  if (body) content.append(body.nodeType ? body : el('p', { text: String(body) }));
  const foot = el('div', { class: 'modal-foot' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', 'aria-label': 'Close dialog', html: icon('close'), onclick: () => close() })),
    content, foot);
  const back = el('div', { class: 'modal-back' }, box);
  let closed = false;
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll(FOCUSABLE)].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  for (const a of actions) {
    foot.append(el('button', {
      class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
      text: a.label,
      onclick: async () => {
        const r = a.onClick ? await a.onClick() : undefined;
        if (r !== false) close();
      }
    }));
  }
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  requestAnimationFrame(() => {
    const first = box.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || box.querySelector('.modal-foot .primary') || box.querySelector(FOCUSABLE);
    if (first) first.focus();
  });
  return { close, box, content };
}

/** Yes or no question. Resolves to true when confirmed. */
export function confirmDialog(message, { title = 'Please confirm', ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title, body: message,
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: ok, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

/** Ask for a single text value. Resolves to the string, or null when cancelled. */
export function promptDialog(title, label, value = '', { placeholder = '', multiline = false, hint = '' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = multiline
      ? el('textarea', { rows: 4, placeholder, value })
      : el('input', { type: 'text', placeholder, value, autocomplete: 'off' });
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title, body: field(label, input, hint),
      actions: [
        { label: 'Cancel', onClick: () => finish(null) },
        { label: 'OK', primary: true, onClick: () => finish(input.value) }
      ],
      onClose: () => finish(null)
    });
    if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); m.close(); } });
  });
}

/** Floating context menu at a screen point. items: [{ label, icon, onClick, danger }] or 'sep'. */
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach(n => n.remove());
  const menu = el('div', { class: 'ctx-menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { menu.append(el('div', { class: 'ctx-sep', role: 'separator' })); continue; }
    menu.append(el('button', {
      class: 'ctx-item' + (it.danger ? ' danger' : ''), role: 'menuitem',
      html: (it.icon ? icon(it.icon) : '') + `<span>${escapeHtml(it.label)}</span>`,
      onclick: () => { cleanup(); it.onClick && it.onClick(); }
    }));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';
  const btns = [...menu.querySelectorAll('button')];
  btns[0] && btns[0].focus();
  function onDown(e) { if (!menu.contains(e.target)) cleanup(); }
  function onKey(e) {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return cleanup;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Save a Blob or string as a file. */
export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const scriptCache = new Map();
/** Load a classic script from a CDN once. */
export function loadScript(url) {
  if (scriptCache.has(url)) return scriptCache.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { scriptCache.delete(url); reject(new Error('Could not load ' + url + '. Check your connection.')); };
    document.head.append(s);
  });
  scriptCache.set(url, p);
  return p;
}

export const CDN = {
  lz: 'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  rough: 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js'
};

/** Pick a file from disk. Resolves to a File or null. */
export function pickFile(accept) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** Copy text to the clipboard with a textarea fallback. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
  try {
    const ta = el('textarea', { value: text, style: { position: 'fixed', left: '-9999px' } });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
