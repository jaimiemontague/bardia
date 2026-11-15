/**
 * The three decisions of the Affairs of State screen for one holding (ARCHITECTURE §20: one question per
 * panel, words before numbers, the rest behind Details):
 *   FolkPanel      — the tax level as four choice cards, loyalty in one sentence, reasons behind Details;
 *   BuildingsPanel — a card per building, then the chosen one's next tier, cost and one gold button;
 *   GarrisonPanel  — one TransferSlider between the men under arms and the farms.
 * Every number comes from the holdings module's pure rules, the economy's `settlementTax` or military's
 * `unitWage`.
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import { TAX_RATE_IDS, type TaxRateId } from '@content/schemas/ids';
import type { Command } from '@sim/core/commands';
import type { GameState, Settlement, SettlementId } from '@sim/core/state';
import { settlementTax } from '@sim/modules/economy/ledger';
import {
  buildingOptions,
  buildSlots,
  garrisonPreview,
  holdingUpkeep,
  loyaltyBand,
  loyaltyForecast,
  menAtHome,
  neededGarrison,
  recommendedGarrison,
  withTax,
  type BuildingOption,
} from '@sim/modules/holdings/rules';
import { unitWage } from '@sim/modules/military';
import { formatNumber, t, tOr } from '../../i18n/index';
import { Button, ChoiceCard, Disclosure, Meter, StatLine, TransferSlider } from '../../ui/index';
import { WhyNot } from '../hub/BuildingFrame';
import { buildIssueText, buildingName, effectLines, garrisonIssueText, reasonText, signed, toneOf, unitName } from './format';

type Dispatch = (cmd: Command) => unknown;

interface SectionProps {
  state: GameState;
  content: Content;
  holding: Settlement;
  dispatch: Dispatch;
}

/** One line on what a tax level does to loyalty, in words. */
function taxEffect(delta: number): string {
  const n = Math.abs(Math.round(delta * 10) / 10);
  if (delta > 0) return t('holdings.ui.taxUp', { n: formatNumber(n) });
  if (delta < 0) return t('holdings.ui.taxDown', { n: formatNumber(n) });
  return t('holdings.ui.taxSame');
}

// ---------------------------------------------------------------------------------------------
// The folk: taxes and loyalty.

export function FolkPanel({ state, content, holding, dispatch }: SectionProps): ReactElement {
  const h = holding.holding;
  const id = holding.id as SettlementId;
  const forecast = loyaltyForecast(state, content, id);
  const report = state.holdingsState?.reports[id];
  const governor = h ? state.characters[h.governorId] : undefined;
  const loyalty = h?.loyalty ?? 0;
  const band = loyaltyBand(content, loyalty);
  const to = Math.round(forecast.to);
  const dir = to > Math.round(loyalty) ? 'up' : to < Math.round(loyalty) ? 'down' : 'same';
  const taxRows = TAX_RATE_IDS.map((tax: TaxRateId) => {
    const income = Math.round(settlementTax(state, content, withTax(holding, tax)).amount);
    const delta = loyaltyForecast(state, content, id, { tax }).reasons.find((r) => r.id === 'tax')?.amount ?? 0;
    return { tax, income, delta };
  });
  return (
    <section className="af-panel" data-testid="affairs-folk" aria-label={t('holdings.ui.door.folk')}>
      <h3 className="af-ask">{t('holdings.ui.taxAsk', { place: holding.name })}</h3>
      <div className="af-taxes" role="radiogroup" aria-label={t('holdings.ui.taxLevel')} data-testid="affairs-tax">
        {taxRows.map((row) => {
          const active = h?.tax === row.tax;
          return (
            <ChoiceCard
              key={row.tax}
              title={t(`holdings.tax.${row.tax}`)}
              line={t('holdings.ui.taxLine', { silver: formatNumber(row.income), effect: taxEffect(row.delta) })}
              selected={active}
              role="radio"
              aria-checked={active}
              aria-pressed={undefined}
              onClick={() => (active ? undefined : dispatch({ type: 'setTax', holdingId: id, tax: row.tax }))}
              data-testid={`affairs-tax-${row.tax}`}
            />
          );
        })}
      </div>

      <div className="af-loyalty" data-testid="affairs-loyalty" data-loyalty={Math.round(loyalty)}>
        <p className="af-big">{t('holdings.ui.loyaltyNow', { loyalty: formatNumber(Math.round(loyalty)), band: t(`holdings.band.${band}`).toLowerCase() })}</p>
        <Meter
          value={loyalty}
          max={content.balance.loyalty.max}
          label={t('holdings.ui.loyalty')}
          showLabel={false}
          thresholds={[
            [content.balance.loyalty.revoltBelow / content.balance.loyalty.max, 'bad'],
            [content.balance.loyalty.driftTarget / content.balance.loyalty.max, 'warn'],
          ]}
        />
        <p className={`af-line ${dir === 'up' ? 'tone-good' : dir === 'down' ? 'tone-bad' : ''}`} data-testid="affairs-loyalty-forecast">
          {t('holdings.ui.loyaltyNext', { dir, to: formatNumber(to) })}
        </p>
      </div>

      <Disclosure className="af-details" summary={t('holdings.ui.whyLoyalty')} data-testid="affairs-folk-details">
        <div className="af-details-grid">
          <div>
            {forecast.reasons.length === 0 ? (
              <p className="af-note">{t('holdings.ui.noReasons')}</p>
            ) : (
              <ul className="af-reasons" data-testid="affairs-reasons">
                {forecast.reasons.map((r) => (
                  <li key={r.id} data-reason={r.id}>
                    <span>{reasonText(r)}</span>
                    <span className={`num ${toneOf(r.amount)}`}>{signed(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="af-note" data-testid="affairs-last-report">
              {report ? t('holdings.ui.lastMonth', { before: formatNumber(Math.round(report.before)), after: formatNumber(Math.round(report.after)) }) : t('holdings.ui.noReport')}
              {report && report.external !== 0 ? ` · ${t('holdings.ui.external')} ${signed(report.external)}` : ''}
            </p>
            <p className="af-note">{t('holdings.ui.loyaltyEffects')}</p>
          </div>
          <div>
            <StatLine icon="men" label={t('holdings.ui.people')} value={<span data-testid="affairs-people">{t('holdings.ui.peopleValue', { pop: formatNumber(holding.pop), tier: tOr(`ui.tier.${holding.tier}`, holding.tier) })}</span>} />
            <StatLine icon="silver" label={t('holdings.ui.prosperity')} value={tOr(`economy.economyState.${holding.economy}`, holding.economy)} />
            <StatLine
              icon="crown"
              label={t('holdings.ui.governor')}
              value={governor ? (governor.id === state.player.rulerId ? t('holdings.ui.governorYou', { name: governor.name }) : governor.name) : '–'}
            />
            <StatLine
              icon="food"
              label={t('holdings.ui.food')}
              value={t('holdings.ui.foodValue', { months: Math.round((h?.foodMonths ?? 0) * 10) / 10 })}
              tone={(h?.foodMonths ?? 0) < 3 ? 'warn' : undefined}
            />
            <p className="af-note">{t('holdings.ui.taxNote')}</p>
          </div>
        </div>
      </Disclosure>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Buildings.

/** The building shown first: the first the builders can start, else the first with a next tier. */
function firstPick(options: readonly BuildingOption[]): string | undefined {
  return (options.find((o) => o.ok) ?? options.find((o) => o.next && !o.building) ?? options[0])?.buildingId;
}

function BuildingDetail({ option, holdingId, dispatch }: { option: BuildingOption; holdingId: SettlementId; dispatch: Dispatch }): ReactElement {
  const { buildingId, tier, next } = option;
  const blocking = option.issues.filter((i) => i !== 'alreadyBuilding');
  const action = tier === 0 ? t('holdings.ui.build') : t('holdings.ui.upgrade');
  const label = next ? t('holdings.ui.buildLabel', { action, name: buildingName(buildingId), tier: next.tier }) : '';
  return (
    <div className="af-pick">
      <div className="af-pick-head">
        <h4 className="af-pick-name">{buildingName(buildingId)}</h4>
        <p className="af-note">{tOr(`holdings.buildingBlurb.${buildingId}`, '')}</p>
      </div>
      {next ? (
        <>
          <p className="af-line">
            <span className="af-dim">{t('holdings.ui.next', { tier: next.tier })}: </span>
            {effectLines(next).join(', ')}
          </p>
          {option.building ? (
            <div className="af-underway" data-testid={`affairs-queue-${buildingId}`}>
              <p className="af-line tone-info" data-testid={`affairs-underway-${buildingId}`}>
                {t('holdings.ui.queue')}: {t('holdings.ui.underway', { tier: option.building.tier, days: option.building.daysLeft })}
              </p>
              <Meter value={Math.round(option.building.progress * 100)} max={100} label={buildingName(buildingId)} showLabel={false} tone="accent" size="sm" />
            </div>
          ) : (
            <>
              <p className="af-big" data-testid={`affairs-cost-${buildingId}`}>
                {t('holdings.ui.costSentence', { silver: formatNumber(next.cost), days: next.days, upkeep: option.upkeepDelta })}
              </p>
              <div className="af-go">
                <WhyNot
                  reasons={blocking.slice(0, 1).map((i) => buildIssueText(i))}
                  ok={option.ok ? t('holdings.ui.readyToBuild') : undefined}
                  testId={`affairs-why-${buildingId}`}
                />
                <Button
                  variant="primary"
                  size="lg"
                  icon="plus"
                  disabled={!option.ok}
                  aria-label={label}
                  onClick={() => dispatch({ type: 'queueBuilding', holdingId, buildingId })}
                  data-testid={`affairs-build-${buildingId}`}
                >
                  {t('holdings.ui.buildShort', { kind: tier === 0 ? 'build' : 'upgrade', tier: next.tier })}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <p className="af-line">{t('holdings.ui.topTier')}</p>
      )}
    </div>
  );
}

export function BuildingsPanel({ state, content, holding, dispatch }: SectionProps): ReactElement {
  const id = holding.id as SettlementId;
  const options = buildingOptions(state, content, id);
  const queued = options.filter((o) => o.building);
  const slots = buildSlots(state, content, holding);
  // Built (or buildable) first, in balance order; the top-tier ones last.
  const listed = [...options].sort((a, b) => Number(a.next === undefined) - Number(b.next === undefined));
  const [picked, setPicked] = useState<string | undefined>(() => firstPick(listed));
  const option = listed.find((o) => o.buildingId === picked) ?? listed[0];
  return (
    <section className="af-panel" data-testid="affairs-buildings" aria-label={t('holdings.ui.buildings')}>
      <div className="af-ask-row">
        <h3 className="af-ask">{t('holdings.ui.buildAsk', { place: holding.name })}</h3>
        <span className="af-dim" data-testid="affairs-slots">
          {t('holdings.ui.builders', { used: queued.length, slots })}
        </span>
      </div>
      <div className="af-build-split">
      <div className="af-buildings" role="group" aria-label={t('holdings.ui.buildings')}>
        {listed.map((o) => (
          <ChoiceCard
            key={o.buildingId}
            size="sm"
            title={buildingName(o.buildingId)}
            line={o.tier > 0 ? t('holdings.ui.tierOf', { tier: o.tier, max: o.maxTier }) : t('holdings.ui.notBuilt')}
            badge={o.building ? t('holdings.ui.badgeBuilding') : undefined}
            selected={o.buildingId === option?.buildingId}
            onClick={() => setPicked(o.buildingId)}
            data-tier={o.tier}
            data-testid={`affairs-building-${o.buildingId}`}
          />
        ))}
      </div>
      {option && <BuildingDetail option={option} holdingId={id} dispatch={dispatch} />}
      </div>
      <Disclosure className="af-details" data-testid="affairs-buildings-details">
        <p className="af-note">{t('holdings.ui.upkeep', { silver: formatNumber(holdingUpkeep(content, holding)) })}</p>
        {option?.next?.founding && <p className="af-note">{t('holdings.ui.founding')}</p>}
      </Disclosure>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Garrison.

export function GarrisonPanel({ state, content, holding, dispatch }: SectionProps): ReactElement {
  const id = holding.id as SettlementId;
  const units = Object.entries(holding.garrison).filter(([, n]) => n > 0);
  const [picked, setPicked] = useState<string | undefined>(units[0]?.[0]);
  const [send, setSend] = useState(0);
  const home = menAtHome(state, content, holding);
  const recommended = recommendedGarrison(content, holding);
  const needed = neededGarrison(content, holding);
  const penalty = signed(content.balance.loyalty.lowGarrison);
  const pool = holding.holding?.pool;
  const entry = units.find(([u]) => u === picked) ?? units[0];
  const unit = entry?.[0];
  const count = entry?.[1] ?? 0;
  const n = Math.max(0, Math.min(count, Math.round(send)));
  const preview = unit ? garrisonPreview(state, content, { holdingId: id, units: { [unit]: count - n } }) : undefined;
  const wage = unit ? unitWage(content.balance, unit) : 0;
  const keepNote = (kept: number) => {
    if (!unit) return '';
    const p = garrisonPreview(state, content, { holdingId: id, units: { [unit]: kept } });
    return p.belowNeeded ? t('holdings.ui.keepLow', { amount: penalty }) : p.belowRecommended ? t('holdings.ui.keepThin') : t('holdings.ui.keepSafe');
  };
  const status =
    home.total < needed
      ? { cls: 'tone-bad', text: t('holdings.ui.belowNeeded', { amount: penalty, needed: formatNumber(needed) }) }
      : home.total < recommended
        ? { cls: 'tone-warn', text: t('holdings.ui.keepThin') }
        : { cls: 'tone-good', text: t('holdings.ui.keepSafe') };
  const pick = (u: string) => {
    setPicked(u);
    setSend(0);
  };
  return (
    <section className="af-panel" data-testid="affairs-garrison" aria-label={t('holdings.ui.garrison')}>
      <h3 className="af-ask">{t('holdings.ui.garrisonAsk', { place: holding.name })}</h3>
      <p className="af-big">
        <strong data-testid="affairs-garrison-total">{t('holdings.ui.atHomeTotal', { men: home.total })}</strong>
        {status.cls === 'tone-bad' && <span className="af-status tone-bad"> {status.text}</span>}
      </p>
      {units.length === 0 || !unit ? (
        <p className="af-note">{t('holdings.ui.noGarrison')}</p>
      ) : (
        <>
          {units.length > 1 && (
            <div className="af-units" role="group" aria-label={t('holdings.ui.garrisonPick')}>
              {units.map(([u, c]) => (
                <ChoiceCard
                  key={u}
                  size="sm"
                  icon="men"
                  title={unitName(content, u)}
                  line={t('holdings.ui.unitLine', { count: formatNumber(c) })}
                  selected={u === unit}
                  onClick={() => pick(u)}
                  data-testid={`affairs-unit-${u}`}
                />
              ))}
            </div>
          )}
          <TransferSlider
            key={`${id}-${unit}`}
            label={unitName(content, unit)}
            total={count}
            value={n}
            onChange={(v) => setSend(v)}
            left={{ label: t('holdings.ui.keepSide'), icon: 'men', note: keepNote }}
            right={{ label: t('holdings.ui.homeSide'), icon: 'food', note: (m: number) => t('holdings.ui.homeSaves', { silver: formatNumber(m * wage) }) }}
            quick={['none', 'half', 'all']}
            data-testid="affairs-garrison-slider"
          />
          <div className="af-go">
            <WhyNot
              reasons={preview && !preview.ok && preview.issues[0] !== 'nothingToChange' ? preview.issues.slice(0, 1).map((i) => garrisonIssueText(i)) : []}
              ok={preview?.issues[0] === 'nothingToChange' ? garrisonIssueText('nothingToChange') : undefined}
              okTone="hint"
              testId="affairs-send-why"
            />
            <Button
              variant="primary"
              size="lg"
              icon="arrowRight"
              disabled={!preview?.ok}
              onClick={() => {
                dispatch({ type: 'setGarrison', holdingId: id, units: { [unit]: count - n } });
                setSend(0);
              }}
              data-testid={`affairs-send-${unit}`}
            >
              {n > 0 ? t('holdings.ui.sendHome', { count: n }) : t('holdings.ui.sendHomeCount')}
            </Button>
          </div>
        </>
      )}
      <Disclosure className="af-details" data-testid="affairs-garrison-details">
        <p className={`af-note ${status.cls}`} data-testid="affairs-garrison-min">
          {status.text}
        </p>
        <p className="af-note" data-testid="affairs-garrison-breakdown">
          {t('holdings.ui.atHomeBreakdown', { garrison: formatNumber(home.garrison), hird: formatNumber(home.hird), wounded: home.wounded, needed: formatNumber(needed) })}
        </p>
        <p className="af-note">{t('holdings.ui.recommended', { min: formatNumber(recommended) })}</p>
        {pool && <p className="af-note">{t('holdings.ui.pool', { current: formatNumber(pool.current), max: formatNumber(pool.max) })}</p>}
        <p className="af-note">{t('holdings.ui.atHomeNote')}</p>
        <p className="af-note">{t('holdings.ui.dismissNote')}</p>
        <p className="af-note">{t('holdings.ui.raiseHint')}</p>
      </Disclosure>
    </section>
  );
}
