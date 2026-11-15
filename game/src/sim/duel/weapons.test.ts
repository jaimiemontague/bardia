import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { AssistedDuel } from './assisted';
import { DuelEngine, type DuelFx, type DuelInput } from './engine';
import { strikeDamage } from './stats';
import { testDuelSetup, type TestFighter } from './testing';
import type { DuelSide } from './types';

const content = getContent();
const bal = content.balance;
const cfg = content.tunables.duel;

function rt(a: TestFighter, b: TestFighter = {}, gap = 1.2, seed = 'w'): DuelEngine {
  return new DuelEngine(testDuelSetup(a, b, { stakes: 'death', seed }), content, { ai: { a: false, b: false }, startGapM: gap });
}

function until(e: DuelEngine, done: () => boolean, inputs: Partial<Record<DuelSide, DuelInput>> = {}, max = 2000): DuelFx[] {
  const fx: DuelFx[] = [];
  for (let i = 0; i < max && !done(); i++) {
    e.step(inputs);
    fx.push(...e.fx);
  }
  return fx;
}

/** A strikes once (B does `bInput` meanwhile); returns the fx of the exchange. */
function strike(e: DuelEngine, attack: 'light' | 'heavy', bInput: DuelInput = {}): DuelFx[] {
  until(e, () => e.fighter('a').action === 'idle' && e.fighter('b').action !== 'stagger', { b: bInput });
  e.step({ a: { attack, height: 'high' }, b: bInput });
  return until(e, () => e.fighter('a').action !== 'windup', { b: bInput });
}

describe('§14.4 weapon specials (real time)', () => {
  it('sword and shield: the third consecutive hit strikes ×1.3', () => {
    const e = rt({ weapon: 'sword' });
    const base = strikeDamage(e.fighter('a').p, e.fighter('b').p, 1);
    const hits = [strike(e, 'light'), strike(e, 'light'), strike(e, 'light'), strike(e, 'light')].map((fx) => fx.find((f) => f.kind === 'hit'));
    expect(hits[0]?.amount).toBeCloseTo(base, 9);
    expect(hits[1]?.amount).toBeCloseTo(base, 9);
    expect(hits[2]?.amount).toBeCloseTo(base * (bal.weapons.sword.special['comboThirdHitMult'] ?? 0), 9);
    expect(hits[3]?.amount).toBeCloseTo(base, 9);
    // A blocked blow breaks the chain.
    const c = rt({ weapon: 'sword' });
    strike(c, 'light');
    strike(c, 'light');
    strike(c, 'light', { guard: true, height: 'high' });
    expect(strike(c, 'light').find((f) => f.kind === 'hit')?.amount).toBeCloseTo(base, 9);
  });

  it('axe and shield: a heavy blow caught on a shield hooks it — no blocking for 1 s', () => {
    const e = rt({ weapon: 'axe' });
    const fx = strike(e, 'heavy', { guard: true, height: 'high' });
    expect(fx.map((f) => f.kind)).toContain('hook');
    const until1s = e.fighter('b').blockDisabledUntil;
    expect(until1s - e.timeMs).toBeCloseTo((bal.weapons.axe.special['hookDisableBlockS'] ?? 0) * 1000, 6);
    e.step({ b: { guard: true } });
    expect(e.fighter('b').action).not.toBe('guard');
    until(e, () => e.timeMs >= until1s);
    until(e, () => e.fighter('b').action === 'idle' || e.fighter('b').action === 'guard');
    e.step({ b: { guard: true } });
    expect(e.fighter('b').action).toBe('guard');
    // Not against a haft, and not with a light blow.
    const haft = rt({ weapon: 'axe' }, { weapon: 'daneAxe' });
    expect(strike(haft, 'heavy', { guard: true, height: 'high' }).map((f) => f.kind)).not.toContain('hook');
    const light = rt({ weapon: 'axe' });
    expect(strike(light, 'light', { guard: true, height: 'high' }).map((f) => f.kind)).not.toContain('hook');
  });

  it('spear and shield: reach 1.4 lands where an axe whiffs; thrusts ignore 30% of armour', () => {
    const spear = rt({ weapon: 'spear' }, {}, 2.0);
    expect(spear.fighter('a').p.reachM).toBeCloseTo(1.4 * cfg.reachMetresPerUnit, 9);
    expect(strike(spear, 'light').map((f) => f.kind)).toContain('hit');
    const axe = rt({ weapon: 'axe' }, {}, 2.0);
    expect(strike(axe, 'light').map((f) => f.kind)).toContain('whiff');
    const vsMail = rt({ weapon: 'spear', weaponTier: 1 }, { armourTier: 5 });
    const p = vsMail.fighter('a').p;
    const raw = 11 * (1 + 0.03 * 3);
    expect(strikeDamage(p, vsMail.fighter('b').p, 1)).toBeCloseTo(raw * (1 - 0.24 * (1 - 0.3)), 9);
  });

  it('two-handed axe: no shield, ×2 damage to shields', () => {
    const e = rt({ weapon: 'daneAxe' });
    expect(e.fighter('a').p.shieldMax).toBe(0);
    expect(e.fighter('a').shieldsLeft).toBe(0);
    const raw = strikeDamage(e.fighter('a').p, e.fighter('b').p, 1);
    strike(e, 'light', { guard: true, height: 'high' });
    const shieldLoss = e.fighter('b').p.shieldMax - e.fighter('b').shieldHp;
    expect(shieldLoss).toBeCloseTo(Math.min(e.fighter('b').p.shieldMax, raw * 0.8 * (bal.weapons.daneAxe.special['shieldDamageMult'] ?? 0)), 9);
    // Without a shield the fighter blocks with the haft (and cannot bash).
    const h = rt({}, { weapon: 'daneAxe' });
    const r = strikeDamage(h.fighter('a').p, h.fighter('b').p, 1);
    strike(h, 'light', { guard: true, height: 'high' });
    expect(h.fighter('b').p.hpStart - h.fighter('b').hp).toBeCloseTo(r * (1 - cfg.haftBlock.share), 9);
    h.step({ b: { bash: true } });
    expect(h.fighter('b').action).not.toBe('windup');
  });

  it('two-handed axe: a committed swing is not stopped by a flinch (poise) — blows trade', () => {
    const e = rt({ weapon: 'daneAxe' }, { weapon: 'sword' });
    e.step({ a: { attack: 'light' } });
    e.step({ b: { attack: 'light' } });
    const fx = until(e, () => e.fighter('a').action !== 'windup');
    const hits = fx.filter((f) => f.kind === 'hit').map((f) => f.side);
    expect(hits).toEqual(['b', 'a']);
    // A shield fighter's light swing is interrupted instead.
    const s = rt({ weapon: 'axe' }, { weapon: 'sword' });
    s.step({ a: { attack: 'light' } });
    s.step({ b: { attack: 'light' } });
    const sfx = until(s, () => s.fighter('a').action !== 'windup');
    expect(sfx.filter((f) => f.kind === 'hit').map((f) => f.side)).toEqual(['b']);
  });

  it('hammer and shield: ignores 50% of armour', () => {
    const e = rt({ weapon: 'hammer', weaponTier: 1 }, { armourTier: 5 });
    const raw = 13 * (1 + 0.03 * 3);
    expect(strikeDamage(e.fighter('a').p, e.fighter('b').p, 1)).toBeCloseTo(raw * (1 - 0.24 * 0.5), 9);
  });

  it('hammer and shield: about 25% of connecting blows stagger (hits and guarded blows alike)', () => {
    let hits = 0;
    let staggers = 0;
    let blocked = 0;
    let blockStaggers = 0;
    for (let i = 0; i < 400; i++) {
      const e = rt({ weapon: 'hammer' }, {}, 1.2, `ham${i}`);
      const guard = i % 2 === 0;
      const fx = strike(e, 'light', guard ? { guard: true, height: 'high' } : {});
      const kinds = fx.map((f) => f.kind);
      if (kinds.includes('hit')) {
        hits += 1;
        if (kinds.includes('stagger')) {
          staggers += 1;
          expect(e.fighter('b').action).toBe('stagger');
          expect(e.fighter('b').actionEnd - e.fighter('b').actionStart).toBe(cfg.hammerStaggerMs);
        }
      }
      if (kinds.includes('block')) {
        blocked += 1;
        if (kinds.includes('stagger')) blockStaggers += 1;
      }
    }
    expect(hits).toBe(200);
    expect(blocked).toBe(200);
    expect(staggers / hits).toBeGreaterThan(0.17);
    expect(staggers / hits).toBeLessThan(0.33);
    expect(blockStaggers / blocked).toBeGreaterThan(0.17);
    expect(blockStaggers / blocked).toBeLessThan(0.33);
  });
});

describe('§14.4 weapon specials (Assisted Mode)', () => {
  it('two-handed axe strikes caught on a shield deal double shield damage; a haft guard lets half through', () => {
    const d = new AssistedDuel(testDuelSetup({ weapon: 'daneAxe' }, {}), content);
    const r = d.scripted('highStrike', 'guardHigh');
    expect(r.events.map((e) => e.kind)).toContain('block');
    const profiles = testDuelSetup({ weapon: 'daneAxe' }, {}).profiles!;
    const raw = strikeDamage(profiles.a, profiles.b, 1) * cfg.assisted.weaponDamageMult.daneAxe;
    const shieldMax = r.fighters.b.shieldMax;
    expect(shieldMax - r.fighters.b.shieldHp).toBeCloseTo(Math.min(shieldMax, raw * 2), 6);
    const h = new AssistedDuel(testDuelSetup({}, { weapon: 'daneAxe' }), content);
    const hr = h.scripted('highStrike', 'guardHigh');
    expect(hr.events.map((e) => e.kind)).toContain('haftBlock');
    expect(h.options('b')).not.toContain('bash');
  });

  it('sword combo and hammer stagger carry over', () => {
    const s = new AssistedDuel(testDuelSetup({ weapon: 'sword' }, {}), content);
    s.scripted('highStrike', 'feint');
    s.scripted('highStrike', 'feint');
    expect(s.scripted('highStrike', 'feint').events.map((e) => e.kind)).toContain('combo');
    let staggers = 0;
    for (let i = 0; i < 300; i++) {
      const h = new AssistedDuel(testDuelSetup({ weapon: 'hammer' }, {}, { seed: `ah${i}` }), content);
      if (h.scripted('highStrike', 'feint').events.some((e) => e.kind === 'hammerStagger')) staggers += 1;
    }
    expect(staggers / 300).toBeGreaterThan(0.17);
    expect(staggers / 300).toBeLessThan(0.33);
  });
});
