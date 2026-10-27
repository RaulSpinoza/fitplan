// Date & formatting helpers. Data uses ISO yyyy-mm-dd; UI shows DD-MMM-YYYY.
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const fmt = s => { const d = parse(s); return `${pad(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()}`; };
export const fmtShort = s => { const d = parse(s); return `${WD[d.getDay()]} ${pad(d.getDate())}-${MON[d.getMonth()]}`; };
export const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
export const isoWeek = s => { const t = parse(s); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7); const w1 = new Date(t.getFullYear(), 0, 4, 12);
  return `${t.getFullYear()}-W${pad(1 + Math.round(((t - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7))}`; };
export const hhmm = isoTs => { const d = new Date(isoTs); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtPace = minPerKm => { if (!minPerKm) return ''; let m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${pad(s)}`; };
export const r1 = x => Math.round(x * 10) / 10;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
