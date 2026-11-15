/**
 * Captivity (§23.5, §16.5, §31.15): capture and release, ransom values, the player's weekly
 * choices (wait for ransom, attempt escape, bargain, send word, swear fealty), monthly Vigor
 * checks for every captive, and autonomous escapes/ransoms of NPC captives. There are no
 * executions: long captivity kills only through wounds, and succession follows.
 */
import { CommandError } from '@sim/core/commands';
import { dpow } from '@sim/core/dmath';
import { EffectError } from '@sim/core/effects';
import type { CommandHandler, SimContext } from '@sim/core/module';
import { getRelation } from '@sim/core/factory';
import type { Character, CharId, FactionId, GameState, SettlementId } from '@sim/core/state';
import { daysBetween } from '@sim/core/time';
import { rollAndApplyInjury, woundCharacter } from './health';
import { childIds, parentIds, siblingIds } from './kin';
import type { CaptivityChoice } from './types';
import {
  charOf,
  chronicleHouse,
  effectiveAttribute,
  effectiveSkill,
  factionSeat,
  isAdultAt,
  isPlayerHouse,
  linearCheck,
  modifierSum,
  notifyHouse,
  peopleState,
  playerHome,
  pushUnique,
  removeValue,
  STREAMS,
} from './util';

type RankId = 'warrior' | 'hersir' | 'jarlKin' | 'abbot' | 'kingKin' | 'jarl' | 'king';

const ROYAL_KINDS: readonly string[] = ['kingdom', 'realm', 'empire'];

function isRoyal(state: GameState, factionId: FactionId | undefined): boolean {
  const f = factionId !== undefined ? state.factions[factionId] : undefined;
  return f !== undefined && ROYAL_KINDS.includes(f.kind);
}

/** Ransom rank of a notable (§31.15). */
export function ransomRank(state: GameState, c: Character): RankId {
  for (const f of Object.values(state.factions)) {
    if (f.rulerId === c.id) return ROYAL_KINDS.includes(f.kind) ? 'king' : 'jarl';
  }
  const kin = [...parentIds(state, c), ...childIds(state, c), ...c.family.spouseIds, ...siblingIds(state, c)];
  let rank: RankId | undefined;
  for (const id of kin) {
    const k = charOf(state, id);
    if (!k?.alive || k.role?.kind !== 'ruler') continue;
    if (isRoyal(state, k.role.factionId ?? k.factionId)) return 'kingKin';
    rank = 'jarlKin';
  }
  return rank ?? 'hersir';
}

/** Ransom = rankValue × (1 + wealthTierStep × wealthTier) (§31.15). */
export function ransomFor(state: GameState, ctx: Pick<SimContext, 'balance' | 'tunables'>, c: Character): number {
  const r = ctx.balance.prices.ransom;
  const t = ctx.tunables.people.captivity;
  const value = r.rankValue[ransomRank(state, c)];
  const treasury = c.factionId !== undefined ? (state.factions[c.factionId]?.treasury ?? 0) : 0;
  const tier = Math.min(t.wealthTierMax, Math.floor(Math.max(0, treasury) / t.wealthTierSilver));
  return Math.round(value * (1 + r.wealthTierStep * tier));
}

export interface CaptureOptions {
  at?: SettlementId;
  ransom?: number;
  cause?: string;
  hostage?: boolean;
}

/** Takes a character captive (idempotent for the same captor). */
export function captureCharacter(draft: GameState, ctx: SimContext, c: Character, byFactionId: FactionId, opts: CaptureOptions = {}): void {
  if (!c.alive) return;
  if (!Object.hasOwn(draft.factions, byFactionId)) throw new EffectError(`capture: unknown faction ${byFactionId}`);
  if (c.captivity?.byFactionId === byFactionId) return;
  const at = opts.at ?? factionSeat(draft, byFactionId);
  if (at === undefined || !Object.hasOwn(draft.settlements, at)) throw new EffectError(`capture: faction ${byFactionId} has nowhere to hold a captive`);
  const ps = peopleState(draft);
  const ransom = Math.max(0, Math.round(opts.ransom ?? ransomFor(draft, ctx, c)));
  c.location = { kind: 'captive', at, by: byFactionId };
  c.captivity = { byFactionId, at, sinceHour: ctx.hour, ransom, baseRansom: ransom, guard: 0, vigorFails: 0, bargains: 0 };
  if (opts.hostage) c.captivity.hostage = true;
  pushUnique(ps.captiveIds, c.id);
  if (c.upbringing) {
    delete c.upbringing;
    removeValue(ps.fosterIds, c.id);
  }
  const e: { type: 'CaptureStarted'; charId: CharId; byFactionId: FactionId; at: SettlementId; ransom: number; cause?: string } = {
    type: 'CaptureStarted',
    charId: c.id,
    byFactionId,
    at,
    ransom,
  };
  if (opts.cause !== undefined) e.cause = opts.cause;
  ctx.emit(e);
  const captor = draft.factions[byFactionId]?.name ?? '';
  const isRuler = c.id === draft.player.rulerId;
  notifyHouse(ctx, c, 'people.notify.captured', { captor, ransom }, isRuler ? 'critical' : 'high');
  chronicleHouse(ctx, c, 'captured', 'people.chronicle.captured', isRuler ? 4 : 2, { captor }, [byFactionId]);
  if (isRuler && !ps.houseFallen) pendCaptivity(draft, ctx, c);
}

/** Frees a captive and sends them home (or to `to`). */
export function releaseCharacter(draft: GameState, ctx: SimContext, c: Character, reason: string, to?: SettlementId): void {
  if (!c.captivity && c.location.kind !== 'captive') return;
  const ps = peopleState(draft);
  const by = c.captivity?.byFactionId ?? (c.location.kind === 'captive' ? c.location.by : undefined);
  const heldAt = c.captivity?.at ?? (c.location.kind === 'captive' ? c.location.at : undefined);
  delete c.captivity;
  removeValue(ps.captiveIds, c.id);
  let dest = to;
  if (dest === undefined || !Object.hasOwn(draft.settlements, dest)) {
    dest = isPlayerHouse(draft, c) ? playerHome(draft) : factionSeat(draft, c.factionId);
    dest ??= heldAt;
  }
  c.location = dest !== undefined ? { kind: 'settlement', id: dest } : { kind: 'none' };
  if (!c.alive) return;
  const e: { type: 'Released'; charId: CharId; byFactionId: FactionId; reason: string; to?: SettlementId } = {
    type: 'Released',
    charId: c.id,
    byFactionId: by ?? draft.player.factionId,
    reason,
  };
  if (dest !== undefined) e.to = dest;
  ctx.emit(e);
  notifyHouse(ctx, c, 'people.notify.released', { reason }, c.id === draft.player.rulerId ? 'critical' : 'high');
  const p = draft.pending;
  if (p && p.kind === 'captivity' && p.payload.charId === c.id) ctx.resolvePending(p.id);
  // Young children held by the same captor (born in captivity, taken with the parent) go home too.
  if (by === undefined) return;
  for (const kid of childIds(draft, c)) {
    const k = charOf(draft, kid);
    if (k?.alive && k.captivity?.byFactionId === by && !k.captivity.hostage && !isAdultAt(k, ctx.hour, ctx.content)) releaseCharacter(draft, ctx, k, reason, dest);
  }
}

/** Escape chance: Agility + Wildcraft + Wits check, minus the guard, × the Craven bonus. */
export function escapeChance(c: Character, ctx: Pick<SimContext, 'content' | 'tunables'>): number {
  const t = ctx.tunables.people.captivity;
  const score =
    effectiveAttribute(c, 'agility', ctx.content) + effectiveSkill(c, 'wildcraft', ctx.content) + effectiveAttribute(c, 'wits', ctx.content);
  const guard = (c.captivity?.guard ?? 0) * t.escapeGuardStep;
  const base = linearCheck(t.escape, score) - guard;
  const bonus = 1 + modifierSum(c, ctx.content, 'capture.escapePct') / 100;
  return Math.min(t.escape.max, Math.max(t.escape.min, base) * bonus);
}

/** Bargain chance: Speechcraft (+ Wits) check. */
export function bargainChance(c: Character, ctx: Pick<SimContext, 'content' | 'tunables'>): number {
  const t = ctx.tunables.people.captivity;
  const score = effectiveSkill(c, 'speechcraft', ctx.content) + (effectiveAttribute(c, 'wits', ctx.content) - ctx.content.balance.character.attributePivot) / 2;
  return linearCheck(t.bargain, score);
}

function captivityWeeks(c: Character, hour: number): number {
  return c.captivity ? Math.floor(daysBetween(c.captivity.sinceHour, hour) / 7) : 0;
}

function canPayRansom(state: GameState, c: Character): boolean {
  const treasury = state.factions[state.player.factionId]?.treasury ?? 0;
  return (c.captivity?.ransom ?? Infinity) <= treasury;
}

/** Raises the weekly captivity decision for the player's ruler (once at a time). */
export function pendCaptivity(draft: GameState, ctx: SimContext, c: Character): void {
  const rec = c.captivity;
  if (!rec) return;
  const mine = (p: GameState['pending']) => p !== null && p.kind === 'captivity' && p.payload.charId === c.id;
  if (mine(draft.pending) || draft.pendingQueue.some((p) => mine(p))) return;
  const payload: {
    charId: CharId;
    captorFactionId: FactionId;
    at: SettlementId;
    ransom: number;
    weeks: number;
    escapeChance: number;
    bargainChance: number;
    canPay: boolean;
    hostage?: boolean;
  } = {
    charId: c.id,
    captorFactionId: rec.byFactionId,
    at: rec.at,
    ransom: rec.ransom,
    weeks: captivityWeeks(c, ctx.hour),
    escapeChance: escapeChance(c, ctx),
    bargainChance: bargainChance(c, ctx),
    canPay: canPayRansom(draft, c),
  };
  if (rec.hostage) payload.hostage = true;
  const decision = ctx.pend({ kind: 'captivity', payload });
  // What the generic decision modal shows: the situation and one button per choice (they need the id).
  const sentWord = rec.sentWord === true;
  const p = decision.payload;
  p.titleKey = 'people.captivity.title';
  p.key = 'people.captivity.body';
  p.vars = { name: c.name, captor: draft.factions[rec.byFactionId]?.name ?? '', ransom: rec.ransom, weeks: payload.weeks };
  p.choices = CAPTIVITY_CHOICES.map((choice) => ({
    id: choice,
    labelKey: `people.captivity.choice.${choice}`,
    command: { type: 'captivityAction' as const, pendingId: decision.id, choice },
    ...(choice === 'swearFealty' ? { tone: 'danger' as const } : choice === 'wait' ? { tone: 'primary' as const } : { tone: 'secondary' as const }),
    ...(choice === 'sendWord' && sentWord ? { disabled: true } : {}),
  }));
}

const CAPTIVITY_CHOICES: readonly CaptivityChoice[] = ['wait', 'escape', 'bargain', 'sendWord', 'swearFealty'];

/** Pays a ransom from the payer's treasury to the captor's. Returns false if the payer cannot. */
function payRansom(draft: GameState, ctx: SimContext, payer: FactionId, captor: FactionId, amount: number): boolean {
  const treasury = draft.factions[payer]?.treasury ?? 0;
  if (treasury < amount) return false;
  if (amount > 0) {
    ctx.applyEffects([{ op: 'addSilver', amount: -amount, factionId: payer }]);
    if (Object.hasOwn(draft.factions, captor)) ctx.applyEffects([{ op: 'addSilver', amount, factionId: captor }]);
  }
  return true;
}

/** `captivityAction`: the player's weekly choice while held captive. */
export const handleCaptivityAction: CommandHandler<'captivityAction'> = (draft, cmd, ctx) => {
  const p = draft.pending;
  if (!p || p.id !== cmd.pendingId || p.kind !== 'captivity') throw new CommandError('notPending', `'${cmd.pendingId}' is not a pending captivity decision`);
  const c = charOf(draft, p.payload.charId);
  if (!c?.alive || !c.captivity) {
    ctx.resolvePending(p.id);
    return;
  }
  const rec = c.captivity;
  const t = ctx.tunables.people.captivity;
  const rng = ctx.rng(STREAMS.captivity);
  let success = false;
  switch (cmd.choice) {
    case 'wait': {
      if (draft.player.policies.captivityRansom !== 'refuse' && payRansom(draft, ctx, draft.player.factionId, rec.byFactionId, rec.ransom)) {
        success = true;
        notifyHouse(ctx, c, 'people.notify.ransomPaid', { amount: rec.ransom }, 'high');
        releaseCharacter(draft, ctx, c, 'ransomed');
      }
      break;
    }
    case 'escape': {
      success = rng.chance(escapeChance(c, ctx));
      if (success) releaseCharacter(draft, ctx, c, 'escaped');
      else {
        rec.guard += 1;
        notifyHouse(ctx, c, 'people.notify.escapeFailed', {}, 'high');
        rollAndApplyInjury(draft, ctx, c, 'escape');
      }
      break;
    }
    case 'bargain': {
      success = rng.chance(bargainChance(c, ctx));
      rec.bargains += 1;
      if (success) {
        const floor = Math.round(rec.baseRansom * t.bargainRansomFloor);
        rec.ransom = Math.max(floor, Math.round(rec.ransom * (1 - t.bargainRansomCut)));
      }
      notifyHouse(ctx, c, success ? 'people.notify.bargainWon' : 'people.notify.bargainLost', { ransom: rec.ransom });
      break;
    }
    case 'sendWord': {
      if (rec.sentWord) throw new CommandError('alreadySent', 'Word has already been sent');
      rec.sentWord = true;
      success = true;
      ctx.emit({ type: 'CaptiveSentWord', charId: c.id, captorFactionId: rec.byFactionId });
      notifyHouse(ctx, c, 'people.notify.wordSent');
      break;
    }
    case 'swearFealty': {
      success = true;
      const liege = rec.byFactionId;
      const loss = Math.round(draft.player.house.renown * t.fealtyRenownLoss);
      if (loss > 0) ctx.applyEffects([{ op: 'changeRenown', amount: -loss }]);
      ctx.emit({ type: 'FealtySworn', charId: c.id, factionId: draft.player.factionId, liegeFactionId: liege });
      chronicleHouse(ctx, c, 'fealty', 'people.chronicle.fealty', 4, { liege: draft.factions[liege]?.name ?? '' }, [liege]);
      releaseCharacter(draft, ctx, c, 'fealty');
      break;
    }
  }
  ctx.emit({ type: 'CaptivityChoiceMade', charId: c.id, choice: cmd.choice satisfies CaptivityChoice, success });
  if (draft.pending?.id === p.id) ctx.resolvePending(p.id);
};

/** Allied factions of the player (stance 'allied'), for rescue attempts. */
function alliedFactionCount(state: GameState): number {
  const fid = state.player.factionId;
  let n = 0;
  for (const rel of Object.values(state.relations)) {
    if ((rel.a === fid || rel.b === fid) && rel.stance === 'allied') n++;
  }
  return n;
}

/** A living parent of `c` is held by the same captor. */
function parentHeldBy(state: GameState, c: Character, captor: FactionId): boolean {
  for (const pid of parentIds(state, c)) {
    const p = charOf(state, pid);
    if (p?.alive && p.captivity?.byFactionId === captor) return true;
  }
  return false;
}

/**
 * Weekly: the player's captive ruler decides; other captives of the player's house are ransomed by
 * the steward; adult NPC captives may escape, and the AI's captives are ransomed by their kin in time.
 */
export function weeklyCaptivity(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  if (ps.captiveIds.length === 0) return;
  const t = ctx.tunables.people.captivity;
  const rng = ctx.rng(STREAMS.captivity);
  for (const id of [...ps.captiveIds]) {
    const c = charOf(draft, id);
    if (!c?.alive || !c.captivity) {
      removeValue(ps.captiveIds, id);
      continue;
    }
    const rec = c.captivity;
    if (c.id === draft.player.rulerId) {
      if (ps.houseFallen) continue;
      if (rec.sentWord) {
        const allies = alliedFactionCount(draft);
        if (allies > 0 && rng.chance(1 - dpow(1 - t.rescueChancePerAllyWeekly, allies))) {
          releaseCharacter(draft, ctx, c, 'rescued');
          continue;
        }
      }
      pendCaptivity(draft, ctx, c);
      continue;
    }
    if (rec.hostage) continue; // hostages live at the host's court until relations mend (monthly)
    const adult = isAdultAt(c, ctx.hour, ctx.content);
    // Children do not slip their guards alone; they go home with a parent or by ransom.
    if (adult && rng.chance(t.npcEscapeWeekly * (escapeChance(c, ctx) / Math.max(0.01, t.escape.base)))) {
      releaseCharacter(draft, ctx, c, 'escaped');
      continue;
    }
    if (!adult && parentHeldBy(draft, c, rec.byFactionId)) continue; // goes home with the parent
    const heldByPlayer = rec.byFactionId === draft.player.factionId;
    const days = daysBetween(rec.sinceHour, ctx.hour);
    if (!heldByPlayer && isPlayerHouse(draft, c)) {
      // The steward ransoms the house's kin and lieutenants once word reaches home (policy permitting).
      if (days < t.houseRansomDays || draft.player.policies.captivityRansom === 'refuse') continue;
      if (payRansom(draft, ctx, draft.player.factionId, rec.byFactionId, rec.ransom)) {
        notifyHouse(ctx, c, 'people.notify.ransomPaid', { amount: rec.ransom }, 'high');
        releaseCharacter(draft, ctx, c, 'ransomed');
      }
      continue;
    }
    if (!heldByPlayer && days >= t.npcRansomDays) {
      // Kin ransom their own after a while (pay what they can).
      const payer = c.factionId;
      if (payer !== undefined && payer !== rec.byFactionId) {
        const amount = Math.min(rec.ransom, Math.max(0, Math.floor(draft.factions[payer]?.treasury ?? 0)));
        payRansom(draft, ctx, payer, rec.byFactionId, amount);
      }
      releaseCharacter(draft, ctx, c, 'ransomed');
    }
  }
}

/** A hostage's house and the host are at peace again, with opinion back to the return threshold. */
function hostageMayReturn(state: GameState, ctx: SimContext, c: Character, host: FactionId): boolean {
  const home = isPlayerHouse(state, c) ? state.player.factionId : c.factionId;
  if (home === undefined || home === host) return true;
  const rel = getRelation(state, home, host);
  return rel === undefined || (rel.stance !== 'war' && rel.opinion >= ctx.tunables.people.fosterage.hostageReturnOpinion);
}

/**
 * Monthly: hostages (fosterlings kept at a court) go home once relations mend; every other captive
 * makes a Vigor check: failure → serious wound; two in a row → mortal.
 */
export function monthlyCaptivity(draft: GameState, ctx: SimContext): void {
  const ps = peopleState(draft);
  if (ps.captiveIds.length === 0) return;
  const t = ctx.tunables.people.captivity;
  const rng = ctx.rng(STREAMS.captivity);
  for (const id of [...ps.captiveIds]) {
    const c = charOf(draft, id);
    if (!c?.alive || !c.captivity) continue;
    const rec = c.captivity;
    if (rec.hostage) {
      if (hostageMayReturn(draft, ctx, c, rec.byFactionId)) releaseCharacter(draft, ctx, c, 'hostageReturned');
      continue;
    }
    if (rng.chance(linearCheck(t.vigor, effectiveAttribute(c, 'vigor', ctx.content)))) {
      rec.vigorFails = 0;
      continue;
    }
    rec.vigorFails += 1;
    notifyHouse(ctx, c, 'people.notify.captivityIllness', {}, 'high');
    woundCharacter(draft, ctx, c, rec.vigorFails >= 2 ? 'mortal' : 'serious', 'captivity');
  }
}
