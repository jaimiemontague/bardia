/**
 * News test fixtures (ARCHITECTURE.md §16); other modules' tests may import them.
 *
 *   const w = newsTestWorld({ cols: 6, rows: 1, spacing: 24 });   // a coastal chain, player at w.ids[0]
 *   const { state, id } = withNews(w.state, w.env, { kind: 'battle', originId: w.ids[3], importance: 3 });
 *   const later = advanceDays(state, w.env, 10).state;
 */
import { getContent, type Content } from '@content/index';
import type { Tunables as NewsTunables } from '@content/schemas/tunables/news';
import type { SimContext, SimEnv, SimModule } from '@sim/core/module';
import { advance, type AdvanceResult } from '@sim/core/scheduler';
import { createFaction, createProvince, createSettlement } from '@sim/core/factory';
import type { CultureId, FactionId, GameState, NewsId, SettlementId } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { inDraft, testEnv, testState } from '@sim/testing';
import { module as newsModule } from './index';
import { createNews } from './store';
import type { NewsSpec } from './types';

export interface NewsTestWorldOptions {
  /** Grid columns and rows (default 6 × 1: a chain). */
  cols?: number;
  rows?: number;
  /** Distance between neighbours in cells (default 24 = 120 km). */
  spacing?: number;
  /** All coastal (default true). */
  coastal?: boolean;
  /** Grid indices (row-major) that become player holdings besides index 0 (the capital). */
  playerHoldings?: number[];
  /** Extra modules (news is always included). */
  modules?: readonly SimModule[];
  seed?: string;
  /** Explicit positions instead of a grid (index 0 is the player's capital). */
  positions?: { x: number; y: number; coastal?: boolean }[];
  /** Substitute content (e.g. from `newsContent`). */
  content?: Content;
}

export interface NewsTestWorld {
  state: GameState;
  env: SimEnv;
  /** Settlement ids in grid order; ids[0] is the player's capital. */
  ids: SettlementId[];
  /** The AI faction that owns the other settlements. */
  rivalId: FactionId;
}

/**
 * A small deterministic world for news tests: the player's capital re-placed at the first grid
 * point and an AI faction holding the other settlements (player holdings as requested).
 */
export function newsTestWorld(opts: NewsTestWorldOptions = {}): NewsTestWorld {
  const cols = opts.cols ?? 6;
  const rows = opts.rows ?? 1;
  const spacing = opts.spacing ?? 24;
  const coastal = opts.coastal ?? true;
  const modules = [newsModule, ...(opts.modules ?? []).filter((m) => m.id !== 'news')];
  const content = opts.content ?? getContent();
  const env = testEnv(modules, content);
  const base = testState({ modules, content, seed: opts.seed ?? 'news-test' });
  const positions =
    opts.positions ??
    Array.from({ length: cols * rows }, (_, i) => ({ x: 100 + (i % cols) * spacing, y: 100 + Math.floor(i / cols) * spacing, coastal }));
  const ids: SettlementId[] = [];
  let rivalId = '' as FactionId;
  const r = inDraft(base, env, (draft, ctx) =>
    ctx.runAs('newsTest', () => {
      const capital = draft.settlements[draft.player.capitalId];
      if (!capital) throw new Error('newsTestWorld: no capital');
      const first = positions[0] ?? { x: 100, y: 100 };
      capital.mapPos = { x: first.x, y: first.y };
      capital.coastal = first.coastal ?? coastal;
      ids.push(capital.id);
      const rival = createFaction(draft, ctx, { culture: 'albric' as CultureId, kind: 'kingdom', treasury: 1000, name: 'Testrealm' });
      rivalId = rival.id;
      const province = createProvince(draft, { name: 'Test Province', regionId: 'testRegion', homeland: false });
      const player = draft.factions[draft.player.factionId];
      for (let i = 1; i < positions.length; i++) {
        const p = positions[i] as { x: number; y: number; coastal?: boolean };
        const mine = opts.playerHoldings?.includes(i) ?? false;
        const s = createSettlement(draft, ctx, {
          culture: 'albric' as CultureId,
          provinceId: province.id,
          factionId: mine ? draft.player.factionId : rival.id,
          tier: 'town',
          pop: 800,
          mapPos: { x: p.x, y: p.y },
          name: `Town ${i}`,
          coastal: p.coastal ?? coastal,
        });
        if (mine && player && !player.holdingIds.includes(s.id)) player.holdingIds.push(s.id);
        ids.push(s.id);
      }
    }),
  );
  return { state: r.state, env, ids, rivalId };
}

/** Returns `state` with a news item created now (or at `spec.hour`), plus its id. */
export function withNews(state: GameState, env: SimEnv, spec: NewsSpec): { state: GameState; id: NewsId; events: ReturnType<typeof inDraft>['events'] } {
  let id: NewsId | undefined;
  const r = inDraft(state, env, (draft, ctx) => {
    id = ctx.runAs('news', () => createNews(draft, ctx, spec));
  });
  if (id === undefined) throw new Error('withNews: item not created');
  return { state: r.state, id, events: r.events };
}

/** Advances whole days. */
export function advanceDays(state: GameState, env: SimEnv, days: number): AdvanceResult {
  return advance(state, days * HOURS_PER_DAY, env);
}

/** Runs `fn` as the news module inside one operation (for calling store functions in tests). */
export function asNews<T>(state: GameState, env: SimEnv, fn: (draft: GameState, ctx: SimContext) => T): { state: GameState; events: ReturnType<typeof inDraft>['events'] } {
  return inDraft(state, env, (draft, ctx) => {
    ctx.runAs('news', () => fn(draft, ctx));
  });
}

/** Deep-partial overrides of the news tunables. */
export type NewsTunablesPatch = { [K in keyof NewsTunables]?: NewsTunables[K] extends readonly unknown[] ? NewsTunables[K] : NewsTunables[K] extends object ? Partial<NewsTunables[K]> : NewsTunables[K] };

/** Content with some news tunables replaced (one level deep). */
export function newsContent(patch: NewsTunablesPatch, base: Content = getContent()): Content {
  const news = { ...base.tunables.news } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const prev = news[key];
    news[key] = prev !== null && typeof prev === 'object' && !Array.isArray(prev) && value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...prev, ...value } : value;
  }
  return { ...base, tunables: { ...base.tunables, news: news as NewsTunables } };
}
