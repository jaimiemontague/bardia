/**
 * Starting relations (design §17.1–§17.2): sensible opinions between the factions of the generated world,
 * vassal ties, kinship, a few wars and feuds. Diplomacy (a later module) owns pacts and how relations change;
 * this only seeds them.
 *
 * Who relates to whom: factions of one region, factions whose provinces share a border (land, or a sea
 * zone across a region's islands), liege and vassal, houses tied by marriage, every pair of realm rulers,
 * and (tunable) the player with everyone. Modifiers (balance.diplomacy.opinionModifiers where it has them,
 * tunables.world.relations otherwise): shared faith/culture, faith difference, kinship, fealty, border
 * friction, regional rivalry between rival kings, a temperament draw, feuds; wars set the stance.
 */
import { getOrCreateRelation, getRelation, recomputeOpinion } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { Rng } from '@sim/core/rng';
import type { FactionId, GameState, ProvinceId, Relation } from '@sim/core/state';
import type { Generated } from './worldgen';

/** Adds an opinion modifier (summing into an existing one of the same reason). */
export function addModifier(rel: Relation, reason: string, value: number, decayPerMonth = 0): void {
  if (value === 0) return; // also drops −0
  const existing = rel.modifiers.find((m) => m.reason === reason);
  if (existing) existing.value += value;
  else rel.modifiers.push({ reason, value, decayPerMonth });
}

function pairKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Province → faction holding its capital. */
function provinceOwners(draft: GameState): Record<ProvinceId, FactionId> {
  const out: Record<ProvinceId, FactionId> = {};
  for (const [pid, p] of Object.entries(draft.provinces) as [ProvinceId, (typeof draft.provinces)[ProvinceId]][]) {
    const cap = draft.settlements[p.capitalId];
    if (cap) out[pid] = cap.factionId;
  }
  return out;
}

/** Pairs of factions whose provinces neighbour each other (from state.worldIndex), as pair keys. */
export function borderPairs(draft: GameState): Record<string, true> {
  const out: Record<string, true> = {};
  const idx = draft.worldIndex;
  if (!idx) return out;
  const owners = provinceOwners(draft);
  for (const [pid, g] of Object.entries(idx.provinces) as [ProvinceId, (typeof idx.provinces)[ProvinceId]][]) {
    const a = owners[pid];
    if (a === undefined) continue;
    for (const n of [...g.neighbours, ...g.seaNeighbours]) {
      const b = owners[n];
      if (b === undefined || b === a) continue;
      out[pairKey(a, b)] = true;
    }
  }
  return out;
}

/** Seeds relations between the generated factions (and the player). */
export function seedRelations(draft: GameState, ctx: SimContext, rng: Rng, gen: Generated): void {
  const t = ctx.tunables.world.relations;
  const om = ctx.balance.diplomacy.opinionModifiers;
  const player = draft.player.factionId;
  const all: FactionId[] = [player, ...gen.factionIds, ...gen.neutralIds];
  const regionOf = (id: FactionId): string => (id === player ? (gen.regionOf[player] ?? '') : (gen.regionOf[id] ?? ''));
  const borders = borderPairs(draft);
  const kin: Record<string, true> = {};
  for (const [fid, h] of Object.entries(gen.houses) as [FactionId, Generated['houses'][FactionId]][]) {
    for (const other of h.kinFactions) if (other !== fid) kin[pairKey(fid, other)] = true;
  }
  const seats: Record<string, true> = {};
  for (const id of Object.values(gen.seatOf)) seats[id] = true;

  const related = (a: FactionId, b: FactionId): boolean => {
    if (a === player || b === player) return t.relatePlayerWithAll || regionOf(a) === regionOf(b) || Object.hasOwn(borders, pairKey(a, b));
    if (regionOf(a) === regionOf(b)) return true;
    if (Object.hasOwn(borders, pairKey(a, b)) || Object.hasOwn(kin, pairKey(a, b))) return true;
    if (Object.hasOwn(seats, a) && Object.hasOwn(seats, b)) return true;
    const fa = draft.factions[a];
    const fb = draft.factions[b];
    return fa?.liegeId === b || fb?.liegeId === a;
  };

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i] as FactionId;
      const b = all[j] as FactionId;
      if (!related(a, b)) continue;
      const fa = draft.factions[a];
      const fb = draft.factions[b];
      if (!fa || !fb) continue;
      const rel = getOrCreateRelation(draft, a, b);
      if (fa.faith === fb.faith) addModifier(rel, 'sharedFaith', om.sharedFaith);
      else addModifier(rel, 'faithDifference', t.faithDifference);
      if (fa.culture === fb.culture) addModifier(rel, 'sharedCulture', om.sharedCulture);
      if (Object.hasOwn(kin, pairKey(a, b))) addModifier(rel, 'kinship', om.kinship);
      if (fa.liegeId === b || fb.liegeId === a) addModifier(rel, 'fealty', t.fealty);
      if (Object.hasOwn(borders, pairKey(a, b))) addModifier(rel, 'border', t.border);
      if (Object.hasOwn(seats, a) && Object.hasOwn(seats, b) && regionOf(a) === regionOf(b) && t.rivalryRegions.includes(regionOf(a))) addModifier(rel, 'regionalRivalry', t.regionalRivalry);
      if (fa.neutral === true || fb.neutral === true) {
        // Neutral ground is respected by all (raiding it angers everyone; diplomacy's rule).
      } else if (t.noise > 0) addModifier(rel, 'temperament', Math.round(rng.range(-t.noise, t.noise)) + 0);
      rel.opinion = recomputeOpinion(rel, ctx.balance.diplomacy.opinionMin, ctx.balance.diplomacy.opinionMax);
    }
  }

  // Starting wars and feuds.
  for (const rule of t.conflicts) {
    const sideA = all.filter((id) => id !== player && regionOf(id) === rule.regionId && (rule.kindA === undefined || draft.factions[id]?.kind === rule.kindA) && draft.factions[id]?.neutral !== true);
    const otherRegion = rule.otherRegionId ?? rule.regionId;
    const sideB = all.filter((id) => id !== player && regionOf(id) === otherRegion && (rule.kindB === undefined || draft.factions[id]?.kind === rule.kindB) && draft.factions[id]?.neutral !== true);
    const candidates: [FactionId, FactionId][] = [];
    for (const a of sideA) {
      for (const b of sideB) {
        if (a === b) continue;
        if (rule.otherRegionId === undefined && b < a && sideA.includes(b) && rule.kindA === rule.kindB) continue; // each unordered pair once
        const fa = draft.factions[a];
        const fb = draft.factions[b];
        if (!fa || !fb || fa.liegeId === b || fb.liegeId === a) continue;
        if (fa.liegeId !== undefined && fa.liegeId === fb.liegeId) continue; // sworn to one liege: no open war
        if (rule.neighboursOnly && !Object.hasOwn(borders, pairKey(a, b))) continue;
        const rel = getRelation(draft, a, b);
        if (rel && (rel.stance === 'war' || rel.modifiers.some((m) => m.reason === 'feud'))) continue;
        candidates.push([a, b]);
      }
    }
    for (let n = 0; n < rule.count && candidates.length > 0; n++) {
      const k = rng.int(0, candidates.length - 1);
      const [a, b] = candidates.splice(k, 1)[0] as [FactionId, FactionId];
      const rel = getOrCreateRelation(draft, a, b);
      addModifier(rel, 'feud', t.feud, t.feudDecayPerMonth);
      if (rule.kind === 'war') {
        rel.stance = 'war';
        rel.warSinceHour = Math.max(0, ctx.hour - rng.int(30, 400) * 24);
      }
      rel.opinion = recomputeOpinion(rel, ctx.balance.diplomacy.opinionMin, ctx.balance.diplomacy.opinionMax);
      for (let i = candidates.length - 1; i >= 0; i--) {
        const c = candidates[i] as [FactionId, FactionId];
        if (c[0] === a || c[1] === a || c[0] === b || c[1] === b) candidates.splice(i, 1);
      }
    }
  }
}
