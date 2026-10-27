// Turns decoded FIT messages into a compact activity summary (raw records are discarded).
import { FIT_EPOCH } from './fit.js';
import { iso } from './util.js';

const SPORT = { 1: 'run', 2: 'bike', 4: 'strength', 10: 'strength', 11: 'walk', 17: 'hike', 5: 'swim' };
const SUB = { 1: 'treadmill', 2: 'street', 3: 'trail', 6: 'indoor', 20: 'strength', 26: 'cardio' };
const toDate = ts => new Date((ts + FIT_EPOCH) * 1000);
const r1 = x => Math.round(x * 10) / 10;

export const zoneOf = (hr, Z) => hr <= Z[0] ? 0 : hr <= Z[1] ? 1 : hr <= Z[2] ? 2 : hr <= Z[3] ? 3 : 4;

export function summarize(m, athlete, fileName = '') {
  const s = (m[18] || [])[0];
  if (!s) throw new Error('No session data in file');
  const start = s[2] ?? m[0]?.[0]?.[4];
  const recs = (m[20] || []).filter(r => r[253] != null).sort((a, b) => a[253] - b[253]);
  const type = SPORT[s[5]] || 'other';
  const end = s[253] ?? (start + Math.round((s[7] || 0) / 1000));

  // Timer pauses: stop (event_type 1/4) … start (0) of timer events (event 0)
  const pauses = []; let stopAt = null;
  for (const e of (m[21] || []).filter(e => e[0] === 0).sort((a, b) => a[253] - b[253])) {
    if (e[1] === 1 || e[1] === 4) stopAt ??= e[253];
    else if (e[1] === 0 && stopAt != null) { pauses.push([stopAt, e[253]]); stopAt = null; }
  }
  const paused = t => pauses.some(([a, b]) => t >= a && t < b);

  // Time in zone (time-weighted, Δt capped at 30 s, pauses excluded) + Banister TRIMP
  const Z = athlete.zones, hrr = hr => Math.min(1, Math.max(0, (hr - athlete.hr_rest) / (athlete.hr_max - athlete.hr_rest)));
  const zs = [0, 0, 0, 0, 0]; let trimp = 0;
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k], hr = r[3];
    if (hr == null || paused(r[253])) continue;
    const dt = Math.min(30, k + 1 < recs.length ? recs[k + 1][253] - r[253] : 1);
    if (dt <= 0) continue;
    zs[zoneOf(hr, Z)] += dt;
    const x = hrr(hr); trimp += dt / 60 * x * 0.64 * Math.exp(1.92 * x);
  }

  // 30 s bins → HR/speed series and aerobic marker (pace at HR Z1+3 … Z2 upper, flat, ≥ 5 min)
  const bins = new Map();
  for (const r of recs) {
    if (paused(r[253])) continue;
    const b = Math.floor((r[253] - start) / 30);
    const o = bins.get(b) || { hr: [], d0: null, d1: null, a0: null, a1: null };
    if (r[3] != null) o.hr.push(r[3]);
    const dist = r[5] != null ? r[5] / 100 : null, alt = r[78] != null ? r[78] / 5 - 500 : r[2] != null ? r[2] / 5 - 500 : null;
    if (dist != null) { o.d0 ??= dist; o.d1 = dist; }
    if (alt != null) { o.a0 ??= alt; o.a1 = alt; }
    bins.set(b, o);
  }
  const hr30 = [], spd30 = [], easy = [];
  for (const [, o] of [...bins].sort((a, b) => a[0] - b[0])) {
    const h = o.hr.length ? o.hr.reduce((a, c) => a + c, 0) / o.hr.length : null;
    const dd = o.d1 != null ? o.d1 - o.d0 : null, v = dd != null ? dd / 30 : null;
    hr30.push(h ? Math.round(h) : null); spd30.push(v != null ? Math.round(v * 100) / 100 : null);
    const flat = o.a0 == null || dd < 20 || Math.abs(o.a1 - o.a0) / dd <= 0.01;
    if (type === 'run' && h >= Z[0] + 3 && h <= Z[1] && v > 1.5 && flat) easy.push(v);
  }
  easy.sort((a, b) => a - b);
  const easyPace = easy.length >= 10 ? 1000 / 60 / easy[Math.floor(easy.length / 2)] : null;

  const dist = s[9] ? s[9] / 1e5 : 0, moving = (s[8] ?? s[7] ?? 0) / 60000;
  const startD = toDate(start);
  return {
    id: `a-${start}`, start: startD.toISOString(), start_ts: start, end_ts: end, date: iso(startD),
    type, subtype: SUB[s[6]] || null, file: fileName,
    elapsed_min: r1((s[7] || 0) / 60000), moving_min: r1(moving),
    distance_km: dist ? Math.round(dist * 100) / 100 : null,
    pace_min_km: type === 'run' && dist > 0.2 ? Math.round(moving / dist * 100) / 100 : null,
    avg_hr: s[16] ?? null, max_hr: s[17] ?? null, ascent_m: s[22] ?? null,
    cadence_spm: type === 'run' && s[18] ? s[18] * 2 : null, kcal: s[11] ?? null,
    has_gps: recs.some(r => r[0] != null),
    zone_min: zs.map(x => r1(x / 60)), trimp: Math.round(trimp),
    easy_pace_min_km: easyPace ? Math.round(easyPace * 100) / 100 : null,
    laps: (m[19] || []).map(l => ({ min: r1((l[8] ?? l[7] ?? 0) / 60000), km: l[9] ? Math.round(l[9] / 1000) / 100 : null, avg_hr: l[15] ?? null, max_hr: l[16] ?? null })),
    hr30, spd30,
    session_id: null, role: null, manual: false, imported_at: new Date().toISOString()
  };
}
