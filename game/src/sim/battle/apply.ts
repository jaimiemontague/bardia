/**
 * Writing a battle's result back to GameState — only through other modules' effects (§10, §13.8):
 *   military: killMen                       (killed, wounded and captured men per source container)
 *   core:     addSilver, addGoods           (loot leaves the place for the winner's fleet or treasury,
 *                                           burned wealth is destroyed)
 *   people:   woundCharacter, capture, kill, grantXp   (only when `tunables.battle.resultEffects.characters`;
 *                                           by default the people module applies leader fates and XP
 *                                           from BattleEnded itself, so they are not written twice)
 * `battleResultEffects` is pure (state read only) so tools and tests can inspect the list; the module
 * applies it with `applyEffectsChecked`, which skips ops that are not registered or whose parameters
 * the owner rejects and reports them (`BattleEnded.unapplied`) instead of failing the command.
 */
import type { Content } from '@content/index';
import { EffectError, validateEffects, type EffectData } from '@sim/core/effects';
import type { SimContext } from '@sim/core/module';
import type { BattleResult, BattleSetup, CharId, GameState, GoodId, SideSetup } from '@sim/core/state';
import { battleData, lootPoolValue } from './data';
import type { BattleSideKey, BattleSquadLoss } from './types';
import { roundTo, splitBy } from './util';

const KEYS: readonly BattleSideKey[] = ['attacker', 'defender'];

function sideOf(setup: BattleSetup, key: BattleSideKey): SideSetup {
  return key === 'attacker' ? setup.attacker : setup.defender;
}

/**
 * Casualties per source container: the result's own `squadLosses` when present, else the per-squad
 * `casualties` rows spread over each squad's sources (results built by other code).
 */
export function lossesOf(setup: BattleSetup, result: BattleResult): BattleSquadLoss[] {
  if (result.squadLosses && result.squadLosses.length > 0) return result.squadLosses;
  const out: BattleSquadLoss[] = [];
  for (const key of KEYS) {
    const squads = sideOf(setup, key).squads;
    const rows = result.casualties.filter((c) => c.side === key);
    // Pair rows with squads in order (rows are per squad, in setup order).
    squads.forEach((sq, i) => {
      const row = rows[i];
      if (!row) return;
      const sources = sq.sources && sq.sources.length > 0 ? sq.sources : [{ kind: 'explicit' as const, men: sq.men }];
      const w = sources.map((s) => s.men);
      const k = splitBy(row.killed, w);
      const wd = splitBy(row.wounded, w);
      const c = splitBy(row.captured, w);
      sources.forEach((src, j) => {
        out.push({ side: key, unit: sq.unit, source: src.id !== undefined ? { kind: src.kind, id: src.id } : { kind: src.kind }, killed: k[j]!, wounded: wd[j]!, captured: c[j]! });
      });
    });
  }
  return out;
}

/** The effects that write a result back (pure). `lootApplied` tells whether loot moved with them. */
export function battleResultEffects(state: GameState, content: Content, setup: BattleSetup, result: BattleResult): { effects: EffectData[]; lootApplied: boolean } {
  const t = content.tunables.battle;
  const out: EffectData[] = [];

  // Men: killed, wounded and captured leave their containers (military's killMen).
  for (const row of lossesOf(setup, result)) {
    if (row.killed + row.wounded + row.captured <= 0) continue;
    if (!Object.hasOwn(content.balance.units, row.unit)) continue;
    const id = row.source.id;
    if (id === undefined) continue;
    const e: EffectData = { op: 'killMen', unit: row.unit, count: row.killed };
    if (row.wounded > 0) e.wounded = row.wounded;
    if (row.captured > 0) e.captured = row.captured;
    if (row.source.kind === 'fleet' && Object.hasOwn(state.fleets, id)) e.fleetId = id;
    else if (row.source.kind === 'army' && Object.hasOwn(state.armies, id)) e.armyId = id;
    else if (row.source.kind === 'settlement' && Object.hasOwn(state.settlements, id)) e.settlementId = id;
    else continue;
    out.push(e);
  }

  // Loot (§16.1–16.2): what the winners carried off, plus what burned, leaves the place.
  let lootApplied = false;
  const placeId = setup.settlementId;
  const place = placeId !== undefined ? state.settlements[placeId] : undefined;
  const pool = setup.loot;
  if (t.resultEffects.lootToWinner && pool) {
    // Only attackers carry wealth off — also raiders who reached their ships before falling back.
    const carried = result.lootValue > 0 || (result.lootSilver ?? 0) > 0 || Object.keys(result.lootGoods).length > 0;
    const taker = carried ? setup.attacker : null;
    const value = lootPoolValue(content.balance, pool);
    const takenShare = value > 0 ? Math.min(1, Math.max(0, result.lootValue) / value) : 0;
    const burnedShare = Math.min(1, Math.max(0, (result.lootBurnedShare ?? 0) * (setup.lootCeiling ?? 0)));
    const silverTaken = taker ? Math.min(Math.floor(pool.silver), Math.max(0, Math.floor(result.lootSilver ?? pool.silver * takenShare))) : 0;
    const silverBurned = Math.floor(pool.silver * burnedShare);
    if (place) {
      const silverOut = Math.min(Math.floor(place.silver), silverTaken + silverBurned);
      if (silverOut > 0) out.push({ op: 'addSilver', amount: -silverOut, settlementId: place.id });
      const stock = state.markets[place.id]?.stock;
      for (const good of Object.keys(pool.goods) as GoodId[]) {
        const tons = pool.goods[good] ?? 0;
        const taken = taker ? (result.lootGoods[good] ?? 0) : 0;
        const gone = roundTo(Math.min(stock?.[good] ?? 0, taken + tons * burnedShare), 0.01);
        if (stock && gone > 0) out.push({ op: 'addGoods', good, tons: -gone, settlementId: place.id });
      }
    }
    if (taker && (silverTaken > 0 || Object.keys(result.lootGoods).length > 0)) {
      const fleetId = taker.fleetId !== undefined && Object.hasOwn(state.fleets, taker.fleetId) ? taker.fleetId : undefined;
      if (silverTaken > 0) out.push(fleetId !== undefined ? { op: 'addSilver', amount: silverTaken, fleetId } : { op: 'addSilver', amount: silverTaken, factionId: taker.factionId });
      if (fleetId !== undefined) {
        for (const good of Object.keys(result.lootGoods) as GoodId[]) {
          const tons = result.lootGoods[good] ?? 0;
          if (tons > 0) out.push({ op: 'addGoods', good, tons, fleetId });
        }
      }
      lootApplied = true;
    }
  }

  // Pitch burned by fire arrows leaves the fleets' holds.
  for (const key of KEYS) {
    const used = result.pitchUsedT?.[key] ?? 0;
    const fleetId = sideOf(setup, key).fleetId;
    if (used <= 0 || fleetId === undefined || !Object.hasOwn(state.fleets, fleetId)) continue;
    const tons = roundTo(Math.min(used, state.fleets[fleetId]!.cargo.pitch ?? 0), 0.01);
    if (tons > 0) out.push({ op: 'addGoods', good: 'pitch', tons: -tons, fleetId });
  }

  // Named characters (off by default: the people module reacts to BattleEnded).
  if (t.resultEffects.characters) {
    const captorOf = (id: CharId) => {
      for (const key of KEYS) {
        const s = sideOf(setup, key);
        if (s.squads.some((sq) => sq.leaderId === id) || s.chiefId === id) return sideOf(setup, key === 'attacker' ? 'defender' : 'attacker').factionId;
      }
      return undefined;
    };
    for (const [id, fate] of Object.entries(result.leaderFates ?? {})) {
      if (!Object.hasOwn(state.characters, id)) continue;
      const charId = id as CharId;
      if (fate === 'dead') out.push({ op: 'kill', charId, cause: 'battle' });
      else if (fate === 'captured') {
        const by = captorOf(charId);
        if (by !== undefined && Object.hasOwn(state.factions, by)) out.push({ op: 'capture', charId, byFactionId: by, cause: 'battle' });
      } else if (fate !== 'fine') out.push({ op: 'woundCharacter', charId, wound: fate === 'mortallyWounded' ? 'mortal' : fate === 'seriouslyWounded' ? 'serious' : 'minor', cause: 'battle' });
    }
    for (const [id, amount] of Object.entries(result.xp)) {
      if (Object.hasOwn(state.characters, id) && amount > 0 && result.leaderFates?.[id] !== 'dead') out.push({ op: 'grantXp', charId: id, amount, source: 'battle' });
    }
  }
  return { effects: out, lootApplied };
}

/**
 * Applies effects one by one; an op with no registered owner, invalid parameters, or an EffectError
 * from its handler is skipped and reported as `op: reason`.
 */
export function applyEffectsChecked(ctx: SimContext, effects: readonly EffectData[]): string[] {
  const unapplied: string[] = [];
  for (const e of effects) {
    if (!ctx.env.effects.has(e.op)) {
      unapplied.push(`${e.op}: not registered`);
      continue;
    }
    const issues = validateEffects(ctx.env, [e], e.op);
    if (issues.length > 0) {
      unapplied.push(`${e.op}: ${issues.join('; ')}`);
      continue;
    }
    try {
      ctx.applyEffects([e]);
    } catch (err) {
      if (err instanceof EffectError) unapplied.push(`${e.op}: ${err.message}`);
      else throw err;
    }
  }
  return unapplied;
}

/** Checks a result against its setup (leaders, men counts, loot, xp); returns issues. */
export function validateBattleResult(setup: BattleSetup, result: BattleResult, content: Content): string[] {
  const issues: string[] = [];
  const data = battleData(content);
  for (const key of KEYS) {
    const side = sideOf(setup, key);
    const men = side.squads.reduce((a, sq) => a + sq.men, 0);
    const lost = result.casualties.filter((c) => c.side === key).reduce((a, c) => a + c.killed + c.wounded + c.captured, 0);
    if (lost > men) issues.push(`${key} lost ${lost} men of ${men}`);
    const leaders = side.squads.map((sq) => sq.leaderId);
    for (const c of result.casualties) if (c.side === key && !leaders.includes(c.leaderId)) issues.push(`${key} casualties for unknown leader ${c.leaderId}`);
  }
  for (const row of result.squadLosses ?? []) {
    const side = sideOf(setup, row.side);
    const from = side.squads.filter((sq) => sq.unit === row.unit).reduce((a, sq) => a + (sq.sources ?? []).filter((s) => s.kind === row.source.kind && s.id === row.source.id).reduce((n, s) => n + s.men, 0), 0);
    const explicit = row.source.kind === 'explicit' && row.source.id === undefined;
    if (!explicit && row.killed + row.wounded + row.captured > from) issues.push(`${row.side} ${row.unit} from ${row.source.kind} ${row.source.id ?? ''} lost more men than it brought`);
  }
  const named = new Set<string>([...setup.attacker.squads, ...setup.defender.squads].filter((sq) => sq.unnamed !== true).map((sq) => sq.leaderId));
  if (setup.attacker.chiefId) named.add(setup.attacker.chiefId);
  if (setup.defender.chiefId) named.add(setup.defender.chiefId);
  for (const id of Object.keys(result.xp)) if (!named.has(id)) issues.push(`xp for ${id}, who did not lead a squad`);
  for (const id of Object.keys(result.leaderFates ?? {})) if (!named.has(id)) issues.push(`fate for ${id}, who did not lead a squad`);
  const pool = lootPoolValue(data.balance, setup.loot);
  const ceiling = setup.lootCeiling ?? 0;
  if (result.lootValue > pool * Math.max(ceiling, data.balance.autoresolve.manualLootMax) + 1) issues.push(`loot ${result.lootValue} exceeds what the place held`);
  return issues;
}
