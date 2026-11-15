import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { makeTestSetup } from '../testing';
import { BattleEngine } from './engine';
import { setFacing } from './geometry';
import type { BSquad } from './types';

const content = getContent();

/** Field battle with both sides under (idle) human command: only stances move squads. */
function field(): BattleEngine {
  const setup = makeTestSetup(content, {
    kind: 'field',
    seed: 'stances',
    attacker: [
      { unit: 'huscarls', men: 30, leader: { name: 'Test A', isPlayer: true, role: 'player' } },
      { unit: 'archers', men: 30 },
    ],
    defender: [{ unit: 'fyrdSpearmen', men: 30 }],
  });
  return BattleEngine.create(setup, content, { humanSides: ['attacker', 'defender'] });
}

function put(s: BSquad, x: number, y: number, facing: number): void {
  s.x = s.px = x;
  s.y = s.py = y;
  setFacing(s, facing);
}

describe('stances of human-commanded squads', () => {
  it('Engage: an idle squad attacks an enemy that comes close', () => {
    const e = field();
    const [a, , d] = e.state.squads as [BSquad, BSquad, BSquad];
    put(a, 48, 40, -Math.PI / 2);
    put(d, 48, 33, Math.PI / 2);
    d.stance = 'hold';
    e.step(10);
    expect(a.task.kind).toBe('attack');
    expect(a.task.target).toBe(d.idx);
  });

  it('Hold: an idle squad stays put', () => {
    const e = field();
    const [a, , d] = e.state.squads as [BSquad, BSquad, BSquad];
    put(a, 48, 40, -Math.PI / 2);
    put(d, 48, 33, Math.PI / 2);
    a.stance = 'hold';
    d.stance = 'hold';
    e.step(20);
    expect(a.task.kind).toBe('none');
    expect(Math.abs(a.y - 40)).toBeLessThan(0.5);
  });

  it('Skirmish: archers back away from melee foot closing in', () => {
    const e = field();
    const [a, b, d] = e.state.squads as [BSquad, BSquad, BSquad];
    put(a, 10, 66, 0);
    a.stance = 'hold';
    put(b, 48, 40, -Math.PI / 2);
    expect(b.stance).toBe('skirmish');
    put(d, 48, 34, Math.PI / 2);
    d.stance = 'hold';
    e.step(60);
    expect(b.y).toBeGreaterThan(42);
  });

  it('AI-controlled sides are left to the AI', () => {
    const setup = makeTestSetup(content, { kind: 'field', seed: 'stances-ai', playerSide: null });
    const e = BattleEngine.create(setup, content, { humanSides: [] });
    e.step(40);
    expect(e.state.humanSides).toEqual([false, false]);
  });
});
