/**
 * Deterministic ids: `${prefix}_${n}` from the global counter `state.meta.nextId` (design §29.3).
 * Creation order is part of the deterministic simulation, so ids are identical on replay.
 */
import type {
  ArmyId,
  BattleId,
  CharId,
  DuelId,
  EventId,
  FactionId,
  FleetId,
  NewsId,
  PendingId,
  ProvinceId,
  QuestId,
  RelicId,
  SeaBattleId,
  SettlementId,
  ShipId,
  SiteId,
} from './state';

/**
 * Prefix → id type. Augment to register a new prefix:
 *   declare module '@sim/core/ids' { interface IdPrefixMap { sgc: `sgc_${string}` } }
 */
export interface IdPrefixMap {
  chr: CharId;
  set: SettlementId;
  prv: ProvinceId;
  fac: FactionId;
  flt: FleetId;
  shp: ShipId;
  arm: ArmyId;
  site: SiteId;
  rel: RelicId;
  qst: QuestId;
  news: NewsId;
  evt: EventId;
  pnd: PendingId;
  bat: BattleId;
  duel: DuelId;
  sea: SeaBattleId;
  /** Generic ids for module-internal records (storm cells, ambitions, routes …). */
  rec: `rec_${string}`;
}

export type IdPrefix = keyof IdPrefixMap;

/** Minimal shape needed to mint ids. */
export interface IdHost {
  meta: { nextId: number };
}

/** Mints the next id with the given prefix and increments the counter. */
export function newId<P extends IdPrefix>(state: IdHost, prefix: P): IdPrefixMap[P] {
  const n = state.meta.nextId;
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`ids: corrupt meta.nextId ${n}`);
  state.meta.nextId = n + 1;
  return `${prefix}_${n}` as IdPrefixMap[P];
}

/** The prefix of an id ('chr_12' → 'chr'), or undefined if malformed. */
export function idPrefix(id: string): string | undefined {
  const i = id.indexOf('_');
  return i > 0 ? id.slice(0, i) : undefined;
}

/** True if `id` has the given prefix. Also narrows the type. */
export function isIdOf<P extends IdPrefix>(id: string, prefix: P): id is IdPrefixMap[P] {
  return id.startsWith(`${prefix}_`) && id.length > prefix.length + 1;
}
