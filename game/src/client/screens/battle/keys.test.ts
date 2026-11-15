/**
 * The battle's direct-control keys on a headless controller: W A S D drive the whole band from the
 * start (and start the battle), one engine order per change of direction, Shift runs, letting go
 * halts, Space charges ahead or draws and looses an aimed volley, P pauses, Tab steps through the
 * squads, and a new selection takes over a held direction.
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { setFacing } from '@sim/battle/engine/geometry';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { skirmishSetup } from '../skirmish/presets';
import { BattleController } from './controller';
import { BattleKeys, driveStepOf, type BattleKeyEvent } from './keys';

setMissingKeyWarnings(false);
const content = getContent();

function key(code: string, mods: Partial<BattleKeyEvent> = {}): BattleKeyEvent {
  return { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...mods };
}

function setup(): { c: BattleController; k: BattleKeys } {
  const c = new BattleController(skirmishSetup(content, 'field'), content, t);
  return { c, k: new BattleKeys(c) };
}

function frames(c: BattleController, n: number): void {
  for (let i = 0; i < n; i++) c.frame(0.05);
}

function driveOrders(c: BattleController): number {
  return c.engine.replay().orders.filter((o) => o.order.kind === 'drive').length;
}

describe('battle keys (direct control)', () => {
  it('maps held directions to screen steps', () => {
    expect(driveStepOf(null)).toEqual([0, 0]);
    expect(driveStepOf('n')).toEqual([0, -1]);
    expect(driveStepOf('se')).toEqual([1, 1]);
    expect(driveStepOf('w')).toEqual([-1, 0]);
  });

  it('opens with the whole war-band selected; the first movement key starts the battle and moves everyone', () => {
    const { c, k } = setup();
    const own = c.ownSquads().map((s) => s.id);
    expect(c.selected).toEqual(own);
    expect(c.paused).toBe(true);
    const before = Object.fromEntries(c.ownSquads().map((s) => [s.id, s.y]));
    expect(k.keyDown(key('KeyW'))).toBe(true);
    expect(c.paused).toBe(false);
    frames(c, 30);
    for (const s of c.ownSquads()) expect(s.y).toBeLessThan(before[s.id]! - 1);
    expect(c.ownSquads().every((s) => s.task === 'drive')).toBe(true);
  });

  it('sends one order per change of direction, never per frame; letting go halts at once', () => {
    const { c, k } = setup();
    k.keyDown(key('KeyW'));
    frames(c, 10);
    for (let i = 0; i < 5; i++) k.keyDown(key('KeyW', { repeat: true }));
    frames(c, 10);
    expect(driveOrders(c)).toBe(1);
    k.keyDown(key('KeyD'));
    frames(c, 2);
    expect(c.driveDir).toEqual({ dx: 1, dy: -1, run: false });
    k.keyUp(key('KeyD'));
    frames(c, 2);
    expect(c.driveDir).toEqual({ dx: 0, dy: -1, run: false });
    expect(driveOrders(c)).toBe(3);
    k.keyUp(key('KeyW'));
    frames(c, 1);
    const at = c.ownSquads().map((s) => [s.x, s.y]);
    frames(c, 30);
    c.ownSquads().forEach((s, i) => {
      expect(s.task).not.toBe('drive');
      expect(Math.hypot(s.x - at[i]![0]!, s.y - at[i]![1]!)).toBeLessThan(0.3);
    });
    expect(driveOrders(c)).toBe(4);
  });

  it('arrow keys drive too; Shift runs; Ctrl+A is not a drive', () => {
    const { c, k } = setup();
    expect(k.keyDown(key('KeyA', { ctrlKey: true }))).toBe(false);
    expect(c.driveDir).toBeNull();
    k.keyDown(key('ArrowLeft'));
    expect(c.driveDir).toEqual({ dx: -1, dy: 0, run: false });
    k.keyDown(key('ShiftLeft', { shiftKey: true }));
    expect(c.driveDir).toEqual({ dx: -1, dy: 0, run: true });
    frames(c, 20);
    expect(c.ownSquads().some((s) => s.activity === 'running')).toBe(true);
    k.keyUp(key('ShiftLeft'));
    expect(c.driveDir?.run).toBe(false);
    k.releaseAll();
    expect(c.driveDir).toBeNull();
  });

  it('a new selection takes over a held direction; the squads left out halt', () => {
    const { c, k } = setup();
    k.keyDown(key('KeyS'));
    frames(c, 5);
    const ids = c.rosterIds();
    c.selectIndex(2);
    frames(c, 3);
    expect(c.driven).toEqual([ids[1]]);
    expect(c.squad(ids[1]!)!.task).toBe('drive');
    expect(c.squad(ids[0]!)!.task).not.toBe('drive');
    expect(c.squad(ids[0]!)!.held).toBe(true);
  });

  it('Tab steps through the squads one at a time (Shift+Tab back); P pauses and resumes', () => {
    const { c, k } = setup();
    const ids = c.ownSquads().map((s) => s.id);
    k.keyDown(key('Tab'));
    expect(c.selected).toEqual([ids[0]]);
    k.keyDown(key('Tab'));
    expect(c.selected).toEqual([ids[1]]);
    k.keyDown(key('Tab', { shiftKey: true }));
    k.keyDown(key('Tab', { shiftKey: true }));
    expect(c.selected).toEqual([ids[ids.length - 1]]);
    expect(c.paused).toBe(true);
    k.keyDown(key('KeyP'));
    expect(c.paused).toBe(false);
    k.keyDown(key('KeyP'));
    expect(c.paused).toBe(true);
    c.setFollow(false);
    k.keyDown(key('KeyC'));
    expect(c.cameraFollow).toBe(true);
  });

  it('Space: a melee squad charges the enemy ahead (or says there is none)', () => {
    const { c, k } = setup();
    c.setPaused(false);
    const me = c.engine.state.squads.find((s) => s.side === 0 && s.unit.canCharge && !s.unit.hasRanged)!;
    const foe = c.engine.state.squads.find((s) => s.side === 1)!;
    c.select([me.id]);
    // Nobody in front: a notice, no order.
    setFacing(me, Math.atan2(me.y - foe.y, me.x - foe.x));
    c.refresh();
    k.keyDown(key('Space'));
    k.keyUp(key('Space'));
    expect(c.notice?.key).toBe('battleView.notice.noFoeAhead');
    // Face him, bring him close: the charge goes.
    foe.x = me.x;
    foe.y = me.y - 12;
    setFacing(me, -Math.PI / 2);
    c.engine.state.sides[0].visible.fill(1);
    c.refresh();
    k.keyDown(key('Space'));
    k.keyUp(key('Space'));
    frames(c, 1);
    const view = c.squad(me.id)!;
    expect(view.task).toBe('attack');
    expect(view.taskTarget).toBe(foe.id);
    expect(view.cooldowns.charge).toBeGreaterThan(0);
  });

  it('Space: archers draw while it is held (the marker runs out along their facing) and loose where it stands', () => {
    const { c, k } = setup();
    c.setPaused(false);
    const archers = c.ownSquads().find((s) => s.abilities.includes('volley'))!;
    c.select([archers.id]);
    k.keyDown(key('Space'));
    expect(c.aiming?.squads).toEqual([archers.id]);
    const sweep = content.tunables.battle.drive.aimSweepS;
    const near = c.aimView()[0]!;
    c.realTime += sweep * 0.5;
    const mid = c.aimView()[0]!;
    const g0 = c.aimGap(archers);
    expect(g0).toBeGreaterThan(content.tunables.battle.drive.aimMinTiles);
    expect(g0).toBeLessThan(archers.range);
    // Further out along the same line.
    const dNear = Math.hypot(near.x - archers.x, near.y - archers.y);
    const dMid = Math.hypot(mid.x - archers.x, mid.y - archers.y);
    expect(dMid).toBeGreaterThan(dNear);
    const fx = Math.cos(archers.facing);
    const fy = Math.sin(archers.facing);
    expect(Math.abs((mid.x - archers.x) * fy - (mid.y - archers.y) * fx)).toBeLessThan(1e-6);
    k.keyDown(key('Space', { repeat: true }));
    k.keyUp(key('Space'));
    expect(c.aiming).toBeNull();
    frames(c, 1);
    const log = c.engine.replay().orders.map((o) => o.order);
    const volley = log.find((o) => o.kind === 'ability' && o.ability === 'volley');
    expect(volley).toBeDefined();
    if (volley?.kind === 'ability') {
      expect(volley.x).toBeCloseTo(mid.x, 6);
      expect(volley.y).toBeCloseTo(mid.y, 6);
    }
    expect(c.squad(archers.id)!.task).toBe('volley');
  });

  it('the captains taking over lets go of the keys', () => {
    const { c, k } = setup();
    k.keyDown(key('KeyW'));
    frames(c, 4);
    c.letCaptainsFinish();
    expect(c.driveDir).toBeNull();
    expect(c.driven).toEqual([]);
  });
});
