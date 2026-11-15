/**
 * The sea-battle scene's driver in node: the helm keys (one input per change), the draw-and-loose
 * sweep, taking the helm of another ship, grapnels, selection, the orders a right click gives,
 * attack styles, withdraw, the captains' fast-forward to a result, and the campaign path out of the
 * scene (the result handed back with the seabattle module's own applySeaBattleResult).
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import type { EffectData } from '@sim/core/effects';
import type { GameState } from '@sim/core/state';
import { module as seabattle } from '@sim/seabattle/index';
import { inDraft, testWorld } from '@sim/testing';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { SteerKeys } from '../../input/steering';
import { seaSkirmishSetup } from '../skirmish/presets';
import { broadsideOf, helmFor, SeaController, sideFacing, sweepRange } from './controller';

setMissingKeyWarnings(false);
const content = getContent();

function skirmish(id: 'seaPair' | 'seaMerchant' | 'seaStand', run = 1): SeaController {
  return new SeaController(seaSkirmishSetup(content, id, run, (k) => t(k)), content, t);
}

/** Runs real frames until the battle ends (or `maxS` real seconds). */
function play(c: SeaController, maxS = 400): void {
  for (let i = 0; i < maxS * 30 && !c.isOver(); i++) c.frame(1 / 30);
}

/** Runs `s` real seconds of frames. */
function run(c: SeaController, s: number, dt = 1 / 30): void {
  for (let i = 0; i < Math.round(s / dt) && !c.isOver(); i++) c.frame(dt);
}

function inputs(c: SeaController, kind: string): number {
  return c.engine.inputLog.filter((x) => 'input' in x && x.input.kind === kind).length;
}

type KeyEv = Parameters<SteerKeys['keyDown']>[0];
const key = (code: string, repeat = false): KeyEv => ({ code, repeat, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault: () => undefined });

describe('the helm', () => {
  it('maps the held keys to throttle and rudder', () => {
    expect(helmFor(null)).toEqual({ throttle: 0, rudder: 0 });
    expect(helmFor('n')).toEqual({ throttle: 1, rudder: 0 });
    expect(helmFor('s')).toEqual({ throttle: -1, rudder: 0 });
    expect(helmFor('e')).toEqual({ throttle: 0, rudder: 1 });
    expect(helmFor('nw')).toEqual({ throttle: 1, rudder: -1 });
    expect(helmFor('se')).toEqual({ throttle: -1, rudder: 1 });
  });

  it('starts at the flagship helm with nothing selected', () => {
    const c = skirmish('seaPair');
    expect(c.side).toBe('attacker');
    const helm = c.helmShip()!;
    expect(helm.isPlayer && helm.isHelm).toBe(true);
    expect(c.selectedShips()).toEqual([]);
    expect(c.snap.ships.filter((s) => s.side === 'defender')).toHaveLength(2);
    expect(c.paused).toBe(true);
  });

  it('W A S D send one input per change, never per frame, and the ship gathers way and turns', () => {
    const c = skirmish('seaPair');
    const steer = new SteerKeys({ onChange: (d) => c.setHelmDir(d) });
    c.setPaused(false);
    const h0 = c.helmShip()!.heading;
    steer.keyDown(key('KeyW'));
    expect(inputs(c, 'helm')).toBe(1);
    for (let i = 0; i < 20; i++) steer.keyDown(key('KeyW', true));
    run(c, 3);
    expect(inputs(c, 'helm')).toBe(1);
    expect(c.helmShip()!.speedMs).toBeGreaterThan(1);
    steer.keyDown(key('KeyD'));
    expect(c.helmWanted).toEqual({ throttle: 1, rudder: 1 });
    run(c, 1.5);
    expect(inputs(c, 'helm')).toBe(2);
    const turned = ((c.helmShip()!.heading - h0 + 540) % 360) - 180;
    expect(turned).toBeGreaterThan(10);
    steer.keyUp({ code: 'KeyW' });
    steer.keyUp({ code: 'KeyD' });
    expect(inputs(c, 'helm')).toBe(4);
    expect(c.helmWanted).toEqual({ throttle: 0, rudder: 0 });
  });

  it('the number keys and Tab take the helm of another ship, which answers the held keys at once', () => {
    const c = skirmish('seaPair');
    const [flag, other] = c.roster();
    c.setHelmDir('n');
    c.takeHelmIndex(2);
    expect(c.snap.helm).toBe(other!.idx);
    expect(c.ship(other!.idx)!.controller).toBe('player');
    expect(c.ship(flag!.idx)!.controller).toBe('orders');
    // The held W carries over to the new ship (one input, not one per frame).
    expect(c.engine.w.ships[other!.idx]!.throttle).toBe(1);
    c.cycleHelm();
    expect(c.snap.helm).toBe(flag!.idx);
  });
});

describe('the broadside', () => {
  it('the marker sweeps out to the longest bowshot and back', () => {
    const cfg = { minRangeM: 20, maxRangeM: 110, sweepRealS: 1 };
    expect(sweepRange(0, cfg)).toBe(20);
    expect(sweepRange(0.5, cfg)).toBeCloseTo(65, 9);
    expect(sweepRange(1, cfg)).toBeCloseTo(110, 9);
    expect(sweepRange(1.5, cfg)).toBeCloseTo(65, 9);
    expect(sweepRange(2, cfg)).toBeCloseTo(20, 9);
  });

  it('shows on the side facing the enemy', () => {
    const north = { x: 0, y: 0, heading: 0 };
    expect(sideFacing(north, 50, 0)).toBe('starboard');
    expect(sideFacing(north, -50, 0)).toBe('port');
    const east = { x: 0, y: 0, heading: 90 };
    expect(sideFacing(east, 0, 50)).toBe('starboard');
    const [sx, sy] = broadsideOf(90, 'starboard');
    expect(sx).toBeCloseTo(0, 9);
    expect(sy).toBeCloseTo(1, 9);
  });

  it('hold Space to draw, let go to loose: one logged input with the side and range, then nocking', () => {
    const c = skirmish('seaPair');
    expect(c.beginDraw()).toBe(false); // paused
    c.setPaused(false);
    expect(c.volleyState()).toBe('ready');
    expect(c.beginDraw()).toBe(true);
    expect(c.aim!.rangeM).toBeCloseTo(c.aimCfg.minRangeM, 6);
    run(c, c.aimCfg.sweepRealS * 0.5, 1 / 60);
    const aim = c.aim!;
    expect(aim.rangeM).toBeGreaterThan(c.aimCfg.minRangeM + 10);
    expect(aim.rangeM).toBeLessThan(c.aimCfg.maxRangeM - 10);
    expect(aim.side).toBe(c.aimSide());
    c.releaseDraw();
    expect(c.drawing).toBe(false);
    const log = c.engine.inputLog.filter((x) => 'input' in x && x.input.kind === 'loose');
    expect(log).toHaveLength(1);
    const input = (log[0] as { input: { side: string; rangeM: number } }).input;
    expect(input.side).toBe(aim.side);
    expect(input.rangeM).toBeCloseTo(aim.rangeM, 6);
    expect(c.snap.shots).toHaveLength(1);
    expect(c.volleyState()).toBe('nocking');
    expect(c.beginDraw()).toBe(false);
    expect(c.notice?.key).toBe('seaView.notice.nocking');
    run(c, 3);
    expect(c.volleyState()).toBe('ready');
  });

  it('grapnels need an enemy alongside; the steered ship is not sent off by a right click', () => {
    const c = skirmish('seaPair');
    c.grapnels();
    expect(c.notice?.key).toBe('seaView.notice.notAlongside');
    c.select([c.snap.helm]);
    const foe = c.snap.ships.find((s) => s.side === 'defender')!;
    c.commandAt(foe.x, foe.y, 3, 1);
    expect(c.notice?.key).toBe('seaView.notice.atHelm');
    expect(c.helmShip()!.controller).toBe('player');
  });
});

describe('selection', () => {

  it('selects by number, by box, and the whole fleet', () => {
    const c = skirmish('seaPair');
    c.selectIndex(2);
    expect(c.selected).toEqual([c.roster()[1]!.idx]);
    c.selectAll();
    expect(c.selected).toHaveLength(2);
    const [a, b] = c.roster();
    c.selectBox(a!.x - 1, a!.y - 1, a!.x + 1, a!.y + 1, false);
    expect(c.selected).toEqual([a!.idx]);
    c.clickAt(b!.x, b!.y, 2, 1, true);
    expect(c.selected).toEqual([a!.idx, b!.idx]);
    c.clickAt(-500, -500, 2, 1, false);
    expect(c.selected).toEqual([]);
  });

  it('enemy ships cannot be selected', () => {
    const c = skirmish('seaPair');
    const foe = c.snap.ships.find((s) => s.side === 'defender')!;
    c.select([foe.idx]);
    expect(c.selected).toEqual([]);
  });
});

describe('orders', () => {
  it('a right click on water sails the selection there, the flagship under its own helm', () => {
    const c = skirmish('seaPair');
    c.selectAll();
    const [flag, other] = c.roster();
    c.commandAt(1000, 1000, 2, 1);
    const f = c.ship(flag!.idx)!;
    const o = c.ship(other!.idx)!;
    expect(f.controller).toBe('player');
    expect(f.moveTo).not.toBeNull();
    expect(o.order).toBe('move');
    expect(o.moveTo).not.toBeNull();
    // Kept apart, not piled onto one point.
    expect(Math.hypot(f.moveTo!.x - o.moveTo!.x, f.moveTo!.y - o.moveTo!.y)).toBeGreaterThanOrEqual(44);
  });

  it('a right click on an enemy attacks it in each ship style (the steered ship stays in hand)', () => {
    const c = skirmish('seaPair');
    const [flag, other] = c.roster();
    c.select([other!.idx]);
    c.setStyle('shoot');
    c.selectAll();
    const foe = c.snap.ships.find((s) => s.side === 'defender')!;
    c.commandAt(foe.x, foe.y, 3, 1);
    expect(c.ship(flag!.idx)!.order).toBe('follow');
    expect(c.ship(flag!.idx)!.controller).toBe('player');
    expect(c.ship(other!.idx)!.order).toBe('shoot');
    expect(c.ship(other!.idx)!.orderTarget).toBe(foe.idx);
    // Changing the style re-gives the order to ships already attacking.
    c.select([other!.idx]);
    c.setStyle('board');
    expect(c.ship(other!.idx)!.order).toBe('board');
  });

  it('ramming falls back to boarding for ships without a ram and says so', () => {
    const c = skirmish('seaPair');
    c.select([c.roster()[1]!.idx]);
    c.setStyle('ram');
    expect(c.notice?.key).toBe('seaView.notice.noRam');
    const foe = c.snap.ships.find((s) => s.side === 'defender')!;
    c.commandAt(foe.x, foe.y, 3, 1);
    expect(c.selectedShips()[0]!.order).toBe('board');
  });

  it('asks for a selection first, and refuses land', () => {
    const c = skirmish('seaPair');
    c.select([]);
    c.commandAt(1000, 1000, 2, 1);
    expect(c.notice?.key).toBe('seaView.notice.selectFirst');
    c.selectAll();
    const arena = c.snap.arena;
    const land = arena.terrain.findIndex((x) => x === 2);
    if (land >= 0) {
      const x = (land % arena.w) * arena.cellM + arena.cellM / 2;
      const y = Math.floor(land / arena.w) * arena.cellM + arena.cellM / 2;
      // Only when no ship sits on that cell (a click there would be on the ship).
      c.commandAt(x, y, 0.01, 1);
      expect(c.notice?.key).toBe('seaView.notice.land');
    }
  });

  it('hold and withdraw reach the engine; withdraw-all sounds the retreat and runs', () => {
    const c = skirmish('seaStand');
    c.selectAll();
    c.holdSelected();
    expect(c.selectedShips().every((s) => s.order === 'hold')).toBe(true);
    c.withdrawSelected();
    expect(c.selectedShips().every((s) => s.order === 'withdraw')).toBe(true);
    c.withdrawAll();
    expect(c.paused).toBe(false);
    expect(c.engine.w.sides[c.sideIdx].retreating).toBe(true);
  });
});

describe('time and the end', () => {
  it('runs at the chosen pace and pauses', () => {
    const c = skirmish('seaPair');
    c.frame(1);
    expect(c.engine.tick).toBe(0);
    c.setSpeed(1);
    c.frame(0.25);
    const one = c.engine.tick;
    expect(one).toBe(5);
    c.setSpeed(4);
    c.frame(0.25);
    expect(c.engine.tick - one).toBe(8);
    c.togglePause();
    c.frame(0.25);
    expect(c.engine.tick - one).toBe(8);
  });

  it("the captains finish it: a result, a summary, nothing left running", () => {
    const c = skirmish('seaPair', 7);
    c.setPaused(false);
    for (let i = 0; i < 60; i++) c.frame(1 / 30);
    c.letCaptainsFinish();
    expect(c.fastForward).toBe(true);
    play(c);
    expect(c.isOver()).toBe(true);
    expect(c.fastForward).toBe(false);
    const s = c.summary()!;
    expect(['victory', 'defeat', 'escaped', 'draw']).toContain(s.outcome);
    expect(s.own.fates).toHaveLength(2);
    expect(s.enemy.fates).toHaveLength(2);
    expect(c.log.length).toBeGreaterThan(0);
  });

  it('a merchant raid can bring plunder home', () => {
    let plunder = 0;
    for (let run = 0; run < 4 && plunder === 0; run++) {
      const c = skirmish('seaMerchant', run);
      c.letCaptainsFinish();
      play(c);
      const s = c.summary()!;
      plunder += s.plunderSilver;
    }
    expect(plunder).toBeGreaterThan(0);
  });
});

describe('the campaign path', () => {
  it('fight at the helm, the captains finish it, the result goes back through the module', () => {
    const w = testWorld({ modules: [seabattle], factions: 2 });
    const player = w.factionIds[0]!;
    const ai = w.factionIds[1]!;
    const started = inDraft(w.state, w.env, (_d, ctx) => {
      const e: EffectData = { op: 'startSeaBattle', attacker: { fleetId: w.fleetIds[player]![0]! }, defender: { fleetId: w.fleetIds[ai]![0]! }, origin: 'test', wind: { dir: 90, str: 'fresh' }, arena: 'openSea' };
      ctx.applyEffects([e]);
    }).state;
    const id = started.subsims.seaBattle!.id as `sea_${string}`;
    const before = started.meta.mode;
    const f = dispatch(started, { type: 'startSeaBattle', seaBattleId: id, mode: 'fight' }, w.env);
    expect(f.error).toBeUndefined();
    const st: GameState = f.state;
    expect(st.meta.mode).toBe('seaBattle');
    const c = new SeaController(st.subsims.seaBattle!.setup, content, t);
    c.setPaused(false);
    for (let i = 0; i < 30; i++) c.frame(1 / 30);
    c.letCaptainsFinish();
    play(c);
    const result = c.result()!;
    expect(result).not.toBeNull();
    const a = dispatch(st, { type: 'applySeaBattleResult', seaBattleId: id, result }, w.env);
    expect(a.error).toBeUndefined();
    expect(a.state.meta.mode).toBe(before);
    expect(a.state.pending).toBeNull();
    expect(a.state.subsims.seaBattle?.status).toBe('resolved');
  });
});
