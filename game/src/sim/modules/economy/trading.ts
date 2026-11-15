/**
 * Trading and haggling (design §11.2, §11.3): the `trade` and `haggle` commands.
 *
 * A player fleet lying in a settlement's harbour (within `trade.dockRadius`, not sailing) buys and sells
 * at that market. Sales are applied before purchases; every quantity moves the stock while it trades, so
 * values are integrals of the §11.2 price (price.ts). The party speaker's Speechcraft, `prices.favorPct`
 * bonuses and a haggled improvement narrow the 10 % spread (never below the merchant's edge); foreign
 * markets add a tariff (a trade pact cuts it); war is an embargo and a blockade closes the harbour.
 * At home purchases are paid from the treasury and sales go to it; abroad the fleet's silver pays and
 * the proceeds ride home in the fleet. Rations are carried as a count (`fleet.rations`, ARCHITECTURE §10).
 * A war-band on the march (expeditions' shipless `fleet.overland`, ARCHITECTURE §19) trades like a fleet: it must
 * stand at the settlement (its war-band within `trade.dockRadius`), its baggage's silver pays, and what it can
 * carry is `overland.carryT` tons, shared by food, goods and plunder.
 *
 * At the player's capital the house storehouse can trade instead of a fleet (`storehouse: true`, or no fleet
 * of the player's in the harbour): goods move between the storehouse and the market, silver between the
 * treasury and the market, at the same prices (the speaker is the best Speechcraft of the house's people in
 * the capital; the storehouse has no hold limit). See types.ts for the storehouse's units.
 *
 * Haggling: 1–3 rounds over one batch. Each offer asks for an improvement (percent); the merchant
 * accepts, counters at `counterShare` of the ask, or refuses, by a deterministic roll on
 * base + Speechcraft + rapport − greed − ask − rounds. Accept closes the deal at the merchant's offer;
 * walking away costs a little rapport.
 */
import type { Content } from '@content/index';
import { CommandError } from '@sim/core/commands';
import { clamp } from '@sim/core/dmath';
import type { SimContext } from '@sim/core/module';
import type { Character, CharId, Fleet, FleetId, GameState, GoodId, SettlementId } from '@sim/core/state';
import { buyValue, goodPriceInput, sellValue, tariffFor, tradeMults } from './price';
import { changeStores, homeSpeaker, readStorehouse, storedTons } from './storehouse';
import { GOODS } from './profiles';
import { atWar, charModifier, cultureModifier, effectiveSkill, hasPact, hasTradeMarket, hash32, isBlockaded, roundTo } from './realm';
import { economyOf, readEconomy } from './slice';
import type { GoodTons, HaggleCommand, HaggleSession, TradeCommand } from './types';

/** One priced line of a deal. */
export interface DealLine {
  good: GoodId;
  tons: number;
  /** Silver for the line (paid for buys, received for sales). */
  value: number;
}

/** A priced deal (nothing applied). */
export interface Deal {
  settlementId: SettlementId;
  /** The fleet that holds the goods (absent when the storehouse trades). */
  fleetId?: FleetId;
  /** Who holds the goods: a fleet in the harbour or the house storehouse at the capital. */
  holder: 'fleet' | 'storehouse';
  sells: DealLine[];
  buys: DealLine[];
  earned: number;
  spent: number;
  /** The purse that pays: 'treasury' at home, 'fleet' abroad. */
  purse: 'treasury' | 'fleet';
  speakerId?: CharId;
  favour: number;
  tariff: number;
}

function err(code: string, message: string, details?: Record<string, string | number>): CommandError {
  return new CommandError(code, message, details);
}

/** Tons of a good aboard (rations as tons of their count). */
export function cargoTons(fleet: Fleet, good: GoodId, rationsPerTon: number): number {
  if (good === 'rations') return Math.max(0, fleet.rations) / rationsPerTon;
  return Math.max(0, fleet.cargo[good] ?? 0);
}

/** A march's carrying limit (expeditions' `fleet.overland.carryT`, tons), or undefined for a fleet of ships. */
export function overlandCarry(fleet: Fleet): number | undefined {
  const o = (fleet as { overland?: { carryT?: number } }).overland;
  return o !== undefined ? Math.max(0, o.carryT ?? 0) : undefined;
}

/** Where a fleet stands for trading: its ships, or for a march its war-band (the land party it is the baggage of). */
function tradePos(state: GameState, fleet: Fleet): { x: number; y: number } {
  if (overlandCarry(fleet) === undefined) return fleet.pos;
  const parties = (state as GameState & { expeditions?: { landParties?: Record<string, FleetId> } }).expeditions?.landParties ?? {};
  for (const armyId of Object.keys(parties)) {
    if (parties[armyId] !== fleet.id) continue;
    const a = state.armies[armyId as keyof GameState['armies']];
    if (a) return a.pos;
  }
  return fleet.pos;
}

/** Cargo capacity (tons) of a fleet's ships (or what a march's men can carry) and the tons aboard (rations included). */
export function holdOf(state: GameState, content: Content, fleet: Fleet): { capacity: number; used: number } {
  let capacity = overlandCarry(fleet) ?? 0;
  for (const id of fleet.shipIds) {
    const ship = state.ships[id];
    const def = ship ? content.balance.ships[ship.type] : undefined;
    if (def) capacity += def.cargoT;
  }
  let used = Math.max(0, fleet.rations) / content.balance.economy.rationsPerTon;
  for (const g of GOODS) if (g !== 'rations') used += Math.max(0, fleet.cargo[g] ?? 0);
  return { capacity, used };
}

/** The player's fleet that can trade at a settlement (or a CommandError). */
export function tradingFleet(state: GameState, content: Content, settlementId: SettlementId, fleetId?: FleetId): Fleet {
  const s = state.settlements[settlementId];
  if (!s) throw err('unknownSettlement', `No settlement ${settlementId}.`);
  const r = content.tunables.economy.trade.dockRadius;
  const near = (f: Fleet) => {
    if (f.ownerId !== state.player.factionId || f.mode === 'sailing' || (f.shipIds.length === 0 && overlandCarry(f) === undefined)) return false;
    const p = tradePos(state, f);
    return (p.x - s.mapPos.x) ** 2 + (p.y - s.mapPos.y) ** 2 <= r * r;
  };
  if (fleetId !== undefined) {
    const f = state.fleets[fleetId];
    if (!f || f.ownerId !== state.player.factionId) throw err('unknownFleet', `No fleet ${fleetId} of yours.`);
    if (!near(f)) throw err('notInHarbour', 'The fleet must lie in the harbour to trade.');
    return f;
  }
  const exp = state.player.expeditionFleetId;
  if (exp !== undefined) {
    const f = state.fleets[exp];
    if (f && near(f)) return f;
  }
  for (const f of Object.values(state.fleets)) if (near(f)) return f;
  throw err('notInHarbour', 'No fleet of yours lies in that harbour.');
}

/** The party speaker (best Speechcraft aboard, the ruler included if aboard). */
export function speakerOf(state: GameState, content: Content, fleet: Fleet): Character | undefined {
  const ids: CharId[] = [fleet.leaderId, ...fleet.lieutenantIds];
  const ruler = state.characters[state.player.rulerId];
  if (ruler && ruler.location.kind === 'fleet' && ruler.location.id === fleet.id) ids.push(ruler.id);
  // On a march the ruler walks with the war-band (the baggage's land party).
  const parties = (state as GameState & { expeditions?: { landParties?: Record<string, FleetId> } }).expeditions?.landParties ?? {};
  if (ruler && ruler.location.kind === 'army' && parties[ruler.location.id] === fleet.id && !ids.includes(ruler.id)) ids.push(ruler.id);
  let best: Character | undefined;
  let bestV = -1;
  for (const id of ids) {
    const c = state.characters[id];
    if (!c?.alive || c.location.kind === 'captive') continue;
    const v = effectiveSkill(content, c, 'speechcraft');
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  return best;
}

function cleanTons(list: GoodTons | undefined, max: number): [GoodId, number][] {
  const out: [GoodId, number][] = [];
  if (!list) return out;
  for (const g of GOODS) {
    const v = list[g];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) throw err('badQuantity', `Bad quantity of ${g}.`);
    if (v > max) throw err('tooMuch', `At most ${max} t of ${g} at once.`);
    const tons = roundTo(v, 3);
    if (tons > 0) out.push([g, tons]);
  }
  return out;
}

/**
 * Whether a trade command deals from the house storehouse (see the header): `storehouse: true` at the capital,
 * or at the capital with no fleet named and no fleet of the player's in the harbour. Throws when the
 * storehouse is asked for anywhere but the capital.
 */
export function tradesFromStorehouse(state: GameState, content: Content, cmd: Pick<TradeCommand, 'settlementId' | 'fleetId' | 'storehouse'>): boolean {
  const atCapital = cmd.settlementId === state.player.capitalId && state.settlements[cmd.settlementId]?.factionId === state.player.factionId;
  if (cmd.storehouse === true) {
    if (!atCapital) throw err('notCapital', 'The storehouse trades only at the capital.');
    if (cmd.fleetId !== undefined) throw err('twoHolders', 'Trade from a fleet or from the storehouse, not both.');
    return true;
  }
  if (!atCapital || cmd.fleetId !== undefined) return false;
  const s = state.settlements[cmd.settlementId];
  if (!s) return false;
  const r = content.tunables.economy.trade.dockRadius;
  for (const f of Object.values(state.fleets)) {
    if (f.ownerId === state.player.factionId && (f.pos.x - s.mapPos.x) ** 2 + (f.pos.y - s.mapPos.y) ** 2 <= r * r) return false;
  }
  return true;
}

/**
 * Prices a deal at the market as it is now (pure). Throws CommandError when it cannot be made:
 * no market, embargo, blockade, not enough cargo, stock, hold space or silver.
 */
export function priceDeal(state: GameState, content: Content, cmd: TradeCommand, haggle = 0): Deal {
  const t = content.tunables.economy;
  const settlementId = cmd.settlementId;
  const s = state.settlements[settlementId];
  if (!s) throw err('unknownSettlement', `No settlement ${settlementId}.`);
  const market = state.markets[settlementId];
  if (!market || !hasTradeMarket(content, s)) throw err('noMarket', 'There is no market here.');
  const useStore = tradesFromStorehouse(state, content, cmd);
  const fleet = useStore ? undefined : tradingFleet(state, content, settlementId, cmd.fleetId);
  const store = readStorehouse(state);
  const player = state.player.factionId;
  const own = s.factionId === player;
  if (!own && atWar(state, player, s.factionId)) throw err('embargo', 'Their merchants will not deal with an enemy.');
  if (isBlockaded(state, settlementId, state.time.hour)) throw err('blockaded', 'The harbour is blockaded.');
  const sells = cleanTons(cmd.sell, t.trade.maxTonsPerGood);
  const buys = cleanTons(cmd.buy, t.trade.maxTonsPerGood);
  if (sells.length === 0 && buys.length === 0) throw err('emptyDeal', 'Nothing to buy or sell.');

  const speaker = fleet ? speakerOf(state, content, fleet) : homeSpeaker(state, content);
  const speech = speaker ? effectiveSkill(content, speaker, 'speechcraft') : 0;
  const favorPct = cultureModifier(content, state.factions[player]?.culture, 'prices.favorPct') + (speaker ? charModifier(content, speaker, 'prices.favorPct') : 0);
  const tariff = tariffFor(content, own, hasPact(state, player, s.factionId, 'trade', state.time.hour));
  const mults = tradeMults(content, { speechcraft: speech, favorPct, haggle, tariff });
  const rationsPerTon = content.balance.economy.rationsPerTon;
  const held = (good: GoodId) => (fleet ? cargoTons(fleet, good, rationsPerTon) : storedTons(store, good, rationsPerTon));

  // Sales first: the stock rises as goods are sold.
  const stock: Partial<Record<GoodId, number>> = {};
  const sellLines: DealLine[] = [];
  let earned = 0;
  for (const [good, tons] of sells) {
    if (tons > held(good) + 1e-9) throw fleet ? err('notAboard', `Not that much ${good} aboard.`, { good, tons }) : err('notStored', `Not that much ${good} in the storehouse.`, { good, tons });
    const input = goodPriceInput(state, content, settlementId, good, market);
    input.stock += stock[good] ?? 0;
    const value = Math.floor(sellValue(content.balance, input, tons) * mults.sellMult);
    stock[good] = (stock[good] ?? 0) + tons;
    sellLines.push({ good, tons, value });
    earned += value;
  }
  const buyLines: DealLine[] = [];
  let spent = 0;
  let addTons = 0;
  for (const [good, tons] of buys) {
    const input = goodPriceInput(state, content, settlementId, good, market);
    input.stock += stock[good] ?? 0;
    if (tons > input.stock + 1e-9) throw err('notInStock', `The market has only ${roundTo(input.stock, 1)} t of ${good}.`, { good, stock: roundTo(input.stock, 3) });
    const value = Math.ceil(buyValue(content.balance, input, tons) * mults.buyMult);
    stock[good] = (stock[good] ?? 0) - tons;
    buyLines.push({ good, tons, value });
    spent += value;
    addTons += tons;
  }
  let soldTons = 0;
  for (const l of sellLines) soldTons += l.tons;
  if (fleet) {
    const hold = holdOf(state, content, fleet);
    if (hold.used - soldTons + addTons > hold.capacity + 1e-9) throw err('holdFull', 'The ships cannot carry that much.', { capacity: roundTo(hold.capacity, 1), used: roundTo(hold.used, 1) });
  }
  const purse: Deal['purse'] = own ? 'treasury' : 'fleet';
  const funds = purse === 'treasury' || !fleet ? (state.factions[player]?.treasury ?? 0) : fleet.silver;
  if (spent > funds + earned) throw err('notEnoughSilver', `Needs ${spent - earned} more silver.`, { cost: spent, funds: funds + earned });
  const deal: Deal = { settlementId, holder: fleet ? 'fleet' : 'storehouse', sells: sellLines, buys: buyLines, earned, spent, purse, favour: mults.favour, tariff };
  if (fleet) deal.fleetId = fleet.id;
  if (speaker) deal.speakerId = speaker.id;
  return deal;
}

/** Applies a priced deal: market stocks, cargo, silver, rapport, trade volume; emits TradeCompleted. */
export function applyDeal(draft: GameState, ctx: SimContext, deal: Deal, haggledPct: number): void {
  const t = ctx.tunables.economy;
  const rationsPerTon = ctx.balance.economy.rationsPerTon;
  const market = draft.markets[deal.settlementId];
  const fleet = deal.fleetId !== undefined ? draft.fleets[deal.fleetId] : undefined;
  const faction = draft.factions[draft.player.factionId];
  if (!market || !faction || (deal.holder === 'fleet' && !fleet)) return;
  const storeDelta: GoodTons = {};
  let storeRations = 0;
  const dec = t.market.stockDecimals;
  const bought: GoodTons = {};
  const sold: GoodTons = {};
  let tons = 0;
  for (const l of deal.sells) {
    market.stock[l.good] = roundTo((market.stock[l.good] ?? 0) + l.tons, dec);
    if (!fleet) {
      if (l.good === 'rations') storeRations -= Math.round(l.tons * rationsPerTon);
      else storeDelta[l.good] = (storeDelta[l.good] ?? 0) - l.tons;
    } else if (l.good === 'rations') fleet.rations = Math.max(0, Math.round(fleet.rations - l.tons * rationsPerTon));
    else {
      const left = roundTo((fleet.cargo[l.good] ?? 0) - l.tons, 3);
      if (left > 0) fleet.cargo[l.good] = left;
      else delete fleet.cargo[l.good];
    }
    sold[l.good] = l.tons;
    tons += l.tons;
  }
  for (const l of deal.buys) {
    market.stock[l.good] = roundTo(Math.max(0, (market.stock[l.good] ?? 0) - l.tons), dec);
    if (!fleet) {
      if (l.good === 'rations') storeRations += Math.round(l.tons * rationsPerTon);
      else storeDelta[l.good] = (storeDelta[l.good] ?? 0) + l.tons;
    } else if (l.good === 'rations') fleet.rations = Math.round(fleet.rations + l.tons * rationsPerTon);
    else fleet.cargo[l.good] = roundTo((fleet.cargo[l.good] ?? 0) + l.tons, 3);
    bought[l.good] = l.tons;
    tons += l.tons;
  }
  if (!fleet) changeStores(draft, storeDelta, storeRations);
  const net = deal.earned - deal.spent;
  if (deal.purse === 'treasury' || !fleet) faction.treasury = Math.max(0, faction.treasury + net);
  else if (t.trade.proceedsToFleetAbroad) fleet.silver = Math.max(0, fleet.silver + net);
  else faction.treasury = Math.max(0, faction.treasury + net);
  market.tradeTons = roundTo((market.tradeTons ?? 0) + tons, dec);
  const eco = economyOf(draft);
  const gain = Math.min(t.trade.rapportGainCap, ((deal.earned + deal.spent) / 1000) * t.trade.rapportPerThousand);
  if (gain > 0) eco.rapport[deal.settlementId] = clampRapport(ctx, (eco.rapport[deal.settlementId] ?? 0) + gain);
  ctx.emit({ type: 'TradeCompleted', settlementId: deal.settlementId, ...(fleet ? { fleetId: fleet.id } : { storehouse: true }), bought, sold, spent: deal.spent, earned: deal.earned, haggledPct });
}

function clampRapport(ctx: SimContext, v: number): number {
  const [lo, hi] = ctx.tunables.economy.haggle.rapportRange;
  return roundTo(clamp(v, lo, hi), 2);
}

/** The `trade` command. */
export function handleTrade(draft: GameState, cmd: TradeCommand, ctx: SimContext): void {
  const deal = priceDeal(draft, ctx.content, cmd);
  applyDeal(draft, ctx, deal, 0);
}

/** A merchant's greed (0–1), stable per campaign and settlement. */
export function merchantGreed(state: GameState, content: Content, settlementId: SettlementId): number {
  const [lo, hi] = content.tunables.economy.haggle.greedRange;
  const u = (hash32(`${state.meta.seed}|greed|${settlementId}`) >>> 0) / 4294967296;
  return lo + (hi - lo) * u;
}

/** Acceptance chance of a haggling ask (pure; the client shows it as odds). */
export function haggleChance(content: Content, speechcraft: number, rapport: number, greed: number, askPct: number, round: number): number {
  const h = content.tunables.economy.haggle;
  const p = h.base + h.speechcraftPer * speechcraft + h.rapportPer * rapport - h.greedWeight * greed - h.askWeight * askPct - h.roundPenalty * (round - 1);
  return clamp(p, h.minChance, h.maxChance);
}

/** The open haggle session for a settlement (stale sessions — time has passed — count as none). */
function openSession(state: GameState, settlementId: SettlementId): HaggleSession | undefined {
  const s = readEconomy(state).haggle;
  return s !== undefined && s.settlementId === settlementId && s.hour === state.time.hour ? s : undefined;
}

/** The `haggle` command. */
export function handleHaggle(draft: GameState, cmd: HaggleCommand, ctx: SimContext): void {
  const content = ctx.content;
  const h = content.tunables.economy.haggle;
  const eco = economyOf(draft);
  const session = openSession(draft, cmd.settlementId);
  if (cmd.action === 'walkAway') {
    if (!session) throw err('noHaggle', 'There is no bargain to walk away from.');
    const loss = h.rapportLossPerRound * Math.max(0, session.round - 1);
    if (loss > 0) eco.rapport[cmd.settlementId] = clampRapport(ctx, (eco.rapport[cmd.settlementId] ?? 0) - loss);
    delete eco.haggle;
    return;
  }
  if (cmd.action === 'accept') {
    if (!session) throw err('noHaggle', 'There is no bargain to accept.');
    const batch: TradeCommand = { settlementId: session.settlementId, buy: session.buy, sell: session.sell, ...(session.fleetId !== undefined ? { fleetId: session.fleetId } : {}), ...(session.storehouse === true ? { storehouse: true } : {}) };
    const deal = priceDeal(draft, content, batch, session.offerPct / 100);
    delete eco.haggle;
    applyDeal(draft, ctx, deal, session.offerPct);
    if (session.offerPct > 0) eco.rapport[cmd.settlementId] = clampRapport(ctx, (eco.rapport[cmd.settlementId] ?? 0) + h.rapportGainOnAccept);
    return;
  }
  // 'offer'
  const ask = cmd.askPct;
  if (ask === undefined || !Number.isFinite(ask) || ask < 1 || ask > h.maxAskPct) throw err('badAsk', `Ask for 1–${h.maxAskPct} %.`, { max: h.maxAskPct });
  let s: HaggleSession;
  if (session && session.status === 'final') throw err('haggleFinal', 'The merchant has made a last offer: accept or walk away.');
  if (session) s = session;
  else {
    const batch: TradeCommand = { settlementId: cmd.settlementId, ...(cmd.buy !== undefined ? { buy: cmd.buy } : {}), ...(cmd.sell !== undefined ? { sell: cmd.sell } : {}), ...(cmd.fleetId !== undefined ? { fleetId: cmd.fleetId } : {}), ...(cmd.storehouse === true ? { storehouse: true } : {}) };
    const deal = priceDeal(draft, content, batch);
    s = { settlementId: cmd.settlementId, buy: { ...(cmd.buy ?? {}) }, sell: { ...(cmd.sell ?? {}) }, round: 0, askPct: 0, offerPct: 0, status: 'open', hour: ctx.hour };
    if (deal.fleetId !== undefined) s.fleetId = deal.fleetId;
    else s.storehouse = true;
  }
  const fleet = s.fleetId !== undefined ? draft.fleets[s.fleetId] : undefined;
  const speaker = fleet ? speakerOf(draft, content, fleet) : homeSpeaker(draft, content);
  const speech = speaker ? effectiveSkill(content, speaker, 'speechcraft') : 0;
  const rapport = eco.rapport[cmd.settlementId] ?? 0;
  const greed = merchantGreed(draft, content, cmd.settlementId);
  const round = s.round + 1;
  const p = haggleChance(content, speech, rapport, greed, ask, round);
  const roll = ctx.rng('economy:haggle').float();
  let outcome: 'accepted' | 'countered' | 'refused';
  let offer = s.offerPct;
  if (roll < p) {
    outcome = 'accepted';
    offer = Math.max(offer, ask);
  } else if (roll < p + h.counterBand) {
    outcome = 'countered';
    offer = Math.max(offer, roundTo(ask * h.counterShare, 1));
  } else {
    outcome = 'refused';
    eco.rapport[cmd.settlementId] = clampRapport(ctx, rapport - h.rapportLossOnRefuse);
  }
  const final = outcome === 'accepted' || round >= ctx.balance.market.haggleRoundsMax;
  const next: HaggleSession = { ...s, buy: { ...s.buy }, sell: { ...s.sell }, round, askPct: ask, offerPct: offer, status: final ? 'final' : 'open', hour: ctx.hour };
  eco.haggle = next;
  ctx.emit({ type: 'HaggleResponse', settlementId: cmd.settlementId, round, outcome, askPct: ask, offerPct: offer, rapport: eco.rapport[cmd.settlementId] ?? 0, final });
}
