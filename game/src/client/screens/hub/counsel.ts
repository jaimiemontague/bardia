/**
 * The Hirdmaster's Counsel and the First Voyage checklist (§25.5), computed from state on every render. The
 * client decides only what to *say*: every rule it reports comes from the owning module's pure helpers
 * (ice: the weather flag via `harbourIce`; men: military `musterPreview`/`unitBounty`/`musterCooldownLeft`;
 * ships: `buildableShips`/`shipOrderPreview`; queues: `readMilitary`/`shipOrdersOf`). Lines come out most
 * important first, each with a one-click action where one exists.
 */
import type { Content } from '@content/index';
import type { GameState, Settlement, SettlementId } from '@sim/core/state';
import { MONTHS, daysBetween, nextDate, type Hour } from '@sim/core/time';
import {
  buildableShips,
  musterCooldownLeft,
  musterRoster,
  readMilitary,
  shipOrderPreview,
  shipOrdersOf,
  unitBounty,
  unmetRequirements,
} from '@sim/modules/military';
import type { IconName } from '../../ui/index';
import { harbourIce, type HarbourIce } from '../expedition/seaIce';
import { shipsAtHome } from './village';

/** What a Counsel line's (or checklist step's) button does. */
export type CounselAction =
  | { kind: 'route'; route: string; params?: Readonly<Record<string, string>>; labelKey: string; vars?: Record<string, string | number> }
  | { kind: 'wait'; days: number; labelKey: string; vars?: Record<string, string | number> };

/** The Muster: the Great hall with the Hirdmaster's panel open on the muster (route params of the interior). */
export const MUSTER_ACTION: CounselAction = {
  kind: 'route',
  route: 'building.greatHall',
  params: { person: 'hirdmaster', view: 'muster' },
  labelKey: 'hub.action.muster',
};

/** Ordering a ship and the slipways: the Shipyard with the Shipwright's panel open. */
export const SHIPWRIGHT_ACTION: CounselAction = {
  kind: 'route',
  route: 'building.shipyard',
  params: { person: 'shipwright' },
  labelKey: 'hub.action.shipyard',
};

/** How loudly a line speaks (drives its colour and glyph). */
export type CounselTone = 'urgent' | 'warn' | 'advice' | 'info';

/** One line of the Counsel. `vars` may hold hours under keys ending in `At` (formatted as dates by the view). */
export interface CounselLine {
  id: string;
  tone: CounselTone;
  icon: IconName;
  key: string;
  vars?: Record<string, string | number>;
  action?: CounselAction;
}

/** Calendar facts the Counsel always mentions (§7.1 annual events). */
export const ANNUAL_EVENTS: readonly {
  id: string;
  key: string;
  month: (typeof MONTHS)[number];
  day: number;
}[] = [
  { id: 'allthing', key: 'hub.counsel.annual.allthing', month: 'Highsun', day: 15 },
  { id: 'harvest', key: 'hub.counsel.annual.harvest', month: 'Reaping', day: 1 },
  { id: 'yule', key: 'hub.counsel.annual.yule', month: 'Yuledark', day: 15 },
];

/** Food stores below this many months draw a warning (§25.5 Counsel: "food runway < 3 months"). */
export const FOOD_WARN_MONTHS = 3;
/** The Counsel suggests the war-arrow only when at least this many men could answer it. */
export const IDLE_MEN_MIN = 10;

/** The player's capital, if it exists. */
export function capitalOf(state: GameState): Settlement | undefined {
  const id = state.player.capitalId;
  return Object.hasOwn(state.settlements, id) ? state.settlements[id] : undefined;
}

/** Men in a settlement's garrison. */
export function garrisonMen(s: Settlement | undefined): number {
  let n = 0;
  for (const v of Object.values(s?.garrison ?? {})) n += Math.max(0, v);
  return n;
}

/** How many men the war-arrow could raise at the capital right now, and of which (cheapest) unit. */
export function idleMuster(
  state: GameState,
  content: Content,
): { men: number; unit: string; silver: number } | undefined {
  const cap = capitalOf(state);
  const holding = cap?.holding;
  if (!cap || !holding) return undefined;
  if (musterCooldownLeft(state, content, cap.id) > 0) return undefined;
  const treasury = Math.floor(state.factions[state.player.factionId]?.treasury ?? 0);
  let best: { unit: string; bounty: number } | undefined;
  for (const unit of musterRoster(content.balance, cap.culture)) {
    if (unmetRequirements(state, content, cap, unit).length > 0) continue;
    const bounty = unitBounty(state, content, state.player.factionId, unit);
    if (bounty <= 0) continue;
    if (!best || bounty < best.bounty) best = { unit, bounty };
  }
  if (!best) return undefined;
  const men = Math.min(holding.pool.current, Math.floor(treasury / best.bounty));
  return { men, unit: best.unit, silver: treasury };
}

/** A ship the capital's shipyard could lay down now (the cheapest one whose order the military module accepts). */
export function affordableShip(
  state: GameState,
  content: Content,
): { type: string; cost: number } | undefined {
  const capId = state.player.capitalId;
  let best: { type: string; cost: number } | undefined;
  for (const type of buildableShips(state, content.balance, capId)) {
    const p = shipOrderPreview(state, content, { holdingId: capId, shipType: type });
    if (!p.ok) continue;
    if (!best || p.total < best.cost) best = { type, cost: p.total };
  }
  return best;
}

/** Facts the First Voyage checklist ticks from. */
export interface VoyageFacts {
  ice: HarbourIce;
  /** An expedition has been launched at least once (the planner's last plan is kept). */
  launched: boolean;
  atSea: boolean;
  mustered: boolean;
  visitedForeign: boolean;
  traded: boolean;
  raided: boolean;
}

/** Reads the First Voyage facts from state. */
export function voyageFacts(state: GameState, ice: HarbourIce = harbourIce(state)): VoyageFacts {
  const fac = state.player.factionId;
  const cap = capitalOf(state);
  let visitedForeign = false;
  for (const id of Object.keys(state.knowledge?.visited ?? {})) {
    const s = state.settlements[id as SettlementId];
    if (s && s.factionId !== fac) {
      visitedForeign = true;
      break;
    }
  }
  let raided = false;
  for (const s of Object.values(state.settlements)) {
    if (s?.lastFate?.byFactionId === fac) {
      raided = true;
      break;
    }
  }
  const traded = Object.values(state.economy?.rapport ?? {}).some((r) => typeof r === 'number' && r > 0);
  return {
    ice,
    launched: state.expeditions?.lastPlan !== undefined || state.player.expeditionFleetId !== undefined,
    atSea: state.player.expeditionFleetId !== undefined,
    mustered: cap?.holding?.lastMusterHour !== undefined,
    visitedForeign,
    traded,
    raided,
  };
}

/** One step of the First Voyage. */
export interface VoyageStep {
  id: 'thaw' | 'muster' | 'plan' | 'sail' | 'deed' | 'home';
  key: string;
  done: boolean;
  action?: CounselAction;
  /** A second way forward (e.g. skip the muster and plan with the men at hand). */
  alt?: CounselAction;
}

/** The First Voyage checklist (wait for the thaw, muster, plan, sail, trade or raid, sail home and sell). */
export function firstVoyage(state: GameState, facts: VoyageFacts = voyageFacts(state)): VoyageStep[] {
  const deed = facts.traded || facts.raided;
  const thawAction: CounselAction | undefined =
    facts.ice.iced && facts.ice.daysToThaw !== undefined
      ? {
          kind: 'wait',
          days: facts.ice.daysToThaw,
          labelKey: 'hub.counsel.waitThaw',
          vars: { days: facts.ice.daysToThaw },
        }
      : undefined;
  const steps: VoyageStep[] = [
    {
      id: 'thaw',
      key: 'hub.voyage.thaw',
      done: !facts.ice.iced || facts.launched,
      ...(thawAction ? { action: thawAction } : {}),
    },
    {
      id: 'muster',
      key: 'hub.voyage.muster',
      done: facts.mustered || facts.launched,
      action: MUSTER_ACTION,
    },
    {
      id: 'plan',
      key: 'hub.voyage.plan',
      done: facts.launched,
      action: { kind: 'route', route: 'expeditionPlanner', labelKey: 'hub.action.plan' },
    },
    {
      id: 'sail',
      key: 'hub.voyage.sail',
      done: facts.visitedForeign || deed,
      ...(facts.atSea ? { action: { kind: 'route', route: 'chart', labelKey: 'hub.action.chart' } } : {}),
    },
    { id: 'deed', key: 'hub.voyage.deed', done: deed },
    {
      id: 'home',
      key: 'hub.voyage.home',
      done: deed && !facts.atSea,
      action: { kind: 'route', route: 'building.market', params: { person: 'merchant' }, labelKey: 'hub.action.market' },
    },
  ];
  return steps;
}

/** Index of the next step to take (steps.length when the voyage is complete). */
export function nextVoyageStep(steps: readonly VoyageStep[]): number {
  const i = steps.findIndex((s) => !s.done);
  return i < 0 ? steps.length : i;
}

/** Inputs from client stores (not in GameState). */
export interface CounselContext {
  /** Unread important or critical inbox entries. */
  unreadImportant: number;
}

/**
 * The Counsel, most important first: unread news, the fleet away, the ice, food, the next voyage (or what
 * stops it), idle silver, what is gathering or building, and the year's calendar.
 */
export function computeCounsel(
  state: GameState,
  content: Content,
  cx: CounselContext,
  ice: HarbourIce = harbourIce(state),
): CounselLine[] {
  const lines: CounselLine[] = [];
  const cap = capitalOf(state);
  const fac = state.player.factionId;
  const now = state.time.hour;

  if (cx.unreadImportant > 0) {
    lines.push({
      id: 'unread',
      tone: 'warn',
      icon: 'inbox',
      key: 'hub.counsel.unread',
      vars: { count: cx.unreadImportant },
      action: { kind: 'route', route: 'inbox', labelKey: 'hub.action.inbox' },
    });
  }

  const fleetId = state.player.expeditionFleetId;
  const fleet =
    fleetId !== undefined && Object.hasOwn(state.fleets, fleetId) ? state.fleets[fleetId] : undefined;
  if (fleet) {
    let men = 0;
    for (const v of Object.values(fleet.men)) men += Math.max(0, v ?? 0);
    lines.push({
      id: 'fleetAway',
      tone: 'info',
      icon: 'ship',
      key: 'hub.counsel.fleetAway',
      vars: { leader: state.characters[fleet.leaderId]?.name ?? '', men },
      action: { kind: 'route', route: 'chart', labelKey: 'hub.action.chart' },
    });
  }

  if (ice.iced) {
    const line: CounselLine = {
      id: 'iced',
      tone: 'urgent',
      icon: 'wind',
      key: 'hub.counsel.iced',
      vars: { zone: ice.zoneName ?? '', days: ice.daysToThaw ?? 0, thawAt: ice.thawHour ?? now },
    };
    if (ice.daysToThaw !== undefined)
      line.action = {
        kind: 'wait',
        days: ice.daysToThaw,
        labelKey: 'hub.counsel.waitThaw',
        vars: { days: ice.daysToThaw },
      };
    lines.push(line);
  }

  const food = cap?.holding?.foodMonths;
  if (food !== undefined && food < FOOD_WARN_MONTHS) {
    lines.push({
      id: 'food',
      tone: 'warn',
      icon: 'food',
      key: 'hub.counsel.foodLow',
      vars: { months: Math.round(food * 10) / 10 },
      action: { kind: 'route', route: 'affairs', labelKey: 'hub.action.affairs' },
    });
  }

  if (!fleet && cap) {
    const ships = shipsAtHome(state, cap.id).length;
    const men = garrisonMen(cap);
    if (ships === 0)
      lines.push({
        id: 'noShips',
        tone: 'warn',
        icon: 'ship',
        key: 'hub.counsel.noShips',
        action: SHIPWRIGHT_ACTION,
      });
    else if (men === 0)
      lines.push({
        id: 'noMen',
        tone: 'warn',
        icon: 'men',
        key: 'hub.counsel.noMen',
        action: MUSTER_ACTION,
      });
    else if (!ice.iced) {
      lines.push({
        id: 'plan',
        tone: 'advice',
        icon: 'ship',
        key: 'hub.counsel.plan',
        vars: { ships, men },
        action: { kind: 'route', route: 'expeditionPlanner', labelKey: 'hub.action.plan' },
      });
    }
  }

  const idle = idleMuster(state, content);
  if (idle && idle.men >= IDLE_MEN_MIN) {
    lines.push({
      id: 'idleSilver',
      tone: 'advice',
      icon: 'silver',
      key: 'hub.counsel.idleMen',
      vars: { silver: idle.silver, men: idle.men, unit: idle.unit },
      action: MUSTER_ACTION,
    });
  } else {
    const ship = affordableShip(state, content);
    if (ship && cap && shipOrdersOf(state, cap.id).length === 0) {
      lines.push({
        id: 'idleShip',
        tone: 'advice',
        icon: 'silver',
        key: 'hub.counsel.idleShip',
        vars: { shipType: ship.type, cost: ship.cost },
        action: SHIPWRIGHT_ACTION,
      });
    }
  }

  const musters = readMilitary(state).musters.filter((m) => m.factionId === fac);
  if (musters.length > 0) {
    let men = 0;
    let at: Hour = Infinity;
    for (const m of musters) {
      for (const v of Object.values(m.units)) men += Math.max(0, v ?? 0);
      at = Math.min(at, m.arriveHour);
    }
    lines.push({
      id: 'mustering',
      tone: 'info',
      icon: 'men',
      key: 'hub.counsel.mustering',
      vars: { men, arriveAt: at },
    });
  }

  if (cap) {
    const orders = shipOrdersOf(state, cap.id);
    const first = [...orders].sort((a, b) => a.doneHour - b.doneHour)[0];
    if (first) {
      lines.push({
        id: 'shipBuilding',
        tone: 'info',
        icon: 'ship',
        key: 'hub.counsel.shipBuilding',
        vars: { shipType: first.type, doneAt: first.doneHour, count: orders.length },
        action: SHIPWRIGHT_ACTION,
      });
    }
  }

  const annual = ANNUAL_EVENTS.map((a) => {
    const at = nextDate(now, MONTHS.indexOf(a.month), a.day);
    return { ...a, at, days: daysBetween(now, at) };
  }).sort((x, y) => x.days - y.days);
  for (const a of annual)
    lines.push({
      id: `annual-${a.id}`,
      tone: 'info',
      icon: 'hourglass',
      key: a.key,
      vars: { days: a.days, dateAt: a.at },
    });

  return lines;
}
