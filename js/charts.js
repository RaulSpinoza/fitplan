// Tiny SVG chart renderer (no library). Returns an SVG string sized by viewBox → scales to container width.
const W = 340, H = 150, PL = 30, PR = 8, PT = 10, PB = 22;
const f1 = x => Math.round(x * 10) / 10;
const niceStep = x => { const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e; };

/**
 * opt: { labels: [..], yMin, yMax, invert, yFmt, bars: [{values, color}] (stacked), barLine: {values,color} (drawn as tick per bar),
 *        lines: [{values, color, dash, dots}], band: [lo, hi, color], refLine: {y, color}, highlight: index, dots: [{i, y, color}] }
 */
export function chart(opt) {
  const n = opt.labels.length; if (!n) return '';
  const vals = [];
  (opt.bars || []).length && opt.labels.forEach((_, i) => vals.push(opt.bars.reduce((t, b) => t + (b.values[i] || 0), 0)));
  for (const l of opt.lines || []) vals.push(...l.values.filter(v => v != null));
  if (opt.barLine) vals.push(...opt.barLine.values.filter(v => v != null));
  for (const d of opt.dots || []) vals.push(d.y);
  let lo = opt.yMin ?? Math.min(0, ...vals), hi = opt.yMax ?? Math.max(1, ...vals);
  if (opt.yMin == null && opt.invert) lo = Math.min(...vals);
  if (opt.band) { lo = Math.min(lo, opt.band[0]); hi = Math.max(hi, opt.band[1]); }
  if (hi === lo) hi = lo + 1;
  if (opt.yMin == null && opt.invert) { const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad; }
  else if (opt.yMax == null) { const st = niceStep((hi - lo) * 1.05 / 3); hi = lo + 3 * st; }   // round axis: 3 even steps
  const iw = W - PL - PR, ih = H - PT - PB, bw = iw / n;
  const X = i => PL + bw * (i + 0.5);
  const Y = v => opt.invert ? PT + ih * (v - lo) / (hi - lo) : PT + ih * (1 - (v - lo) / (hi - lo));
  const fmt = opt.yFmt || (v => f1(v));
  const s = [`<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">`];
  // grid + y labels (4 ticks)
  const nt = opt.ticks || 3;
  for (let k = 0; k <= nt; k++) {
    const v = lo + (hi - lo) * k / nt, y = Y(v);
    s.push(`<line x1="${PL}" x2="${W - PR}" y1="${f1(y)}" y2="${f1(y)}" class="g"/><text x="${PL - 4}" y="${f1(y + 3)}" class="yl">${fmt(v)}</text>`);
  }
  if (opt.band) s.push(`<rect x="${PL}" width="${iw}" y="${f1(Math.min(Y(opt.band[0]), Y(opt.band[1])))}" height="${f1(Math.abs(Y(opt.band[1]) - Y(opt.band[0])))}" fill="${opt.band[2]}" opacity=".15"/>`);
  if (opt.highlight != null) s.push(`<rect x="${f1(PL + bw * opt.highlight)}" width="${f1(bw)}" y="${PT}" height="${ih}" fill="#ffffff" opacity=".05"/>`);
  // stacked bars
  if (opt.bars) opt.labels.forEach((_, i) => {
    let acc = 0;
    for (const b of opt.bars) {
      const v = b.values[i] || 0; if (v <= 0) continue;
      const y1 = Y(acc + v), y0 = Y(acc); acc += v;
      s.push(`<rect x="${f1(X(i) - bw * 0.34)}" width="${f1(bw * 0.68)}" y="${f1(y1)}" height="${f1(Math.max(0.5, y0 - y1))}" fill="${b.color}" rx="1.5"/>`);
    }
  });
  if (opt.barLine) opt.barLine.values.forEach((v, i) => { if (v) s.push(`<line x1="${f1(X(i) - bw * 0.45)}" x2="${f1(X(i) + bw * 0.45)}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="${opt.barLine.color}" stroke-width="2" stroke-dasharray="3 2"/>`); });
  if (opt.refLine) s.push(`<line x1="${PL}" x2="${W - PR}" y1="${f1(Y(opt.refLine.y))}" y2="${f1(Y(opt.refLine.y))}" stroke="${opt.refLine.color}" stroke-dasharray="4 3"/>`);
  // lines (null breaks the line)
  for (const l of opt.lines || []) {
    let d = '', pen = false;
    l.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`; pen = true; });
    if (d) s.push(`<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''} stroke-linejoin="round"/>`);
    if (l.dots) l.values.forEach((v, i) => { if (v != null) s.push(`<circle cx="${f1(X(i))}" cy="${f1(Y(v))}" r="2.5" fill="${l.color}"/>`); });
  }
  for (const d of opt.dots || []) s.push(`<circle cx="${f1(X(d.i))}" cy="${f1(Y(d.y))}" r="3" fill="${d.color}" opacity=".85"/>`);
  // x labels: at most ~7
  const step = Math.max(1, Math.ceil(n / 7));
  opt.labels.forEach((t, i) => { if ((n - 1 - i) % step === 0) s.push(`<text x="${f1(X(i))}" y="${H - 6}" class="xl">${t}</text>`); });
  s.push('</svg>');
  return s.join('');
}

export const legend = items => `<div class="legend">${items.map(([c, t, dash]) => `<span><i style="background:${dash ? 'none' : c};border-top:${dash ? `2px dashed ${c}` : 'none'}"></i>${t}</span>`).join('')}</div>`;
