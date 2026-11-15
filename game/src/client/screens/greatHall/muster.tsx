/**
 * Muster (SCR-08), laid out by ARCHITECTURE §20 as one decision: which kind of warrior (big cards), how many
 * (one TransferSlider: the men who stay on the farms against those who answer the war-arrow), what it costs
 * (one sentence) and the gold button. Every number and every "why not" comes from the military module's own
 * pure `musterPreview` (the handler runs the same function), `unmetRequirements`, `poolForecast` and, for
 * lieutenants, `lieutenantCapacity` / `lieutenantsOf` / `promoteIssues`; the client never prices or validates
 * anything itself. Several kinds can still go out under one war-arrow: each card remembers its count.
 * Behind Details: how the farms refill, the treasury after, what the chosen kind does, the gathering musters
 * and the lieutenants.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState, Settlement, UnitTypeId } from '@sim/core/state';
import {
  lieutenantCapacity,
  lieutenantsOf,
  musterPreview,
  musterRoster,
  poolForecast,
  promoteIssues,
  readMilitary,
  unitBounty,
  unitWage,
  unmetRequirements,
  type MusterIssue,
} from '@sim/modules/military';
import { useGame } from '../../app/gameStore';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, t as tr, tOr, useT } from '../../i18n/index';
import { Button, ChoiceCard, Disclosure, Icon, StatLine, TransferSlider } from '../../ui/index';
import { unitName } from '../expedition/names';
import { WhyNot } from '../hub/BuildingFrame';

/** Plain words for one unmet unit requirement code from `unmetRequirements` ('hall:2', 'culture', …). */
export function requirementText(code: string): string {
  const [kind, a, b] = code.split(':');
  switch (kind) {
    case 'hall':
      return tr('military.ui.req.hall', { tier: a ?? '' });
    case 'culture':
      return tr('military.ui.req.culture');
    case 'replaced':
      return tr('military.ui.req.replaced');
    case 'renownCap':
      return tr('military.ui.req.renownCap');
    case 'oldWaysFavor':
      return tr('military.ui.req.oldWaysFavor');
    case 'building':
      return tr('military.ui.req.building', {
        building: tOr(`ui.building.${a ?? ''}`, a ?? ''),
        tier: b ?? '',
      });
    case 'notRecruitable':
    case 'unknownUnit':
      return tr('military.ui.req.notRecruitable');
    default:
      return tr('military.ui.req.other');
  }
}

/** Plain words for a muster issue (the module's error strings, with their numbers). */
export function musterIssueText(issue: MusterIssue, content: Content): string {
  const vars = { days: Number(issue.detail ?? 0), available: Number(issue.detail ?? 0) };
  const text = tr(`military.error.${issue.code}`, vars);
  return issue.unit !== undefined && (issue.code === 'requirement' || issue.code === 'notRecruitable')
    ? `${unitName(content, issue.unit)}: ${text}`
    : text;
}

/** The muster panel for the player's capital. */
export function MusterPanel({ state, content, capital }: { state: GameState; content: Content; capital: Settlement }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const roster = useMemo(() => musterRoster(content.balance, capital.culture), [content, capital.culture]);
  const open = roster.filter((u) => unmetRequirements(state, content, capital, u).length === 0);
  const [counts, setCounts] = useState<Record<UnitTypeId, number>>({});
  const [picked, setPicked] = useState<UnitTypeId | undefined>(open[0] ?? roster[0]);
  const units: Record<UnitTypeId, number> = {};
  for (const u of roster) units[u] = counts[u] ?? 0;
  const preview = musterPreview(state, content, { holdingId: capital.id, units });
  const forecast = poolForecast(state, content, capital.id);
  const treasury = Math.floor(state.factions[state.player.factionId]?.treasury ?? 0);
  const issues = preview.total === 0 ? preview.issues.filter((i) => i.code !== 'noUnits') : preview.issues;
  const gathering = readMilitary(state).musters.filter((m) => m.holdingId === capital.id && m.factionId === state.player.factionId);
  const pending = state.pending !== null;

  const send = () => {
    const r = dispatch({
      type: 'muster',
      holdingId: capital.id,
      units: Object.fromEntries(Object.entries(units).filter(([, n]) => n > 0)),
    });
    if (r && !r.error) setCounts({});
  };

  // The chosen kind: the farms' men not already called for another kind, and what the treasury can pay.
  const unit = picked;
  const mine = unit ? (units[unit] ?? 0) : 0;
  const others = preview.total - mine;
  const farms = Math.max(0, preview.poolCurrent - others);
  const bounty = unit ? unitBounty(state, content, state.player.factionId, unit) : 0;
  const othersBounty = preview.bounty - mine * bounty;
  const affordable = bounty > 0 ? Math.max(0, Math.floor((treasury - othersBounty) / bounty)) : farms;
  const max = Math.min(farms, affordable);

  return (
    <div className="gh-muster" data-testid="muster">
      <p className="gh-intro">{t('military.ui.muster.intro', { place: capital.name, days: content.balance.recruit.gatherDays })}</p>
      <div className="gh-kinds" role="group" aria-label={t('hub.muster.kind')}>
        {[...open, ...roster.filter((u) => !open.includes(u))].map((u) => {
          const unmet = unmetRequirements(state, content, capital, u);
          const count = units[u] ?? 0;
          return (
            <ChoiceCard
              key={u}
              size="sm"
              icon="men"
              title={unitName(content, u)}
              line={t('hub.muster.price', { bounty: formatNumber(unitBounty(state, content, state.player.factionId, u)) })}
              reason={unmet.length > 0 ? requirementText(unmet[0] as string) : undefined}
              disabled={unmet.length > 0}
              selected={u === picked}
              badge={count > 0 ? formatNumber(count) : undefined}
              onClick={() => setPicked(u)}
              data-testid={`muster-kind-${u}`}
            />
          );
        })}
      </div>

      {unit && (
        <TransferSlider
          key={unit}
          label={unitName(content, unit)}
          total={farms}
          value={mine}
          onChange={(v) => setCounts((c) => ({ ...c, [unit]: Math.max(0, Math.round(v)) }))}
          left={{ label: t('hub.muster.farms'), icon: 'food', note: (n) => t('hub.muster.farmsNote', { n }) }}
          right={{ label: t('hub.muster.answer', { unit: unitName(content, unit) }), icon: 'men', note: (n) => t('hub.muster.costNote', { silver: formatNumber(n * bounty), wage: formatNumber(n * unitWage(content.balance, unit)) }) }}
          max={max}
          maxReason={affordable < farms ? t('hub.muster.treasuryLimit', { n: affordable }) : undefined}
          bigStep={10}
          quick={['none', 'half', 'all']}
          disabled={farms === 0}
          data-testid={`muster-${unit}`}
        />
      )}

      <div className="gh-muster-foot">
        <p className="gh-cost" data-testid="muster-summary">
          {preview.total > 0
            ? t('hub.muster.cost', {
                men: preview.total,
                bounty: formatNumber(preview.bounty),
                wages: formatNumber(preview.upkeepDelta),
                date: formatGameDate(preview.arriveHour),
              })
            : t('hub.muster.none', { men: formatNumber(preview.poolCurrent) })}
        </p>
        <div className="gh-go">
          <WhyNot
            reasons={issues.map((i) => musterIssueText(i, content))}
            ok={preview.ok ? t('military.ui.muster.ready') : preview.total === 0 && issues.length === 0 ? t('hub.muster.pick') : undefined}
            okTone={preview.ok ? 'good' : 'hint'}
            testId="muster-why"
          />
          <Button variant="primary" size="lg" icon="men" disabled={!preview.ok || pending} onClick={send} data-testid="muster-go">
            {t('military.ui.muster.go')}
          </Button>
        </div>
      </div>
      {gathering.length > 0 && (
        <ul className="gh-gathering" data-testid="muster-gathering">
          {gathering.map((m) => {
            let men = 0;
            for (const v of Object.values(m.units)) men += Math.max(0, v ?? 0);
            return (
              <li key={m.id}>
                <Icon name="hourglass" /> {t('military.ui.muster.gatheringLine', { men, date: formatGameDate(m.arriveHour) })}
              </li>
            );
          })}
        </ul>
      )}

      <Disclosure className="gh-details" data-testid="muster-details">
        <div className="gh-details-grid">
          <div>
            <StatLine icon="men" label={t('military.ui.muster.pool')} value={t('military.ui.muster.poolValue', { current: formatNumber(preview.poolCurrent), max: formatNumber(forecast?.max ?? preview.poolCurrent), regen: formatNumber(forecast?.regen ?? 0) })} />
            <StatLine icon="silver" label={t('military.ui.muster.treasury')} value={t('military.ui.realm.silver', { silver: formatNumber(treasury - preview.bounty) })} tone={preview.bounty > treasury ? 'bad' : undefined} />
            {unit && <p className="gh-note">{tOr(`military.unitInfo.${unit}`, '')}</p>}
            <p className="gh-note">{t('military.ui.muster.dismissNote')}</p>
          </div>
          <Lieutenants state={state} content={content} capital={capital} />
        </div>
      </Disclosure>
    </div>
  );
}

/** Lieutenant capacity and promoting veterans (`promoteLieutenant`). */
function Lieutenants({ state, content, capital }: { state: GameState; content: Content; capital: Settlement }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const cap = lieutenantCapacity(state, content, state.player.factionId);
  const lts = lieutenantsOf(state, content, state.player.factionId);
  const units = Object.entries(capital.garrison).filter(([, n]) => n > 0);
  const cost = content.balance.recruit.promoteVeteranCost;
  const battles = content.balance.recruit.promoteVeteranBattles;
  return (
    <section className="gh-lts" aria-label={t('military.ui.lt.title')}>
      <h4 className="gh-sub">{t('military.ui.lt.title')}</h4>
      <p className="gh-note">{t('military.ui.lt.capacity', { used: cap.used, capacity: cap.capacity })}</p>
      {lts.length === 0 ? (
        <p className="gh-note">{t('military.ui.lt.none')}</p>
      ) : (
        lts.map((c) => <StatLine key={c.id} icon="star" label={c.name} value={c.role ? tOr(`people.role.${c.role.kind}`, c.role.kind) : ''} />)
      )}
      <p className="gh-note">{t('military.ui.lt.promoteInfo', { battles, silver: formatNumber(cost) })}</p>
      <ul className="gh-promote">
        {units.map(([unit]) => {
          const check = promoteIssues(state, content, { unit, settlementId: capital.id });
          return (
            <li key={unit}>
              <Button
                size="sm"
                icon="star"
                disabled={check.issues.length > 0 || state.pending !== null}
                onClick={() => dispatch({ type: 'promoteLieutenant', unit, settlementId: capital.id })}
                data-testid={`promote-${unit}`}
              >
                {t('military.ui.lt.promote', { unit: unitName(content, unit) })}
              </Button>
              <WhyNot reasons={check.issues.map((i) => t(`military.error.${i}`))} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
