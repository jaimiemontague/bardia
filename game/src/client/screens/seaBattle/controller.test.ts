/**
 * The sea-battle scene's driver in node: selection, the orders a right click gives, attack styles,
 * withdraw, the captains' fast-forward to a result, and the campaign path out of the scene (the
 * result handed back with the seabattle module's own applySeaBattleResult, back to the voyage).
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { dispatch } from '@sim/core/dispatch';
import type { EffectData } from '@sim/core/effects';
import type { GameState } from '@sim/core/state';
import { module as seabattle } from '@sim/seabattle/index';
import { inDraft, testWorld } from '@sim/testing';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { seaSkirmishSetup } from '../skirmish/presets';
import { SeaController } from './controller';

setMissingKeyWarnings(false);
const content = getContent();

function skirmish(id: 'seaPair' | 'seaMerchant' | 'seaStand', run = 1): SeaController {
  return new SeaController(seaSkirmishSetup(content, id, run, (k) => t(k)), content, t);
}

/** Runs real frames until the battle ends (or `maxS` real seconds). */
function play(c: SeaController, maxS = 400): void {
  for (let i = 0; i < maxS * 30 && !c.isOver(); i++) c.frame(1 / 30);
}

describe('selection', () => {
  it('starts with the flagship selected and both fleets on the water', () => {
    const c = skirmish('seaPair');
    expect(c.side).toBe('attacker');
    expect(c.selectedShips().map((s) => s.isPlayer)).toEqual([true]);
    expect(c.snap.ships.filter((s) => s.side === 'defender')).toHaveLength(2);
    expect(c.paused).toBe(true);
  });

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

  it('a right click on an enemy attacks it in each ship style', () => {
    const c = skirmish('seaPair');
    c.selectAll();
    const [flag, other] = c.roster();
    c.select([other!.idx]);
    c.setStyle('shoot');
    c.selectAll();
    const foe = c.snap.ships.find((s) => s.side === 'defender')!;
    c.commandAt(foe.x, foe.y, 3, 1);
    expect(c.ship(flag!.idx)!.order).toBe('board');
    expect(c.ship(flag!.idx)!.orderTarget).toBe(foe.idx);
    expect(c.ship(other!.idx)!.order).toBe('shoot');
    // Changing the style re-gives the order to ships already attacking.
    c.select([flag!.idx]);
    c.setStyle('shoot');
    expect(c.ship(flag!.idx)!.order).toBe('shoot');
  });

  it('ramming falls back to boarding for ships without a ram and says so', () => {
    const c = skirmish('seaPair');
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
