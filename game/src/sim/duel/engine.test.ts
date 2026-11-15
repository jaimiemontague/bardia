import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { DuelEngine, glyphShowFraction, type DuelFx, type DuelInput } from './engine';
import { strikeDamage } from './stats';
import { testDuelSetup, type TestFighter } from './testing';
import type { DuelArena, DuelSide, DuelStakes } from './types';

const content = getContent();
const bal = content.balance;
const cfg = content.tunables.duel;

interface RtOpts {
  stakes?: DuelStakes;
  arena?: DuelArena;
  seed?: string;
  gap?: number;
  assist?: number;
}

/** Two scripted (human-driven) fighters standing `gap` metres apart. */
function rt(a: TestFighter = {}, b: TestFighter = {}, o: RtOpts = {}): DuelEngine {
  const setup = testDuelSetup(a, b, { stakes: o.stakes ?? 'death', arena: o.arena ?? 'hall', seed: o.seed ?? 'rt' });
  return new DuelEngine(setup, content, { ai: { a: false, b: false }, startGapM: o.gap ?? 1.2, parryAssistMs: o.assist ?? 0 });
}

type Inputs = Partial<Record<DuelSide, DuelInput>>;

/** Steps (collecting fx) until the next step's time reaches `tMs`. */
function stepTo(e: DuelEngine, tMs: number, inputs: Inputs = {}, fx: DuelFx[] = []): DuelFx[] {
  while ((e.frame + 1) * e.dtMs < tMs - 1e-9) {
    e.step(inputs);
    fx.push(...e.fx);
  }
  return fx;
}

function steps(e: DuelEngine, n: number, inputs: Inputs = {}, fx: DuelFx[] = []): DuelFx[] {
  for (let i = 0; i < n && !e.ended; i++) {
    e.step(inputs);
    fx.push(...e.fx);
  }
  return fx;
}

/** Steps until `done()` (max frames), collecting fx. */
function until(e: DuelEngine, done: () => boolean, inputs: Inputs = {}, max = 2000): DuelFx[] {
  const fx: DuelFx[] = [];
  for (let i = 0; i < max && !done(); i++) {
    e.step(inputs);
    fx.push(...e.fx);
  }
  return fx;
}

const kinds = (fx: DuelFx[]) => fx.map((f) => f.kind);

describe('timing windows: parry', () => {
  it('a parry pressed within the window before impact parries: attacker staggered, riposte window opens', () => {
    const e = rt();
    e.step({ a: { attack: 'light', height: 'high' } });
    const impact = e.fighter('a').impactAt;
    expect(e.fighter('b').parryWindowMs).toBe(244);
    stepTo(e, impact - 200);
    e.step({ b: { parry: true } });
    expect(e.fighter('b').action).toBe('parry');
    const fx = until(e, () => e.fighter('a').action !== 'windup');
    expect(kinds(fx)).toContain('parry');
    expect(e.fighter('a').action).toBe('stagger');
    expect(e.fighter('a').actionEnd - e.fighter('a').actionStart).toBe(cfg.parriedStaggerMs);
    expect(e.fighter('b').riposteUntil).toBeCloseTo(e.timeMs + bal.duel.riposteWindowMs, 6);
    expect(e.fighter('b').hp).toBe(e.fighter('b').p.hpStart);
  });

  it('a parry pressed too early expires (open for parryWhiffMs) and the blow lands', () => {
    const e = rt();
    e.step({ a: { attack: 'light', height: 'high' } });
    const impact = e.fighter('a').impactAt;
    stepTo(e, impact - (244 + 40));
    e.step({ b: { parry: true } });
    const fx = until(e, () => e.fighter('a').action !== 'windup');
    expect(kinds(fx)).toContain('hit');
    expect(kinds(fx)).not.toContain('parry');
    expect(e.fighter('b').hp).toBeLessThan(e.fighter('b').p.hpStart);
  });

  it('the accessibility extension widens a human parry window (up to +220 ms)', () => {
    const e = rt({}, {}, { assist: 500 });
    expect(e.fighter('b').parryWindowMs).toBe(244 + bal.duel.accessibilityParryMaxMs);
    e.step({ a: { attack: 'light', height: 'high' } });
    stepTo(e, e.fighter('a').impactAt - 400);
    e.step({ b: { parry: true } });
    const fx = until(e, () => e.fighter('a').action !== 'windup');
    expect(kinds(fx)).toContain('parry');
  });

  it('a riposte inside the window strikes ×1.5', () => {
    const e = rt();
    e.step({ a: { attack: 'light', height: 'high' } });
    stepTo(e, e.fighter('a').impactAt - 100);
    e.step({ b: { parry: true } });
    until(e, () => e.fighter('a').action !== 'windup');
    e.step({ b: { attack: 'light', height: 'high' } });
    expect(e.fighter('b').riposteStrike).toBe(true);
    const fx = until(e, () => e.fighter('b').action !== 'windup');
    const hit = fx.find((f) => f.kind === 'hit');
    expect(hit?.amount).toBeCloseTo(strikeDamage(e.fighter('b').p, e.fighter('a').p, 1.5), 9);
    expect(kinds(fx)).toContain('riposte');
  });

  it('an exhausted fighter cannot parry and strikes at half damage', () => {
    // Drain B with forward dodges (20 stamina each) until exhausted.
    const e = rt();
    until(e, () => e.timeMs < e.fighter('b').exhaustedUntil, { b: { dodge: 1 } }, 2000);
    expect(e.fighter('b').stamina).toBe(0);
    steps(e, 4);
    e.step({ a: { attack: 'light', height: 'high' } });
    stepTo(e, e.fighter('a').impactAt - 100);
    e.step({ b: { parry: true } });
    expect(e.fighter('b').action).not.toBe('parry');
    const fx = until(e, () => e.fighter('a').action !== 'windup');
    expect(kinds(fx)).toContain('hit');

    const tired = rt();
    until(tired, () => tired.timeMs < tired.fighter('a').exhaustedUntil, { a: { dodge: 1 } }, 2000);
    until(tired, () => tired.fighter('a').action === 'idle' && tired.fighter('a').stamina > 0);
    tired.step({ a: { attack: 'light', height: 'high' } });
    const hit = until(tired, () => tired.fighter('a').action !== 'windup').find((f) => f.kind === 'hit');
    expect(tired.timeMs).toBeLessThan(tired.fighter('a').exhaustedUntil);
    expect(hit?.amount).toBeCloseTo(strikeDamage(tired.fighter('a').p, tired.fighter('b').p, 1) * bal.duel.exhaustion.damageMult, 9);
  });
});

describe('timing windows: dodge, feint, heavy hold, input buffer', () => {
  it('a dodge gives 300 ms of invulnerability', () => {
    const e = rt();
    e.step({ a: { attack: 'light', height: 'high' } });
    stepTo(e, e.fighter('a').impactAt - 100);
    e.step({ b: { dodge: 1 } });
    expect(kinds(until(e, () => e.fighter('a').action !== 'windup'))).toContain('dodged');

    const late = rt();
    late.step({ a: { attack: 'light', height: 'high' } });
    stepTo(late, late.fighter('a').impactAt - (bal.duel.moves.dodge.invulnMs + 60));
    late.step({ b: { dodge: 1 } });
    expect(kinds(until(late, () => late.fighter('a').action !== 'windup'))).toContain('hit');
  });

  it('a feint cancels the wind-up and baits a parry into a whiff', () => {
    const e = rt();
    e.step({ a: { attack: 'light', height: 'high' } });
    steps(e, 2);
    e.step({ b: { parry: true } });
    steps(e, 3);
    e.step({ a: { feint: true } });
    expect(e.fighter('a').action).toBe('recover');
    expect(e.fighter('a').stamina).toBeCloseTo(100 - bal.duel.moves.light.stamina - bal.duel.moves.feint.stamina, 6);
    const fx = until(e, () => e.fighter('b').action !== 'parry');
    expect(kinds(fx)).not.toContain('parry');
    expect(e.fighter('b').action).toBe('parryWhiff');
  });

  it('holding the strike button 0.4 s makes a heavy blow (wind-up ×1.6); a tap makes a light one', () => {
    const e = rt();
    until(e, () => e.fighter('a').action === 'windup', { a: { attackHeld: true } }, 60);
    expect(e.fighter('a').attack).toBe('heavy');
    expect(e.fighter('a').impactAt - e.fighter('a').actionStart).toBeCloseTo(550 * bal.duel.moves.heavy.windupMult, 6);
    expect(e.timeMs).toBeGreaterThanOrEqual(bal.duel.moves.heavy.holdS * 1000);

    const tap = rt();
    steps(tap, 6, { a: { attackHeld: true, height: 'low' } });
    tap.step({ a: { attackHeld: false, height: 'low' } });
    expect(tap.fighter('a').attack).toBe('light');
    expect(tap.fighter('a').height).toBe('low');
  });

  it('an edge input pressed while busy is buffered for inputBufferMs', () => {
    const e = rt({}, {}, { gap: 3 });
    e.step({ a: { attack: 'light' } });
    until(e, () => e.fighter('a').action === 'recover');
    const end = e.fighter('a').actionEnd;
    stepTo(e, end - 50);
    e.step({ a: { attack: 'heavy' } });
    until(e, () => e.fighter('a').action !== 'recover');
    expect(e.fighter('a').action).toBe('windup');
    expect(e.fighter('a').attack).toBe('heavy');
  });
});

describe('blocks, bash, taunt and stamina', () => {
  it('a right-height block takes 80% on the shield; the wrong height only 30%', () => {
    const e = rt();
    const raw = strikeDamage(e.fighter('a').p, e.fighter('b').p, 1);
    e.step({ a: { attack: 'light', height: 'high' }, b: { guard: true, height: 'high' } });
    until(e, () => e.fighter('a').action !== 'windup', { b: { guard: true, height: 'high' } });
    expect(e.fighter('b').p.hpStart - e.fighter('b').hp).toBeCloseTo(raw * 0.2, 9);
    expect(e.fighter('b').p.shieldMax - e.fighter('b').shieldHp).toBeCloseTo(raw * 0.8, 9);

    const w = rt();
    w.step({ a: { attack: 'light', height: 'low' }, b: { guard: true, height: 'high' } });
    until(w, () => w.fighter('a').action !== 'windup', { b: { guard: true, height: 'high' } });
    expect(w.fighter('b').p.hpStart - w.fighter('b').hp).toBeCloseTo(raw * 0.7, 9);
  });

  it('a bash staggers a blocking foe for 600 ms and costs 15 Shield HP; an open foe is shoved', () => {
    const e = rt({}, {}, { gap: 1 });
    e.step({ a: { bash: true }, b: { guard: true } });
    until(e, () => e.fighter('a').action !== 'windup', { b: { guard: true } });
    expect(e.fighter('b').action).toBe('stagger');
    expect(e.fighter('b').actionEnd - e.fighter('b').actionStart).toBe(bal.duel.moves.bash.staggerMs);
    expect(e.fighter('b').p.shieldMax - e.fighter('b').shieldHp).toBe(bal.duel.moves.bash.shieldDamage);

    const out = rt({}, {}, { gap: 1.2 });
    out.step({ a: { bash: true }, b: { guard: true } });
    expect(kinds(until(out, () => out.fighter('a').action !== 'windup', { b: { guard: true } }))).toContain('whiff');
    const o = rt({}, {}, { gap: 1 });
    const x0 = o.fighter('b').x;
    o.step({ a: { bash: true } });
    const fx = until(o, () => o.fighter('a').action !== 'windup');
    expect(kinds(fx)).toContain('shove');
    expect(o.fighter('b').x - x0).toBeCloseTo(cfg.bash.pushM, 6);
  });

  it('a taunt held a full second unhit counts; a hit spoils it', () => {
    const e = rt({}, {}, { gap: 3 });
    e.step({ b: { taunt: true } });
    steps(e, 70);
    expect(e.fighter('b').tauntsLanded).toBe(1);
    const h = rt();
    h.step({ b: { taunt: true }, a: { attack: 'light' } });
    steps(h, 70);
    expect(h.fighter('b').tauntsLanded).toBe(0);
  });

  it('stamina regenerates 20/s idle and 8/s − 5/s while blocking', () => {
    const e = rt({}, {}, { gap: 3 });
    for (let i = 0; i < 3; i++) {
      until(e, () => e.fighter('a').action === 'idle');
      e.step({ a: { dodge: 1 } });
    }
    until(e, () => e.fighter('a').action === 'idle');
    const s0 = e.fighter('a').stamina;
    expect(s0).toBeLessThan(50);
    steps(e, 60);
    expect(e.fighter('a').stamina - s0).toBeCloseTo(bal.duel.staminaRegenIdle, 6);
    const s1 = e.fighter('a').stamina;
    steps(e, 60, { a: { guard: true } });
    expect(e.fighter('a').stamina - s1).toBeCloseTo(bal.duel.staminaRegenBlocking - bal.duel.moves.block.staminaPerS, 6);
  });

  it('a heavy blow on a guard breaks it about 40% of the time', () => {
    let breaks = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const e = rt({ weapon: 'spear' }, {}, { seed: `gb${i}` });
      e.step({ a: { attack: 'heavy' }, b: { guard: true } });
      const fx = until(e, () => e.fighter('a').action !== 'windup', { b: { guard: true } });
      if (kinds(fx).includes('guardBreak')) breaks += 1;
    }
    expect(breaks / n).toBeGreaterThan(0.32);
    expect(breaks / n).toBeLessThan(0.48);
  });
});

describe('§14.6 intent glyphs', () => {
  it('timing rule: start if Wits ≥ theirs + 2, mid wind-up if roughly equal, never if far lower', () => {
    expect(glyphShowFraction(6, 4, 2)).toBe(0);
    expect(glyphShowFraction(5, 4, 2)).toBe(0.5);
    expect(glyphShowFraction(4, 4, 2)).toBe(0.5);
    expect(glyphShowFraction(3, 4, 2)).toBe(0.5);
    expect(glyphShowFraction(2, 4, 2)).toBeNull();
  });

  it('the engine shows the glyph over the opponent accordingly', () => {
    const e = rt({ stats: { wits: 7 } }, { stats: { wits: 4 } });
    e.step({ b: { attack: 'light', height: 'low' } });
    expect(e.glyphFor('a')).toMatchObject({ kind: 'low' });
    e.step({ a: { attack: 'heavy' } });
    steps(e, 20);
    expect(e.glyphFor('b')).toBeNull();

    const eq = rt();
    eq.step({ a: { bash: true } });
    expect(eq.glyphFor('b')).toBeNull();
    const span = eq.fighter('a').impactAt - eq.fighter('a').actionStart;
    stepTo(eq, eq.fighter('a').actionStart + span / 2 + 1);
    eq.step();
    expect(eq.glyphFor('b')).toMatchObject({ kind: 'bash' });
  });

  it('Assisted-style readability shows every glyph from the start', () => {
    const setup = testDuelSetup({ stats: { wits: 1 } }, { stats: { wits: 9 } });
    const e = new DuelEngine(setup, content, { ai: { a: false, b: false }, alwaysShowGlyphs: true });
    e.step({ b: { attack: 'heavy' } });
    expect(e.glyphFor('a')).toMatchObject({ kind: 'heavy' });
  });
});

describe('ending the fight', () => {
  it('to first blood: the first blow that draws blood ends it; a chipped block does not', () => {
    const e = rt({}, {}, { stakes: 'firstBlood' });
    e.step({ a: { attack: 'light', height: 'high' }, b: { guard: true, height: 'high' } });
    until(e, () => e.fighter('a').action !== 'windup', { b: { guard: true, height: 'high' } });
    expect(e.ended).toBe(false);
    until(e, () => e.fighter('a').action === 'idle');
    e.step({ a: { attack: 'light' } });
    until(e, () => e.ended);
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'firstBlood' });
  });

  it('down at 0 HP', () => {
    const e = rt({ stats: { might: 10, melee: 10 }, weapon: 'daneAxe' }, { stats: { vigor: 1 } });
    for (let i = 0; i < 40 && !e.ended; i++) {
      until(e, () => e.fighter('a').action === 'idle' || e.ended);
      e.step({ a: { attack: 'heavy' } });
    }
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'down' });
    expect(e.outcome!.hpPct.b).toBe(0);
  });

  it('asking for quarter ends a duel to yield after 1.5 s', () => {
    const e = rt({}, {}, { stakes: 'yield' });
    until(e, () => e.ended, { b: { yieldHeld: true } }, 200);
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'yield' });
    expect(e.outcome!.durationS).toBeCloseTo(bal.duel.moves.yield.holdS + e.dtMs / 1000, 2);
  });

  it('in a duel to the death a human decides a plea: the clock stops until answered', () => {
    const e = rt({}, {}, { stakes: 'death' });
    until(e, () => e.quarter !== null, { b: { yieldHeld: true } }, 200);
    expect(e.quarter).toEqual({ asker: 'b', decider: 'a' });
    const frame = e.frame;
    steps(e, 30, { b: { yieldHeld: true } });
    expect(e.frame).toBe(frame);
    expect(e.snapshot().phase).toBe('quarter');
    e.step({ a: { quarter: 'refuse' } });
    expect(e.quarter).toBeNull();
    expect(e.fighter('b').yieldCooldownUntil).toBeGreaterThan(e.timeMs);
    expect(e.ended).toBe(false);
    // Refused: cannot ask again until the cooldown passes.
    steps(e, 60, { b: { yieldHeld: true } });
    expect(e.fighter('b').action).not.toBe('yield');
    const accept = rt({}, {}, { stakes: 'death' });
    until(accept, () => accept.quarter !== null, { b: { yieldHeld: true } }, 200);
    accept.step({ a: { quarter: 'accept' } });
    expect(accept.outcome).toMatchObject({ winner: 'a', reason: 'yield' });
  });

  it('an AI decider grants quarter by its mercy', () => {
    const merciful = testDuelSetup({}, {}, { stakes: 'death' });
    merciful.profiles!.a.mercy = 1;
    const e = new DuelEngine(merciful, content, { ai: { a: true, b: false }, startGapM: 3 });
    until(e, () => e.ended, { b: { yieldHeld: true } }, 300);
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'yield' });

    // A merciless AI refuses (it starts too far away to cut the plea short on the open beach).
    const ruthless = testDuelSetup({}, {}, { stakes: 'death', arena: 'beach' });
    ruthless.profiles!.a.mercy = 0;
    const ai = new DuelEngine(ruthless, content, { ai: { a: true, b: false }, startGapM: 7 });
    const fx = until(ai, () => ai.fighter('b').yieldCooldownUntil > 0 || ai.ended, { b: { yieldHeld: true } }, 300);
    expect(kinds(fx)).toContain('quarterRefused');
    expect(ai.ended).toBe(false);
  });

  it('holmgang: stepping out of the square loses', () => {
    const e = rt({}, {}, { arena: 'holmgang', gap: 2 });
    until(e, () => e.ended, { a: { move: -1 } }, 400);
    expect(e.outcome).toMatchObject({ winner: 'b', reason: 'ringOut' });
    // Elsewhere the wall stops you.
    const hall = rt({}, {}, { arena: 'hall', gap: 2 });
    steps(hall, 400, { a: { move: -1 } });
    expect(hall.ended).toBe(false);
    expect(hall.fighter('a').x).toBe(-hall.halfWidthM);
  });

  it('holmgang: three shields — a hewn shield is replaced after shieldSwapMs, Shield HP refilled', () => {
    const e = rt({ weapon: 'daneAxe', stats: { might: 8, melee: 8 } }, {}, { arena: 'holmgang' });
    expect(e.fighter('b').shieldsLeft).toBe(3);
    let fx: DuelFx[] = [];
    for (let i = 0; i < 10 && e.fighter('b').shieldsLeft === 3; i++) {
      until(e, () => e.fighter('a').action === 'idle', { b: { guard: true } });
      e.step({ a: { attack: 'light' }, b: { guard: true } });
      fx = until(e, () => e.fighter('a').action !== 'windup', { b: { guard: true } });
    }
    expect(kinds(fx)).toContain('shieldBreak');
    expect(e.fighter('b').shieldsLeft).toBe(2);
    expect(e.fighter('b').action).toBe('swap');
    const swapFx = until(e, () => e.fighter('b').action !== 'swap');
    expect(kinds(swapFx)).toContain('shieldSwap');
    expect(e.fighter('b').shieldHp).toBe(e.fighter('b').p.shieldMax);
  });

  it('the time limit judges on remaining HP', () => {
    const e = rt();
    e.step({ a: { attack: 'light' } });
    until(e, () => e.ended, {}, 100000);
    expect(e.outcome).toMatchObject({ winner: 'a', reason: 'timeout' });
    expect(e.outcome!.durationS).toBeCloseTo(cfg.timeLimitS, 1);
  });
});

describe('determinism and the render API', () => {
  it('the same setup and inputs replay identically; a different seed differs', () => {
    const run = (seed: string) => {
      const setup = testDuelSetup({ style: 'tricky' }, { style: 'aggressive', weapon: 'hammer' }, { seed });
      const e = new DuelEngine(setup, content, { ai: { a: true, b: true } });
      const dumps: string[] = [];
      while (!e.ended) {
        e.step();
        if (e.frame % 120 === 0) dumps.push(JSON.stringify(e.dump()));
      }
      return { dumps, outcome: e.outcome };
    };
    const x = run('det-1');
    const y = run('det-1');
    expect(y).toEqual(x);
    const z = run('det-2');
    expect(z.dumps).not.toEqual(x.dumps);
  });

  it('AI-vs-AI duels end within the time limit in every arena and stakes', () => {
    for (const arena of ['hall', 'deck', 'beach', 'holmgang', 'field'] as const) {
      for (const stakes of ['firstBlood', 'yield', 'death'] as const) {
        const e = new DuelEngine(testDuelSetup({ style: 'defensive' }, { style: 'brute' }, { arena, stakes, seed: `${arena}-${stakes}` }), content, {
          ai: { a: true, b: true },
        });
        const r = e.run();
        expect(r.durationS).toBeLessThanOrEqual(cfg.timeLimitS + 0.1);
        if (stakes === 'firstBlood') expect(['firstBlood', 'yield', 'ringOut', 'timeout', 'down']).toContain(r.reason);
        if (arena !== 'holmgang') expect(r.reason).not.toBe('ringOut');
      }
    }
  });

  it('snapshots carry bars, poses, the glyph and this step’s fx as copies', () => {
    const e = rt({ stats: { wits: 8 } });
    e.step({ b: { attack: 'light', height: 'high' } });
    const view = e.snapshot('a');
    expect(view.phase).toBe('fighting');
    expect(view.fighters.b.action).toBe('windup');
    expect(view.fighters.b.attack).toBe('light');
    expect(view.fighters.a.hpMax).toBe(e.fighter('a').p.hpMax);
    expect(view.glyph?.kind).toBe('high');
    expect(view.fx.map((f) => f.kind)).toContain('windup');
    view.fx.length = 0;
    expect(e.fx.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('a 60 Hz step is cheap (AI vs AI)', () => {
    const e = new DuelEngine(testDuelSetup({}, {}, { seed: 'perf' }), content, { ai: { a: true, b: true } });
    const t0 = Date.now();
    let frames = 0;
    for (let i = 0; i < 20; i++) {
      const d = new DuelEngine(testDuelSetup({}, {}, { seed: `perf${i}` }), content, { ai: { a: true, b: true } });
      while (!d.ended) {
        d.step();
        frames += 1;
      }
    }
    const perFrameUs = ((Date.now() - t0) * 1000) / frames;
    expect(perFrameUs).toBeLessThan(50);
    expect(e.ended).toBe(false);
  });
});
