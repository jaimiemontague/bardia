/**
 * Render-state snapshots for the battle view: squads (positions with the previous tick's for
 * interpolation, facing, men, morale, stamina, formation, abilities and cooldowns), figures (typed
 * arrays), buildings with fire, gates, loot caches, arrows in flight, smoke, recent events and the
 * pause state. Enemy squads the viewer cannot see are omitted (their figures are flagged hidden).
 * Snapshots are plain copies: the client may keep them across ticks.
 */
import type { CharId, FormationId } from '@sim/core/state';
import { ABILITY_IDS, type AbilityId } from '../data';
import type { SquadStance } from '../types';
import { effectiveRange } from '../formulas';
import { onField } from './geometry';
import type { BattleEngineEvent, BattleState, BSquad, DuelRequest, EndState, EngineStatus, SideIdx, SquadStatus, SquadTaskKind } from './types';
import { SIDE_KEYS } from './types';

export interface SquadView {
  id: string;
  side: 'attacker' | 'defender';
  unit: string;
  leaderId: CharId;
  leaderName: string | null;
  unnamed: boolean;
  isChief: boolean;
  isPlayer: boolean;
  leaderPresent: boolean;
  men: number;
  startMen: number;
  /** Men struck down so far, and the share of them expected to be wounded rather than dead. */
  lost: number;
  wounded: number;
  vetStars: number;
  /** Single beasts: remaining HP share (0..1); 1 otherwise. */
  hpPct: number;
  morale: number;
  moraleStart: number;
  stamina: number;
  formation: FormationId;
  formations: FormationId[];
  stance: SquadStance;
  status: SquadStatus;
  /** What it is doing right now (for icons and audio). */
  activity: 'idle' | 'moving' | 'running' | 'fighting' | 'routing' | 'asleep' | 'working';
  wavering: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  facing: number;
  pFacing: number;
  /** Footprint half extents (right axis, forward axis). */
  hw: number;
  hd: number;
  hidden: boolean;
  loot: number;
  carryCap: number;
  task: SquadTaskKind;
  taskTarget: string | null;
  taskX: number;
  taskY: number;
  waypoints: number[];
  /** Direct control: unit direction of travel while driven (0, 0 otherwise). */
  driveX: number;
  driveY: number;
  /** Let go after a drive: standing its ground until the next order. */
  held: boolean;
  /** Shooting range on level ground (tiles from the front of the footprint; 0 without missiles). */
  range: number;
  chargeActive: boolean;
  frenzyActive: boolean;
  /** Abilities this squad can use and their cooldowns (s). */
  abilities: AbilityId[];
  cooldowns: Partial<Record<AbilityId, number>>;
  /** Player's HP (0..100) on the player's squad. */
  playerHp: number | null;
}

export interface BuildingView {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  burning: boolean;
  /** 0..1 of the burn time elapsed. */
  burnPct: number;
  collapsed: boolean;
  stone: boolean;
  isKeep: boolean;
  isTreasury: boolean;
  loot: number;
}

export interface GateView {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hpPct: number;
  broken: boolean;
  burning: boolean;
}

export interface CacheView {
  id: string;
  x: number;
  y: number;
  value: number;
  dropped: boolean;
  treasury: boolean;
}

export interface ProjectileView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Flight progress 0..1 at this tick. */
  t: number;
  fire: boolean;
}

export interface FigureView {
  n: number;
  x: Float32Array;
  y: Float32Array;
  px: Float32Array;
  py: Float32Array;
  /** Squad index into `squadIds` (−1 = not drawn: dead, escaped or unseen). */
  squad: Int16Array;
  side: Uint8Array;
}

export interface BattleRenderState {
  tick: number;
  timeS: number;
  status: EngineStatus;
  viewer: 'attacker' | 'defender' | null;
  kind: string;
  /** Raid: seconds until the horns sound (null for other kinds). */
  timeLeftS: number | null;
  night: boolean;
  wind: { dir: number; str: number };
  squads: SquadView[];
  /** Squad ids by squad index (figures refer to these). */
  squadIds: string[];
  figures: FigureView;
  buildings: BuildingView[];
  gates: GateView[];
  caches: CacheView[];
  projectiles: ProjectileView[];
  /** Tile indices covered by smoke. */
  smoke: number[];
  events: BattleEngineEvent[];
  duel: DuelRequest | null;
  end: EndState | null;
  lootSecured: number;
}

function activity(s: BSquad): SquadView['activity'] {
  if (s.status === 'routing') return 'routing';
  if (s.status === 'asleep') return 'asleep';
  if (s.fighting || s.contacts !== 0) return 'fighting';
  if (s.running) return 'running';
  if (s.moving) return 'moving';
  if (s.task.kind === 'torch' || s.task.kind === 'loot' || s.task.kind === 'gate' || s.task.kind === 'douse') return 'working';
  return 'idle';
}

/** Abilities a squad may use (unit abilities plus leader abilities). */
export function squadAbilities(state: BattleState, s: BSquad): AbilityId[] {
  const out: AbilityId[] = [];
  const u = s.unit;
  const side = state.sides[s.side];
  for (const a of ABILITY_IDS) {
    let ok = false;
    switch (a) {
      case 'shieldWall':
      case 'charge':
      case 'volley':
      case 'frenzy':
      case 'hide':
        ok = u.abilities.includes(a);
        break;
      case 'torch':
      case 'douse':
        ok = !u.cavalry && !u.nonCombatant && !u.single;
        break;
      case 'ram':
        ok = side.hasRam && u.abilities.includes('ram') && state.gates.length > 0;
        break;
      case 'rally':
        ok = !s.unnamed && s.leaderPresent;
        break;
      case 'challenge':
        ok = !s.unnamed && s.leaderPresent && state.sides[(1 - s.side) as SideIdx].chiefIdx >= 0;
        break;
      default:
        ok = false;
    }
    if (ok) out.push(a);
  }
  return out;
}

function squadView(state: BattleState, s: BSquad): SquadView {
  const abilities = squadAbilities(state, s);
  const cooldowns: Partial<Record<AbilityId, number>> = {};
  for (const a of abilities) cooldowns[a] = Math.round(s.cooldowns[ABILITY_IDS.indexOf(a)]! * 10) / 10;
  const target = s.task.target;
  let taskTarget: string | null = null;
  if (target >= 0) {
    if (s.task.kind === 'attack') taskTarget = state.squads[target]?.id ?? null;
    else if (s.task.kind === 'loot') taskTarget = state.caches[target]?.id ?? null;
    else if (s.task.gateTarget || s.task.kind === 'gate') taskTarget = state.gates[target]?.id ?? null;
    else if (s.task.kind === 'torch' || s.task.kind === 'douse') taskTarget = state.buildings[target]?.id ?? null;
  }
  return {
    id: s.id,
    side: SIDE_KEYS[s.side],
    unit: s.unitId,
    leaderId: s.leaderId,
    leaderName: s.leader?.name ?? null,
    unnamed: s.unnamed,
    isChief: s.isChief,
    isPlayer: s.isPlayer,
    leaderPresent: s.leaderPresent,
    men: s.men,
    startMen: s.startMen,
    lost: s.lost,
    wounded: Math.round(s.lost * state.data.b.woundedShare),
    vetStars: s.vet,
    hpPct: s.unit.single ? s.hp / Math.max(1, s.hpMax) : 1,
    morale: Math.round(s.morale * 10) / 10,
    moraleStart: s.moraleStart,
    stamina: Math.round(s.stamina * 10) / 10,
    formation: s.formation,
    formations: [...s.unit.formations],
    stance: s.stance,
    status: s.status,
    activity: activity(s),
    wavering: s.status === 'active' && s.morale < state.data.b.waverAt,
    x: s.x,
    y: s.y,
    px: s.px,
    py: s.py,
    facing: s.facing,
    pFacing: s.pFacing,
    hw: s.hw,
    hd: s.hd,
    hidden: s.hidden,
    loot: Math.round(s.loot),
    carryCap: Math.round(s.men * state.data.t.carryValuePerMan),
    task: s.task.kind,
    taskTarget,
    driveX: s.task.kind === 'drive' ? s.driveX : 0,
    driveY: s.task.kind === 'drive' ? s.driveY : 0,
    held: s.driveHeld && s.task.kind === 'none',
    range: s.unit.hasRanged ? effectiveRange(state.data.b, s.unit.range, false) : 0,
    taskX: s.task.x,
    taskY: s.task.y,
    waypoints: [...s.waypoints],
    chargeActive: s.chargeT > 0 || s.chargeArmed,
    frenzyActive: s.frenzyT > 0,
    abilities,
    cooldowns,
    playerHp: s.isPlayer ? Math.round(s.playerHp) : null,
  };
}

/**
 * The render state seen by `viewer` (null = omniscient, e.g. replays and tools). `sinceTick` limits
 * the events to those after a tick the client has already shown.
 */
export function snapshot(state: BattleState, viewer: SideIdx | null, sinceTick = -1): BattleRenderState {
  const vis = viewer === null ? null : state.sides[viewer].visible;
  const seen = (s: BSquad) => vis === null || vis[s.idx] === 1;
  const squads: SquadView[] = [];
  for (const s of state.squads) if (onField(s) && seen(s)) squads.push(squadView(state, s));
  const f = state.figures;
  const squad = new Int16Array(f.n);
  const side = new Uint8Array(f.n);
  for (let i = 0; i < f.n; i++) {
    const s = state.squads[f.squad[i]!]!;
    squad[i] = f.alive[i] === 1 && onField(s) && seen(s) ? s.idx : -1;
    side[i] = s.side;
  }
  const p = state.projectiles;
  const projectiles: ProjectileView[] = [];
  for (let i = 0; i < p.n; i++) {
    const t = p.dur[i]! > 0 ? Math.min(1, Math.max(0, (state.timeS - p.t0[i]!) / p.dur[i]!)) : 1;
    projectiles.push({ x0: p.x0[i]!, y0: p.y0[i]!, x1: p.x1[i]!, y1: p.y1[i]!, t, fire: p.fire[i] === 1 });
  }
  const smoke: number[] = [];
  for (let i = 0; i < state.smoke.length; i++) if (state.smoke[i] === 1) smoke.push(i);
  const events: BattleEngineEvent[] = [];
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!;
    if (e.tick <= sinceTick) break;
    events.push(e);
  }
  events.reverse();
  return {
    tick: state.tick,
    timeS: state.timeS,
    status: state.status,
    viewer: viewer === null ? null : SIDE_KEYS[viewer],
    kind: state.setup.kind,
    timeLeftS: state.setup.kind === 'raid' ? Math.max(0, state.raidTimerS - state.timeS) : null,
    night: state.night,
    wind: { dir: state.setup.weather.windDir, str: state.setup.weather.windStr },
    squads,
    squadIds: state.squads.map((s) => s.id),
    figures: { n: f.n, x: f.x.slice(), y: f.y.slice(), px: f.px.slice(), py: f.py.slice(), squad, side },
    buildings: state.buildings.map((b) => ({
      id: b.id,
      kind: b.kind,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      doorX: b.doorX,
      doorY: b.doorY,
      burning: b.burning,
      burnPct: Math.min(1, b.burnT / state.data.b.fire.burnS),
      collapsed: b.collapsed,
      stone: state.map.buildings[b.idx]?.stone === true,
      isKeep: b.isKeep,
      isTreasury: b.isTreasury,
      loot: b.cache >= 0 ? Math.round(state.caches[b.cache]!.value) : 0,
    })),
    gates: state.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h, hpPct: g.hpMax > 0 ? g.hp / g.hpMax : 0, broken: g.broken, burning: g.burning })),
    caches: state.caches.filter((c) => c.value > 0.5).map((c) => ({ id: c.id, x: c.x, y: c.y, value: Math.round(c.value), dropped: c.building < 0, treasury: c.treasury })),
    projectiles,
    smoke,
    events,
    duel: state.duel ? { ...state.duel } : null,
    end: state.end ? { ...state.end } : null,
    lootSecured: Math.round(state.sides[0].lootSecured),
  };
}
