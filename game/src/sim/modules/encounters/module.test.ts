import { getContent } from '@content/index';
import { advance } from '@sim/core/scheduler';
import { dispatch } from '@sim/core/dispatch';
import { checkInvariants } from '@sim/core/env';
import { Rng } from '@sim/core/rng';
import type { Command } from '@sim/core/commands';
import type { SimEvent } from '@sim/core/events';
import type { ArmyId, FleetId, GameState } from '@sim/core/state';
import type { SimEnv } from '@sim/core/module';
import { headlessCommand } from '@sim/headless';
import { inDraft, missingEventKeys } from '@sim/testing';
import { describe, expect, it } from 'vitest';
import en from '../../../content/locales/en/encounters.json';
import { canField, composeEncounter, drawParty, nearbySettlements, seaChance, type EncounterPayloadFull } from './generate';
import { raiseEncounter } from './resolve';
import { encounterOptions, evadeChance, tollAcceptChance, winChance } from './rules';
import { encountersSlice, testLandParty, testVoyage, type TestVoyage } from './testing';
import { ENCOUNTER_CHOICES, type EncounterKind, type EncounterParty } from './types';

const content = getContent();
const T = content.tunables.encounters;
const L = en as Record<string, string>;

function pendingEncounter(state: GameState): EncounterPayloadFull | undefined {
  const p = state.pending;
  return p && p.kind === 'encounter' ? (p.payload as EncounterPayloadFull) : undefined;
}

/** Runs headlessly for `days`, answering every decision with its default; returns the encounters raised. */
function voyage(v: { state: GameState; env: SimEnv }, days: number): { state: GameState; encounters: EncounterPayloadFull[]; events: SimEvent[]; hours: number[] } {
  let state = v.state;
  const encounters: EncounterPayloadFull[] = [];
  const sightedHours: number[] = [];
  const events: SimEvent[] = [];
  let hours = 0;
  for (let guard = 0; hours < days * 24 && guard < 10_000; guard++) {
    const p = state.pending;
    if (p) {
      const e = pendingEncounter(state);
      if (e) {
        encounters.push(e);
        if (e.stage === 'sighted') sightedHours.push(p.hour);
      }
      const h = headlessCommand(state, p);
      if (!('command' in h)) throw new Error(h.error);
      const r = dispatch(state, h.command, v.env);
      if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
      state = r.state;
      events.push(...r.events);
      continue;
    }
    const r = advance(state, days * 24 - hours, v.env);
    hours += r.hoursAdvanced;
    state = r.state;
    events.push(...r.events);
  }
  return { state, encounters, events, hours: sightedHours };
}

/** Raises one encounter of `kind` with a party adjusted by `tweak`. */
function pend(v: TestVoyage, state: GameState, kind: EncounterKind, tweak: (p: EncounterParty) => void = () => {}, armyId?: ArmyId, rationsOffered = 500): GameState {
  return inDraft(state, v.env, (d, ctx) => {
    const fleet = d.fleets[v.fleetId];
    const men = armyId !== undefined ? 40 : Object.values(fleet?.men ?? {}).reduce((a, b) => a + b, 0);
    const party = drawParty(d, ctx.content, new Rng(`party-${kind}`), kind, men, kind === 'outlaws' ? undefined : v.neighbour);
    tweak(party);
    const payload = composeEncounter(d, ctx.content, { id: ctx.newId('enc'), kind, stage: 'sighted', fleetId: v.fleetId, ...(armyId !== undefined ? { armyId } : {}), party, variant: 1, rationsOffered }, ctx.env.effects);
    raiseEncounter(d, ctx, payload);
  }).state;
}

function answer(v: TestVoyage, state: GameState, choice: string): { state: GameState; events: SimEvent[] } {
  const r = dispatch(state, { type: 'resolveEncounter', choice } as Command, v.env);
  if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
  return { state: r.state, events: r.events };
}

const silverOf = (s: GameState, id: FleetId) => s.fleets[id]?.silver ?? 0;
const opinionOf = (s: GameState, a: string, b: string) => Object.values(s.relations).find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))?.opinion ?? 0;

describe('encounter rates (§31.4)', () => {
  it('the daily chance follows zone traffic, season and hostile shores', () => {
    const v = testVoyage();
    const fleet = v.state.fleets[v.fleetId]!;
    const calm = seaChance(v.state, content, fleet, 0);
    expect(calm.traffic).toBe(0.045);
    expect(calm.p).toBeGreaterThan(0.06);
    expect(calm.p).toBeLessThan(0.16);
    expect(seaChance(v.state, content, fleet, 1).p).toBeGreaterThan(calm.p * 1.8);
    const ocean = seaChance(testVoyage({ zone: 'westernOcean' }).state, content, testVoyage({ zone: 'westernOcean' }).state.fleets[v.fleetId]!, 0);
    expect(ocean.p).toBeLessThan(calm.p);
  });

  it('a 10-day voyage meets roughly 0–2 encounters, more in dangerous waters', () => {
    const per10 = (opts: Parameters<typeof testVoyage>[0]) => {
      let n = 0;
      const seeds = ['a', 'b', 'c', 'd', 'e', 'f'];
      for (const seed of seeds) n += voyage(testVoyage({ ...opts, seed }), 60).encounters.filter((e) => e.stage === 'sighted').length;
      return (n / (seeds.length * 60)) * 10;
    };
    const quiet = per10({ zone: 'westernOcean' });
    const normal = per10({ zone: 'whaleRoad' });
    const danger = per10({ zone: 'straits', war: true });
    expect(normal).toBeGreaterThan(0.4);
    expect(normal).toBeLessThan(2);
    expect(quiet).toBeLessThan(normal);
    expect(danger).toBeGreaterThan(normal);
    expect(danger).toBeLessThan(3.4);
  });

  it('nothing happens in harbour, in the first days of a voyage, or without an expedition', () => {
    const v = testVoyage();
    const docked = inDraft(v.state, v.env, (d) => {
      d.fleets[v.fleetId]!.mode = 'docked';
    }).state;
    expect(voyage({ state: docked, env: v.env }, 60).encounters).toEqual([]);
    const fresh = inDraft(v.state, v.env, (d) => {
      d.fleets[v.fleetId]!.voyageDays = 0;
    }).state;
    expect(voyage({ state: fresh, env: v.env }, 60).encounters).toEqual([]);
    const home = inDraft(v.state, v.env, (d) => {
      delete d.player.expeditionFleetId;
    }).state;
    expect(voyage({ state: home, env: v.env }, 60).encounters).toEqual([]);
  });

  it('keeps minDaysBetween between two encounters', () => {
    const r = voyage(testVoyage({ zone: 'straits', war: true, seed: 'gap' }), 120);
    expect(r.hours.length).toBeGreaterThan(2);
    for (let i = 1; i < r.hours.length; i++) expect((r.hours[i] ?? 0) - (r.hours[i - 1] ?? 0)).toBeGreaterThanOrEqual(T.minDaysBetween * 24);
  });

  it('a land party on the march meets outlaws and patrols', () => {
    const v = testVoyage({ seed: 'land' });
    const { state } = testLandParty(v);
    const r = voyage({ state, env: v.env }, 120);
    const kinds = r.encounters.map((e) => e.kind);
    expect(kinds.length).toBeGreaterThan(2);
    expect(kinds.every((k) => k === 'outlaws' || k === 'landPatrol')).toBe(true);
    expect(r.encounters.every((e) => e.domain === 'land' && e.armyId !== undefined)).toBe(true);
  });

  it('neutral ground (the Thingey) and the player never field ships or patrols', () => {
    const v = testVoyage();
    expect(canField(v.state, v.neighbour)).toBe(true);
    expect(canField(v.state, v.state.player.factionId)).toBe(false);
    const neutral = inDraft(v.state, v.env, (d) => {
      (d.factions[v.neighbour] as { neutral?: boolean }).neutral = true;
    }).state;
    expect(canField(neutral, v.neighbour)).toBe(false);
    const near = nearbySettlements(neutral, neutral.fleets[v.fleetId]!.pos, 60);
    expect(near.length).toBeGreaterThan(0);
    const r = voyage({ state: neutral, env: v.env }, 120);
    expect(r.encounters.every((e) => e.party.factionId !== v.neighbour)).toBe(true);
  });

  it('a real fleet in sight comes to an encounter (§8.6 visible encounters)', () => {
    const v = testVoyage({ seed: 'real' });
    const other = (v.fleetIds[v.neighbour] ?? [])[0] as FleetId;
    const state = inDraft(v.state, v.env, (d) => {
      const o = d.fleets[other]!;
      const f = d.fleets[v.fleetId]!;
      o.mode = 'sailing';
      o.pos = { x: f.pos.x + 1, y: f.pos.y };
      o.route = [{ x: 0, y: 0 }];
      o.intent = 'raid';
    }).state;
    const r = voyage({ state, env: v.env }, 30);
    const met = r.encounters.find((e) => e.otherFleetId === other);
    expect(met).toBeDefined();
    expect(met?.kind).toBe('raiders');
    expect(met?.party.factionId).toBe(v.neighbour);
  });
});

describe('the encounter card', () => {
  it('carries the generic modal fields; the first choice is enabled and safe', () => {
    const safe = ['hail', 'pass', 'evade', 'slipAway', 'yield', 'fallBack'];
    for (const kind of ['merchant', 'patrol', 'raiders', 'warfleet'] as EncounterKind[]) {
      for (const war of [false, true]) {
        const v = testVoyage({ war, seed: `card-${kind}` });
        const p = pendingEncounter(pend(v, v.state, kind))!;
        expect(typeof p.titleKey).toBe('string');
        expect(L[p.titleKey]).toBeDefined();
        expect(L[p.key]).toBeDefined();
        expect(p.choices[0]?.disabled).not.toBe(true);
        expect(safe).toContain(p.choices[0]?.id);
        expect(p.choices[0]?.id).toBe(p.defaultChoice);
        for (const c of p.choices) {
          expect(c.command).toEqual({ type: 'resolveEncounter', choice: c.id });
          expect(L[c.labelKey], c.labelKey).toBeDefined();
          if (c.previewKey !== undefined) expect(L[c.previewKey], c.previewKey).toBeDefined();
        }
      }
    }
  });

  it('greys out what cannot be done, with the reason', () => {
    const v = testVoyage({ war: true });
    const p = pendingEncounter(pend(v, v.state, 'merchant'))!;
    const hail = p.choices.find((c) => c.id === 'hail')!;
    expect(hail.disabled).toBe(true);
    expect(hail.labelKey).toBe('encounters.choice.hail.off');
    expect(hail.previewKey).toBe('encounters.reason.atWar');
    expect(p.choices.find((c) => c.id === 'trade')?.disabled).toBe(true);
    // The command is refused too.
    const r = dispatch(pend(v, v.state, 'merchant'), { type: 'resolveEncounter', choice: 'hail' } as Command, v.env);
    expect(r.error?.code).toBe('unavailable');
    expect(dispatch(v.state, { type: 'resolveEncounter', choice: 'hail' } as Command, v.env).error?.code).toBe('noEncounter');
  });

  it('names the companion whose skill counts and shows honest odds', () => {
    const v = testVoyage();
    const state = pend(v, v.state, 'raiders');
    const p = pendingEncounter(state)!;
    const evade = p.choices.find((c) => c.id === 'evade')!;
    expect(String(evade.vars?.['who'])).not.toBe('');
    const fleet = state.fleets[v.fleetId]!;
    const opt = encounterOptions(state, content, p, v.env.effects).find((o) => o.id === 'evade')!;
    expect(evade.vars?.['pct']).toBe(Math.round((opt.chance ?? 0) * 100));
    expect(opt.chance).toBeGreaterThanOrEqual(content.balance.encounters.evade.min);
    expect(fleet).toBeDefined();
  });

  it('every text variant, label, preview and reason has an English string', () => {
    for (const k of Object.keys(T.textVariants) as EncounterKind[]) {
      expect(L[`encounters.title.${k}`]).toBeDefined();
      for (let i = 1; i <= T.textVariants[k]; i++) expect(L[`encounters.sighted.${k}.${i}`], `${k}.${i}`).toBeDefined();
    }
    for (const d of ['sea', 'land']) for (let i = 1; i <= T.caughtVariants; i++) expect(L[`encounters.caught.${d}.${i}`]).toBeDefined();
    for (const c of ENCOUNTER_CHOICES) {
      expect(L[`encounters.choice.${c}`]).toBeDefined();
      expect(L[`encounters.choice.${c}.off`]).toBeDefined();
      expect(L[`encounters.preview.${c}`]).toBeDefined();
    }
    for (const s of Object.values(L)) expect(s.includes('—')).toBe(false);
  });
});

describe('answers and their consequences', () => {
  it('hail: news from their port and a little goodwill', () => {
    const v = testVoyage();
    const before = opinionOf(v.state, v.neighbour, v.state.player.factionId);
    const r = answer(v, pend(v, v.state, 'merchant'), 'hail');
    expect(v.log.ops.some((o) => o.op === 'hearNews')).toBe(true);
    expect(opinionOf(r.state, v.neighbour, r.state.player.factionId)).toBe(before + T.hail.opinion);
    expect(r.state.pending).toBeNull();
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('trade: sells some of the cargo, or buys food with silver', () => {
    const v = testVoyage({ silver: 0 });
    const laden = inDraft(v.state, v.env, (d) => {
      d.fleets[v.fleetId]!.cargo = { furs: 2 };
    }).state;
    const p = pend(v, laden, 'merchant');
    expect(pendingEncounter(p)?.deal?.kind).toBe('sell');
    const r = answer(v, p, 'trade');
    expect(r.state.fleets[v.fleetId]?.cargo.furs ?? 0).toBe(0);
    expect(silverOf(r.state, v.fleetId)).toBeGreaterThan(0);
    const v2 = testVoyage({ silver: 200 });
    const p2 = pend(v2, v2.state, 'merchant');
    const deal = pendingEncounter(p2)?.deal;
    expect(deal?.kind).toBe('buy');
    const rations0 = p2.fleets[v2.fleetId]!.rations;
    const r2 = answer(v2, p2, 'trade');
    expect(r2.state.fleets[v2.fleetId]!.rations).toBeGreaterThan(rations0);
    expect(silverOf(r2.state, v2.fleetId)).toBeLessThan(200);
    expect(missingEventKeys(r2.events)).toEqual([]);
  });

  it('payToll: silver (then food) for passage; buying off raiders costs Renown', () => {
    const v = testVoyage({ silver: 30 });
    const p = pend(v, v.state, 'raiders');
    const toll = pendingEncounter(p)!.toll;
    expect(toll.silver).toBe(30);
    expect(toll.rations).toBeGreaterThan(0);
    const r = answer(v, p, 'payToll');
    expect(silverOf(r.state, v.fleetId)).toBe(0);
    expect(r.state.fleets[v.fleetId]!.rations).toBe(p.fleets[v.fleetId]!.rations - toll.rations);
    expect(r.state.player.house.renown).toBe(Math.max(0, p.player.house.renown + T.payToll.cowedRenown));
  });

  it('demandToll: a weak trader pays up (Dread up, their lord sore); a refused patrol fights', () => {
    const v = testVoyage();
    const weak = pend(v, v.state, 'merchant', (party) => {
      party.men = { bondi: 1 };
      party.pride = 0;
      party.silver = 400;
    });
    const r = answer(v, weak, 'demandToll');
    expect(silverOf(r.state, v.fleetId)).toBeGreaterThan(0);
    expect(r.state.player.house.dread).toBe(weak.player.house.dread + T.demandToll.dread);
    expect(opinionOf(r.state, v.neighbour, r.state.player.factionId)).toBeLessThan(0);
    expect(missingEventKeys(r.events)).toEqual([]);
    const strong = pend(v, v.state, 'patrol', (party) => {
      party.men = { huscarls: 400 };
      party.pride = 15;
    });
    expect(tollAcceptChance(content.balance, 1, 100, 0, 15)).toBe(0);
    answer(v, strong, 'demandToll');
    const fight = v.log.ops.find((o) => o.op === 'startSeaBattle');
    expect(fight).toBeDefined();
    expect((fight?.['defender'] as { fleetId?: string }).fleetId).toBe(v.fleetId);
  });

  it('attack at sea: the sea battle starts with us attacking; a win brings plunder and Renown', () => {
    const v = testVoyage();
    v.end.value = 'win';
    const p = pend(v, v.state, 'merchant', (party) => {
      party.silver = 200;
      party.cargo = { amber: 2 };
    });
    const r = answer(v, p, 'attack');
    const fight = v.log.ops.find((o) => o.op === 'startSeaBattle')!;
    expect((fight['attacker'] as { fleetId?: string }).fleetId).toBe(v.fleetId);
    expect(String(fight['origin'])).toMatch(/^encounters:enc_/);
    expect(silverOf(r.state, v.fleetId)).toBe(Math.floor(200 * T.attack.plunderShare));
    expect(r.state.fleets[v.fleetId]!.cargo.amber).toBeCloseTo(2 * T.attack.plunderShare, 5);
    expect(r.state.player.house.renown).toBeGreaterThan(p.player.house.renown);
    // Striking traders who meant no harm costs Honor and their lord's goodwill.
    expect(r.state.player.house.honor).toBeLessThan(p.player.house.honor);
    expect(opinionOf(r.state, v.neighbour, r.state.player.factionId)).toBeLessThan(0);
    expect(encountersSlice(r.state).fights).toEqual({});
    expect(missingEventKeys(r.events)).toEqual([]);
  });

  it('attack ashore: the land battle starts (battle module pre-battle decision)', () => {
    const v = testVoyage();
    const { state, armyId } = testLandParty(v);
    answer(v, pend(v, state, 'outlaws', () => {}, armyId), 'attack');
    const b = v.log.ops.find((o) => o.op === 'startBattle')!;
    expect(b['kind']).toBe('field');
    expect((b['attacker'] as { armyId?: string }).armyId).toBe(armyId);
    expect(((b['defender'] as { squads: { unit: string }[] }).squads)[0]?.unit).toBe('outlaws');
  });

  it('evade: success slips away; failure against raiders leads to the "caught" card, whose default is to yield', () => {
    const fast = testVoyage({ seed: 'evade' });
    let state = fast.state;
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const r = answer(fast, pend(fast, state, 'raiders', (party) => {
        party.kn = 0.5;
        party.seafaring = 0;
      }), 'evade');
      if (r.state.pending === null) {
        ok++;
        state = r.state;
      } else state = answer(fast, r.state, 'yield').state;
    }
    expect(ok).toBeGreaterThanOrEqual(15);
    const slow = testVoyage({ seed: 'evade2', silver: 100 });
    const s = pend(slow, slow.state, 'raiders', (party) => {
      party.kn = 40;
      party.seafaring = 10;
    });
    expect(evadeChance(content.balance, 5, 40, 0, 10)).toBe(content.balance.encounters.evade.min);
    let r = answer(slow, s, 'evade');
    for (let i = 0; i < 5 && r.state.pending === null; i++) r = answer(slow, pend(slow, r.state, 'raiders', (p) => void (p.kn = 40)), 'evade');
    const caught = pendingEncounter(r.state)!;
    expect(caught.stage).toBe('caught');
    expect(caught.choices[0]?.id).toBe('yield');
    const y = answer(slow, r.state, 'yield');
    expect(silverOf(y.state, slow.fleetId)).toBeLessThan(100);
    expect(y.state.fleets[slow.fleetId]!.men).toEqual(r.state.fleets[slow.fleetId]!.men);
    expect(missingEventKeys(y.events)).toEqual([]);
  });

  it('evade against peaceful ships that will not let you by costs a day of food, never a fight', () => {
    const v = testVoyage();
    let state = v.state;
    for (let i = 0; i < 6; i++) {
      state = answer(v, pend(v, state, 'patrol', (p) => void (p.kn = 40)), 'evade').state;
      expect(state.pending).toBeNull();
    }
    expect(v.log.ops.some((o) => o.op === 'startSeaBattle')).toBe(false);
    expect(state.fleets[v.fleetId]!.rations).toBeLessThan(v.state.fleets[v.fleetId]!.rations);
  });

  it('flee: always possible, costs morale; slower pursuers never catch you', () => {
    const v = testVoyage();
    const s = pend(v, v.state, 'raiders', (p) => void (p.kn = 1));
    const p = pendingEncounter(s)!;
    expect(p.choices.find((c) => c.id === 'flee')?.vars?.['pct']).toBe(0);
    const r = answer(v, s, 'flee');
    expect(r.state.pending).toBeNull();
    expect(r.state.fleets[v.fleetId]!.morale).toBe(s.fleets[v.fleetId]!.morale - content.balance.encounters.fleeMoraleCost);
  });

  it('caught at sea, fight: they attack us', () => {
    const v = testVoyage({ seed: 'fightback' });
    let state = pend(v, v.state, 'raiders', (p) => void (p.kn = 40));
    for (let i = 0; i < 8 && pendingEncounter(state)?.stage !== 'caught'; i++) {
      const r = answer(v, state, 'evade');
      state = r.state.pending ? r.state : pend(v, r.state, 'raiders', (p) => void (p.kn = 40));
    }
    expect(pendingEncounter(state)?.stage).toBe('caught');
    answer(v, state, 'fight');
    const fight = v.log.ops.find((o) => o.op === 'startSeaBattle')!;
    expect((fight['defender'] as { fleetId?: string }).fleetId).toBe(v.fleetId);
    expect((fight['attacker'] as { role?: string }).role).toBe('raider');
  });

  it('ashore: slip past, or fall back with a few losses and never the whole party', () => {
    const v = testVoyage({ seed: 'ashore' });
    const { state, armyId } = testLandParty(v, 40);
    let s = pend(v, state, 'outlaws', (p) => void (p.wildcraft = 10), armyId);
    for (let i = 0; i < 8 && pendingEncounter(s)?.stage !== 'caught'; i++) {
      const r = answer(v, s, 'slipAway');
      s = r.state.pending ? r.state : pend(v, r.state, 'outlaws', (p) => void (p.wildcraft = 10), armyId);
    }
    const caught = pendingEncounter(s)!;
    expect(caught.stage).toBe('caught');
    expect(caught.choices[0]?.id).toBe('fallBack');
    answer(v, s, 'fallBack');
    const kills = v.log.ops.filter((o) => o.op === 'killMen');
    expect(kills.length).toBeGreaterThan(0);
    const lost = kills.reduce((a, o) => a + Number(o['count']) + Number(o['wounded'] ?? 0), 0);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(40);
  });

  it('pass leaves everything as it was', () => {
    const v = testVoyage({ war: true });
    const s = pend(v, v.state, 'merchant');
    expect(pendingEncounter(s)?.choices[0]?.id).toBe('pass');
    const r = answer(v, s, 'pass');
    expect(r.state.fleets).toEqual(s.fleets);
    expect(r.state.player.house).toEqual(s.player.house);
  });

  it('the odds helpers follow §31.4 / §31.11', () => {
    expect(winChance(content.balance, 100, 100)).toBeCloseTo(0.5, 10);
    expect(winChance(content.balance, 200, 100)).toBeGreaterThan(0.8);
    expect(tollAcceptChance(content.balance, 100, 100, 0, 0)).toBeCloseTo(0.5, 10);
    expect(evadeChance(content.balance, 5, 5, 0, 0)).toBeCloseTo(0.5, 10);
  });
});

describe('safety, determinism and invariants', () => {
  it('the default answer never starts a fight, sinks a ship or costs a man at sea', () => {
    for (const seed of ['s1', 's2', 's3']) {
      const v = testVoyage({ seed, zone: 'straits', war: true, silver: 50 });
      const men0 = v.state.fleets[v.fleetId]!.men;
      const ships0 = v.state.fleets[v.fleetId]!.shipIds;
      const r = voyage(v, 150);
      expect(r.encounters.length).toBeGreaterThan(3);
      expect(v.log.ops.some((o) => o.op === 'startSeaBattle' || o.op === 'startBattle' || o.op === 'killMen')).toBe(false);
      expect(r.state.fleets[v.fleetId]!.men).toEqual(men0);
      expect(r.state.fleets[v.fleetId]!.shipIds).toEqual(ships0);
      expect(checkInvariants(r.state, v.env)).toEqual([]);
      expect(missingEventKeys(r.events)).toEqual([]);
    }
  });

  it('same seed and inputs give identical JSON', () => {
    const run = () => JSON.stringify(voyage(testVoyage({ seed: 'det', zone: 'straits', war: true }), 90).state);
    const a = run();
    expect(run()).toBe(a);
    expect(JSON.stringify(voyage(testVoyage({ seed: 'det2', zone: 'straits', war: true }), 90).state)).not.toBe(a);
  });

  it('invariants flag an encounter with no choice that can be taken', () => {
    const v = testVoyage();
    const s = pend(v, v.state, 'merchant');
    expect(checkInvariants(s, v.env)).toEqual([]);
    const broken = inDraft(s, v.env, (d) => {
      const p = d.pending!;
      for (const c of (p.payload as EncounterPayloadFull).choices) c.disabled = true;
    }).state;
    expect(checkInvariants(broken, v.env).some((m) => m.includes('no choice'))).toBe(true);
  });

  it('a pending encounter whose fleet is gone can still be answered', () => {
    const v = testVoyage();
    const s = pend(v, v.state, 'raiders');
    const gone = inDraft(s, v.env, (d) => {
      delete d.fleets[v.fleetId];
      delete d.player.expeditionFleetId;
    }).state;
    const r = dispatch(gone, { type: 'resolveEncounter', choice: 'evade' } as Command, v.env);
    expect(r.error).toBeUndefined();
    expect(r.state.pending).toBeNull();
  });
});
