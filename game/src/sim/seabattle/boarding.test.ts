import { describe, expect, it } from 'vitest';
import type { CharId, DuelResult } from '@sim/core/state';
import { canGrapple, cutFreeChance, deckPower, deckRoundLosses, resolveDeckFight, tryGrapple } from './boarding';
import { SeaBattleEngine } from './engine';
import type { SeaShip } from './engineTypes';
import { DEG } from './geom';
import { updateTrig } from './physics';
import { makeSeaSetup, testSeaContentWith, type TestSeaSide } from './testing';

const content = testSeaContentWith();
const bb = content.balance.boarding;

describe('§31.13 deck fight math', () => {
  it('deckPower = men × (atk + def) × morale/60 × drakkar 1.1', () => {
    expect(deckPower(bb, { men: 30, atkEff: 4, defEff: 4, morale: 60, drakkar: false })).toBeCloseTo(240, 9);
    expect(deckPower(bb, { men: 30, atkEff: 4, defEff: 4, morale: 60, drakkar: true })).toBeCloseTo(264, 9);
    expect(deckPower(bb, { men: 30, atkEff: 4, defEff: 4, morale: 30, drakkar: false })).toBeCloseTo(120, 9);
    expect(deckPower(bb, { men: 0, atkEff: 4, defEff: 4, morale: 60, drakkar: false })).toBe(0);
  });

  it('round casualties are 0.12 × enemy/own × men, clamped to 5–35 %', () => {
    expect(deckRoundLosses(bb, 40, 100, 100)).toBeCloseTo(4.8, 9);
    expect(deckRoundLosses(bb, 40, 100, 10)).toBeCloseTo(40 * 0.05, 9);
    expect(deckRoundLosses(bb, 40, 100, 1000)).toBeCloseTo(40 * 0.35, 9);
    expect(deckRoundLosses(bb, 0, 0, 100)).toBe(0);
  });

  it('three rounds; the side with the most power left wins', () => {
    const strong = { men: 50, atkEff: 7, defEff: 8, morale: 70, drakkar: false };
    const weak = { men: 30, atkEff: 4, defEff: 4, morale: 60, drakkar: false };
    const r = resolveDeckFight(content.balance, strong, weak);
    expect(r.rounds).toHaveLength(3);
    expect(r.attackerWon).toBe(true);
    expect(r.defenderMen).toBeLessThan(30);
    const r2 = resolveDeckFight(content.balance, weak, strong);
    expect(r2.attackerWon).toBe(false);
    // Morale losses from casualties (§31.10) only make the stronger side's win clearer.
    const r3 = resolveDeckFight(content.balance, strong, weak, { attacker: 50, defender: 30 });
    expect(r3.defenderPower / r3.attackerPower).toBeLessThan(r.defenderPower / r.attackerPower);
  });

  it('cut-free chance follows base × free/(free + holders) within its clamps', () => {
    const t = content.tunables;
    expect(cutFreeChance(t, 30, 30)).toBeCloseTo(t.boarding.cutFreeBase * 0.5, 9);
    expect(cutFreeChance(t, 1, 100)).toBe(t.boarding.cutFreeMin);
    expect(cutFreeChance(t, 100, 0)).toBe(t.boarding.cutFreeMax);
  });
});

/** Two ships side by side, stopped, in an empty arena. Player = attacker flagship. */
function alongside(attacker: TestSeaSide, defender: TestSeaSide, opts: { playerCharId?: CharId; noCut?: boolean; alwaysCut?: boolean; seed?: string } = {}) {
  const c = testSeaContentWith(
    opts.noCut ? { boarding: { cutFreeMin: 0, cutFreeMax: 0 } } : opts.alwaysCut ? { boarding: { cutFreeMin: 1, cutFreeMax: 1, cutFreeBase: 1 } } : {},
  );
  const setupOpts: Parameters<typeof makeSeaSetup>[0] = { seed: opts.seed ?? 'board', arena: 'testEmpty', attacker: { isPlayer: true, ...attacker }, defender };
  if (opts.playerCharId !== undefined) setupOpts.playerCharId = opts.playerCharId;
  const e = new SeaBattleEngine(makeSeaSetup(setupOpts, c), c);
  const a = e.w.ships[0]!;
  const d = e.w.ships.find((s) => s.side === 1)!;
  place(a, 1000, 1000);
  place(d, 1000 + a.radius + d.radius + 3, 1000);
  for (const s of e.w.ships) if (s !== a && s !== d) place(s, 300 + s.idx * 50, 300);
  return { e, a, d };
}

function place(s: SeaShip, x: number, y: number): void {
  s.x = x;
  s.y = y;
  s.safeX = x;
  s.safeY = y;
  s.h = 0;
  s.v = 0;
  updateTrig(s);
}

function stepUntil(e: SeaBattleEngine, pred: () => boolean, maxSteps = 1000): void {
  for (let i = 0; i < maxSteps && !pred() && e.status === 'running'; i++) e.step();
}

describe('grappling', () => {
  it('needs ≤ 8 m between hulls and a relative speed under 1 m/s', () => {
    const { e, a, d } = alongside({ ships: ['snekkja'] }, { ships: ['snekkja'] });
    expect(canGrapple(e.w, a, d)).toBe(true);
    d.v = 1.5;
    expect(canGrapple(e.w, a, d)).toBe(false);
    d.v = 0;
    place(d, 1000 + a.radius + d.radius + 12, 1000);
    expect(canGrapple(e.w, a, d)).toBe(false);
  });

  it('a merchant crew strikes as soon as it is grappled', () => {
    const { e, a, d } = alongside({ ships: ['snekkja'] }, { ships: ['knarr'], role: 'merchant' });
    expect(tryGrapple(e.w, a, d)).toBe(true);
    expect(d.status).toBe('captured');
    expect(d.capturedBy).toBe(0);
    expect(d.captured).toBeGreaterThan(0);
  });

  it('the grappled ship can cut free (contest) and the boarder must wait to re-grapple', () => {
    const { e, a, d } = alongside({ ships: ['drakkar'] }, { ships: ['karvi'] }, { alwaysCut: true });
    expect(tryGrapple(e.w, a, d)).toBe(true);
    stepUntil(e, () => a.grapple < 0, 100);
    expect(a.grapple).toBe(-1);
    expect(d.status).toBe('active');
    expect(a.regrappleCd).toBeGreaterThan(0);
    expect(e.drainEvents().some((ev) => ev.kind === 'cutFree')).toBe(true);
    expect(canGrapple(e.w, a, d)).toBe(false);
  });
});

describe('boarding', () => {
  it('a stronger boarding crew takes the ship after three rounds', () => {
    const { e, a, d } = alongside({ ships: [{ type: 'drakkar', crew: 85, boarders: 50, archers: 15 }] }, { ships: [{ type: 'karvi', crew: 25 }] }, { noCut: true });
    const dCrew = d.archers + d.rowers + d.boarders;
    expect(tryGrapple(e.w, a, d)).toBe(true);
    stepUntil(e, () => d.status !== 'active', 400);
    const events = e.drainEvents();
    expect(events.filter((ev) => ev.kind === 'boardingRound')).toHaveLength(3);
    expect(d.status).toBe('captured');
    expect(d.capturedBy).toBe(0);
    expect(d.captured + d.killed + d.wounded).toBeCloseTo(dCrew, 6);
    expect(a.grapple).toBe(-1);
    // Lashing (5 s) + 3 rounds × 5 s ≈ 20 battle seconds.
    expect(e.timeS).toBeGreaterThan(19);
    expect(e.timeS).toBeLessThan(25);
  });

  it('a weak boarding party is thrown back', () => {
    const { e, a, d } = alongside({ ships: [{ type: 'karvi', crew: 20, boarders: 10, archers: 4 }] }, { ships: [{ type: 'drakkar', crew: 85 }] }, { noCut: true });
    expect(tryGrapple(e.w, a, d)).toBe(true);
    stepUntil(e, () => a.grapple < 0, 400);
    expect(d.status).toBe('active');
    expect(['active', 'captured']).toContain(a.status);
    expect(e.drainEvents().some((ev) => ev.kind === 'boardingWon' && !ev.attackerWon)).toBe(true);
  });

  it('pauses for the captain duel when the player boards the enemy flagship (§14.1)', () => {
    const player = 'chr_1' as CharId;
    const enemyCaptain = 'chr_2' as CharId;
    const { e, a, d } = alongside(
      { ships: [{ type: 'drakkar', crew: 85, boarders: 50, archers: 15 }] },
      { ships: [{ type: 'snekkja', crew: 40 }], captainId: enemyCaptain },
      { playerCharId: player, noCut: true },
    );
    expect(a.captainId).toBe(player);
    expect(d.captainId).toBe(enemyCaptain);
    tryGrapple(e.w, a, d);
    stepUntil(e, () => e.status !== 'running', 400);
    expect(e.status).toBe('duelRequested');
    const req = e.duel!;
    expect(req.playerWonDeck).toBe(true);
    expect(req.setup.a.charId).toBe(player);
    expect(req.setup.b.charId).toBe(enemyCaptain);
    expect(req.setup.arena).toBe('deck');
    // Time stands still while the duel is pending.
    const t = e.timeS;
    e.step();
    expect(e.timeS).toBe(t);
    expect(e.duelRequest()).toBe(req);
    const win: DuelResult = { winnerId: player, loserFate: 'killed', injuries: [], renown: 15, autoResolved: false };
    e.resolveDuel(win);
    expect(e.status).toBe('running');
    expect(e.duelRequest()).toBeNull();
    expect(d.status).toBe('captured');
    expect(e.w.captainFates[enemyCaptain]).toBe('dead');
    expect(e.w.captainDuel).toEqual(win);
    // A stale second resolution changes nothing and is not logged.
    const logged = e.inputLog.length;
    e.resolveCaptainDuel({ winnerId: enemyCaptain, loserFate: 'killed', injuries: [], renown: 0, autoResolved: true });
    expect(e.inputLog.length).toBe(logged);
    expect(e.w.captainFates[player]).toBe('fine');
    expect(e.w.captainDuel).toEqual(win);
  });

  it('a declined duel leaves the deck fight to decide; a lost duel throws the player back', () => {
    const player = 'chr_1' as CharId;
    const enemyCaptain = 'chr_2' as CharId;
    const setupBoth = () =>
      alongside(
        { ships: [{ type: 'drakkar', crew: 85, boarders: 50, archers: 15 }, 'snekkja'] },
        { ships: [{ type: 'snekkja', crew: 40 }], captainId: enemyCaptain },
        { playerCharId: player, noCut: true },
      );
    const declined = setupBoth();
    tryGrapple(declined.e.w, declined.a, declined.d);
    stepUntil(declined.e, () => declined.e.status !== 'running', 400);
    declined.e.resolveCaptainDuel(null);
    expect(declined.d.status).toBe('captured');
    expect(declined.e.w.captainFates[enemyCaptain]).not.toBe('fine');

    const lost = setupBoth();
    tryGrapple(lost.e.w, lost.a, lost.d);
    stepUntil(lost.e, () => lost.e.status !== 'running', 400);
    lost.e.resolveCaptainDuel({ winnerId: enemyCaptain, loserFate: 'captured', injuries: [{ charId: player, injury: 'scarred' }], renown: 10, autoResolved: true });
    expect(lost.d.status).toBe('active');
    expect(lost.e.w.captainFates[player]).toBe('captured');
    expect(lost.e.w.playerShip).toBe(-1);
    expect(lost.e.w.sides[0].retreating).toBe(true);
  });

  it('headless runs never pause for duels', () => {
    const player = 'chr_1' as CharId;
    const c = testSeaContentWith({ boarding: { cutFreeMin: 0, cutFreeMax: 0 } });
    const setup = makeSeaSetup(
      { seed: 'nodu', arena: 'testEmpty', playerCharId: player, attacker: { ships: [{ type: 'drakkar', crew: 85, boarders: 50, archers: 15 }], isPlayer: true }, defender: { ships: ['snekkja'], captainId: 'chr_2' as CharId } },
      c,
    );
    const e = new SeaBattleEngine(setup, c, { offerCaptainDuels: false });
    const a = e.w.ships[0]!;
    const d = e.w.ships[1]!;
    place(a, 1000, 1000);
    place(d, 1000 + a.radius + d.radius + 3, 1000);
    a.h = 0;
    tryGrapple(e.w, a, d);
    for (let i = 0; i < 300; i++) {
      e.step();
      expect(e.status).not.toBe('duelRequested');
    }
    expect(d.status).toBe('captured');
    a.h = 90 * DEG;
  });
});
