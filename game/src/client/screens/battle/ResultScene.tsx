/**
 * After a land battle (§20.7): the painting of the field won (`battle.scene.victory`) or lost
 * (`battle.scene.defeat`, also for a withdrawal; a fight with no victor keeps `battle.scene.before`), the
 * outcome in a few words, who fell on each side as one sentence, the loot, and the way on. The full count
 * (killed, wounded, taken on both sides), the leaders' fates and the length of the fight sit behind Details.
 *
 * Shown by the battlefield when the fight ends (BattleScene, with the host's buttons) and after the captains
 * settled it (route 'battleResult', opened by Before the Battle). Test ids of the old summary card are kept:
 * `battle-summary`, `battle-outcome` (data-outcome), `battle-sum-loot`, `battle-leader-<id>`,
 * `battle-return-error`.
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { BattleSideKey } from '@sim/battle/types';
import type { BattleSetup, GameState } from '@sim/core/state';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { Disclosure } from '../../ui/index';
import { SceneChoices } from '../../render/scenes/index';
import { CardScene } from './cardScene';
import { clock } from './hud';
import { summarize, type BattleOutcome, type BattleSummary } from './summary';

/** The painting of an outcome. */
export function battleResultAsset(outcome: BattleOutcome): string {
  if (outcome === 'victory') return 'battle.scene.victory';
  if (outcome === 'draw') return 'battle.scene.before';
  return 'battle.scene.defeat';
}

/** The battle's name: its kind, at its place when it has one. */
export function battleName(state: GameState, setup: BattleSetup, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const kind = t(`battle.kind.${setup.kind}`);
  const place = setup.settlementId !== undefined ? state.settlements[setup.settlementId]?.name : undefined;
  return place !== undefined ? t('battle.setup.titleAt', { kind, place }) : kind;
}

export interface BattleResultSceneProps {
  summary: BattleSummary;
  /** The player's side (whose men are "ours"). */
  side: BattleSideKey;
  /** The battle's name (the kicker). */
  title: string;
  /** Why the fight ended (the engine's reason), when known. */
  reasonKey?: string | null;
  error?: string | null;
  /** The way on: buttons, or the scene's choices. */
  children: ReactNode;
}

/** The scene (see the file header). */
export function BattleResultScene({ summary, side, title, reasonKey, error, children }: BattleResultSceneProps): ReactElement {
  const t = useT();
  const rows: [string, keyof BattleSummary['own']][] = [
    ['battleView.sum.men', 'men'],
    ['battleView.sum.killed', 'killed'],
    ['battleView.sum.wounded', 'wounded'],
    ['battleView.sum.captured', 'captured'],
  ];
  const fell = t('battle.result.fell', { ours: summary.own.killed, theirs: summary.enemy.killed });
  const facts: string[] = [];
  if (summary.lootValue > 0 || side === 'attacker') facts.push(t('battleView.sum.loot', { value: summary.lootValue, silver: summary.lootSilver }));
  if (summary.chief.killed || summary.chief.captured) facts.push(t(summary.chief.killed ? 'battleView.sum.chiefKilled' : 'battleView.sum.chiefCaptured'));
  return (
    <CardScene
      assetId={battleResultAsset(summary.outcome)}
      testId="battle-summary"
      className={`bc-result outcome-${summary.outcome}`}
      data={{ outcome: summary.outcome }}
      kicker={title}
      title={t(`battle.result.title.${summary.outcome}`)}
      titleTestId="battle-outcome"
      titleData={{ outcome: summary.outcome }}
      text={reasonKey ? `${t(reasonKey)} ${fell}` : fell}
      facts={
        facts.length > 0 ? (
          <span data-testid="battle-sum-loot">{facts.join(' ')}</span>
        ) : undefined
      }
    >
      <Disclosure summary={t('battle.result.details')} className="bc-details" data-testid="battle-sum-details">
        <table className="bc-table">
          <thead>
            <tr>
              <th />
              <th>{t('battleView.sum.yours')}</th>
              <th>{t('battleView.sum.theirs')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, k]) => (
              <tr key={k}>
                <th>{t(label)}</th>
                <td className="num">{formatNumber(summary.own[k])}</td>
                <td className="num">{formatNumber(summary.enemy[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.lootGoods.length > 0 && (
          <p>
            {t('battleView.sum.goods', {
              list: [...summary.lootGoods]
                .sort((a, b) => b.tons - a.tons)
                .slice(0, 6)
                .map((g) => t('battleView.sum.good', { tons: formatNumber(g.tons, { maximumFractionDigits: 2 }), good: t(`economy.good.${g.good}`) }))
                .join(', '),
              more: Math.max(0, summary.lootGoods.length - 6),
            })}
          </p>
        )}
        {summary.buildingsBurned > 0 && <p>{t('battleView.sum.burned', { n: summary.buildingsBurned })}</p>}
        {summary.leaders.length > 0 && (
          <>
            <h4>{t('battleView.sum.leaders')}</h4>
            <ul>
              {summary.leaders.map((l) => (
                <li key={l.id} className={`fate-${l.fate}`} data-testid={`battle-leader-${l.id}`}>
                  <span>{l.name}</span>
                  <span className="muted">{t(l.side === side ? 'battleView.sum.yours' : 'battleView.sum.theirs')}</span>
                  <span>{t(`battleView.fate.${l.fate}`)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {summary.durationS > 0 && <p className="muted">{t('battleView.sum.duration', { time: clock(summary.durationS) })}</p>}
      </Disclosure>
      {error && (
        <p className="bc-error" role="alert" data-testid="battle-return-error">
          {error}
        </p>
      )}
      {children}
    </CardScene>
  );
}

/** The player's side of a setup. */
export function playerSide(setup: BattleSetup): BattleSideKey {
  return setup.attacker.isPlayer ? 'attacker' : 'defender';
}

/**
 * The outcome of a battle the captains settled (route 'battleResult', params `{ battleId }`): read from the
 * battle slot, which keeps the setup and the result until the next battle. Closes itself when the slot names
 * another battle.
 */
function BattleResultRoute({ params, close }: ScreenProps): ReactElement | null {
  const t = useT();
  const state = useGame((s) => s.state);
  const slot = state?.subsims.battle;
  const id = params?.['battleId'];
  const ok = !!state && !!slot && slot.id === id && slot.result !== undefined;
  useEffect(() => {
    if (!ok) close();
  }, [ok, close]);
  if (!ok || !state || !slot?.result) return null;
  const setup = slot.setup;
  const side = playerSide(setup);
  const summary = summarize(setup, slot.result, side, (cid) => (Object.hasOwn(state.characters, cid) ? state.characters[cid as keyof typeof state.characters]?.name : undefined));
  return (
    <BattleResultScene summary={summary} side={side} title={battleName(state, setup, t)}>
      <SceneChoices
        inView={[{ id: 'continue', label: t('battle.result.continue'), line: t('battle.result.continueLine'), tone: 'primary', testId: 'decision-choice-continue', onPick: close }]}
        more={[]}
        moreLabel=""
        backLabel=""
        label={t('battle.result.title.' + summary.outcome)}
      />
    </BattleResultScene>
  );
}

export const battleResultScreen: ScreenDescriptor = { id: 'battleResult', route: 'battleResult', component: BattleResultRoute, layout: 'fullscreen', titleKey: 'battle.result.screen' };
