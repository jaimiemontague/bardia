/**
 * People invariants (for tests and the fuzzing sim) and the index reconciliation that rebuilds the
 * slice's id lists from the characters table on init and load (a save from before this module, or
 * one written by an older build). During play this module's own ops keep the indices exact; a
 * module that writes character records directly instead of through those ops shows up as an
 * invariant violation ("captive but not indexed" …).
 */
import type { Content } from '@content/index';
import { ATTRIBUTE_IDS, SKILL_IDS } from '@content/schemas/ids';
import { levelForXp } from '@sim/core/balance';
import type { SimContext } from '@sim/core/module';
import type { Character, CharId, GameState } from '@sim/core/state';
import { ransomFor } from './captivity';
import { forEachCharacter, peopleState, pushUnique, removeValue } from './util';

const WOUNDS: readonly string[] = ['none', 'minor', 'serious', 'mortal'];

function linked(state: GameState, id: CharId | undefined): Character | undefined {
  return id !== undefined && Object.hasOwn(state.characters, id) ? state.characters[id] : undefined;
}

/** Violations of the people module's invariants (empty: consistent). */
export function peopleInvariants(state: GameState, content: Content): string[] {
  const out: string[] = [];
  const ch = content.balance.character;
  const maxLevel = content.balance.xp.maxLevel;
  const ps = state.people;
  for (const [key, c] of Object.entries(state.characters)) {
    const id = key as CharId;
    // Family links are symmetric.
    for (const s of c.family.spouseIds) {
      const sp = linked(state, s);
      if (!sp) out.push(`${id}: spouse ${s} does not exist`);
      else if (!sp.family.spouseIds.includes(id)) out.push(`${id}: spouse ${s} does not list ${id}`);
    }
    for (const k of c.family.childIds) {
      const kid = linked(state, k);
      if (!kid) out.push(`${id}: child ${k} does not exist`);
      else if (kid.family.fatherId !== id && kid.family.motherId !== id && kid.family.adoptedById !== id) out.push(`${id}: child ${k} does not name ${id} as a parent`);
    }
    for (const p of [c.family.fatherId, c.family.motherId, c.family.adoptedById]) {
      if (p === undefined) continue;
      const parent = linked(state, p);
      if (!parent) out.push(`${id}: parent ${p} does not exist`);
      else if (!parent.family.childIds.includes(id)) out.push(`${id}: parent ${p} does not list the child`);
    }
    if (c.family.heirId !== undefined && linked(state, c.family.heirId)?.alive !== true) out.push(`${id}: heir ${c.family.heirId} is not a living character`);
    if (!c.alive) {
      if (c.role !== undefined) out.push(`${id}: dead but holds role ${c.role.kind}`);
      if (c.pregnancy) out.push(`${id}: dead but pregnant`);
      if (c.captivity) out.push(`${id}: dead but has a captivity record`);
      if (ps?.pregnantIds.includes(id) || ps?.captiveIds.includes(id) || ps?.woundedIds.includes(id) || ps?.fosterIds.includes(id)) {
        out.push(`${id}: dead but still indexed`);
      }
      if (!c.death) out.push(`${id}: dead without a death record`);
      continue;
    }
    if (!WOUNDS.includes(c.health.wound)) out.push(`${id}: bad wound state ${String(c.health.wound)}`);
    if (!(c.health.hpPct >= 0 && c.health.hpPct <= 100)) out.push(`${id}: hpPct ${c.health.hpPct}`);
    if (c.health.wound !== 'none' && ps && !ps.woundedIds.includes(id)) out.push(`${id}: wounded but not indexed`);
    if (!Number.isInteger(c.level) || c.level < 1 || c.level > maxLevel) out.push(`${id}: level ${c.level}`);
    else if (c.level !== Math.min(levelForXp(content.balance, c.xp), maxLevel)) out.push(`${id}: level ${c.level} disagrees with xp ${c.xp}`);
    if (!(c.xp >= 0)) out.push(`${id}: xp ${c.xp}`);
    for (const a of ATTRIBUTE_IDS) {
      const v = c.attributes[a];
      if (!Number.isInteger(v) || v < ch.attributeMin || v > ch.attributeMax) out.push(`${id}: ${a} ${v}`);
    }
    for (const s of SKILL_IDS) {
      const v = c.skills[s];
      if (!Number.isInteger(v) || v < 0 || v > ch.skillMax) out.push(`${id}: ${s} ${v}`);
    }
    for (const [what, v] of [
      ['unspentSkillPoints', c.unspentSkillPoints],
      ['unspentAttributePoints', c.unspentAttributePoints],
    ] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) out.push(`${id}: ${what} ${v}`);
    }
    if (c.pregnancy) {
      if (c.sex !== 'female') out.push(`${id}: pregnant but not female`);
      if (ps && !ps.pregnantIds.includes(id)) out.push(`${id}: pregnant but not indexed`);
    }
    const captive = c.location.kind === 'captive';
    if (captive !== (c.captivity !== undefined)) out.push(`${id}: captive location and captivity record disagree`);
    if (captive && ps && !ps.captiveIds.includes(id)) out.push(`${id}: captive but not indexed`);
    if (c.upbringing && ps && !ps.fosterIds.includes(id)) out.push(`${id}: fostered but not indexed`);
    for (const f of c.feats) if (!Object.hasOwn(content.feats, f)) out.push(`${id}: unknown feat ${f}`);
    for (const t of c.traits) if (!Object.hasOwn(content.traits, t)) out.push(`${id}: unknown trait ${t}`);
  }
  if (ps) {
    for (const [name, list] of [
      ['pregnantIds', ps.pregnantIds],
      ['captiveIds', ps.captiveIds],
      ['woundedIds', ps.woundedIds],
      ['fosterIds', ps.fosterIds],
    ] as const) {
      if (list.some((v, i) => list.indexOf(v) !== i)) out.push(`people.${name} has duplicates`);
      for (const id of list) if (!linked(state, id)) out.push(`people.${name} lists unknown ${id}`);
    }
    for (const id of ps.pregnantIds) if (linked(state, id) && !linked(state, id)?.pregnancy) out.push(`people.pregnantIds lists ${id}, who is not pregnant`);
    for (const id of ps.captiveIds) if (linked(state, id)?.alive && !linked(state, id)?.captivity) out.push(`people.captiveIds lists ${id}, who is free`);
    const r = ps.regency;
    if (r) {
      if (linked(state, r.heirId)?.alive !== true) out.push(`regency heir ${r.heirId} is not alive`);
      if (r.regentId !== undefined && r.regentId !== state.player.rulerId) out.push(`regent ${r.regentId} is not the acting ruler ${state.player.rulerId}`);
    }
  }
  const ruler = linked(state, state.player.rulerId);
  if (ruler && !ruler.alive && !ps?.houseFallen && state.pending?.kind !== 'succession') out.push(`player ruler ${ruler.id} is dead but the house has not passed on`);
  return out;
}

/**
 * Rebuilds the slice indices from the characters table: adds missing entries (captives get a
 * captivity record if another module set the location directly) and drops stale ones.
 */
export function reconcileIndices(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  for (const list of [ps.pregnantIds, ps.captiveIds, ps.woundedIds, ps.fosterIds]) {
    for (const id of [...list]) {
      const c = Object.hasOwn(draft.characters, id) ? draft.characters[id] : undefined;
      if (!c?.alive) removeValue(list, id);
    }
  }
  for (const id of [...ps.pregnantIds]) if (!draft.characters[id]?.pregnancy) removeValue(ps.pregnantIds, id);
  for (const id of [...ps.fosterIds]) if (!draft.characters[id]?.upbringing) removeValue(ps.fosterIds, id);
  forEachCharacter(draft, (id, row) => {
    if (!row.alive) return;
    const needsWound = row.health.wound !== 'none' || row.health.injuries.some((i) => i.untilHour !== undefined);
    const needsCaptive = row.location.kind === 'captive' || row.captivity !== undefined;
    if (!needsWound && !needsCaptive && !row.pregnancy && !row.upbringing) return;
    const c = draft.characters[id];
    if (!c?.alive) return;
    if (c.health.wound !== 'none' || c.health.injuries.some((i) => i.untilHour !== undefined)) pushUnique(ps.woundedIds, id);
    if (c.pregnancy) pushUnique(ps.pregnantIds, id);
    if (c.upbringing) pushUnique(ps.fosterIds, id);
    if (c.location.kind === 'captive') {
      if (!c.captivity) {
        const ransom = ransomFor(draft, ctx, c);
        c.captivity = { byFactionId: c.location.by, at: c.location.at, sinceHour: ctx.hour, ransom, baseRansom: ransom, guard: 0, vigorFails: 0, bargains: 0 };
      }
      pushUnique(ps.captiveIds, id);
    } else if (c.captivity) {
      delete c.captivity;
      removeValue(ps.captiveIds, id);
    }
  });
}
