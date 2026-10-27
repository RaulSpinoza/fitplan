// Progress report for Copilot: fitplan.progress/1.0 (JSON) + compact Markdown. Pure functions.
import { addDays, daysBetween, mondayOf, isoWeek, fmt, fmtShort, fmtPace, r1 } from './util.js';

export const PSCHEMA = 'fitplan.progress/1.0';
export const PAIN_LOCS = { r_foot: 'R foot/heel', l_foot: 'L foot/heel', r_calf: 'R calf', l_calf: 'L calf', r_knee: 'R knee', l_knee: 'L knee',
  r_hip: 'R hip', l_hip: 'L hip', low_back: 'Low back', shoulder: 'Shoulder', hand: 'Hand/grip', other: 'Other' };

const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const addZ = acts => acts.reduce((z, a) => z.map((v, i) => r1(v + (a.zone_min?.[i] || 0))), [0, 0, 0, 0, 0]);
const avg = a => { const v = a.filter(x => x != null); return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null; };

function actual(acts) {
  if (!acts.length) return null;
  const mov = sum(acts, a => a.moving_min), km = sum(acts, a => a.distance_km), runs = acts.filter(a => a.type === 'run');
  const runMov = sum(runs, a => a.moving_min), runKm = sum(runs, a => a.distance_km);
  const hrW = acts.filter(a => a.avg_hr), hrMov = sum(hrW, a => a.moving_min);
  return {
    activities: acts.map(a => ({ start: a.start, type: a.type, subtype: a.subtype, role: a.role || 'main', moving_min: a.moving_min })),
    moving_min: r1(mov), distance_km: km ? r1(km) : null,
    pace_min_km: runKm > 0.2 ? fmtPace(runMov / runKm) : null,
    avg_hr: hrMov ? Math.round(sum(hrW, a => a.avg_hr * a.moving_min) / hrMov) : null,
    max_hr: Math.max(0, ...acts.map(a => a.max_hr || 0)) || null,
    ascent_m: sum(acts, a => a.ascent_m) || null,
    zone_min: addZ(acts), trimp: sum(acts, a => a.trimp)
  };
}

/** Pain flags: any score ≥ 3, or same location ≥ 1 on 5+ consecutive check-in days. */
export function painFlags(checkins) {
  const flags = [], byLoc = {};
  for (const c of [...checkins].sort((a, b) => a.date.localeCompare(b.date)))
    for (const p of c.pain || []) {
      if (p.score >= 3) flags.push(`${fmt(c.date)}: ${PAIN_LOCS[p.loc] || p.loc} pain ${p.score}/10`);
      if (p.score >= 1) (byLoc[p.loc] ||= []).push(c.date);
    }
  for (const [loc, ds] of Object.entries(byLoc)) {
    let run = 1, best = 1, bestEnd = ds[0];
    for (let i = 1; i < ds.length; i++) { run = daysBetween(ds[i - 1], ds[i]) === 1 ? run + 1 : 1; if (run > best) { best = run; bestEnd = ds[i]; } }
    if (best >= 5) flags.push(`${PAIN_LOCS[loc] || loc}: pain on ${best} consecutive days (until ${fmt(bestEnd)})`);
  }
  return flags;
}

/** ACWR (TRIMP): acute 7-day load ÷ chronic 28-day weekly average, ending at `to`. */
export function loadRatio(allActs, to) {
  const inRange = (a, d) => a.date > addDays(to, -d) && a.date <= to;
  const acute = sum(allActs.filter(a => inRange(a, 7)), a => a.trimp), chronic = sum(allActs.filter(a => inRange(a, 28)), a => a.trimp) / 4;
  const first = allActs.filter(a => a.date <= to).map(a => a.date).sort()[0];
  const hist = first ? daysBetween(first, to) + 1 : 0;           // ACWR needs 28 days of history to be meaningful
  return { acute_7d: acute, chronic_28d_weekly: Math.round(chronic), history_days: hist,
    acwr: chronic && hist >= 28 ? Math.round(acute / chronic * 100) / 100 : null };
}

export function buildProgress({ from, to, todayStr, sessions, logs, acts, checkins, races, plan, athlete, appVersion }) {
  const inWin = d => d >= from && d <= to;
  const ci = Object.fromEntries(checkins.filter(c => inWin(c.date)).map(c => [c.date, c]));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ss = sessions.filter(s => s.date === d).map(s => {
      const log = logs[s.id] || {}, a = acts.filter(x => x.session_id === s.id);
      let status = log.status || 'pending';
      if (s.type === 'rest' && status === 'pending') status = 'rest';
      else if (status === 'pending' && d < todayStr) status = 'missed';
      return { plan_id: s.id, title: s.title, status, status_source: log.status && log.status !== 'pending' ? (log.auto ? 'auto' : 'user') : null,
        planned: { type: s.type, subtype: s.subtype || null, duration_min: s.duration_min || null, distance_km: s.distance_km || null, hr_zone: s.target?.hr_zone || null },
        actual: actual(a), user_note: log.note || null };
    });
    const extras = acts.filter(a => a.date === d && !a.session_id).map(a => ({ type: a.type, subtype: a.subtype, ...actual([a]) }));
    const c = ci[d];
    if (ss.length || extras.length || c) days.push({ date: d, sessions: ss, extras, checkin: c ? { rpe: c.rpe ?? null, sleep_h: c.sleep_h ?? null, sleep_q: c.sleep_q ?? null, energy: c.energy ?? null, rhr: c.rhr ?? null, pain: c.pain || [], note: c.note || null } : null });
  }
  const weeks = [];
  for (let ws = mondayOf(from); ws <= to; ws = addDays(ws, 7)) {
    const a = ws < from ? from : ws, b = addDays(ws, 6) > to ? to : addDays(ws, 6), w = d => d >= a && d <= b;
    const wa = acts.filter(x => w(x.date)), runs = wa.filter(x => x.type === 'run');
    const ps = sessions.filter(s => w(s.date) && s.type !== 'rest'), planned = sum(ps, s => s.duration_min);
    const dn = sum(ps.filter(s => ['done', 'modified'].includes(logs[s.id]?.status)), s => s.duration_min);
    const wc = checkins.filter(c => w(c.date));
    weeks.push({ week: isoWeek(ws), from: a, to: b, partial: a !== ws || b !== addDays(ws, 6),
      sessions_planned: ps.length, sessions_done: ps.filter(s => ['done', 'modified'].includes(logs[s.id]?.status)).length,
      planned_min: planned, compliance_pct: planned ? Math.round(100 * dn / planned) : null,
      moving_h: r1(sum(wa, x => x.moving_min) / 60), run_km: r1(sum(runs, x => x.distance_km)), ascent_m: sum(wa, x => x.ascent_m),
      zone_min: addZ(wa), trimp: sum(wa, x => x.trimp),
      easy_pace_min_km: fmtPace(median(runs.map(x => x.easy_pace_min_km))) || null,
      avg_rpe: avg(wc.map(c => c.rpe)), avg_sleep_h: avg(wc.map(c => c.sleep_h)), avg_rhr: avg(wc.map(c => c.rhr)),
      max_pain: wc.length ? Math.max(0, ...wc.flatMap(c => (c.pain || []).map(p => p.score))) : null });
  }
  const winSessions = days.flatMap(d => d.sessions);
  return {
    schema: PSCHEMA, generated_at: new Date().toISOString(), app_version: appVersion,
    plan_version: plan?.plan_version ?? null, window: { from, to, days: daysBetween(from, to) + 1 },
    athlete,
    next_races: races.filter(r => r.date >= to).slice(0, 5).map(r => ({ id: r.id, name: r.name, date: r.date, days_to_go: daysBetween(to, r.date), priority: r.priority || null })),
    summary: {
      sessions_planned: winSessions.filter(s => s.planned.type !== 'rest').length,
      done: winSessions.filter(s => s.status === 'done').length, modified: winSessions.filter(s => s.status === 'modified').length,
      skipped: winSessions.filter(s => s.status === 'skipped').length, missed: winSessions.filter(s => s.status === 'missed').length,
      checkin_days: Object.keys(ci).length, load: loadRatio(acts, to), flags: painFlags(Object.values(ci))
    },
    weeks, days
  };
}

const zTxt = z => z.map(v => Math.round(v)).join('/');
export function toMarkdown(p) {
  const L = [], s = p.summary;
  L.push(`# FitPlan progress ${fmt(p.window.from)} – ${fmt(p.window.to)} (${p.window.days} days)`);
  L.push(`Plan v${p.plan_version ?? '-'} · HRmax ${p.athlete.hr_max} · HRrest ${p.athlete.hr_rest} · Zones Z1≤${p.athlete.zones[0]}, Z2≤${p.athlete.zones[1]}, Z3≤${p.athlete.zones[2]}, Z4≤${p.athlete.zones[3]}, Z5>${p.athlete.zones[3]}`);
  if (p.next_races.length) L.push(`Next races: ${p.next_races.slice(0, 3).map(r => `${r.name} ${fmt(r.date)} (${r.days_to_go} d)`).join('; ')}`);
  L.push('', '## Summary');
  L.push(`Sessions: ${s.sessions_planned} planned · ${s.done} done · ${s.modified} modified · ${s.skipped} skipped · ${s.missed} missed · check-ins ${s.checkin_days}/${p.window.days}`);
  L.push(`Load (TRIMP): last 7 d ${s.load.acute_7d} · 28-d weekly avg ${s.load.chronic_28d_weekly} · ACWR ${s.load.acwr ?? `n/a (${s.load.history_days} d history, needs 28)`}`);
  L.push(`Flags: ${s.flags.length ? s.flags.join('; ') : 'none'}`);
  L.push('', '## Weeks', '| Week | Compl. | Hours | Run km | D+ | TRIMP | Zone min Z1–Z5 | Easy pace | RPE | Sleep h | RHR | Max pain |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w of p.weeks) L.push(`| ${w.week}${w.partial ? '*' : ''} | ${w.compliance_pct ?? '-'}% | ${w.moving_h} | ${w.run_km} | ${w.ascent_m} | ${w.trimp} | ${zTxt(w.zone_min)} | ${w.easy_pace_min_km ?? '-'} | ${w.avg_rpe ?? '-'} | ${w.avg_sleep_h ?? '-'} | ${w.avg_rhr ?? '-'} | ${w.max_pain ?? '-'} |`);
  if (p.weeks.some(w => w.partial)) L.push('*partial week');
  L.push('', '## Days');
  const act = a => a ? [`${Math.round(a.moving_min)}′`, a.distance_km && `${a.distance_km} km`, a.pace_min_km && `${a.pace_min_km}/km`, a.avg_hr && `HR ${a.avg_hr}/${a.max_hr}`, a.ascent_m && `D+ ${a.ascent_m}`, `Z ${zTxt(a.zone_min)}`, `TRIMP ${a.trimp}`].filter(Boolean).join(', ') : '';
  for (const d of p.days) {
    const parts = [];
    for (const x of d.sessions) parts.push(x.planned.type === 'rest' && !x.actual ? `${x.title} → ${x.status}${x.user_note ? ` – "${x.user_note}"` : ''}` : `${x.title} [${x.planned.duration_min ?? '-'}′${x.planned.hr_zone ? ' Z' + x.planned.hr_zone : ''}] → ${x.status}${x.actual ? ': ' + act(x.actual) : ''}${x.user_note ? ` – "${x.user_note}"` : ''}`);
    for (const e of d.extras) parts.push(`EXTRA ${e.type}: ${act(e)}`);
    const c = d.checkin;
    if (c) parts.push(`Check-in: ${[c.rpe != null && `RPE ${c.rpe}`, c.sleep_h != null && `sleep ${c.sleep_h} h${c.sleep_q ? ` (q${c.sleep_q})` : ''}`, c.energy != null && `energy ${c.energy}/5`, c.rhr && `RHR ${c.rhr}`,
      c.pain.length ? 'pain ' + c.pain.map(x => `${PAIN_LOCS[x.loc] || x.loc} ${x.score}`).join(', ') : 'no pain', c.note && `"${c.note}"`].filter(Boolean).join(', ')}`);
    L.push(`- **${fmtShort(d.date)}**: ${parts.join(' | ')}`);
  }
  return L.join('\n');
}

export const ASSESS_PROMPT = `Assess my progress using this FitPlan progress report (schema fitplan.progress/1.0).
Report: (1) compliance & load trend vs. plan, (2) aerobic marker (easy pace at Z2 HR), (3) intensity distribution vs. target,
(4) pain/recovery flags, (5) readiness for the next race. Then tell me if the plan needs changes; if yes, output an updated
plan as ONE JSON code block in schema fitplan.plan/1.0 (plan_version = current + 1, valid_from = first changed date,
only sessions from valid_from onward, keep race IDs).`;
