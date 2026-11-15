/**
 * The Expedition Planner (SCR-07, design §6.1; laid out by ARCHITECTURE §20): a large, calm screen with one
 * question per section. Who leads (portraits, one tap each), which ships (cards with a small picture), then
 * the two transfers that matter: the men (one TransferSlider per kind of warrior at the holding, "stay to
 * guard the town" | "sail with you", limited by the ships' benches) and the provisions ("storehouse" |
 * "aboard", each side saying in words how long the food lasts). Trade silver, trade cargo, the plain numbers
 * and the steward's full list sit behind Details. One sentence from the steward says whether all is ready or
 * names the single most important problem, beside the Launch button (disabled with the reason).
 *
 * Every rule is the expeditions module's own: `validateExpedition` runs on every change, `suggestPlan` is
 * "Quick muster", `planShortfall` is what the storehouse lacks (bought from the capital's market in one
 * click at the economy's own price, `trade` with `storehouse: true`). Launch also waits while the harbour is
 * iced in (the weather module's flag via `harbourIce`), with a one-click wait for the thaw.
 * Opened from the hall (route 'expeditionPlanner'); a successful launch switches the scene to the sea chart.
 *
 * Beside Launch the player chooses how to travel: "Set sail" (the default) or "March overland" (owner play-test
 * 2026-11-14). A march hides the ships, lets every man at the hall go, limits the provisions to what the men can
 * carry (`validateExpedition`'s `rationsCapacity`), and is allowed while the harbour is iced in.
 *
 * The painting of the ships loading on the strand (`expeditions.scene.planner`) sits behind the frame and as a
 * band behind its title (PlannerScreen). This folder also holds the homecoming and lost-expedition scenes
 * (returnScene.tsx).
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { CharId, GameState, GoodId, ShipId } from '@sim/core/state';
import {
  leadersAtHolding,
  planOrigin,
  travelOf,
  planShortfall,
  rationsAvailable,
  storehouseFor,
  shipsAtHolding,
  suggestPlan,
  validateExpedition,
} from '@sim/modules/expeditions/plan';
import type { ExpeditionIssue, ExpeditionPlan, ExpeditionPreview, TravelMode } from '@sim/modules/expeditions/types';
import { loadContent } from '../../app/content';
import { useMusicState } from '../../audio/hooks';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, tOr, useT } from '../../i18n/index';
import {
  Button,
  ChoiceCard,
  Disclosure,
  Frame,
  Icon,
  IconButton,
  Portrait,
  ShipPicture,
  StatLine,
  TransferSlider,
  recipeForCharacter,
} from '../../ui/index';
import { quoteTrade, rationsToTons } from '../settlement/knownMarkets';
import { AssetImage } from '../../assets/index';
import { Painting, useFinalPainting } from '../../render/scenes/index';
import { formatTons, goodName, shipTypeName, sumMen, unitName } from './names';
import { harbourIce, type HarbourIce } from './seaIce';
import './planner.css';

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

const DAYS_PER_MONTH = 30;
/** The provisions' "suggested" mark: a month at sea, as Quick muster plans. */
const SUGGESTED_DAYS = 30;

/** The steward's one sentence: the ice first, then the first error, then the first warning, else ready. */
function stewardIssue(preview: ExpeditionPreview): { tone: 'bad' | 'warn'; issue: ExpeditionIssue } | null {
  const error = preview.issues.find((i) => i.severity === 'error');
  if (error) return { tone: 'bad', issue: error };
  const warning = preview.issues.find((i) => i.severity === 'warning');
  return warning ? { tone: 'warn', issue: warning } : null;
}

/** The planner for a given state (exported for tests). */
export function ExpeditionPlanner({ state, onClose, art }: { state: GameState; onClose(): void; art?: string | null }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const [plan, setPlan] = useState<ExpeditionPlan>(() =>
    content ? suggestPlan(state, content, SUGGESTED_DAYS) : { leaderIds: [], shipIds: [], men: {}, rations: 0 },
  );
  const preview = useMemo(() => (content ? validateExpedition(state, content, plan) : null), [state, content, plan]);
  if (!content || !preview) return <Frame title={t('expeditions.planner.title')}>{t('expeditions.planner.noContent')}</Frame>;
  return <Planner state={state} content={content} plan={plan} setPlan={setPlan} preview={preview} onClose={onClose} art={art ?? null} />;
}

function Planner({
  state,
  content,
  plan,
  setPlan,
  preview,
  onClose,
  art,
}: {
  state: GameState;
  content: Content;
  plan: ExpeditionPlan;
  setPlan(next: ExpeditionPlan | ((p: ExpeditionPlan) => ExpeditionPlan)): void;
  preview: ExpeditionPreview;
  onClose(): void;
  /** URL of the planner's painting (the band behind the title), when there is one. */
  art: string | null;
}): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const fromId = planOrigin(state, plan) ?? state.player.capitalId;
  const home = state.settlements[fromId];
  const set = (patch: Partial<ExpeditionPlan>) => setPlan((p) => ({ ...p, ...patch }));
  const land = travelOf(plan) === 'land';
  // Ice closes only the sea: a march sets out in any season.
  const ice: HarbourIce = land ? { iced: false } : harbourIce(state, fromId);
  const seaIced = harbourIce(state, fromId).iced;
  const pending = state.pending !== null;
  const canLaunch = preview.ok && !ice.iced && !pending;
  /** Switches between sailing and marching: the steward's suggestion for that way, keeping the chosen leaders. */
  const chooseTravel = (mode: TravelMode) => {
    if (mode === travelOf(plan)) return;
    const next = suggestPlan(state, content, SUGGESTED_DAYS, mode === 'land' ? { travel: 'land' } : {});
    setPlan({ ...next, leaderIds: plan.leaderIds.length > 0 ? plan.leaderIds : next.leaderIds });
  };
  const last = state.expeditions?.lastPlan;
  const launch = () => {
    const r = dispatch({ type: 'launchExpedition', ...plan });
    if (r && !r.error) onClose();
  };
  const steward = stewardIssue(preview);

  return (
    <Frame
      size="screen"
      title={t('expeditions.planner.title')}
      subtitle={t('expeditions.planner.from', { place: home?.name ?? '' })}
      ornate
      className={`pl-planner${art ? ' has-art' : ''}`}
      {...(art ? { style: { '--pl-art': `url("${art}")` } as CSSProperties } : {})}
      actions={<IconButton icon="close" label={t('hub.planner.close')} onClick={onClose} data-testid="planner-close" />}
      footer={
        <div className="pl-footer">
          <div className="pl-steward" data-testid="planner-why" aria-live="polite">
            {ice.iced ? (
              <div className="pl-say pl-say-warn" data-testid="planner-iced">
                <Icon name="warning" />
                <span>
                  {t('expeditions.planner.iced', {
                    thaw: ice.thawHour !== undefined ? formatGameDate(ice.thawHour) : '',
                    days: ice.daysToThaw ?? 0,
                  })}{' '}
                  {t('hub.planner.marchInIce')}
                </span>
                {ice.daysToThaw !== undefined && (
                  <Button
                    size="sm"
                    icon="hourglass"
                    disabled={pending}
                    onClick={() => dispatch({ type: 'wait', days: ice.daysToThaw ?? 1 })}
                    data-testid="planner-wait-thaw"
                  >
                    {t('expeditions.planner.waitThaw', { days: ice.daysToThaw })}
                  </Button>
                )}
              </div>
            ) : steward?.tone === 'bad' ? (
              <div className="pl-say pl-say-bad" data-testid="planner-blocked">
                <Icon name="critical" />
                <span>{t('hub.planner.notYet', { issue: t(`expeditions.issue.${steward.issue.code}`, steward.issue.vars) })}</span>
              </div>
            ) : steward?.tone === 'warn' ? (
              <div className="pl-say pl-say-warn" data-testid="planner-ready-but">
                <Icon name="warning" />
                <span>{t('hub.planner.readyBut', { issue: t(`expeditions.issue.${steward.issue.code}`, steward.issue.vars) })}</span>
              </div>
            ) : (
              <div className="pl-say pl-say-good" data-testid="planner-ready">
                <Icon name="check" />
                <span>{t(land ? (seaIced ? 'hub.planner.readyMarchIced' : 'hub.planner.readyMarch') : 'hub.planner.ready')}</span>
              </div>
            )}
          </div>
          <div className="pl-actions">
            <Button icon="reset" onClick={() => setPlan(suggestPlan(state, content, SUGGESTED_DAYS))} data-testid="planner-suggest">
              {t('expeditions.planner.suggest')}
            </Button>
            <TravelChoice value={land ? 'land' : 'sea'} onChange={chooseTravel} />
            <Button variant="primary" size="lg" icon={land ? 'men' : 'ship'} disabled={!canLaunch} onClick={launch} data-autofocus data-testid="planner-launch" data-travel={land ? 'land' : 'sea'}>
              {land ? t('hub.planner.marchOut') : t('expeditions.planner.launch')}
            </Button>
          </div>
        </div>
      }
      data-testid="expedition-planner"
    >
      <div className="pl-grid">
        <div className="pl-col pl-col-who">
          <Leaders state={state} content={content} plan={plan} fromId={fromId} onToggle={(id) => set({ leaderIds: toggle(plan.leaderIds, id) })} />
          {land ? (
            <OnFoot content={content} preview={preview} />
          ) : (
            <Ships state={state} content={content} plan={plan} fromId={fromId} onToggle={(id) => set({ shipIds: toggle(plan.shipIds, id) })} />
          )}
        </div>
        <div className="pl-col pl-col-what">
          <Men state={state} content={content} plan={plan} preview={preview} fromId={fromId} set={set} />
          <Provisions state={state} content={content} plan={plan} preview={preview} fromId={fromId} set={set} pending={pending} />
          <Disclosure summary={t('hub.planner.details')} className="pl-details" data-testid="planner-details">
            <Details state={state} content={content} plan={plan} preview={preview} fromId={fromId} set={set} />
            {last && (
              <Button icon="load" onClick={() => setPlan({ ...last, fromId })} data-testid="planner-repeat">
                {t('hub.planner.repeat')}
              </Button>
            )}
          </Disclosure>
        </div>
      </div>
    </Frame>
  );
}

/** "Set sail" or "March overland": a two-way choice in the planner's footer, beside Launch. */
function TravelChoice({ value, onChange }: { value: TravelMode; onChange(mode: TravelMode): void }): ReactElement {
  const t = useT();
  const option = (mode: TravelMode, icon: 'ship' | 'men', label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === mode}
      className={`pl-travel-option${value === mode ? ' is-active' : ''}`}
      onClick={() => onChange(mode)}
      data-testid={`planner-travel-${mode}`}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="pl-travel" role="radiogroup" aria-label={t('hub.planner.travel')} data-slot="travel-mode" data-testid="planner-travel">
      {option('sea', 'ship', t('hub.planner.setSail'))}
      {option('land', 'men', t('hub.planner.marchOverland'))}
    </div>
  );
}

/** In place of the ships on a march: one plain line on what the men carry. */
function OnFoot({ content, preview }: { content: Content; preview: ExpeditionPreview }): ReactElement {
  const t = useT();
  return (
    <Section title={t('hub.planner.onFoot')}>
      <p className="pl-note pl-onfoot" data-testid="planner-on-foot">
        <Icon name="men" /> {t('hub.planner.onFootLine', { days: content.tunables.expeditions.march.foodDaysPerMan, tons: formatTons(preview.cargoCapacity) })}
      </p>
    </Section>
  );
}

function Section({ title, aside, children, className }: { title: string; aside?: ReactElement | string | null; children: ReactElement | ReactElement[] | (ReactElement | null | false)[]; className?: string }): ReactElement {
  return (
    <section className={['pl-section', className].filter(Boolean).join(' ')}>
      <header className="pl-section-head">
        <h3>{title}</h3>
        {aside && <span className="pl-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Leaders({ state, content, plan, fromId, onToggle }: { state: GameState; content: Content; plan: ExpeditionPlan; fromId: string; onToggle(id: CharId): void }): ReactElement {
  const t = useT();
  const leaders = leadersAtHolding(state, fromId as never, content.balance.character.adultAge, state.time.hour);
  return (
    <Section title={travelOf(plan) === 'land' ? t('hub.planner.whoMarches') : t('expeditions.planner.leaders')}>
      {leaders.length === 0 ? (
        <p className="pl-empty">{t('expeditions.planner.noLeaders')}</p>
      ) : (
        <div className="pl-leaders">
          {leaders.map((id) => {
            const c = state.characters[id];
            const on = plan.leaderIds.includes(id);
            const role = id === state.player.rulerId ? t('hub.planner.ruler') : tOr(`people.role.${c?.role?.kind ?? 'npc'}`, '');
            return (
              <ChoiceCard
                key={id}
                size="sm"
                className="pl-leader"
                picture={c ? <Portrait recipe={recipeForCharacter(c, state)} alt="" size="xs" initial={c.name.slice(0, 1)} /> : undefined}
                title={c?.name ?? id}
                line={role}
                selected={on}
                badge={plan.leaderIds[0] === id ? t('expeditions.planner.leads') : undefined}
                onClick={() => onToggle(id)}
                data-testid={`planner-leader-${id}`}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Ships({ state, content, plan, fromId, onToggle }: { state: GameState; content: Content; plan: ExpeditionPlan; fromId: string; onToggle(id: ShipId): void }): ReactElement {
  const t = useT();
  const ships = shipsAtHolding(state, fromId as never);
  return (
    <Section title={t('expeditions.planner.ships')}>
      {ships.length === 0 ? (
        <p className="pl-empty">{t('expeditions.planner.noShips')}</p>
      ) : (
        <div className="pl-ships">
          {ships.map((id) => {
            const ship = state.ships[id];
            const def = ship ? content.balance.ships[ship.type] : undefined;
            return (
              <ChoiceCard
                key={id}
                size="sm"
                className="pl-ship"
                picture={<ShipPicture type={ship?.type ?? ''} size="sm" />}
                title={ship?.name ?? id}
                line={t('hub.planner.shipLine', { type: ship ? shipTypeName(content, ship.type) : '', men: def?.crewMax ?? 0, tons: def?.cargoT ?? 0 })}
                selected={plan.shipIds.includes(id)}
                onClick={() => onToggle(id)}
                data-testid={`planner-ship-${id}`}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Men({
  state,
  content,
  plan,
  preview,
  fromId,
  set,
}: {
  state: GameState;
  content: Content;
  plan: ExpeditionPlan;
  preview: ExpeditionPreview;
  fromId: string;
  set(patch: Partial<ExpeditionPlan>): void;
}): ReactElement {
  const t = useT();
  const home = state.settlements[fromId as never];
  const units = Object.entries(home?.garrison ?? {}).filter(([, n]) => n > 0);
  const total = sumMen(plan.men);
  const land = travelOf(plan) === 'land';
  const noShips = !land && plan.shipIds.length === 0;
  return (
    <Section
      title={t('expeditions.planner.men')}
      aside={
        <span data-testid="planner-summary" className={!land && (preview.men < preview.crewMin || preview.men > preview.crewMax) ? 'tone-bad' : land && preview.men === 0 ? 'tone-bad' : undefined}>
          {land
            ? t('hub.planner.marchLine', { men: preview.men })
            : noShips
              ? t('hub.planner.crewNoShips', { men: preview.men })
              : t('hub.planner.crewLine', { men: preview.men, min: preview.crewMin, max: preview.crewMax })}
        </span>
      }
    >
      {units.length === 0 ? (
        <p className="pl-empty">{t('expeditions.planner.noMen')}</p>
      ) : (
        <div className="pl-men">
          <div className="pl-legend" aria-hidden="true">
            <span className="pl-legend-left">
              <Icon name="shieldRound" /> {t('hub.planner.stay')}
            </span>
            <span className="pl-legend-right">
              {land ? t('hub.planner.march') : t('hub.planner.sail')} <Icon name="men" />
            </span>
          </div>
          {units.map(([unit, have]) => {
            const mine = Math.max(0, plan.men[unit] ?? 0);
            const room = land ? have : noShips ? 0 : Math.max(0, preview.crewMax - (total - mine));
            const max = Math.min(have, room);
            return (
              <div key={unit} className="pl-unit">
                <span className="pl-unit-name">{unitName(content, unit)}</span>
                <TransferSlider
                  label={unitName(content, unit)}
                  total={have}
                  value={mine}
                  onChange={(v) => set({ men: { ...plan.men, [unit]: Math.round(v) } })}
                  left={{ label: t('hub.planner.stay'), icon: 'shieldRound' }}
                  right={{ label: land ? t('hub.planner.march') : t('hub.planner.sail'), icon: 'men' }}
                  max={max}
                  maxReason={noShips ? t('hub.planner.shipFirst') : t('hub.planner.benches', { max: preview.crewMax })}
                  bigStep={10}
                  compact
                  layout="inline"
                  data-testid={`planner-men-${unit}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Provisions({
  state,
  content,
  plan,
  preview,
  fromId,
  set,
  pending,
}: {
  state: GameState;
  content: Content;
  plan: ExpeditionPlan;
  preview: ExpeditionPreview;
  fromId: string;
  set(patch: Partial<ExpeditionPlan>): void;
  pending: boolean;
}): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const b = content.balance;
  const perTon = b.economy.rationsPerTon;
  const stores = storehouseFor(state, fromId as never);
  const available = rationsAvailable(state, fromId as never);
  const home = state.settlements[fromId as never];
  const land = travelOf(plan) === 'land';
  // On the march the leaders eat (and carry) their share too.
  const eaters = land && preview.men > 0 ? preview.men + plan.leaderIds.length : preview.men;
  const perDay = Math.max(1, eaters * b.food.rationsPerManPerDay);
  // The holds take what the cargo leaves free; on the march, what the men can carry.
  let cargoTons = 0;
  for (const v of Object.values(plan.cargo ?? {})) cargoTons += Math.max(0, v ?? 0);
  const holdRations = land ? preview.rationsCapacity : Math.max(0, Math.floor((preview.cargoCapacity - cargoTons) * perTon));
  const noShips = !land && plan.shipIds.length === 0;
  const shortfall = planShortfall(state, plan);
  const shortGoods = Object.entries(shortfall.goods) as [string, number][];
  const hasShortfall = stores !== undefined && (shortfall.rations > 0 || shortGoods.length > 0);
  const shortBatch: Record<string, number> = { rations: rationsToTons(content, shortfall.rations), ...shortfall.goods };
  if (shortBatch.rations === 0) delete shortBatch.rations;
  const shortQuote = hasShortfall ? quoteTrade(state, content, fromId as never, { kind: 'storehouse' }, { buy: shortBatch }) : undefined;
  const leftNote = (left: number) =>
    stores
      ? preview.men > 0
        ? t('hub.planner.storeLasts', { days: Math.floor(left / perDay) })
        : t('hub.planner.storeKept')
      : t('hub.planner.townKeeps', { months: Math.round((left / Math.max(1, (home?.pop ?? 1) * DAYS_PER_MONTH)) * 10) / 10 });
  const rightNote = (aboard: number) => (preview.men > 0 ? t('hub.planner.foodFor', { days: Math.floor(aboard / perDay) }) : t('hub.planner.nobodyAboard'));
  return (
    <Section
      title={t('hub.planner.provisions')}
      aside={<span data-testid="planner-stores">{stores ? t('hub.planner.fromStorehouse') : t('hub.planner.fromTown')}</span>}
    >
      <TransferSlider
        label={t('expeditions.planner.rations')}
        total={available}
        value={plan.rations}
        onChange={(v) => set({ rations: Math.round(v) })}
        left={{ label: stores ? t('hub.planner.storehouse') : t('hub.planner.townStores'), icon: 'food', note: leftNote }}
        right={{ label: land ? t('hub.planner.carried') : t('hub.planner.aboard'), icon: 'food', note: rightNote }}
        step={10}
        bigStep={Math.max(10, Math.round(perDay * 7))}
        max={noShips ? 0 : holdRations}
        maxReason={noShips ? t('hub.planner.shipFirst') : land ? t('hub.planner.carryFull') : t('hub.planner.holdsFull')}
        quick={['none']}
        marks={preview.men > 0 && !land ? [{ value: perDay * SUGGESTED_DAYS, label: t('hub.planner.daysMark', { days: SUGGESTED_DAYS }), tick: true, testId: 'planner-rations-mark-month' }] : []}
        data-testid="planner-rations"
      />
      {hasShortfall && (
        <div className="pl-shortfall" data-testid="planner-shortfall">
          <span className="tone-warn">
            <Icon name="warning" />{' '}
            {t('expeditions.planner.shortfall', {
              what: [
                ...(shortfall.rations > 0 ? [t('expeditions.planner.shortRations', { rations: formatNumber(shortfall.rations) })] : []),
                ...shortGoods.map(([g, v]) => `${goodName(g)} ${formatTons(v)} t`),
              ].join(', '),
            })}
          </span>
          <Button size="sm" icon="silver" disabled={pending || !shortQuote?.ok} onClick={() => dispatch({ type: 'trade', settlementId: fromId as never, storehouse: true, buy: shortBatch })} data-testid="planner-buy-shortfall">
            {shortQuote?.ok ? t('expeditions.planner.buyShortfall', { silver: -shortQuote.silver }) : t('expeditions.planner.buyShortfallNo')}
          </Button>
          {shortQuote && !shortQuote.ok && (
            <span className="tone-bad" data-testid="planner-shortfall-why">
              {t(`economy.error.${shortQuote.code}`)}
            </span>
          )}
        </div>
      )}
    </Section>
  );
}

/** Behind Details: trade silver and cargo, the plain numbers and every note of the steward. */
function Details({
  state,
  content,
  plan,
  preview,
  fromId,
  set,
}: {
  state: GameState;
  content: Content;
  plan: ExpeditionPlan;
  preview: ExpeditionPreview;
  fromId: string;
  set(patch: Partial<ExpeditionPlan>): void;
}): ReactElement {
  const t = useT();
  const treasury = Math.max(0, Math.floor(state.factions[state.player.factionId]?.treasury ?? 0));
  const stores = storehouseFor(state, fromId as never);
  const goods = (Object.entries(stores?.goods ?? {}) as [GoodId, number][]).filter(([, tons]) => tons > 0);
  const usedTons = preview.cargoTons;
  const land = travelOf(plan) === 'land';
  const noRoom = !land && plan.shipIds.length === 0;
  return (
    <div className="pl-details-grid">
      <div className="pl-details-col">
        <h4 className="pl-sub">{t('hub.planner.trade')}</h4>
        <TransferSlider
          label={t('expeditions.planner.silver')}
          total={treasury}
          value={plan.silver ?? 0}
          onChange={(v) => set({ silver: Math.round(v) })}
          left={{ label: t('hub.planner.treasury'), icon: 'silver' }}
          right={{ label: t('hub.planner.toTrade'), icon: 'silver' }}
          step={10}
          compact
          slots={0}
          quick={['none', 'half']}
          data-testid="planner-silver"
        />
        {goods.length === 0 ? (
          <p className="pl-empty">{t('hub.planner.noCargo')}</p>
        ) : (
          goods.map(([good, have]) => {
            const mine = Math.max(0, plan.cargo?.[good] ?? 0);
            const free = Math.max(0, preview.cargoCapacity - (usedTons - mine));
            return (
              <TransferSlider
                key={good}
                label={goodName(good)}
                total={Math.round(have * 10) / 10}
                value={mine}
                onChange={(v) => set({ cargo: { ...(plan.cargo ?? {}), [good]: Math.round(v * 10) / 10 } })}
                left={{ label: t('hub.planner.storehouseGood', { good: goodName(good) }) }}
                right={{ label: land ? t('hub.planner.carried') : t('hub.planner.aboard') }}
                step={0.1}
                max={noRoom ? 0 : Math.floor(free * 10) / 10}
                maxReason={noRoom ? t('hub.planner.shipFirst') : land ? t('hub.planner.carryFull') : t('hub.planner.holdsFull')}
                format={(n) => t('hub.planner.tons', { tons: formatTons(n) })}
                compact
                slots={0}
                data-testid={`planner-cargo-${good}`}
              />
            );
          })
        )}
      </div>
      <div className="pl-details-col">
        <h4 className="pl-sub">{t('hub.planner.numbers')}</h4>
        <div data-testid="planner-numbers">
          <StatLine icon={land ? 'men' : 'ship'} label={land ? t('hub.planner.load') : t('expeditions.planner.hold')} value={t('expeditions.planner.holdValue', { tons: formatTons(preview.cargoTons), capacity: preview.cargoCapacity })} tone={preview.cargoTons > preview.cargoCapacity ? 'bad' : undefined} />
          <StatLine icon="food" label={t('hub.planner.rationsAboard')} value={formatNumber(plan.rations)} />
          <StatLine icon="shieldRound" label={t('expeditions.planner.homeGuard')} value={t('expeditions.planner.homeGuardValue', { left: preview.homeGarrison, min: preview.homeGarrisonMin })} tone={preview.homeGarrison < preview.homeGarrisonMin ? 'warn' : undefined} />
          <StatLine icon="silver" label={t('expeditions.planner.upkeep')} value={t('expeditions.planner.upkeepValue', { silver: preview.upkeepPerMonth })} />
        </div>
        <h4 className="pl-sub">{t('expeditions.planner.checks')}</h4>
        {preview.issues.length === 0 ? (
          <p className="tone-good pl-note">
            <Icon name="check" /> {t('expeditions.planner.ready')}
          </p>
        ) : (
          <ul className="pl-issues" data-testid="planner-issues">
            {preview.issues.map((i, k) => (
              <li key={`${i.code}-${k}`} className={i.severity === 'error' ? 'tone-bad' : 'tone-warn'} data-code={i.code}>
                <Icon name={i.severity === 'error' ? 'critical' : 'warning'} /> {t(`expeditions.issue.${i.code}`, i.vars)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The planner over its painting: the strand at dawn with the ships loading (`expeditions.scene.planner`) fills
 * the room around the frame, darkened so the frame reads as a table set out on the shore, and shows again as a
 * band behind the title, so it is seen even when the frame fills a small window.
 */
function PlannerScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  useMusicState('expedition');
  const art = useFinalPainting(PLANNER_ART);
  if (!state) return <div />;
  return (
    <>
      <div className="pl-backdrop" aria-hidden="true" data-testid="planner-backdrop">
        <Painting assetId={PLANNER_ART}>
          <AssetImage id={PLANNER_ART} className="scn-final" />
        </Painting>
      </div>
      <ExpeditionPlanner state={state} onClose={close} art={art} />
    </>
  );
}

/** The planner's painting. */
export const PLANNER_ART = 'expeditions.scene.planner';

/** The homecoming and the lost expedition (route 'expeditionReturn', opened by the sim-event watcher). */
export { returnScreen } from './returnScene';

export const screen: ScreenDescriptor = {
  id: 'expeditionPlanner',
  route: 'expeditionPlanner',
  component: PlannerScreen,
  layout: 'overlay',
  titleKey: 'expeditions.planner.title',
};
