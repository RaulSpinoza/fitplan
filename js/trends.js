// Trend series for the Trends tab (pure functions, testable in Node).
import { addDays, daysBetween, mondayOf, isoWeek, r1 } from './util.js';

const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
const DONE = ['done', 'modified'];

/** Weekly aggregates for nWeeks ending with the week containing `to`. */
export function weeklySeries({ acts, sessions, logs, checkins, to, nWeeks }) {
  const last = mondayOf(to), out = [];
  for (let k = nWeeks - 1; k >= 0; k--) {
    const ws = addDays(last, -7 * k), we = addDays(ws, 6), w = d => d >= ws && d <= we;
    const wa = acts.filter(a => w(a.date)), runs = wa.filter(a => a.type === 'run');
    const ps = sessions.filter(s => w(s.date) && s.type !== 'rest'), planned = sum(ps, s => s.duration_min);
    const done = sum(ps.filter(s => DONE.includes(logs[s.id]?.status)), s => s.duration_min);
    const wc = checkins.filter(c => w(c.date));
    const zone_h = [0, 1, 2, 3, 4].map(i => sum(wa, a => a.zone_min?.[i]) / 60);
    out.push({
      ws, week: isoWeek(ws), current: ws === last,
      hours: sum(wa, a => a.moving_min) / 60, zone_h, planned_h: planned / 60,
      compliance: planned ? Math.round(100 * done / planned) : null,
      run_km: sum(runs, a => a.distance_km), ascent_m: sum(wa, a => a.ascent_m), trimp: sum(wa, a => a.trimp),
      easy_pace: median(runs.map(a => a.easy_pace_min_km)),
      max_pain: wc.length ? Math.max(0, ...wc.flatMap(c => (c.pain || []).map(p => p.score))) : null,
      rhr: avg(wc.map(c => c.rhr)), sleep_h: avg(wc.map(c => c.sleep_h))
    });
  }
  return out;
}

/** Daily load: acute = 7-day TRIMP sum, chronic = 28-day sum ÷ 4, ACWR once ≥ 28 days of history. */
export function loadSeries({ acts, from, to }) {
  const byDay = {};
  for (const a of acts) byDay[a.date] = (byDay[a.date] || 0) + (a.trimp || 0);
  const first = acts.map(a => a.date).sort()[0];
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let acute = 0, chronic = 0;
    for (let k = 0; k < 28; k++) { const v = byDay[addDays(d, -k)] || 0; chronic += v; if (k < 7) acute += v; }
    chronic /= 4;
    const hist = first && first <= d ? daysBetween(first, d) + 1 : 0;
    out.push({ date: d, trimp: byDay[d] || 0, acute, chronic: r1(chronic), acwr: hist >= 28 && chronic > 0 ? Math.round(acute / chronic * 100) / 100 : null });
  }
  return out;
}

/** Aerobic marker points (easy pace at Z2 HR on flat runs) + rolling median of the last 4 runs. */
export function easyPaceSeries({ acts, from, to }) {
  const pts = acts.filter(a => a.type === 'run' && a.easy_pace_min_km && a.date >= from && a.date <= to)
    .sort((a, b) => a.start_ts - b.start_ts).map(a => ({ date: a.date, pace: a.easy_pace_min_km }));
  pts.forEach((p, i) => { p.trend = median(pts.slice(Math.max(0, i - 3), i + 1).map(x => x.pace)); });
  return pts;
}

/** Daily wellness from check-ins. */
export function wellnessSeries({ checkins, from, to }) {
  const by = Object.fromEntries(checkins.map(c => [c.date, c])), out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = by[d];
    out.push({ date: d, pain: c ? Math.max(0, ...(c.pain || []).map(p => p.score)) : null, rhr: c?.rhr ?? null, sleep_h: c?.sleep_h ?? null });
  }
  return out;
}

/** Headline comparisons: last 4 complete weeks vs. the 4 before (current week excluded). */
export function headline(weeks, pace) {
  const full = weeks.filter(w => !w.current), a = full.slice(-4), b = full.slice(-8, -4);
  const m = (ws, f) => ws.length ? avg(ws.map(f)) : null;
  const pa = median(pace.slice(-4).map(p => p.pace)), pb = median(pace.slice(-8, -4).map(p => p.pace));
  const z = a.reduce((t, w) => t.map((v, i) => v + w.zone_h[i]), [0, 0, 0, 0, 0]), zt = z.reduce((x, y) => x + y, 0);
  return {
    hours: m(a, w => w.hours), hours_prev: m(b, w => w.hours),
    run_km: m(a, w => w.run_km), run_km_prev: m(b, w => w.run_km),
    compliance: m(a.filter(w => w.compliance != null), w => w.compliance),
    easy_pace: pa, easy_pace_prev: pb,
    low_pct: zt ? Math.round(100 * (z[0] + z[1]) / zt) : null    // share of time in Z1–Z2 (polarisation check)
  };
}
