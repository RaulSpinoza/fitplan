// Activity ↔ planned session matching and status proposal (pure functions).

// Compatible planned session types per activity type, in order of preference.
export const COMPAT = {
  run: ['run', 'race', 'ocr'], bike: ['bike'], strength: ['strength', 'ocr', 'mobility'],
  walk: ['mobility', 'race', 'other'], hike: ['run', 'race', 'other'], swim: ['other'],
  other: ['other', 'ocr', 'race', 'mobility', 'strength']
};
const compat = t => COMPAT[t] || COMPAT.other;

export const isDuplicate = (a, list) => list.some(b => b.type === a.type && Math.abs(b.start_ts - a.start_ts) <= 60);

/** dayActs: all activities of one date; daySessions: planned sessions that date.
 *  Manual assignments are kept. Returns {actId: {session_id, role}}. */
export function autoAssign(dayActs, daySessions) {
  const plan = daySessions.filter(s => s.type !== 'rest');
  const acts = [...dayActs].sort((a, b) => a.start_ts - b.start_ts);
  const res = {}, used = new Set();
  for (const a of acts) if (a.manual) { res[a.id] = { session_id: a.session_id, role: a.role }; if (a.session_id) used.add(a.session_id); }
  for (const a of acts) {
    if (a.manual) continue;
    const pref = compat(a.type), c = plan.filter(s => pref.includes(s.type));
    if (!c.length) { res[a.id] = { session_id: null, role: null }; continue; }
    c.sort((x, y) => (used.has(x.id) - used.has(y.id)) || (pref.indexOf(x.type) - pref.indexOf(y.type)) ||
      (Math.abs((x.duration_min || 0) - a.moving_min) - Math.abs((y.duration_min || 0) - a.moving_min)));
    res[a.id] = { session_id: c[0].id, role: null }; used.add(c[0].id);
  }
  // Warm-up rule: short run (< 15 min) directly followed (≤ 30 min) by an activity on a strength/OCR session.
  acts.forEach((a, k) => {
    if (a.manual || a.type !== 'run' || a.moving_min >= 15) return;
    const nx = acts[k + 1]; if (!nx || nx.start_ts - a.end_ts > 1800) return;
    const ns = plan.find(s => s.id === res[nx.id]?.session_id);
    if (!ns || !['strength', 'ocr', 'mobility'].includes(ns.type)) return;
    const own = plan.find(s => s.id === res[a.id].session_id);
    if (!own || (own.duration_min || 0) >= 2 * a.moving_min) res[a.id] = { session_id: ns.id, role: 'warmup' };
  });
  return res;
}

/** Proposed status for a session from its linked activities. */
export function proposeStatus(session, acts) {
  if (!acts.length) return null;
  const moving = acts.reduce((t, a) => t + a.moving_min, 0), planned = session.duration_min || 0;
  const durOk = !planned || moving >= 0.8 * planned;
  const zs = [0, 0, 0, 0, 0];
  acts.filter(a => a.role !== 'warmup').forEach(a => a.zone_min.forEach((z, i) => zs[i] += z));
  const tot = zs.reduce((t, z) => t + z, 0), tz = session.target?.hr_zone;
  let zoneOk = true, zoneTxt = '';
  if (tz && tot > 0) {
    if (tz <= 2) { const above = zs.slice(tz).reduce((t, z) => t + z, 0) / tot; zoneOk = above <= 0.2; zoneTxt = `${Math.round(above * 100)}% above Z${tz}`; }
    else { const at = zs.slice(tz - 1).reduce((t, z) => t + z, 0) / tot; zoneOk = at >= 0.15; zoneTxt = `${Math.round(at * 100)}% in Z${tz}+`; }
  }
  const reason = [`${Math.round(moving)}${planned ? '/' + planned : ''} min`, zoneTxt].filter(Boolean).join(' · ');
  return { status: durOk && zoneOk ? 'done' : 'modified', reason };
}
