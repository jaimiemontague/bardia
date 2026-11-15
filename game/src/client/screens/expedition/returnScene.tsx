/**
 * The end of a voyage as a full-screen scene (§20.7): the moment the player's expedition comes home, and the
 * moment it is lost. The sim says so with events (ExpeditionReturned, ExpeditionLost) and switches the game to
 * the hall; a watcher on the sim-event bus opens the route 'expeditionReturn' with what the scene needs, so the
 * player sees the painting before the hall:
 *
 *   - home by sea: `expeditions.scene.homecoming` (the ships rowing up the fjord, the village on the strand)
 *   - home from a march: `settlements.scene.overland` (the war-band on the rise above a settlement)
 *   - lost, by sea or on the march: `expeditions.scene.lost` (survivors walking home in the rain)
 *
 * The lost scene says everything the critical alert says, so it takes that alert off the stack when it opens.
 * One choice closes the scene; its test id `decision-choice-continue` lets the tests' "answer what is in the
 * way" helpers pass it like any one-choice decision.
 */
import { useEffect, type ReactElement } from 'react';
import type { SimEvent } from '@sim/core/events';
import type { GameState } from '@sim/core/state';
import { navigation } from '../../app/navigation';
import { useNotifications } from '../../app/notifications';
import { eventField, onSimEvents, type SimEventBatch } from '../../app/simEvents';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { SceneChoices } from '../../render/scenes/index';
import { CardScene } from '../battle/cardScene';

/** What the scene shows (the route's params: plain values only). */
export interface ReturnParams {
  kind: 'home' | 'lost';
  /** A march (on foot) rather than a voyage. */
  overland: boolean;
  place: string;
  men: number;
  silver: number;
  tons: number;
  /** Lost: why ('shipsLost', 'noCrew', 'noWayHome', 'vanished', 'noMen'). */
  cause: string;
  /** Lost: men lost on the way home. */
  menLost: number;
}

/** The expedition the watcher last saw (its fleet id and whether it marched). */
export interface WatchedExpedition {
  fleetId: string | undefined;
  overland: boolean;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The player's expedition in a state. */
export function watchedOf(state: GameState): WatchedExpedition {
  const fleetId = state.player.expeditionFleetId as string | undefined;
  const fleet = fleetId !== undefined && Object.hasOwn(state.fleets, fleetId) ? (state.fleets[fleetId as never] as { overland?: unknown } | undefined) : undefined;
  return { fleetId, overland: fleet?.overland !== undefined };
}

/**
 * The scene a batch of events calls for, given the expedition the watcher saw before it (pure): a loss wins
 * over the homecoming the same batch also reports; another house's fleet coming home is not the player's.
 */
export function returnSceneFor(events: readonly SimEvent[], state: GameState, before: WatchedExpedition): ReturnParams | null {
  if (before.fleetId === undefined) return null;
  const mine = (e: SimEvent) => eventField(e, 'fleetId') === before.fleetId;
  const lost = events.find((e) => e.type === ('ExpeditionLost' as never) && mine(e));
  const home = events.find((e) => e.type === ('ExpeditionReturned' as never) && mine(e));
  if (!lost && !home) return null;
  const atId = eventField(lost ?? home!, 'atId');
  const place = typeof atId === 'string' && Object.hasOwn(state.settlements, atId) ? (state.settlements[atId as never] as { name?: string } | undefined)?.name ?? '' : '';
  if (lost) {
    return {
      kind: 'lost',
      overland: before.overland,
      place,
      men: num(eventField(lost, 'survivors')),
      silver: num(eventField(lost, 'silverLost')),
      tons: num(eventField(lost, 'tonsLost')),
      cause: String(eventField(lost, 'cause') ?? 'vanished'),
      menLost: num(eventField(lost, 'menLost')),
    };
  }
  const goods = (eventField(home!, 'goods') ?? {}) as Record<string, number | undefined>;
  let tons = 0;
  for (const v of Object.values(goods)) tons += num(v);
  return { kind: 'home', overland: before.overland, place, men: num(eventField(home!, 'men')), silver: num(eventField(home!, 'silver')), tons: Math.round(tons * 10) / 10, cause: '', menLost: 0 };
}

/** Opens the scene when the player's expedition comes home or is lost; returns the uninstall function. */
export function watchExpeditionReturns(open: (p: ReturnParams) => void = (p) => navigation.open('expeditionReturn', { ...p })): () => void {
  let seen: WatchedExpedition = { fleetId: undefined, overland: false };
  return onSimEvents((batch: SimEventBatch) => {
    if (batch.origin !== 'startup') {
      const p = returnSceneFor(batch.events, batch.state, seen);
      if (p) open(p);
    }
    seen = watchedOf(batch.state);
  });
}

function readParams(params: ScreenProps['params']): ReturnParams {
  const p = params ?? {};
  const n = (k: string) => num(p[k]);
  return {
    kind: p['kind'] === 'lost' ? 'lost' : 'home',
    overland: p['overland'] === true,
    place: String(p['place'] ?? ''),
    men: n('men'),
    silver: n('silver'),
    tons: n('tons'),
    cause: String(p['cause'] ?? 'vanished'),
    menLost: n('menLost'),
  };
}

/** The painting of a homecoming or a loss. */
export function returnAsset(p: Pick<ReturnParams, 'kind' | 'overland'>): string {
  if (p.kind === 'lost') return 'expeditions.scene.lost';
  return p.overland ? 'settlements.scene.overland' : 'expeditions.scene.homecoming';
}

/** The scene (route 'expeditionReturn'). */
export function ReturnScene({ params, close }: ScreenProps): ReactElement {
  const t = useT();
  const p = readParams(params);
  const lost = p.kind === 'lost';
  const way = p.overland ? 'march' : 'sea';
  // The lost scene tells what the critical alert told: take that alert away.
  useEffect(() => {
    if (!lost) return;
    const n = useNotifications.getState();
    for (const c of n.critical) if (c.key.startsWith('expeditions.notify.lost.')) n.acknowledgeCritical(c.id);
  }, [lost]);
  const vars = { place: p.place, men: p.men, silver: formatNumber(p.silver), silverN: p.silver, tons: formatNumber(p.tons, { maximumFractionDigits: 1 }), tonsN: p.tons, lost: p.menLost };
  const narration = p.overland ? `expeditions.narration.lost.march.${p.cause}` : `expeditions.narration.lost.${p.cause}`;
  return (
    <CardScene
      assetId={returnAsset(p)}
      testId={lost ? 'expedition-lost-scene' : 'expedition-home-scene'}
      className="ex-return"
      data={{ kind: p.kind, way }}
      kicker={t(lost ? 'expeditions.scene.lost.kicker' : 'expeditions.scene.home.kicker', vars)}
      title={t(`expeditions.scene.${p.kind}.title.${way}`)}
      text={lost ? t(narration) : t(`expeditions.scene.home.text.${way}`, vars)}
      facts={t(lost ? 'expeditions.scene.lost.facts' : 'expeditions.scene.home.facts', vars)}
    >
      <SceneChoices
        inView={[
          {
            id: 'continue',
            label: t(`expeditions.scene.${p.kind}.continue`),
            line: t(lost ? 'expeditions.scene.lost.continueLine' : 'expeditions.scene.home.continueLine'),
            tone: 'primary',
            testId: 'decision-choice-continue',
            onPick: close,
          },
        ]}
        more={[]}
        moreLabel=""
        backLabel=""
        label={t(`expeditions.scene.${p.kind}.title.${way}`)}
      />
    </CardScene>
  );
}

export const returnScreen: ScreenDescriptor = { id: 'expeditionReturn', route: 'expeditionReturn', component: ReturnScene, layout: 'fullscreen', titleKey: 'expeditions.scene.screen' };

// One watcher for the app's lifetime (the screen registry imports every screen once at boot). A hot reload
// replaces it instead of adding a second.
type WatchHost = { __bardiaReturnWatch?: () => void };
if (typeof window !== 'undefined') {
  const host = window as unknown as WatchHost;
  host.__bardiaReturnWatch?.();
  host.__bardiaReturnWatch = watchExpeditionReturns();
}
