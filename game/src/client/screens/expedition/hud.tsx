/**
 * The helm strip on the sea chart (mode 'map'; ARCHITECTURE §20): a compact strip at the foot of the chart with
 * where the fleet is in words, food as days, men and a wind arrow, and at most three orders: "Chart a course" (the
 * known-harbours picker and, when a place is selected on the chart, "Sail here"; expeditions' setRoute), "Go ashore"
 * (only when the ship lies against a coast; makeLandfall) or "Back to the ships" while a party is ashore, and
 * "Sail home" (returnHome). The player otherwise steers with W A S D or the arrow keys (worldMap screen); a
 * first-time hint says so until the first move. One short "next step" sentence says what to do now. An order that
 * cannot succeed (no ship afloat, no crew, no one left to lead, home iced in) is greyed out and its tooltip says why;
 * "Sail home" stays open for a fleet that can no longer sail, because the survivors always make their way home.
 *
 * On a march (a land expedition, `fleet.overland`) the strip speaks of the road instead (`MarchHelm`): where the
 * war-band is ("On the march near X"), food in days, men, and two orders: "March to" (known places on this land,
 * or the place selected on the map; expeditions' setRoute sends the war-band by road) and "March home"
 * (returnHome). The same keys steer the war-band.
 *
 * Touching home only brings the expedition to rest there (a notice says so). While it lies within reach of home
 * (`lyingAtHome`) the home order is the gold "Come home", which ends the voyage at once (returnHome).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { create } from 'zustand';
import type { Command } from '@sim/core/commands';
import type { FleetId, GameState, SettlementId } from '@sim/core/state';
import { expeditionBlock } from '@sim/modules/expeditions/lost';
import { warBandOf } from '@sim/modules/expeditions/homecoming';
import type { ExpeditionBlock } from '@sim/modules/expeditions/types';
import { zoneAt } from '@sim/modules/weather/zones';
import { isChartedAt } from '@sim/modules/world/knowledge';
import { getStaticWorld } from '@sim/modules/world/map/index';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, useT } from '../../i18n/index';
import type { MapTarget } from '../../render/map/types';
import { Button, Select, Tooltip } from '../../ui/index';
import { sumMen } from './names';
import { harbourIce, zoneIce, type HarbourIce } from './seaIce';
import './helm.css';

/** What the player should do next with the fleet (a locale key under `expeditions.hud.next.`). */
export type HudNextStep = ExpeditionBlock | 'ashore' | 'homeward' | 'sailing' | 'steering' | 'atHome' | 'iced' | 'lowFood' | 'after' | 'pick';

/** Picks the HUD's next-step hint from the fleet's situation (most pressing first). */
export function hudNextStep(f: {
  block?: ExpeditionBlock;
  ashore: boolean;
  homeward: boolean;
  sailing: boolean;
  /** The player is holding a heading (steering keys). */
  steered?: boolean;
  iced: boolean;
  foodDays: number;
  cargoTons: number;
  /** The fleet lies within reach of home: "Come home" ends the voyage. */
  atHome?: boolean;
}): HudNextStep {
  if (f.block !== undefined && (f.block !== 'noLeader' || !f.ashore)) return f.block;
  if (f.ashore) return 'ashore';
  if (f.homeward) return 'homeward';
  if (f.sailing) return f.steered === true ? 'steering' : 'sailing';
  if (f.atHome === true) return 'atHome';
  if (f.iced) return 'iced';
  if (f.foodDays <= 3) return 'lowFood';
  if (f.cargoTons > 0) return 'after';
  return 'pick';
}

/**
 * Does the expedition lie within reach of home, so that the home order ends the voyage at once ("Come home")?
 * Only once it has come back home (`fleet.cameHome`), never right after launch.
 * A fleet: at rest (not under sail) within `homeRadius` of the capital or at its harbour (the world's touch list
 * names the capital: it touched it and has not left). A march: its war-band within `homeRadius` of the capital.
 */
export function lyingAtHome(state: GameState, homeRadius: number): boolean {
  const fid = state.player.expeditionFleetId;
  const fleet = fid !== undefined ? state.fleets[fid] : undefined;
  const home = state.settlements[state.player.capitalId];
  if (!fleet || fid === undefined || !home || home.factionId !== state.player.factionId) return false;
  if (fleet.cameHome !== true) return false;
  const near = (p: { x: number; y: number }) => (p.x - home.mapPos.x) ** 2 + (p.y - home.mapPos.y) ** 2 <= homeRadius ** 2;
  if (fleet.overland !== undefined) {
    const armyId = warBandOf(state, fid);
    const band = armyId !== undefined ? state.armies[armyId] : undefined;
    return band !== undefined && near(band.pos);
  }
  if (fleet.mode === 'sailing') return false;
  return near(fleet.pos) || (state.world?.touch?.[fid] ?? []).includes(home.id);
}

/** Why each of the HUD's orders cannot succeed now (a locale key under `expeditions.hud.blocked.`), if it cannot. */
export interface HudBlocks {
  /** Sail (the harbour list) and Sail here. */
  sail?: ExpeditionBlock;
  landfall?: ExpeditionBlock;
  /** Sail home: only the ice at home stops it (a fleet that cannot sail is brought home as lost). */
  home?: 'homeIced';
  /** The fleet can no longer sail: Sail home ends the expedition as lost. */
  lost: boolean;
}

/**
 * The HUD's order gates for the player's expedition (pure). `homeIced`: the home harbour is iced in now;
 * `atHome`: the fleet lies within reach of the home harbour (it stands down there even in ice).
 */
export function hudBlocks(state: GameState, opts: { homeIced: boolean; atHome: boolean }): HudBlocks {
  const block = expeditionBlock(state);
  const lost = block === 'noShips' || block === 'noCrew' || block === 'noMen';
  const out: HudBlocks = { lost };
  if (block !== undefined) {
    out.sail = block;
    out.landfall = block;
  }
  if (!lost && opts.homeIced && !opts.atHome) out.home = 'homeIced';
  return out;
}

/** The setRoute destination for a map selection (null: nowhere a fleet can be sent). */
export function routeTargetOf(target: MapTarget | null): Extract<Command, { type: 'setRoute' }>['to'] | null {
  if (!target) return null;
  if (target.kind === 'settlement')
    return target.settlementId !== undefined ? { settlementId: target.settlementId } : null;
  if (target.kind === 'site') return target.siteId !== undefined ? { siteId: target.siteId } : null;
  if (target.kind === 'sea') return { x: target.pos[0], y: target.pos[1] };
  return null;
}

/** Charted coastal settlements of other houses, nearest to a point first (the panel's quick destinations). */
export function knownHarbours(state: GameState, from: { x: number; y: number }, limit = 16): SettlementId[] {
  const k = state.knowledge;
  const out: { id: SettlementId; d: number }[] = [];
  for (const s of Object.values(state.settlements)) {
    if (!s.coastal || s.factionId === state.player.factionId) continue;
    const known =
      k === undefined || isChartedAt(k, s.mapPos.x, s.mapPos.y) || Object.hasOwn(k.visited ?? {}, s.id);
    if (!known) continue;
    out.push({ id: s.id, d: (s.mapPos.x - from.x) ** 2 + (s.mapPos.y - from.y) ** 2 });
  }
  return out
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((o) => o.id);
}

/** Where the fleet (or the party ashore) is, in words: a locale key under `expeditions.hud.where.` and its vars. */
export function whereWords(
  state: GameState,
  pos: { x: number; y: number },
  opts: { ashore: boolean; docked: boolean; zoneName?: string; nearCells?: number },
): { key: 'near' | 'harbour' | 'ashore' | 'zone' | 'open'; vars: Record<string, string> } {
  const near = opts.nearCells ?? 10;
  const k = state.knowledge;
  let best: { name: string; d: number } | undefined;
  for (const s of Object.values(state.settlements)) {
    const d = (s.mapPos.x - pos.x) ** 2 + (s.mapPos.y - pos.y) ** 2;
    if (d > near * near || (best && d >= best.d)) continue;
    const known =
      s.factionId === state.player.factionId ||
      k === undefined ||
      isChartedAt(k, s.mapPos.x, s.mapPos.y) ||
      Object.hasOwn(k.visited ?? {}, s.id);
    if (known) best = { name: s.name, d };
  }
  if (opts.ashore && best) return { key: 'ashore', vars: { place: best.name } };
  if (opts.docked && best) return { key: 'harbour', vars: { place: best.name } };
  if (best) return { key: 'near', vars: { place: best.name } };
  if (opts.zoneName !== undefined) return { key: 'zone', vars: { zone: opts.zoneName } };
  return { key: 'open', vars: {} };
}

// ---------------------------------------------------------------------------------------------
// The first-time steering hint (remembered in this browser).

const HINT_KEY = 'bardia.hint.steer';

function hintSeenStored(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the player has steered once (the hint is then gone for good). */
export const useSteerHint = create<{ seen: boolean }>(() => ({ seen: hintSeenStored() }));

/** Dismisses the steering hint (on the first move) and remembers it. */
export function markSteerHintSeen(): void {
  if (useSteerHint.getState().seen) return;
  useSteerHint.setState({ seen: true });
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* private window: the hint simply shows again next time */
  }
}

/** The ship lies against a coast (a sea cell within this many cells of land): men can go ashore. */
const COAST_CELLS = 2.5;

export function ExpeditionHud({
  state,
  selected,
}: {
  state: GameState;
  selected: MapTarget | null;
}): ReactElement | null {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const hintSeen = useSteerHint((s) => s.seen);
  const [chartOpen, setChartOpen] = useState(false);
  const fleetId = state.player.expeditionFleetId as FleetId | undefined;
  const fleet = fleetId !== undefined ? state.fleets[fleetId] : undefined;
  const landParty = Object.entries(state.expeditions?.landParties ?? {}).find(([, f]) => f === fleetId)?.[0];
  const party = landParty !== undefined ? state.armies[landParty as never] : undefined;
  const focus = party?.pos ?? fleet?.pos;
  const px = focus ? Math.round(focus.x / 2) : 0;
  const py = focus ? Math.round(focus.y / 2) : 0;
  const knowledge = state.knowledge;
  // Re-sorted when the fleet has moved a few cells or the chart grew, not every hour.
  const harbours = useMemo(
    () => (fleet ? knownHarbours(state, fleet.pos) : []),
    [Math.round((fleet?.pos.x ?? 0) / 4), Math.round((fleet?.pos.y ?? 0) / 4), knowledge, fleet !== undefined],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const [dest, setDest] = useState<string>('');
  const ice = useMemo<HarbourIce>(() => {
    if (!fleet) return { iced: false };
    const zone = zoneAt(fleet.pos.x, fleet.pos.y);
    return zone !== undefined ? zoneIce(state, zone) : { iced: false };
  }, [px, py, state.time.hour - (state.time.hour % 24), fleet !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const where = useMemo(
    () =>
      focus
        ? whereWords(state, focus, {
            ashore: party !== undefined,
            docked: fleet?.mode === 'docked',
            ...(ice.zoneName !== undefined ? { zoneName: ice.zoneName } : {}),
          })
        : null,
    [px, py, party !== undefined, fleet?.mode, ice.zoneName, knowledge], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!fleet || fleetId === undefined) return null;
  if (fleet.overland !== undefined) return <MarchHelm state={state} selected={selected} />;
  const loaded = loadContent();
  const home = state.settlements[state.player.capitalId];
  const homeRadius = loaded.ok ? loaded.content.tunables.expeditions.homeRadius : 0;
  const atHome = home !== undefined && lyingAtHome(state, homeRadius);
  const homeIce = harbourIce(state);
  const blocks = hudBlocks(state, { homeIced: homeIce.iced, atHome });
  const blockedTip = (key: string | undefined, tip: string): string =>
    key !== undefined
      ? t(`expeditions.hud.blocked.${key}`, { thaw: homeIce.thawHour !== undefined ? formatGameDate(homeIce.thawHour) : '' })
      : t(tip);
  const perDay = loaded.ok ? loaded.content.balance.food.rationsPerManPerDay : 1;
  const men = sumMen(fleet.men);
  const days = men > 0 ? Math.floor(fleet.rations / Math.max(1, Math.ceil(men * perDay))) : 0;
  let cargo = 0;
  for (const [g, v] of Object.entries(fleet.cargo)) if (g !== 'rations') cargo += Math.max(0, v ?? 0);
  const target = fleet.routeTarget as { settlementId?: string } | undefined;
  const bound =
    target?.settlementId !== undefined ? state.settlements[target.settlementId as never]?.name : undefined;
  const pick = dest !== '' && harbours.includes(dest as SettlementId) ? (dest as SettlementId) : harbours[0];
  const sailing = fleet.route.length > 0;
  const steered = fleet.steer !== undefined || party?.steer !== undefined;
  const to = routeTargetOf(selected);
  const pending = state.pending !== null;
  const status = fleet.homeward
    ? t('expeditions.hud.homeward', { eta: fleet.eta !== undefined ? formatGameDate(fleet.eta) : '—' })
    : fleet.steer !== undefined
      ? t('expeditions.hud.steering', { dir: t(`expeditions.hud.heading.${fleet.steer}`) })
      : sailing
        ? bound !== undefined
          ? t('expeditions.hud.sailingTo', {
              place: bound,
              eta: fleet.eta !== undefined ? formatGameDate(fleet.eta) : '—',
            })
          : t('expeditions.hud.sailing')
        : t(`expeditions.hud.mode.${fleet.mode}`);
  const next = hudNextStep({
    ...(blocks.sail !== undefined ? { block: blocks.sail } : {}),
    ashore: landParty !== undefined,
    homeward: fleet.homeward === true,
    sailing,
    steered,
    iced: ice.iced,
    foodDays: days,
    cargoTons: cargo,
    atHome: atHome && !landParty,
  });
  const comeHome = atHome && !landParty && !blocks.lost;
  // Men can go ashore when the ship lies still against a coast (not in harbour, not under way).
  const world = getStaticWorld();
  const cell = Math.floor(fleet.pos.y) * world.width + Math.floor(fleet.pos.x);
  const againstCoast = cell >= 0 && cell < world.coastDist.length && (world.coastDist[cell] as number) <= COAST_CELLS;
  const canAshore = !landParty && !sailing && fleet.mode !== 'docked' && againstCoast;
  const windZone = fleet.seaZoneId ?? ice.zoneId;
  const wind = windZone != null && state.weather?.zones && Object.hasOwn(state.weather.zones, windZone) ? state.weather.zones[windZone] : undefined;
  const showChart = !landParty && !fleet.homeward && (chartOpen || to !== null);

  return (
    <div
      className="xp-helm"
      data-testid="expedition-hud"
      data-mode={fleet.mode}
      data-blocked={blocks.sail}
      data-steering={steered ? 'true' : 'false'}
    >
      {showChart && (
        <div className="xp-helm-chart" data-testid="chart-course-panel">
          {to && (
            <Tooltip content={blockedTip(blocks.sail, 'expeditions.hud.tip.sailHere')}>
              <Button
                variant="primary"
                icon="ship"
                disabled={pending || blocks.sail !== undefined}
                onClick={() => {
                  dispatch({ type: 'setRoute', to });
                  setChartOpen(false);
                }}
                data-testid="order-sail-here"
              >
                {selected?.kind === 'settlement' || selected?.kind === 'site'
                  ? t('expeditions.hud.sailTo', { place: selected.name })
                  : t('expeditions.hud.sailHere')}
              </Button>
            </Tooltip>
          )}
          {harbours.length > 0 && (
            <div className="xp-helm-dest">
              <Select
                aria-label={t('expeditions.hud.destinations')}
                value={pick ?? ''}
                onChange={(e) => setDest(e.target.value)}
                data-testid="order-destination"
              >
                {harbours.map((id) => (
                  <option key={id} value={id}>
                    {state.settlements[id]?.name ?? id}
                  </option>
                ))}
              </Select>
              <Tooltip content={blockedTip(blocks.sail, 'expeditions.hud.tip.sail')}>
                <Button
                  variant={to ? 'secondary' : 'primary'}
                  icon="ship"
                  disabled={pending || pick === undefined || blocks.sail !== undefined}
                  onClick={() => {
                    if (pick === undefined) return;
                    dispatch({ type: 'setRoute', to: { settlementId: pick } });
                    setChartOpen(false);
                  }}
                  data-testid="order-sail-destination"
                >
                  {t('expeditions.hud.sail')}
                </Button>
              </Tooltip>
            </div>
          )}
          {harbours.length === 0 && !to && <p className="xp-helm-none">{t('expeditions.hud.noHarbours')}</p>}
        </div>
      )}
      <div className="xp-helm-strip">
        <div className="xp-helm-where">
          <span
            className="xp-helm-wind"
            title={wind ? t(`map.wind.${wind.windStr}`) : t('map.ui.windRose')}
            data-testid="expedition-wind"
          >
            <svg viewBox="-12 -12 24 24" width="34" height="34" aria-hidden="true">
              <circle r="11" fill="none" stroke="currentColor" strokeOpacity="0.45" />
              {wind && (
                <g transform={`rotate(${wind.windDir + 180})`}>
                  <path d="M0 -9 L3.5 3 L0 0.8 L-3.5 3 Z" fill="currentColor" />
                </g>
              )}
            </svg>
          </span>
          <div className="xp-helm-words">
            <div className="xp-helm-place" data-testid="expedition-where">
              {where ? t(`expeditions.hud.where.${where.key}`, where.vars) : ''}
            </div>
            <div className="xp-helm-status" data-testid="expedition-status">
              {status}
            </div>
          </div>
        </div>
        <div className="xp-helm-stats">
          <div className={days <= 3 ? 'tone-bad' : days <= 7 ? 'tone-warn' : undefined} data-testid="expedition-food">
            <span>{t('expeditions.hud.food')}</span>
            <strong>{t('expeditions.hud.foodValue', { days })}</strong>
          </div>
          <div data-testid="expedition-men">
            <span>{t('expeditions.hud.men')}</span>
            <strong>{formatNumber(men + (party ? party.squads.reduce((n, sq) => n + Math.max(0, sq.men), 0) : 0))}</strong>
          </div>
        </div>
        <div className="xp-helm-actions">
          {!landParty && !fleet.homeward && (
            <Button
              variant={showChart ? 'primary' : 'secondary'}
              icon="quill"
              aria-expanded={showChart}
              disabled={pending}
              onClick={() => setChartOpen((o) => !o)}
              data-testid="order-chart"
            >
              {t('expeditions.hud.chart')}
            </Button>
          )}
          {canAshore && (
            <Tooltip content={blockedTip(blocks.landfall, 'expeditions.hud.tip.landfall')}>
              <Button
                icon="sword"
                disabled={pending || blocks.landfall !== undefined}
                onClick={() => dispatch({ type: 'makeLandfall' })}
                data-testid="order-landfall"
              >
                {t('expeditions.hud.landfall')}
              </Button>
            </Tooltip>
          )}
          {landParty && (
            <Tooltip content={t('expeditions.hud.tip.reboard')}>
              <Button
                icon="ship"
                disabled={pending}
                onClick={() => dispatch({ type: 'returnToShips', armyId: landParty as never })}
                data-testid="order-reboard"
              >
                {t('expeditions.hud.reboard')}
              </Button>
            </Tooltip>
          )}
          {((!fleet.homeward && !landParty) || blocks.lost) && (
            <Tooltip
              content={
                blocks.lost
                  ? t('expeditions.hud.tip.homeLost')
                  : comeHome
                    ? t('expeditions.hud.tip.comeHome')
                    : blockedTip(blocks.home, 'expeditions.hud.tip.homeStores')
              }
            >
              <Button
                variant={comeHome ? 'primary' : 'secondary'}
                icon="crown"
                disabled={pending || blocks.home !== undefined}
                onClick={() => dispatch({ type: 'returnHome' })}
                data-testid="order-home"
                data-at-home={comeHome ? 'true' : 'false'}
              >
                {comeHome ? t('expeditions.hud.comeHome') : t('expeditions.hud.home')}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <p className="xp-helm-next" data-testid="expedition-next" data-step={next}>
        {t(`expeditions.hud.next.${next}`, {
          thaw: ice.thawHour !== undefined ? formatGameDate(ice.thawHour) : '',
        })}
      </p>
      {!hintSeen && (
        <p className="xp-helm-hint" data-testid="steer-hint">
          <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> {t('expeditions.hud.steerHint')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The march: the helm strip of a land expedition.

/** What the player should do next on the march (a locale key under `expeditions.hud.march.next.`). */
export type MarchNextStep = 'noMen' | 'noLeader' | 'homeward' | 'routed' | 'steering' | 'atHome' | 'lowFood' | 'after' | 'pick';

/** Picks the march's next-step hint (most pressing first). */
export function marchNextStep(f: { block?: ExpeditionBlock; homeward: boolean; routed: boolean; steered: boolean; foodDays: number; cargoTons: number; atHome?: boolean }): MarchNextStep {
  if (f.block === 'noMen' || f.block === 'noLeader') return f.block;
  if (f.homeward) return 'homeward';
  if (f.steered) return 'steering';
  if (f.routed) return 'routed';
  if (f.atHome === true) return 'atHome';
  if (f.foodDays <= 3) return 'lowFood';
  if (f.cargoTons > 0) return 'after';
  return 'pick';
}

/** Where a selection on the map sends a war-band (null: nowhere it can walk to). */
export function marchTargetOf(target: MapTarget | null): Extract<Command, { type: 'setRoute' }>['to'] | null {
  if (!target) return null;
  if (target.kind === 'settlement') return target.settlementId !== undefined ? { settlementId: target.settlementId } : null;
  if (target.kind === 'site') return target.siteId !== undefined ? { siteId: target.siteId } : null;
  if (target.kind === 'land') return { x: target.pos[0], y: target.pos[1] };
  return null;
}

/** Known settlements of other houses on the same land as `from` (charted or visited), nearest first. */
export function knownOverland(state: GameState, from: { x: number; y: number }, limit = 16): SettlementId[] {
  const world = getStaticWorld();
  const cellOf = (p: { x: number; y: number }) => Math.floor(p.y) * world.width + Math.floor(p.x);
  const c0 = cellOf(from);
  const comp = c0 >= 0 && c0 < world.landComponent.length ? world.landComponent[c0] : -1;
  if (comp === undefined || comp < 0) return [];
  const k = state.knowledge;
  const out: { id: SettlementId; d: number }[] = [];
  for (const s of Object.values(state.settlements)) {
    if (s.factionId === state.player.factionId) continue;
    const c = cellOf(s.mapPos);
    if (c < 0 || c >= world.landComponent.length || world.landComponent[c] !== comp) continue;
    const known = k === undefined || isChartedAt(k, s.mapPos.x, s.mapPos.y) || Object.hasOwn(k.visited ?? {}, s.id);
    if (!known) continue;
    out.push({ id: s.id, d: (s.mapPos.x - from.x) ** 2 + (s.mapPos.y - from.y) ** 2 });
  }
  return out
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((o) => o.id);
}

function MarchHelm({ state, selected }: { state: GameState; selected: MapTarget | null }): ReactElement | null {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const hintSeen = useSteerHint((s) => s.seen);
  const [chartOpen, setChartOpen] = useState(false);
  const [dest, setDest] = useState<string>('');
  const fleetId = state.player.expeditionFleetId as FleetId;
  const fleet = state.fleets[fleetId];
  const armyId = fleet ? warBandOf(state, fleetId) : undefined;
  const band = armyId !== undefined ? state.armies[armyId] : undefined;
  const pos = band?.pos ?? fleet?.pos;
  const knowledge = state.knowledge;
  const qx = Math.round((pos?.x ?? 0) / 4);
  const qy = Math.round((pos?.y ?? 0) / 4);
  const places = useMemo(() => (pos ? knownOverland(state, pos) : []), [qx, qy, knowledge, pos !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const where = useMemo(() => (pos ? whereWords(state, pos, { ashore: false, docked: false }) : null), [Math.round((pos?.x ?? 0) / 2), Math.round((pos?.y ?? 0) / 2), knowledge]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fleet) return null;
  const loaded = loadContent();
  const perDay = loaded.ok ? loaded.content.balance.food.rationsPerManPerDay : 1;
  const men = band ? band.squads.reduce((n, sq) => n + Math.max(0, sq.men), 0) : 0;
  const leaders = Object.values(state.characters).filter((c) => c.alive && c.location.kind === 'army' && c.location.id === armyId).length;
  const days = men > 0 ? Math.floor(fleet.rations / Math.max(1, Math.ceil((men + leaders) * perDay))) : 0;
  let cargo = 0;
  for (const [g, v] of Object.entries(fleet.cargo)) if (g !== 'rations') cargo += Math.max(0, v ?? 0);
  const block = expeditionBlock(state);
  const pending = state.pending !== null;
  const steered = band?.steer !== undefined;
  const routed = !steered && (band?.route.length ?? 0) > 0;
  const target = band?.routeTarget as { settlementId?: string } | undefined;
  const bound = target?.settlementId !== undefined ? state.settlements[target.settlementId as never]?.name : undefined;
  const eta = band?.eta !== undefined ? formatGameDate(band.eta) : '';
  const status = fleet.homeward
    ? t('expeditions.hud.march.homeward', { eta })
    : steered
      ? t('expeditions.hud.march.steering', { dir: t(`expeditions.hud.heading.${band?.steer ?? 'n'}`) })
      : routed
        ? bound !== undefined
          ? t('expeditions.hud.march.to', { place: bound, eta })
          : t('expeditions.hud.march.onRoad')
        : t('expeditions.hud.march.halted');
  const homeRadius = loaded.ok ? loaded.content.tunables.expeditions.homeRadius : 0;
  const comeHome = block !== 'noMen' && lyingAtHome(state, homeRadius);
  const next = marchNextStep({ ...(block !== undefined ? { block } : {}), homeward: fleet.homeward === true, routed, steered, foodDays: days, cargoTons: cargo, atHome: comeHome });
  const to = marchTargetOf(selected);
  const pick = dest !== '' && places.includes(dest as SettlementId) ? (dest as SettlementId) : places[0];
  const orderBlock = block === 'noLeader' ? block : undefined;
  const showChart = !fleet.homeward && (chartOpen || to !== null);
  const whereKey = where?.key === 'near' ? 'near' : 'open';
  return (
    <div className="xp-helm" data-testid="expedition-hud" data-travel="land" data-mode="march" data-blocked={block} data-steering={steered ? 'true' : 'false'}>
      {showChart && (
        <div className="xp-helm-chart" data-testid="chart-course-panel">
          {to && (
            <Tooltip content={orderBlock !== undefined ? t(`expeditions.hud.blocked.${orderBlock}`) : t('expeditions.hud.march.tip.here')}>
              <Button
                variant="primary"
                icon="men"
                disabled={pending || orderBlock !== undefined}
                onClick={() => {
                  dispatch({ type: 'setRoute', to });
                  setChartOpen(false);
                }}
                data-testid="order-march-here"
              >
                {selected?.kind === 'settlement' || selected?.kind === 'site' ? t('expeditions.hud.march.toPlace', { place: selected.name }) : t('expeditions.hud.march.here')}
              </Button>
            </Tooltip>
          )}
          {places.length > 0 && (
            <div className="xp-helm-dest">
              <Select aria-label={t('expeditions.hud.march.places')} value={pick ?? ''} onChange={(e) => setDest(e.target.value)} data-testid="order-destination">
                {places.map((id) => (
                  <option key={id} value={id}>
                    {state.settlements[id]?.name ?? id}
                  </option>
                ))}
              </Select>
              <Tooltip content={orderBlock !== undefined ? t(`expeditions.hud.blocked.${orderBlock}`) : t('expeditions.hud.march.tip.go')}>
                <Button
                  variant={to ? 'secondary' : 'primary'}
                  icon="men"
                  disabled={pending || pick === undefined || orderBlock !== undefined}
                  onClick={() => {
                    if (pick === undefined) return;
                    dispatch({ type: 'setRoute', to: { settlementId: pick } });
                    setChartOpen(false);
                  }}
                  data-testid="order-march-destination"
                >
                  {t('expeditions.hud.march.go')}
                </Button>
              </Tooltip>
            </div>
          )}
          {places.length === 0 && !to && <p className="xp-helm-none">{t('expeditions.hud.march.noPlaces')}</p>}
        </div>
      )}
      <div className="xp-helm-strip">
        <div className="xp-helm-where">
          <span className="xp-helm-wind xp-helm-banner" aria-hidden="true">
            <svg viewBox="-12 -12 24 24" width="34" height="34">
              <circle r="11" fill="none" stroke="currentColor" strokeOpacity="0.45" />
              <path d="M-4 9 L-4 -9 M-4 -9 L6 -6 L-4 -2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="xp-helm-words">
            <div className="xp-helm-place" data-testid="expedition-where">
              {t(`expeditions.hud.march.where.${whereKey}`, where?.vars ?? {})}
            </div>
            <div className="xp-helm-status" data-testid="expedition-status">
              {status}
            </div>
          </div>
        </div>
        <div className="xp-helm-stats">
          <div className={days <= 3 ? 'tone-bad' : days <= 7 ? 'tone-warn' : undefined} data-testid="expedition-food">
            <span>{t('expeditions.hud.food')}</span>
            <strong>{t('expeditions.hud.foodValue', { days })}</strong>
          </div>
          <div data-testid="expedition-men">
            <span>{t('expeditions.hud.men')}</span>
            <strong>{formatNumber(men)}</strong>
          </div>
        </div>
        <div className="xp-helm-actions">
          {!fleet.homeward && (
            <Button variant={showChart ? 'primary' : 'secondary'} icon="quill" aria-expanded={showChart} disabled={pending} onClick={() => setChartOpen((o) => !o)} data-testid="order-chart">
              {t('expeditions.hud.march.chart')}
            </Button>
          )}
          {(!fleet.homeward || block === 'noMen') && (
            <Tooltip content={block === 'noMen' ? t('expeditions.hud.march.tip.homeLost') : comeHome ? t('expeditions.hud.march.tip.comeHome') : t('expeditions.hud.march.tip.home')}>
              <Button variant={comeHome ? 'primary' : 'secondary'} icon="crown" disabled={pending} onClick={() => dispatch({ type: 'returnHome' })} data-testid="order-home" data-at-home={comeHome ? 'true' : 'false'}>
                {comeHome ? t('expeditions.hud.comeHome') : t('expeditions.hud.march.home')}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <p className="xp-helm-next" data-testid="expedition-next" data-step={next}>
        {t(`expeditions.hud.march.next.${next}`)}
      </p>
      {!hintSeen && (
        <p className="xp-helm-hint" data-testid="steer-hint">
          <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> {t('expeditions.hud.march.steerHint')}
        </p>
      )}
    </div>
  );
}
