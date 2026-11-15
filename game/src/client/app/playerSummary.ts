/**
 * Read-only selectors behind the top bar (no game rules: they only add up what the state holds and
 * look up display tables). Each number carries its breakdown for the §25.1 formula tooltips.
 */
import type { Content } from '@content/index';
import type { Character, GameState, Settlement } from '@sim/core/state';

export interface BreakdownLine {
  /** Locale key of the line label. */
  labelKey: string;
  vars?: Record<string, string | number>;
  value: number;
}

export interface Tally {
  total: number;
  lines: BreakdownLine[];
}

export interface PlayerSummary {
  ruler: Character | undefined;
  rulerName: string;
  /** Byname, or the level title from titles.json. */
  epithet: string;
  capital: Settlement | undefined;
  houseName: string;
  silver: Tally;
  men: Tally;
  /** Food stores in months at the capital (null when unknown). */
  foodMonths: number | null;
  food: Tally;
  renown: number;
  renownTier: string;
  honor: number;
  dread: number;
}

const has = <T extends object>(o: T, k: PropertyKey): boolean => Object.hasOwn(o, k);

function sumValues(r: Readonly<Record<string, number>> | undefined): number {
  if (!r) return 0;
  let s = 0;
  for (const v of Object.values(r)) if (Number.isFinite(v)) s += v;
  return s;
}

/** The renown tier id for a value (highest tier whose minimum is reached). */
export function renownTierOf(renown: number, content: Content | null): string {
  const tiers = content?.balance.renown.tiers ?? [];
  let id = tiers[0]?.id ?? 'unknown';
  for (const t of tiers) if (renown >= t.min) id = t.id;
  return id;
}

/** The level title (titles.json) for a level, without variants (those are the people module's). */
export function levelTitle(level: number, content: Content | null): string {
  const row = content?.titles.find((t) => t.level === level) ?? content?.titles[0];
  return row?.title ?? '';
}

/** Everything the top bar shows. */
export function playerSummary(state: GameState, content: Content | null): PlayerSummary {
  const p = state.player;
  const ruler = has(state.characters, p.rulerId) ? state.characters[p.rulerId] : undefined;
  const faction = has(state.factions, p.factionId) ? state.factions[p.factionId] : undefined;
  const capital = has(state.settlements, p.capitalId) ? state.settlements[p.capitalId] : undefined;

  const silverLines: BreakdownLine[] = [{ labelKey: 'ui.topbar.breakdown.treasury', value: faction?.treasury ?? 0 }];
  const menLines: BreakdownLine[] = [];
  const foodLines: BreakdownLine[] = [];
  let men = 0;
  const holdings = faction ? faction.holdingIds.filter((id) => has(state.settlements, id)).map((id) => state.settlements[id] as Settlement) : [];
  for (const s of holdings) {
    const g = sumValues(s.garrison);
    if (g > 0) {
      men += g;
      menLines.push({ labelKey: 'ui.topbar.breakdown.garrison', vars: { place: s.name }, value: g });
    }
    if (s.holding) foodLines.push({ labelKey: 'ui.topbar.breakdown.foodAt', vars: { place: s.name }, value: Math.round(s.holding.foodMonths * 10) / 10 });
  }
  let fleetSilver = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.ownerId !== p.factionId) continue;
    const m = sumValues(f.men);
    if (m > 0) {
      men += m;
      menLines.push({ labelKey: 'ui.topbar.breakdown.fleet', vars: { count: f.shipIds.length }, value: m });
    }
    fleetSilver += f.silver;
  }
  if (fleetSilver > 0) silverLines.push({ labelKey: 'ui.topbar.breakdown.fleetSilver', value: fleetSilver });

  const rulerName = ruler?.name ?? '';
  const epithet = ruler?.byname ?? (ruler ? levelTitle(ruler.level, content) : '');
  const foodMonths = capital?.holding ? Math.round(capital.holding.foodMonths * 10) / 10 : null;
  return {
    ruler,
    rulerName,
    epithet,
    capital,
    houseName: faction?.name ?? '',
    silver: { total: silverLines.reduce((s, l) => s + l.value, 0), lines: silverLines },
    men: { total: men, lines: menLines },
    foodMonths,
    food: { total: foodMonths ?? 0, lines: foodLines },
    renown: p.house.renown,
    renownTier: renownTierOf(p.house.renown, content),
    honor: p.house.honor,
    dread: p.house.dread,
  };
}
