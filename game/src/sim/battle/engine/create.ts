/**
 * Builds the engine state for a BattleSetup: map generation, sides, squads (deployment by the
 * guard plan, raid waves, night sleepers, ambushers), buildings, gates, loot caches and figures.
 * Deterministic in (setup, content).
 */
import type { Content } from '@content/index';
import type { BattleTemplateId } from '@content/schemas/tunables/battle';
import { dcos, PI } from '@sim/core/dmath';
import { Rng } from '@sim/core/rng';
import type { BattleSetup, CharId, FormationId, Squad } from '@sim/core/state';
import { createDefaultBattleAi } from '../ai/index';
import { ABILITY_IDS, battleData, equipMult, lootPoolValue, unitOf, type BattleData } from '../data';
import { moraleStart } from '../formulas';
import { cloneMap, TERRAIN_INFO, Z, type BattleMap, type GuardPost, type GuardRole } from '../map/grid';
import { generateBattleMap, type MapGenParams } from '../map/generate';
import { PathGrid } from '../path';
import type { BattleLeaderInfo, BattleSideKey } from '../types';
import { rebuildCosts } from './costs';
import { updateVisibility } from './sense';
import { figureSlots, setFacing, slotWorld, updateFootprint } from './geometry';
import type { BattleState, BBuilding, BCache, BGate, BSide, BSquad, EngineOptions, SideIdx } from './types';
import { SIDE_KEYS } from './types';

/** Settlement battle kinds: defenders follow the guard plan. */
const SETTLEMENT_KINDS: readonly string[] = ['raid', 'assault', 'cloister', 'fortress', 'defense'];

/** The map template a setup asks for, validated against the tunables. */
export function templateOf(data: BattleData, setup: BattleSetup): BattleTemplateId {
  const t = setup.mapTemplate;
  return Object.hasOwn(data.t.templates, t) ? (t as BattleTemplateId) : 'field';
}

/** Map generation parameters for a setup. */
export function mapParamsOf(data: BattleData, setup: BattleSetup): MapGenParams {
  const template = templateOf(data, setup);
  const culture = setup.culture ?? setup.defender.culture ?? 'skarn';
  const p: MapGenParams = {
    template,
    seed: setup.mapSeed ?? setup.seed,
    style: data.t.cultureStyle[culture] ?? 'north',
    kind: setup.kind,
    fortTier: setup.fortTier ?? 0,
    oldStoneWalls: setup.oldStoneWalls === true,
    church: setup.church === true,
    coastal: setup.coastal ?? data.t.templates[template].coastal,
  };
  if (setup.siteKind !== undefined) p.siteKind = setup.siteKind;
  return p;
}

/** Generates (or reuses) the map for a setup. */
export function mapForSetup(data: BattleData, setup: BattleSetup): BattleMap {
  return generateBattleMap(mapParamsOf(data, setup), data);
}

function leaderOf(setup: BattleSetup, id: CharId): BattleLeaderInfo | null {
  const l = setup.leaders?.[id];
  return l ?? null;
}

function newSide(setup: BattleSetup, data: BattleData, idx: SideIdx, n: number): BSide {
  const s = idx === 0 ? setup.attacker : setup.defender;
  const omenSide: SideIdx = setup.attacker.isPlayer ? 0 : setup.defender.isPlayer ? 1 : 0;
  const omenAtk = setup.omen && idx === omenSide ? 1 + data.balance.omens.modifiers[setup.omen].moralePct : 1;
  return {
    idx,
    key: SIDE_KEYS[idx],
    setup: s,
    isPlayer: s.isPlayer,
    weaponMult: equipMult(data.balance, s.weaponTier),
    armourMult: equipMult(data.balance, s.armourTier),
    armourTier: s.armourTier,
    hasPitch: s.hasPitch === true,
    pitchT: s.pitchT ?? Infinity,
    pitchUsed: 0,
    hasRam: s.hasRam === true,
    ladders: s.ladders === true,
    fireSpreadMult: 1 + (s.fireSpreadPct ?? 0) / 100,
    emberCloak: s.emberCloak === true,
    omenAtk,
    chiefIdx: -1,
    chiefId: s.chiefId ?? null,
    chiefFate: 'fine',
    retreatAll: false,
    retreatForced: false,
    lootSecured: 0,
    visible: new Uint8Array(64),
    cost: new Float32Array(n),
    minCost: 1,
    retreatCost: new Float32Array(n),
    retreatField: new Float32Array(n),
    defeatedT: 0,
  };
}

function defaultFormation(sq: Squad, unitFormations: readonly FormationId[]): FormationId {
  return unitFormations.includes(sq.formation) ? sq.formation : (unitFormations[0] ?? 'line');
}

function makeSquad(state: BattleState, side: SideIdx, k: number, sq: Squad): BSquad {
  const data = state.data;
  const b = data.b;
  const setup = state.setup;
  const unit = unitOf(data, sq.unit);
  const leader = sq.unnamed ? null : leaderOf(setup, sq.leaderId);
  const sideSetup = side === 0 ? setup.attacker : setup.defender;
  const enemySetup = side === 0 ? setup.defender : setup.attacker;
  const command = leader?.command ?? 0;
  const omenSide: SideIdx = setup.attacker.isPlayer ? 0 : setup.defender.isPlayer ? 1 : 0;
  let extra = sideSetup.moraleMods;
  if (unit.cavalry && sideSetup.cavalryMoralePct) extra += (unit.morale * sideSetup.cavalryMoralePct) / 100;
  const mStart = moraleStart(b, {
    base: unit.morale,
    command,
    vetStars: sq.vetStars,
    ...(setup.omen && side === omenSide ? { omen: setup.omen } : {}),
    warHorn: leader?.warHorn === true,
    traitMod: leader?.moraleMod ?? 0,
    enemyDreadDrakkar: enemySetup.dreadDrakkar === true,
    extra,
  });
  const men = unit.single ? 1 : Math.max(1, Math.floor(sq.men));
  const s: BSquad = {
    idx: state.squads.length,
    id: `${side === 0 ? 'a' : 'd'}${k}`,
    side,
    unitId: sq.unit,
    unit,
    leaderId: sq.leaderId,
    leader,
    unnamed: sq.unnamed === true || leader === null,
    isChief: false,
    isPlayer: leader?.isPlayer === true,
    leaderPresent: leader !== null,
    sources: (sq.sources ?? []).map((x) => ({ ...x })),
    startMen: men,
    men,
    lost: 0,
    surrenderedMen: 0,
    casAcc: 0,
    casTick: 0,
    hp: unit.single ? unit.hp : 0,
    hpMax: unit.single ? unit.hp : 0,
    vet: sq.vetStars,
    formation: defaultFormation(sq, unit.formations),
    stance: sq.stance ?? (unit.hasRanged ? 'skirmish' : 'engage'),
    status: 'active',
    morale: mStart,
    moraleStart: mStart,
    stamina: b.fatigue.max,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    facing: 0,
    fx: 1,
    fy: 0,
    pFacing: 0,
    hw: 1,
    hd: 1,
    task: { kind: 'none', x: 0, y: 0, facing: null, run: false, target: -1, gateTarget: false, fire: false },
    waypoints: [],
    path: [],
    pathPos: 0,
    pathGoal: -1,
    pathPending: false,
    pathRetreat: false,
    repathT: 0,
    moving: false,
    running: false,
    fighting: false,
    contacts: 0,
    flankedBy: 0,
    meleeTarget: -1,
    runDist: 0,
    chargeArmed: false,
    chargeT: 0,
    chargeBlockedT: 0,
    frenzyT: 0,
    hidden: false,
    cooldowns: ABILITY_IDS.map(() => 0),
    reloadT: 0,
    loot: 0,
    gatherT: 0,
    actT: 0,
    asleepT: 0,
    unformedT: 0,
    arrivalT: 0,
    maulT: 0,
    routedOnce: false,
    retreating: false,
    driveX: 0,
    driveY: 0,
    driveGroup: -1,
    driveSlide: 1,
    driveHeld: false,
    quietT: 0,
    playerHp: leader?.isPlayer ? Math.max(1, leader.hpPct) : 0,
    playerWarned: false,
    fig0: 0,
    figN: 0,
  };
  updateFootprint(data, s);
  return s;
}

function place(s: BSquad, x: number, y: number, facing: number): void {
  s.x = s.px = x;
  s.y = s.py = y;
  setFacing(s, facing);
  s.pFacing = s.facing;
}

/** Picks a post by role preference, avoiding posts already used. */
function takePost(posts: GuardPost[], used: boolean[], roles: readonly GuardRole[]): number {
  for (const role of roles)
    for (let i = 0; i < posts.length; i++) if (!used[i] && posts[i]!.role === role) return i;
  return -1;
}

/**
 * Nearest walkable spot to (x, y) not overlapping squads already placed (square spiral search),
 * on the same side of the walls as (x, y).
 */
function freeSpot(state: BattleState, side: SideIdx, x: number, y: number, occupied: { x: number; y: number; r: number }[], r: number): [number, number] {
  const cost = state.sides[side].cost;
  const map = state.map;
  const insideBit = map.zone[Math.min(map.h - 1, Math.max(0, Math.floor(y))) * map.w + Math.min(map.w - 1, Math.max(0, Math.floor(x)))]! & Z.inside;
  for (let ring = 0; ring <= 14; ring++) {
    const step = Math.max(1, ring);
    for (let a = 0; a < Math.max(1, ring * 8); a++) {
      // Square spiral: walk the ring's perimeter.
      const per = Math.max(1, ring * 8);
      const t = a / per;
      let ox = 0;
      let oy = 0;
      if (ring > 0) {
        const edge = Math.floor(t * 4);
        const f = t * 4 - edge;
        const L = 2 * step;
        if (edge === 0) [ox, oy] = [-step + f * L, -step];
        else if (edge === 1) [ox, oy] = [step, -step + f * L];
        else if (edge === 2) [ox, oy] = [step - f * L, step];
        else [ox, oy] = [-step, step - f * L];
      }
      const px = Math.floor(x + ox * 1.5) + 0.5;
      const py = Math.floor(y + oy * 1.5) + 0.5;
      if (px < 1 || py < 1 || px > map.w - 1 || py > map.h - 1) continue;
      const i = Math.floor(py) * map.w + Math.floor(px);
      if (!Number.isFinite(cost[i]!) || (map.zone[i]! & Z.inside) !== insideBit) continue;
      let clash = false;
      for (const o of occupied) {
        const dx = o.x - px;
        const dy = o.y - py;
        if (dx * dx + dy * dy < (o.r + r) * (o.r + r)) {
          clash = true;
          break;
        }
      }
      if (!clash) return [px, py];
    }
  }
  return [x, y];
}

function deploy(state: BattleState, rng: Rng): void {
  const map = state.map;
  const setup = state.setup;
  const t = state.data.t;
  const occupied: { x: number; y: number; r: number }[] = [];
  const settlementKind = SETTLEMENT_KINDS.includes(setup.kind);
  const settlementMap = map.guards.some((g) => g.role === 'chief');

  // Attackers: along the deployment posts.
  const att = state.squads.filter((s) => s.side === 0);
  att.forEach((s, k) => {
    const post = map.deploy[0][k % Math.max(1, map.deploy[0].length)] ?? { x: map.w / 2, y: map.h - 6, role: 'line' as const, facing: -Math.PI / 2 };
    const r = Math.max(s.hw, s.hd) + 0.5;
    const [x, y] = freeSpot(state, 0, post.x, post.y, occupied, r);
    place(s, x, y, post.facing);
    occupied.push({ x, y, r });
  });

  // Defenders: the guard plan in settlements; deployment posts elsewhere.
  const def = state.squads.filter((s) => s.side === 1);
  const posts = settlementKind && settlementMap ? map.guards : [...map.guards.filter((g) => g.role === 'objective' || g.role === 'line'), ...map.deploy[1]];
  const used = posts.map(() => false);
  const fallback = map.deploy[1].length > 0 ? map.deploy[1] : map.guards;
  def.forEach((s, k) => {
    let pi = -1;
    if (s.unit.nonCombatant) pi = takePost(posts, used, ['monks', 'chief', 'cache']);
    else if (s.isChief) pi = takePost(posts, used, ['chief', 'objective', 'line']);
    else if (s.unit.hasRanged) pi = takePost(posts, used, ['tower', 'gate', 'line', 'cache', 'patrol', 'objective']);
    else pi = takePost(posts, used, ['gate', 'objective', 'line', 'cache', 'patrol', 'chief']);
    let post: GuardPost;
    if (pi >= 0) {
      used[pi] = true;
      post = posts[pi]!;
    } else post = fallback[k % Math.max(1, fallback.length)] ?? { x: map.w / 2, y: 10, role: 'line', facing: Math.PI / 2 };
    const r = Math.max(s.hw, s.hd) + 0.5;
    const [x, y] = freeSpot(state, 1, post.x, post.y, occupied, r);
    place(s, x, y, post.facing);
    occupied.push({ x, y, r });
  });

  // Raid: only part of the garrison stands to arms; the rest musters in waves.
  if (setup.kind === 'raid') {
    const total = def.filter((s) => !s.unit.nonCombatant).reduce((a, s) => a + s.men, 0);
    let initial = 0;
    let wave = 0;
    for (const s of def) {
      if (s.unit.nonCombatant) continue;
      if (s.isChief || initial < total * t.raid.initialGuardShare) {
        initial += s.men;
        continue;
      }
      s.status = 'reserve';
      s.arrivalT = t.raid.waveStartS + wave * t.raid.waveIntervalS;
      const spawn = map.waveSpawns[wave % Math.max(1, map.waveSpawns.length)];
      if (spawn) place(s, spawn.x, spawn.y, spawn.facing);
      wave++;
    }
  }

  // Night raid: part of the defenders sleep (§13.4).
  if (state.night) {
    const sleepers = def.filter((s) => s.status === 'active' && !s.unit.nonCombatant && !s.isChief);
    const order = rng.shuffle(sleepers.map((s) => s.idx));
    const n = Math.round(order.length * state.data.b.nightRaidAsleepShare);
    for (let k = 0; k < n; k++) {
      const s = state.squads[order[k]!]!;
      s.status = 'asleep';
    }
  }

  // Ambushers and hiding units start unseen in hiding ground.
  for (const s of state.squads) {
    if (s.status !== 'active' && s.status !== 'asleep') continue;
    const i = Math.floor(s.y) * map.w + Math.floor(s.x);
    const hidingGround = TERRAIN_INFO[map.terrain[i]!]!.hiding || (map.zone[i]! & Z.ambush) !== 0;
    const canHide = s.unit.abilities.includes('hide') || s.unit.abilities.includes('ambush');
    if ((setup.kind === 'ambush' && s.side === 0) || (canHide && hidingGround)) s.hidden = true;
  }
}

function makeCaches(state: BattleState): void {
  const portable = lootPoolValue(state.data.balance, state.setup.loot);
  state.portableValue = portable;
  const ceiling = state.setup.lootCeiling ?? 0;
  const total = portable * ceiling;
  state.lootTotal = total;
  if (total <= 0) return;
  const holders = state.buildings.filter((b) => (state.map.buildings[b.idx]?.lootWeight ?? 0) > 0);
  const weightOf = (b: BBuilding) => state.map.buildings[b.idx]!.lootWeight;
  const sum = holders.reduce((a, b) => a + weightOf(b), 0);
  if (holders.length === 0 || sum <= 0) {
    // No storehouses: the wealth sits in a chest by the defenders' first post.
    const p = state.map.guards[0] ?? state.map.deploy[1][0] ?? { x: state.map.w / 2, y: state.map.h / 3 };
    pushCache(state, p.x, p.y, total, -1, false);
    return;
  }
  let left = total;
  holders.forEach((b, k) => {
    const v = k === holders.length - 1 ? left : (total * weightOf(b)) / sum;
    left -= v;
    b.cache = pushCache(state, b.doorX + 0.5, b.doorY + 0.5, v, b.idx, b.isTreasury);
  });
  // Monks carry part of the treasure away (§13.2 cloister raid).
  const monks = state.squads.filter((s) => s.side === 1 && s.unit.nonCombatant);
  if (monks.length > 0) {
    const share = state.data.t.monks.lootShare;
    const treasury = state.caches.find((c) => c.treasury) ?? state.caches[0];
    if (treasury) {
      const take = treasury.value * share;
      treasury.value -= take;
      monks.forEach((m) => (m.loot = take / monks.length));
    }
  }
}

/** Adds a cache and returns its index. */
export function pushCache(state: BattleState, x: number, y: number, value: number, building: number, treasury: boolean): number {
  const idx = state.caches.length;
  const c: BCache = { idx, id: `c${idx}`, x, y, value, building, treasury };
  state.caches.push(c);
  return idx;
}

function makeBuildings(state: BattleState): void {
  const radius = state.data.b.fire.radiusTiles;
  state.buildings = state.map.buildings.map((b, idx) => ({
    idx,
    id: b.id,
    kind: b.kind,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    cx: b.x + b.w / 2,
    cy: b.y + b.h / 2,
    doorX: b.doorX,
    doorY: b.doorY,
    flammability: b.flammability,
    isKeep: b.isKeep,
    isTreasury: b.isTreasury,
    burning: false,
    burnT: 0,
    collapsed: false,
    igniter: 0 as SideIdx,
    neighbors: [],
    cache: -1,
  }));
  // Neighbours within the spread radius (edge to edge).
  for (const a of state.buildings)
    for (const b of state.buildings) {
      if (a === b) continue;
      const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (dx * dx + dy * dy <= radius * radius) a.neighbors.push(b.idx);
    }
  state.gates = state.map.gates.map((g, idx): BGate => ({
    idx,
    id: g.id,
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    cx: g.x + g.w / 2,
    cy: g.y + g.h / 2,
    outX: g.outX + 0.5,
    outY: g.outY + 0.5,
    inX: g.inX + 0.5,
    inY: g.inY + 0.5,
    hp: g.hp,
    hpMax: g.hp,
    broken: false,
    burning: false,
  }));
}

function makeFigures(state: BattleState): void {
  const figureMen = state.data.b.figureMen;
  let total = 0;
  for (const s of state.squads) {
    s.fig0 = total;
    s.figN = s.unit.single ? 1 : Math.ceil(s.startMen / figureMen);
    total += s.figN;
  }
  const f = state.figures;
  f.n = total;
  f.x = new Float32Array(total);
  f.y = new Float32Array(total);
  f.px = new Float32Array(total);
  f.py = new Float32Array(total);
  f.squad = new Int16Array(total);
  f.alive = new Uint8Array(total);
  const slots: number[] = [];
  for (const s of state.squads) {
    figureSlots(state.data, s, s.figN, slots);
    for (let k = 0; k < s.figN; k++) {
      const [x, y] = slotWorld(s, slots[2 * k]!, slots[2 * k + 1]!);
      const i = s.fig0 + k;
      f.x[i] = f.px[i] = x;
      f.y[i] = f.py[i] = y;
      f.squad[i] = s.idx;
      f.alive[i] = s.status === 'reserve' ? 0 : 1;
    }
  }
}

/** Creates the engine state for a setup. */
export function createBattleState(setup: BattleSetup, content: Content, opts: EngineOptions = {}): BattleState {
  const data = battleData(content);
  const map = cloneMap(mapForSetup(data, setup));
  const n = map.w * map.h;
  const rng = new Rng(setup.seed);
  const humanKeys: BattleSideKey[] = opts.humanSides ?? [setup.attacker.isPlayer ? 'attacker' : setup.defender.isPlayer ? 'defender' : null].filter((k): k is BattleSideKey => k !== null);
  const t = data.t;
  const state: BattleState = {
    setup,
    data,
    map,
    pg: new PathGrid(map.w, map.h),
    rng,
    tick: 0,
    dt: 1 / data.b.tickHz,
    timeS: 0,
    status: 'running',
    squads: [],
    sides: [newSide(setup, data, 0, n), newSide(setup, data, 1, n)],
    buildings: [],
    gates: [],
    caches: [],
    impacts: [],
    projectiles: {
      n: 0,
      x0: new Float32Array(data.b.maxProjectiles),
      y0: new Float32Array(data.b.maxProjectiles),
      x1: new Float32Array(data.b.maxProjectiles),
      y1: new Float32Array(data.b.maxProjectiles),
      t0: new Float32Array(data.b.maxProjectiles),
      dur: new Float32Array(data.b.maxProjectiles),
      fire: new Uint8Array(data.b.maxProjectiles),
    },
    figures: { n: 0, x: new Float32Array(0), y: new Float32Array(0), px: new Float32Array(0), py: new Float32Array(0), squad: new Int16Array(0), alive: new Uint8Array(0) },
    events: [],
    queued: [],
    log: [],
    humanSides: [humanKeys.includes('attacker'), humanKeys.includes('defender')],
    ai: [null, null],
    duel: null,
    duels: [],
    leaderFates: {},
    lootTotal: 0,
    portableValue: 0,
    lootBurned: 0,
    buildingsBurned: 0,
    raidTimerS: setup.timerS ?? t.raid.timerByTier[setup.settlementTier ?? 'village'] ?? data.b.raidTimerS[0],
    raidWarned: false,
    objectiveHoldT: 0,
    objectiveBreached: false,
    alarmT: -1,
    night: setup.approach === 'night' || setup.weather.night,
    fireClockT: 0,
    smoke: new Uint8Array(n),
    smokeDirty: false,
    costsDirty: false,
    pathQueue: [],
    driveSeq: 0,
    cosFront: dcos((t.frontArcDeg * PI) / 180),
    cosRear: dcos((t.rearArcDeg * PI) / 180),
    end: null,
    result: null,
  };
  rebuildCosts(state);
  makeBuildings(state);
  // Squads: attackers then defenders, ids a0.. / d0...
  const add = (side: SideIdx) => {
    const ss = side === 0 ? setup.attacker : setup.defender;
    const limit = ss.isPlayer ? data.b.maxPlayerSquads : data.b.maxEnemySquads;
    ss.squads.slice(0, limit).forEach((sq, k) => {
      const s = makeSquad(state, side, k, sq);
      if (ss.chiefId !== undefined && sq.leaderId === ss.chiefId && !sq.unnamed && state.sides[side].chiefIdx < 0) {
        s.isChief = true;
        state.sides[side].chiefIdx = s.idx;
      }
      state.squads.push(s);
    });
  };
  add(0);
  add(1);
  // Contact sets are 31-bit masks over squad indices.
  if (state.squads.length > 31) throw new RangeError(`battle: ${state.squads.length} squads (at most 31)`);
  for (const side of state.sides) if (side.visible.length < state.squads.length) side.visible = new Uint8Array(state.squads.length);
  deploy(state, rng);
  makeCaches(state);
  makeFigures(state);
  // The battle opens paused in the view: each side must already see its own squads (and whatever
  // stands in sight) before the first tick, so the deployment can be shown and commanded.
  updateVisibility(state);
  const factory = opts.ai ?? createDefaultBattleAi;
  state.ai = [state.humanSides[0] ? null : factory(state, 0), state.humanSides[1] ? null : factory(state, 1)];
  for (const s of state.squads) if (s.status !== 'reserve') s.task.facing = s.facing;
  return state;
}
