/**
 * Invariants of the narrative slice (tests and fuzzers; `npm run sim` fails on violations).
 */
import type { GameState } from '@sim/core/state';
import './types';

function isNonNegInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/** Human-readable violations of the narrative state. */
export function narrativeInvariants(state: GameState): string[] {
  const out: string[] = [];
  const s = state.storylets;
  const now = state.time.hour;
  for (const [id, until] of Object.entries(s.cooldowns)) if (!Number.isInteger(until)) out.push(`cooldown ${id} is not an integer hour (${String(until)})`);
  const once: Record<string, true> = {};
  for (const id of s.onceFired) {
    if (Object.hasOwn(once, id)) out.push(`onceFired lists ${id} twice`);
    once[id] = true;
  }
  for (const e of s.scheduled) if (!Number.isInteger(e.atHour)) out.push(`scheduled ${e.storyletId} has a non-integer hour`);
  // Every narrative storylet decision has an active instance and vice versa.
  const decisions = [...(state.pending ? [state.pending] : []), ...state.pendingQueue].filter((d) => d.kind === 'storylet' && d.source === 'narrative');
  const decisionByInstance: Record<string, string> = {};
  for (const d of decisions) {
    if (d.kind !== 'storylet') continue;
    const iid = d.payload.instanceId;
    if (iid === undefined) out.push(`storylet decision ${d.id} has no instanceId`);
    else decisionByInstance[iid] = d.id;
  }
  const instances = s.instances ?? {};
  for (const [key, inst] of Object.entries(instances)) {
    if (inst.id !== key) out.push(`storylet instance key ${key} != id ${inst.id}`);
    if (!inst.id.startsWith('stl_')) out.push(`storylet instance id ${inst.id} lacks the stl_ prefix`);
    if (!Number.isInteger(inst.firedHour) || inst.firedHour > now) out.push(`storylet instance ${inst.id} fired in the future (${inst.firedHour})`);
    if (inst.status === 'pending') {
      if (inst.pendingId === undefined) out.push(`pending storylet instance ${inst.id} has no pendingId`);
      else if (decisionByInstance[inst.id] !== inst.pendingId) out.push(`storylet instance ${inst.id} points at decision ${inst.pendingId}, which is not pending`);
    } else {
      if (inst.pendingId !== undefined) out.push(`waiting storylet instance ${inst.id} still has pendingId ${inst.pendingId}`);
      if (inst.expiresHour !== undefined && !Number.isInteger(inst.expiresHour)) out.push(`storylet instance ${inst.id} has a non-integer expiry`);
    }
  }
  for (const iid of Object.keys(decisionByInstance)) if (!Object.hasOwn(instances, iid)) out.push(`storylet decision for ${iid} has no active instance`);
  for (const [k, h] of Object.entries(s.marks ?? {})) if (!Number.isInteger(h) || h > now) out.push(`mark ${k} has a bad hour (${h})`);
  for (const [k, n] of Object.entries(s.tallies ?? {})) if (!isNonNegInt(n)) out.push(`tally ${k} is not a non-negative integer (${n})`);
  const lines = s.lines;
  if (lines !== undefined) {
    if (!Number.isInteger(lines.session) || lines.session < 1) out.push(`line session ${lines.session} must be a positive integer`);
    if (!isNonNegInt(lines.draws)) out.push(`line draws ${lines.draws} must be a non-negative integer`);
    for (const [pool, list] of Object.entries(lines.recent)) {
      if (list.some((x, i) => list.indexOf(x) !== i)) out.push(`line pool ${pool} remembers a line twice this session`);
    }
    for (const [k, n] of Object.entries(lines.uses)) if (!isNonNegInt(n) || n === 0) out.push(`line use count ${k} must be a positive integer (${n})`);
  }
  for (const [k, v] of Object.entries(s.verses ?? {})) {
    if (v.lines.length === 0) out.push(`verse ${k} has no lines`);
    for (const l of v.lines) for (const kv of l.keyVars) if (typeof l.vars[kv] !== 'string') out.push(`verse ${k} line ${l.key}: keyVar ${kv} is not a key`);
  }
  return out;
}
