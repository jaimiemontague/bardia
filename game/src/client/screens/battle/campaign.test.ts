/**
 * The campaign path into and out of a fought battle (full module registry, headless): raid a
 * neighbour, choose "Take the field" on the Before-the-Battle card, fight it on the battle screen's
 * controller (the captains finish it), hand the result back with applyBattleResult, and land back on
 * the scene the battle started from with no decision left hanging.
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import type { GameState, SettlementId } from '@sim/core/state';
import { GameSession } from '@sim/game';
import { headlessCommand } from '@sim/headless';
import { suggestPlan } from '@sim/modules/expeditions/plan';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { BattleController } from './controller';

setMissingKeyWarnings(false);

function nearestTarget(st: GameState): SettlementId {
  const home = st.settlements[st.player.capitalId];
  const d2 = (x: number, y: number) => (x - (home?.mapPos.x ?? 0)) ** 2 + (y - (home?.mapPos.y ?? 0)) ** 2;
  return Object.values(st.settlements)
    .filter((s) => s.coastal && s.factionId !== st.player.factionId)
    .sort((a, b) => d2(a.mapPos.x, a.mapPos.y) - d2(b.mapPos.x, b.mapPos.y))[0]!.id;
}

describe('a fought campaign battle', () => {
  it('goes from the battle setup to the field and back to the saga', () => {
    const content = getContent();
    const session = GameSession.newGame({ seed: 'battle-screen-1' });
    const run = (cmd: Command) => {
      const r = session.dispatch(cmd);
      expect(r.error).toBeUndefined();
      return r;
    };
    const answer = () => {
      const h = headlessCommand(session.getState());
      if ('command' in h) run(h.command);
    };
    // The seas are iced in through the first month: wait it out at home.
    while (session.getState().time.hour < 31 * 24) {
      if (session.getState().pending) answer();
      else session.advance(24);
    }
    while (session.getState().pending) answer();
    run({ type: 'launchExpedition', ...suggestPlan(session.getState(), content, 30) } as Command);
    run({ type: 'setRoute', to: { settlementId: nearestTarget(session.getState()) } } as Command);
    for (let d = 0; d < 40 && session.getState().pending?.kind !== 'arrival'; d++) {
      if (session.getState().pending) answer();
      else session.advance(24);
    }
    expect(session.getState().pending?.kind).toBe('arrival');
    run({ type: 'resolveArrival', choice: 'raid' } as Command);
    const pending = session.getState().pending;
    expect(pending?.kind).toBe('battleSetup');
    const battleId = (pending!.payload as { battleId: string }).battleId as `bat_${string}`;
    const modeBefore = session.getState().meta.mode;
    run({ type: 'startBattle', battleId, mode: 'fight' });
    expect(session.getState().meta.mode).toBe('battle');
    const slot = session.getState().subsims.battle!;
    expect(slot.status).toBe('running');

    const c = new BattleController(slot.setup, content, t);
    expect(c.side).toBe('attacker');
    expect(c.ownSquads().length).toBeGreaterThan(0);
    c.letCaptainsFinish();
    for (let i = 0; i < 3000 && c.engine.status !== 'ended'; i++) c.frame(0.016);
    expect(c.engine.status).toBe('ended');

    run({ type: 'applyBattleResult', battleId, result: c.result()! });
    const after = session.getState();
    expect(after.subsims.battle?.status).toBe('resolved');
    expect(after.meta.mode).toBe(modeBefore);
    expect(after.pending?.kind).not.toBe('battleSetup');
  });
});
