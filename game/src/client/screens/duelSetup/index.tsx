/**
 * Before the Duel (pending 'duel', design §14), laid out by ARCHITECTURE §20: the stakes in one sentence, the two
 * fighters facing each other (portrait, name, weapon), the odds from the duel module's own `duelWinProbability`
 * over the fighters' ratings (what auto-resolve rolls against) as one word, and the module's own answers as big
 * buttons: fight it out (only when a duel scene is registered for mode 'duel'), let fate decide
 * (`startDuel { mode: 'auto' }`), or decline (challenges that allow it). Levels, skills, gear tiers and the exact
 * chance are behind Details. Without a screen the decision has no answer on screen and time stops for good
 * (ARCHITECTURE §6).
 */
import type { ReactElement } from 'react';
import type { DuelSetup, GameState, PendingDecision } from '@sim/core/state';
import { duelWinProbability } from '@sim/duel/autoresolve';
import { loadContent } from '../../app/content';
import { useGame, usePending } from '../../app/gameStore';
import { useScreenRegistry } from '../../app/registryContext';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { useT } from '../../i18n/index';
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
import './duelSetup.css';

type Band = 'decisive' | 'likely' | 'even' | 'risky' | 'hopeless';

/** The duel `duelId` from the slot or the queue. */
export function findDuel(state: GameState, duelId: string | undefined): DuelSetup | undefined {
  if (duelId === undefined) return undefined;
  const slot = state.subsims.duel;
  if (slot && slot.id === duelId) return slot.setup;
  return state.subsims.duelQueue?.find((q) => q.id === duelId)?.setup;
}

/** The chance in a word, by the same bands the battle odds use. */
export function duelBand(
  p: number,
  bands: { decisive: number; likely: number; even: number; risky: number },
): Band {
  if (p >= bands.decisive) return 'decisive';
  if (p >= bands.likely) return 'likely';
  if (p >= bands.even) return 'even';
  if (p >= bands.risky) return 'risky';
  return 'hopeless';
}

function weaponName(d: DuelSetup['a']): string {
  const loaded = loadContent();
  return (
    (loaded.ok
      ? (loaded.content.balance.weapons as Record<string, { name: string } | undefined>)[d.weapon]?.name
      : undefined) ?? d.weapon
  );
}

function Fighter({
  state,
  side,
  setup,
  title,
}: {
  state: GameState;
  side: 'a' | 'b';
  setup: DuelSetup;
  title: string;
}): ReactElement {
  const t = useT();
  const d = setup[side];
  const c = state.characters[d.charId];
  const own = setup.playerSide === side;
  return (
    <section
      className={`dls-side ${own ? 'is-own' : 'is-foe'}`}
      data-testid={`dls-side-${own ? 'player' : 'enemy'}`}
    >
      <span className="dls-side-title">{title}</span>
      <span className="dls-banner">
        {c ? (
          <Portrait
            recipe={recipeForCharacter(c, state)}
            alt={t('duelView.ui.portraitAlt', { name: c.name })}
            size="lg"
            initial={c.name.slice(0, 1)}
          />
        ) : (
          <Icon name="sword" />
        )}
      </span>
      <span className="dls-name">{c?.name ?? ''}</span>
      <span className="dls-weapon">{t('duelView.ui.weapon', { weapon: weaponName(d) })}</span>
    </section>
  );
}

function DuelSetupCard({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const registry = useScreenRegistry();
  const loaded = loadContent();
  const duelId = (pending.payload as { duelId?: string }).duelId;
  const setup = findDuel(state, duelId);
  if (!setup || duelId === undefined) {
    return (
      <Modal open layer="decision" title={t('duelView.setup.title')} data-testid="duel-setup">
        <p>{t('duelView.setup.missing')}</p>
        <Button
          variant="primary"
          onClick={() => dispatch({ type: 'startDuel', duelId, mode: 'auto' } as never)}
          data-testid="duel-auto"
        >
          {t('duelView.ui.auto')}
        </Button>
      </Modal>
    );
  }
  const mine: 'a' | 'b' = setup.playerSide === 'b' ? 'b' : 'a';
  const theirs: 'a' | 'b' = mine === 'a' ? 'b' : 'a';
  const pA =
    setup.profiles && loaded.ok
      ? duelWinProbability(loaded.content.balance, setup.profiles.a.rating, setup.profiles.b.rating)
      : null;
  const p = pA !== null ? (mine === 'a' ? pA : 1 - pA) : null;
  const band = p !== null && loaded.ok ? duelBand(p, loaded.content.balance.autoresolve.outcomeBands) : null;
  const canFight = registry.forMode('duel') !== undefined;
  const lethal = setup.lethal === true || setup.stakes === 'death';
  const fight = (
    <Button
      variant={canFight ? 'primary' : 'secondary'}
      size="lg"
      icon="sword"
      disabled={!canFight}
      onClick={() => dispatch({ type: 'startDuel', duelId, mode: 'assisted' } as never)}
      data-autofocus={canFight ? true : undefined}
      data-testid="duel-fight"
    >
      {t('duelView.setup.fight')}
    </Button>
  );
  const me = state.characters[setup[mine].charId];
  const foe = state.characters[setup[theirs].charId];
  return (
    <Modal
      open
      layer="decision"
      size="xl"
      className="dls-modal"
      title={t('duelView.setup.titleVs', { name: foe?.name ?? '' })}
      subtitle={formatGameDate(pending.hour)}
      tone={lethal ? 'critical' : 'important'}
      data-testid="duel-setup"
    >
      <p className={`dls-stakes ${lethal ? 'is-lethal' : ''}`} data-testid="duel-stakes">
        {t('duelView.setup.stakes', { stakes: setup.stakes, arena: setup.arena })}
      </p>
      <div className="dls-scene">
        <Fighter state={state} side={mine} setup={setup} title={t('duelView.setup.yours')} />
        <div className="dls-middle">
          <span className="dls-vs">{t('duelView.ui.vs')}</span>
          {band !== null && (
            <div className={`dls-odds band-${band}`} data-testid="duel-odds" data-band={band}>
              <span className="dls-odds-label">{t('duelView.ui.oddsLabel')}</span>
              <span className="dls-odds-word">{t(`battle.band.${band}`)}</span>
            </div>
          )}
        </div>
        <Fighter state={state} side={theirs} setup={setup} title={t('duelView.setup.theirs')} />
      </div>
      <div className={`dls-choices ${setup.declinable === true ? 'has-three' : ''}`}>
        <div className="dls-choice">
          {canFight ? fight : <Tooltip content={t('duelView.setup.ringNotReady')}>{fight}</Tooltip>}
          <span className="dls-hint">
            {canFight ? t('duelView.ui.fightHint') : t('duelView.setup.ringNotReady')}
          </span>
        </div>
        <div className="dls-choice">
          <Button
            variant={canFight ? 'secondary' : 'primary'}
            size="lg"
            icon="dice"
            onClick={() => dispatch({ type: 'startDuel', duelId, mode: 'auto' } as never)}
            data-autofocus={canFight ? undefined : true}
            data-testid="duel-auto"
          >
            {t('duelView.ui.auto')}
          </Button>
          <span className="dls-hint">{t('duelView.ui.autoHint')}</span>
        </div>
        {setup.declinable === true && (
          <div className="dls-choice">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => dispatch({ type: 'startDuel', duelId, mode: 'decline' } as never)}
              data-testid="duel-decline"
            >
              {t('duelView.setup.decline')}
            </Button>
            <span className="dls-hint">{t('duelView.ui.declineHint')}</span>
          </div>
        )}
      </div>
      <Disclosure className="dls-details" data-testid="duel-details">
        <div className="dls-numbers">
          {p !== null && (
            <StatLine
              icon="dice"
              label={t('duelView.ui.chance')}
              value={`${Math.round(p * 100)}%`}
              data-testid="duel-chance"
            />
          )}
          <StatLine
            icon="character"
            label={t('duelView.ui.yourFighter', { name: me?.name ?? '' })}
            value={t('duelView.setup.fighter', { level: me?.level ?? 1, melee: me?.skills.melee ?? 0 })}
          />
          <StatLine
            icon="character"
            label={t('duelView.ui.theirFighter', { name: foe?.name ?? '' })}
            value={t('duelView.setup.fighter', { level: foe?.level ?? 1, melee: foe?.skills.melee ?? 0 })}
          />
          <StatLine
            icon="shieldRound"
            label={t('duelView.ui.yourGear')}
            value={t('duelView.setup.gear', {
              weapon: weaponName(setup[mine]),
              armour: setup[mine].armourTier,
              weapons: setup[mine].weaponTier,
            })}
          />
          <StatLine
            icon="shieldRound"
            label={t('duelView.ui.theirGear')}
            value={t('duelView.setup.gear', {
              weapon: weaponName(setup[theirs]),
              armour: setup[theirs].armourTier,
              weapons: setup[theirs].weaponTier,
            })}
          />
        </div>
      </Disclosure>
    </Modal>
  );
}

function DuelSetupScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  if (!pending || !state || pending.kind !== 'duel') return null;
  return <DuelSetupCard pending={pending} state={state} />;
}

export const screen: ScreenDescriptor = {
  id: 'duelSetup',
  pending: 'duel',
  component: DuelSetupScreen,
  layout: 'modal',
  titleKey: 'duelView.setup.title',
};
