/**
 * Real-time duel AI (design §14, ADR-003: difficulty changes reaction time and coordination, never
 * stats). Four personalities — Aggressive, Defensive, Tricky, Brute — weight the same options
 * differently (tunables `ai.styles`); the game difficulty sets reaction time, jitter, timing error,
 * misreads and mistakes (tunables `ai.difficulty`).
 *
 * Perception is honest: the AI sees an opponent's wind-up pose (and so its kind: strike, heavy or
 * bash) one reaction time after it starts, and its height only through the §14.6 intent-glyph rule
 * (its Wits against the opponent's), so a low-Wits AI must guess. A feint is noticed only one
 * reaction time after the strike is cancelled, which is what makes feints bait parries. All random
 * choices use the AI's own `Rng` (derived from the duel seed), so AI-vs-AI duels are reproducible.
 */
import type { DifficultyId } from '@content/schemas/ids';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import { clamp, dpow } from '@sim/core/dmath';
import type { Rng } from '@sim/core/rng';
import type { DuelAction, DuelEngine, DuelFighterState, DuelInput } from './engine';
import { glyphShowFraction, otherSide, type AttackKind } from './glyph';
import type { DuelEngineContent } from './stats';
import type { DuelSide, StrikeHeight } from './types';

type StyleParams = DuelTunables['ai']['styles']['aggressive'];
type DifficultyParams = DuelTunables['ai']['difficulty']['raider'];
type Response = 'parry' | 'block' | 'dodge' | 'counter' | 'none';

interface Threat {
  seq: number;
  kind: AttackKind;
  startAt: number;
  impactAt: number;
  /** When the wind-up pose is perceived (kind known). */
  seeAt: number;
  /** When the height is perceived through the glyph (Infinity: never). */
  heightAt: number;
  guess: StrikeHeight;
  read: StrikeHeight;
  response: Response | null;
  actAt: number;
  acted: boolean;
  holdGuard: boolean;
  /** Dodge direction chosen with the response (+1 forward when outreached). */
  dodgeDir: -1 | 1;
  /** The abort-own-strike reflex was rolled for this threat. */
  abortChecked?: boolean;
  /** When the AI notices the strike was cancelled (feint/interrupt); Infinity while it is live. */
  cancelSeenAt: number;
}

interface Opening {
  seq: number;
  seeAt: number;
  /** Strike a foe kneeling for quarter (only in duels to the death, and only the merciless). */
  strikeYielder: boolean;
}

const VULNERABLE: readonly DuelAction[] = ['recover', 'stagger', 'parryWhiff', 'taunt', 'yield', 'swap'];

function opposite(h: StrikeHeight): StrikeHeight {
  return h === 'high' ? 'low' : 'high';
}

/**
 * The difficulty's AI parameters adjusted by the fighter's own combat skill (tunables `ai.skill`):
 * a practised fighter (Melee above the pivot) anticipates faster, makes fewer mistakes, times
 * parries and dodges more tightly and aborts doomed strikes more often; a sharp one (Wits) misreads
 * heights less. The game
 * difficulty still sets the base reaction time (ADR-003); stats never change with difficulty.
 */
export function skilledDifficulty(cfg: DuelTunables, base: DifficultyParams, melee: number, wits: number, witsPivot: number): DifficultyParams {
  const k = cfg.ai.skill;
  const dm = melee - k.meleePivot;
  const dw = wits - witsPivot;
  // Compounding per point, clamped to [multMin, multMax] of the base (a Melee-10 legend stays human).
  const scale = (v: number, pctPerPoint: number, d: number) => v * clamp(dpow(1 - clamp(pctPerPoint, -90, 90) / 100, d), k.multMin, k.multMax);
  return {
    ...base,
    reactionMs: scale(base.reactionMs, k.reactionPctPerMelee, dm),
    reactionJitterMs: scale(base.reactionJitterMs, k.reactionPctPerMelee, dm),
    mistakeChance: Math.min(1, scale(base.mistakeChance, k.mistakePctPerMelee, dm)),
    timingSdMs: scale(base.timingSdMs, k.timingPctPerMelee, dm),
    abortChance: Math.min(1, Math.max(0, base.abortChance + k.abortPerMelee * dm)),
    readError: Math.min(1, scale(base.readError, k.readErrorPctPerWits, dw)),
  };
}

/** One AI-driven fighter. Created by the engine for every AI side. */
export class DuelAi {
  private readonly style: StyleParams;
  private readonly diff: DifficultyParams;
  private readonly cfg: DuelTunables;
  private readonly bal: DuelEngineContent['balance'];
  private readonly other: DuelSide;
  private seenSeq = -1;
  private threat: Threat | null = null;
  private opening: Opening | null = null;
  private nextDecisionAt = 0;
  private feintAt = -1;
  private yielding = false;
  private stanceGuard = false;
  private stanceHeight: StrikeHeight = 'high';
  private lastRiposteSeen = -1;

  constructor(
    private readonly engine: DuelEngine,
    readonly side: DuelSide,
    content: DuelEngineContent,
    difficulty: DifficultyId,
    private readonly rng: Rng,
  ) {
    this.cfg = content.tunables.duel;
    this.bal = content.balance;
    const me = engine.fighter(side);
    this.style = this.cfg.ai.styles[me.p.style];
    this.diff = skilledDifficulty(this.cfg, this.cfg.ai.difficulty[difficulty], me.p.melee, me.p.wits, this.bal.character.attributePivot);
    this.other = otherSide(side);
    this.nextDecisionAt = this.diff.decisionMs * this.rng.range(0.4, 1.0);
  }

  private reaction(): number {
    return this.diff.reactionMs + this.rng.range(0, this.diff.reactionJitterMs);
  }

  /** The input for the next frame, decided from the state at time `t`. */
  think(t: number): DuelInput {
    const me = this.engine.fighter(this.side);
    const op = this.engine.fighter(this.other);
    const inp: DuelInput = { move: 0, guard: false, height: this.stanceHeight };
    if (me.action === 'down') return inp;
    this.perceive(op, t);

    // Asking for quarter (NPCs below their nerve threshold, §14.5 yield).
    if (this.yielding || this.wantsToYield(me, t)) {
      this.yielding = t >= me.yieldCooldownUntil;
      if (this.yielding) return { yieldHeld: true };
    }

    const canAct = me.action === 'idle' || me.action === 'guard';
    const gap = this.engine.gap;
    const inReach = gap <= me.p.reachM;

    // Feint follow-through: cancel the own wind-up at the planned moment.
    if (this.feintAt >= 0 && me.action === 'windup') {
      if (t >= this.feintAt) {
        inp.feint = true;
        this.feintAt = -1;
      }
      return inp;
    }
    if (me.action !== 'windup') this.feintAt = -1;

    const threat = this.threat;
    // Abort the own strike (a feint) when the foe's perceived blow will land first.
    if (
      threat &&
      me.action === 'windup' &&
      me.attack !== 'bash' &&
      threat.abortChecked !== true &&
      t >= threat.seeAt &&
      t < threat.cancelSeenAt &&
      threat.impactAt < me.impactAt &&
      !this.engine.poised(me) &&
      me.stamina - this.bal.duel.moves.feint.stamina >= me.p.staminaMax * this.cfg.ai.abortStaminaShare
    ) {
      threat.abortChecked = true;
      if (this.rng.chance(this.diff.abortChance)) {
        inp.feint = true;
        return inp;
      }
    }

    // Defence against a perceived attack.
    if (threat && t >= threat.seeAt && t < threat.cancelSeenAt && t <= threat.impactAt + 40) {
      if (threat.response === null) this.decideResponse(threat, me, t);
      if (this.executeResponse(threat, me, inp, t, canAct, inReach)) return inp;
    }

    if (!canAct) return inp;

    // A foe kneeling for quarter is left alone unless this is a duel to the death and we are merciless.
    if (op.action === 'yield' && !(this.opening?.seq === op.actionSeq && this.opening.strikeYielder)) {
      inp.guard = true;
      return inp;
    }

    // Riposte after a successful parry (§14.5: ×1.5 within 600 ms); step in first if out of reach.
    if (me.riposteUntil >= t && this.lastRiposteSeen !== me.riposteUntil) {
      if (inReach) {
        this.lastRiposteSeen = me.riposteUntil;
        inp.attack = 'light';
        inp.height = op.action === 'guard' ? opposite(op.guardHeight) : this.rng.chance(this.style.lowShare) ? 'low' : 'high';
        return inp;
      }
      inp.move = 1;
      return inp;
    }

    // Punish an opening (recovery, stagger, a whiffed parry, a taunt, a plea, a shield swap).
    const open = this.opening;
    if (open && open.seq === op.actionSeq && op.action === 'yield' && !open.strikeYielder) open.seq = -1;
    if (open && open.seq === op.actionSeq && t >= open.seeAt && VULNERABLE.includes(op.action)) {
      const left = op.action === 'taunt' || op.action === 'yield' ? Infinity : op.actionEnd - t;
      const heavyWindup = me.p.windupMs * this.bal.duel.moves.heavy.windupMult;
      if (!inReach) {
        // Close in while the foe is busy (how a shorter weapon gets inside a longer one).
        const walkMs = ((gap - me.p.reachM) / this.cfg.walkSpeedMps) * 1000;
        if (left > walkMs + me.p.windupMs * 0.6) {
          inp.move = 1;
          return inp;
        }
      } else if (left > me.p.windupMs * 0.6) {
        this.opening = null;
        if (left > heavyWindup + 40 && me.stamina >= this.bal.duel.moves.heavy.stamina && this.rng.chance(this.style.heavy / (this.style.heavy + this.style.light))) {
          inp.attack = 'heavy';
        } else {
          inp.attack = 'light';
          inp.height = this.rng.chance(this.style.lowShare) ? 'low' : 'high';
        }
        return inp;
      }
    }

    // Offence and footwork.
    const staminaShare = me.stamina / me.p.staminaMax;
    const tired = staminaShare < this.style.minStaminaShare;
    if (t >= this.nextDecisionAt) {
      this.nextDecisionAt = t + (this.diff.decisionMs / this.style.attackRate) * this.rng.range(0.6, 1.4);
      this.stanceGuard = this.rng.chance(this.style.idleGuard);
      this.stanceHeight = this.rng.chance(this.style.lowShare) ? 'low' : 'high';
      if (!tired && inReach && this.attackChoice(me, op, inp, t)) return inp;
      if (!inReach && gap > op.p.reachM + this.cfg.ai.tauntSafeGapM && this.rng.chance(this.style.taunt * this.cfg.ai.tauntChanceMult)) {
        inp.taunt = true;
        return inp;
      }
    }
    // Footwork: hold a distance inside the own reach (so a strike can land), or back off when tired.
    const slack = this.cfg.ai.rangeSlackM;
    const minGap = this.cfg.minGapM + slack;
    const strikeGap = Math.max(minGap, me.p.reachM - slack);
    const desired = tired ? Math.max(op.p.reachM + this.cfg.ai.retreatMarginM, minGap) : Math.min(Math.max(me.p.reachM * this.style.rangeMult, minGap), strikeGap);
    const approachAt = tired ? desired + slack : Math.min(desired + slack, me.p.reachM);
    if (gap > approachAt) inp.move = 1;
    else if (gap < desired - slack * 2) inp.move = -1;
    if (inp.move === -1 && this.nearEdgeBehind(me)) inp.move = 0;
    if (this.stanceGuard && gap <= op.p.reachM + this.cfg.ai.rangeSlackM && me.blockDisabledUntil <= t) {
      inp.guard = true;
      inp.height = this.stanceHeight;
    }
    return inp;
  }

  private nearEdgeBehind(me: Readonly<DuelFighterState>): boolean {
    if (!this.engine.ringOut) return false;
    const behind = me.facing === 1 ? me.x + this.engine.halfWidthM : this.engine.halfWidthM - me.x;
    return behind < this.cfg.ai.edgeMarginM;
  }

  private wantsToYield(me: Readonly<DuelFighterState>, t: number): boolean {
    if (me.p.yieldHp <= 0 || t < me.yieldCooldownUntil) return false;
    if (me.hp / me.p.hpMax >= me.p.yieldHp) return false;
    return this.rng.chance((this.cfg.ai.yieldPerSecond * this.engine.dtMs) / 1000);
  }

  private perceive(op: Readonly<DuelFighterState>, t: number): void {
    if (op.actionSeq === this.seenSeq) return;
    this.seenSeq = op.actionSeq;
    if (op.action === 'windup' && op.attack !== null) {
      const reaction = this.reaction();
      const frac = glyphShowFraction(this.engine.fighter(this.side).p.wits, op.p.wits, this.bal.duel.glyphWitsLead);
      const span = op.impactAt - op.actionStart;
      const guess: StrikeHeight = op.attack === 'heavy' ? 'high' : this.rng.chance(this.style.lowShare) ? 'low' : 'high';
      const misread = this.rng.chance(this.diff.readError);
      this.threat = {
        seq: op.actionSeq,
        kind: op.attack,
        startAt: op.actionStart,
        impactAt: op.impactAt,
        seeAt: op.actionStart + reaction,
        heightAt: frac === null ? Infinity : op.actionStart + frac * span + reaction,
        guess,
        read: misread ? opposite(op.height) : op.height,
        response: null,
        actAt: Infinity,
        acted: false,
        holdGuard: false,
        dodgeDir: -1,
        cancelSeenAt: Infinity,
      };
      return;
    }
    if (this.threat && this.threat.cancelSeenAt === Infinity && t < this.threat.impactAt) {
      this.threat.cancelSeenAt = t + this.reaction();
    }
    if (VULNERABLE.includes(op.action)) {
      const strikeYielder = op.action === 'yield' && this.engine.setup.stakes === 'death' && !this.rng.chance(this.engine.fighter(this.side).p.mercy);
      this.opening = { seq: op.actionSeq, seeAt: op.actionStart + this.reaction(), strikeYielder };
    }
  }

  private decideResponse(threat: Threat, me: Readonly<DuelFighterState>, t: number): void {
    if (this.rng.chance(this.diff.mistakeChance)) {
      threat.response = 'none';
      return;
    }
    const s = this.style;
    const moves = this.bal.duel.moves;
    const exhausted = t < me.exhaustedUntil;
    const canBlock = me.blockDisabledUntil <= threat.impactAt;
    const canDodge = me.stamina > 0;
    const isBash = threat.kind === 'bash';
    // Outreached (the blow comes from beyond the own reach): a counter cannot land, but a forward
    // dodge slips the blow and closes the distance.
    const gap = this.engine.gap;
    const outreached = gap > me.p.reachM;
    // A poised blow cannot be beaten to the punch (a counter would only trade into it).
    const foeWeapon = this.engine.fighter(this.other).p.weapon;
    const poised = threat.kind === 'heavy' ? this.cfg.poise.heavy : this.cfg.poise.weapons.includes(foeWeapon) && threat.kind !== 'bash';
    // Shield-breaking blows (two-handed axe) are better parried or dodged than blocked.
    const shieldBreaker = threat.kind !== 'bash' && (this.bal.weapons[foeWeapon].special['shieldDamageMult'] ?? 1) > 1;
    threat.dodgeDir = outreached && gap - this.cfg.dodge.distanceM * me.p.dodgeMult >= this.cfg.minGapM ? 1 : -1;
    const options: { r: Response; w: number }[] = [
      { r: 'parry', w: isBash || exhausted || me.stamina <= 0 ? 0 : s.parry },
      { r: 'block', w: canBlock ? s.block * (isBash ? 0.25 : 1) * (shieldBreaker ? this.cfg.ai.shieldBreakerBlockMult : 1) : 0 },
      { r: 'dodge', w: canDodge ? s.dodge * (isBash ? 1.5 : 1) * (outreached ? this.cfg.ai.outreachedDodgeMult : 1) : 0 },
      { r: 'counter', w: outreached || poised ? 0 : s.counter * (isBash ? 1.5 : 1) },
      { r: 'none', w: s.ignore },
    ];
    const pick = this.rng.weighted(options, (o) => o.w);
    threat.response = pick?.r ?? 'none';
    const sd = this.diff.timingSdMs;
    if (threat.response === 'parry') {
      threat.actAt = threat.impactAt - me.parryWindowMs * this.rng.range(0.2, 0.7) + this.rng.normal(0, sd);
      threat.holdGuard = this.rng.chance(s.parryHold);
    } else if (threat.response === 'dodge') {
      const invuln = moves.dodge.invulnMs * me.p.dodgeMult;
      threat.actAt = threat.impactAt - invuln * this.rng.range(0.25, 0.7) + this.rng.normal(0, sd);
    } else {
      threat.actAt = threat.seeAt;
    }
  }

  /** Returns true when the response fully determines this frame's input. */
  private executeResponse(threat: Threat, me: Readonly<DuelFighterState>, inp: DuelInput, t: number, canAct: boolean, inReach: boolean): boolean {
    const height = t >= threat.heightAt ? threat.read : threat.guess;
    switch (threat.response) {
      case 'parry':
        if (!threat.acted && t >= threat.actAt && canAct) {
          inp.parry = true;
          threat.acted = true;
        }
        if (threat.holdGuard) {
          inp.guard = true;
          inp.height = height;
        }
        return true;
      case 'block':
        inp.guard = true;
        inp.height = height;
        return true;
      case 'dodge':
        if (!threat.acted && t >= threat.actAt && canAct) {
          inp.dodge = threat.dodgeDir === 1 || this.nearEdgeBehind(me) ? 1 : -1;
          threat.acted = true;
        }
        return true;
      case 'counter': {
        if (threat.acted) return false;
        threat.acted = true;
        const remaining = threat.impactAt - t;
        if (canAct && inReach && me.p.windupMs < remaining - this.engine.dtMs * 2 && me.stamina > 0) {
          inp.attack = 'light';
          inp.height = this.rng.chance(this.style.lowShare) ? 'low' : 'high';
          return true;
        }
        // Too slow to beat the blow: fall back to the guard.
        threat.response = threat.kind === 'bash' ? 'dodge' : 'block';
        if (threat.response === 'dodge') threat.actAt = t;
        threat.acted = false;
        return this.executeResponse(threat, me, inp, t, canAct, inReach);
      }
      default:
        return false;
    }
  }

  private attackChoice(me: Readonly<DuelFighterState>, op: Readonly<DuelFighterState>, inp: DuelInput, t: number): boolean {
    const s = this.style;
    const moves = this.bal.duel.moves;
    const shield = me.p.shieldMax > 0 && me.shieldsLeft > 0 && me.shieldHp > 0;
    const opGuarding = op.action === 'guard';
    const options: { k: 'light' | 'heavy' | 'bash' | 'feint' | 'wait'; w: number }[] = [
      { k: 'light', w: me.stamina > 0 ? s.light : 0 },
      { k: 'heavy', w: me.stamina >= moves.heavy.stamina ? s.heavy * (opGuarding ? this.cfg.ai.heavyVsGuardMult : 1) : 0 },
      {
        k: 'bash',
        w: shield && me.stamina >= moves.bash.stamina && this.engine.gap <= this.cfg.bash.reachM ? s.bash * (opGuarding ? this.cfg.ai.bashVsGuardMult : this.cfg.ai.bashVsOpenMult) : 0,
      },
      { k: 'feint', w: me.stamina >= moves.light.stamina + moves.feint.stamina ? s.feint : 0 },
      { k: 'wait', w: s.wait },
    ];
    const pick = this.rng.weighted(options, (o) => o.w)?.k ?? 'wait';
    switch (pick) {
      case 'light':
        inp.attack = 'light';
        inp.height = opGuarding && this.rng.chance(s.exploitGuard) ? opposite(op.guardHeight) : this.rng.chance(s.lowShare) ? 'low' : 'high';
        return true;
      case 'heavy':
        inp.attack = 'heavy';
        return true;
      case 'bash':
        inp.bash = true;
        return true;
      case 'feint': {
        inp.attack = 'light';
        inp.height = this.rng.chance(0.5) ? 'low' : 'high';
        const [lo, hi] = this.cfg.ai.feintAt;
        this.feintAt = t + this.engine.dtMs + me.p.windupMs * this.rng.range(lo, hi);
        return true;
      }
      default:
        return false;
    }
  }
}
