// Plan schema validation and merge logic (pure functions, testable in Node).
import { isISODate } from './util.js';

export const SCHEMA = 'fitplan.plan/1.0';
export const TYPES = ['run', 'bike', 'strength', 'ocr', 'mobility', 'rest', 'race', 'other'];

export function validatePlan(p) {
  const e = [];
  if (!p || typeof p !== 'object') return ['File is not a JSON object'];
  if (p.schema !== SCHEMA) e.push(`schema must be "${SCHEMA}" (found "${p.schema}")`);
  if (!Number.isInteger(p.plan_version) || p.plan_version < 1) e.push('plan_version must be an integer ≥ 1');
  if (!isISODate(p.valid_from)) e.push('valid_from must be a date yyyy-mm-dd');
  if (!Array.isArray(p.sessions)) e.push('sessions must be an array');
  if (p.athlete?.zones && !(Array.isArray(p.athlete.zones) && p.athlete.zones.length === 4 && p.athlete.zones.every((z, i, a) => Number.isFinite(z) && (i === 0 || z > a[i - 1]))))
    e.push('athlete.zones must be 4 ascending upper limits, e.g. [117,130,142,154]');
  (p.races || []).forEach((r, i) => {
    if (!r.id) e.push(`races[${i}]: id missing`);
    if (!isISODate(r.date)) e.push(`races[${i}] ${r.id || ''}: date invalid`);
    if (!r.name) e.push(`races[${i}] ${r.id || ''}: name missing`);
  });
  const ids = new Set();
  (p.sessions || []).forEach((s, i) => {
    const tag = `sessions[${i}] ${s.id || ''}`;
    if (!s.id) e.push(`${tag}: id missing`);
    else if (ids.has(s.id)) e.push(`${tag}: duplicate id`); else ids.add(s.id);
    if (!isISODate(s.date)) e.push(`${tag}: date invalid`);
    else if (isISODate(p.valid_from) && s.date < p.valid_from) e.push(`${tag}: date before valid_from`);
    if (!TYPES.includes(s.type)) e.push(`${tag}: type must be one of ${TYPES.join('|')}`);
    if (!s.title) e.push(`${tag}: title missing`);
    if (s.blocks && !Array.isArray(s.blocks)) e.push(`${tag}: blocks must be an array`);
  });
  return e;
}

// Locked = user set a status manually (auto-proposed statuses from FIT import do not lock).
const locked = (logs, id) => { const l = logs[id]; return !!l && l.status && l.status !== 'pending' && !l.auto; };
const sig = s => JSON.stringify({ ...s, plan_version: undefined });

/** current: stored sessions; logs: {id: log}; plan: validated plan. Returns diff + resulting sessions. */
export function mergePlan(current, logs, plan) {
  const vf = plan.valid_from;
  const incoming = new Map(plan.sessions.map(s => [s.id, { ...s, slot: s.slot ?? 1, plan_version: plan.plan_version }]));
  const result = [], added = [], changed = [], removed = [], kept = [];
  const seen = new Set();
  for (const s of current) {
    if (s.date < vf || locked(logs, s.id)) {
      result.push(s); seen.add(s.id);
      if (incoming.has(s.id) && s.date >= vf) kept.push(s);
      continue;
    }
    if (incoming.has(s.id)) {
      const n = incoming.get(s.id); result.push(n); seen.add(s.id);
      if (sig(n) !== sig(s)) changed.push(n);
    } else removed.push(s);
  }
  for (const [id, n] of incoming) if (!seen.has(id)) { result.push(n); added.push(n); }
  result.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  return { added, changed, removed, kept, sessions: result };
}
