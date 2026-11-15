/**
 * The real-time duel engine (design §14.2–§14.6, §14.10): a pure, deterministic fixed-step
 * simulation at `balance.duel.tickHz` (60 Hz), outside Immer, seeded by `setup.seed` through `Rng`.
 *
 *   const engine = new DuelEngine(setup, content, { ai: { b: true } });   // the player fights as 'a'
 *   engine.step({ a: input });              // once per 1/60 s; AI sides generate their own input
 *   const view = engine.snapshot('a');      // render state for the duel view (bars, poses, glyph, fx)
 *   if (engine.outcome) dispatch({ type: 'applyDuelResult', duelId, outcome: engine.outcome, choice });
 *
 * Model: a side-on 1-D arena (metres along the duel axis); A stands left facing +x, B right facing
 * −x; bodies never pass (min gap). Each fighter has HP, stamina and Shield HP bars and one action at
 * a time (guard, wind-up, recover, parry, dodge, stagger, taunt, yield, shield swap). Strikes resolve
 * at the end of their wind-up against the defender's state at that instant; two strikes landing on
 * the same frame are resolved symmetrically (both hit). Every random roll uses the engine's Rng in a
 * fixed order, so the same setup + the same per-frame inputs always produce the same duel.
 */
import type { DifficultyId } from '@content/schemas/ids';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import { clamp } from '@sim/core/dmath';
import { Rng, type RngState } from '@sim/core/rng';
import type { DuelSetup } from '@sim/core/state';
import { DuelAi } from './ai';
import { glyphKind, glyphShowFraction, type AttackKind } from './glyph';
import { strikeDamage, type DuelEngineContent } from './stats';
import type { DuelEndReason, DuelFightSummary, DuelistProfile, DuelSide, GlyphKind, StrikeHeight } from './types';

// ---------------------------------------------------------------------------------------------
// Public contracts

/** One frame of input for one fighter (keyboard/controller mapping lives in the client, §14.5). */
export interface DuelInput {
  /** +1 step toward the foe, −1 back away, 0 stand. */
  move?: -1 | 0 | 1;
  /** Hold to block (RMB / LB). Blocks 80% at the right height, 30% at the wrong one. */
  guard?: boolean;
  /** Height for light strikes and the guard (W/S, stick up/down). Default: keep the current one. */
  height?: StrikeHeight;
  /** Edge: start a strike. Heavy strikes are overhead (high) blows with a 1.6× wind-up. */
  attack?: 'light' | 'heavy';
  /** Raw strike button for hold-to-heavy (§14.5 "Hold LMB 0.4 s"): released earlier → light, held → heavy. */
  attackHeld?: boolean;
  /** Edge: parry (tap RMB on impact). If the guard is still held when the window ends you block; otherwise you are open. */
  parry?: boolean;
  /** Edge: shield bash (needs a shield). */
  bash?: boolean;
  /** Edge: dodge back (−1) or forward (+1). */
  dodge?: -1 | 1;
  /** Edge: feint — cancel your own strike's wind-up. */
  feint?: boolean;
  /** Edge: taunt (1 s vulnerable; unhit → Renown on a win). */
  taunt?: boolean;
  /** Hold 1.5 s to ask for quarter. */
  yieldHeld?: boolean;
  /** Answer to the foe's plea for quarter (when this side is human and a plea is pending). */
  quarter?: 'accept' | 'refuse';
}

/** What a fighter is doing. */
export type DuelAction = 'idle' | 'guard' | 'windup' | 'recover' | 'parry' | 'parryWhiff' | 'dodge' | 'stagger' | 'taunt' | 'yield' | 'swap' | 'down';

/** Mutable runtime state of a fighter (read-only for anything but the engine). */
export interface DuelFighterState {
  readonly side: DuelSide;
  readonly p: DuelistProfile;
  readonly human: boolean;
  x: number;
  /** +1 for A (faces +x), −1 for B. */
  readonly facing: 1 | -1;
  hp: number;
  stamina: number;
  shieldHp: number;
  /** Shields left including the one in hand. */
  shieldsLeft: number;
  action: DuelAction;
  actionStart: number;
  actionEnd: number;
  /** Increments whenever a new action starts (AI perception, view animation restarts). */
  actionSeq: number;
  attack: AttackKind | null;
  height: StrikeHeight;
  impactAt: number;
  riposteStrike: boolean;
  guardHeight: StrikeHeight;
  parryWindowMs: number;
  invulnUntil: number;
  dodgeFrom: number;
  dodgeTo: number;
  exhaustedUntil: number;
  blockDisabledUntil: number;
  riposteUntil: number;
  yieldCooldownUntil: number;
  yieldSince: number;
  combo: number;
  tauntHit: boolean;
  tauntsLanded: number;
  holdSince: number;
  holdFired: boolean;
  holdHeight: StrikeHeight;
  buffer: { edge: Edge; at: number } | null;
  hits: number;
  damageDealt: number;
}

/** Feedback for the view and audio (impacts by material, grunts, glyph cues). Cleared every step. */
export interface DuelFx {
  kind:
    | 'windup'
    | 'feint'
    | 'hit'
    | 'block'
    | 'parry'
    | 'whiff'
    | 'dodged'
    | 'bash'
    | 'shove'
    | 'shieldBreak'
    | 'shieldSwap'
    | 'hook'
    | 'guardBreak'
    | 'stagger'
    | 'exhausted'
    | 'combo'
    | 'riposte'
    | 'tauntStart'
    | 'tauntLanded'
    | 'yieldAsked'
    | 'quarterGranted'
    | 'quarterRefused'
    | 'firstBlood'
    | 'ringOut'
    | 'down';
  /** The fighter acting (the attacker for impacts). */
  side: DuelSide;
  /** Impact material for `duel.impact` (wood = shield/haft, metal = mail or blade, flesh = body). */
  material?: 'wood' | 'metal' | 'flesh';
  amount?: number;
  height?: StrikeHeight;
  attack?: AttackKind;
}

/** Intent glyph over a fighter (§14.6). */
export interface DuelGlyphView {
  kind: GlyphKind;
  /** Wind-up progress 0–1 at this frame. */
  progress: number;
  /** Milliseconds until the blow lands. */
  impactInMs: number;
}

/** One fighter as the view draws it. */
export interface DuelFighterView {
  charId: DuelistProfile['charId'];
  name: string;
  weapon: DuelistProfile['weapon'];
  x: number;
  facing: 1 | -1;
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  shieldHp: number;
  shieldMax: number;
  shieldsLeft: number;
  action: DuelAction;
  /** Progress 0–1 of the current timed action (0 for open-ended ones: idle, guard, yield). */
  actionProgress: number;
  attack: AttackKind | null;
  height: StrikeHeight;
  guardHeight: StrikeHeight;
  exhausted: boolean;
  blockDisabled: boolean;
  riposte: boolean;
  invulnerable: boolean;
  /** 0–1 progress of a held plea for quarter. */
  yieldProgress: number;
  combo: number;
  tauntsLanded: number;
}

/** Everything the duel view needs for one frame. */
export interface DuelRenderState {
  frame: number;
  timeMs: number;
  phase: 'fighting' | 'quarter' | 'ended';
  arena: DuelSetup['arena'];
  stakes: DuelSetup['stakes'];
  lethal: boolean;
  halfWidthM: number;
  ringOut: boolean;
  timeLimitMs: number;
  fighters: { a: DuelFighterView; b: DuelFighterView };
  /** Glyph over the viewer's opponent (null when hidden or no viewer). */
  glyph: DuelGlyphView | null;
  quarter: { asker: DuelSide; decider: DuelSide } | null;
  outcome: DuelFightSummary | null;
  fx: DuelFx[];
}

export interface DuelEngineOptions {
  /** Sides driven by the built-in AI. Default: every side except `setup.playerSide`. */
  ai?: Partial<Record<DuelSide, boolean>>;
  /** Accessibility parry-window extension for human sides (ms; capped at balance.duel.accessibilityParryMaxMs). */
  parryAssistMs?: number;
  /** AI difficulty (default: setup.difficulty, else 'raider'). */
  difficulty?: DifficultyId;
  /** Intent glyphs for every viewer from the start of the wind-up (Assisted-style readability aid). */
  alwaysShowGlyphs?: boolean;
  /** Starting distance between the fighters (default tunables `startGapM`; a boarding fight starts closer). */
  startGapM?: number;
}

/** Serializable engine state (determinism tests, debugging, mid-duel snapshots). */
export interface DuelEngineDump {
  frame: number;
  rng: RngState;
  fighters: { a: Record<string, unknown>; b: Record<string, unknown> };
  outcome: DuelFightSummary | null;
}

type Edge =
  | { kind: 'light'; height: StrikeHeight }
  | { kind: 'heavy' }
  | { kind: 'bash' }
  | { kind: 'parry' }
  | { kind: 'dodge'; dir: -1 | 1 }
  | { kind: 'taunt' };

interface ImpactPlan {
  atk: DuelFighterState;
  def: DuelFighterState;
  kind: 'hit' | 'block' | 'parried' | 'whiff' | 'dodged' | 'bash' | 'shove';
  hpDmg: number;
  shieldDmg: number;
  shieldMult: number;
  staminaDmg: number;
  guardBreak: boolean;
  hook: boolean;
  hammerStagger: boolean;
  combo: boolean;
  material: 'wood' | 'metal' | 'flesh';
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (re-exported for the view)

export { glyphKind, glyphShowFraction, otherSide } from './glyph';
export type { AttackKind } from './glyph';

const OTHER: Readonly<Record<DuelSide, DuelSide>> = { a: 'b', b: 'a' };

// ---------------------------------------------------------------------------------------------
// Engine

export class DuelEngine {
  readonly setup: DuelSetup;
  readonly dtMs: number;
  readonly halfWidthM: number;
  readonly ringOut: boolean;
  readonly timeLimitMs: number;
  private readonly cfg: DuelTunables;
  private readonly bal: DuelEngineContent['balance'];
  private readonly rng: Rng;
  private readonly ais: Partial<Record<DuelSide, DuelAi>> = {};
  private readonly fighters: { a: DuelFighterState; b: DuelFighterState };
  private readonly alwaysGlyphs: boolean;
  private frameNo = 0;
  private result: DuelFightSummary | null = null;
  private plea: { asker: DuelSide; decider: DuelSide } | null = null;
  private readonly fxList: DuelFx[] = [];
  private blood: { side: DuelSide; dmg: number }[] = [];

  constructor(setup: DuelSetup, content: DuelEngineContent, opts: DuelEngineOptions = {}) {
    const profiles = setup.profiles;
    if (!profiles) throw new RangeError(`duel ${setup.id}: setup has no fighter profiles`);
    this.setup = setup;
    this.cfg = content.tunables.duel;
    this.bal = content.balance;
    this.dtMs = 1000 / this.bal.duel.tickHz;
    const arena = this.cfg.arenas[setup.arena];
    this.halfWidthM = arena.halfWidthM;
    this.ringOut = arena.ringOut;
    this.timeLimitMs = this.cfg.timeLimitS * 1000;
    this.alwaysGlyphs = opts.alwaysShowGlyphs ?? false;
    this.rng = new Rng(setup.seed);
    const aiSides: Record<DuelSide, boolean> = {
      a: opts.ai?.a ?? setup.playerSide !== 'a',
      b: opts.ai?.b ?? setup.playerSide !== 'b',
    };
    const assist = clamp(opts.parryAssistMs ?? 0, 0, this.bal.duel.accessibilityParryMaxMs);
    const gap = clamp(opts.startGapM ?? this.cfg.startGapM, this.cfg.minGapM, this.halfWidthM * 1.5);
    this.fighters = {
      a: this.makeFighter('a', profiles.a, !aiSides.a, -gap / 2, assist),
      b: this.makeFighter('b', profiles.b, !aiSides.b, gap / 2, assist),
    };
    const difficulty = opts.difficulty ?? setup.difficulty ?? 'raider';
    for (const side of ['a', 'b'] as const) {
      if (aiSides[side]) this.ais[side] = new DuelAi(this, side, content, difficulty, Rng.derive(setup.seed, `ai:${side}`));
    }
  }

  private makeFighter(side: DuelSide, p: DuelistProfile, human: boolean, x: number, assist: number): DuelFighterState {
    return {
      side,
      p,
      human,
      x,
      facing: side === 'a' ? 1 : -1,
      hp: p.hpStart,
      stamina: p.staminaMax,
      shieldHp: p.shields > 0 ? p.shieldMax : 0,
      shieldsLeft: p.shields,
      action: 'idle',
      actionStart: 0,
      actionEnd: 0,
      actionSeq: 0,
      attack: null,
      height: 'high',
      impactAt: 0,
      riposteStrike: false,
      guardHeight: 'high',
      parryWindowMs: p.parryWindowMs + (human ? assist : 0),
      invulnUntil: -1,
      dodgeFrom: x,
      dodgeTo: x,
      exhaustedUntil: -1,
      blockDisabledUntil: -1,
      riposteUntil: -1,
      yieldCooldownUntil: -1,
      yieldSince: -1,
      combo: 0,
      tauntHit: false,
      tauntsLanded: 0,
      holdSince: -1,
      holdFired: false,
      holdHeight: 'high',
      buffer: null,
      hits: 0,
      damageDealt: 0,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Read access

  /** Frames stepped so far. */
  get frame(): number {
    return this.frameNo;
  }
  /** Simulated time in ms (frame × 1000 / tickHz). */
  get timeMs(): number {
    return this.frameNo * this.dtMs;
  }
  get ended(): boolean {
    return this.result !== null;
  }
  /** The fight's result once it has ended. */
  get outcome(): DuelFightSummary | null {
    return this.result;
  }
  /** A pending plea for quarter waiting for a human decider (the engine is frozen until answered). */
  get quarter(): { asker: DuelSide; decider: DuelSide } | null {
    return this.plea;
  }
  /** A fighter's runtime state (read-only outside the engine). */
  fighter(side: DuelSide): Readonly<DuelFighterState> {
    return this.fighters[side];
  }
  /** Gap between the two bodies (metres). */
  get gap(): number {
    return this.fighters.b.x - this.fighters.a.x;
  }
  /** Feedback events of the last step. */
  get fx(): readonly DuelFx[] {
    return this.fxList;
  }

  /** The intent glyph `viewer` sees over its opponent now (§14.6), or null. */
  glyphFor(viewer: DuelSide): DuelGlyphView | null {
    const me = this.fighters[viewer];
    const op = this.fighters[OTHER[viewer]];
    if (op.action !== 'windup' || op.attack === null) return null;
    const frac = this.alwaysGlyphs ? 0 : glyphShowFraction(me.p.wits, op.p.wits, this.bal.duel.glyphWitsLead);
    if (frac === null) return null;
    const t = this.timeMs;
    const span = Math.max(1, op.impactAt - op.actionStart);
    const progress = clamp((t - op.actionStart) / span, 0, 1);
    if (progress < frac) return null;
    return { kind: glyphKind(op.attack, op.height), progress, impactInMs: Math.max(0, op.impactAt - t) };
  }

  /** Render state for one frame. `viewer` gets the glyph over its opponent. */
  snapshot(viewer: DuelSide | null = null): DuelRenderState {
    return {
      frame: this.frameNo,
      timeMs: this.timeMs,
      phase: this.result ? 'ended' : this.plea ? 'quarter' : 'fighting',
      arena: this.setup.arena,
      stakes: this.setup.stakes,
      lethal: this.setup.lethal ?? this.setup.stakes === 'death',
      halfWidthM: this.halfWidthM,
      ringOut: this.ringOut,
      timeLimitMs: this.timeLimitMs,
      fighters: { a: this.view(this.fighters.a), b: this.view(this.fighters.b) },
      glyph: viewer ? this.glyphFor(viewer) : null,
      quarter: this.plea ? { ...this.plea } : null,
      outcome: this.result ? { ...this.result, hpPct: { ...this.result.hpPct }, tauntsLanded: { ...this.result.tauntsLanded } } : null,
      fx: this.fxList.map((f) => ({ ...f })),
    };
  }

  private view(f: DuelFighterState): DuelFighterView {
    const t = this.timeMs;
    const timed = f.action !== 'idle' && f.action !== 'guard' && f.action !== 'yield' && f.action !== 'down';
    const end = f.action === 'windup' ? f.impactAt : f.actionEnd;
    const span = Math.max(1, end - f.actionStart);
    return {
      charId: f.p.charId,
      name: f.p.name,
      weapon: f.p.weapon,
      x: f.x,
      facing: f.facing,
      hp: Math.max(0, f.hp),
      hpMax: f.p.hpMax,
      stamina: f.stamina,
      staminaMax: f.p.staminaMax,
      shieldHp: f.shieldHp,
      shieldMax: f.p.shieldMax,
      shieldsLeft: f.shieldsLeft,
      action: f.action,
      actionProgress: timed ? clamp((t - f.actionStart) / span, 0, 1) : 0,
      attack: f.action === 'windup' ? f.attack : null,
      height: f.height,
      guardHeight: f.guardHeight,
      exhausted: t < f.exhaustedUntil,
      blockDisabled: t < f.blockDisabledUntil,
      riposte: t <= f.riposteUntil,
      invulnerable: t < f.invulnUntil,
      yieldProgress: f.action === 'yield' ? clamp((t - f.yieldSince) / (this.bal.duel.moves.yield.holdS * 1000), 0, 1) : 0,
      combo: f.combo,
      tauntsLanded: f.tauntsLanded,
    };
  }

  /** Serializable state (determinism checks). */
  dump(): DuelEngineDump {
    const strip = (f: DuelFighterState): Record<string, unknown> => {
      const { p: _p, buffer, ...rest } = f;
      return { ...rest, buffer: buffer ? { at: buffer.at, edge: { ...buffer.edge } } : null };
    };
    return {
      frame: this.frameNo,
      rng: this.rng.getState(),
      fighters: { a: strip(this.fighters.a), b: strip(this.fighters.b) },
      outcome: this.result ? { ...this.result } : null,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Stepping

  /**
   * Advances one fixed step (1/tickHz s). Inputs for AI-driven sides are ignored (the AI makes its
   * own). While a plea for quarter waits for a human decider, the clock is frozen until that side
   * sends `quarter: 'accept' | 'refuse'`.
   */
  step(inputs: Partial<Record<DuelSide, DuelInput>> = {}): void {
    if (this.result) return;
    this.fxList.length = 0;
    if (this.plea) {
      const answer = inputs[this.plea.decider]?.quarter;
      if (answer === undefined) return;
      this.answerPlea(answer === 'accept', this.timeMs);
      return;
    }
    // AI decisions are made from the state at the start of the frame.
    const ia = this.ais.a ? this.ais.a.think(this.timeMs) : (inputs.a ?? {});
    const ib = this.ais.b ? this.ais.b.think(this.timeMs) : (inputs.b ?? {});
    this.frameNo += 1;
    const t = this.timeMs;
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    this.updateTimers(fa, t);
    this.updateTimers(fb, t);
    this.applyInput(fa, ia, t);
    this.applyInput(fb, ib, t);
    this.move(ia, ib);
    this.resolveImpacts(t);
    this.regen(fa, t);
    this.regen(fb, t);
    this.checkPleas(t);
    this.checkEnd(t);
  }

  /** AI-vs-AI convenience: steps until the fight ends (or `maxFrames`). Throws if a human side is waited on. */
  run(maxFrames = Math.ceil((this.timeLimitMs / this.dtMs) * 1.1) + 10): DuelFightSummary {
    for (let i = 0; i < maxFrames && !this.result; i++) {
      if (this.plea && this.fighters[this.plea.decider].human) throw new Error('DuelEngine.run: a human side must answer a plea for quarter');
      this.step();
    }
    if (!this.result) throw new Error(`DuelEngine.run: duel ${this.setup.id} did not end within ${maxFrames} frames`);
    return this.result;
  }

  private emit(fx: DuelFx): void {
    this.fxList.push(fx);
  }

  private startAction(f: DuelFighterState, action: DuelAction, t: number, durationMs: number): void {
    f.action = action;
    f.actionStart = t;
    f.actionEnd = t + durationMs;
    f.actionSeq += 1;
  }

  private canAct(f: DuelFighterState): boolean {
    return f.action === 'idle' || f.action === 'guard';
  }

  private hasShield(f: DuelFighterState): boolean {
    return f.p.shieldMax > 0 && f.shieldsLeft > 0 && f.shieldHp > 0;
  }

  private exhausted(f: DuelFighterState, t: number): boolean {
    return t < f.exhaustedUntil;
  }

  private spend(f: DuelFighterState, cost: number, t: number): boolean {
    if (cost <= 0) return true;
    if (f.stamina <= 0) return false;
    f.stamina -= cost;
    if (f.stamina <= 0) {
      f.stamina = 0;
      this.exhaust(f, t);
    }
    return true;
  }

  private exhaust(f: DuelFighterState, t: number): void {
    if (t < f.exhaustedUntil) return;
    f.exhaustedUntil = t + this.bal.duel.exhaustion.seconds * 1000;
    this.emit({ kind: 'exhausted', side: f.side });
  }

  private updateTimers(f: DuelFighterState, t: number): void {
    switch (f.action) {
      case 'recover':
      case 'stagger':
      case 'parryWhiff':
        if (t >= f.actionEnd) f.action = 'idle';
        break;
      case 'swap':
        if (t >= f.actionEnd) {
          f.shieldHp = f.p.shieldMax;
          f.action = 'idle';
          this.emit({ kind: 'shieldSwap', side: f.side });
        }
        break;
      case 'dodge': {
        const span = Math.max(1, f.actionEnd - f.actionStart);
        f.x = f.dodgeFrom + (f.dodgeTo - f.dodgeFrom) * clamp((t - f.actionStart) / span, 0, 1);
        if (t >= f.actionEnd) {
          f.action = 'recover';
          f.actionStart = t;
          f.actionEnd = t + this.cfg.dodge.recoverMs;
        }
        break;
      }
      case 'taunt':
        if (t >= f.actionEnd) {
          if (!f.tauntHit) {
            f.tauntsLanded += 1;
            this.emit({ kind: 'tauntLanded', side: f.side });
          }
          f.action = 'idle';
        }
        break;
      default:
        break;
    }
  }

  private applyInput(f: DuelFighterState, inp: DuelInput, t: number): void {
    if (f.action === 'down') return;
    if (inp.height !== undefined) f.holdHeight = inp.height;
    // A parry window that caught nothing: back to the guard if it is still held, otherwise open.
    if (f.action === 'parry' && t >= f.actionEnd) {
      if (inp.guard && t >= f.blockDisabledUntil) {
        f.action = 'guard';
        if (inp.height !== undefined) f.guardHeight = inp.height;
      } else {
        this.startAction(f, 'parryWhiff', t, this.cfg.parryWhiffMs);
      }
    }
    // Yield: hold to ask for quarter; nothing else happens while kneeling.
    if (inp.yieldHeld) {
      if (f.action !== 'yield' && this.canAct(f) && t >= f.yieldCooldownUntil) {
        this.startAction(f, 'yield', t, 0);
        f.yieldSince = t;
      }
    } else if (f.action === 'yield') {
      f.action = 'idle';
    }
    if (f.action === 'yield') return;
    // Feint: cancel the own strike's wind-up.
    if (inp.feint && f.action === 'windup' && f.attack !== 'bash' && this.spend(f, this.bal.duel.moves.feint.stamina, t)) {
      this.emit({ kind: 'feint', side: f.side, attack: f.attack ?? 'light', height: f.height });
      f.attack = null;
      this.startAction(f, 'recover', t, this.cfg.feintRecoverMs);
    }
    let edge: Edge | null = null;
    if (inp.attack === 'heavy') edge = { kind: 'heavy' };
    else if (inp.attack === 'light') edge = { kind: 'light', height: inp.height ?? f.holdHeight };
    if (inp.attackHeld !== undefined) {
      const holdMs = this.bal.duel.moves.heavy.holdS * 1000;
      if (inp.attackHeld) {
        if (f.holdSince < 0) {
          f.holdSince = t;
          f.holdFired = false;
        } else if (!f.holdFired && t - f.holdSince >= holdMs) {
          edge = { kind: 'heavy' };
          f.holdFired = true;
        }
      } else if (f.holdSince >= 0) {
        if (!f.holdFired) edge = { kind: 'light', height: inp.height ?? f.holdHeight };
        f.holdSince = -1;
        f.holdFired = false;
      }
    }
    if (inp.taunt) edge = { kind: 'taunt' };
    if (inp.bash) edge = { kind: 'bash' };
    if (inp.dodge !== undefined) edge = { kind: 'dodge', dir: inp.dodge };
    if (inp.parry) edge = { kind: 'parry' };
    if (edge) {
      if (this.canAct(f)) this.execute(f, edge, t);
      else f.buffer = { edge, at: t };
    } else if (f.buffer) {
      if (t - f.buffer.at > this.cfg.inputBufferMs) f.buffer = null;
      else if (this.canAct(f)) {
        const buffered = f.buffer.edge;
        f.buffer = null;
        this.execute(f, buffered, t);
      }
    }
    // Guard (held).
    if (this.canAct(f)) {
      if (inp.guard && t >= f.blockDisabledUntil) {
        f.action = 'guard';
        if (inp.height !== undefined) f.guardHeight = inp.height;
      } else if (f.action === 'guard') {
        f.action = 'idle';
      }
    }
  }

  private execute(f: DuelFighterState, edge: Edge, t: number): void {
    const moves = this.bal.duel.moves;
    switch (edge.kind) {
      case 'parry':
        if (this.exhausted(f, t)) return; // §14.5: exhausted fighters cannot parry
        if (!this.spend(f, moves.parry.stamina, t)) return;
        this.startAction(f, 'parry', t, f.parryWindowMs);
        return;
      case 'dodge': {
        if (!this.spend(f, moves.dodge.stamina, t)) return;
        this.startAction(f, 'dodge', t, this.cfg.dodge.durationMs);
        f.invulnUntil = t + moves.dodge.invulnMs * f.p.dodgeMult;
        f.dodgeFrom = f.x;
        f.dodgeTo = f.x + f.facing * edge.dir * this.cfg.dodge.distanceM * f.p.dodgeMult;
        return;
      }
      case 'bash':
        if (!this.hasShield(f)) return;
        if (!this.spend(f, moves.bash.stamina, t)) return;
        this.beginAttack(f, 'bash', 'high', this.cfg.bash.windupMs, t);
        return;
      case 'light':
        if (!this.spend(f, moves.light.stamina, t)) return;
        this.beginAttack(f, 'light', edge.height, f.p.windupMs, t);
        return;
      case 'heavy':
        if (!this.spend(f, moves.heavy.stamina, t)) return;
        this.beginAttack(f, 'heavy', 'high', f.p.windupMs * moves.heavy.windupMult, t);
        return;
      case 'taunt':
        this.startAction(f, 'taunt', t, moves.taunt.vulnerableS * 1000);
        f.tauntHit = false;
        this.emit({ kind: 'tauntStart', side: f.side });
        return;
    }
  }

  private beginAttack(f: DuelFighterState, kind: AttackKind, height: StrikeHeight, windupMs: number, t: number): void {
    this.startAction(f, 'windup', t, windupMs);
    f.attack = kind;
    f.height = height;
    f.impactAt = t + windupMs;
    f.riposteStrike = kind !== 'bash' && t <= f.riposteUntil;
    if (kind !== 'bash') f.riposteUntil = -1;
    this.emit({ kind: 'windup', side: f.side, attack: kind, height });
  }

  private move(ia: DuelInput, ib: DuelInput): void {
    const dtS = this.dtMs / 1000;
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const oldA = fa.x;
    const oldB = fb.x;
    fa.x += this.velocity(fa, ia) * dtS;
    fb.x += this.velocity(fb, ib) * dtS;
    if (!this.ringOut) {
      fa.x = clamp(fa.x, -this.halfWidthM, this.halfWidthM);
      fb.x = clamp(fb.x, -this.halfWidthM, this.halfWidthM);
    }
    this.separate(oldA, oldB);
  }

  private velocity(f: DuelFighterState, inp: DuelInput): number {
    if (f.action !== 'idle' && f.action !== 'guard') return 0;
    const m = inp.move ?? 0;
    if (m === 0) return 0;
    const speed = m > 0 ? this.cfg.walkSpeedMps : this.cfg.backSpeedMps;
    return f.facing * m * speed * (f.action === 'guard' ? this.cfg.guardMoveMult : 1);
  }

  /** Keeps the bodies at least `minGapM` apart; whoever moved toward the other gives the ground back. */
  private separate(oldA: number, oldB: number): void {
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const min = this.cfg.minGapM;
    const gap = fb.x - fa.x;
    if (gap >= min) return;
    const overlap = min - gap;
    const da = Math.max(0, fa.x - oldA);
    const db = Math.max(0, oldB - fb.x);
    if (da + db > 0) {
      fa.x -= (overlap * da) / (da + db);
      fb.x += (overlap * db) / (da + db);
    } else {
      fa.x -= overlap / 2;
      fb.x += overlap / 2;
    }
    if (!this.ringOut) {
      // Against a wall: push the other body instead.
      if (fa.x < -this.halfWidthM) {
        fb.x += -this.halfWidthM - fa.x;
        fa.x = -this.halfWidthM;
      }
      if (fb.x > this.halfWidthM) {
        fa.x -= fb.x - this.halfWidthM;
        fb.x = this.halfWidthM;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Impacts

  private resolveImpacts(t: number): void {
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const dueA = fa.action === 'windup' && t >= fa.impactAt;
    const dueB = fb.action === 'windup' && t >= fb.impactAt;
    if (!dueA && !dueB) return;
    // Plans are computed against the states BEFORE either blow lands (symmetric trades), random
    // rolls in a fixed order (a, then b).
    const planA = dueA ? this.plan(fa, fb, t) : null;
    const planB = dueB ? this.plan(fb, fa, t) : null;
    if (planA) this.applyAttacker(planA, t);
    if (planB) this.applyAttacker(planB, t);
    if (planA) this.applyDefender(planA, t);
    if (planB) this.applyDefender(planB, t);
  }

  private plan(atk: DuelFighterState, def: DuelFighterState, t: number): ImpactPlan {
    const kind = atk.attack ?? 'light';
    const gap = this.fighters.b.x - this.fighters.a.x;
    const plan: ImpactPlan = {
      atk,
      def,
      kind: 'whiff',
      hpDmg: 0,
      shieldDmg: 0,
      shieldMult: 1,
      staminaDmg: 0,
      guardBreak: false,
      hook: false,
      hammerStagger: false,
      combo: false,
      material: 'flesh',
    };
    const eps = 1e-9;
    if (kind === 'bash') {
      if (gap > this.cfg.bash.reachM + eps) return plan;
      if (t < def.invulnUntil) {
        plan.kind = 'dodged';
        return plan;
      }
      if (def.action === 'guard') {
        plan.kind = 'bash';
        plan.material = 'wood';
        if (this.hasShield(def)) plan.shieldDmg = this.bal.duel.moves.bash.shieldDamage;
      } else {
        plan.kind = 'shove';
      }
      return plan;
    }
    if (gap > atk.p.reachM + eps) return plan;
    if (t < def.invulnUntil) {
      plan.kind = 'dodged';
      return plan;
    }
    if (def.action === 'parry' && !this.exhausted(def, t)) {
      plan.kind = 'parried';
      plan.material = 'metal';
      return plan;
    }
    const moves = this.bal.duel.moves;
    const special = this.bal.weapons[atk.p.weapon].special;
    let mult = kind === 'heavy' ? moves.heavy.damageMult : moves.light.damageMult;
    if (this.exhausted(atk, t)) mult *= this.bal.duel.exhaustion.damageMult;
    if (atk.riposteStrike) mult *= this.bal.duel.riposteMult;
    const raw = strikeDamage(atk.p, def.p, mult);
    plan.shieldMult = special['shieldDamageMult'] ?? 1;
    if (def.action === 'guard' && t >= def.blockDisabledUntil) {
      const right = def.guardHeight === atk.height;
      const shield = this.hasShield(def);
      const share = shield
        ? right
          ? moves.block.blockShare
          : moves.block.wrongHeightShare
        : right
          ? this.cfg.haftBlock.share
          : this.cfg.haftBlock.wrongHeightShare;
      const blocked = raw * share;
      plan.kind = 'block';
      plan.material = 'wood';
      plan.hpDmg = raw - blocked;
      plan.shieldDmg = shield ? blocked * plan.shieldMult : 0;
      plan.staminaDmg = blocked * this.cfg.blockHitStaminaPerDamage;
      if (kind === 'heavy') {
        plan.guardBreak = this.rng.chance(moves.heavy.guardBreak);
        if (shield && special['hookDisableBlockS'] !== undefined) plan.hook = true;
      }
      // A hammer staggers on any blow that connects, a guarded one included (tunables `staggerOnBlock`).
      const blockStagger = special['staggerChance'];
      if (blockStagger !== undefined && this.cfg.staggerOnBlock) plan.hammerStagger = this.rng.chance(blockStagger);
      return plan;
    }
    // Clean hit.
    let hit = raw;
    const comboMult = special['comboThirdHitMult'];
    if (comboMult !== undefined && atk.combo + 1 >= 3) {
      hit *= comboMult;
      plan.combo = true;
    }
    plan.kind = 'hit';
    plan.hpDmg = hit;
    plan.material = def.p.armourTier >= 3 ? 'metal' : 'flesh';
    const stagger = special['staggerChance'];
    if (stagger !== undefined) plan.hammerStagger = this.rng.chance(stagger);
    return plan;
  }

  private applyAttacker(plan: ImpactPlan, t: number): void {
    const atk = plan.atk;
    const windup = Math.max(1, atk.impactAt - atk.actionStart);
    const kind = atk.attack ?? 'light';
    atk.attack = null;
    switch (plan.kind) {
      case 'parried':
        atk.combo = 0;
        this.startAction(atk, 'stagger', t, this.cfg.parriedStaggerMs);
        break;
      case 'whiff':
      case 'dodged':
        atk.combo = 0;
        this.startAction(atk, 'recover', t, kind === 'bash' ? this.cfg.bash.recoverMs : windup * this.cfg.whiffRecoverMult);
        break;
      case 'bash':
      case 'shove':
        this.startAction(atk, 'recover', t, this.cfg.bash.recoverMs);
        break;
      case 'block':
        atk.combo = 0;
        this.startAction(atk, 'recover', t, windup * this.cfg.recoverMult);
        break;
      case 'hit':
        atk.combo = plan.combo ? 0 : atk.combo + 1;
        atk.hits += 1;
        this.startAction(atk, 'recover', t, windup * this.cfg.recoverMult);
        break;
    }
  }

  private applyDefender(plan: ImpactPlan, t: number): void {
    const { atk, def } = plan;
    const kind = plan.kind;
    if (kind === 'whiff') {
      this.emit({ kind: 'whiff', side: atk.side });
      return;
    }
    if (kind === 'dodged') {
      this.emit({ kind: 'dodged', side: atk.side });
      return;
    }
    if (kind === 'parried') {
      def.riposteUntil = t + this.bal.duel.riposteWindowMs;
      def.action = 'idle';
      this.emit({ kind: 'parry', side: def.side, material: 'metal' });
      return;
    }
    if (kind === 'shove') {
      const push = this.cfg.bash.pushM;
      def.x += def.facing * -1 * push;
      if (!this.ringOut) def.x = clamp(def.x, -this.halfWidthM, this.halfWidthM);
      this.interrupt(def, t, this.cfg.bash.openStaggerMs);
      this.emit({ kind: 'shove', side: atk.side });
      return;
    }
    if (kind === 'bash') {
      this.emit({ kind: 'bash', side: atk.side, material: 'wood' });
      this.damageShield(def, plan.shieldDmg, 1, t);
      this.interrupt(def, t, this.bal.duel.moves.bash.staggerMs);
      return;
    }
    let hpDmg = plan.hpDmg;
    if (kind === 'block') {
      hpDmg += this.damageShield(def, plan.shieldDmg, plan.shieldMult, t);
      if (plan.staminaDmg > 0) {
        def.stamina -= plan.staminaDmg;
        if (def.stamina <= 0) {
          def.stamina = 0;
          this.exhaust(def, t);
        }
      }
      this.emit({ kind: 'block', side: atk.side, material: plan.material, amount: hpDmg, height: atk.height });
      if (plan.hook) {
        const hookS = this.bal.weapons[atk.p.weapon].special['hookDisableBlockS'] ?? 0;
        def.blockDisabledUntil = t + hookS * 1000;
        if (def.action === 'guard') def.action = 'idle';
        this.emit({ kind: 'hook', side: atk.side });
      }
      if (plan.guardBreak || plan.hammerStagger) {
        const ms = Math.max(plan.guardBreak ? this.cfg.guardBreakStaggerMs : 0, plan.hammerStagger ? this.cfg.hammerStaggerMs : 0);
        this.interrupt(def, t, ms);
        if (plan.guardBreak) this.emit({ kind: 'guardBreak', side: atk.side });
        if (plan.hammerStagger) this.emit({ kind: 'stagger', side: def.side });
      }
    } else {
      // Clean hit: flinch (hammer: longer stagger), taunt failed, combo of the victim reset. A poised
      // wind-up (heavy strikes, two-handed weapons) is not interrupted by a flinch — the blows trade.
      def.combo = 0;
      if (def.action === 'taunt') def.tauntHit = true;
      const staggerMs = plan.hammerStagger ? Math.max(this.cfg.hammerStaggerMs, this.cfg.flinchMs) : this.cfg.flinchMs;
      if (!(this.poised(def) && !plan.hammerStagger)) this.interrupt(def, t, staggerMs);
      this.emit({ kind: 'hit', side: atk.side, material: plan.material, amount: hpDmg, height: atk.height });
      if (plan.combo) this.emit({ kind: 'combo', side: atk.side });
      if (atk.riposteStrike) this.emit({ kind: 'riposte', side: atk.side });
      if (plan.hammerStagger) this.emit({ kind: 'stagger', side: def.side });
    }
    if (hpDmg > 0) {
      def.hp -= hpDmg;
      atk.damageDealt += hpDmg;
      if (hpDmg >= this.cfg.firstBloodMinDamage) this.blood.push({ side: atk.side, dmg: hpDmg });
      if (def.hp <= 0 && def.action !== 'down') {
        def.action = 'down';
        def.actionSeq += 1;
        this.emit({ kind: 'down', side: def.side });
      }
    }
  }

  /** True while the fighter winds up a strike a flinch cannot stop (tunables `poise`). */
  poised(f: DuelFighterState): boolean {
    if (f.action !== 'windup' || f.attack === null || f.attack === 'bash') return false;
    return (f.attack === 'heavy' && this.cfg.poise.heavy) || this.cfg.poise.weapons.includes(f.p.weapon);
  }

  /** Interrupts whatever the fighter does (unless down) with a stagger of `ms`. */
  private interrupt(f: DuelFighterState, t: number, ms: number): void {
    if (f.action === 'down') return;
    if (f.action === 'taunt') f.tauntHit = true;
    if (f.action === 'swap') {
      // Picking up the next shield is not undone by a blow; extend it instead.
      f.actionEnd = Math.max(f.actionEnd, t + ms);
      return;
    }
    if (f.action === 'stagger' && f.actionEnd >= t + ms) return;
    f.attack = null;
    f.buffer = null;
    this.startAction(f, 'stagger', t, ms);
  }

  /**
   * Applies shield damage. Returns the HP damage that passes through when the shield is hewn apart
   * (the blocked share the shield could no longer take). Holmgang: the next shield is taken up.
   */
  private damageShield(f: DuelFighterState, dmg: number, mult: number, t: number): number {
    if (dmg <= 0 || !this.hasShield(f)) return 0;
    f.shieldHp -= dmg;
    if (f.shieldHp > 0) return 0;
    const overflow = -f.shieldHp / Math.max(1e-9, mult);
    f.shieldHp = 0;
    f.shieldsLeft -= 1;
    this.emit({ kind: 'shieldBreak', side: f.side, material: 'wood' });
    if (f.shieldsLeft > 0 && f.action !== 'down') {
      f.attack = null;
      this.startAction(f, 'swap', t, this.cfg.shieldSwapMs);
    }
    return overflow;
  }

  private regen(f: DuelFighterState, t: number): void {
    if (f.action === 'down') return;
    const d = this.bal.duel;
    let rate = 0;
    if (f.action === 'idle' || f.action === 'taunt' || f.action === 'yield') rate = d.staminaRegenIdle;
    else if (f.action === 'guard') rate = d.staminaRegenBlocking - d.moves.block.staminaPerS;
    if (rate === 0) return;
    f.stamina = Math.min(f.p.staminaMax, f.stamina + (rate * this.dtMs) / 1000);
    if (f.stamina <= 0) {
      f.stamina = 0;
      this.exhaust(f, t);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pleas for quarter and the end of the fight

  private checkPleas(t: number): void {
    const holdMs = this.bal.duel.moves.yield.holdS * 1000;
    for (const side of ['a', 'b'] as const) {
      const f = this.fighters[side];
      if (f.action !== 'yield' || t - f.yieldSince < holdMs || this.result || this.plea) continue;
      this.emit({ kind: 'yieldAsked', side });
      const decider = this.fighters[OTHER[side]];
      if (this.setup.stakes !== 'death') {
        // To first blood or to yield: asking for quarter ends the fight.
        this.emit({ kind: 'quarterGranted', side: decider.side });
        this.finish(decider.side, 'yield', t);
        return;
      }
      if (decider.human) {
        this.plea = { asker: side, decider: decider.side };
        return;
      }
      this.plea = { asker: side, decider: decider.side };
      this.answerPlea(this.rng.chance(decider.p.mercy), t);
      if (this.result) return;
    }
  }

  private answerPlea(accept: boolean, t: number): void {
    const plea = this.plea;
    if (!plea) return;
    this.plea = null;
    const asker = this.fighters[plea.asker];
    if (accept) {
      this.emit({ kind: 'quarterGranted', side: plea.decider });
      this.finish(plea.decider, 'yield', t);
      return;
    }
    this.emit({ kind: 'quarterRefused', side: plea.decider });
    asker.yieldCooldownUntil = t + this.cfg.yieldRetryMs;
    if (asker.action === 'yield') asker.action = 'idle';
  }

  private checkEnd(t: number): void {
    if (this.result) return;
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const blood = this.blood;
    this.blood = [];
    if (this.setup.stakes === 'firstBlood' && blood.length > 0) {
      let maxA = 0;
      let maxB = 0;
      for (const b of blood) {
        if (b.side === 'a') maxA = Math.max(maxA, b.dmg);
        else maxB = Math.max(maxB, b.dmg);
      }
      const winner: DuelSide = maxA > maxB ? 'a' : maxB > maxA ? 'b' : this.judge();
      this.emit({ kind: 'firstBlood', side: winner });
      this.finish(winner, 'firstBlood', t);
      return;
    }
    const downA = fa.hp <= 0;
    const downB = fb.hp <= 0;
    if (downA || downB) {
      let winner: DuelSide;
      if (downA && downB) winner = fa.hp > fb.hp ? 'a' : fb.hp > fa.hp ? 'b' : this.coin();
      else winner = downA ? 'b' : 'a';
      this.finish(winner, 'down', t);
      return;
    }
    if (this.ringOut) {
      const outA = fa.x < -this.halfWidthM || fa.x > this.halfWidthM;
      const outB = fb.x < -this.halfWidthM || fb.x > this.halfWidthM;
      if (outA || outB) {
        let loser: DuelSide;
        if (outA && outB) {
          const ea = Math.abs(fa.x) - this.halfWidthM;
          const eb = Math.abs(fb.x) - this.halfWidthM;
          loser = ea > eb ? 'a' : eb > ea ? 'b' : OTHER[this.judge()];
        } else loser = outA ? 'a' : 'b';
        this.emit({ kind: 'ringOut', side: loser });
        this.finish(OTHER[loser], 'ringOut', t);
        return;
      }
    }
    if (t >= this.timeLimitMs) this.finish(this.judge(), 'timeout', t);
  }

  /** Judged on remaining HP share, then stamina share, then a coin. */
  private judge(): DuelSide {
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const ha = fa.hp / fa.p.hpMax;
    const hb = fb.hp / fb.p.hpMax;
    if (ha !== hb) return ha > hb ? 'a' : 'b';
    const sa = fa.stamina / fa.p.staminaMax;
    const sb = fb.stamina / fb.p.staminaMax;
    if (sa !== sb) return sa > sb ? 'a' : 'b';
    return this.coin();
  }

  private coin(): DuelSide {
    return this.rng.chance(0.5) ? 'a' : 'b';
  }

  private finish(winner: DuelSide, reason: Exclude<DuelEndReason, 'auto'>, t: number): void {
    const fa = this.fighters.a;
    const fb = this.fighters.b;
    const pct = (f: DuelFighterState) => clamp((Math.max(0, f.hp) / f.p.hpMax) * 100, 0, 100);
    this.result = {
      winner,
      reason,
      durationS: t / 1000,
      hpPct: { a: pct(fa), b: pct(fb) },
      tauntsLanded: { a: fa.tauntsLanded, b: fb.tauntsLanded },
    };
  }
}
