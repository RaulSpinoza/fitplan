import * as db from './db.js';
import { validatePlan, mergePlan, SCHEMA } from './plan.js';
import { decode, isFit } from './fit.js';
import { summarize } from './metrics.js';
import { autoAssign, proposeStatus, isDuplicate } from './match.js';
import { buildProgress, toMarkdown, PAIN_LOCS, ASSESS_PROMPT } from './progress.js';
import { today, addDays, daysBetween, fmt, fmtShort, mondayOf, hhmm, fmtPace, r1, esc } from './util.js';

const APP_VERSION = '1.2.0-M3';
const DEFAULT_ATHLETE = { hr_max: 168, hr_rest: 46, zones: [117, 130, 142, 154] };
const ICON = { run: '🏃', bike: '🚴', strength: '🏋️', ocr: '🧗', mobility: '🧘', rest: '😴', race: '🏁', walk: '🚶', hike: '🥾', swim: '🏊', other: '•' };
const ST = { pending: '○', done: '✔', modified: '◐', skipped: '✕' };

const S = { tab: 'today', day: today(), weekStart: mondayOf(today()), sessions: [], logs: {}, races: [], plans: [], acts: [], checkins: {},
  athlete: DEFAULT_ATHLETE, pendingImport: null, fitStage: null, lastBackup: null, backupFile: null,
  ciOpen: false, repWin: '14', report: null, lastExport: null };
const $ = sel => document.querySelector(sel);
const view = () => $('#view');

async function load() {
  S.sessions = (await db.all('sessions')).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  S.logs = Object.fromEntries((await db.all('logs')).map(l => [l.id, l]));
  S.races = (await db.all('races')).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  S.plans = (await db.all('plans')).sort((a, b) => a.plan_version - b.plan_version);
  S.acts = (await db.all('activities')).sort((a, b) => a.start_ts - b.start_ts);
  S.checkins = Object.fromEntries((await db.all('checkins')).map(c => [c.date, c]));
  S.athlete = await db.getMeta('athlete', DEFAULT_ATHLETE);
  S.lastBackup = await db.getMeta('last_backup', null);
  S.lastExport = await db.getMeta('last_export', null);
}
const currentPlan = () => S.plans[S.plans.length - 1];
const statusOf = id => S.logs[id]?.status || 'pending';
const sessionsOn = d => S.sessions.filter(s => s.date === d);
const actsOf = sid => S.acts.filter(a => a.session_id === sid);
const extrasOn = d => S.acts.filter(a => a.date === d && !a.session_id);
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const zoneLabel = z => { const Z = S.athlete.zones; const lo = [0, Z[0] + 1, Z[1] + 1, Z[2] + 1, Z[3] + 1][z - 1], hi = [Z[0], Z[1], Z[2], Z[3], null][z - 1];
  return `Z${z} ${hi ? (z === 1 ? '≤' + hi : lo + '–' + hi) : '≥' + lo}`; };
const phaseOn = d => (currentPlan()?.phases || []).find(p => p.from <= d && d <= p.to);
const nextRaces = d => S.races.filter(r => r.date >= d);
const sumZones = acts => acts.reduce((z, a) => z.map((v, i) => v + (a.zone_min?.[i] || 0)), [0, 0, 0, 0, 0]);

// ---------- rendering ----------
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  ({ today: renderToday, week: renderWeek, races: renderRaces, report: renderReport, import: renderImport, settings: renderSettings })[S.tab]();
  refreshBanner();
  window.scrollTo(0, 0);
}

function refreshBanner() {
  const b = $('#banner'); if (b.dataset.update) return;
  const due = S.sessions.length && (!S.lastBackup || daysBetween(S.lastBackup, today()) >= 7);
  b.innerHTML = due && S.tab !== 'settings' ? `<button data-tab="settings">💾 Last backup: ${S.lastBackup ? fmt(S.lastBackup) : 'never'} – tap to back up</button>` : '';
}

function zoneBar(zs) {
  const tot = zs.reduce((a, b) => a + b, 0); if (!tot) return '';
  return `<div class="zbar">${zs.map((z, i) => z / tot >= 0.005 ? `<span class="z${i + 1}" style="width:${100 * z / tot}%">${z / tot >= 0.12 ? Math.round(100 * z / tot) + '%' : ''}</span>` : '').join('')}</div>`;
}

function actSummary(a, withTime = true) {
  const p = [withTime && `${hhmm(a.start)}`, `${Math.round(a.moving_min)} min`, a.distance_km && `${a.distance_km} km`,
    a.pace_min_km && `${fmtPace(a.pace_min_km)}/km`, a.avg_hr && `♥ ${a.avg_hr}/${a.max_hr}`, a.ascent_m && `↗ ${a.ascent_m} m`, `TRIMP ${a.trimp}`].filter(Boolean);
  return `${ICON[a.type] || '•'} ${a.role === 'warmup' ? '<i>warm-up</i> · ' : ''}${p.join(' · ')}`;
}

function countdown(d) {
  const nr = nextRaces(d); if (!nr.length) return '';
  const first = nr[0], same = nr.filter(r => r.date <= addDays(first.date, 1) && r.location === first.location);
  const n = daysBetween(d, first.date);
  return `<div class="card hero"><div class="big">${n === 0 ? 'Race day!' : n + ' days'}</div>
    <div>to ${esc(first.location || first.name)} · ${same.map(r => esc(r.format ? cap(r.format) : r.name)).join(' + ')}</div>
    <div class="muted">${fmt(first.date)}</div></div>`;
}

function blockLine(b) {
  const parts = [];
  if (b.name) parts.push(`<b>${esc(b.name)}</b>`); else if (b.kind) parts.push(`<b>${esc(b.kind)}</b>`);
  if (b.reps && !b.sets) parts.push(`${b.reps}×`);
  if (b.sets) parts.push(`${b.sets}×${b.reps ? b.reps : ''}${b.duration_s ? b.duration_s + 's' : ''}${b.distance_m ? b.distance_m + 'm' : ''}`);
  if (b.duration_min) parts.push(`${b.duration_min} min`);
  if (b.distance_km) parts.push(`${b.distance_km} km`);
  if (b.hr_zone) parts.push(`<span class="z z${b.hr_zone}">${zoneLabel(b.hr_zone)}</span>`);
  if (b.pace) parts.push(`@ ${esc(b.pace)}/km`);
  if (b.load_kg) parts.push(`${b.load_kg} kg`);
  if (b.rest_s) parts.push(`rest ${b.rest_s}s`);
  if (b.rest_min) parts.push(`rest ${b.rest_min} min`);
  if (b.note) parts.push(`<span class="muted">${esc(b.note)}</span>`);
  return `<li>${parts.join(' ')}</li>`;
}

function sessionCard(s) {
  const st = statusOf(s.id), log = S.logs[s.id], t = s.target || {}, acts = actsOf(s.id);
  const meta = [s.duration_min && `${s.duration_min} min`, s.distance_km && `${s.distance_km} km`, t.hr_zone && `<span class="z z${t.hr_zone}">${zoneLabel(t.hr_zone)}</span>`, t.pace_min_km && `${esc(t.pace_min_km)}/km`, t.rpe && `RPE ${t.rpe}`].filter(Boolean).join(' · ');
  return `<div class="card sess st-${st}">
    <div class="sh"><span class="ico">${ICON[s.type] || '•'}</span><div class="grow"><div class="title">${esc(s.title)}</div><div class="muted">${meta}</div></div><span class="stb">${ST[st]}</span></div>
    ${s.blocks?.length ? `<ul class="blocks">${s.blocks.map(blockLine).join('')}</ul>` : ''}
    ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
    ${acts.length ? `<div class="actual"><div class="ah">⌚ Actual${log?.auto ? ` <span class="muted small">· auto: ${esc(log.status)} (${esc(log.reason || '')})</span>` : ''}</div>
      ${acts.map(a => `<div class="al">${actSummary(a)}</div>`).join('')}${zoneBar(sumZones(acts.filter(a => a.role !== 'warmup')))}</div>` : ''}
    ${log?.note ? `<div class="lognote">📝 ${esc(log.note)}</div>` : ''}
    <div class="acts">${['done', 'modified', 'skipped'].map(x => `<button data-act="status" data-id="${esc(s.id)}" data-st="${x}" class="${st === x ? 'sel ' + x : ''}">${ST[x]} ${x}</button>`).join('')}
      <button data-act="note" data-id="${esc(s.id)}">📝</button></div>
  </div>`;
}

// ---------- daily check-in ----------
const opt = (vals, sel, lbl = v => v) => vals.map(v => `<option value="${v}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${lbl(v)}</option>`).join('');
const range = (a, b) => [...Array(b - a + 1)].map((_, i) => a + i);
function painRow(p = { loc: 'r_foot', score: 1 }) {
  return `<div class="prow"><select class="ploc">${opt(Object.keys(PAIN_LOCS), p.loc, k => PAIN_LOCS[k])}</select>
    <select class="pscore">${opt(range(0, 10), p.score, v => v + '/10')}</select><button class="x" data-act="pdel">✕</button></div>`;
}
function checkinSummary(c) {
  const p = [c.rpe != null && `RPE ${c.rpe}`, c.sleep_h != null && `😴 ${c.sleep_h} h${c.sleep_q ? ' · q' + c.sleep_q : ''}`, c.energy != null && `⚡ ${c.energy}/5`, c.rhr && `♥ ${c.rhr}`].filter(Boolean).join(' · ');
  const pain = (c.pain || []).filter(x => x.score > 0);
  return `<div>${p || '<span class="muted">–</span>'}</div><div class="${pain.some(x => x.score >= 3) ? 'warn' : pain.length ? 'mild' : 'okt'}">${pain.length ? '🩹 ' + pain.map(x => `${esc(PAIN_LOCS[x.loc] || x.loc)} ${x.score}/10`).join(', ') : '✓ no pain'}</div>${c.note ? `<div class="muted small">📝 ${esc(c.note)}</div>` : ''}`;
}
function checkinCard(d) {
  if (d > today()) return '';
  const c = S.checkins[d];
  if (!S.ciOpen) return c ? `<div class="card ci"><div class="sh"><b class="grow">🩺 Check-in</b><button class="mini" data-act="ciopen">Edit</button></div>${checkinSummary(c)}</div>`
    : `<div class="card ci"><button class="primary" data-act="ciopen">🩺 Daily check-in</button></div>`;
  const prev = c || S.checkins[addDays(d, -1)] || {};      // prefill pain from yesterday to make tracking fast
  return `<div class="card ci"><b>🩺 Check-in · ${fmtShort(d)}</b>
    <label>Day RPE (effort 1–10)<select id="ci_rpe"><option value="">–</option>${opt(range(1, 10), c?.rpe)}</select></label>
    <label>Sleep (h)<input id="ci_sleep" type="number" inputmode="decimal" step="0.25" min="0" max="14" value="${c?.sleep_h ?? ''}"></label>
    <label>Sleep quality<select id="ci_sq"><option value="">–</option>${opt(range(1, 5), c?.sleep_q, v => v + '/5')}</select></label>
    <label>Energy<select id="ci_en"><option value="">–</option>${opt(range(1, 5), c?.energy, v => v + '/5')}</select></label>
    <label>Resting HR<input id="ci_rhr" type="number" inputmode="numeric" min="30" max="120" value="${c?.rhr ?? ''}"></label>
    <div class="ph"><b>Pain</b><span class="muted small">${!c && prev.pain?.length ? 'pre-filled from yesterday' : '0 = gone'}</span></div>
    <div id="painlist">${(prev.pain || []).map(painRow).join('')}</div>
    <button data-act="padd">➕ Add pain location</button>
    <textarea id="ci_note" placeholder="Note (e.g. compression socks, how the foot felt)">${esc(c?.note || '')}</textarea>
    <div class="acts"><button class="primary" data-act="cisave">Save</button><button data-act="ciclose">Cancel</button></div></div>`;
}
async function saveCheckin() {
  const num = id => { const v = $(id).value; return v === '' ? null : +v; };
  const pain = [...document.querySelectorAll('.prow')].map(r => ({ loc: r.querySelector('.ploc').value, score: +r.querySelector('.pscore').value }))
    .filter((p, i, a) => a.findIndex(q => q.loc === p.loc) === i);
  const c = { date: S.day, rpe: num('#ci_rpe'), sleep_h: num('#ci_sleep'), sleep_q: num('#ci_sq'), energy: num('#ci_en'), rhr: num('#ci_rhr'),
    pain, note: $('#ci_note').value.trim(), updated_at: new Date().toISOString() };
  await db.put('checkins', c); S.checkins[c.date] = c; S.ciOpen = false; toast('Check-in saved'); render();
}

function renderToday() {
  const d = S.day, list = sessionsOn(d), ph = phaseOn(d), extras = extrasOn(d);
  const raceToday = S.races.filter(r => r.date === d);
  view().innerHTML = `
    <div class="daynav"><button data-act="day" data-n="-1">‹</button>
      <div class="grow center"><div class="title">${d === today() ? 'Today' : fmtShort(d)}</div><div class="muted">${fmt(d)}${ph ? ' · ' + esc(ph.name) : ''}</div></div>
      <button data-act="day" data-n="1">›</button></div>
    ${d !== today() ? `<button class="link" data-act="day" data-n="0">Back to today</button>` : ''}
    ${countdown(d)}
    ${raceToday.map(r => `<div class="card race-today">🏁 <b>${esc(r.name)}</b></div>`).join('')}
    ${list.length ? list.map(sessionCard).join('') : `<div class="card empty">${S.sessions.length ? 'No session planned. Rest day.' : 'No plan loaded yet. Go to <b>Import</b> to load a plan from Copilot.'}</div>`}
    ${extras.length ? `<div class="card extra"><b>➕ Unplanned workouts</b>${extras.map(a => `<div class="al">${actSummary(a)}</div>${zoneBar(a.zone_min)}`).join('')}<div class="muted small">Assign them in Import → Imported workouts.</div></div>` : ''}
    ${checkinCard(d)}
    ${ph?.focus ? `<div class="muted small">Phase focus: ${esc(ph.focus)}</div>` : ''}`;
}

function renderWeek() {
  const ws = S.weekStart, we = addDays(ws, 6), days = [...Array(7)].map((_, i) => addDays(ws, i));
  let plan = 0, done = 0;
  const wActs = S.acts.filter(a => a.date >= ws && a.date <= we);
  const rows = days.map(d => {
    const list = sessionsOn(d), races = S.races.filter(r => r.date === d), ex = extrasOn(d), c = S.checkins[d];
    list.forEach(s => { if (s.type !== 'rest') { plan += s.duration_min || 0; if (['done', 'modified'].includes(statusOf(s.id))) done += s.duration_min || 0; } });
    const line = s => { const am = actsOf(s.id).reduce((t, a) => t + a.moving_min, 0);
      return `<div class="wi st-${statusOf(s.id)}">${ICON[s.type] || '•'} ${esc(s.title)} <span class="muted">${s.duration_min ? s.duration_min + '′' : ''}${am ? ' → ' + Math.round(am) + '′' : ''}</span> <span class="stb">${ST[statusOf(s.id)]}</span></div>`; };
    const mp = c ? Math.max(0, ...(c.pain || []).map(p => p.score)) : null;
    return `<div class="wrow ${d === today() ? 'now' : ''}" data-act="goto" data-d="${d}">
      <div class="wd">${fmtShort(d)}${c ? `<div class="cidot ${mp >= 3 ? 'warn' : mp > 0 ? 'mild' : 'okt'}">🩺${mp ? ' ' + mp : ''}</div>` : ''}</div>
      <div class="grow">${races.map(r => `<div class="wi">🏁 ${esc(r.name)}</div>`).join('')}${list.map(line).join('')}${ex.map(a => `<div class="wi muted">➕ ${ICON[a.type] || '•'} ${Math.round(a.moving_min)}′ unplanned</div>`).join('') || (list.length || races.length ? '' : '<span class="muted">–</span>')}</div></div>`;
  }).join('');
  const actH = wActs.reduce((t, a) => t + a.moving_min, 0) / 60, runKm = wActs.filter(a => a.type === 'run').reduce((t, a) => t + (a.distance_km || 0), 0);
  const asc = wActs.reduce((t, a) => t + (a.ascent_m || 0), 0), trimp = wActs.reduce((t, a) => t + a.trimp, 0);
  const ph = phaseOn(ws) || phaseOn(we);
  view().innerHTML = `
    <div class="daynav"><button data-act="week" data-n="-7">‹</button>
      <div class="grow center"><div class="title">Week of ${fmt(ws)}</div><div class="muted">${ph ? esc(ph.name) : ''}</div></div>
      <button data-act="week" data-n="7">›</button></div>
    ${ws !== mondayOf(today()) ? `<button class="link" data-act="week" data-n="0">This week</button>` : ''}
    <div class="card"><div class="stats"><div><div class="big">${r1(plan / 60)} h</div><div class="muted">planned</div></div>
      <div><div class="big">${r1(actH)} h</div><div class="muted">actual</div></div>
      <div><div class="big">${plan ? Math.round(100 * done / plan) : 0}%</div><div class="muted">compliance</div></div></div>
      <div class="stats"><div><div class="mid">${r1(runKm)} km</div><div class="muted">run</div></div><div><div class="mid">${asc} m</div><div class="muted">D+</div></div><div><div class="mid">${trimp}</div><div class="muted">TRIMP</div></div></div>
      ${zoneBar(sumZones(wActs))}</div>
    <div class="card">${rows}</div>
    <div class="muted small">Compliance = planned minutes of sessions marked done/modified ÷ planned minutes. 🩺 = check-in (number = max pain).</div>`;
}

function renderRaces() {
  const t = today(), groups = [];
  for (const r of S.races) {
    const g = groups.find(g => g.location === r.location && daysBetween(g.end, r.date) <= 2);
    if (g) { g.races.push(r); g.end = r.date; } else groups.push({ location: r.location, country: r.country, start: r.date, end: r.date, races: [r] });
  }
  const phases = currentPlan()?.phases || [];
  view().innerHTML = `<h2>2027 Races (${S.races.length})</h2>
    ${groups.map(g => { const n = daysBetween(t, g.start), past = n < 0;
      return `<div class="card ${past ? 'past' : ''}"><div class="sh"><div class="grow"><div class="title">${esc(g.location)} ${g.country ? `<span class="muted">${esc(g.country)}</span>` : ''}</div>
        <div class="muted">${fmt(g.start)}${g.end !== g.start ? ' – ' + fmt(g.end) : ''}</div></div><div class="dleft">${past ? 'done' : n + ' d'}</div></div>
        ${g.races.map(r => `<div class="rrow"><span>${fmtShort(r.date)}</span><b>${esc(r.format ? cap(r.format) : r.name)}</b>
          <span class="muted">${[r.distance_km && r.distance_km + ' km', r.elevation_m && r.elevation_m + ' m D+'].filter(Boolean).join(' · ')}</span>
          ${r.priority ? `<span class="prio p${esc(r.priority)}">${esc(r.priority)}</span>` : ''}</div>`).join('')}</div>`; }).join('') || '<div class="card empty">No races yet. They come with the plan import.</div>'}
    ${phases.length ? `<h2>Phases</h2><div class="card">${phases.map(p => `<div class="rrow ${p.from <= t && t <= p.to ? 'now' : ''}"><b>${esc(p.name)}</b><span class="muted">${fmt(p.from)} – ${fmt(p.to)}</span></div><div class="muted small pad">${esc(p.focus || '')}</div>`).join('')}</div>` : ''}`;
}

// ---------- Report tab (progress export for Copilot) ----------
function reportWindow() {
  const to = today(), cp = currentPlan();
  if (S.repWin === 'plan' && cp) return { from: cp.valid_from > to ? to : cp.valid_from, to };
  return { from: addDays(to, -(+S.repWin || 14) + 1), to };
}
function prepareReport() {
  const { from, to } = reportWindow();
  const p = buildProgress({ from, to, todayStr: today(), sessions: S.sessions, logs: S.logs, acts: S.acts, checkins: Object.values(S.checkins),
    races: S.races, plan: currentPlan(), athlete: S.athlete, appVersion: APP_VERSION });
  const md = toMarkdown(p), tag = `${from}_${to}`;
  S.report = { p, md, json: JSON.stringify(p, null, 1),
    mdFile: new File([md], `progress_${tag}.md`, { type: 'text/plain' }),
    jsonFile: new File([JSON.stringify(p, null, 1)], `progress_${tag}.json`, { type: 'application/json' }) };
}
function renderReport() {
  prepareReport();
  const { p, md } = S.report, s = p.summary, cp = currentPlan();
  view().innerHTML = `<h2>Progress report</h2>
    <div class="card">
      <label>Period<select id="repwin">${opt(['7', '14', '28', ...(cp ? ['plan'] : [])], S.repWin, v => v === 'plan' ? `Since plan v${cp.plan_version} (${fmt(cp.valid_from)})` : `Last ${v} days`)}</select></label>
      <div class="muted small">${fmt(p.window.from)} – ${fmt(p.window.to)}${S.lastExport ? ` · last export ${fmt(S.lastExport)}` : ''}</div>
      <div class="stats"><div><div class="mid">${s.done + s.modified}/${s.sessions_planned}</div><div class="muted">sessions</div></div>
        <div><div class="mid">${s.missed + s.skipped}</div><div class="muted">missed/skip</div></div>
        <div><div class="mid">${s.checkin_days}/${p.window.days}</div><div class="muted">check-ins</div></div>
        <div><div class="mid">${s.load.acwr ?? '–'}</div><div class="muted">ACWR</div></div></div>
      ${s.flags.length ? `<div class="warn small">⚠️ ${s.flags.map(esc).join('<br>⚠️ ')}</div>` : ''}
      <button class="primary" data-act="copyrep">📋 Copy prompt + report for Copilot</button>
      <button data-act="sharemd">📤 Share progress.md</button>
      <button data-act="sharejson">📤 Share progress.json</button>
    </div>
    <div class="muted small pad">Paste the copied text into Copilot. It asks for an assessment and, if needed, a new plan.json that you import here.</div>
    <div class="card"><b>Preview</b><pre class="md">${esc(md)}</pre></div>`;
}
async function markExport() { S.lastExport = today(); await db.setMeta('last_export', S.lastExport); }
function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: file.name }).then(async () => { await markExport(); toast('Shared'); })
      .catch(e => { if (e.name !== 'AbortError') { download(file); markExport(); } });
  } else { download(file); markExport(); }
}
function copyReport() {
  const text = `${ASSESS_PROMPT}\n\n${S.report.md}`;
  const ok = async () => { await markExport(); toast('Copied – paste into Copilot'); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text) && ok());
  else if (fallbackCopy(text)) ok();
}
function fallbackCopy(text) {
  const t = Object.assign(document.createElement('textarea'), { value: text }); t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:-1000px';
  document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length); const r = document.execCommand('copy'); t.remove();
  if (!r) toast('Copy failed – use Share instead'); return r;
}

// ---------- Import tab ----------
function sessionOptions(date, selected) {
  const opts = sessionsOn(date).filter(s => s.type !== 'rest');
  return `<option value="">➕ Unplanned (extra)</option>` + opts.map(s => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${ICON[s.type] || '•'} ${esc(s.title)}</option>`).join('');
}

function renderImport() {
  const cp = currentPlan(), pi = S.pendingImport, fs = S.fitStage;
  const recent = S.acts.slice(-30).reverse();
  view().innerHTML = `<h2>Import workouts</h2>
    <div class="card">
      <div class="muted small">Pick FIT files from iCloud Drive → RunGap → Exports. Select several at once; duplicates are skipped.</div>
      <button class="primary" data-act="pickfit">⌚ Choose FIT files</button>
      <input type="file" id="fitfile" multiple hidden>
    </div>
    ${fs ? fitPreview(fs) : ''}
    <h2>Import plan</h2>
    <div class="card">
      <div class="muted">Current plan: ${cp ? `v${cp.plan_version}, valid from ${fmt(cp.valid_from)}, imported ${fmt(cp.imported_at.slice(0, 10))}` : 'none'}</div>
      <button data-act="pickplan">📂 Choose plan.json from Files</button>
      <input type="file" id="planfile" accept=".json,application/json,text/plain" hidden>
      <div class="muted small center">or paste the JSON from Copilot:</div>
      <textarea id="planpaste" placeholder='{ "schema": "${SCHEMA}", ... }'></textarea>
      <button data-act="pasteplan">Check pasted plan</button>
    </div>
    ${pi ? importPreview(pi) : ''}
    ${cp?.rationale ? `<div class="card"><b>Copilot rationale (v${cp.plan_version})</b><div class="muted">${esc(cp.rationale)}</div></div>` : ''}
    ${recent.length ? `<h2>Imported workouts (${S.acts.length})</h2><div class="card">${recent.map(a => `<div class="irow">
        <div class="grow"><div><b>${fmtShort(a.date)}</b> ${actSummary(a)}</div>
        <select data-act="reassign" data-id="${esc(a.id)}">${sessionOptions(a.date, a.session_id)}</select></div>
        <button class="x" data-act="delact" data-id="${esc(a.id)}">✕</button></div>`).join('')}</div>` : ''}
    ${S.plans.length > 1 ? `<div class="card"><b>Plan history</b>${S.plans.slice().reverse().map(p => `<div class="rrow"><span>v${p.plan_version}</span><span class="muted">from ${fmt(p.valid_from)}</span><span class="muted">${p.sessions.length} sessions</span></div>`).join('')}</div>` : ''}`;
}

function fitPreview(fs) {
  const ok = fs.rows.filter(r => r.act && !r.dup);
  return `<div class="card ${ok.length ? 'ok' : 'err'}"><b>${ok.length} new workout${ok.length === 1 ? '' : 's'}</b>
    ${fs.rows.map((r, k) => r.err ? `<div class="irow bad">✘ ${esc(r.file)}: ${esc(r.err)}</div>`
      : r.dup ? `<div class="irow muted">↺ ${fmtShort(r.act.date)} ${actSummary(r.act)} – already imported</div>`
      : `<div class="irow"><div class="grow"><div><b>${fmtShort(r.act.date)}</b> ${actSummary(r.act)}</div>
          <select data-act="stageassign" data-k="${k}">${sessionOptions(r.act.date, r.act.session_id)}</select></div></div>`).join('')}
    ${ok.length ? `<button class="primary" data-act="applyfit">Import ${ok.length}</button>` : ''}<button data-act="cancelfit">Cancel</button></div>`;
}

function importPreview(pi) {
  if (pi.errors) return `<div class="card err"><b>Plan rejected (${pi.errors.length} issue${pi.errors.length > 1 ? 's' : ''})</b><ul>${pi.errors.slice(0, 20).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${pi.errors.length > 20 ? '<div>…</div>' : ''}<div class="muted small">Ask Copilot to fix these and output valid fitplan.plan/1.0 JSON.</div></div>`;
  const { plan, diff, warn } = pi, list = (a, cls) => a.slice(0, 8).map(s => `<li class="${cls}">${fmtShort(s.date)} ${esc(s.title)}</li>`).join('') + (a.length > 8 ? `<li class="muted">+${a.length - 8} more</li>` : '');
  return `<div class="card ok"><b>Plan v${plan.plan_version} · valid from ${fmt(plan.valid_from)}</b>
    ${plan.rationale ? `<div class="muted">${esc(plan.rationale)}</div>` : ''}
    ${warn ? `<div class="warn">⚠️ ${esc(warn)}</div>` : ''}
    <div class="stats"><div><div class="big">${diff.added.length}</div><div class="muted">added</div></div><div><div class="big">${diff.changed.length}</div><div class="muted">changed</div></div>
      <div><div class="big">${diff.removed.length}</div><div class="muted">removed</div></div><div><div class="big">${diff.kept.length}</div><div class="muted">locked</div></div></div>
    ${diff.added.length ? `<ul class="diff">${list(diff.added, 'add')}</ul>` : ''}${diff.changed.length ? `<ul class="diff">${list(diff.changed, 'chg')}</ul>` : ''}${diff.removed.length ? `<ul class="diff">${list(diff.removed, 'del')}</ul>` : ''}
    ${diff.kept.length ? `<div class="muted small">Locked sessions have a status you set and are not overwritten.</div>` : ''}
    <div class="muted small">${(plan.races || []).length} races · ${(plan.phases || []).length} phases${plan.athlete ? ' · athlete profile updated' : ''}</div>
    <button class="primary" data-act="applyplan">Apply plan</button> <button data-act="cancelplan">Cancel</button></div>`;
}

function renderSettings() {
  const a = S.athlete, z = a.zones;
  view().innerHTML = `<h2>Settings</h2>
    <div class="card"><b>Backup</b>
      <div class="${S.lastBackup && daysBetween(S.lastBackup, today()) < 7 ? 'okt' : 'warn'}">Last backup: ${S.lastBackup ? fmt(S.lastBackup) : 'never'}</div>
      <div class="muted small">Save to iCloud Drive → FitPlan. iOS may delete web-app data after long non-use.</div>
      <button data-act="backup" id="backupbtn" disabled>💾 Preparing backup…</button>
      <button data-act="pickrestore">♻️ Restore backup</button><input type="file" id="restorefile" accept=".json,application/json" hidden></div>
    <div class="card"><b>Athlete</b>
      <label>Max HR <input id="hrmax" type="number" inputmode="numeric" value="${a.hr_max}"></label>
      <label>Resting HR <input id="hrrest" type="number" inputmode="numeric" value="${a.hr_rest}"></label>
      <b>Zone upper limits (bpm)</b>
      ${[0, 1, 2, 3].map(i => `<label>Z${i + 1} ≤ <input class="zin" type="number" inputmode="numeric" value="${z[i]}"></label>`).join('')}
      <div class="muted small">Z5 ≥ ${z[3] + 1}. New zones apply to workouts imported afterwards.</div>
      <button data-act="saveathlete">Save</button></div>
    <div class="card"><b>Danger zone</b><button class="danger" data-act="wipe">Delete all data</button></div>
    <div class="muted small center">FitPlan ${APP_VERSION} · ${navigator.standalone ? 'Home Screen app' : 'Safari browser'} · data stays on this device</div>`;
  prepareBackup();
}

// ---------- backup (file prepared before the tap so iOS allows the share sheet) ----------
async function prepareBackup() {
  const data = { schema: 'fitplan.backup/1.0', app_version: APP_VERSION, created_at: new Date().toISOString(), data: await db.dump() };
  S.backupFile = new File([JSON.stringify(data)], `fitplan-backup-${today()}.json`, { type: 'application/json' });
  const btn = $('#backupbtn'); if (btn) { btn.disabled = false; btn.textContent = '💾 Export backup'; }
}
function doBackup() {
  const file = S.backupFile; if (!file) return;
  const mark = async () => { S.lastBackup = today(); await db.setMeta('last_backup', S.lastBackup); toast('Backup saved'); render(); };
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: file.name }).then(mark)
      .catch(e => { if (e.name !== 'AbortError') { download(file); mark(); } else toast('Backup cancelled'); });
  } else { download(file); mark(); }
}
function download(file) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- plan import ----------
async function stagePlan(text) {
  let p;
  try { p = JSON.parse(extractJSON(text)); } catch (e) { S.pendingImport = { errors: ['Not valid JSON: ' + e.message] }; return render(); }
  const errors = validatePlan(p);
  if (errors.length) { S.pendingImport = { errors }; return render(); }
  const cp = currentPlan();
  const warn = cp && p.plan_version <= cp.plan_version ? `plan_version ${p.plan_version} is not higher than current v${cp.plan_version}. Applying will overwrite it.` : null;
  S.pendingImport = { plan: p, warn, diff: mergePlan(S.sessions, S.logs, p) };
  render();
}
function extractJSON(t) {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}
async function applyPlan() {
  const { plan, diff } = S.pendingImport;
  const ops = [{ store: 'sessions', clear: true }, ...diff.sessions.map(s => ({ store: 'sessions', put: s }))];
  for (const r of plan.races || []) ops.push({ store: 'races', put: r });
  ops.push({ store: 'plans', put: { ...plan, imported_at: new Date().toISOString() } });
  if (plan.athlete) ops.push({ store: 'meta', put: { key: 'athlete', value: { ...S.athlete, ...plan.athlete } } });
  await db.batch(ops);
  S.pendingImport = null;
  await load();
  const days = [...new Set(S.acts.filter(a => a.date >= plan.valid_from).map(a => a.date))];
  await reassignDays(days);                 // re-link existing workouts to the new sessions
  toast(`Plan v${plan.plan_version} applied`); S.tab = 'today'; render();
}

// ---------- FIT import ----------
async function stageFit(files) {
  const rows = [], batchActs = [];
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      if (!isFit(buf)) { rows.push({ file: f.name, err: 'not a FIT file' }); continue; }
      const act = summarize(decode(buf), S.athlete, f.name);
      const dup = isDuplicate(act, S.acts) || isDuplicate(act, batchActs);
      rows.push({ file: f.name, act, dup });
      if (!dup) batchActs.push(act);
    } catch (e) { rows.push({ file: f.name, err: e.message }); }
  }
  for (const d of new Set(batchActs.map(a => a.date))) {
    const res = autoAssign([...S.acts.filter(a => a.date === d), ...batchActs.filter(a => a.date === d)], sessionsOn(d));
    batchActs.filter(a => a.date === d).forEach(a => Object.assign(a, res[a.id]));
  }
  rows.sort((a, b) => (a.act?.start_ts || 0) - (b.act?.start_ts || 0));
  S.fitStage = { rows }; render();
}

async function applyFit() {
  const news = S.fitStage.rows.filter(r => r.act && !r.dup).map(r => r.act);
  await db.batch(news.map(a => ({ store: 'activities', put: a })));
  S.fitStage = null;
  await load();
  await reassignDays([...new Set(news.map(a => a.date))]);
  toast(`${news.length} workout${news.length === 1 ? '' : 's'} imported`); render();
}

// Re-run auto matching for given days (manual links kept unless their session vanished) and refresh auto statuses.
async function reassignDays(days) {
  const ops = [], touched = new Set();
  for (const d of days) {
    const dayActs = S.acts.filter(a => a.date === d), ids = new Set(sessionsOn(d).map(s => s.id));
    for (const a of dayActs) if (a.session_id && !ids.has(a.session_id)) { a.session_id = null; a.manual = false; a.role = null; ops.push({ store: 'activities', put: a }); }
    const res = autoAssign(dayActs, sessionsOn(d));
    for (const a of dayActs) {
      const r = res[a.id];
      if (r && (r.session_id !== a.session_id || r.role !== a.role)) { Object.assign(a, r); ops.push({ store: 'activities', put: a }); }
    }
    sessionsOn(d).forEach(s => touched.add(s.id));
  }
  await db.batch(ops);
  await refreshStatuses([...touched]);
}

// Auto status only where the user has not set one manually.
async function refreshStatuses(ids) {
  const ops = [];
  for (const id of ids) {
    const s = S.sessions.find(x => x.id === id); if (!s) continue;
    const log = S.logs[id];
    if (log && log.status !== 'pending' && !log.auto) continue;
    const p = proposeStatus(s, actsOf(id));
    const next = p ? { ...(log || { id }), status: p.status, auto: true, reason: p.reason }
      : log?.auto ? { ...log, status: 'pending', auto: false, reason: null } : null;
    if (next) { ops.push({ store: 'logs', put: next }); S.logs[id] = next; }
  }
  await db.batch(ops);
}

async function reassignAct(id, sid) {
  const a = S.acts.find(x => x.id === id); if (!a) return;
  const old = a.session_id;
  Object.assign(a, { session_id: sid || null, role: null, manual: true });
  await db.put('activities', a);
  await refreshStatuses([old, sid].filter(Boolean));
  toast('Workout reassigned'); render();
}
async function deleteAct(id) {
  const a = S.acts.find(x => x.id === id); if (!a || !confirm(`Delete workout ${fmtShort(a.date)} ${hhmm(a.start)}?`)) return;
  await db.batch([{ store: 'activities', del: id }]);
  S.acts = S.acts.filter(x => x.id !== id);
  await reassignDays([a.date]); render();
}

// ---------- manual status ----------
async function setStatus(id, st) {
  const cur = S.logs[id] || { id };
  const next = { ...cur, status: cur.status === st && !cur.auto ? 'pending' : st, auto: false, reason: null, updated_at: new Date().toISOString() };
  await db.put('logs', next); S.logs[id] = next; render();
}
async function setNote(id) {
  const cur = S.logs[id] || { id, status: 'pending' };
  const n = prompt('Note for this session (what changed, how it felt):', cur.note || '');
  if (n === null) return;
  const next = { ...cur, note: n.trim(), updated_at: new Date().toISOString() };
  await db.put('logs', next); S.logs[id] = next; render();
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-tab]'); if (!el || el.tagName === 'SELECT') return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; S.ciOpen = false; if (S.tab === 'today') S.day = today(); return render(); }
  const { act } = el.dataset;
  if (act === 'day') { const n = +el.dataset.n; S.day = n === 0 ? today() : addDays(S.day, n); S.ciOpen = false; render(); }
  else if (act === 'week') { const n = +el.dataset.n; S.weekStart = n === 0 ? mondayOf(today()) : addDays(S.weekStart, n); render(); }
  else if (act === 'goto') { S.day = el.dataset.d; S.tab = 'today'; S.ciOpen = false; render(); }
  else if (act === 'status') setStatus(el.dataset.id, el.dataset.st);
  else if (act === 'note') setNote(el.dataset.id);
  else if (act === 'ciopen') { S.ciOpen = true; render(); setTimeout(() => $('.ci')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); }
  else if (act === 'ciclose') { S.ciOpen = false; render(); }
  else if (act === 'cisave') saveCheckin();
  else if (act === 'padd') $('#painlist').insertAdjacentHTML('beforeend', painRow());
  else if (act === 'pdel') el.closest('.prow').remove();
  else if (act === 'copyrep') copyReport();
  else if (act === 'sharemd') shareFile(S.report.mdFile);
  else if (act === 'sharejson') shareFile(S.report.jsonFile);
  else if (act === 'pickfit') $('#fitfile').click();
  else if (act === 'applyfit') applyFit();
  else if (act === 'cancelfit') { S.fitStage = null; render(); }
  else if (act === 'delact') deleteAct(el.dataset.id);
  else if (act === 'pickplan') $('#planfile').click();
  else if (act === 'pasteplan') stagePlan($('#planpaste').value);
  else if (act === 'applyplan') applyPlan();
  else if (act === 'cancelplan') { S.pendingImport = null; render(); }
  else if (act === 'backup') doBackup();
  else if (act === 'pickrestore') $('#restorefile').click();
  else if (act === 'saveathlete') {
    const zones = [...document.querySelectorAll('.zin')].map(i => +i.value);
    if (!zones.every((z, i) => z > 0 && (i === 0 || z > zones[i - 1]))) return toast('Zones must be ascending');
    S.athlete = { hr_max: +$('#hrmax').value, hr_rest: +$('#hrrest').value, zones };
    await db.setMeta('athlete', S.athlete); toast('Saved');
  }
  else if (act === 'wipe') { if (confirm('Delete ALL FitPlan data on this device? Export a backup first.')) { await db.wipe(); await load(); toast('All data deleted'); render(); } }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'fitfile' && t.files.length) { toast('Reading files…'); stageFit([...t.files]); }
  else if (t.id === 'repwin') { S.repWin = t.value; render(); }
  else if (t.dataset.act === 'stageassign') { const a = S.fitStage.rows[+t.dataset.k].act; a.session_id = t.value || null; a.role = null; a.manual = true; }
  else if (t.dataset.act === 'reassign') reassignAct(t.dataset.id, t.value);
  else if (t.id === 'planfile' && t.files[0]) stagePlan(await t.files[0].text());
  else if (t.id === 'restorefile' && t.files[0]) {
    try {
      const b = JSON.parse(await t.files[0].text());
      if (b.schema !== 'fitplan.backup/1.0') throw new Error('Not a FitPlan backup');
      if (!confirm(`Restore backup from ${fmt(b.created_at.slice(0, 10))}? Current data will be replaced.`)) return;
      await db.restore(b.data); await load(); toast('Backup restored'); S.tab = 'today'; render();
    } catch (err) { toast('Restore failed: ' + err.message); }
  }
});

// Swipe left/right on Today & Week (not while editing the check-in)
let tx0 = null;
document.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  if (tx0 === null) return; const dx = e.changedTouches[0].clientX - tx0; tx0 = null;
  if (Math.abs(dx) < 70 || S.ciOpen || e.target.closest('textarea,input,select,.zbar,pre')) return;
  if (S.tab === 'today') { S.day = addDays(S.day, dx < 0 ? 1 : -1); render(); }
  else if (S.tab === 'week') { S.weekStart = addDays(S.weekStart, dx < 0 ? 7 : -7); render(); }
});

let lastDay = today();
document.addEventListener('visibilitychange', () => { if (!document.hidden && lastDay !== today()) { lastDay = today(); S.day = today(); S.weekStart = mondayOf(today()); S.ciOpen = false; render(); } });

(async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) { const b = $('#banner'); b.dataset.update = '1'; b.innerHTML = `<button onclick="location.reload()">🔄 New version available – tap to update</button>`; } });
      });
    });
  }
  navigator.storage?.persist?.();
  await load(); render();
})();
