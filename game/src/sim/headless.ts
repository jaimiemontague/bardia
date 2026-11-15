/**
 * Headless resolution of pending decisions (integrator-owned; tools, soak tests, balance harnesses).
 *
 * Time never advances while a decision is pending (ARCHITECTURE §6), so a headless run needs a default
 * answer for each kind: acknowledge messages, take storylets' default choice, auto-resolve battles,
 * duels and sea battles, wait in captivity, accept the expected heir, take the first feat offered, sail on
 * from an arrival, spare a fallen settlement (else the first fate available). Kinds
 * whose owner module does not exist yet (or whose default the owner rejects) are reported back.
 *
 *   const r = resolvePendingHeadless(state, env);   // { command } or { error }
 *   session.dispatch(r.command);
 */
import type { Command } from './core/commands';
import type { GameState, PendingDecision } from './core/state';

/** The default command for a pending decision, or why there is none. */
export function headlessCommand(state: GameState, pending: PendingDecision = state.pending as PendingDecision): { command: Command } | { error: string } {
  if (!pending) return { error: 'nothing pending' };
  const p = pending.payload as unknown as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  const cmd = (c: Record<string, unknown>): { command: Command } => ({ command: c as unknown as Command });
  switch (pending.kind as string) {
    case 'message':
      return cmd({ type: 'acknowledge', pendingId: pending.id });
    case 'storylet': {
      const instanceId = str('instanceId');
      if (instanceId === undefined) return { error: 'storylet without an instance id' };
      if (typeof p['defaultChoice'] === 'number') return cmd({ type: 'storyletChoice', instanceId, choice: 'default' });
      // No default: the first choice available when it was raised.
      const choices = Array.isArray(p['choices']) ? (p['choices'] as { index?: unknown; available?: unknown }[]) : [];
      const first = choices.find((c) => c.available === true && typeof c.index === 'number');
      return first ? cmd({ type: 'storyletChoice', instanceId, choice: first.index as number }) : cmd({ type: 'storyletChoice', instanceId, choice: 'default' });
    }
    case 'battleSetup': {
      const battleId = str('battleId');
      return battleId !== undefined ? cmd({ type: 'startBattle', battleId, mode: 'auto' }) : { error: 'battleSetup without a battle id' };
    }
    case 'duel': {
      const duelId = str('duelId');
      return duelId !== undefined ? cmd({ type: 'startDuel', duelId, mode: 'auto' }) : { error: 'duel without a duel id' };
    }
    case 'seaBattle': {
      const seaBattleId = str('seaBattleId');
      return seaBattleId !== undefined ? cmd({ type: 'startSeaBattle', seaBattleId, mode: 'auto' }) : { error: 'seaBattle without an id' };
    }
    case 'captivity':
      return cmd({ type: 'captivityAction', pendingId: pending.id, choice: 'wait' });
    case 'succession': {
      const candidates = Array.isArray(p['candidates']) ? (p['candidates'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
      const heirId = str('heirId') ?? candidates[0];
      return heirId !== undefined ? cmd({ type: 'designateHeir', heirId, pendingId: pending.id }) : { error: 'succession without candidates' };
    }
    case 'featChoice': {
      const options = Array.isArray(p['options']) ? (p['options'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
      const featId = options[0];
      return featId !== undefined ? cmd({ type: 'chooseFeat', pendingId: pending.id, featId }) : { error: 'featChoice without options' };
    }
    case 'arrival':
      return cmd({ type: 'resolveArrival', choice: 'leave' });
    case 'encounter': {
      // The encounters module puts its safe default first (hail, pass, evade, slip away; yield or fall back when caught).
      const choices = Array.isArray(p['choices']) ? (p['choices'] as { disabled?: unknown; command?: unknown }[]) : [];
      const first = choices.find((c) => c.disabled !== true && c.command !== null && typeof c.command === 'object');
      if (first) return cmd(first.command as Record<string, unknown>);
      const choice = str('defaultChoice');
      return choice !== undefined ? cmd({ type: 'resolveEncounter', choice }) : { error: 'encounter without choices' };
    }
    case 'aftermath': {
      const options = Array.isArray(p['options']) ? (p['options'] as { id?: unknown; available?: unknown }[]) : [];
      const spare = options.find((o) => o.id === 'spare' && o.available === true);
      const first = spare ?? options.find((o) => o.available === true && typeof o.id === 'string');
      return first ? cmd({ type: 'chooseAftermath', fate: first.id as string }) : { error: 'aftermath without an available fate' };
    }
    default:
      return { error: `no headless default for pending '${pending.kind}'` };
  }
}
