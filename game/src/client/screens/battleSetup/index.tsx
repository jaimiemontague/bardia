/**
 * Before the Battle (pending 'battleSetup', design §13.4), a full-screen scene by ARCHITECTURE §20.7: the
 * painting of our war-band forming its line (`battle.scene.before`), and on the left the battle's name, the two
 * sides facing each other (who leads them, how many men), the odds from the battle module's own
 * `predictBattle` (the numbers auto-resolve uses) as one word, and two big choices: take the field (the
 * battlefield screen registered for mode 'battle', src/client/screens/battle) or let the captains decide
 * (auto-resolve now, then the painted outcome: route 'battleResult'). The squads, gear, the exact chance, the
 * expected losses and the auto-resolve penalty are behind Details. While the fight runs, this scene hides (the
 * decision stays pending until the battlefield hands the result back).
 */
import { useMemo, type ReactElement } from 'react';
import type { BattleSetup, CharId, GameState, PendingDecision, SideSetup } from '@sim/core/state';
import { predictBattle } from '@sim/battle/autoresolve';
import { loadContent } from '../../app/content';
import { useGame, usePending } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import { useScreenRegistry } from '../../app/registryContext';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { SceneChoices, type SceneChoiceItem } from '../../render/scenes/index';
import { Disclosure, Icon, Portrait, recipeForCharacter, StatLine } from '../../ui/index';
import { CardScene } from '../battle/cardScene';
import { battleName } from '../battle/ResultScene';
import { unitName } from '../expedition/names';
import { useMusicState } from '../../audio/hooks';
import { battleMusic } from '../../audio/screenMusic';
import './battleSetup.css';

function menOf(side: SideSetup): number {
  let men = 0;
  for (const sq of side.squads) men += sq.men;
  return men;
}

/** Who leads a side: its chief, else the leader of its largest squad. */
function leaderOf(side: SideSetup): CharId | undefined {
  if (side.chiefId !== undefined) return side.chiefId;
  let best: { id: CharId; men: number } | undefined;
  for (const sq of side.squads) if (!best || sq.men > best.men) best = { id: sq.leaderId, men: sq.men };
  return best?.id;
}

/** One side: a banner (the leader's portrait, else a shield), who leads it, and how many men. */
function Side({ state, side, title }: { state: GameState; side: SideSetup; title: string }): ReactElement {
  const t = useT();
  const leader = leaderOf(side);
  const c = leader !== undefined && Object.hasOwn(state.characters, leader) ? state.characters[leader] : undefined;
  const faction = state.factions[side.factionId]?.name ?? side.factionId;
  const who = side.isPlayer ? 'player' : 'enemy';
  return (
    <section className={`bc-side ${side.isPlayer ? 'is-own' : 'is-foe'}`} data-testid={`bs-side-${who}`} title={faction}>
      <span className="bc-side-banner">
        {c ? <Portrait recipe={recipeForCharacter(c, state)} alt={t('battle.ui.leaderAlt', { name: c.name })} size="sm" initial={c.name.slice(0, 1)} /> : <Icon name="shieldRound" />}
      </span>
      <span className="bc-side-title">{title}</span>
      <span className="bc-side-who">{c ? t('battle.ui.ledBy', { name: c.name }) : faction}</span>
      <span className="bc-side-num" data-testid={`bs-men-${who}`}>
        {t('battle.ui.men', { men: menOf(side) })}
      </span>
    </section>
  );
}

function SquadList({ state, side, title }: { state: GameState; side: SideSetup; title: string }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  return (
    <div className="bs-detail-side">
      <h4>{title}</h4>
      <ul className="bs-squads">
        {side.squads.map((sq, i) => (
          <li key={`${sq.leaderId}-${sq.unit}-${i}`}>
            <span>{unitName(content, sq.unit)}</span>
            <span className="muted">{state.characters[sq.leaderId]?.name ?? ''}</span>
            <span className="num">{formatNumber(sq.men)}</span>
          </li>
        ))}
      </ul>
      <p className="muted">{t('battle.setup.gear', { armour: side.armourTier, weapons: side.weaponTier })}</p>
    </div>
  );
}

function Missing(): ReactElement {
  const t = useT();
  return (
    <CardScene assetId="battle.scene.before" testId="battle-setup" title={t('ui.decision.kind.battleSetup')} text={t('battle.setup.missing')} />
  );
}

function BattleSetupScene({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const registry = useScreenRegistry();
  const loaded = loadContent();
  const battleId = (pending.payload as { battleId?: string }).battleId;
  const slot = state.subsims.battle;
  const setup: BattleSetup | undefined = slot && slot.id === battleId ? (slot.setup as BattleSetup) : undefined;
  const prediction = useMemo(() => (setup && loaded.ok ? predictBattle(setup, loaded.content) : null), [setup, loaded]);
  useMusicState(battleMusic(setup?.kind));
  const canFight = registry.forMode('battle') !== undefined;
  if (!setup || battleId === undefined) return <Missing />;
  const player = setup.attacker.isPlayer ? setup.attacker : setup.defender;
  const enemy = setup.attacker.isPlayer ? setup.defender : setup.attacker;
  const pct = (x: number) => Math.round(x * 100);
  const auto = () => {
    const r = dispatch({ type: 'startBattle', battleId, mode: 'auto' } as never);
    // The outcome as its own painted scene (the slot keeps the setup and the result).
    if (r && !r.error) navigation.open('battleResult', { battleId });
  };
  const choices: SceneChoiceItem[] = [
    {
      id: 'fight',
      label: t('battle.setup.fight'),
      line: canFight ? t('battle.ui.fightHint') : t('battle.setup.fieldNotReady'),
      tone: canFight ? 'primary' : 'quiet',
      ...(canFight ? {} : { disabled: true }),
      testId: 'battle-fight',
      onPick: () => dispatch({ type: 'startBattle', battleId, mode: 'fight' } as never),
    },
    {
      id: 'auto',
      label: t('battle.ui.auto'),
      line: prediction && prediction.playerPenalty > 0 ? t('battle.ui.autoHintPenalty') : t('battle.ui.autoHint'),
      tone: canFight ? 'safe' : 'primary',
      testId: 'battle-auto',
      onPick: auto,
    },
  ];
  return (
    <CardScene
      assetId="battle.scene.before"
      testId="battle-setup"
      className="bs-card"
      data={{ kind: setup.kind }}
      kicker={t('battle.setup.kicker')}
      title={battleName(state, setup, t)}
    >
      <div className="bc-face">
        <Side state={state} side={player} title={t('battle.setup.yours')} />
        <span className="bc-vs">{t('battle.ui.vs')}</span>
        <Side state={state} side={enemy} title={t(setup.attacker.isPlayer ? 'battle.setup.theirs' : 'battle.setup.attackers')} />
      </div>
      {prediction && (
        <p className={`bc-odds band-${prediction.band}`} data-testid="battle-odds" data-band={prediction.band}>
          <span>{t('battle.ui.oddsLabel')}</span>
          <span className="bc-odds-word">{t(`battle.band.${prediction.band}`)}</span>
        </p>
      )}
      <SceneChoices inView={choices} more={[]} moreLabel="" backLabel="" label={t('battle.setup.choicesLabel')} />
      <Disclosure className="bc-details bs-details" data-testid="battle-details">
        {prediction && (
          <div className="bs-numbers">
            <StatLine icon="dice" label={t('battle.ui.chance')} value={`${pct(prediction.winProbability)}%`} data-testid="battle-chance" />
            <StatLine icon="men" label={t('battle.ui.lossIfWin')} value={`${pct(prediction.ownLossShare.ifWin)}%`} />
            <StatLine icon="warning" label={t('battle.ui.lossIfLoss')} value={`${pct(prediction.ownLossShare.ifLoss)}%`} />
            {prediction.playerPenalty > 0 && <StatLine icon="hourglass" label={t('battle.ui.penalty')} value={`${pct(prediction.playerPenalty)}%`} tone="warn" />}
          </div>
        )}
        <SquadList state={state} side={player} title={t('battle.setup.yours')} />
        <SquadList state={state} side={enemy} title={t(setup.attacker.isPlayer ? 'battle.setup.theirs' : 'battle.setup.attackers')} />
      </Disclosure>
    </CardScene>
  );
}

function BattleSetupScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  if (!pending || !state || pending.kind !== 'battleSetup') return null;
  // While the battle is fought on the field the decision stays pending (time stays stopped) but the
  // battlefield screen (mode 'battle') is in charge: nothing to show here.
  if (state.subsims.battle?.status === 'running' || state.meta.mode === 'battle') return null;
  return <BattleSetupScene key={pending.id} pending={pending} state={state} />;
}

export const screen: ScreenDescriptor = {
  id: 'battleSetup',
  pending: 'battleSetup',
  component: BattleSetupScreen,
  layout: 'fullscreen',
  titleKey: 'ui.decision.kind.battleSetup',
};
