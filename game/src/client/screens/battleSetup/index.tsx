/**
 * Before the Battle (pending 'battleSetup', design §13.4), laid out by ARCHITECTURE §20: the two sides face each
 * other (who leads them, how many men, a banner), the odds from the battle module's own `predictBattle` (the
 * numbers auto-resolve uses) as one word, and two big choices: take the field (the battlefield screen registered
 * for mode 'battle', src/client/screens/battle) or let the captains decide (auto-resolve now). The squads, gear,
 * the exact chance, the expected losses and the auto-resolve penalty are behind Details. While the fight runs,
 * this card hides (the decision stays pending until the battlefield hands the result back).
 */
import { useMemo, type ReactElement } from 'react';
import type { BattleSetup, CharId, GameState, PendingDecision, SideSetup } from '@sim/core/state';
import { predictBattle } from '@sim/battle/autoresolve';
import { loadContent } from '../../app/content';
import { useGame, usePending } from '../../app/gameStore';
import { useScreenRegistry } from '../../app/registryContext';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, useT } from '../../i18n/index';
import {
  Button,
  Disclosure,
  Icon,
  Modal,
  Portrait,
  recipeForCharacter,
  StatLine,
  Tooltip,
} from '../../ui/index';
import { unitName } from '../expedition/names';
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

/** One side: a banner (the leader's portrait, else a shield), who, and how many men. */
function Side({ state, side, title }: { state: GameState; side: SideSetup; title: string }): ReactElement {
  const t = useT();
  const leader = leaderOf(side);
  const c =
    leader !== undefined && Object.hasOwn(state.characters, leader) ? state.characters[leader] : undefined;
  const faction = state.factions[side.factionId]?.name ?? side.factionId;
  return (
    <section
      className={`bs-side ${side.isPlayer ? 'is-own' : 'is-foe'}`}
      data-testid={`bs-side-${side.isPlayer ? 'player' : 'enemy'}`}
    >
      <span className="bs-side-title">{title}</span>
      <span className="bs-banner">
        {c ? (
          <Portrait
            recipe={recipeForCharacter(c, state)}
            alt={t('battle.ui.leaderAlt', { name: c.name })}
            size="lg"
            initial={c.name.slice(0, 1)}
          />
        ) : (
          <Icon name="shieldRound" />
        )}
      </span>
      <span className="bs-who">{c ? t('battle.ui.ledBy', { name: c.name }) : faction}</span>
      {c && <span className="bs-faction">{faction}</span>}
      <span className="bs-men" data-testid={`bs-men-${side.isPlayer ? 'player' : 'enemy'}`}>
        {t('battle.ui.men', { men: menOf(side) })}
      </span>
    </section>
  );
}

function SquadList({
  state,
  side,
  title,
}: {
  state: GameState;
  side: SideSetup;
  title: string;
}): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const content = loaded.ok ? loaded.content : null;
  return (
    <div className="bs-detail-side">
      <span className="bs-detail-title">{title}</span>
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

function BattleSetupCard({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const registry = useScreenRegistry();
  const loaded = loadContent();
  const battleId = (pending.payload as { battleId?: string }).battleId;
  const slot = state.subsims.battle;
  const setup: BattleSetup | undefined =
    slot && slot.id === battleId ? (slot.setup as BattleSetup) : undefined;
  const prediction = useMemo(
    () => (setup && loaded.ok ? predictBattle(setup, loaded.content) : null),
    [setup, loaded],
  );
  const canFight = registry.forMode('battle') !== undefined;
  if (!setup || battleId === undefined) {
    return (
      <Modal open layer="decision" title={t('ui.decision.kind.battleSetup')} data-testid="battle-setup">
        <p>{t('battle.setup.missing')}</p>
      </Modal>
    );
  }
  const place = setup.settlementId !== undefined ? state.settlements[setup.settlementId]?.name : undefined;
  const player = setup.attacker.isPlayer ? setup.attacker : setup.defender;
  const enemy = setup.attacker.isPlayer ? setup.defender : setup.attacker;
  const pct = (x: number) => Math.round(x * 100);
  const fight = (
    <Button
      variant={canFight ? 'primary' : 'secondary'}
      size="lg"
      icon="sword"
      disabled={!canFight}
      onClick={() => dispatch({ type: 'startBattle', battleId, mode: 'fight' } as never)}
      data-autofocus={canFight ? true : undefined}
      data-testid="battle-fight"
    >
      {t('battle.setup.fight')}
    </Button>
  );
  return (
    <Modal
      open
      layer="decision"
      size="xl"
      className="bs-modal"
      title={
        place !== undefined
          ? t('battle.setup.titleAt', { kind: t(`battle.kind.${setup.kind}`), place })
          : t(`battle.kind.${setup.kind}`)
      }
      subtitle={formatGameDate(pending.hour)}
      tone="important"
      data-testid="battle-setup"
    >
      <div className="bs-scene">
        <Side state={state} side={player} title={t('battle.setup.yours')} />
        <div className="bs-middle">
          <span className="bs-vs">{t('battle.ui.vs')}</span>
          {prediction && (
            <div
              className={`bs-odds band-${prediction.band}`}
              data-testid="battle-odds"
              data-band={prediction.band}
            >
              <span className="bs-odds-label">{t('battle.ui.oddsLabel')}</span>
              <span className="bs-odds-word">{t(`battle.band.${prediction.band}`)}</span>
            </div>
          )}
        </div>
        <Side state={state} side={enemy} title={t('battle.setup.theirs')} />
      </div>
      <div className="bs-choices">
        <div className="bs-choice">
          {canFight ? fight : <Tooltip content={t('battle.setup.fieldNotReady')}>{fight}</Tooltip>}
          <span className="bs-hint">
            {canFight ? t('battle.ui.fightHint') : t('battle.setup.fieldNotReady')}
          </span>
        </div>
        <div className="bs-choice">
          <Button
            variant={canFight ? 'secondary' : 'primary'}
            size="lg"
            icon="dice"
            onClick={() => dispatch({ type: 'startBattle', battleId, mode: 'auto' } as never)}
            data-autofocus={canFight ? undefined : true}
            data-testid="battle-auto"
          >
            {t('battle.ui.auto')}
          </Button>
          <span className="bs-hint">
            {prediction && prediction.playerPenalty > 0
              ? t('battle.ui.autoHintPenalty')
              : t('battle.ui.autoHint')}
          </span>
        </div>
      </div>
      <Disclosure className="bs-details" data-testid="battle-details">
        {prediction && (
          <div className="bs-numbers">
            <StatLine
              icon="dice"
              label={t('battle.ui.chance')}
              value={`${pct(prediction.winProbability)}%`}
              data-testid="battle-chance"
            />
            <StatLine
              icon="men"
              label={t('battle.ui.lossIfWin')}
              value={`${pct(prediction.ownLossShare.ifWin)}%`}
            />
            <StatLine
              icon="warning"
              label={t('battle.ui.lossIfLoss')}
              value={`${pct(prediction.ownLossShare.ifLoss)}%`}
            />
            {prediction.playerPenalty > 0 && (
              <StatLine
                icon="hourglass"
                label={t('battle.ui.penalty')}
                value={`${pct(prediction.playerPenalty)}%`}
                tone="warn"
              />
            )}
          </div>
        )}
        <div className="bs-detail-sides">
          <SquadList state={state} side={player} title={t('battle.setup.yours')} />
          <SquadList state={state} side={enemy} title={t('battle.setup.theirs')} />
        </div>
      </Disclosure>
    </Modal>
  );
}

function BattleSetupScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  if (!pending || !state || pending.kind !== 'battleSetup') return null;
  // While the battle is fought on the field the decision stays pending (time stays stopped) but the
  // battlefield screen (mode 'battle') is in charge: nothing to show here.
  if (state.subsims.battle?.status === 'running' || state.meta.mode === 'battle') return null;
  return <BattleSetupCard pending={pending} state={state} />;
}

export const screen: ScreenDescriptor = {
  id: 'battleSetup',
  pending: 'battleSetup',
  component: BattleSetupScreen,
  layout: 'modal',
  titleKey: 'ui.decision.kind.battleSetup',
};
