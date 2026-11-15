/**
 * After a sea fight (§20.7): the painting of the water won (`seabattle.scene.victory`) or lost
 * (`seabattle.scene.defeat`, also when our ships broke away; a fight with no victor keeps
 * `seabattle.scene.before`), the outcome in a few words, four counts (sunk, taken, ships lost, men lost), the
 * plunder, and the way on. Every ship's fate sits behind Details.
 *
 * Shown by the sea-battle scene when the fight ends (with the host's buttons) and after the captains settled it
 * (route 'seaBattleResult', opened by Before the Sea Battle). Test ids of the old summary card are kept:
 * `sea-summary`, `sea-outcome` (data-outcome), `sea-sum-sunk|taken|lost|men`, `sea-sum-plunder`,
 * `sea-return-error`.
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { SeaBattleSetup } from '@sim/core/state';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, hasKey, useT } from '../../i18n/index';
import { SceneChoices } from '../../render/scenes/index';
import { Disclosure } from '../../ui/index';
import { CardScene } from '../battle/cardScene';
import { clock, summarizeSea, type SeaOutcome, type SeaSummary } from './logic';
import { ShipGlyph } from './ShipGlyph';

/** The painting of an outcome at sea. */
export function seaResultAsset(outcome: SeaOutcome): string {
  if (outcome === 'victory') return 'seabattle.scene.victory';
  if (outcome === 'draw') return 'seabattle.scene.before';
  return 'seabattle.scene.defeat';
}

/** What was taken, in words ("340 silver, 2.5 t of cargo", or "Nothing taken"). */
export function plunderText(s: SeaSummary, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (s.plunderSilver > 0) parts.push(t('seaView.sum.plunderSilver', { silver: formatNumber(s.plunderSilver) }));
  const tons = s.plunderGoods.reduce((a, g) => a + g.tons, 0);
  if (tons > 0) parts.push(t('seaView.sum.plunderGoods', { tons: formatNumber(tons, { maximumFractionDigits: 1 }) }));
  return parts.length > 0 ? parts.join(', ') : t('seaView.sum.plunderNone');
}

export interface SeaResultSceneProps {
  summary: SeaSummary;
  /** The waters it was fought in (the kicker). */
  title: string;
  error?: string | null;
  children: ReactNode;
}

/** The scene (see the file header). */
export function SeaResultScene({ summary, title, error, children }: SeaResultSceneProps): ReactElement {
  const t = useT();
  const stat = (label: string, value: ReactNode, id: string, sub?: ReactNode) => (
    <div className="bc-stat" data-testid={id}>
      <span className="bc-stat-value num">{value}</span>
      <span className="bc-stat-label">{label}</span>
      {sub !== undefined && <span className="bc-stat-sub">{sub}</span>}
    </div>
  );
  const fleet = (heading: string, fates: SeaSummary['own']['fates'], side: 'own' | 'foe') => (
    <>
      <h4>{heading}</h4>
      <ul className="sv-result-fleet">
        {fates.map((f) => (
          <li key={f.shipId} className={`fate-${f.fate}`}>
            <span className="sv-result-ship">
              <ShipGlyph type={f.type} side={side} flip={side === 'foe'} fate={f.fate} size={40} />
              <span>{f.name}</span>
            </span>
            <span />
            <span>{t(`seaView.sum.fate.${f.fate}`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <CardScene
      assetId={seaResultAsset(summary.outcome)}
      testId="sea-summary"
      className={`bc-result outcome-${summary.outcome}`}
      data={{ outcome: summary.outcome }}
      kicker={title}
      title={t(`seabattle.result.title.${summary.outcome}`)}
      titleTestId="sea-outcome"
      titleData={{ outcome: summary.outcome }}
      text={t(`seabattle.result.line.${summary.outcome}`)}
      facts={
        <span data-testid="sea-sum-plunder">
          {t('seaView.sum.plunder')}: {plunderText(summary, t)}
        </span>
      }
    >
      <div className="bc-stats">
        {stat(t('seaView.sum.sunk'), summary.enemySunk, 'sea-sum-sunk')}
        {stat(t('seaView.sum.taken'), summary.enemyTaken, 'sea-sum-taken')}
        {stat(t('seaView.sum.lost'), summary.ownLost, 'sea-sum-lost')}
        {stat(t('seaView.sum.menLost'), formatNumber(summary.own.killed + summary.own.captured), 'sea-sum-men', t('seaView.sum.theirMen', { n: formatNumber(summary.enemy.killed + summary.enemy.captured) }))}
      </div>
      <Disclosure summary={t('seabattle.result.details')} className="bc-details" data-testid="sea-sum-details">
        {fleet(t('seaView.sum.yours'), summary.own.fates, 'own')}
        {fleet(t('seaView.sum.theirs'), summary.enemy.fates, 'foe')}
        {summary.durationS > 0 && <p className="muted">{t('seaView.sum.duration', { time: clock(summary.durationS) })}</p>}
      </Disclosure>
      {error && (
        <p className="bc-error" role="alert" data-testid="sea-return-error">
          {error}
        </p>
      )}
      {children}
    </CardScene>
  );
}

/** The scene's title: the waters it is fought in. */
export function seaTitle(setup: SeaBattleSetup, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const key = `seabattle.arena.${setup.arena}`;
  return hasKey(key) ? t('seaView.titleAt', { arena: t(key) }) : t('seaView.title');
}

/**
 * The outcome of a sea fight the captains settled (route 'seaBattleResult', params `{ seaBattleId }`): read
 * from the sea-battle slot, which keeps the setup and the result until the next fight.
 */
function SeaBattleResultRoute({ params, close }: ScreenProps): ReactElement | null {
  const t = useT();
  const state = useGame((s) => s.state);
  const slot = state?.subsims.seaBattle;
  const id = params?.['seaBattleId'];
  const ok = !!slot && slot.id === id && slot.result !== undefined;
  useEffect(() => {
    if (!ok) close();
  }, [ok, close]);
  if (!ok || !slot?.result) return null;
  const side = slot.setup.attacker.isPlayer ? 'attacker' : 'defender';
  const summary = summarizeSea(slot.setup, slot.result, side);
  return (
    <SeaResultScene summary={summary} title={seaTitle(slot.setup, t)}>
      <SceneChoices
        inView={[{ id: 'continue', label: t('seabattle.result.continue'), line: t('seabattle.result.continueLine'), tone: 'primary', testId: 'decision-choice-continue', onPick: close }]}
        more={[]}
        moreLabel=""
        backLabel=""
        label={t(`seabattle.result.title.${summary.outcome}`)}
      />
    </SeaResultScene>
  );
}

export const seaBattleResultScreen: ScreenDescriptor = { id: 'seaBattleResult', route: 'seaBattleResult', component: SeaBattleResultRoute, layout: 'fullscreen', titleKey: 'seabattle.result.screen' };
