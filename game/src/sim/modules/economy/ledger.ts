/**
 * The monthly ledger of every house (design §11.5, §31.1, §10.4, §10.7, §12.2, §12.5, §12.7).
 *
 * Income:  taxes per holding  pop × taxPerCapita × taxMult × prosperity × (1 + 0.03 × governor Stewardship)
 *                             (× royal estates for crowned kingdoms, × the ruler's `income.pct`, × AI income)
 *          market tolls       {0, 20, 50}[Market tier] per holding
 *          straits tolls      25 per Straits province held (Eyjar ×1, others ×0.6)
 *          tribute            Σ tributaries 12 % × their domain income;  vassal dues Σ vassals 10 %
 *          trade routes       net profit of the house's routes this month (routes.ts)
 * Expenses: unit wages (garrisons, fleets, armies, men in transit, wounded), lieutenants (20 s each,
 *           non-kin), ship upkeep, building upkeep, factor wages (30 s per hired factor), tribute paid.
 *
 * `computeLedger(s)` are pure (the client's Affairs of State preview uses them); `applyMonthlyLedgers`
 * moves the silver, runs the arrears rules (arrears.ts) and reports the player's ledger.
 */
import type { Content } from '@content/index';
import type { TaxRateId } from '@content/schemas/ids';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, Settlement, SettlementId, UnitTypeId } from '@sim/core/state';
import { toCalendar } from '@sim/core/time';
import { applyArrears } from './arrears';
import { buildingTier, buildingUpkeep, charModifier, effectiveSkill, holdsCrown, isKinOf, isRecord, provinceTags, recGet, recNum, recOr } from './realm';
import { economyOf, readEconomy, snap } from './slice';
import {
  LEDGER_EXPENSE_KEYS,
  LEDGER_INCOME_KEYS,
  type LedgerExpenseKey,
  type LedgerIncomeKey,
  type LedgerItem,
  type LedgerLineKey,
  type LedgerReport,
} from './types';

/** One house's computed ledger (before any silver moves). */
export interface LedgerComputation {
  factionId: FactionId;
  income: Record<LedgerIncomeKey, number>;
  expenses: Record<LedgerExpenseKey, number>;
  breakdown: Record<LedgerLineKey, LedgerItem[]>;
  /** Taxes + market tolls + straits tolls. */
  domainIncome: number;
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

/** Extra income lines computed elsewhere this month (trade routes, harbour tolls from other houses' routes). */
export interface LedgerExtras {
  tradeRoutes?: Partial<Record<FactionId, LedgerItem[]>>;
  harbourTolls?: Partial<Record<FactionId, LedgerItem[]>>;
}

function emptyLines<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

function emptyBreakdown(): Record<LedgerLineKey, LedgerItem[]> {
  const out = {} as Record<LedgerLineKey, LedgerItem[]>;
  for (const k of LEDGER_INCOME_KEYS) out[k] = [];
  for (const k of LEDGER_EXPENSE_KEYS) out[k] = [];
  return out;
}

interface Acc {
  comp: LedgerComputation;
  /** unit → men, for the wage breakdown. */
  men: Record<string, number>;
  /** unit → silver (fractional until rounded per unit). */
  wage: Record<string, number>;
  /** ship type → [count, upkeep]. */
  ships: Record<string, [number, number]>;
}

/** Monthly wage of one man of a unit type (balance.units wage, else the fallback for enemy units). */
export function unitWageOf(content: Content, unit: UnitTypeId): number {
  const def = recGet(content.balance.units, unit);
  const wage = def?.wage;
  return typeof wage === 'number' && Number.isFinite(wage) ? wage : content.tunables.economy.ledger.fallbackUnitWage;
}

/** Monthly tax of one settlement for its owner (§31.1), with the factors used. */
export function settlementTax(
  state: GameState,
  content: Content,
  s: Settlement,
): { amount: number; tax: TaxRateId; prosperity: number; stewardship: number; mult: number } {
  const b = content.balance.economy;
  const tax: TaxRateId = s.holding?.tax ?? 'fair';
  const prosperity = recOr(b.prosperity, s.economy, 1);
  const governorId = s.holding?.governorId ?? s.leaderId;
  const stewardship = effectiveSkill(content, state.characters[governorId], 'stewardship');
  let mult = 1;
  const faction = state.factions[s.factionId];
  if (faction) {
    const ruler = state.characters[faction.rulerId];
    mult *= Math.max(0, 1 + charModifier(content, ruler, 'income.pct') / 100);
    if (s.factionId === state.player.factionId) {
      const kingdomId = state.provinces[s.provinceId]?.kingdomId;
      if (holdsCrown(state, content.tunables.economy.ledger.crownFlagPrefix, kingdomId)) mult *= 1 + b.royalEstatesTaxBonus;
    } else {
      mult *= content.balance.difficulty[state.meta.difficulty].aiIncomeMult;
    }
  }
  const amount = Math.max(0, s.pop) * b.taxPerCapita * recOr(b.taxMult, tax, 1) * prosperity * (1 + b.governorStewardshipTax * stewardship) * mult;
  return { amount, tax, prosperity, stewardship, mult };
}

/** Market toll of a settlement (§31.1: {0, 20, 50}[Market tier]). */
export function settlementMarketToll(content: Content, s: Settlement): number {
  const tolls = content.balance.economy.marketTolls;
  const tier = buildingTier(s, 'market');
  if (tolls.length === 0) return 0;
  return tolls[Math.min(tier, tolls.length - 1)] ?? 0;
}

/** Monthly building upkeep of a settlement (§10.4). */
export function settlementBuildingUpkeep(content: Content, s: Settlement): number {
  let sum = 0;
  for (const id of Object.keys(s.buildings)) sum += buildingUpkeep(content, id, buildingTier(s, id));
  return sum;
}

function addMen(acc: Acc, unit: string, men: number, wageEach: number, mult: number): void {
  if (!(men > 0)) return;
  acc.men[unit] = (acc.men[unit] ?? 0) + men;
  acc.wage[unit] = (acc.wage[unit] ?? 0) + men * wageEach * mult;
}

function addWounded(acc: Acc, content: Content, batches: unknown, mult: number): void {
  if (!Array.isArray(batches)) return;
  for (const b of batches) {
    if (!isRecord(b) || typeof b.unit !== 'string' || typeof b.count !== 'number') continue;
    addMen(acc, b.unit, b.count, unitWageOf(content, b.unit), mult);
  }
}

/** Direction of a tribute/vassal pact when diplomacy records it on the pact (read defensively). */
function pactPayer(pact: Record<string, unknown>, a: string, b: string): { payer: string; payee: string } | undefined {
  for (const key of ['payerId', 'fromId', 'tributaryId', 'vassalId', 'byId']) {
    const v = pact[key];
    if (v === a) return { payer: a, payee: b };
    if (v === b) return { payer: b, payee: a };
  }
  for (const key of ['overlordId', 'liegeId', 'payeeId', 'toId']) {
    const v = pact[key];
    if (v === a) return { payer: b, payee: a };
    if (v === b) return { payer: a, payee: b };
  }
  return undefined;
}

/**
 * The ledgers of every house (or of `only`) for the month starting at `state.time.hour`, from a
 * plain state (a frozen state or a snapshot). Pure.
 */
export function computeLedgers(state: GameState, content: Content, extras: LedgerExtras = {}, only?: readonly FactionId[]): Record<FactionId, LedgerComputation> {
  const t = content.tunables.economy;
  const b = content.balance.economy;
  const player = state.player.factionId;
  const accs: Record<FactionId, Acc> = {};
  const wanted = only ? [...only] : (Object.keys(state.factions) as FactionId[]);
  // Tribute needs the payers' domain income, so every payer of a wanted house is computed too.
  const all = Object.keys(state.factions) as FactionId[];
  for (const id of all) {
    accs[id] = {
      comp: {
        factionId: id,
        income: emptyLines(LEDGER_INCOME_KEYS),
        expenses: emptyLines(LEDGER_EXPENSE_KEYS),
        breakdown: emptyBreakdown(),
        domainIncome: 0,
        totalIncome: 0,
        totalExpenses: 0,
        net: 0,
      },
      men: {},
      wage: {},
      ships: {},
    };
  }
  const aiGarrison = t.ledger.aiGarrisonWageMult;

  // Settlements: taxes, tolls, buildings, garrisons.
  const settlementTribute: { payer: FactionId; payee: FactionId; base: number; id: SettlementId; kind: 'tribute' | 'vassalDues' }[] = [];
  for (const id of Object.keys(state.settlements) as SettlementId[]) {
    const s = state.settlements[id] as Settlement;
    const acc = recGet(accs, s.factionId);
    if (!acc) continue;
    const c = acc.comp;
    const tax = settlementTax(state, content, s);
    const taxAmount = Math.round(tax.amount);
    if (taxAmount > 0) {
      c.income.taxes += taxAmount;
      c.breakdown.taxes.push({
        id,
        amount: taxAmount,
        info: { pop: s.pop, tax: tax.tax, prosperity: tax.prosperity, stewardship: tax.stewardship, mult: Math.round(tax.mult * 1000) / 1000 },
      });
    }
    const toll = settlementMarketToll(content, s);
    if (toll > 0) {
      c.income.marketTolls += toll;
      c.breakdown.marketTolls.push({ id, amount: toll, info: { tier: buildingTier(s, 'market') } });
    }
    const upkeep = settlementBuildingUpkeep(content, s);
    if (upkeep > 0) {
      c.expenses.buildings += upkeep;
      c.breakdown.buildings.push({ id, amount: upkeep });
    }
    const mult = s.factionId === player ? 1 : aiGarrison;
    for (const unit of Object.keys(s.garrison)) addMen(acc, unit, recNum(s.garrison, unit), unitWageOf(content, unit), mult);
    const ext = s as Settlement & Record<string, unknown>;
    addWounded(acc, content, ext.woundedMen, mult);
    // Settlement-level tribute or vassalage (settlements module, read defensively).
    for (const [key, kind] of [
      ['tributaryOf', 'tribute'],
      ['tributeTo', 'tribute'],
      ['vassalOf', 'vassalDues'],
    ] as const) {
      const payee = ext[key];
      if (typeof payee === 'string' && payee !== s.factionId && Object.hasOwn(accs, payee)) {
        settlementTribute.push({ payer: s.factionId, payee: payee as FactionId, base: taxAmount + toll, id, kind });
      }
    }
  }

  // Fleets, armies, men in transit.
  for (const id of Object.keys(state.fleets)) {
    const f = state.fleets[id as keyof typeof state.fleets];
    if (!f) continue;
    const acc = recGet(accs, f.ownerId);
    if (!acc) continue;
    for (const unit of Object.keys(f.men)) addMen(acc, unit, recNum(f.men, unit), unitWageOf(content, unit), 1);
    addWounded(acc, content, (f as typeof f & Record<string, unknown>).woundedMen, 1);
  }
  for (const id of Object.keys(state.armies)) {
    const a = state.armies[id as keyof typeof state.armies];
    if (!a) continue;
    const acc = recGet(accs, a.ownerId);
    if (!acc) continue;
    for (const sq of a.squads) addMen(acc, sq.unit, sq.men, unitWageOf(content, sq.unit), 1);
    addWounded(acc, content, (a as typeof a & Record<string, unknown>).woundedMen, 1);
  }
  const military = (state as GameState & { military?: unknown }).military;
  if (isRecord(military) && Array.isArray(military.transfers)) {
    for (const tr of military.transfers) {
      if (!isRecord(tr) || typeof tr.factionId !== 'string' || !isRecord(tr.men)) continue;
      const acc = recGet(accs, tr.factionId);
      if (!acc) continue;
      for (const unit of Object.keys(tr.men)) {
        const n = tr.men[unit];
        if (typeof n === 'number') addMen(acc, unit, n, unitWageOf(content, unit), 1);
      }
    }
  }

  // Ships.
  for (const id of Object.keys(state.ships)) {
    const ship = state.ships[id as keyof typeof state.ships];
    if (!ship) continue;
    const acc = recGet(accs, ship.ownerId);
    if (!acc) continue;
    const upkeep = recGet(content.balance.ships, ship.type)?.upkeep ?? 0;
    const row = (acc.ships[ship.type] ??= [0, 0]);
    row[0] += 1;
    row[1] += upkeep;
  }

  // Lieutenants (non-kin, free, not the ruler).
  const roles = t.ledger.lieutenantRoles;
  for (const id of Object.keys(state.characters)) {
    const ch = state.characters[id as keyof typeof state.characters];
    if (!ch || !ch.alive || ch.factionId === undefined || !ch.role || !roles.includes(ch.role.kind)) continue;
    const faction = state.factions[ch.factionId];
    const acc = recGet(accs, ch.factionId);
    if (!faction || !acc || faction.rulerId === ch.id) continue;
    if (ch.location.kind === 'captive') continue;
    if (isKinOf(state, ch.id, faction.rulerId)) continue;
    acc.comp.expenses.lieutenants += b.lieutenantWage;
    acc.comp.breakdown.lieutenants.push({ id: ch.id, amount: b.lieutenantWage });
  }

  // Straits tolls: Straits provinces whose capital the house holds.
  const straitsTag = t.ledger.straitsTag;
  for (const pid of Object.keys(state.provinces)) {
    const p = state.provinces[pid as keyof typeof state.provinces];
    if (!p) continue;
    const owner = state.settlements[p.capitalId]?.factionId;
    if (owner === undefined) continue;
    const acc = recGet(accs, owner);
    const faction = state.factions[owner];
    if (!acc || !faction || !provinceTags(p).includes(straitsTag)) continue;
    const rate = faction.culture === t.ledger.straitsFullRateCulture ? b.straitsTollMult.eyjar : b.straitsTollMult.other;
    const amount = Math.round(b.straitsTollPerProvince * rate);
    if (amount <= 0) continue;
    acc.comp.income.straitsTolls += amount;
    acc.comp.breakdown.straitsTolls.push({ id: p.id, amount });
  }

  // Trade routes and harbour tolls from routes (computed by routes.ts this month).
  for (const id of all) {
    const acc = accs[id] as Acc;
    for (const item of extras.tradeRoutes?.[id] ?? []) {
      acc.comp.income.tradeRoutes += item.amount;
      acc.comp.breakdown.tradeRoutes.push(item);
    }
    for (const item of extras.harbourTolls?.[id] ?? []) {
      acc.comp.income.marketTolls += item.amount;
      acc.comp.breakdown.marketTolls.push(item);
    }
  }
  // Factor wages: one per route without a lieutenant captain.
  const eco = readEconomy(state);
  for (const routeId of Object.keys(eco.routes)) {
    const r = eco.routes[routeId as keyof typeof eco.routes];
    if (!r || r.captainId !== undefined) continue;
    const acc = recGet(accs, r.factionId);
    if (!acc) continue;
    acc.comp.expenses.factors += b.factorWage;
    acc.comp.breakdown.factors.push({ id: r.id, amount: b.factorWage });
  }

  // Finish wages and ship lines, domain income.
  for (const id of all) {
    const acc = accs[id] as Acc;
    const c = acc.comp;
    for (const unit of Object.keys(acc.wage).sort()) {
      const amount = Math.round(acc.wage[unit] ?? 0);
      c.expenses.wages += amount;
      c.breakdown.wages.push({ id: unit, amount, count: acc.men[unit] ?? 0 });
    }
    for (const type of Object.keys(acc.ships).sort()) {
      const [count, upkeep] = acc.ships[type] as [number, number];
      c.expenses.ships += upkeep;
      c.breakdown.ships.push({ id: type, amount: upkeep, count });
    }
    c.domainIncome = c.income.taxes + c.income.marketTolls + c.income.straitsTolls;
  }

  // Tribute and vassal dues (§10.7): faction lists, pacts with a recorded direction, settlement tributes.
  const pairs: Record<string, { payer: FactionId; payee: FactionId; kind: 'tribute' | 'vassalDues' }> = {};
  const addPair = (payer: string, payee: string, kind: 'tribute' | 'vassalDues') => {
    if (payer === payee || !Object.hasOwn(accs, payer) || !Object.hasOwn(accs, payee)) return;
    const key = `${payer}>${payee}`;
    if (Object.hasOwn(pairs, key)) return;
    pairs[key] = { payer: payer as FactionId, payee: payee as FactionId, kind };
  };
  for (const id of all) {
    const f = state.factions[id];
    if (!f) continue;
    for (const v of f.vassalIds) addPair(v, id, 'vassalDues');
    if (f.liegeId !== undefined) addPair(id, f.liegeId, 'vassalDues');
    for (const tr of f.tributaryIds) addPair(tr, id, 'tribute');
  }
  for (const key of Object.keys(state.relations)) {
    const rel = state.relations[key];
    if (!rel) continue;
    for (const pact of rel.pacts) {
      if (pact.kind !== 'tributary' && pact.kind !== 'vassal') continue;
      if (pact.untilHour !== undefined && pact.untilHour <= state.time.hour) continue;
      const dir = pactPayer(pact as unknown as Record<string, unknown>, rel.a, rel.b);
      if (dir) addPair(dir.payer, dir.payee, pact.kind === 'vassal' ? 'vassalDues' : 'tribute');
    }
  }
  for (const key of Object.keys(pairs).sort()) {
    const p = pairs[key] as { payer: FactionId; payee: FactionId; kind: 'tribute' | 'vassalDues' };
    const payer = accs[p.payer] as Acc;
    const payee = accs[p.payee] as Acc;
    const share = p.kind === 'tribute' ? b.tributeShare : b.vassalDuesShare;
    const amount = Math.round(payer.comp.domainIncome * share);
    if (amount <= 0) continue;
    payee.comp.income[p.kind] += amount;
    payee.comp.breakdown[p.kind].push({ id: p.payer, amount });
    payer.comp.expenses.tributePaid += amount;
    payer.comp.breakdown.tributePaid.push({ id: p.payee, amount, info: { kind: p.kind } });
  }
  for (const st of settlementTribute) {
    const share = st.kind === 'tribute' ? b.tributeShare : b.vassalDuesShare;
    const amount = Math.round(st.base * share);
    if (amount <= 0) continue;
    const payer = accs[st.payer] as Acc;
    const payee = accs[st.payee] as Acc;
    payee.comp.income[st.kind] += amount;
    payee.comp.breakdown[st.kind].push({ id: st.id, amount });
    payer.comp.expenses.tributePaid += amount;
    payer.comp.breakdown.tributePaid.push({ id: st.payee, amount, info: { kind: st.kind, settlementId: st.id } });
  }

  const out: Record<FactionId, LedgerComputation> = {};
  for (const id of wanted) {
    const acc = recGet(accs, id);
    if (!acc) continue;
    const c = acc.comp;
    let income = 0;
    for (const k of LEDGER_INCOME_KEYS) income += c.income[k];
    let expenses = 0;
    for (const k of LEDGER_EXPENSE_KEYS) expenses += c.expenses[k];
    c.totalIncome = income;
    c.totalExpenses = expenses;
    c.net = income - expenses;
    out[id] = c;
  }
  return out;
}

/** One house's ledger (pure; e.g. the player's projected month for the Affairs of State panel). */
export function computeLedger(state: GameState, content: Content, factionId: FactionId, extras: LedgerExtras = {}): LedgerComputation | undefined {
  return computeLedgers(state, content, extras, [factionId])[factionId];
}

/**
 * The monthly ledger pass: computes every house's ledger from a snapshot, pays income and expenses
 * (tribute first, out of income), applies the arrears rules and reports the player's month (the
 * LedgerReport event, a notification, the optional auto-pause).
 */
export function applyMonthlyLedgers(draft: GameState, ctx: SimContext, extras: LedgerExtras): void {
  const content = ctx.content;
  // Read through the draft: every ledger is computed before any silver moves, so this equals a snapshot
  // (measured: a little cheaper than current() of the whole state on the perf world).
  const view: GameState = draft;
  const ledgers = computeLedgers(view, content, extras);
  const eco = economyOf(draft);
  const player = draft.player.factionId;
  const capMonths = ctx.tunables.economy.arrears.capMonths;
  const cal = toCalendar(ctx.hour);
  let pauseNet: number | undefined;
  let pauseTreasury = 0;
  for (const id of Object.keys(ledgers) as FactionId[]) {
    const c = ledgers[id] as LedgerComputation;
    const faction = draft.factions[id];
    if (!faction) continue;
    const treasuryBefore = faction.treasury;
    const arrearsBefore = eco.arrears[id]?.amount ?? 0;
    const available = Math.max(0, treasuryBefore + c.totalIncome);
    const due = c.totalExpenses + arrearsBefore;
    const paid = Math.min(available, due);
    const treasuryAfter = Math.max(0, Math.round(available - paid));
    const running = Math.max(1, c.totalExpenses - c.expenses.tributePaid);
    const arrearsAfter = Math.round(Math.min(Math.max(0, due - paid), capMonths * running));
    faction.treasury = treasuryAfter;
    eco.ledgers[id] = {
      hour: ctx.hour,
      domainIncome: c.domainIncome,
      income: c.totalIncome,
      expenses: c.totalExpenses,
      net: c.net,
      treasury: treasuryAfter,
      arrears: arrearsAfter,
    };
    applyArrears(draft, ctx, view, id, arrearsBefore, arrearsAfter);
    if (id === player) {
      const report: LedgerReport = {
        factionId: id,
        hour: ctx.hour,
        year: cal.year,
        monthIndex: cal.monthIndex,
        income: { ...c.income },
        expenses: { ...c.expenses },
        breakdown: c.breakdown,
        totalIncome: c.totalIncome,
        totalExpenses: c.totalExpenses,
        net: c.net,
        treasuryBefore,
        treasuryAfter,
        paid: Math.round(paid),
        arrearsBefore,
        arrearsAfter,
      };
      eco.lastReport = report;
      ctx.emit({ type: 'LedgerReport', report });
      ctx.notify(c.net < 0 ? 'economy.ledger.deficit' : 'economy.ledger.summary', {
        priority: c.net < 0 ? 'normal' : 'low',
        vars: { income: c.totalIncome, expenses: c.totalExpenses, net: c.net, treasury: treasuryAfter },
        link: { kind: 'screen', id: 'ledger' },
      });
      const pause = draft.player.policies.ledgerPause ?? 'off';
      if (pause === 'always' || (pause === 'deficit' && c.net < 0)) {
        pauseNet = c.net;
        pauseTreasury = treasuryAfter;
      }
    }
  }
  if (pauseNet !== undefined) {
    ctx.pend({ kind: 'message', payload: { key: 'economy.ledger.pause', vars: { net: pauseNet, treasury: pauseTreasury }, priority: 'normal', illustration: 'narrative.vignette.storehouse' } });
  }
}
