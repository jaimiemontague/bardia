/**
 * The battle controller headless: a skirmish played through the same calls the screen makes (select,
 * right-click orders, abilities, pause and speed, the captains' fast-forward) reaches a valid result.
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { validateBattleResult } from '@sim/battle/apply';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { skirmishSetup, SKIRMISH_PRESETS, type SkirmishPresetId } from '../skirmish/presets';
import { BattleController } from './controller';

setMissingKeyWarnings(false);
const content = getContent();

/** A simple player: every few seconds, each idle squad attacks the nearest seen enemy. */
function playAggressive(c: BattleController, maxS = 1500): void {
  c.setPaused(false);
  let nextThink = 0;
  for (let i = 0; i < maxS * 20 && c.engine.status !== 'ended'; i++) {
    if (c.engine.status === 'duelRequested') c.settleDuel();
    if (c.snap.timeS >= nextThink) {
      nextThink = c.snap.timeS + 3;
      for (const s of c.ownSquads()) {
        if (s.status !== 'active' || s.task === 'attack' || s.task === 'loot') continue;
        const foes = c.snap.squads.filter((o) => o.side !== c.side && o.status !== 'routing');
        foes.sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y));
        const foe = foes[0];
        c.select([s.id]);
        if (foe) c.commandAt(foe.x, foe.y);
        else if (c.snap.buildings.some((b) => b.loot > 0)) {
          const b = c.snap.buildings.find((x) => x.loot > 0)!;
          c.commandAt(b.x + b.w / 2, b.y + b.h / 2);
        }
      }
    }
    c.frame(0.05);
  }
}

describe('BattleController', () => {
  it('starts paused, names squads and lists the roster', () => {
    const c = new BattleController(skirmishSetup(content, 'raid'), content, t);
    expect(c.paused).toBe(true);
    expect(c.side).toBe('attacker');
    expect(c.rosterIds().length).toBe(4);
    expect(c.squadName(c.rosterIds()[0]!)).toBe('Haldrek');
    const before = c.engine.tick;
    c.frame(0.5);
    expect(c.engine.tick).toBe(before);
  });

  it('selects by number and moves on a right click; the order shows while paused and applies on unpause', () => {
    const c = new BattleController(skirmishSetup(content, 'field'), content, t);
    c.selectIndex(1);
    expect(c.selected).toEqual([c.rosterIds()[0]]);
    const s = c.squad(c.selected[0]!)!;
    c.commandAt(s.x, s.y - 6);
    expect(c.planned[s.id]?.kind).toBe('move');
    c.setPaused(false);
    for (let i = 0; i < 40; i++) c.frame(0.05);
    expect(c.squad(s.id)!.y).toBeLessThan(s.y - 1);
  });

  it('runs at 1x, 2x and 4x', () => {
    const c = new BattleController(skirmishSetup(content, 'field'), content, t);
    c.setSpeed(1);
    c.frame(1);
    const t1 = c.engine.tick;
    c.setSpeed(2);
    c.frame(0.2);
    const t2 = c.engine.tick - t1;
    c.setSpeed(4);
    c.frame(0.2);
    const t4 = c.engine.tick - t1 - t2;
    expect(t2).toBe(8);
    expect(t4).toBe(16);
  });

  for (const p of SKIRMISH_PRESETS) {
    it(`an aggressive player finishes the ${p.id} preset with a result the battle module accepts`, () => {
      const setup = skirmishSetup(content, p.id as SkirmishPresetId);
      const c = new BattleController(setup, content, t);
      playAggressive(c);
      expect(c.engine.status).toBe('ended');
      const result = c.result()!;
      expect(validateBattleResult(c.setup, result, content)).toEqual([]);
      expect(c.log.length).toBeGreaterThan(3);
      console.log(p.id, result.winner, c.engine.state.end?.reason, Math.round(result.durationS), 'loot', Math.round(result.lootValue));
    });
  }

  it('lets the captains finish a battle quickly', () => {
    const c = new BattleController(skirmishSetup(content, 'field'), content, t);
    c.letCaptainsFinish();
    for (let i = 0; i < 400 && c.engine.status !== 'ended'; i++) c.frame(0.016);
    expect(c.engine.status).toBe('ended');
    expect(validateBattleResult(c.setup, c.result()!, content)).toEqual([]);
    console.log('captains', c.result()!.winner, c.engine.state.end?.reason);
  });

  it('sounds the general retreat and ends', () => {
    const c = new BattleController(skirmishSetup(content, 'raid'), content, t);
    c.retreatAll();
    for (let i = 0; i < 20 * 400 && c.engine.status !== 'ended'; i++) c.frame(0.05);
    expect(c.engine.status).toBe('ended');
    expect(c.result()!.retreated || c.result()!.winner === 'attacker').toBe(true);
    console.log('retreat', c.result()!.winner, c.engine.state.end?.reason);
  });
});
