/**
 * Faith commands: sacrifice and readOmen (design-owned, §30.9), plus convertHouse, giveAlms and
 * foundChapel (module-owned, §17.7 / §22.6). Every rejection is a CommandError whose code has a
 * player-facing string `faith.error.<code>` in src/content/locales/en/faith.json.
 */
import { GodIdSchema } from '@content/schemas/ids';
import { OfferingKindSchema, OfferingSizeSchema } from '@content/schemas/tunables/faith';
import { CommandError } from '@sim/core/commands';
import type { CommandHandlers, CommandSchemas, SimContext } from '@sim/core/module';
import type { GameState, SettlementId } from '@sim/core/state';
import { z } from 'zod';
import { addChapel, conversionBlockers, convertPlayerHouse } from './conversion';
import { almsGain, changeFactionFavor, changePlayerPiety, groveMultiplier, groveTierOf, sacrificeGain } from './favor';
import { playerReadingBasis, rollReadings } from './omens';
import { bumpMonthCount, ensureFaithState, gainMultiplier, hostileTo, isLanternFaith, monthCount, monthOf, OLD_WAYS, presentAt } from './state';
import type { OmenActivity } from './types';

const settlementIdSchema = z.string().regex(/^set_.+$/, 'must be a set_ id').transform((s) => s as SettlementId);

/** zod schemas of the faith commands (unknown keys are stripped). */
export const FAITH_COMMAND_SCHEMAS: CommandSchemas = {
  sacrifice: z.object({
    type: z.literal('sacrifice'),
    god: GodIdSchema,
    kind: OfferingKindSchema,
    size: OfferingSizeSchema,
    settlementId: settlementIdSchema.optional(),
  }),
  readOmen: z.object({ type: z.literal('readOmen'), settlementId: settlementIdSchema.optional() }),
  convertHouse: z.object({ type: z.literal('convertHouse') }),
  giveAlms: z.object({ type: z.literal('giveAlms'), size: OfferingSizeSchema, settlementId: settlementIdSchema.optional() }),
  foundChapel: z.object({ type: z.literal('foundChapel'), settlementId: settlementIdSchema }),
};

/** The settlement the ruler is at, checked against an explicit `settlementId`. */
function rulerSettlement(draft: GameState, ctx: SimContext, wanted: SettlementId | undefined): SettlementId {
  const ruler = draft.characters[draft.player.rulerId];
  if (!ruler || !ruler.alive) throw new CommandError('noRuler', 'The house has no living ruler.');
  const here = presentAt(draft, ctx.tunables.faith, ruler.id);
  if (here === undefined) throw new CommandError('notAtSettlement', 'The ruler must be at a settlement.');
  if (wanted !== undefined && wanted !== here) throw new CommandError('notThere', `The ruler is not at ${wanted}.`);
  return here;
}

/** Throws unless the treasury holds `cost` silver. */
function requireSilver(draft: GameState, cost: number): void {
  const treasury = draft.factions[draft.player.factionId]?.treasury ?? 0;
  if (treasury < cost) throw new CommandError('notEnoughSilver', `Needs ${cost} silver.`, { cost, treasury });
}

/** True if a Lantern house can hear signs or give alms here (its chapel, or a Lantern church). */
function hasChurch(draft: GameState, ctx: SimContext, settlementId: SettlementId): boolean {
  const s = draft.settlements[settlementId];
  if (!s) return false;
  const t = ctx.tunables.faith;
  if ((draft.player.house.chapels ?? []).includes(settlementId) && s.factionId === draft.player.factionId) return true;
  return isLanternFaith(t, s.faith) && t.omens.churchTiers.includes(s.tier);
}

/** True if an Old Ways seer reads here (a Seer's Hut, or an Old Ways hub tier with a rune-seer). */
function hasSeer(draft: GameState, ctx: SimContext, settlementId: SettlementId): boolean {
  const s = draft.settlements[settlementId];
  if (!s) return false;
  const hut = Object.hasOwn(s.buildings, 'seersHut') ? (s.buildings['seersHut'] ?? 0) : 0;
  if (hut >= 1) return true;
  return s.faith === OLD_WAYS && ctx.tunables.faith.omens.seerTiers.includes(s.tier);
}

export const FAITH_HANDLERS: CommandHandlers = {
  sacrifice(draft, cmd, ctx) {
    const t = ctx.tunables.faith;
    if (draft.player.house.faith !== OLD_WAYS) throw new CommandError('wrongFaith', 'Only a house of the Old Ways offers at a grove.');
    const here = rulerSettlement(draft, ctx, cmd.settlementId);
    const s = draft.settlements[here];
    if (!s) throw new CommandError('notAtSettlement', 'The ruler must be at a settlement.');
    const ownHolding = s.factionId === draft.player.factionId && s.holding !== undefined;
    const groveTier = groveTierOf(t, s);
    const templeStead = s.tier === 'templeStead' && s.faith === OLD_WAYS;
    if (groveTier < 1 || !(ownHolding || templeStead)) throw new CommandError('noGrove', 'Offerings are made at a grove in one of your holdings, or at a temple-stead.');
    if (hostileTo(draft, draft.player.factionId, here)) throw new CommandError('hostile', 'You are at war with this place.');
    const size = t.sacrifice.sizes[cmd.size];
    const factionId = draft.player.factionId;
    if (cmd.kind === 'silver') {
      requireSilver(draft, size.silver);
      if (size.silver > 0) ctx.applyEffects([{ op: 'addSilver', amount: -size.silver }]);
    } else {
      const stock = draft.markets[here]?.stock.rations ?? 0;
      if (stock < size.livestockTons) throw new CommandError('notEnoughLivestock', `Needs ${size.livestockTons} tons of herds and stores.`, { stock });
      if (size.livestockTons > 0) ctx.applyEffects([{ op: 'addGoods', good: 'rations', tons: -size.livestockTons, settlementId: here }]);
    }
    const fs = ensureFaithState(draft);
    const month = monthOf(draft.time.hour);
    const nth = monthCount(fs.offerings, factionId, cmd.god, month) + 1;
    const gain = sacrificeGain(ctx.balance, t, cmd.size, cmd.kind, nth, groveMultiplier(ctx.balance, groveTier), gainMultiplier(draft, ctx.content, factionId, 'favor.gainPct'));
    bumpMonthCount(fs.offerings, factionId, cmd.god, month);
    const applied = changeFactionFavor(draft, ctx, factionId, cmd.god, gain, true);
    ctx.emit({ type: 'OfferingMade', factionId, god: cmd.god, kind: cmd.kind, size: cmd.size, gain: applied, nth, settlementId: here });
    ctx.notify(applied > 0 ? 'faith.sacrifice.done' : 'faith.sacrifice.unheeded', {
      priority: 'normal',
      vars: { god: cmd.god, gain: applied, kind: cmd.kind, settlement: s.name },
    });
    ctx.narrate(applied > 0 ? `faith.sacrifice.narration.${cmd.kind}` : 'faith.sacrifice.narration.unheeded', { god: cmd.god }, 'seer');
  },

  readOmen(draft, cmd, ctx) {
    const t = ctx.tunables.faith;
    const house = draft.player.house;
    const signs = isLanternFaith(t, house.faith);
    if (!signs && house.faith !== OLD_WAYS) throw new CommandError('wrongFaith', 'Your house keeps no seers.');
    const here = rulerSettlement(draft, ctx, cmd.settlementId);
    if (signs ? !hasChurch(draft, ctx, here) : !hasSeer(draft, ctx, here)) {
      throw new CommandError(signs ? 'noPriest' : 'noSeer', signs ? 'No priest here reads signs.' : 'No rune-seer lives here.');
    }
    if (hostileTo(draft, draft.player.factionId, here)) throw new CommandError('hostile', 'You are at war with this place.');
    const fs = ensureFaithState(draft);
    const last = Object.hasOwn(fs.seerReadHour, here) ? fs.seerReadHour[here] : undefined;
    const cooldownH = ctx.balance.omens.readCooldownDays * 24;
    if (last !== undefined && draft.time.hour < last + cooldownH) {
      throw new CommandError('seerCooldown', 'The seer will not cast again so soon.', { readyHour: last + cooldownH });
    }
    requireSilver(draft, t.omens.readCost);
    if (t.omens.readCost > 0) ctx.applyEffects([{ op: 'addSilver', amount: -t.omens.readCost }]);
    const basis = playerReadingBasis(draft, ctx.content);
    const { readings } = rollReadings(ctx.content, basis, ctx.rng('faith:omens'), draft.time.hour, here);
    house.omens = readings;
    fs.seerReadHour[here] = draft.time.hour;
    const summary: Partial<Record<OmenActivity, { omen: NonNullable<typeof readings.voyage>['omen']; score: number }>> = {};
    for (const [activity, r] of Object.entries(readings) as [OmenActivity, NonNullable<typeof readings.voyage>][]) {
      summary[activity] = { omen: r.omen, score: r.score };
      ctx.narrate(`faith.omen.${signs ? 'signs' : 'runes'}.${activity}.${r.omen}`, { activity }, 'seer');
    }
    ctx.emit({ type: 'OmenRead', factionId: draft.player.factionId, settlementId: here, signs, readings: summary });
    ctx.notify('faith.omen.read', {
      priority: 'normal',
      vars: {
        signs: signs ? 'lantern' : 'oldways',
        voyage: readings.voyage?.omen ?? 'uncertain',
        battle: readings.battle?.omen ?? 'uncertain',
        duel: readings.duel?.omen ?? 'uncertain',
        harvest: readings.harvest?.omen ?? 'uncertain',
      },
    });
  },

  convertHouse(draft, _cmd, ctx) {
    const blockers = conversionBlockers(draft, ctx.tunables.faith);
    const first = blockers[0];
    if (first !== undefined) throw new CommandError(first, `The house cannot convert: ${blockers.join(', ')}.`, { blockers });
    convertPlayerHouse(draft, ctx);
  },

  giveAlms(draft, cmd, ctx) {
    const t = ctx.tunables.faith;
    if (!isLanternFaith(t, draft.player.house.faith)) throw new CommandError('wrongFaith', 'Alms are given by houses of the Lantern.');
    const here = rulerSettlement(draft, ctx, cmd.settlementId);
    if (!hasChurch(draft, ctx, here)) throw new CommandError('noPriest', 'There is no church or chapel here.');
    if (hostileTo(draft, draft.player.factionId, here)) throw new CommandError('hostile', 'You are at war with this place.');
    const size = t.alms.sizes[cmd.size];
    requireSilver(draft, size.silver);
    if (size.silver > 0) ctx.applyEffects([{ op: 'addSilver', amount: -size.silver }]);
    const factionId = draft.player.factionId;
    const fs = ensureFaithState(draft);
    const month = monthOf(draft.time.hour);
    const nth = bumpMonthCount(fs.alms, factionId, 'alms', month);
    const gain = almsGain(t, cmd.size, nth, gainMultiplier(draft, ctx.content, factionId, 'piety.gainPct'));
    const applied = changePlayerPiety(draft, ctx, gain, true);
    ctx.emit({ type: 'AlmsGiven', factionId, size: cmd.size, piety: applied, nth, settlementId: here });
    ctx.notify('faith.alms.done', { priority: 'normal', vars: { piety: applied, settlement: draft.settlements[here]?.name ?? '' } });
  },

  foundChapel(draft, cmd, ctx) {
    const t = ctx.tunables.faith;
    if (!isLanternFaith(t, draft.player.house.faith)) throw new CommandError('wrongFaith', 'Only a house of the Lantern founds chapels.');
    const s = draft.settlements[cmd.settlementId];
    if (!s || s.factionId !== draft.player.factionId || !s.holding) throw new CommandError('notYourHolding', 'Chapels are founded in your own holdings.');
    if ((draft.player.house.chapels ?? []).includes(cmd.settlementId)) throw new CommandError('chapelExists', 'This holding already has a chapel.');
    requireSilver(draft, t.conversion.chapelCost);
    if (t.conversion.chapelCost > 0) ctx.applyEffects([{ op: 'addSilver', amount: -t.conversion.chapelCost }]);
    addChapel(draft, ctx, cmd.settlementId);
  },
};
