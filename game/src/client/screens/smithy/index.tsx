/**
 * The Smithy (route 'building.smithy'), laid out by ARCHITECTURE §20 as two big cards, armour and weapons:
 * what the men carry now, what the next step gives in words, its cost and one button (`upgradeArmoury`,
 * priced and checked by the military module's `upgradePreview`), disabled with the reason. Behind Details:
 * how the cost is reckoned (work, per man, iron), what the Smithy can forge, the recruit bounty note and the
 * table of every tier. The client decides nothing.
 *
 * Test ids: smithy, smithy-close, smithy-armour, smithy-weapons, upgrade-<track>, upgrade-<track>-why,
 * smithy-cost-<track>, smithy-details, smithy-tiers.
 */
import type { ReactElement } from 'react';
import type { Content } from '@content/index';
import type { GameState } from '@sim/core/state';
import {
  buildingTier,
  trackTier,
  upgradePreview,
  type ArmouryTrack,
  type UpgradePreview,
} from '@sim/modules/military';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, t as tr, tOr, useT } from '../../i18n/index';
import { Button, Disclosure, Icon, type IconName } from '../../ui/index';
import { BuildingFrame, WhyNot } from '../hub/BuildingFrame';
import { capitalOf } from '../hub/counsel';
import './smithy.css';

const TRACKS: readonly ArmouryTrack[] = ['armour', 'weapons'];
const ICON: Readonly<Record<ArmouryTrack, IconName>> = { armour: 'shieldRound', weapons: 'sword' };

/** Plain words for an upgrade issue. */
export function upgradeIssueText(p: UpgradePreview, issue: UpgradePreview['issues'][number]): string {
  if (issue === 'smithy')
    return tr('military.ui.smithy.needsSmithy', { tier: p.smithyRequired, have: p.smithyTier });
  if (issue === 'requirement') {
    return p.unmet
      .map((r) =>
        r === 'masterSmith'
          ? tr('military.ui.smithy.req.masterSmith')
          : r.startsWith('relic:')
            ? tr('military.ui.smithy.req.relic')
            : tr('military.ui.smithy.req.other'),
      )
      .join(' ');
  }
  return tr(`military.error.${issue}`);
}

/** The maximum armoury tier a Smithy tier can forge (balance `buildings.smithy` effects). */
function smithyMax(content: Content, tier: number): number {
  const row = content.balance.buildings.smithy?.tiers.find((r) => r.tier === tier);
  const v = (row?.effects as Readonly<Record<string, unknown>> | undefined)?.maxArmouryTier;
  return typeof v === 'number' ? v : 0;
}

function multOf(content: Content, tier: number): number {
  return content.balance.equipment.tiers.find((r) => r.tier === tier)?.mult ?? 1;
}

function tierName(track: ArmouryTrack, tier: number): string {
  return tOr(`military.tier.${track}.${tier}`, String(tier));
}

function TrackCard({
  state,
  content,
  track,
  preview: p,
  primary,
}: {
  state: GameState;
  content: Content;
  track: ArmouryTrack;
  preview: UpgradePreview;
  primary: boolean;
}): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const now = trackTier(state, state.player.factionId, track);
  const maxed = p.issues.includes('maxTier');
  const gain = Math.round((p.mult / multOf(content, now) - 1) * 100);
  return (
    <article className="smy-card" data-testid={`smithy-${track}`} aria-labelledby={`smy-${track}-h`}>
      <header className="smy-head">
        <span className="smy-icon">
          <Icon name={ICON[track]} />
        </span>
        <h3 className="smy-title" id={`smy-${track}-h`}>
          {t(`military.track.${track}`)}
        </h3>
      </header>
      <div className="smy-now">
        <span className="smy-label">{t(`military.ui.smithy.wear.${track}`)}</span>
        <span className="smy-name">{tierName(track, now)}</span>
      </div>
      {maxed ? (
        <p className="smy-next tone-good">{t('military.ui.smithy.max')}</p>
      ) : (
        <>
          <div className="smy-next">
            <span className="smy-next-name">{t('military.ui.smithy.nextLine', { name: tierName(track, p.nextTier) })}</span>
            <span className="smy-gain">{t(`military.ui.smithy.gain.${track}`, { pct: gain })}</span>
          </div>
          <div className="smy-foot">
            <div className="smy-cost" data-testid={`smithy-cost-${track}`}>
              <span className="smy-label">{t('military.ui.smithy.costLabel')}</span>
              <span className="smy-cost-value num">{t('military.ui.smithy.costValue', { silver: formatNumber(p.total) })}</span>
            </div>
            <Button
              variant={p.ok && primary ? 'primary' : 'secondary'}
              size="lg"
              icon={ICON[track]}
              disabled={!p.ok || state.pending !== null}
              aria-label={t('military.ui.smithy.forgeLabel', { name: tierName(track, p.nextTier), silver: formatNumber(p.total) })}
              onClick={() => dispatch({ type: 'upgradeArmoury', track, holdingId: p.holdingId ?? state.player.capitalId })}
              data-testid={`upgrade-${track}`}
            >
              {t('military.ui.smithy.forge')}
            </Button>
          </div>
          <WhyNot reasons={p.issues.map((i) => upgradeIssueText(p, i))} ok={p.ok ? t('military.ui.smithy.ready') : undefined} testId={`upgrade-${track}-why`} />
        </>
      )}
    </article>
  );
}

function Details({ state, content, previews, tier }: { state: GameState; content: Content; previews: readonly UpgradePreview[]; tier: number }): ReactElement {
  const t = useT();
  const fac = state.player.factionId;
  const armour = trackTier(state, fac, 'armour');
  const weapons = trackTier(state, fac, 'weapons');
  return (
    <Disclosure className="smy-details" data-testid="smithy-details">
      <div className="smy-details-grid">
        <div className="smy-notes">
          <p className="smy-note">{t('military.ui.smithy.smithyLine', { tier, max: smithyMax(content, tier) })}</p>
          {previews
            .filter((p) => !p.issues.includes('maxTier'))
            .map((p) => (
              <div key={p.track}>
                <h4 className="smy-sub">{t(`military.track.${p.track}`)}</h4>
                <p className="smy-note">
                  {t('military.ui.smithy.costLine', {
                    silver: formatNumber(p.silver),
                    flat: formatNumber(p.costFlat),
                    perMan: formatNumber(p.costPerMan),
                    men: formatNumber(p.men),
                  })}
                </p>
                {p.ironT > 0 && (
                  <p className="smy-note">
                    {p.ironBought > 0
                      ? t('military.ui.smithy.ironBought', { tons: p.ironT, market: p.ironFromMarket, bought: p.ironBought, cost: formatNumber(p.ironCost) })
                      : t('military.ui.smithy.iron', { tons: p.ironT, market: p.ironFromMarket })}
                  </p>
                )}
              </div>
            ))}
          <p className="smy-note">{t('military.ui.smithy.bountyNote', { silver: content.balance.equipment.bountyPerTierPerTrack })}</p>
        </div>
        <table className="smy-table" data-testid="smithy-tiers">
          <thead>
            <tr>
              <th>{t('military.ui.smithy.col.armour')}</th>
              <th>{t('military.ui.smithy.col.weapons')}</th>
              <th className="num">{t('military.ui.smithy.col.mult')}</th>
              <th>{t('military.ui.smithy.col.smithy')}</th>
            </tr>
          </thead>
          <tbody>
            {content.balance.equipment.tiers.map((row) => (
              <tr key={row.tier} className={row.tier === armour || row.tier === weapons ? 'is-current' : undefined}>
                <td>
                  {tOr(`military.tier.armour.${row.tier}`, row.armour)}
                  {row.tier === armour ? ` · ${t('military.ui.smithy.current')}` : ''}
                </td>
                <td>
                  {tOr(`military.tier.weapons.${row.tier}`, row.weapon)}
                  {row.tier === weapons ? ` · ${t('military.ui.smithy.current')}` : ''}
                </td>
                <td className="num">{t('military.ui.smithy.multValue', { mult: row.mult })}</td>
                <td>{t('military.ui.smithy.smithyValue', { tier: row.smithyTier })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

/** The Smithy for a state (exported for tests). */
export function Smithy({ state, onClose }: { state: GameState; onClose(): void }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  const capital = capitalOf(state);
  const tier = buildingTier(capital, 'smithy');
  const previews = content && capital ? TRACKS.map((track) => upgradePreview(state, content, { track, holdingId: capital.id })) : [];
  // One gold button: the first upgrade the smiths can do now.
  const primary = previews.find((p) => p.ok)?.track;
  return (
    <BuildingFrame
      title={t('military.ui.smithy.title')}
      subtitle={capital && content ? t('military.ui.smithy.subtitle', { place: capital.name, tier, max: smithyMax(content, tier) }) : undefined}
      onClose={onClose}
      testId="smithy"
      className="smy-frame"
    >
      {content && capital && (
        <div className="smy-screen">
          <div className="smy-cards">
            {previews.map((p) => (
              <TrackCard key={p.track} state={state} content={content} track={p.track} preview={p} primary={p.track === primary} />
            ))}
          </div>
          <Details state={state} content={content} previews={previews} tier={tier} />
        </div>
      )}
    </BuildingFrame>
  );
}

function SmithyScreen({ close }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  if (!state) return <div />;
  return <Smithy state={state} onClose={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'smithy',
  route: 'building.smithy',
  component: SmithyScreen,
  layout: 'overlay',
  titleKey: 'military.ui.smithy.title',
};
