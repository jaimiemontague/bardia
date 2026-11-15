/**
 * Why morale moves (design pillar "every rule visible"): the engine only exposes each squad's morale,
 * so the view attributes every change it sees to the causes it can observe on the field — men lost,
 * standing in smoke, friends breaking nearby, the leader or the chief falling, berserkers in the line,
 * a rally, rest — and keeps a short rolling record per squad. When a squad breaks, its record is frozen
 * as "why it broke". Presentation only: no rule here changes the battle.
 */
import type { BattleEngineEvent, BattleRenderState, SquadView } from '@sim/battle/index';

export type MoraleCause = 'losses' | 'fire' | 'friendsBroke' | 'leaderLost' | 'chiefFell' | 'berserkers' | 'shock' | 'rally' | 'recovery' | 'warHorn';

export const MORALE_CAUSES: readonly MoraleCause[] = ['losses', 'fire', 'friendsBroke', 'leaderLost', 'chiefFell', 'berserkers', 'shock', 'rally', 'recovery', 'warHorn'];

interface Sample {
  t: number;
  cause: MoraleCause;
  delta: number;
}

/** Morale change per cause over the window, largest first. */
export interface MoraleBreakdown {
  cause: MoraleCause;
  delta: number;
}

const WINDOW_S = 20;
const FRIEND_RADIUS = 9;

/** Tracks observed morale changes per squad. */
export class MoraleTracker {
  private last: Record<string, { morale: number; men: number }> = {};
  private samples: Record<string, Sample[]> = {};
  private broke: Record<string, MoraleBreakdown[]> = {};

  /**
   * Feeds a new snapshot plus the events since the previous one. `smoke` is the snapshot's set of
   * smoky tiles and `mapW` the map width (to find a squad's tile).
   */
  update(snap: BattleRenderState, events: readonly BattleEngineEvent[], mapW: number, frenzyUnits: ReadonlySet<string>): void {
    const smoke = new Set(snap.smoke);
    const byId: Record<string, SquadView> = {};
    for (const s of snap.squads) byId[s.id] = s;
    const flags: Record<string, Partial<Record<MoraleCause, true>>> = {};
    const flag = (id: string, c: MoraleCause) => ((flags[id] ??= {})[c] = true);
    for (const e of events) {
      if ((e.kind === 'routed' || e.kind === 'destroyed') && e.squad !== undefined && e.x !== undefined && e.y !== undefined) {
        for (const s of snap.squads) if (s.side === e.side && s.id !== e.squad && Math.hypot(s.x - e.x, s.y - e.y) <= FRIEND_RADIUS) flag(s.id, 'friendsBroke');
      }
      if (e.kind === 'leaderDown' && e.squad !== undefined) flag(e.squad, 'leaderLost');
      if ((e.kind === 'chiefKilled' || e.kind === 'chiefCaptured') && e.side !== undefined) for (const s of snap.squads) if (s.side === e.side) flag(s.id, 'chiefFell');
      if (e.kind === 'rally' && e.squad !== undefined && e.x !== undefined && e.y !== undefined) {
        for (const s of snap.squads) if (s.side === e.side && Math.hypot(s.x - e.x, s.y - e.y) <= 8.5) flag(s.id, 'rally');
      }
    }
    for (const s of snap.squads) {
      const prev = this.last[s.id];
      this.last[s.id] = { morale: s.morale, men: s.men };
      if (!prev) continue;
      const delta = s.morale - prev.morale;
      if (Math.abs(delta) < 0.05) continue;
      const f = flags[s.id] ?? {};
      let cause: MoraleCause;
      if (delta > 0) cause = f.rally ? 'rally' : 'recovery';
      else if (f.chiefFell) cause = 'chiefFell';
      else if (f.leaderLost) cause = 'leaderLost';
      else if (f.friendsBroke) cause = 'friendsBroke';
      else if (s.men < prev.men || (s.hpPct < 1 && delta < -0.2)) cause = 'losses';
      else if (smoke.has(Math.floor(s.y) * mapW + Math.floor(s.x))) cause = 'fire';
      else if (s.activity === 'fighting' && nearFrenzy(s, snap.squads, frenzyUnits)) cause = 'berserkers';
      else cause = 'shock';
      const list = (this.samples[s.id] ??= []);
      list.push({ t: snap.timeS, cause, delta });
      while (list.length > 0 && list[0]!.t < snap.timeS - WINDOW_S) list.shift();
      if (s.status === 'routing' && !this.broke[s.id]) this.broke[s.id] = this.breakdown(s.id);
      if (s.status === 'active' && this.broke[s.id]) delete this.broke[s.id];
    }
  }

  /** Records that a squad broke (called on the 'routed' event, before its record ages out). */
  markBroken(squadId: string): void {
    this.broke[squadId] = this.breakdown(squadId);
  }

  /** Net change per cause over the last WINDOW_S seconds (largest effect first). */
  breakdown(squadId: string): MoraleBreakdown[] {
    const sums: Partial<Record<MoraleCause, number>> = {};
    for (const smp of this.samples[squadId] ?? []) sums[smp.cause] = (sums[smp.cause] ?? 0) + smp.delta;
    return MORALE_CAUSES.filter((c) => sums[c] !== undefined && Math.abs(sums[c]!) >= 0.5)
      .map((c) => ({ cause: c, delta: Math.round(sums[c]! * 10) / 10 }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  /** The frozen reasons a squad broke (losses first), or null if it has not broken. */
  whyBroke(squadId: string): MoraleBreakdown[] | null {
    return this.broke[squadId] ?? null;
  }
}

function nearFrenzy(s: SquadView, squads: readonly SquadView[], frenzyUnits: ReadonlySet<string>): boolean {
  for (const o of squads) if (o.side !== s.side && frenzyUnits.has(o.unit) && Math.hypot(o.x - s.x, o.y - s.y) <= s.hw + o.hw + s.hd + o.hd + 1) return true;
  return false;
}
