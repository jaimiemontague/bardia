/** World invariants (tests, fuzzers and `npm run sim`): human-readable violations, empty when sane. */
import { PLACEHOLDER_HOME_FLAG } from '@sim/core/factory';
import type { FactionId, GameState, ProvinceId, SettlementId } from '@sim/core/state';
import { knowledgeInvariants } from './knowledge';

/** Checks provinces, settlements, holdings, the player's home, the world index and movement bookkeeping. */
export function worldInvariants(state: GameState): string[] {
  const out: string[] = [];
  // Settlements ↔ provinces.
  for (const [sid, s] of Object.entries(state.settlements) as [SettlementId, (typeof state.settlements)[SettlementId]][]) {
    const p = state.provinces[s.provinceId];
    if (!p) out.push(`settlement ${sid}: unknown province ${s.provinceId}`);
    else if (!p.settlementIds.includes(sid)) out.push(`settlement ${sid}: province ${s.provinceId} does not list it`);
    const f = state.factions[s.factionId];
    if (!f) out.push(`settlement ${sid}: unknown faction ${s.factionId}`);
    else if (!f.holdingIds.includes(sid)) out.push(`settlement ${sid}: faction ${s.factionId} does not hold it`);
    if (!Number.isFinite(s.mapPos.x) || !Number.isFinite(s.mapPos.y)) out.push(`settlement ${sid}: bad position`);
    if (state.worldIndex && !Object.hasOwn(state.worldIndex.settlements, sid) && state.flags[PLACEHOLDER_HOME_FLAG] !== sid) out.push(`settlement ${sid}: missing from the world index`);
  }
  for (const [pid, p] of Object.entries(state.provinces) as [ProvinceId, (typeof state.provinces)[ProvinceId]][]) {
    for (const sid of p.settlementIds) {
      if (state.settlements[sid]?.provinceId !== pid) out.push(`province ${pid}: lists ${sid}, which is not in it`);
    }
    if (p.settlementIds.length > 0 && !p.settlementIds.includes(p.capitalId)) out.push(`province ${pid}: capital ${p.capitalId} is not one of its settlements`);
  }
  for (const [fid, f] of Object.entries(state.factions) as [FactionId, (typeof state.factions)[FactionId]][]) {
    for (const sid of f.holdingIds) if (state.settlements[sid]?.factionId !== fid) out.push(`faction ${fid}: holds ${sid}, which is not its own`);
    if (f.holdingIds.some((v, i) => f.holdingIds.indexOf(v) !== i)) out.push(`faction ${fid}: duplicate holdings`);
    if (f.liegeId !== undefined && !state.factions[f.liegeId]) out.push(`faction ${fid}: unknown liege ${f.liegeId}`);
    for (const v of f.vassalIds) if (state.factions[v]?.liegeId !== fid) out.push(`faction ${fid}: vassal ${v} does not name it as liege`);
  }
  // The player has a real home once the world exists.
  if (state.worldIndex) {
    if (state.flags[PLACEHOLDER_HOME_FLAG] !== undefined) out.push('world: the placeholder home is still flagged');
    const cap = state.settlements[state.player.capitalId];
    if (!cap) out.push(`world: player capital ${state.player.capitalId} does not exist`);
    else if (cap.factionId !== state.player.factionId) out.push(`world: player capital ${cap.id} is not the player's`);
    for (const p of Object.values(state.provinces)) if (p.regionId === 'placeholder') out.push(`world: placeholder province ${p.id} is still present`);
  }
  out.push(...knowledgeInvariants(state.knowledge));
  const w = state.world;
  if (w) {
    for (const id of Object.keys(w.movers)) {
      const e = id.startsWith('flt_') ? state.fleets[id as keyof typeof state.fleets] : state.armies[id as keyof typeof state.armies];
      if (!e) out.push(`world: mover ${id} does not exist`);
      else if (e.route.length === 0 && !(id.startsWith('flt_') && (e as { portageUntil?: number }).portageUntil !== undefined)) out.push(`world: mover ${id} has no route`);
    }
  }
  return out;
}
