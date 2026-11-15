/**
 * BattleController: the client-side driver of one tactical battle (no React, no Pixi, so it is unit
 * tested in node). It owns the engine (src/sim/battle, fixed 20 Hz), runs it from real frame time at
 * the chosen speed, keeps the latest render snapshot, turns the player's clicks and keys into engine
 * orders, collects the battle log and the morale record, settles duels, and can hand the player's side
 * to the battle AI to fight the rest out fast ("let your captains finish it"). Orders given while
 * paused are queued by the engine and shown as planned orders until the next tick applies them.
 *
 * The controller never decides a rule: every order goes through the engine's validated order API, and
 * the result comes from the engine.
 */
import type { Content } from '@content/index';
import { createDefaultBattleAi } from '@sim/battle/ai/index';
import { ABILITY_IDS, resolveUnit, type AbilityId } from '@sim/battle/data';
import { BattleEngine, type BattleEngineEvent, type BattleOrder, type BattleRenderState, type SquadView } from '@sim/battle/index';
import type { BattleAiController, SideIdx } from '@sim/battle/engine/types';
import type { BattleSideKey, SquadStance } from '@sim/battle/types';
import type { BattleResult, BattleSetup, FormationId } from '@sim/core/state';
import { hasKey, tOr } from '../../i18n/index';
import { pickStructure } from '../../render/battle/geometry';
import { MoraleTracker } from './morale';

export type SpeedSetting = 1 | 2 | 4;
export type Translate = (key: string, vars?: Readonly<Record<string, string | number | boolean>>) => string;

/** One line of the battle log. */
export interface LogEntry {
  id: number;
  timeS: number;
  kind: BattleEngineEvent['kind'];
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  x?: number;
  y?: number;
}

/** A short floating caption over the field ("Breaks!", "Charge!"). */
export interface FloatFx {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  born: number;
}

/** An order given while paused, drawn until the engine applies it. */
export interface PlannedOrder {
  kind: 'move' | 'attack' | 'loot' | 'torch' | 'retreat' | 'halt' | 'volley' | 'gate' | 'douse';
  x: number;
  y: number;
  target?: string;
}

/** Abilities that need the player to click a target. */
export const TARGETED_ABILITIES: readonly AbilityId[] = ['charge', 'volley', 'torch', 'douse', 'ram'];

const OTHER: Record<BattleSideKey, BattleSideKey> = { attacker: 'defender', defender: 'attacker' };
const FAST_TICKS_PER_FRAME = 240;

/** Event kinds worth a floating caption on the field. */
const FX_KINDS: Readonly<Partial<Record<BattleEngineEvent['kind'], 'good' | 'bad' | 'neutral'>>> = {
  routed: 'bad',
  rallied: 'good',
  charge: 'neutral',
  chargeBroken: 'neutral',
  gateBroken: 'neutral',
  buildingIgnited: 'neutral',
  leaderDown: 'bad',
  chiefKilled: 'neutral',
  chiefCaptured: 'neutral',
  lootGathered: 'good',
  rally: 'good',
  frenzy: 'neutral',
  surrendered: 'neutral',
};

/** The battle driver. */
export class BattleController {
  readonly engine: BattleEngine;
  readonly setup: BattleSetup;
  readonly content: Content;
  readonly side: BattleSideKey;
  readonly enemySide: BattleSideKey;
  paused = true;
  speed: SpeedSetting = 1;
  /** The player handed the battle to the AI and it is being fought out quickly. */
  fastForward = false;
  snap: BattleRenderState;
  selected: string[] = [];
  /** An enemy squad the player clicked to inspect. */
  inspected: string | null = null;
  /** Ability waiting for a target click. */
  targeting: AbilityId | null = null;
  readonly log: LogEntry[] = [];
  readonly fx: FloatFx[] = [];
  readonly morale = new MoraleTracker();
  planned: Record<string, PlannedOrder> = {};
  /** The last order the field refused or that could not be given (locale key). */
  notice: { key: string; at: number } | null = null;
  /** Seconds of real time since the battle opened (animation clock). */
  realTime = 0;
  private readonly t: Translate;
  private readonly names: Record<string, string> = {};
  private readonly unitNames: Record<string, string> = {};
  private readonly frenzyUnits: Set<string> = new Set();
  private readonly seen = new WeakSet<BattleEngineEvent>();
  private captains: BattleAiController | null = null;
  private nextId = 1;
  private version = 0;
  private notifyAt = 0;
  private readonly listeners = new Set<() => void>();

  constructor(setup: BattleSetup, content: Content, t: Translate) {
    this.setup = JSON.parse(JSON.stringify(setup)) as BattleSetup;
    this.content = content;
    this.t = t;
    this.engine = BattleEngine.create(this.setup, content);
    this.side = this.engine.defaultSide;
    this.enemySide = OTHER[this.side];
    this.nameSquads();
    this.snap = this.engine.snapshot(this.side);
    this.morale.update(this.snap, [], this.engine.state.map.w, this.frenzyUnits);
    for (const e of this.engine.state.events) this.seen.add(e);
  }

  // ---- subscription (React reads through useSyncExternalStore) ----------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- names -----------------------------------------------------------------------------------

  /** Display name of a unit type. */
  unitName(unitId: string): string {
    const hit = this.unitNames[unitId];
    if (hit !== undefined) return hit;
    const units = this.content.balance.units as Readonly<Record<string, { name?: string } | undefined>>;
    const fallback = units[unitId]?.name ?? this.content.tunables.battle.extraUnits[unitId]?.name ?? unitId;
    const name = tOr(`core.unit.${unitId}.name`, fallback);
    this.unitNames[unitId] = name;
    return name;
  }

  /** Display name of a squad (its leader, else its unit with a number when several share it). */
  squadName(id: string): string {
    return this.names[id] ?? id;
  }

  private nameSquads(): void {
    const st = this.engine.state;
    const count: Record<string, number> = {};
    const seen: Record<string, number> = {};
    for (const s of st.squads) if (s.unnamed || !s.leader) count[`${s.side}|${s.unitId}`] = (count[`${s.side}|${s.unitId}`] ?? 0) + 1;
    for (const s of st.squads) {
      const unit = this.unitName(s.unitId);
      if (!s.unnamed && s.leader) this.names[s.id] = s.leader.name;
      else {
        const k = `${s.side}|${s.unitId}`;
        const n = (seen[k] = (seen[k] ?? 0) + 1);
        this.names[s.id] = (count[k] ?? 0) > 1 ? this.t('battleView.squad.numbered', { unit, n }) : unit;
      }
      try {
        if (resolveUnit(this.content, s.unitId).abilities.includes('frenzy')) this.frenzyUnits.add(s.unitId);
      } catch {
        // unknown unit: no frenzy
      }
    }
  }

  // ---- squads ----------------------------------------------------------------------------------

  /** The player's squads on the field, in roster order (the number keys follow it). */
  ownSquads(): SquadView[] {
    return this.snap.squads.filter((s) => s.side === this.side);
  }

  /** Every squad the player started with (also those gone from the field), in roster order. */
  rosterIds(): string[] {
    const key = this.side === 'attacker' ? 0 : 1;
    return this.engine.state.squads.filter((s) => s.side === key && s.status !== 'reserve').map((s) => s.id);
  }

  squad(id: string | null): SquadView | undefined {
    if (id === null) return undefined;
    return this.snap.squads.find((s) => s.id === id);
  }

  /** Status of a squad that may have left the field (escaped, destroyed, surrendered). */
  squadStatus(id: string): string {
    return this.engine.state.squads.find((s) => s.id === id)?.status ?? 'destroyed';
  }

  /** Selected squads still able to take orders. */
  selectedSquads(): SquadView[] {
    return this.selected.map((id) => this.squad(id)).filter((s): s is SquadView => s !== undefined && s.status === 'active');
  }

  // ---- time ------------------------------------------------------------------------------------

  setPaused(paused: boolean): void {
    if (this.snap.status === 'ended') return;
    this.paused = paused;
    this.changed();
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  setSpeed(speed: SpeedSetting): void {
    this.speed = speed;
    this.paused = false;
    this.changed();
  }

  /**
   * Advances the battle by `dtS` seconds of real time (one animation frame). Returns true when the
   * engine stepped (the view refreshes its snapshot).
   */
  frame(dtS: number): boolean {
    this.realTime += Math.max(0, dtS);
    while (this.fx.length > 0 && this.realTime - this.fx[0]!.born > 2.6) this.fx.shift();
    const engine = this.engine;
    if (engine.status === 'ended') return false;
    const before = engine.tick;
    if (engine.status === 'duelRequested') {
      if (this.fastForward) engine.autoResolveDuel();
      else {
        if (this.snap.duel === null) this.refresh();
        return false;
      }
    }
    if (this.fastForward) {
      for (let k = 0; k < FAST_TICKS_PER_FRAME && !this.isOver(); k++) {
        if (engine.status === 'duelRequested') engine.autoResolveDuel();
        this.captains?.update(engine.state, this.sideIdx(), (o) => {
          engine.order(o, this.side);
          return null;
        });
        engine.step(1);
      }
    } else if (!this.paused) {
      const dt = Math.min(0.25, Math.max(0, dtS));
      // The engine runs at most 8 ticks per call: 4x is two 2x calls.
      if (this.speed === 4) {
        engine.advance(dt, 2);
        engine.advance(dt, 2);
      } else engine.advance(dt, this.speed);
    }
    if (engine.tick === before && engine.status === 'running') {
      if (this.realTime >= this.notifyAt) this.tickNotify();
      return false;
    }
    this.refresh();
    return true;
  }

  /** The engine has finished (read fresh: the engine changes it while stepping). */
  isOver(): boolean {
    return this.engine.status === 'ended';
  }

  private sideIdx(): SideIdx {
    return this.side === 'attacker' ? 0 : 1;
  }

  private tickNotify(): void {
    this.notifyAt = this.realTime + 0.2;
    this.changed();
  }

  /** Takes a new snapshot and digests the events since the last one. */
  refresh(): void {
    const engine = this.engine;
    this.snap = engine.snapshot(this.side, engine.tick);
    this.planned = {};
    const fresh: BattleEngineEvent[] = [];
    const all = engine.state.events;
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i]!;
      if (this.seen.has(e)) break;
      fresh.push(e);
    }
    fresh.reverse();
    for (const e of fresh) this.seen.add(e);
    this.morale.update(this.snap, fresh, engine.state.map.w, this.frenzyUnits);
    for (const e of fresh) this.digest(e);
    this.selected = this.selected.filter((id) => this.snap.squads.some((s) => s.id === id && s.side === this.side));
    if (this.inspected !== null && !this.snap.squads.some((s) => s.id === this.inspected)) this.inspected = null;
    if (engine.status === 'ended') {
      this.paused = true;
      this.fastForward = false;
      this.captains = null;
      this.targeting = null;
    }
    if (this.fastForward) {
      if (this.realTime >= this.notifyAt) this.tickNotify();
      return;
    }
    this.notifyAt = this.realTime + 0.2;
    this.changed();
  }

  private toneOf(e: BattleEngineEvent): LogEntry['tone'] {
    const good = ['rallied', 'escaped', 'lootGathered', 'lootSecured', 'rally', 'frenzy', 'hide', 'objectiveTaken', 'gateBroken', 'buildingIgnited', 'charge', 'awake', 'reinforcements'];
    const bad = ['routed', 'destroyed', 'surrendered', 'leaderDown', 'lootDropped', 'chargeBroken', 'challengeRefused'];
    if (e.kind === 'chiefKilled' || e.kind === 'chiefCaptured') return e.side === this.side ? 'bad' : 'good';
    if (e.kind === 'playerWounded' || e.kind === 'lifeThread' || e.kind === 'playerDown' || e.kind === 'raidTimerWarning' || e.kind === 'raidTimerExpired') return 'bad';
    if (e.kind === 'ended') {
      const w = e.vars?.winner;
      return w === this.side ? 'good' : w === 'none' ? 'neutral' : 'bad';
    }
    if (e.side === undefined) return 'neutral';
    const mine = e.side === this.side;
    if (good.includes(e.kind)) return mine ? 'good' : 'bad';
    if (bad.includes(e.kind)) return mine ? 'bad' : 'good';
    return 'neutral';
  }

  /** Locale text of an engine event. */
  eventText(e: BattleEngineEvent): string {
    const target = e.target ?? '';
    const targetName = /^[ad]\d+$/.test(target) ? this.squadName(target) : this.structureName(target);
    const vars: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(e.vars ?? {})) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') vars[k] = v;
    vars.squad = e.squad !== undefined ? this.squadName(e.squad) : '';
    vars.target = targetName;
    vars.value = e.value ?? 0;
    // Our own wording where the shared battle strings use a dash.
    const own = `battleView.event.${e.kind}`;
    return hasKey(own) ? this.t(own, vars) : this.t(e.key, vars);
  }

  /** Name of a building, gate or loot pile id. */
  structureName(id: string): string {
    if (id.startsWith('g')) return this.t('battleView.structure.gate');
    if (id.startsWith('c')) return this.t('battleView.structure.loot');
    const b = this.snap.buildings.find((x) => x.id === id);
    if (!b) return id;
    const key = `battleView.building.${b.kind}`;
    return this.t(hasKey(key) ? key : 'battleView.building.house');
  }

  private digest(e: BattleEngineEvent): void {
    if (e.kind === 'routed' && e.squad !== undefined) this.morale.markBroken(e.squad);
    const quiet = e.kind === 'lootGathered' && e.side !== this.side;
    if (e.kind === 'volley' || e.kind === 'awake' || quiet) return;
    const text = this.eventText(e);
    const tone = this.toneOf(e);
    const entry: LogEntry = { id: this.nextId++, timeS: e.tick * this.engine.state.dt, kind: e.kind, text, tone };
    if (e.x !== undefined) entry.x = e.x;
    if (e.y !== undefined) entry.y = e.y;
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    const fxTone = FX_KINDS[e.kind];
    if (fxTone !== undefined && e.x !== undefined && e.y !== undefined && !this.fastForward) {
      const key = `battleView.fx.${e.kind}`;
      this.fx.push({ id: this.nextId++, x: e.x, y: e.y, text: this.t(key), tone: this.toneOf(e), born: this.realTime });
    }
  }

  // ---- selection -------------------------------------------------------------------------------

  select(ids: readonly string[], add = false): void {
    const own = ids.filter((id) => this.snap.squads.some((s) => s.id === id && s.side === this.side));
    if (add) {
      const next = [...this.selected];
      for (const id of own) {
        const i = next.indexOf(id);
        if (i >= 0 && own.length === 1) next.splice(i, 1);
        else if (i < 0) next.push(id);
      }
      this.selected = next;
    } else this.selected = own;
    if (own.length > 0) this.inspected = null;
    this.targeting = null;
    this.changed();
  }

  /** Left click on the field: select the own squad there, inspect an enemy, or clear. */
  clickAt(x: number, y: number, add: boolean): void {
    if (this.targeting !== null) {
      this.useTargetedAbility(this.targeting, x, y);
      return;
    }
    const id = this.engine.squadAt(x, y, this.side);
    const sq = id !== null ? this.squad(id) : undefined;
    if (sq && sq.side === this.side) this.select([sq.id], add);
    else if (sq) {
      this.inspected = sq.id;
      if (!add) this.selected = [];
      this.changed();
    } else if (!add) {
      this.selected = [];
      this.inspected = null;
      this.changed();
    }
  }

  /** Double click: every own squad of the same unit type. */
  doubleClickAt(x: number, y: number): void {
    const id = this.engine.squadAt(x, y, this.side);
    if (id === null) return;
    const sq = this.squad(id);
    if (sq && sq.side === this.side) this.select(this.engine.squadsOfType(id));
  }

  /** Drag box (world rectangle). */
  selectBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    this.select(this.engine.squadsInRect(this.side, x0, y0, x1, y1), add);
  }

  /** Number key k (1-based) in roster order. */
  selectIndex(k: number, add = false): void {
    const id = this.rosterIds()[k - 1];
    if (id !== undefined && this.squad(id)) this.select([id], add);
  }

  selectAll(): void {
    this.select(this.ownSquads().map((s) => s.id));
  }

  // ---- orders ----------------------------------------------------------------------------------

  private give(order: BattleOrder, plan?: (id: string) => PlannedOrder | null): void {
    if (this.snap.status === 'ended') return;
    this.engine.order(order, this.side);
    if (plan && this.paused) {
      const ids = 'squads' in order ? order.squads : 'squad' in order ? [order.squad] : [];
      for (const id of ids) {
        const p = plan(id);
        if (p) this.planned[id] = p;
        else delete this.planned[id];
      }
    }
    this.changed();
  }

  private say(key: string): void {
    this.notice = { key, at: this.realTime };
    this.changed();
  }

  /**
   * Right click on the field: attack the enemy there, plunder or torch a building, break a gate,
   * pick up dropped loot, or march to the spot (facing `facing` when the player dragged a direction).
   */
  commandAt(x: number, y: number, opts: { facing?: number; queue?: boolean; run?: boolean } = {}): void {
    const squads = this.selectedSquads().map((s) => s.id);
    if (squads.length === 0) {
      this.say('battleView.notice.selectFirst');
      return;
    }
    this.targeting = null;
    const run = opts.run === true;
    const hit = this.engine.squadAt(x, y, this.side);
    const foe = hit !== null ? this.squad(hit) : undefined;
    if (foe && foe.side !== this.side) {
      this.give({ kind: 'attack', squads, target: foe.id, run }, () => ({ kind: 'attack', x: foe.x, y: foe.y, target: foe.id }));
      return;
    }
    const pick = pickStructure(this.engine.state.map, this.snap.buildings, this.snap.gates, this.snap.caches, x, y);
    if (pick.kind === 'cache') {
      const c = this.snap.caches.find((q) => q.id === pick.id)!;
      this.give({ kind: 'loot', squads, cache: pick.id }, () => ({ kind: 'loot', x: c.x, y: c.y, target: pick.id }));
      return;
    }
    if (pick.kind === 'building') {
      const b = this.snap.buildings.find((q) => q.id === pick.id)!;
      const cache = this.snap.caches.find((c) => !c.dropped && c.x >= b.x - 1 && c.x <= b.x + b.w + 1 && c.y >= b.y - 1 && c.y <= b.y + b.h + 1);
      if (b.burning && this.side === 'defender') {
        for (const id of squads) this.give({ kind: 'ability', squad: id, ability: 'douse', target: b.id }, () => ({ kind: 'douse', x: b.doorX + 0.5, y: b.doorY + 0.5, target: b.id }));
        return;
      }
      if (cache && b.loot > 0 && !b.collapsed && this.side === 'attacker') {
        this.give({ kind: 'loot', squads, cache: cache.id }, () => ({ kind: 'loot', x: b.doorX + 0.5, y: b.doorY + 0.5, target: cache.id }));
        return;
      }
    }
    if (pick.kind === 'gate' && this.side === 'attacker') {
      const g = this.snap.gates.find((q) => q.id === pick.id)!;
      if (!g.broken) {
        this.give({ kind: 'attack', squads, target: g.id, run }, () => ({ kind: 'gate', x: g.x + g.w / 2, y: g.y + g.h / 2, target: g.id }));
        return;
      }
    }
    const order: BattleOrder = { kind: 'move', squads, x, y, run, queue: opts.queue === true };
    if (opts.facing !== undefined) order.facing = opts.facing;
    this.give(order, () => ({ kind: 'move', x, y }));
  }

  /** Formation for every selected squad that knows it. */
  setFormation(formation: FormationId): void {
    const squads = this.selectedSquads()
      .filter((s) => s.formations.includes(formation))
      .map((s) => s.id);
    if (squads.length === 0) return this.say('battle.orderError.formationUnavailable');
    const cooling = this.selectedSquads().some((s) => formation === 'shieldWall' && s.formation !== 'shieldWall' && (s.cooldowns.shieldWall ?? 0) > 0);
    if (cooling) this.say('battle.orderError.cooldown');
    this.give({ kind: 'formation', squads, formation });
  }

  /** Cycles the formation of the selection (F). */
  cycleFormation(): void {
    const first = this.selectedSquads()[0];
    if (!first || first.formations.length < 2) return;
    const i = first.formations.indexOf(first.formation);
    this.setFormation(first.formations[(i + 1) % first.formations.length]!);
  }

  setStance(stance: SquadStance): void {
    const squads = this.selectedSquads().map((s) => s.id);
    if (squads.length === 0) return;
    this.give({ kind: 'stance', squads, stance });
  }

  halt(): void {
    const squads = this.selectedSquads().map((s) => s.id);
    if (squads.length === 0) return;
    this.give({ kind: 'halt', squads }, (id) => {
      const s = this.squad(id);
      return s ? { kind: 'halt', x: s.x, y: s.y } : null;
    });
  }

  /** The selected squads fall back to the ships (or the rear for defenders). */
  retreatSelected(): void {
    const squads = this.selectedSquads().map((s) => s.id);
    if (squads.length === 0) return this.say('battleView.notice.selectFirst');
    this.give({ kind: 'retreat', squads }, (id) => {
      const s = this.squad(id);
      return s ? { kind: 'retreat', x: s.x, y: s.y } : null;
    });
  }

  /** Sounds the general retreat. */
  retreatAll(): void {
    this.give({ kind: 'retreatAll' });
    this.paused = false;
    this.changed();
  }

  /** Which of the selection can use an ability now (has it and it is off cooldown). */
  abilityReady(ability: AbilityId): { has: boolean; ready: boolean; cooldown: number } {
    let has = false;
    let ready = false;
    let cooldown = Infinity;
    for (const s of this.selectedSquads()) {
      if (!s.abilities.includes(ability)) continue;
      has = true;
      const cd = s.cooldowns[ability] ?? 0;
      cooldown = Math.min(cooldown, cd);
      if (cd <= 0) ready = true;
    }
    return { has, ready, cooldown: Number.isFinite(cooldown) ? cooldown : 0 };
  }

  /** Uses an ability with the selection: at once, or after a target click for targeted ones. */
  useAbility(ability: AbilityId): void {
    const r = this.abilityReady(ability);
    if (!r.has) return this.say(this.selectedSquads().length === 0 ? 'battleView.notice.selectFirst' : 'battle.orderError.abilityUnavailable');
    if (!r.ready) return this.say('battle.orderError.cooldown');
    if (TARGETED_ABILITIES.includes(ability)) {
      this.targeting = this.targeting === ability ? null : ability;
      this.changed();
      return;
    }
    for (const s of this.selectedSquads()) {
      if (!s.abilities.includes(ability) || (s.cooldowns[ability] ?? 0) > 0) continue;
      this.give({ kind: 'ability', squad: s.id, ability });
    }
  }

  cancelTargeting(): void {
    if (this.targeting === null) return;
    this.targeting = null;
    this.changed();
  }

  private useTargetedAbility(ability: AbilityId, x: number, y: number): void {
    const users = this.selectedSquads().filter((s) => s.abilities.includes(ability) && (s.cooldowns[ability] ?? 0) <= 0);
    this.targeting = null;
    if (users.length === 0) return this.say('battle.orderError.cooldown');
    if (ability === 'volley') {
      for (const s of users) this.give({ kind: 'ability', squad: s.id, ability, x, y, fire: true }, () => ({ kind: 'volley', x, y }));
      return;
    }
    if (ability === 'charge') {
      const hit = this.engine.squadAt(x, y, this.side, 1.2);
      const foe = hit !== null ? this.squad(hit) : undefined;
      if (!foe || foe.side === this.side) return this.say('battleView.notice.pickEnemy');
      for (const s of users) this.give({ kind: 'ability', squad: s.id, ability, target: foe.id }, () => ({ kind: 'attack', x: foe.x, y: foe.y, target: foe.id }));
      return;
    }
    const pick = pickStructure(this.engine.state.map, this.snap.buildings, this.snap.gates, this.snap.caches, x, y, 1.2);
    if (pick.kind !== 'building' && pick.kind !== 'gate') return this.say(ability === 'ram' ? 'battleView.notice.pickGate' : 'battleView.notice.pickBuilding');
    if (ability === 'ram' && pick.kind !== 'gate') return this.say('battleView.notice.pickGate');
    const at = pick.kind === 'gate' ? this.snap.gates.find((g) => g.id === pick.id)! : this.snap.buildings.find((b) => b.id === pick.id)!;
    const px = 'doorX' in at ? at.doorX + 0.5 : at.x + at.w / 2;
    const py = 'doorY' in at ? at.doorY + 0.5 : at.y + at.h / 2;
    const kind: PlannedOrder['kind'] = ability === 'ram' ? 'gate' : ability === 'douse' ? 'douse' : 'torch';
    for (const s of users) this.give({ kind: 'ability', squad: s.id, ability, target: pick.id }, () => ({ kind, x: px, y: py, target: pick.id }));
  }

  // ---- duels, captains, the end ----------------------------------------------------------------

  /** Settles a pending duel by the blades (the engine's own duel resolution). */
  settleDuel(): void {
    if (this.engine.status !== 'duelRequested') return;
    this.engine.autoResolveDuel();
    this.refresh();
  }

  /** Hands the player's side to the battle AI and fights the rest out quickly. */
  letCaptainsFinish(): void {
    if (this.engine.status === 'ended') return;
    this.captains = createDefaultBattleAi(this.engine.state, this.sideIdx());
    this.fastForward = true;
    this.paused = false;
    this.targeting = null;
    this.changed();
  }

  /** The result once the battle has ended. */
  result(): BattleResult | null {
    return this.engine.result();
  }

  /** Why the battle ended (locale key under battle.endReason), once it has. */
  endReasonKey(): string | null {
    const end = this.engine.state.end;
    return end ? `battle.endReason.${end.reason}` : null;
  }

  /** All ability ids the engine knows, for the panel's fixed order. */
  static abilityOrder(): readonly AbilityId[] {
    return ABILITY_IDS;
  }
}
