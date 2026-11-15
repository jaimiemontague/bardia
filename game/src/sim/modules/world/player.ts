/**
 * The player's start (design §4.5, §5.1 step 8, §5.5, §17.8; ARCHITECTURE §15):
 *   - re-home the placeholder house onto the chosen jarldom: the real capital takes the placeholder's
 *     preset men, start buildings, walls and holding; the ruler, lieutenants and ships move there; the
 *     province's other settlements become holdings too; the placeholder province/settlement and flag go;
 *   - the family the premise describes: the parent the Rival slew at last Midwinter's feast, the surviving
 *     parent, and younger siblings ("You are sixteen and the eldest");
 *   - the Rival: a neighbouring jarl (Proud/Wrathful/Deceitful …), the house's nemesis at stage 1, with a
 *     ring-fort on the player's border.
 */
import { clamp } from '@sim/core/dmath';
import { getOrCreateRelation, PLACEHOLDER_HOME_FLAG, recomputeOpinion } from '@sim/core/factory';
import type { SimContext } from '@sim/core/module';
import type { Rng } from '@sim/core/rng';
import type { Character, CharId, FactionId, GameState, HoldingState, ProvinceId, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY, HOURS_PER_YEAR } from '@sim/core/time';
import { generatePerson, linkChild, linkSpouses, makePersonality, markDead, shiftPersonality, traitConflicts } from './houses';
import { addModifier } from './politics';
import { assignLeaders, placeholderHome, type Generated } from './worldgen';

/** Days before the start that the Rival slew the player's parent (Midwinter, Yuledark 15 of last year). */
const MIDWINTER_DAYS_AGO = 76;

function holdingFor(ctx: SimContext, governorId: CharId, foodMonths: number, pop: number): HoldingState {
  const h = ctx.balance.holdings;
  return {
    governorId,
    tax: 'fair',
    loyalty: h.startLoyalty,
    foodMonths,
    pool: { max: 0, current: 0, veterans: {} },
    buildQueue: [],
    shipQueue: [],
    garrisonTarget: Math.ceil(pop * h.garrisonMinPopShare),
  };
}

/** Re-homes the placeholder house onto the start province (no-op once done). Returns the new capital. */
export function rehomePlayer(draft: GameState, ctx: SimContext, gen: Generated): SettlementId | undefined {
  const oldId = placeholderHome(draft);
  if (oldId === undefined) return undefined;
  const old = draft.settlements[oldId];
  const pid = gen.provinceOf[gen.startProvince];
  const province = pid !== undefined ? draft.provinces[pid] : undefined;
  const faction = draft.factions[draft.player.factionId];
  if (!old || !province || !faction) return undefined;
  const capitalId = province.capitalId;
  const capital = draft.settlements[capitalId];
  if (!capital) return undefined;
  const ruler = draft.characters[draft.player.rulerId];
  const t = ctx.tunables.world.player;

  // The capital takes the placeholder's preset (men in service, start buildings, walls, holding).
  capital.garrison = { ...old.garrison };
  capital.buildings = { ...old.buildings };
  capital.fortTier = old.fortTier;
  capital.armourTier = Math.max(capital.armourTier, faction.armouryTier);
  capital.weaponTier = Math.max(capital.weaponTier, faction.weaponTier);
  capital.holding = old.holding ? { ...old.holding, garrisonTarget: Math.ceil(capital.pop * ctx.balance.holdings.garrisonMinPopShare) } : holdingFor(ctx, draft.player.rulerId, 6, capital.pop);
  capital.leaderId = draft.player.rulerId;
  const foodMonths = old.holding?.foodMonths ?? ctx.balance.difficulty[draft.meta.difficulty].foodMonths;

  // The province's other settlements: holdings with smaller garrisons and local leaders.
  for (const sid of province.settlementIds) {
    if (sid === capitalId) continue;
    const s = draft.settlements[sid];
    if (!s) continue;
    for (const u of Object.keys(s.garrison)) {
      const n = Math.round((s.garrison[u] ?? 0) * t.secondaryGarrisonMult);
      if (n > 0) s.garrison[u] = n;
      else delete s.garrison[u];
    }
    s.holding = holdingFor(ctx, draft.player.rulerId, foodMonths, s.pop);
  }

  // People, ships and fleets at the placeholder move to the capital.
  for (const c of Object.values(draft.characters)) {
    if (c.location.kind === 'settlement' && c.location.id === oldId) c.location = { kind: 'settlement', id: capitalId };
    if (c.role?.holdingId === oldId) c.role = { ...c.role, holdingId: capitalId };
  }
  const suffix = ` of ${old.name}`;
  for (const ship of Object.values(draft.ships)) {
    if (ship.dockedAt === oldId) ship.dockedAt = capitalId;
    if (ship.ownerId === faction.id && ship.name.endsWith(suffix)) ship.name = `${ship.name.slice(0, -suffix.length)} of ${capital.name}`;
  }
  for (const f of Object.values(draft.fleets)) {
    if (f.ownerId === faction.id && f.pos.x === old.mapPos.x && f.pos.y === old.mapPos.y) f.pos = { ...capital.mapPos };
  }
  if (Object.hasOwn(draft.markets, oldId)) {
    if (!Object.hasOwn(draft.markets, capitalId)) draft.markets[capitalId] = draft.markets[oldId] as (typeof draft.markets)[SettlementId];
    delete draft.markets[oldId];
  }

  // Leaders of the other settlements (the ruler governs the capital).
  const home = province.id;
  faction.homeProvinceId = home;
  if (province.kingdomId !== undefined) faction.kingdomId = province.kingdomId;
  gen.regionOf[faction.id] = province.regionId;
  faction.holdingIds = faction.holdingIds.filter((id) => id !== oldId);
  if (!faction.holdingIds.includes(capitalId)) faction.holdingIds.unshift(capitalId);
  else faction.holdingIds = [capitalId, ...faction.holdingIds.filter((id) => id !== capitalId)];
  assignLeaders(draft, ctx, ctx.rng('world:gen'), faction.id, undefined);
  if (ruler) {
    ruler.location = { kind: 'settlement', id: capitalId };
    ruler.role = { kind: 'ruler', holdingId: capitalId, factionId: faction.id };
  }
  for (const sid of province.settlementIds) {
    const s = draft.settlements[sid];
    if (s?.holding && sid !== capitalId) s.holding.governorId = draft.player.rulerId;
  }

  // Remove the placeholder.
  const oldProvince = draft.provinces[old.provinceId];
  delete draft.settlements[oldId];
  if (oldProvince && oldProvince.id !== province.id) {
    oldProvince.settlementIds = oldProvince.settlementIds.filter((id) => id !== oldId);
    if (oldProvince.settlementIds.length === 0) delete draft.provinces[oldProvince.id as ProvinceId];
  }
  for (const f of Object.values(draft.factions)) if (f.holdingIds.includes(oldId)) f.holdingIds = f.holdingIds.filter((id) => id !== oldId);
  draft.player.capitalId = capitalId;
  delete draft.flags[PLACEHOLDER_HOME_FLAG];
  return capitalId;
}

/** The house's family per the premise: a slain parent, a surviving parent, younger siblings. */
export function playerFamily(draft: GameState, ctx: SimContext, rng: Rng): { slain?: CharId; surviving?: CharId } {
  const ruler = draft.characters[draft.player.rulerId];
  if (!ruler || ruler.family.fatherId !== undefined || ruler.family.motherId !== undefined) return {};
  const fam = ctx.tunables.world.worldgen.family;
  const age = Math.floor((ctx.hour - ruler.birthHour) / HOURS_PER_YEAR);
  const factionId = draft.player.factionId;
  const capitalId = draft.player.capitalId;
  // The draw is always made so a choice never shifts the rest of the world's generation.
  const drawnSex = rng.chance(ctx.tunables.world.worldgen.ruler.femaleChance) ? 'female' : 'male';
  const chosen = draft.player.creation?.slainParent;
  const slainSex = chosen === 'mother' ? 'female' : chosen === 'father' ? 'male' : drawnSex;
  const parentAge = (gap: readonly [number, number]) => age + rng.int(gap[0], gap[1]);
  const slain = generatePerson(draft, ctx, rng, { culture: ruler.culture, faith: ruler.faith, sex: slainSex, age: parentAge(fam.parentAgeAtBirth), profile: 'ruler', factionId, personality: false });
  const otherSex = slainSex === 'male' ? 'female' : 'male';
  const motherAgeAt: readonly [number, number] = [Math.max(fam.childbearingAge[0], fam.parentAgeAtBirth[0]), Math.min(fam.childbearingAge[1], fam.parentAgeAtBirth[1])];
  const surviving = generatePerson(draft, ctx, rng, { culture: ruler.culture, faith: ruler.faith, sex: otherSex, age: parentAge(otherSex === 'female' ? motherAgeAt : fam.parentAgeAtBirth), profile: 'leader', factionId, personality: true });
  linkSpouses(slain, surviving);
  linkChild(slain, ruler);
  linkChild(surviving, ruler);
  surviving.location = { kind: 'settlement', id: capitalId };
  markDead(slain, ctx.hour - MIDWINTER_DAYS_AGO * HOURS_PER_DAY, 'duel');
  // Younger siblings (the ruler is the eldest).
  const mother = slainSex === 'female' ? slain : surviving;
  const motherAge = Math.floor((ctx.hour - mother.birthHour) / HOURS_PER_YEAR);
  const count = rng.weighted(fam.siblingWeights.map((_, i) => i), (_, i) => fam.siblingWeights[i] ?? 0) ?? 0;
  let next = age - rng.int(fam.childGapYears[0], fam.childGapYears[1]);
  const siblings: Character[] = [];
  for (let i = 0; i < count && next >= 1; i++) {
    if (motherAge - next > fam.childbearingAge[1]) break;
    const sib = generatePerson(draft, ctx, rng, { culture: ruler.culture, faith: ruler.faith, age: next, profile: 'leader', factionId, personality: false });
    linkChild(slain, sib);
    linkChild(surviving, sib);
    sib.location = { kind: 'settlement', id: capitalId };
    siblings.push(sib);
    next -= rng.int(fam.childGapYears[0], fam.childGapYears[1]);
  }
  return { slain: slain.id, surviving: surviving.id };
}

/** Factions owning provinces next to the start province (land first, then across the water). */
function neighbourFactions(draft: GameState, gen: Generated): FactionId[] {
  const idx = draft.worldIndex;
  const pid = gen.provinceOf[gen.startProvince];
  if (!idx || pid === undefined) return [];
  const g = idx.provinces[pid];
  if (!g) return [];
  const owner = (p: ProvinceId) => draft.settlements[draft.provinces[p]?.capitalId as SettlementId]?.factionId;
  const land = g.neighbours.map(owner).filter((f): f is FactionId => f !== undefined);
  const sea = g.seaNeighbours.map(owner).filter((f): f is FactionId => f !== undefined);
  const out: FactionId[] = [];
  for (const f of [...land, ...sea]) if (!out.includes(f)) out.push(f);
  return out;
}

/** Picks and shapes the Rival (§17.8). Returns its faction id. */
export function chooseRival(draft: GameState, ctx: SimContext, rng: Rng, gen: Generated): FactionId | undefined {
  const t = ctx.tunables.world.rival;
  const player = draft.player.factionId;
  const seats: FactionId[] = Object.values(gen.seatOf);
  const eligible = (f: FactionId) => {
    const fac = draft.factions[f];
    return fac !== undefined && f !== player && fac.neutral !== true && !seats.includes(f) && draft.characters[fac.rulerId]?.alive === true;
  };
  let pool = neighbourFactions(draft, gen).filter(eligible);
  if (pool.length === 0) pool = gen.factionIds.filter((f) => eligible(f) && gen.regionOf[f] === gen.regionOf[player]);
  if (pool.length === 0) pool = gen.factionIds.filter((f) => eligible(f) && draft.worldIndex?.regions[gen.regionOf[f] ?? '']?.homeland === true);
  if (pool.length === 0) return undefined;
  // Prefer land neighbours (the first of the list is a land neighbour when there is one), then a weighted draw.
  const rivalId = rng.weighted(pool, (_f, i) => (i === 0 ? 2 : 1)) ?? (pool[0] as FactionId);
  const rival = draft.factions[rivalId];
  const ruler = rival ? draft.characters[rival.rulerId] : undefined;
  if (!rival || !ruler) return undefined;

  // A grown man or woman with a temper.
  const minBirth = ctx.hour - t.minAge * HOURS_PER_YEAR;
  if (ruler.birthHour > minBirth) ruler.birthHour = minBirth - rng.int(0, 8 * HOURS_PER_YEAR);
  const wanted = rng.int(t.traitCount[0], t.traitCount[1]);
  const pool2 = t.traits.filter((id) => Object.hasOwn(ctx.content.traits, id));
  let added = 0;
  for (let tries = 0; added < wanted && tries < 20 && pool2.length > 0; tries++) {
    const trait = rng.pick(pool2);
    const conflict = ruler.traits.find((h) => ctx.content.traits[h]?.opposite === trait || ctx.content.traits[trait]?.opposite === h);
    if (conflict !== undefined) ruler.traits = ruler.traits.filter((h) => h !== conflict);
    if (traitConflicts(ctx, ruler.traits, trait)) continue;
    ruler.traits.push(trait);
    added++;
  }
  ruler.personality = shiftPersonality(ruler.personality ?? makePersonality(ctx, rng, ruler.culture, ruler.traits), t.personality);

  // The nemesis and the bad blood.
  draft.player.nemesis = { factionId: rivalId, stage: 1, ended: false };
  const rel = getOrCreateRelation(draft, player, rivalId);
  addModifier(rel, 'nemesis', ctx.balance.diplomacy.opinionModifiers.nemesis);
  addModifier(rel, 'feud', ctx.tunables.world.relations.feud, ctx.tunables.world.relations.feudDecayPerMonth);
  rel.opinion = recomputeOpinion(rel, ctx.balance.diplomacy.opinionMin, ctx.balance.diplomacy.opinionMax);
  rel.grievances = Math.max(rel.grievances, 1);

  // "… and raised a ring-fort on your border."
  const cap = draft.settlements[draft.player.capitalId];
  let best: SettlementId | undefined;
  let bestD = Infinity;
  for (const sid of rival.holdingIds) {
    const s = draft.settlements[sid];
    if (!s || !cap) continue;
    const d = (s.mapPos.x - cap.mapPos.x) ** 2 + (s.mapPos.y - cap.mapPos.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = sid;
    }
  }
  const fort = best !== undefined ? draft.settlements[best] : undefined;
  if (fort && fort.fortTier < t.borderFortTier) {
    fort.fortTier = clamp(t.borderFortTier, 0, 4) as 0 | 1 | 2 | 3 | 4;
    fort.buildings['walls'] = fort.fortTier;
  }
  return rivalId;
}
