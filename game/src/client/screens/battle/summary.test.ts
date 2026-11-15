import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { missingKeysSeen, setMissingKeyWarnings, t } from '../../i18n/index';
import { skirmishSetup } from '../skirmish/presets';
import { BattleController } from './controller';
import { MoraleTracker } from './morale';
import { outcomeFor, summarize } from './summary';

setMissingKeyWarnings(false);
const content = getContent();

describe('the battle summary', () => {
  it('reads the outcome from the player side', () => {
    expect(outcomeFor({ winner: 'attacker', retreated: false }, 'attacker')).toBe('victory');
    expect(outcomeFor({ winner: 'defender', retreated: true }, 'attacker')).toBe('retreat');
    expect(outcomeFor({ winner: 'defender', retreated: false }, 'attacker')).toBe('defeat');
    expect(outcomeFor({ winner: 'none', retreated: false }, 'defender')).toBe('draw');
  });

  it('tallies both sides and lists the named leaders', () => {
    const c = new BattleController(skirmishSetup(content, 'field', 3), content, t);
    c.letCaptainsFinish();
    for (let i = 0; i < 2000 && c.engine.status !== 'ended'; i++) c.frame(0.016);
    const s = summarize(c.setup, c.result()!, c.side, () => undefined);
    expect(s.own.men).toBe(c.setup.attacker.squads.reduce((a, q) => a + q.men, 0));
    expect(s.own.killed + s.own.wounded + s.own.captured).toBeLessThanOrEqual(s.own.men);
    expect(s.leaders.map((l) => l.name)).toContain('Haldrek');
    expect(s.leaders[0]!.side).toBe('attacker');
  });
});

describe('the morale tracker', () => {
  it('attributes losses and remembers why a squad broke', () => {
    const m = new MoraleTracker();
    const c = new BattleController(skirmishSetup(content, 'raid', 1), content, t);
    const snap = c.snap;
    const sq = snap.squads[0]!;
    m.update(snap, [], 96, new Set());
    const hurt = { ...snap, timeS: 1, squads: [{ ...sq, morale: sq.morale - 20, men: sq.men - 5 }] };
    m.update(hurt, [], 96, new Set());
    expect(m.breakdown(sq.id)[0]).toEqual({ cause: 'losses', delta: -20 });
    const broke = { ...snap, timeS: 2, squads: [{ ...sq, morale: 5, men: sq.men - 9, status: 'routing' as const }] };
    m.update(broke, [], 96, new Set());
    expect(m.whyBroke(sq.id)?.[0]?.cause).toBe('losses');
  });
});

describe('battle strings', () => {
  it('every battle-view and skirmish string the screens asked for exists', () => {
    const c = new BattleController(skirmishSetup(content, 'assault', 2), content, t);
    c.letCaptainsFinish();
    for (let i = 0; i < 3000 && c.engine.status !== 'ended'; i++) c.frame(0.016);
    for (const e of c.engine.state.events) c.eventText(e);
    for (const b of c.snap.buildings) c.structureName(b.id);
    expect(missingKeysSeen().filter((k) => k.startsWith('battleView.') || k.startsWith('menu.skirmish') || k.startsWith('battle.'))).toEqual([]);
  });
});
