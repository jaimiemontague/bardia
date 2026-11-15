import { describe, expect, it } from 'vitest';
import type { CharId, DuelResult } from '@sim/core/state';
import { generateArena } from './arena';
import { replaySeaBattle, SeaBattleEngine } from './engine';
import type { SeaDuelRequest } from './types';
import { makeSeaSetup, testSeaContent } from './testing';

const content = testSeaContent();

function setupFor(seed: string) {
  return makeSeaSetup(
    {
      seed,
      arena: 'skerries',
      wind: { dir: 200, str: 'strong' },
      attacker: { ships: ['drakkar', 'snekkja', 'karvi'], pitchT: 2 },
      defender: { ships: ['galley', 'snekkja'], culture: 'saraleonese' },
    },
    content,
  );
}

describe('determinism', () => {
  it('same setup → identical battle, result and final snapshot', () => {
    const run = () => {
      const e = new SeaBattleEngine(setupFor('det-1'), content, { aiControlsPlayer: true });
      const r = e.runToEnd();
      return JSON.stringify({ r, snap: { ...e.snapshot(), arena: null }, events: e.drainEvents() });
    };
    expect(run()).toBe(run());
  });

  it('a different seed gives a different battle', () => {
    const a = new SeaBattleEngine(setupFor('det-1'), content, { aiControlsPlayer: true }).runToEnd();
    const b = new SeaBattleEngine(setupFor('det-2'), content, { aiControlsPlayer: true }).runToEnd();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('arena generation is a pure function of seed and template', () => {
    const opts = (seed: string) => ({ seed, templateId: 'coastal', coastBearing: 270, sizeM: content.balance.seaBattle.arenaM, tunables: content.tunables });
    const a = generateArena(opts('arena-a'));
    const a2 = generateArena(opts('arena-a'));
    const b = generateArena(opts('arena-b'));
    expect(Buffer.from(a.terrain).equals(Buffer.from(a2.terrain))).toBe(true);
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(false);
  });

  it('the input log (helm, orders, grapples, duel results) replays the battle exactly', () => {
    const player = 'chr_7' as CharId;
    const setup = makeSeaSetup(
      {
        seed: 'replay',
        arena: 'coastal',
        playerCharId: player,
        wind: { dir: 45, str: 'fresh' },
        attacker: { ships: [{ type: 'drakkar', crew: 88, boarders: 50, archers: 15 }, 'snekkja', 'snekkja'], isPlayer: true, captainId: player, pitchT: 1 },
        defender: { ships: ['snekkja', 'snekkja'], captainId: 'chr_8' as CharId },
      },
      content,
    );
    const duel = (req: SeaDuelRequest): DuelResult => ({ winnerId: req.playerCharId, loserFate: 'captured', injuries: [], renown: 12, autoResolved: true });
    const e = new SeaBattleEngine(setup, content);
    const script = (tick: number) => {
      if (tick === 1) e.input({ kind: 'helm', throttle: 1, rudder: 0.1 });
      if (tick === 40) e.input({ kind: 'orderAll', order: 'attack', target: 3 });
      if (tick === 300) e.input({ kind: 'propulsion', mode: 'oars' });
      if (tick === 500) e.input({ kind: 'target', target: 4 });
      if (tick % 50 === 0) {
        const flag = e.w.ships[e.playerShip];
        const enemy = e.w.ships.find((s) => s.side === 1 && s.status === 'active');
        if (flag && enemy) e.input({ kind: 'moveTo', x: enemy.x, y: enemy.y });
        e.input({ kind: 'grapple' });
      }
    };
    for (let i = 0; i < 9000 && e.status !== 'ended'; i++) {
      if (e.status === 'duelRequested' && e.duel) e.resolveCaptainDuel(duel(e.duel));
      script(e.tick);
      e.step();
    }
    const original = e.result() ?? e.runToEnd();
    const replayed = replaySeaBattle(setup, content, e.inputLog);
    expect(replayed.status).toBe('ended');
    expect(JSON.stringify(replayed.result())).toBe(JSON.stringify(original));
    expect(e.inputLog.length).toBeGreaterThan(10);
  });
});
