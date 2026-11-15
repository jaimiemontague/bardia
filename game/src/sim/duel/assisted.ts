/**
 * Assisted Mode (design §14.7): a turn-based duel of secret exchanges. Each exchange both fighters
 * pick one of High Strike, Low Strike, Guard High, Guard Low, Bash, Feint; the resolution matrix:
 *
 *   - a Strike beats a wrong-height Guard (×0.7 damage), beats Bash (×1.2) and Feint (×1.0);
 *   - a same-height Guard blocks a Strike (the shield takes it; no shield: the haft lets some through);
 *   - Bash beats Guard (stagger: the defender can't Guard next exchange) and beats Feint;
 *   - Feint beats Guard (the feinter gains Initiative and sees their category next exchange);
 *   - Strike vs Strike: both hit, the faster fighter (Agility + Melee) first;
 *   - Bash vs Bash: both stagger.
 *
 * Tells: before choosing, the human reads a flavour line hinting at the AI's intent with accuracy
 * `50% + 5% × (yourWits − theirWits + 4)` clamped 40–90%. Stats scale damage exactly as in real time
 * (stats.ts `strikeDamage`, light-strike multiplier), weapon specials included (sword combo, axe
 * hook, spear/hammer armour piercing, hammer stagger, two-handed ×2 against shields); an exchange
 * being a fixed slice of time without footwork, a blow is also scaled by a per-weapon factor that
 * folds in tempo and reach (tunables `assisted.weaponDamageMult`). Pure and
 * deterministic: seeded from the duel seed (sub-streams 'assisted', 'assisted:ai:a', 'assisted:ai:b').
 */
import type { DifficultyId } from '@content/schemas/ids';
import type { Tunables as DuelTunables } from '@content/schemas/tunables/duel';
import { clamp } from '@sim/core/dmath';
import { Rng } from '@sim/core/rng';
import type { DuelSetup } from '@sim/core/state';
import { otherSide } from './glyph';
import { strikeDamage, type DuelEngineContent } from './stats';
import {
  ASSISTED_CHOICES,
  type AssistedCategory,
  type AssistedChoice,
  type DuelEndReason,
  type DuelFightSummary,
  type DuelistProfile,
  type DuelSide,
  type StrikeHeight,
} from './types';

/** What a fighter did in an exchange ('yield' = asked for quarter; 'open' = a refused plea left them kneeling). */
export type AssistedAct = AssistedChoice | 'yield' | 'open';

/** The category of a choice (§14.7 Initiative reveals it). */
export function choiceCategory(choice: AssistedChoice): AssistedCategory {
  switch (choice) {
    case 'highStrike':
    case 'lowStrike':
      return 'strike';
    case 'guardHigh':
    case 'guardLow':
      return 'guard';
    case 'bash':
      return 'bash';
    case 'feint':
      return 'feint';
  }
}

function heightOf(choice: AssistedAct): StrikeHeight | null {
  if (choice === 'highStrike' || choice === 'guardHigh') return 'high';
  if (choice === 'lowStrike' || choice === 'guardLow') return 'low';
  return null;
}

/** §14.7 tell accuracy: `tellBase + tellPerWits × (yourWits − theirWits + tellWitsOffset)`, clamped. */
export function tellAccuracy(assisted: DuelEngineContent['balance']['duel']['assisted'], yourWits: number, theirWits: number): number {
  return clamp(assisted.tellBase + assisted.tellPerWits * (yourWits - theirWits + assisted.tellWitsOffset), assisted.tellMin, assisted.tellMax);
}

export interface AssistedFighterView {
  charId: DuelistProfile['charId'];
  name: string;
  weapon: DuelistProfile['weapon'];
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  shieldHp: number;
  shieldMax: number;
  shieldsLeft: number;
  /** Cannot Guard this exchange (staggered by a bash, an axe hook or a hammer blow). */
  staggered: boolean;
  exhausted: boolean;
  combo: number;
}

/** What the human sees before choosing. */
export interface AssistedPrompt {
  exchange: number;
  side: DuelSide;
  /** Allowed choices this exchange (a staggered fighter cannot Guard). */
  options: AssistedChoice[];
  /** May ask for quarter now. */
  canYield: boolean;
  /**
   * Flavour-line tell about the AI's intent (§14.7); null when Initiative decides instead. `vars`
   * feed the ICU string (`sex` selects the pronoun: 'male' | 'female' | 'other').
   */
  tell: { key: string; vars: { sex: string }; hint: AssistedChoice; accuracy: number } | null;
  /** The AI's category, when the human holds the Initiative. */
  revealed: AssistedCategory | null;
  /** Who holds the Initiative this exchange. */
  initiative: DuelSide | null;
  fighters: { a: AssistedFighterView; b: AssistedFighterView };
}

export interface AssistedEvent {
  kind:
    | 'hit'
    | 'wrongGuard'
    | 'block'
    | 'haftBlock'
    | 'shieldBreak'
    | 'shieldSwap'
    | 'hook'
    | 'bashStagger'
    | 'mutualStagger'
    | 'hammerStagger'
    | 'combo'
    | 'initiative'
    | 'exhausted'
    | 'nothing'
    | 'firstBlood'
    | 'down'
    | 'yieldAsked'
    | 'quarterGranted'
    | 'quarterRefused';
  /** The acting fighter (the striker for hits). */
  side: DuelSide;
  amount?: number;
}

export interface AssistedExchangeReport {
  exchange: number;
  choices: { a: AssistedAct; b: AssistedAct };
  events: AssistedEvent[];
  fighters: { a: AssistedFighterView; b: AssistedFighterView };
  /** A plea for quarter waiting for the human (answer with `answerQuarter`). */
  quarter: { asker: DuelSide; decider: DuelSide } | null;
  outcome: DuelFightSummary | null;
}

interface FighterRt {
  side: DuelSide;
  p: DuelistProfile;
  human: boolean;
  hp: number;
  stamina: number;
  shieldHp: number;
  shieldsLeft: number;
  staggered: boolean;
  staggerNext: boolean;
  exhaustedLeft: number;
  combo: number;
  yieldCooldown: number;
  initiativeNext: boolean;
  /** Counts of the opponent's choices (AI adaptation). */
  seen: Record<AssistedChoice, number>;
}

interface Blow {
  atk: FighterRt;
  def: FighterRt;
  mult: number;
  kind: 'clean' | 'wrongGuard' | 'blocked';
}

export interface AssistedOptions {
  /** The human-controlled side (null/absent: AI vs AI). */
  humanSide?: DuelSide | null;
  difficulty?: DifficultyId;
}

const emptySeen = (): Record<AssistedChoice, number> => ({ highStrike: 0, lowStrike: 0, guardHigh: 0, guardLow: 0, bash: 0, feint: 0 });

export class AssistedDuel {
  readonly setup: DuelSetup;
  private readonly cfg: DuelTunables;
  private readonly bal: DuelEngineContent['balance'];
  private readonly rng: Rng;
  private readonly aiRng: Record<DuelSide, Rng>;
  private readonly f: { a: FighterRt; b: FighterRt };
  private readonly humanSide: DuelSide | null;
  private readonly adapt: number;
  private exchangeNo = 0;
  private initiative: DuelSide | null = null;
  private committed: AssistedChoice | null = null;
  private plea: { asker: DuelSide; decider: DuelSide } | null = null;
  private result: DuelFightSummary | null = null;

  constructor(setup: DuelSetup, content: DuelEngineContent, opts: AssistedOptions = {}) {
    const profiles = setup.profiles;
    if (!profiles) throw new RangeError(`duel ${setup.id}: setup has no fighter profiles`);
    this.setup = setup;
    this.cfg = content.tunables.duel;
    this.bal = content.balance;
    this.humanSide = opts.humanSide ?? null;
    this.rng = Rng.derive(setup.seed, 'assisted');
    this.aiRng = { a: Rng.derive(setup.seed, 'assisted:ai:a'), b: Rng.derive(setup.seed, 'assisted:ai:b') };
    this.adapt = this.cfg.ai.difficulty[opts.difficulty ?? setup.difficulty ?? 'raider'].assistedAdapt;
    const make = (side: DuelSide, p: DuelistProfile): FighterRt => ({
      side,
      p,
      human: this.humanSide === side,
      hp: p.hpStart,
      stamina: p.staminaMax,
      shieldHp: p.shields > 0 ? p.shieldMax : 0,
      shieldsLeft: p.shields,
      staggered: false,
      staggerNext: false,
      exhaustedLeft: 0,
      combo: 0,
      yieldCooldown: 0,
      initiativeNext: false,
      seen: emptySeen(),
    });
    this.f = { a: make('a', profiles.a), b: make('b', profiles.b) };
  }

  get exchange(): number {
    return this.exchangeNo;
  }
  get ended(): boolean {
    return this.result !== null;
  }
  get outcome(): DuelFightSummary | null {
    return this.result;
  }
  /** A plea for quarter waiting for the human decider. */
  get quarter(): { asker: DuelSide; decider: DuelSide } | null {
    return this.plea;
  }

  private hasShield(f: FighterRt): boolean {
    return f.p.shieldMax > 0 && f.shieldsLeft > 0 && f.shieldHp > 0;
  }

  /** Choices `side` may make this exchange. */
  options(side: DuelSide): AssistedChoice[] {
    const f = this.f[side];
    return ASSISTED_CHOICES.filter((c) => {
      if (f.staggered && choiceCategory(c) === 'guard') return false;
      if (c === 'bash' && !this.hasShield(f)) return false;
      return true;
    });
  }

  private view(f: FighterRt): AssistedFighterView {
    return {
      charId: f.p.charId,
      name: f.p.name,
      weapon: f.p.weapon,
      hp: Math.max(0, f.hp),
      hpMax: f.p.hpMax,
      stamina: f.stamina,
      staminaMax: f.p.staminaMax,
      shieldHp: f.shieldHp,
      shieldMax: f.p.shieldMax,
      shieldsLeft: f.shieldsLeft,
      staggered: f.staggered,
      exhausted: f.exhaustedLeft > 0,
      combo: f.combo,
    };
  }

  /**
   * The prompt for the human side. Commits the AI's choice first unless the AI holds the Initiative
   * (then it chooses after seeing the human's category).
   */
  prompt(): AssistedPrompt {
    const human = this.requireHuman();
    if (this.result) throw new Error('AssistedDuel.prompt: the duel is over');
    if (this.plea) throw new Error('AssistedDuel.prompt: answer the plea for quarter first');
    const ai = otherSide(human);
    let tell: AssistedPrompt['tell'] = null;
    let revealed: AssistedCategory | null = null;
    if (this.initiative !== ai) {
      this.committed ??= this.aiChoose(ai, null);
      if (this.initiative === human) revealed = choiceCategory(this.committed);
      else tell = this.makeTell(human, ai, this.committed);
    }
    return {
      exchange: this.exchangeNo + 1,
      side: human,
      options: this.options(human),
      canYield: this.f[human].yieldCooldown <= 0,
      tell,
      revealed,
      initiative: this.initiative,
      fighters: { a: this.view(this.f.a), b: this.view(this.f.b) },
    };
  }

  private makeTell(viewer: DuelSide, actor: DuelSide, actual: AssistedChoice): NonNullable<AssistedPrompt['tell']> {
    const accuracy = tellAccuracy(this.bal.duel.assisted, this.f[viewer].p.wits, this.f[actor].p.wits);
    let hint = actual;
    if (!this.rng.chance(accuracy)) hint = this.rng.pick(ASSISTED_CHOICES.filter((c) => c !== actual));
    const variant = this.rng.int(0, this.cfg.assisted.tellVariants - 1);
    return { key: `duel.tell.${hint}.${variant}`, vars: { sex: this.f[actor].p.sex ?? 'other' }, hint, accuracy };
  }

  private requireHuman(): DuelSide {
    if (this.humanSide === null) throw new Error('AssistedDuel: no human side');
    return this.humanSide;
  }

  /** The human's choice for this exchange (call `prompt()` first). Resolves the exchange. */
  choose(choice: AssistedChoice | 'yield'): AssistedExchangeReport {
    const human = this.requireHuman();
    if (this.result) throw new Error('AssistedDuel.choose: the duel is over');
    if (this.plea) throw new Error('AssistedDuel.choose: answer the plea for quarter first');
    const ai = otherSide(human);
    if (choice === 'yield') {
      if (this.f[human].yieldCooldown > 0) throw new Error('AssistedDuel.choose: cannot ask for quarter again yet');
    } else if (!this.options(human).includes(choice)) {
      throw new Error(`AssistedDuel.choose: '${choice}' is not allowed this exchange`);
    }
    const aiChoice = this.committed ?? this.aiChoose(ai, choice === 'yield' ? null : choiceCategory(choice));
    this.committed = null;
    const choices: { a: AssistedAct; b: AssistedAct } = human === 'a' ? { a: choice, b: aiChoice } : { a: aiChoice, b: choice };
    return this.resolveExchange(choices);
  }

  /** AI vs AI: both sides choose and the exchange resolves. */
  autoExchange(): AssistedExchangeReport {
    if (this.humanSide !== null) throw new Error('AssistedDuel.autoExchange: a human side is set');
    if (this.result) throw new Error('AssistedDuel.autoExchange: the duel is over');
    // The side without Initiative commits first; the holder sees its category.
    let a: AssistedChoice | 'yield';
    let b: AssistedChoice | 'yield';
    if (this.initiative === 'a') {
      b = this.aiYieldOr('b', () => this.aiChoose('b', null));
      a = this.aiYieldOr('a', () => this.aiChoose('a', b === 'yield' ? null : choiceCategory(b)));
    } else {
      a = this.aiYieldOr('a', () => this.aiChoose('a', null));
      b = this.aiYieldOr('b', () => this.aiChoose('b', this.initiative === 'b' && a !== 'yield' ? choiceCategory(a) : null));
    }
    return this.resolveExchange({ a, b });
  }

  private aiYieldOr(side: DuelSide, choose: () => AssistedChoice): AssistedChoice | 'yield' {
    return this.aiWantsYield(side) ? 'yield' : choose();
  }

  /**
   * Resolves one exchange with both choices given (tutorials, scripted scenes, tests). The choices
   * must be allowed for their sides (a staggered fighter cannot Guard; no Bash without a shield).
   */
  scripted(a: AssistedChoice | 'yield', b: AssistedChoice | 'yield'): AssistedExchangeReport {
    if (this.result) throw new Error('AssistedDuel.scripted: the duel is over');
    if (this.plea) throw new Error('AssistedDuel.scripted: answer the plea for quarter first');
    for (const [side, c] of [['a', a], ['b', b]] as const) {
      if (c !== 'yield' && !this.options(side).includes(c)) throw new Error(`AssistedDuel.scripted: '${c}' is not allowed for ${side}`);
    }
    this.committed = null;
    return this.resolveExchange({ a, b });
  }

  /** AI vs AI convenience: exchanges until the duel ends. */
  run(): DuelFightSummary {
    let guard = 0;
    while (!this.result && guard++ < this.cfg.assisted.maxExchanges + 10) this.autoExchange();
    if (!this.result) throw new Error('AssistedDuel.run: no result');
    return this.result;
  }

  /** The human answers the AI's plea for quarter (death stakes). */
  answerQuarter(accept: boolean): AssistedExchangeReport {
    const plea = this.plea;
    if (!plea) throw new Error('AssistedDuel.answerQuarter: no plea pending');
    this.plea = null;
    const events: AssistedEvent[] = [];
    if (accept) {
      events.push({ kind: 'quarterGranted', side: plea.decider });
      this.finish(plea.decider, 'yield');
    } else {
      events.push({ kind: 'quarterRefused', side: plea.decider });
      this.f[plea.asker].yieldCooldown = this.cfg.assisted.yieldRetryExchanges;
    }
    return this.report({ a: 'open', b: 'open' }, events);
  }

  private aiWantsYield(side: DuelSide): boolean {
    const f = this.f[side];
    if (f.human || f.p.yieldHp <= 0 || f.yieldCooldown > 0) return false;
    if (f.hp / f.p.hpMax >= f.p.yieldHp) return false;
    return this.aiRng[side].chance(this.cfg.ai.yieldPerSecond);
  }

  // -------------------------------------------------------------------------------------------
  // AI choice

  /** The AI's choice; `known` = the opponent's category when this side holds the Initiative. */
  private aiChoose(side: DuelSide, known: AssistedCategory | null): AssistedChoice {
    const rng = this.aiRng[side];
    const me = this.f[side];
    const op = this.f[otherSide(side)];
    const allowed = this.options(side);
    const style = this.cfg.ai.styles[me.p.style];
    const seen = me.seen;
    const likelyGuard: StrikeHeight = seen.guardLow > seen.guardHigh ? 'low' : 'high';
    const likelyStrike: StrikeHeight = seen.lowStrike > seen.highStrike ? 'low' : 'high';
    const ok = (c: AssistedChoice) => allowed.includes(c);
    const strikeAt = (h: StrikeHeight): AssistedChoice => (h === 'high' ? 'highStrike' : 'lowStrike');
    const guardAt = (h: StrikeHeight): AssistedChoice => (h === 'high' ? 'guardHigh' : 'guardLow');
    const opposite = (h: StrikeHeight): StrikeHeight => (h === 'high' ? 'low' : 'high');
    if (known !== null) {
      // Initiative: answer the revealed category.
      let best: AssistedChoice;
      switch (known) {
        case 'strike':
          best = ok(guardAt(likelyStrike)) ? guardAt(likelyStrike) : strikeAt(likelyGuard);
          break;
        case 'guard':
          best = ok('bash') ? 'bash' : strikeAt(opposite(likelyGuard));
          break;
        case 'bash':
        case 'feint':
          best = strikeAt(rng.chance(style.lowShare) ? 'low' : 'high');
          break;
      }
      if (ok(best)) return best;
    }
    if (rng.chance(this.adapt)) {
      // Exploit the opponent's habit (its most frequent choice so far).
      let top: AssistedChoice | null = null;
      let topN = 0;
      for (const c of ASSISTED_CHOICES) {
        if (seen[c] > topN) {
          top = c;
          topN = seen[c];
        }
      }
      if (top !== null && topN >= 2) {
        const counters: Record<AssistedChoice, AssistedChoice[]> = {
          highStrike: ['guardHigh', 'bash'],
          lowStrike: ['guardLow', 'bash'],
          guardHigh: ['lowStrike', 'bash', 'feint'],
          guardLow: ['highStrike', 'bash', 'feint'],
          bash: ['highStrike', 'lowStrike'],
          feint: ['highStrike', 'lowStrike', 'bash'],
        };
        const pool = counters[top].filter(ok);
        if (pool.length > 0) return rng.pick(pool);
      }
    }
    const strikeW = style.light + style.heavy;
    const shieldBreaker = (this.bal.weapons[op.p.weapon].special['shieldDamageMult'] ?? 1) > 1 && this.hasShield(me);
    const guardW = (style.block + style.parry) * this.cfg.ai.assistedGuardBias * (shieldBreaker ? this.cfg.ai.shieldBreakerBlockMult : 1);
    const tired = me.stamina < this.bal.duel.moves.bash.stamina;
    const weights: Record<AssistedChoice, number> = {
      highStrike: strikeW * (1 - style.lowShare),
      lowStrike: strikeW * style.lowShare,
      guardHigh: guardW * (likelyStrike === 'high' ? 0.6 : 0.4) * (tired ? 1.5 : 1),
      guardLow: guardW * (likelyStrike === 'low' ? 0.6 : 0.4) * (tired ? 1.5 : 1),
      bash: style.bash * (op.staggered ? 0.3 : 1),
      feint: style.feint,
    };
    return rng.weighted(allowed, (c) => weights[c]) ?? (allowed[0] as AssistedChoice);
  }

  // -------------------------------------------------------------------------------------------
  // Resolution

  private cost(choice: AssistedAct): number {
    const moves = this.bal.duel.moves;
    switch (choice) {
      case 'highStrike':
      case 'lowStrike':
        return moves.light.stamina;
      case 'guardHigh':
      case 'guardLow':
        return this.cfg.assisted.guardStamina;
      case 'bash':
        return moves.bash.stamina;
      case 'feint':
        return moves.feint.stamina;
      default:
        return 0;
    }
  }

  private resolveExchange(choicesIn: { a: AssistedAct; b: AssistedAct }): AssistedExchangeReport {
    this.exchangeNo += 1;
    const events: AssistedEvent[] = [];
    const choices = { a: choicesIn.a, b: choicesIn.b };
    const fa = this.f.a;
    const fb = this.f.b;
    // Pleas for quarter come first.
    for (const side of ['a', 'b'] as const) {
      if (choices[side] !== 'yield') continue;
      events.push({ kind: 'yieldAsked', side });
      const decider = this.f[otherSide(side)];
      if (this.setup.stakes !== 'death') {
        events.push({ kind: 'quarterGranted', side: decider.side });
        this.finish(decider.side, 'yield');
        return this.report(choices, events);
      }
      if (decider.human) {
        // Only an AI can ask the human mid-exchange through autoExchange; a human decider answers via answerQuarter.
        this.plea = { asker: side, decider: decider.side };
        return this.report(choices, events);
      }
      if (this.rng.chance(decider.p.mercy)) {
        events.push({ kind: 'quarterGranted', side: decider.side });
        this.finish(decider.side, 'yield');
        return this.report(choices, events);
      }
      events.push({ kind: 'quarterRefused', side: decider.side });
      this.f[side].yieldCooldown = this.cfg.assisted.yieldRetryExchanges;
      choices[side] = 'open';
    }
    // Statuses for this exchange.
    const exhaustedNow = { a: fa.exhaustedLeft > 0, b: fb.exhaustedLeft > 0 };
    fa.initiativeNext = false;
    fb.initiativeNext = false;
    fa.staggerNext = false;
    fb.staggerNext = false;
    // Habits (AI adaptation): each side remembers what the other chose.
    if (choices.b !== 'open' && choices.b !== 'yield') fa.seen[choices.b] += 1;
    if (choices.a !== 'open' && choices.a !== 'yield') fb.seen[choices.a] += 1;
    // Stamina.
    const zeroed = { a: false, b: false };
    for (const side of ['a', 'b'] as const) {
      const f = this.f[side];
      const c = this.cost(choices[side]);
      if (c > 0) {
        f.stamina -= c;
        if (f.stamina <= 0) {
          f.stamina = 0;
          zeroed[side] = true;
        }
      }
    }
    const blows = this.matrix(choices, events);
    this.applyBlows(blows, exhaustedNow, events);
    // End of exchange: regen, status roll-over.
    for (const side of ['a', 'b'] as const) {
      const f = this.f[side];
      if (exhaustedNow[side]) f.exhaustedLeft -= 1;
      if (zeroed[side] && f.exhaustedLeft <= 0) {
        f.exhaustedLeft = this.cfg.assisted.exhaustedExchanges;
        events.push({ kind: 'exhausted', side });
      }
      f.stamina = Math.min(f.p.staminaMax, f.stamina + this.cfg.assisted.regenPerExchange);
      f.staggered = f.staggerNext;
      if (f.yieldCooldown > 0) f.yieldCooldown -= 1;
      if (f.p.shieldMax > 0 && f.shieldHp <= 0 && f.shieldsLeft > 0) {
        f.shieldHp = f.p.shieldMax;
        events.push({ kind: 'shieldSwap', side });
      }
    }
    this.initiative = fa.initiativeNext ? 'a' : fb.initiativeNext ? 'b' : null;
    if (!this.result) this.checkEnd();
    // An AI below its nerve may ask for quarter after the exchange (the human decides in death duels).
    if (!this.result && this.humanSide !== null) {
      const ai = otherSide(this.humanSide);
      if (this.aiWantsYield(ai)) {
        events.push({ kind: 'yieldAsked', side: ai });
        if (this.setup.stakes !== 'death') {
          events.push({ kind: 'quarterGranted', side: this.humanSide });
          this.finish(this.humanSide, 'yield');
        } else {
          this.plea = { asker: ai, decider: this.humanSide };
        }
      }
    }
    return this.report(choices, events);
  }

  /** The §14.7 matrix: statuses (stagger, initiative) and the blows to land. */
  private matrix(choices: { a: AssistedAct; b: AssistedAct }, events: AssistedEvent[]): Blow[] {
    const blows: Blow[] = [];
    const ma = { wrongGuard: this.bal.duel.assisted.wrongGuardMult, vsBash: this.bal.duel.assisted.strikeVsBashMult };
    const one = (atkSide: DuelSide): void => {
      const defSide = otherSide(atkSide);
      const atk = this.f[atkSide];
      const def = this.f[defSide];
      const mine = choices[atkSide];
      const theirs = choices[defSide];
      const myCat = mine === 'open' || mine === 'yield' ? 'open' : choiceCategory(mine);
      const theirCat = theirs === 'open' || theirs === 'yield' ? 'open' : choiceCategory(theirs);
      if (myCat === 'strike') {
        if (theirCat === 'guard') {
          if (heightOf(theirs) === heightOf(mine)) blows.push({ atk, def, mult: 1, kind: 'blocked' });
          else blows.push({ atk, def, mult: ma.wrongGuard, kind: 'wrongGuard' });
        } else if (theirCat === 'bash') blows.push({ atk, def, mult: ma.vsBash, kind: 'clean' });
        else blows.push({ atk, def, mult: 1, kind: 'clean' }); // strike, feint, open
      } else if (myCat === 'bash') {
        if (theirCat === 'guard') {
          def.staggerNext = true;
          events.push({ kind: 'bashStagger', side: atkSide });
          if (this.hasShield(def)) this.hitShield(def, this.bal.duel.moves.bash.shieldDamage, 1, events);
        } else if (theirCat === 'bash') {
          if (atkSide === 'a') {
            atk.staggerNext = true;
            def.staggerNext = true;
            events.push({ kind: 'mutualStagger', side: 'a' });
          }
        } else if (theirCat === 'feint' || theirCat === 'open') {
          def.staggerNext = true;
          events.push({ kind: 'bashStagger', side: atkSide });
        }
      } else if (myCat === 'feint') {
        if (theirCat === 'guard') {
          atk.initiativeNext = true;
          events.push({ kind: 'initiative', side: atkSide });
        }
      }
    };
    one('a');
    one('b');
    if (blows.length === 0 && events.length === 0) events.push({ kind: 'nothing', side: 'a' });
    return blows;
  }

  /**
   * Strike vs Strike: the faster fighter (Agility + Melee; then the shorter wind-up) lands first and
   * a blow that ends the duel stops the other. Equal speed and wind-up: both land (simultaneous).
   */
  private order(blows: Blow[]): { blows: Blow[]; simultaneous: boolean } {
    if (blows.length < 2) return { blows, simultaneous: false };
    const [x, y] = blows as [Blow, Blow];
    const sx = x.atk.p.agility + x.atk.p.melee;
    const sy = y.atk.p.agility + y.atk.p.melee;
    if (sx !== sy) return { blows: sx > sy ? [x, y] : [y, x], simultaneous: false };
    if (x.atk.p.windupMs !== y.atk.p.windupMs) return { blows: x.atk.p.windupMs < y.atk.p.windupMs ? [x, y] : [y, x], simultaneous: false };
    return { blows, simultaneous: true };
  }

  private applyBlows(blows: Blow[], exhaustedNow: { a: boolean; b: boolean }, events: AssistedEvent[]): void {
    const { blows: ordered, simultaneous } = this.order(blows);
    const blood: { side: DuelSide; dmg: number }[] = [];
    const moves = this.bal.duel.moves;
    for (const blow of ordered) {
      const { atk, def } = blow;
      if (!simultaneous && (def.hp <= 0 || atk.hp <= 0 || (this.setup.stakes === 'firstBlood' && blood.length > 0))) break;
      const special = this.bal.weapons[atk.p.weapon].special;
      let mult = moves.light.damageMult * blow.mult * this.tempo(atk);
      if (exhaustedNow[atk.side]) mult *= this.bal.duel.exhaustion.damageMult;
      const raw = strikeDamage(atk.p, def.p, mult);
      let hpDmg = 0;
      if (blow.kind === 'blocked') {
        atk.combo = 0;
        const shieldMult = special['shieldDamageMult'] ?? 1;
        if (this.hasShield(def)) {
          hpDmg = this.hitShield(def, raw * shieldMult, shieldMult, events);
          events.push({ kind: 'block', side: atk.side, amount: hpDmg });
          if (special['hookDisableBlockS'] !== undefined && this.rng.chance(this.cfg.assisted.hookChance)) {
            def.staggerNext = true;
            events.push({ kind: 'hook', side: atk.side });
          }
        } else {
          hpDmg = raw * (1 - this.cfg.haftBlock.share);
          events.push({ kind: 'haftBlock', side: atk.side, amount: hpDmg });
        }
        const drain = raw * this.cfg.blockHitStaminaPerDamage;
        def.stamina = Math.max(0, def.stamina - drain);
        const blockStagger = special['staggerChance'];
        if (blockStagger !== undefined && this.cfg.staggerOnBlock && this.rng.chance(blockStagger)) {
          def.staggerNext = true;
          events.push({ kind: 'hammerStagger', side: atk.side });
        }
      } else {
        let dmg = raw;
        const combo = special['comboThirdHitMult'];
        if (combo !== undefined && atk.combo + 1 >= 3) {
          dmg *= combo;
          atk.combo = 0;
          events.push({ kind: 'combo', side: atk.side });
        } else {
          atk.combo += 1;
        }
        def.combo = 0;
        hpDmg = dmg;
        events.push({ kind: blow.kind === 'wrongGuard' ? 'wrongGuard' : 'hit', side: atk.side, amount: dmg });
        const stagger = special['staggerChance'];
        if (stagger !== undefined && this.rng.chance(stagger)) {
          def.staggerNext = true;
          events.push({ kind: 'hammerStagger', side: atk.side });
        }
      }
      if (hpDmg > 0) {
        def.hp -= hpDmg;
        if (hpDmg >= this.cfg.firstBloodMinDamage) blood.push({ side: atk.side, dmg: hpDmg });
        if (def.hp <= 0) events.push({ kind: 'down', side: def.side });
      }
    }
    if (this.setup.stakes === 'firstBlood' && blood.length > 0) {
      let maxA = 0;
      let maxB = 0;
      for (const b of blood) {
        if (b.side === 'a') maxA = Math.max(maxA, b.dmg);
        else maxB = Math.max(maxB, b.dmg);
      }
      const winner: DuelSide = maxA > maxB ? 'a' : maxB > maxA ? 'b' : this.judge();
      events.push({ kind: 'firstBlood', side: winner });
      this.finish(winner, 'firstBlood');
    }
  }

  /** Assisted-only weapon factor (tunables `assisted.weaponDamageMult`: tempo and reach folded in). */
  private tempo(f: FighterRt): number {
    return this.cfg.assisted.weaponDamageMult[f.p.weapon];
  }

  /** Shield damage; returns HP damage passing through when the shield is hewn apart. */
  private hitShield(f: FighterRt, dmg: number, mult: number, events: AssistedEvent[]): number {
    if (dmg <= 0 || !this.hasShield(f)) return 0;
    f.shieldHp -= dmg;
    if (f.shieldHp > 0) return 0;
    const overflow = -f.shieldHp / Math.max(1e-9, mult);
    f.shieldHp = 0;
    f.shieldsLeft -= 1;
    events.push({ kind: 'shieldBreak', side: f.side });
    return overflow;
  }

  private checkEnd(): void {
    const fa = this.f.a;
    const fb = this.f.b;
    if (fa.hp <= 0 || fb.hp <= 0) {
      let winner: DuelSide;
      if (fa.hp <= 0 && fb.hp <= 0) winner = fa.hp > fb.hp ? 'a' : fb.hp > fa.hp ? 'b' : this.coin();
      else winner = fa.hp <= 0 ? 'b' : 'a';
      this.finish(winner, 'down');
      return;
    }
    if (this.exchangeNo >= this.cfg.assisted.maxExchanges) this.finish(this.judge(), 'timeout');
  }

  private judge(): DuelSide {
    const fa = this.f.a;
    const fb = this.f.b;
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

  private finish(winner: DuelSide, reason: Exclude<DuelEndReason, 'auto' | 'ringOut'>): void {
    if (this.result) return;
    const pct = (f: FighterRt) => clamp((Math.max(0, f.hp) / f.p.hpMax) * 100, 0, 100);
    this.result = {
      winner,
      reason,
      durationS: this.exchangeNo * this.cfg.assisted.exchangeSeconds,
      hpPct: { a: pct(this.f.a), b: pct(this.f.b) },
      tauntsLanded: { a: 0, b: 0 },
      exchanges: this.exchangeNo,
    };
  }

  private report(choices: { a: AssistedAct; b: AssistedAct }, events: AssistedEvent[]): AssistedExchangeReport {
    return {
      exchange: this.exchangeNo,
      choices,
      events,
      fighters: { a: this.view(this.f.a), b: this.view(this.f.b) },
      quarter: this.plea ? { ...this.plea } : null,
      outcome: this.result ? { ...this.result, hpPct: { ...this.result.hpPct }, tauntsLanded: { ...this.result.tauntsLanded } } : null,
    };
  }
}
