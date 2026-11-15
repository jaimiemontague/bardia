/**
 * Answers to an encounter card (design §8.6, §15.1, §31.4) and their consequences, applied through the
 * owners' effects: core silver, goods, rations, standings, opinion and chronicle; news hearNews/addNews;
 * intel observeSettlement; people grantXp/woundCharacter; military killMen; battle startBattle and
 * seabattle startSeaBattle. Ops of modules that are not loaded are skipped (subset runs, unit tests).
 * Fleet morale and crew stamina have no owner op: they are written directly (as economy's arrears and
 * world's rowing do), clamped to 0..100.
 */
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { Rng } from '@sim/core/rng';
import type { CharId, FactionId, Fleet, GameState, GoodId, PendingDecision, Squad, TextVars } from '@sim/core/state';
import { composeEncounter, nearbySettlements, type EncounterPayloadFull, zoneInfo } from './generate';
import { bestAt, companions, dailyFood, encounterOptions, goodsValue, menTotal } from './rules';
import type { EncounterChoice, EncounterFight, EncounterKind, EncountersState } from './types';

type Effect = Record<string, unknown> & { op: string };

/** The module's slice (created on first use). */
export function sliceOf(draft: GameState): EncountersState {
  draft.encounters ??= { version: 1, count: 0, quietUntil: {}, met: {}, fights: {} };
  const s = draft.encounters;
  s.quietUntil ??= {};
  s.met ??= {};
  s.fights ??= {};
  return s;
}

/** Applies the effects whose owners are loaded. */
function apply(ctx: SimContext, effects: readonly Effect[]): void {
  const ok = effects.filter((e) => ctx.env.effects.has(e.op));
  if (ok.length > 0) ctx.applyEffects(ok as never);
}

const nameOf = (state: GameState, id: string | undefined): string => (id !== undefined ? (state.characters[id as CharId]?.name ?? '') : '');
const factionName = (state: GameState, id: FactionId | undefined): string => (id !== undefined ? (state.factions[id]?.name ?? '') : '');

/** Writes fleet morale and crew stamina (no owner op exists), clamped. */
function strain(draft: GameState, fleetId: string, morale: number, stamina: number): void {
  const f = draft.fleets[fleetId as never] as Fleet | undefined;
  if (!f) return;
  if (morale !== 0) {
    const m = clamp(Math.round(f.morale + morale), 0, 100);
    if (m !== f.morale) f.morale = m;
  }
  if (stamina !== 0) {
    const s = clamp(Math.round(f.crewStamina + stamina), 0, 100);
    if (s !== f.crewStamina) f.crewStamina = s;
  }
}

/** Raises an encounter decision and records it. */
export function raiseEncounter(draft: GameState, ctx: SimContext, payload: EncounterPayloadFull): PendingDecision {
  const slice = sliceOf(draft);
  slice.count += 1;
  ctx.emit({
    type: 'EncounterSighted',
    encounterId: payload.encounterId,
    kind: payload.kind,
    stage: payload.stage,
    domain: payload.domain,
    fleetId: payload.fleetId,
    ...(payload.armyId !== undefined ? { armyId: payload.armyId } : {}),
    ...(payload.party.factionId !== undefined ? { factionId: payload.party.factionId } : {}),
    aggressive: payload.aggressive,
  });
  return ctx.pend({ kind: 'encounter', payload }) as PendingDecision;
}

/** The player's answer to the pending encounter card. */
export function handleResolveEncounter(draft: GameState, cmd: { choice: EncounterChoice }, ctx: SimContext): void {
  const p = draft.pending;
  if (!p || p.kind !== 'encounter') throw new CommandError('noEncounter', 'encounters.error.noEncounter');
  const pl = JSON.parse(JSON.stringify(p.payload)) as EncounterPayloadFull;
  if (typeof pl.encounterId !== 'string' || !pl.party) {
    // Not one of ours (a storylet or test raised a bare encounter): let it go.
    ctx.resolvePending(p.id);
    return;
  }
  const fleet = draft.fleets[pl.fleetId];
  if (!fleet || (pl.armyId !== undefined && !draft.armies[pl.armyId])) {
    // The party is gone (stood down, disbanded): nothing left to answer for.
    ctx.resolvePending(p.id);
    ctx.emit({ type: 'EncounterResolved', encounterId: pl.encounterId, kind: pl.kind, choice: cmd.choice, outcome: 'gone' });
    return;
  }
  const option = encounterOptions(draft, ctx.content, pl, ctx.env.effects).find((o) => o.id === cmd.choice);
  if (!option) throw new CommandError('unavailable', 'encounters.error.notAnOption');
  if (!option.available) throw new CommandError('unavailable', `encounters.reason.${option.reason ?? 'unavailable'}`);
  ctx.resolvePending(p.id);
  const rng = ctx.rng('encounters:resolve');
  const outcome = OUTCOMES[cmd.choice](draft, ctx, pl, rng, option.chance ?? 0, option.whoId);
  ctx.emit({ type: 'EncounterResolved', encounterId: pl.encounterId, kind: pl.kind, choice: cmd.choice, outcome, ...(pl.party.factionId !== undefined ? { factionId: pl.party.factionId } : {}) });
}

type Outcome = (draft: GameState, ctx: SimContext, pl: EncounterPayloadFull, rng: Rng, chance: number, who: CharId | undefined) => string;

function baseVars(draft: GameState, pl: EncounterPayloadFull, who: CharId | undefined): TextVars {
  return { faction: factionName(draft, pl.party.factionId), who: nameOf(draft, who), hasWho: who !== undefined ? 'yes' : 'no', kind: pl.kind };
}

function grantXp(ctx: SimContext, who: CharId | undefined): void {
  const xp = ctx.tunables.encounters.skillXp;
  if (who !== undefined && xp > 0) apply(ctx, [{ op: 'grantXp', charId: who, amount: xp, source: 'encounter' }]);
}

/** A settlement of `factionId` near the party (news and rumours come from there). */
function homePortOf(draft: GameState, pos: { x: number; y: number }, factionId: FactionId | undefined): string | undefined {
  if (factionId === undefined) return undefined;
  for (const s of nearbySettlements(draft, pos, 200)) if (s.factionId === factionId) return s.id;
  return draft.factions[factionId]?.holdingIds[0];
}

const hail: Outcome = (draft, ctx, pl, rng, _chance, who) => {
  const t = ctx.tunables.encounters.hail;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  const pos = pl.armyId !== undefined ? (draft.armies[pl.armyId]?.pos ?? fleet.pos) : fleet.pos;
  const speech = who !== undefined ? (draft.characters[who]?.skills.speechcraft ?? 0) : 0;
  const port = homePortOf(draft, pos, pl.party.factionId);
  const effects: Effect[] = [];
  if (port !== undefined) effects.push({ op: 'hearNews', settlementId: port, via: pl.kind === 'merchant' ? 'merchant' : 'envoy', maxItems: t.newsItems + Math.floor(speech * t.newsPerSpeechcraft) });
  let rumour = false;
  if (rng.chance(t.rumourBase + t.rumourPerSpeechcraft * speech)) {
    const near = nearbySettlements(draft, pos, 150).filter((s) => s.factionId !== draft.player.factionId);
    if (near.length > 0) {
      const target = rng.pick(near.slice(0, 8));
      effects.push({ op: 'observeSettlement', settlementId: target.id, source: pl.kind === 'merchant' ? 'merchant' : 'rumour' });
      rumour = ctx.env.effects.has('observeSettlement');
    }
  }
  if (pl.party.factionId !== undefined && t.opinion !== 0) effects.push({ op: 'changeOpinion', a: pl.party.factionId, b: draft.player.factionId, amount: t.opinion, reason: 'encounters.hail', decayPerMonth: 1 });
  apply(ctx, effects);
  ctx.notify(`encounters.notify.hail.${pl.kind}`, { priority: 'normal', vars: { ...baseVars(draft, pl, who), rumour: rumour ? 'yes' : 'no' } });
  return 'hailed';
};

const trade: Outcome = (draft, ctx, pl, _rng, _chance, who) => {
  const deal = pl.deal;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  if (!deal) throw new CommandError('unavailable', 'encounters.reason.nothingToTrade');
  const other = pl.party.fleetId !== undefined && draft.fleets[pl.party.fleetId] ? pl.party.fleetId : undefined;
  const effects: Effect[] = [];
  let vars: TextVars;
  if (deal.kind === 'sell') {
    const tons = Math.min(deal.tons, fleet.cargo[deal.good] ?? 0);
    const silver = deal.tons > 0 ? Math.round((deal.silver * tons) / deal.tons) : 0;
    effects.push({ op: 'addGoods', good: deal.good, tons: -tons, fleetId: fleet.id }, { op: 'addSilver', amount: silver, fleetId: fleet.id });
    if (other !== undefined) effects.push({ op: 'addGoods', good: deal.good, tons, fleetId: other }, { op: 'addSilver', amount: -silver, fleetId: other });
    vars = { deal: 'sell', good: deal.good, tons, silver };
  } else {
    const silver = Math.min(deal.silver, Math.max(0, Math.floor(fleet.silver)));
    const rations = deal.silver > 0 ? Math.floor((deal.rations * silver) / deal.silver) : 0;
    effects.push({ op: 'addSilver', amount: -silver, fleetId: fleet.id }, { op: 'addRations', count: rations, fleetId: fleet.id });
    if (other !== undefined) effects.push({ op: 'addSilver', amount: silver, fleetId: other }, { op: 'addRations', count: -rations, fleetId: other });
    vars = { deal: 'buy', good: 'rations', rations, silver };
  }
  const op = ctx.tunables.encounters.trade.opinion;
  if (pl.party.factionId !== undefined && op !== 0) effects.push({ op: 'changeOpinion', a: pl.party.factionId, b: draft.player.factionId, amount: op, reason: 'encounters.trade', decayPerMonth: 1 });
  apply(ctx, effects);
  ctx.notify(`encounters.notify.trade.${deal.kind}`, { priority: 'normal', vars: { ...baseVars(draft, pl, who), ...vars } });
  return 'traded';
};

const payToll: Outcome = (draft, ctx, pl, _rng, _chance, who) => {
  const t = ctx.tunables.encounters.payToll;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  const silver = Math.min(pl.toll.silver, Math.max(0, Math.floor(fleet.silver)));
  const rations = Math.min(pl.toll.rations, Math.max(0, Math.floor(fleet.rations)));
  const effects: Effect[] = [];
  if (silver > 0) effects.push({ op: 'addSilver', amount: -silver, fleetId: fleet.id });
  if (rations > 0) effects.push({ op: 'addRations', count: -rations, fleetId: fleet.id });
  const other = pl.party.fleetId !== undefined && draft.fleets[pl.party.fleetId] ? pl.party.fleetId : undefined;
  if (other !== undefined && silver > 0) effects.push({ op: 'addSilver', amount: silver, fleetId: other });
  const cowed = pl.kind === 'raiders' || pl.kind === 'outlaws' || pl.aggressive;
  if (cowed && t.cowedRenown !== 0) effects.push({ op: 'changeRenown', amount: t.cowedRenown });
  if (!cowed && pl.party.factionId !== undefined && t.opinion !== 0) effects.push({ op: 'changeOpinion', a: pl.party.factionId, b: draft.player.factionId, amount: t.opinion, reason: 'encounters.toll', decayPerMonth: 1 });
  apply(ctx, effects);
  ctx.notify('encounters.notify.paid', { priority: 'normal', vars: { ...baseVars(draft, pl, who), silver, rations } });
  return 'paid';
};

const demandToll: Outcome = (draft, ctx, pl, rng, chance, who) => {
  const t = ctx.tunables.encounters;
  const balance = ctx.balance;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  const player = draft.player.factionId;
  const fid = pl.party.factionId;
  if (rng.chance(chance)) {
    const share = rng.range(balance.encounters.toll.cargoShare[0], balance.encounters.toll.cargoShare[1]);
    const value = pl.party.silver + goodsValue(balance, pl.party.cargo) * t.demandToll.valueMult;
    const amount = Math.max(1, Math.round(value * share));
    const effects: Effect[] = [];
    const other = pl.party.fleetId !== undefined ? draft.fleets[pl.party.fleetId] : undefined;
    let silver = amount;
    let tons = 0;
    let good: GoodId | undefined;
    if (other) {
      silver = Math.min(amount, Math.max(0, Math.floor(other.silver)));
      if (silver > 0) effects.push({ op: 'addSilver', amount: -silver, fleetId: other.id });
      const rest = amount - silver;
      if (rest > 0) {
        let best = 0;
        for (const [g, v] of Object.entries(other.cargo) as [GoodId, number | undefined][]) {
          if (g === 'rations' || !(v !== undefined && v > 0)) continue;
          const price = (balance.goods as Record<string, { basePerTon: number } | undefined>)[g]?.basePerTon ?? 0;
          if (v * price > best) {
            best = v * price;
            good = g;
          }
        }
        if (good !== undefined) {
          const price = (balance.goods as Record<string, { basePerTon: number } | undefined>)[good]?.basePerTon ?? 1;
          tons = Math.round(Math.min(other.cargo[good] ?? 0, rest / Math.max(1, price)) * 10) / 10;
          if (tons > 0) effects.push({ op: 'addGoods', good, tons: -tons, fleetId: other.id }, { op: 'addGoods', good, tons, fleetId: fleet.id });
        }
      }
    }
    if (silver > 0) effects.push({ op: 'addSilver', amount: silver, fleetId: fleet.id });
    if (t.demandToll.dread !== 0) effects.push({ op: 'changeDread', amount: t.demandToll.dread });
    if (fid !== undefined && t.demandToll.opinion !== 0) effects.push({ op: 'changeOpinion', a: fid, b: player, amount: t.demandToll.opinion, reason: 'encounters.toll', decayPerMonth: 1 });
    if (!pl.aggressive && t.demandToll.honor !== 0) effects.push({ op: 'changeHonor', amount: t.demandToll.honor });
    effects.push({ op: 'addNews', kind: 'tollExtorted', pos: { x: fleet.pos.x, y: fleet.pos.y }, facts: { faction: factionName(draft, fid), silver }, textKey: 'encounters.news.toll', ...(fid !== undefined ? { factionIds: [player, fid] } : {}) });
    apply(ctx, effects);
    ctx.chronicle({ kind: 'encounter', textKey: 'encounters.chronicle.toll', importance: 1, vars: { faction: factionName(draft, fid), silver }, refs: fid !== undefined ? [fid] : [] });
    ctx.notify('encounters.notify.tollTaken', { priority: 'normal', vars: { ...baseVars(draft, pl, who), silver, tons, good: good ?? '' } });
    grantXp(ctx, who);
    return 'tollTaken';
  }
  // Refused: traders crowd on sail and run; armed men answer with steel.
  if (fid !== undefined && t.demandToll.opinion !== 0) apply(ctx, [{ op: 'changeOpinion', a: fid, b: player, amount: Math.round(t.demandToll.opinion / 2), reason: 'encounters.toll', decayPerMonth: 1 }]);
  if (pl.kind === 'merchant') {
    ctx.notify('encounters.notify.refusedFled', { priority: 'normal', vars: baseVars(draft, pl, who) });
    return 'refusedFled';
  }
  ctx.notify('encounters.notify.refusedFight', { priority: 'high', vars: baseVars(draft, pl, who) });
  startFight(draft, ctx, pl, false, true);
  return 'refusedFight';
};

const attack: Outcome = (draft, ctx, pl) => {
  const t = ctx.tunables.encounters.attack;
  const unprovoked = !pl.aggressive;
  const fid = pl.party.factionId;
  if (unprovoked) {
    const effects: Effect[] = [];
    if (fid !== undefined && t.unprovokedOpinion !== 0) effects.push({ op: 'changeOpinion', a: fid, b: draft.player.factionId, amount: t.unprovokedOpinion, reason: 'encounters.attacked', decayPerMonth: 1 });
    if (t.unprovokedHonor !== 0) effects.push({ op: 'changeHonor', amount: t.unprovokedHonor });
    apply(ctx, effects);
  }
  startFight(draft, ctx, pl, true, unprovoked);
  return 'attacked';
};

/** Role of a party in the sea battle's AI (§15.3). */
const SEA_ROLE: Record<EncounterKind, string> = { merchant: 'merchant', patrol: 'patrol', raiders: 'raider', warfleet: 'warfleet', outlaws: 'raider', landPatrol: 'patrol' };

/** Starts the battle (sea: seabattle's pre-battle decision; land: battle's). The result is settled in the reactions. */
export function startFight(draft: GameState, ctx: SimContext, pl: EncounterPayloadFull, weAttack: boolean, unprovoked: boolean): void {
  const balance = ctx.balance;
  const t = ctx.tunables.encounters;
  const real = pl.party.fleetId !== undefined && draft.fleets[pl.party.fleetId] !== undefined;
  const fight: EncounterFight = {
    kind: pl.kind,
    domain: pl.domain,
    ...(pl.party.factionId !== undefined ? { factionId: pl.party.factionId } : {}),
    plunderSilver: real ? 0 : pl.party.silver,
    plunderGoods: real ? {} : { ...pl.party.cargo },
    fleetId: pl.fleetId,
    unprovoked,
    hour: ctx.hour,
  };
  sliceOf(draft).fights[pl.encounterId] = fight;
  const origin = `encounters:${pl.encounterId}`;
  if (pl.domain === 'land' && pl.armyId !== undefined) {
    if (!ctx.env.effects.has('startBattle')) throw new CommandError('noBattles', 'encounters.reason.noBattles');
    const squads: Squad[] = [];
    for (const [unit, men] of Object.entries(pl.party.men)) {
      if (!(men > 0)) continue;
      const u = (balance.units as Record<string, { formations?: string[] } | undefined>)[unit];
      squads.push({ leaderId: 'chr_none' as CharId, unit, men, vetStars: 0, formation: (u?.formations?.[0] ?? 'loose') as Squad['formation'] });
    }
    const them: Record<string, unknown> = { squads, moraleMods: 0, armourTier: pl.party.armourTier, weaponTier: pl.party.weaponTier };
    if (pl.party.factionId !== undefined) them['factionId'] = pl.party.factionId;
    const us = { armyId: pl.armyId, isPlayer: true };
    ctx.applyEffects([
      {
        op: 'startBattle',
        kind: weAttack ? 'field' : 'ambush',
        attacker: weAttack ? us : them,
        defender: weAttack ? them : us,
        origin,
        loot: { silver: pl.party.silver, goods: {} },
      } as never,
    ]);
    return;
  }
  if (!ctx.env.effects.has('startSeaBattle')) throw new CommandError('noBattles', 'encounters.reason.noBattles');
  const them: Record<string, unknown> = real
    ? { fleetId: pl.party.fleetId }
    : {
        factionId: pl.party.factionId,
        ships: pl.party.ships.map((s) => ({ type: s.type, crew: s.crew })),
        men: { ...pl.party.men },
        role: SEA_ROLE[pl.kind],
        morale: pl.party.morale,
      };
  const us = { fleetId: pl.fleetId };
  const info = zoneInfo(t, pl.zoneId ?? null);
  const arena = Object.hasOwn(t.attack.seaArena, info.exposure) ? t.attack.seaArena[info.exposure] : undefined;
  ctx.applyEffects([
    {
      op: 'startSeaBattle',
      attacker: weAttack ? us : them,
      defender: weAttack ? them : us,
      origin,
      ...(arena !== undefined ? { arena } : {}),
      ...(pl.zoneId ? { zoneId: pl.zoneId } : {}),
    } as never,
  ]);
}

/** Fails to shake them off: they close (sea) or spring an ambush (land) — the "caught" card. */
function raiseCaught(draft: GameState, ctx: SimContext, pl: EncounterPayloadFull, rng: Rng): string {
  const t = ctx.tunables.encounters;
  const payload = composeEncounter(
    draft,
    ctx.content,
    {
      id: ctx.newId('enc'),
      kind: pl.kind,
      stage: 'caught',
      fleetId: pl.fleetId,
      ...(pl.armyId !== undefined ? { armyId: pl.armyId } : {}),
      party: pl.party,
      variant: rng.int(1, t.caughtVariants),
    },
    ctx.env.effects,
  );
  raiseEncounter(draft, ctx, payload);
  return 'caught';
}

/** A day lost beating about: food eaten, tired oarsmen, grumbling. */
function lostDay(draft: GameState, ctx: SimContext, pl: EncounterPayloadFull, who: CharId | undefined): string {
  const t = ctx.tunables.encounters.lostDay;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  const food = Math.min(Math.max(0, Math.floor(fleet.rations)), Math.ceil(t.rationDays * dailyFood(ctx.balance, menTotal(fleet.men))));
  if (food > 0) apply(ctx, [{ op: 'addRations', count: -food, fleetId: fleet.id }]);
  strain(draft, fleet.id, t.morale, t.stamina);
  ctx.notify('encounters.notify.lostDay', { priority: 'normal', vars: { ...baseVars(draft, pl, who), rations: food } });
  return 'lostDay';
}

const evade: Outcome = (draft, ctx, pl, rng, chance, who) => {
  if (rng.chance(chance)) {
    ctx.notify('encounters.notify.evaded', { priority: 'normal', vars: baseVars(draft, pl, who) });
    grantXp(ctx, who);
    return 'evaded';
  }
  return pl.aggressive ? raiseCaught(draft, ctx, pl, rng) : lostDay(draft, ctx, pl, who);
};

const flee: Outcome = (draft, ctx, pl, rng, chance, who) => {
  strain(draft, pl.fleetId, -ctx.balance.encounters.fleeMoraleCost, ctx.tunables.encounters.flee.stamina);
  if (chance > 0 && rng.chance(chance)) return raiseCaught(draft, ctx, pl, rng);
  ctx.notify('encounters.notify.fled', { priority: 'normal', vars: { ...baseVars(draft, pl, who), morale: ctx.balance.encounters.fleeMoraleCost } });
  return 'fled';
};

const pass: Outcome = (draft, ctx, pl) => {
  ctx.notify('encounters.notify.passed', { priority: 'low', vars: baseVars(draft, pl, undefined) });
  return 'passed';
};

const yieldTo: Outcome = (draft, ctx, pl, rng) => {
  const t = ctx.tunables.encounters.caught;
  const fleet = draft.fleets[pl.fleetId] as Fleet;
  const other = pl.party.fleetId !== undefined && draft.fleets[pl.party.fleetId] ? pl.party.fleetId : undefined;
  const effects: Effect[] = [];
  const silver = Math.floor(Math.max(0, fleet.silver) * rng.range(t.silverShare[0], t.silverShare[1]));
  if (silver > 0) {
    effects.push({ op: 'addSilver', amount: -silver, fleetId: fleet.id });
    if (other !== undefined) effects.push({ op: 'addSilver', amount: silver, fleetId: other });
  }
  const share = rng.range(t.cargoShare[0], t.cargoShare[1]);
  let tons = 0;
  for (const [g, v] of Object.entries(fleet.cargo) as [GoodId, number | undefined][]) {
    if (g === 'rations' || !(v !== undefined && v > 0)) continue;
    const take = Math.round(v * share * 10) / 10;
    if (take <= 0) continue;
    tons += take;
    effects.push({ op: 'addGoods', good: g, tons: -take, fleetId: fleet.id });
    if (other !== undefined) effects.push({ op: 'addGoods', good: g, tons: take, fleetId: other });
  }
  let rations = 0;
  if (silver <= 0 && tons <= 0) {
    rations = Math.min(Math.floor(Math.max(0, fleet.rations) * t.maxRationShare), Math.ceil(t.rationDays * dailyFood(ctx.balance, menTotal(fleet.men))));
    if (rations > 0) effects.push({ op: 'addRations', count: -rations, fleetId: fleet.id });
  }
  if (t.renown !== 0) effects.push({ op: 'changeRenown', amount: t.renown });
  apply(ctx, effects);
  ctx.notify('encounters.notify.yielded', { priority: 'high', vars: { ...baseVars(draft, pl, undefined), silver, tons: Math.round(tons * 10) / 10, rations } });
  return 'yielded';
};

const fight: Outcome = (draft, ctx, pl) => {
  startFight(draft, ctx, pl, false, false);
  return 'fought';
};

const slipAway: Outcome = (draft, ctx, pl, rng, chance, who) => {
  if (rng.chance(chance)) {
    ctx.notify('encounters.notify.slipped', { priority: 'normal', vars: baseVars(draft, pl, who) });
    grantXp(ctx, who);
    return 'slipped';
  }
  if (pl.aggressive) return raiseCaught(draft, ctx, pl, rng);
  ctx.notify('encounters.notify.questioned', { priority: 'normal', vars: baseVars(draft, pl, who) });
  return 'questioned';
};

const fallBack: Outcome = (draft, ctx, pl, rng) => {
  const t = ctx.tunables.encounters.fallBack;
  const army = pl.armyId !== undefined ? draft.armies[pl.armyId] : undefined;
  if (!army) return 'gone';
  const squads = army.squads.map((s) => ({ unit: s.unit, men: Math.max(0, s.men) }));
  const men = squads.reduce((a, s) => a + s.men, 0);
  const loss = Math.min(Math.max(0, men - 1), Math.max(1, Math.round(men * rng.range(t.lossShare[0], t.lossShare[1]))));
  // Spread the losses over the unit types, largest first.
  const byUnit: Record<string, number> = {};
  for (const s of squads) byUnit[s.unit] = (byUnit[s.unit] ?? 0) + s.men;
  const units = Object.keys(byUnit).sort((a, b) => (byUnit[b] ?? 0) - (byUnit[a] ?? 0) || (a < b ? -1 : 1));
  let left = loss;
  let dead = 0;
  let wounded = 0;
  const effects: Effect[] = [];
  for (const u of units) {
    if (left <= 0) break;
    const share = units.length === 1 ? left : Math.min(left, Math.max(1, Math.round((loss * (byUnit[u] ?? 0)) / Math.max(1, men))));
    const take = Math.min(share, byUnit[u] ?? 0);
    if (take <= 0) continue;
    const w = Math.floor(take * t.woundedShare);
    const d = take - w;
    effects.push({ op: 'killMen', armyId: army.id, unit: u, count: d, wounded: w, popLoss: d > 0 });
    dead += d;
    wounded += w;
    left -= take;
  }
  let hurt: CharId | undefined;
  if (rng.chance(t.woundChance)) {
    const ids = companions(draft, pl.fleetId, pl.armyId);
    if (ids.length > 0) {
      hurt = rng.pick(ids);
      effects.push({ op: 'woundCharacter', charId: hurt, wound: 'minor', cause: 'ambush' });
    }
  }
  apply(ctx, effects);
  ctx.notify('encounters.notify.fellBack', { priority: 'high', vars: { ...baseVars(draft, pl, undefined), dead, wounded, hurt: nameOf(draft, hurt), hasHurt: hurt !== undefined && ctx.env.effects.has('woundCharacter') ? 'yes' : 'no' } });
  return 'fellBack';
};

const OUTCOMES: Record<EncounterChoice, Outcome> = {
  hail,
  trade,
  payToll,
  demandToll,
  attack,
  evade,
  flee,
  pass,
  yield: yieldTo,
  fight,
  slipAway,
  fallBack,
};

type Loose = Record<string, unknown>;

/** Settles a fight this module started: standing and plunder on victory (the battle modules applied the rest). */
export function settleFight(draft: GameState, ctx: SimContext, e: Loose): void {
  const origin = typeof e['origin'] === 'string' ? e['origin'] : '';
  if (!origin.startsWith('encounters:')) return;
  const id = origin.slice('encounters:'.length);
  const slice = sliceOf(draft);
  if (!Object.hasOwn(slice.fights, id)) return;
  const fight = slice.fights[id] as EncounterFight;
  delete slice.fights[id];
  const result = e['result'] as { winner?: string } | undefined;
  const side = e['playerSide'];
  if (side === undefined || result?.winner !== side) return;
  const t = ctx.tunables.encounters.attack;
  const effects: Effect[] = [];
  const renown = t.renown[fight.kind];
  const dread = t.dread[fight.kind];
  if (renown !== 0) effects.push({ op: 'changeRenown', amount: renown });
  if (dread !== 0) effects.push({ op: 'changeDread', amount: dread });
  let silver = 0;
  let tons = 0;
  const fleet = draft.fleets[fight.fleetId];
  if (fight.domain === 'sea' && fleet) {
    silver = Math.floor(fight.plunderSilver * t.plunderShare);
    if (silver > 0) effects.push({ op: 'addSilver', amount: silver, fleetId: fleet.id });
    for (const [g, v] of Object.entries(fight.plunderGoods) as [GoodId, number | undefined][]) {
      const take = Math.round((v ?? 0) * t.plunderShare * 10) / 10;
      if (take <= 0) continue;
      tons += take;
      effects.push({ op: 'addGoods', good: g, tons: take, fleetId: fleet.id });
    }
  }
  apply(ctx, effects);
  if (silver > 0 || tons > 0) ctx.notify('encounters.notify.plunder', { priority: 'normal', vars: { silver, tons: Math.round(tons * 10) / 10, faction: factionName(draft, fight.factionId) } });
}
