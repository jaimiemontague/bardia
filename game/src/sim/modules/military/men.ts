/**
 * Men in containers — settlement garrisons, holding pools, fleets and armies — with veterancy (average
 * battles per unit type) and wounded men (§12.1 casualties, §12.3 squads, §12.6 veterancy and
 * wounded). Implements the addMen, killMen, moveMen and spawnArmy effects, daily wounded recovery and
 * the veterancy reactions to BattleEnded / SeaBattleEnded.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { baseState } from '@sim/core/context';
import { EffectError } from '@sim/core/effects';
import type { SimEventOf } from '@sim/core/events';
import type { SimContext } from '@sim/core/module';
import type {
  Army,
  ArmyId,
  CharId,
  FactionId,
  Fleet,
  FleetId,
  GameState,
  Settlement,
  SettlementId,
  Squad,
  UnitTypeId,
} from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { addToPool } from './pools';
import { charModifier, factionCapitalId, recNum, realmModifier, round2 } from './realm';
import { militaryOf } from './slice';
import type {
  AddMenEffect,
  DisbandArmyEffect,
  KillMenEffect,
  MenContainerKind,
  MenContainerRef,
  MenRecord,
  MoveMenEffect,
  SpawnArmyEffect,
  WoundedBatch,
} from './types';
import { battlesForStars, findUnit, vetStarsFor } from './units';

/** A live handle on one container inside a draft. */
export interface MenContainer {
  readonly kind: Exclude<MenContainerKind, 'pool'>;
  readonly id: string;
  readonly ownerId: FactionId | undefined;
  /** Holding whose population the men come from. */
  readonly homeId: SettlementId | undefined;
  /** The settlement, fleet or army object (draft) the container lives on. */
  readonly host: WoundedHost;
  count(unit: UnitTypeId): number;
  battles(unit: UnitTypeId): number;
  units(): UnitTypeId[];
  /** Adds men, merging their battles into the container's average. */
  add(unit: UnitTypeId, n: number, battles: number): void;
  /** Removes up to `n` men; returns how many were removed. */
  remove(unit: UnitTypeId, n: number): number;
  /** The wounded list (created on demand). */
  wounded(create: true): WoundedBatch[];
  wounded(create: false): WoundedBatch[] | undefined;
}

/** Weighted average of two battle counts. */
export function mergeBattles(have: number, haveBattles: number, add: number, addBattles: number): number {
  const total = have + add;
  return total <= 0 ? 0 : round2((have * haveBattles + add * addBattles) / total);
}

function recordContainer(
  kind: 'settlement' | 'fleet',
  id: string,
  ownerId: FactionId | undefined,
  homeId: SettlementId | undefined,
  host: WoundedHost & { vetBattles?: Record<UnitTypeId, number> },
  men: Record<UnitTypeId, number>,
): MenContainer {
  const c: MenContainer = {
    kind,
    id,
    ownerId,
    homeId,
    host,
    count: (unit) => recNum(men, unit),
    battles: (unit) => (host.vetBattles ? recNum(host.vetBattles, unit) : 0),
    units: () => Object.keys(men).filter((u) => recNum(men, u) > 0),
    add(unit, n, battles) {
      if (n <= 0) return;
      const have = recNum(men, unit);
      const merged = mergeBattles(have, c.battles(unit), n, battles);
      men[unit] = have + n;
      if (merged > 0) {
        host.vetBattles ??= {};
        host.vetBattles[unit] = merged;
      } else if (host.vetBattles && Object.hasOwn(host.vetBattles, unit)) delete host.vetBattles[unit];
    },
    remove(unit, n) {
      const have = recNum(men, unit);
      const r = Math.min(have, Math.max(0, n));
      if (r <= 0) return 0;
      if (have - r > 0) men[unit] = have - r;
      else {
        delete men[unit];
        if (host.vetBattles && Object.hasOwn(host.vetBattles, unit)) delete host.vetBattles[unit];
      }
      return r;
    },
    wounded: ((create: boolean) => {
      if (create) host.woundedMen ??= [];
      return host.woundedMen;
    }) as MenContainer['wounded'],
  };
  return c;
}

function armyContainer(draft: GameState, content: Content, army: Army): MenContainer {
  const c: MenContainer = {
    kind: 'army',
    id: army.id,
    ownerId: army.ownerId,
    homeId: army.homeId ?? factionCapitalId(draft, army.ownerId),
    host: army,
    count(unit) {
      let n = 0;
      for (const sq of army.squads) if (sq.unit === unit) n += Math.max(0, sq.men);
      return n;
    },
    battles(unit) {
      let men = 0;
      let weighted = 0;
      for (const sq of army.squads) {
        if (sq.unit !== unit || sq.men <= 0) continue;
        men += sq.men;
        weighted += sq.men * (sq.battles ?? battlesForStars(content.balance, sq.vetStars));
      }
      return men > 0 ? round2(weighted / men) : 0;
    },
    units() {
      const out: UnitTypeId[] = [];
      for (const sq of army.squads) if (sq.men > 0 && !out.includes(sq.unit)) out.push(sq.unit);
      return out;
    },
    add(unit, n, battles) {
      if (n <= 0) return;
      const squad = army.squads.find((sq) => sq.unit === unit);
      if (squad) {
        const before = squad.battles ?? battlesForStars(content.balance, squad.vetStars);
        squad.battles = mergeBattles(squad.men, before, n, battles);
        squad.men += n;
        squad.vetStars = vetStarsFor(content.balance, squad.battles);
        return;
      }
      const def = findUnit(content.balance, unit);
      const fresh: Squad = {
        leaderId: army.leaderId,
        unit,
        men: n,
        vetStars: vetStarsFor(content.balance, battles),
        formation: def?.formations[0] ?? 'line',
        battles: round2(battles),
      };
      army.squads.push(fresh);
    },
    remove(unit, n) {
      let left = Math.max(0, n);
      let removed = 0;
      for (let i = army.squads.length - 1; i >= 0 && left > 0; i--) {
        const sq = army.squads[i] as Squad;
        if (sq.unit !== unit || sq.men <= 0) continue;
        const r = Math.min(sq.men, left);
        sq.men -= r;
        left -= r;
        removed += r;
      }
      if (removed > 0) army.squads = army.squads.filter((sq) => sq.men > 0);
      return removed;
    },
    wounded: ((create: boolean) => {
      if (create) army.woundedMen ??= [];
      return army.woundedMen;
    }) as MenContainer['wounded'],
  };
  return c;
}

/** Handle on a settlement garrison. */
export function settlementContainer(draft: GameState, s: Settlement): MenContainer {
  return recordContainer('settlement', s.id, s.factionId, s.id, s, s.garrison);
}

/** Handle on a fleet. */
export function fleetContainer(draft: GameState, fleet: Fleet): MenContainer {
  return recordContainer('fleet', fleet.id, fleet.ownerId, factionCapitalId(draft, fleet.ownerId), fleet, fleet.men);
}

/** True if the ref names more than one container. */
function refCount(ref: MenContainerRef): number {
  return (ref.settlementId !== undefined ? 1 : 0) + (ref.fleetId !== undefined ? 1 : 0) + (ref.armyId !== undefined ? 1 : 0);
}

/**
 * Resolves a container ref inside a draft. Without an id: the player's expedition fleet if it exists,
 * else the player's capital garrison. Throws EffectError for unknown ids or ambiguous refs.
 */
export function resolveContainer(draft: GameState, content: Content, ref: MenContainerRef, what: string): MenContainer {
  if (refCount(ref) > 1) throw new EffectError(`${what}: name only one of settlementId, fleetId, armyId`);
  if (ref.fleetId !== undefined) {
    const fleet = draft.fleets[ref.fleetId];
    if (!fleet) throw new EffectError(`${what}: unknown fleet ${ref.fleetId}`);
    return fleetContainer(draft, fleet);
  }
  if (ref.armyId !== undefined) {
    const army = draft.armies[ref.armyId];
    if (!army) throw new EffectError(`${what}: unknown army ${ref.armyId}`);
    return armyContainer(draft, content, army);
  }
  if (ref.settlementId !== undefined) {
    const s = draft.settlements[ref.settlementId];
    if (!s) throw new EffectError(`${what}: unknown settlement ${ref.settlementId}`);
    return settlementContainer(draft, s);
  }
  const expedition = draft.player.expeditionFleetId;
  if (expedition !== undefined) {
    const fleet = draft.fleets[expedition];
    if (fleet) return fleetContainer(draft, fleet);
  }
  const capital = draft.settlements[draft.player.capitalId];
  if (!capital) throw new EffectError(`${what}: no container given and the player has no capital`);
  return settlementContainer(draft, capital);
}

/** The host object of a container (settlement, fleet or army) as the wounded logic reads it. */
export interface WoundedHost {
  woundedMen?: WoundedBatch[];
  mode?: string;
  ownerId?: FactionId;
  leaderId?: CharId;
  factionId?: FactionId;
  holding?: { governorId: CharId };
}

/** Wounded men's recovery per day in a container right now (home or field rate x recovery modifiers). */
export function woundedRate(
  state: GameState,
  content: Content,
  kind: MenContainer['kind'],
  host: WoundedHost,
  realmCache: Record<string, number> = {},
  modded: boolean = anyModifier(content, 'wounded.recoveryPct'),
): number {
  const sq = content.balance.squads;
  const home = 1 / Math.max(1, sq.woundedRecoveryHomeDays);
  const field = 1 / Math.max(1, sq.woundedRecoverySeaDays);
  let rate = field;
  let ownerId: FactionId | undefined;
  let leaderId: CharId | undefined;
  if (kind === 'settlement') {
    rate = home;
    ownerId = host.factionId;
    leaderId = host.holding?.governorId ?? host.leaderId;
  } else {
    if (kind === 'fleet' && host.mode !== undefined && content.tunables.military.wounded.homeFleetModes.includes(host.mode)) rate = home;
    ownerId = host.ownerId;
    leaderId = host.leaderId;
  }
  return modded ? rate * recoveryMult(state, content, ownerId, leaderId, realmCache) : rate;
}

/** Progress of a wounded batch at an hour (stored progress plus the rate since `sinceHour`). */
export function woundedProgressAt(batch: WoundedBatch, hour: number): number {
  // Batches written without a rate or start hour (by hand, or older data) count from now.
  const rate = Number.isFinite(batch.rate) ? batch.rate : 0;
  const since = Number.isFinite(batch.sinceHour) ? batch.sinceHour : hour;
  const progress = Number.isFinite(batch.progress) ? batch.progress : 0;
  return progress + (rate * (hour - since)) / HOURS_PER_DAY;
}

/** Adds wounded men to a container (merging with a batch wounded the same hour) and indexes the container. */
export function addWounded(draft: GameState, content: Content, c: MenContainer, unit: UnitTypeId, count: number, battles: number): void {
  if (count <= 0) return;
  const hour = draft.time.hour;
  const rate = woundedRate(draft, content, c.kind, c.host);
  const list = c.wounded(true);
  const fresh = list.find((b) => b.unit === unit && b.sinceHour === hour && b.progress === 0 && b.rate === rate);
  if (fresh) {
    fresh.battles = mergeBattles(fresh.count, fresh.battles, count, battles);
    fresh.count += count;
  } else list.push({ unit, count, progress: 0, battles: round2(battles), sinceHour: hour, rate });
  const m = militaryOf(draft);
  m.woundedDirty ??= {};
  m.woundedDirty[c.id] = hour;
}

function assertUnit(balance: Balance, unit: string, what: string): void {
  if (!findUnit(balance, unit)) throw new EffectError(`${what}: unknown unit '${unit}'`);
}

function wholeNumber(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new EffectError(`${what} must be a finite number`);
  return Math.round(value);
}

/** addMen effect. */
export function applyAddMen(draft: GameState, e: AddMenEffect, ctx: SimContext): void {
  assertUnit(ctx.balance, e.unit, 'addMen');
  const count = wholeNumber(e.count, 'addMen.count');
  const battles = Math.max(0, e.battles ?? 0);
  if (e.pool === true) {
    if (e.settlementId === undefined) throw new EffectError('addMen: pool needs settlementId');
    const holding = draft.settlements[e.settlementId]?.holding;
    if (!holding) throw new EffectError(`addMen: ${e.settlementId} is not a holding`);
    if (count > 0) addToPool(ctx.balance, holding, e.unit, count, battles);
    else holding.pool.current = Math.max(0, holding.pool.current + count);
    return;
  }
  const c = resolveContainer(draft, ctx.content, e, 'addMen');
  if (count >= 0) {
    if (e.wounded === true) addWounded(draft, ctx.content, c, e.unit, count, battles);
    else c.add(e.unit, count, battles);
  } else c.remove(e.unit, -count);
}

/** killMen effect: casualties (killed, wounded, captured) with the home population loss. */
export function applyKillMen(draft: GameState, e: KillMenEffect, ctx: SimContext): void {
  assertUnit(ctx.balance, e.unit, 'killMen');
  if (e.pool === true) throw new EffectError('killMen: men in a pool are not under arms');
  const c = resolveContainer(draft, ctx.content, e, 'killMen');
  let available = c.count(e.unit);
  const killed = Math.min(available, Math.max(0, wholeNumber(e.count, 'killMen.count')));
  available -= killed;
  const wounded = Math.min(available, Math.max(0, wholeNumber(e.wounded ?? 0, 'killMen.wounded')));
  available -= wounded;
  const captured = Math.min(available, Math.max(0, wholeNumber(e.captured ?? 0, 'killMen.captured')));
  if (killed + wounded + captured <= 0) return;
  const battles = c.battles(e.unit);
  c.remove(e.unit, killed + wounded + captured);
  addWounded(draft, ctx.content, c, e.unit, wounded, battles);
  let homeId: SettlementId | undefined;
  if (e.popLoss !== false && killed + captured > 0) {
    const candidate = e.homeId ?? c.homeId;
    const home = candidate !== undefined ? draft.settlements[candidate] : undefined;
    if (home && (e.homeId !== undefined || c.ownerId === undefined || home.factionId === c.ownerId)) {
      home.pop = Math.max(0, home.pop - (killed + captured));
      homeId = home.id;
    }
  }
  const event: SimEventOf<'MenLost'> = {
    type: 'MenLost',
    unit: e.unit,
    killed,
    wounded,
    captured,
    container: { kind: c.kind, id: c.id },
  };
  if (c.ownerId !== undefined) event.factionId = c.ownerId;
  if (homeId !== undefined) event.homeId = homeId;
  ctx.emit(event);
}

/** moveMen effect: men change containers with their veterancy. */
export function applyMoveMen(draft: GameState, e: MoveMenEffect, ctx: SimContext): void {
  if (e.from.pool === true) throw new EffectError('moveMen: men leave a pool only through a muster');
  const from = resolveContainer(draft, ctx.content, e.from, 'moveMen.from');
  let poolHolding: Settlement['holding'];
  let to: MenContainer | undefined;
  if (e.to.pool === true) {
    if (e.to.settlementId === undefined) throw new EffectError('moveMen: pool needs settlementId');
    poolHolding = draft.settlements[e.to.settlementId]?.holding;
    if (!poolHolding) throw new EffectError(`moveMen: ${e.to.settlementId} is not a holding`);
  } else to = resolveContainer(draft, ctx.content, e.to, 'moveMen.to');
  if (to && to.kind === from.kind && to.id === from.id) return;
  for (const unit of Object.keys(e.men)) {
    assertUnit(ctx.balance, unit, 'moveMen');
    const want = Math.max(0, wholeNumber(recNum(e.men, unit), 'moveMen.men'));
    const battles = from.battles(unit);
    const n = from.remove(unit, want);
    if (n <= 0) continue;
    if (to) to.add(unit, n, battles);
    else if (poolHolding) addToPool(ctx.balance, poolHolding, unit, n, battles);
  }
  if (e.wounded === true) moveWounded(draft, ctx, from, to, poolHolding);
}

/**
 * Moves every wounded batch of `from` to `to` (a fleet disbanding at home, men carried ashore). Each
 * batch keeps its progress so far and continues at the target's rate. Wounded sent to a pool go home
 * to heal there and rejoin the pool at once (they are no longer under arms).
 */
function moveWounded(draft: GameState, ctx: SimContext, from: MenContainer, to: MenContainer | undefined, pool: Settlement['holding']): void {
  const list = from.wounded(false);
  if (!list || list.length === 0) return;
  const now = draft.time.hour;
  const batches = list.map((b) => ({ unit: b.unit, count: b.count, battles: b.battles, progress: Math.max(0, woundedProgressAt(b, now)) }));
  list.length = 0;
  if (pool) {
    for (const b of batches) addToPool(ctx.balance, pool, b.unit, b.count, b.battles);
    return;
  }
  if (!to) return;
  const rate = woundedRate(draft, ctx.content, to.kind, to.host);
  const target = to.wounded(true);
  for (const b of batches) target.push({ unit: b.unit, count: b.count, battles: b.battles, progress: Math.min(b.progress, 1 - 1e-6), sinceHour: now, rate });
  const m = militaryOf(draft);
  m.woundedDirty ??= {};
  m.woundedDirty[from.id] = now;
  m.woundedDirty[to.id] = now;
}

/** spawnArmy effect. */
export function applySpawnArmy(draft: GameState, e: SpawnArmyEffect, ctx: SimContext): void {
  const ownerId = e.ownerId ?? draft.player.factionId;
  const owner = draft.factions[ownerId];
  if (!owner) throw new EffectError(`spawnArmy: unknown faction ${ownerId}`);
  const leaderId: CharId = e.leaderId ?? owner.rulerId;
  if (!draft.characters[leaderId]) throw new EffectError(`spawnArmy: unknown leader ${leaderId}`);
  if (e.squads.length === 0) throw new EffectError('spawnArmy: needs at least one squad');
  let pos = e.pos;
  if (pos === undefined) {
    const at = e.settlementId ?? factionCapitalId(draft, ownerId);
    const s = at !== undefined ? draft.settlements[at] : undefined;
    if (e.settlementId !== undefined && !s) throw new EffectError(`spawnArmy: unknown settlement ${e.settlementId}`);
    pos = s ? s.mapPos : { x: 0, y: 0 };
  }
  const squads: Squad[] = e.squads.map((spec, i) => {
    const def = findUnit(ctx.balance, spec.unit);
    if (!def) throw new EffectError(`spawnArmy.squads[${i}]: unknown unit '${spec.unit}'`);
    const men = wholeNumber(spec.men, `spawnArmy.squads[${i}].men`);
    if (men <= 0) throw new EffectError(`spawnArmy.squads[${i}].men must be positive`);
    const stars = spec.vetStars ?? 0;
    const formation = spec.formation !== undefined && def.formations.includes(spec.formation) ? spec.formation : (def.formations[0] ?? 'line');
    return {
      leaderId: spec.leaderId ?? leaderId,
      unit: spec.unit,
      men,
      vetStars: stars,
      formation,
      battles: battlesForStars(ctx.balance, stars),
    };
  });
  const id: ArmyId = ctx.newId('arm');
  const army: Army = { id, ownerId, leaderId, squads, pos: { x: pos.x, y: pos.y }, route: [] };
  const homeId = e.homeId ?? e.settlementId;
  if (homeId !== undefined) army.homeId = homeId;
  if (e.tag !== undefined) army.spawnTag = e.tag;
  draft.armies[id] = army;
  militaryOf(draft).lastSpawnedArmyId = id;
  const event: SimEventOf<'ArmySpawned'> = { type: 'ArmySpawned', armyId: id, ownerId };
  if (e.tag !== undefined) event.tag = e.tag;
  ctx.emit(event);
}

// ---------------------------------------------------------------------------------------------
// Wounded recovery (daily)

/** True if any trait, feat or culture bonus in the content carries the modifier key. */
function anyModifier(content: Content, key: string): boolean {
  for (const t of Object.values(content.traits)) if (Object.hasOwn(t.modifiers, key)) return true;
  for (const f of Object.values(content.feats)) if (Object.hasOwn(f.modifiers, key)) return true;
  for (const c of Object.values(content.cultures)) for (const b of c.bonuses) if (Object.hasOwn(b.modifiers, key)) return true;
  return false;
}

/**
 * Recovery speed multiplier from `wounded.recoveryPct` modifiers of the container's leader and the
 * owner's realm (rune-seer herbs, relics …). Read from the operation's base state (modifiers do not
 * change within a tick) and cached per faction for the pass.
 */
function recoveryMult(
  draft: GameState,
  content: Content,
  ownerId: FactionId | undefined,
  leaderId: CharId | undefined,
  realmCache: Record<string, number>,
): number {
  let pct = 0;
  if (leaderId !== undefined) pct += charModifier(content, baseState(draft.characters)[leaderId], 'wounded.recoveryPct');
  if (ownerId !== undefined) {
    if (!Object.hasOwn(realmCache, ownerId)) realmCache[ownerId] = realmModifier(baseState(draft), content, ownerId, 'wounded.recoveryPct');
    pct += realmCache[ownerId] ?? 0;
  }
  return Math.max(0, 1 + pct / 100);
}

/** Brings a container's batches up to date: recovered men rejoin, changed rates are rebased. */
function updateContainer(draft: GameState, ctx: SimContext, c: MenContainer, rate: number): void {
  const list = c.wounded(false);
  if (!list || list.length === 0) return;
  const now = draft.time.hour;
  const back: MenRecord = {};
  let any = false;
  const keep: WoundedBatch[] = [];
  for (const batch of list) {
    const progress = woundedProgressAt(batch, now);
    if (progress >= 1 - 1e-9) {
      c.add(batch.unit, batch.count, batch.battles);
      back[batch.unit] = recNum(back, batch.unit) + batch.count;
      any = true;
      continue;
    }
    if (batch.rate !== rate) {
      batch.progress = Math.max(0, progress);
      batch.sinceHour = now;
      batch.rate = rate;
    }
    keep.push(batch);
  }
  if (keep.length !== list.length) {
    list.length = 0;
    for (const b of keep) list.push(b);
  }
  if (!any) return;
  const event: SimEventOf<'WoundedRecovered'> = { type: 'WoundedRecovered', container: { kind: c.kind, id: c.id }, men: back };
  if (c.ownerId !== undefined) event.factionId = c.ownerId;
  ctx.emit(event);
}

/** A container's host object (settlement, fleet or army) in a state, by id prefix. */
function hostIn(state: GameState, id: string): { kind: MenContainer['kind']; host: WoundedHost } | undefined {
  if (id.startsWith('set_')) {
    const s = state.settlements[id as SettlementId];
    return s ? { kind: 'settlement', host: s } : undefined;
  }
  if (id.startsWith('flt_')) {
    const f = state.fleets[id as FleetId];
    return f ? { kind: 'fleet', host: f } : undefined;
  }
  if (id.startsWith('arm_')) {
    const a = state.armies[id as ArmyId];
    return a ? { kind: 'army', host: a } : undefined;
  }
  return undefined;
}

/** Live handle on a container in a draft, by id prefix. */
function containerFor(draft: GameState, content: Content, id: string): MenContainer | undefined {
  if (id.startsWith('set_')) {
    const s = draft.settlements[id as SettlementId];
    return s ? settlementContainer(draft, s) : undefined;
  }
  if (id.startsWith('flt_')) {
    const f = draft.fleets[id as FleetId];
    return f ? fleetContainer(draft, f) : undefined;
  }
  if (id.startsWith('arm_')) {
    const a = draft.armies[id as ArmyId];
    return a ? armyContainer(draft, content, a) : undefined;
  }
  return undefined;
}

/**
 * Daily: wounded men recover (§12.6: 30 days at home and in harbour, 60 at sea and in the field).
 * Each batch keeps its progress as of `sinceHour` and a daily `rate`, so a container is only written
 * when men recover or the rate changes (a fleet docks or sails). Containers whose wounded have not
 * changed in this operation are read from the base state (no proxies); `woundedDirty` records when this
 * module last wrote each container, and those written since the operation began (base `time.hour`) are
 * read through the draft; together with a scan of the base tables this finds every wounded batch. Fleet modes changed by other modules earlier in the same operation are seen
 * at the next operation.
 */
export function dailyWounded(draft: GameState, ctx: SimContext): void {
  const m0 = draft.military;
  const base = baseState(draft);
  const opStart = base.time.hour;
  const ids: string[] = [];
  const seen: Record<string, true> = {};
  const note = (id: string) => {
    if (Object.hasOwn(seen, id)) return;
    seen[id] = true;
    ids.push(id);
  };
  const dirtyRec = m0?.woundedDirty;
  const dirty: Record<string, true> = {};
  let stale = false;
  if (dirtyRec) {
    for (const id of Object.keys(dirtyRec)) {
      if ((dirtyRec[id] ?? -1) >= opStart) {
        dirty[id] = true;
        note(id);
      } else stale = true;
    }
  }
  const scan = (table: Readonly<Record<string, { woundedMen?: WoundedBatch[] }>>) => {
    for (const id in table) if (table[id]?.woundedMen?.length) note(id);
  };
  scan(base.settlements);
  scan(base.fleets);
  scan(base.armies);
  if (ids.length === 0) return;
  const now = draft.time.hour;
  const written: string[] = [];
  const realmCache: Record<string, number> = {};
  const modded = anyModifier(ctx.content, 'wounded.recoveryPct');
  for (const id of ids) {
    const read = hostIn(Object.hasOwn(dirty, id) ? draft : base, id);
    const batches = read?.host.woundedMen;
    if (!read || !batches || batches.length === 0) continue;
    const rate = woundedRate(base, ctx.content, read.kind, read.host, realmCache, modded);
    const due = batches.some((b) => b.rate !== rate || woundedProgressAt(b, now) >= 1 - 1e-9);
    if (!due) continue;
    const c = containerFor(draft, ctx.content, id);
    if (!c) continue;
    updateContainer(draft, ctx, c, rate);
    written.push(id);
  }
  if (written.length > 0 || stale) {
    const m = militaryOf(draft);
    const rec = (m.woundedDirty ??= {});
    for (const id of Object.keys(rec)) if ((rec[id] ?? -1) < opStart) delete rec[id];
    for (const id of written) rec[id] = now;
    if (Object.keys(rec).length === 0) delete m.woundedDirty;
  }
}

// ---------------------------------------------------------------------------------------------
// Veterancy after battles

interface LooseSquad {
  unit?: unknown;
  sources?: unknown;
}
interface LooseSource {
  kind?: unknown;
  id?: unknown;
}

function looseSquads(side: unknown): LooseSquad[] {
  const squads = (side as { squads?: unknown } | undefined)?.squads;
  return Array.isArray(squads) ? (squads as LooseSquad[]) : [];
}

/** Adds one battle to every (container, unit) that fought, if men of that unit are still there. */
function bumpVeterancy(draft: GameState, content: Content, kind: string, id: string, unit: string, done: Record<string, true>): void {
  const key = `${kind}|${id}|${unit}`;
  if (Object.hasOwn(done, key)) return;
  done[key] = true;
  if (kind === 'army') {
    const army = draft.armies[id as ArmyId];
    if (!army) return;
    for (const sq of army.squads) {
      if (sq.unit !== unit || sq.men <= 0) continue;
      sq.battles = round2((sq.battles ?? battlesForStars(content.balance, sq.vetStars)) + 1);
      sq.vetStars = vetStarsFor(content.balance, sq.battles);
    }
    return;
  }
  let host: { vetBattles?: Record<UnitTypeId, number> } | undefined;
  let men: Record<UnitTypeId, number> | undefined;
  if (kind === 'fleet') {
    const f = draft.fleets[id as FleetId];
    host = f;
    men = f?.men;
  } else if (kind === 'settlement') {
    const s = draft.settlements[id as SettlementId];
    host = s;
    men = s?.garrison;
  }
  if (!host || !men || recNum(men, unit) <= 0) return;
  host.vetBattles ??= {};
  host.vetBattles[unit] = round2(recNum(host.vetBattles, unit) + 1);
}

function rememberBattle(draft: GameState, ctx: SimContext, id: string): boolean {
  const m = militaryOf(draft);
  if (m.battlesApplied.includes(id)) return false;
  m.battlesApplied.push(id);
  const cap = ctx.tunables.military.battlesRemembered;
  if (m.battlesApplied.length > cap) m.battlesApplied.splice(0, m.battlesApplied.length - cap);
  return true;
}

/**
 * Reaction to BattleEnded (owned by the battle sub-sim; read defensively): every squad's source
 * containers gain a battle for that unit type (§12.6), and the player's victories/defeats are counted
 * for the monthly lieutenant loyalty pass (§12.5).
 */
export function onBattleEnded(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = event as {
    battleId?: unknown;
    attackerFactionId?: unknown;
    defenderFactionId?: unknown;
    playerSide?: unknown;
    result?: { winner?: unknown };
    setup?: { attacker?: unknown; defender?: unknown };
  };
  if (typeof e.battleId !== 'string' || !rememberBattle(draft, ctx, e.battleId)) return;
  const done: Record<string, true> = {};
  for (const side of [e.setup?.attacker, e.setup?.defender]) {
    for (const sq of looseSquads(side)) {
      if (typeof sq.unit !== 'string' || !Array.isArray(sq.sources)) continue;
      for (const src of sq.sources as LooseSource[]) {
        if (typeof src.kind !== 'string' || typeof src.id !== 'string') continue;
        bumpVeterancy(draft, ctx.content, src.kind, src.id, sq.unit, done);
      }
    }
  }
  const player = draft.player.factionId;
  let side: string | undefined = typeof e.playerSide === 'string' ? e.playerSide : undefined;
  if (side === undefined) {
    if (e.attackerFactionId === player) side = 'attacker';
    else if (e.defenderFactionId === player) side = 'defender';
  }
  const winner = e.result?.winner;
  if (side === undefined || (winner !== 'attacker' && winner !== 'defender')) return;
  const mb = militaryOf(draft).monthBattles;
  if (winner === side) mb.won += 1;
  else mb.lost += 1;
}

/** Reaction to SeaBattleEnded (owned by the sea-battle sub-sim; read defensively): both fleets' crews gain a battle. */
export function onSeaBattleEnded(draft: GameState, event: unknown, ctx: SimContext): void {
  const e = event as {
    seaBattleId?: unknown;
    setup?: { attacker?: { fleetId?: unknown; isPlayer?: unknown }; defender?: { fleetId?: unknown; isPlayer?: unknown } };
    result?: { winner?: unknown };
  };
  if (typeof e.seaBattleId !== 'string' || !rememberBattle(draft, ctx, e.seaBattleId)) return;
  const done: Record<string, true> = {};
  for (const side of [e.setup?.attacker, e.setup?.defender]) {
    const fleetId = side?.fleetId;
    if (typeof fleetId !== 'string') continue;
    const fleet = draft.fleets[fleetId as FleetId];
    if (!fleet) continue;
    for (const unit of Object.keys(fleet.men)) bumpVeterancy(draft, ctx.content, 'fleet', fleetId, unit, done);
  }
  const winner = e.result?.winner;
  const attackerIsPlayer = e.setup?.attacker?.isPlayer === true;
  const defenderIsPlayer = e.setup?.defender?.isPlayer === true;
  if (!attackerIsPlayer && !defenderIsPlayer) return;
  if (winner !== 'attacker' && winner !== 'defender') return;
  const mb = militaryOf(draft).monthBattles;
  if ((winner === 'attacker') === attackerIsPlayer) mb.won += 1;
  else mb.lost += 1;
}

// ---------------------------------------------------------------------------------------------
// Realm men counts (pure)

/** Σ men in a record. */
export function sumMen(men: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const unit of Object.keys(men)) n += recNum(men, unit);
  return n;
}

function woundedSum(list: readonly WoundedBatch[] | undefined, unit?: string): number {
  if (!list) return 0;
  let n = 0;
  for (const b of list) if (unit === undefined || b.unit === unit) n += b.count;
  return n;
}

/**
 * Men a faction has under arms (garrisons of its settlements, fleets, armies), optionally of one unit
 * type; `wounded`, `gathering` (musters) and `transit` (transfers) are counted separately.
 */
export function realmMen(
  state: GameState,
  factionId: FactionId,
  unit?: UnitTypeId,
): { active: number; wounded: number; gathering: number; transit: number; total: number } {
  let active = 0;
  let wounded = 0;
  const faction = state.factions[factionId];
  const count = (men: Readonly<Record<string, number>>) => (unit === undefined ? sumMen(men) : recNum(men, unit));
  if (faction) {
    for (const id of faction.holdingIds) {
      const s = state.settlements[id];
      if (!s || s.factionId !== factionId) continue;
      active += count(s.garrison);
      wounded += woundedSum(s.woundedMen, unit);
    }
  }
  for (const id in state.fleets) {
    const f = state.fleets[id as FleetId];
    if (!f || f.ownerId !== factionId) continue;
    active += count(f.men);
    wounded += woundedSum(f.woundedMen, unit);
  }
  for (const id in state.armies) {
    const a = state.armies[id as ArmyId];
    if (!a || a.ownerId !== factionId) continue;
    for (const sq of a.squads) if (unit === undefined || sq.unit === unit) active += Math.max(0, sq.men);
    wounded += woundedSum(a.woundedMen, unit);
  }
  let gathering = 0;
  let transit = 0;
  const m = state.military;
  if (m) {
    for (const mu of m.musters) if (mu.factionId === factionId) gathering += count(mu.units);
    for (const t of m.transfers) if (t.factionId === factionId) transit += count(t.men);
  }
  return { active, wounded, gathering, transit, total: active + wounded + gathering + transit };
}

/** Men of one container (fleet, settlement garrison or army) by id, optionally of one unit. */
export function containerMen(state: GameState, id: string, unit?: UnitTypeId): number {
  if (id.startsWith('flt_')) {
    const f = state.fleets[id as FleetId];
    return f ? (unit === undefined ? sumMen(f.men) : recNum(f.men, unit)) : 0;
  }
  if (id.startsWith('set_')) {
    const s = state.settlements[id as SettlementId];
    return s ? (unit === undefined ? sumMen(s.garrison) : recNum(s.garrison, unit)) : 0;
  }
  if (id.startsWith('arm_')) {
    const a = state.armies[id as ArmyId];
    if (!a) return 0;
    let n = 0;
    for (const sq of a.squads) if (unit === undefined || sq.unit === unit) n += Math.max(0, sq.men);
    return n;
  }
  return 0;
}

/** Average battles and stars of one unit type in a container (pure; for the client and conditions). */
export function containerVeterancy(state: GameState, balance: Balance, id: string, unit: UnitTypeId): { battles: number; stars: 0 | 1 | 2 | 3 } {
  let battles = 0;
  if (id.startsWith('flt_')) battles = recNum(state.fleets[id as FleetId]?.vetBattles, unit);
  else if (id.startsWith('set_')) battles = recNum(state.settlements[id as SettlementId]?.vetBattles, unit);
  else if (id.startsWith('arm_')) {
    const a = state.armies[id as ArmyId];
    let men = 0;
    let weighted = 0;
    for (const sq of a?.squads ?? []) {
      if (sq.unit !== unit || sq.men <= 0) continue;
      men += sq.men;
      weighted += sq.men * (sq.battles ?? battlesForStars(balance, sq.vetStars));
    }
    battles = men > 0 ? round2(weighted / men) : 0;
  }
  return { battles, stars: vetStarsFor(balance, battles) };
}

/** disbandArmy effect: the men (and wounded) move to `to` (default: the home holding's pool) and the army is removed. */
export function applyDisbandArmy(draft: GameState, e: DisbandArmyEffect, ctx: SimContext): void {
  const army = draft.armies[e.armyId];
  if (!army) throw new EffectError(`disbandArmy: unknown army ${e.armyId}`);
  const men: Record<string, number> = {};
  for (const sq of army.squads) if (sq.men > 0) men[sq.unit] = (men[sq.unit] ?? 0) + sq.men;
  const home = (army as Army & { homeId?: SettlementId }).homeId ?? factionCapitalId(draft, army.ownerId);
  const to: MenContainerRef | undefined = e.to ?? (home !== undefined ? { settlementId: home, pool: true } : undefined);
  if (to !== undefined && (Object.keys(men).length > 0 || to.pool !== true)) applyMoveMen(draft, { from: { armyId: e.armyId }, to, men, wounded: true }, ctx);
  delete draft.armies[e.armyId];
}
