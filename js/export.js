/**
 * export.js
 * Exports: PNG and SVG of the current floor (with dimensions and a legend),
 * a printable PDF (one page per floor plus the shopping list, via jsPDF),
 * and the shopping list as CSV.
 */
import { download, loadScript, CDN, toast } from './ui.js';
import { activeScenario, formatLen, formatMoney, STATUSES, STATUS_LABEL } from './state.js';
import { PALETTES, svgCss, renderWorld, renderBackground, contentBounds, s } from './canvas.js';
import { shoppingRows, budgetSummary } from './lists.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Build a standalone SVG element for a floor and scenario. */
export function buildExportSvg(store, floor, scenario = activeScenario(floor), target = 1600) {
  const p = store.state, pal = PALETTES.light, units = p.project.units;
  const b = contentBounds(floor, scenario) || { minX: 0, minY: 0, maxX: 600, maxY: 450 };
  const pad = 40;
  const bw = b.maxX - b.minX + pad * 2, bh = b.maxY - b.minY + pad * 2;
  const k = clamp(target / Math.max(bw, bh), 0.3, 6);
  const head = 64, foot = 76, W = Math.round(Math.max(bw * k, 640)), H = Math.round(bh * k + head + foot);
  const svg = s('svg', { xmlns: 'http://www.w3.org/2000/svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: p.settings.sketch ? 'sketch' : '' });
  s('style', {}, svg).textContent = svgCss(pal, 1 / k) + `.t1{font:600 20px Inter,system-ui,sans-serif;fill:${pal.label}}.t2{font:400 13px Inter,system-ui,sans-serif;fill:${pal.sub}}.lg{font:500 12px Inter,system-ui,sans-serif;fill:${pal.label}}`;
  s('rect', { width: W, height: H, fill: '#FBF8F3' }, svg);
  s('text', { class: 't1', x: 24, y: 32 }, svg).textContent = `${p.project.name}: ${floor.label}`;
  s('text', { class: 't2', x: 24, y: 52 }, svg).textContent = `Layout "${scenario.name}". Exported ${new Date().toLocaleDateString()}. Units: ${units === 'ftin' ? 'feet and inches' : 'centimeters'}.`;
  const offX = (W - (b.maxX - b.minX + pad * 2) * k) / 2;
  const plan = s('g', { transform: `translate(${offX} ${head}) scale(${k}) translate(${-b.minX + pad} ${-b.minY + pad})` }, svg);
  const bg = s('g', {}, plan);
  renderBackground(bg, floor, p.settings);
  const world = s('g', { class: 'world' }, plan);
  const rc = p.settings.sketch && window.rough ? window.rough.svg(svg) : null;
  renderWorld(world, floor, scenario, { pal, settings: p.settings, units, rc, prefix: 'x', floorId: floor.id, noteScale: 1 });

  const ly = H - foot + 24;
  let x = 24;
  for (const st of STATUSES) {
    s('rect', { x, y: ly - 10, width: 18, height: 12, rx: 2, fill: '#E8DFD0', stroke: pal.status[st.id], 'stroke-width': 2, 'stroke-dasharray': st.id === 'move' ? '4 3' : st.id === 'remove' ? '2 2' : null }, svg);
    const t = s('text', { class: 'lg', x: x + 24, y: ly }, svg);
    t.textContent = st.label;
    x += 24 + st.label.length * 7 + 18;
  }
  const barCm = units === 'ftin' ? 91.44 : 100;
  const barPx = barCm * k, bx = W - 24 - barPx, by = ly + 22;
  s('path', { d: `M${bx} ${by}h${barPx}M${bx} ${by - 5}v10M${bx + barPx} ${by - 5}v10`, stroke: pal.label, 'stroke-width': 2, fill: 'none' }, svg);
  s('text', { class: 'lg', x: bx + barPx / 2, y: by - 8, 'text-anchor': 'middle' }, svg).textContent = units === 'ftin' ? "3'" : '1 m';
  s('text', { class: 't2', x: 24, y: ly + 26 }, svg).textContent = 'Red dashed outlines mark clearance or ceiling problems. Wall labels show interior lengths as drawn.';
  return { svg, W, H };
}

function svgString(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

/** Rasterize an SVG element to a PNG data URL. */
function rasterize(svg, W, H, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString(svg));
    img.onload = () => {
      try {
        const sc = Math.min(scale, 4096 / Math.max(W, H));
        const c = document.createElement('canvas');
        c.width = Math.round(W * sc);
        c.height = Math.round(H * sc);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#FBF8F3';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('The plan image could not be drawn.'));
    img.src = url;
  });
}

const fname = (store, ext) => `${store.floor.id}-${activeScenario(store.floor).name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`;

export function exportSVG(store) {
  const { svg } = buildExportSvg(store, store.floor);
  download(fname(store, 'svg'), svgString(svg), 'image/svg+xml');
  toast('SVG saved');
}

export async function exportPNG(store) {
  try {
    const { svg, W, H } = buildExportSvg(store, store.floor);
    const data = await rasterize(svg, W, H);
    const blob = await (await fetch(data)).blob();
    download(fname(store, 'png'), blob, 'image/png');
    toast('PNG saved');
  } catch (e) { toast('PNG export failed: ' + e.message, 'error'); }
}

export async function exportPDF(store) {
  try {
    toast('Preparing PDF');
    await loadScript(CDN.jspdf);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 36;
    const p = store.state;
    let first = true;
    for (const floor of p.floors) {
      if (!first) doc.addPage('letter', 'landscape');
      first = false;
      const { svg, W, H } = buildExportSvg(store, floor, activeScenario(floor), 1800);
      const png = await rasterize(svg, W, H, 1.6);
      const k = Math.min((PW - 2 * M) / W, (PH - 2 * M) / H);
      doc.addImage(png, 'PNG', (PW - W * k) / 2, (PH - H * k) / 2, W * k, H * k);
    }
    doc.addPage('letter', 'portrait');
    const W2 = doc.internal.pageSize.getWidth(), H2 = doc.internal.pageSize.getHeight();
    const sum = budgetSummary(p), b = p.project.budget;
    let y = M + 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(`Shopping list: ${p.project.name}`, M, y);
    y += 20;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Planned ${formatMoney(sum.planned)} (bought ${formatMoney(sum.spent)}). Budget ${formatMoney(b.min)} to ${formatMoney(b.max)}.`, M, y);
    y += 22;
    const cols = [['Bought', 44], ['Item', 150], ['Room', 40], ['Size', 120], ['Priority', 50], ['Store', 70], ['Price', 60]];
    const header = () => {
      doc.setFont('helvetica', 'bold');
      let x = M;
      for (const [t, w] of cols) { doc.text(t, x, y); x += w; }
      doc.setDrawColor(180); doc.line(M, y + 4, W2 - M, y + 4);
      y += 16;
      doc.setFont('helvetica', 'normal');
    };
    header();
    const units = p.project.units;
    const rows = shoppingRows(p).sort((a, c) => (a.item.room || '').localeCompare(c.item.room || ''));
    if (!rows.length) doc.text('No items are marked To Buy yet.', M, y);
    for (const { item: it, floor } of rows) {
      if (y > H2 - M) { doc.addPage('letter', 'portrait'); y = M + 10; header(); }
      const vals = [it.status === 'bought' ? '[x]' : '[ ]', it.name, it.room || floor.id,
        `${formatLen(it.width, units)} x ${formatLen(it.depth, units)}`, it.priority, it.store || '', it.price != null ? formatMoney(it.price) : ''];
      let x = M;
      vals.forEach((v, i) => {
        const w = cols[i][1];
        const t = doc.splitTextToSize(String(v), w - 6)[0] || '';
        doc.text(t, x, y);
        x += w;
      });
      y += 15;
    }
    download(`room-plan-${new Date().toISOString().slice(0, 10)}.pdf`, doc.output('blob'), 'application/pdf');
    toast('PDF saved');
  } catch (e) { toast('PDF export failed: ' + e.message, 'error'); }
}

export function exportCSV(store) {
  const p = store.state, units = p.project.units;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Name', 'Room', 'Width', 'Depth', 'Height', 'Status', 'Priority', 'Price (USD)', 'Store', 'Link', 'Notes'];
  const lines = [head.map(esc).join(',')];
  for (const { item: it, floor } of shoppingRows(p)) {
    lines.push([it.name, it.room || floor.id, formatLen(it.width, units), formatLen(it.depth, units), formatLen(it.height, units),
      STATUS_LABEL[it.status], it.priority, it.price ?? '', it.store, it.link, it.notes].map(esc).join(','));
  }
  download(`shopping-list-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  toast('CSV saved');
}
