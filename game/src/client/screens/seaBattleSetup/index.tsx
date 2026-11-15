/**
 * Before the Sea Battle (pending 'seaBattle', design §15.2, §15.5; §20 big and simple): the two fleets
 * as pictures of their ships with the men aboard, the wind, the odds as a word (from the module's own
 * `seaWinProbability`, the numbers auto-resolve uses), and two choices: take the helm (the sea-battle
 * scene, primary) or let the captains fight it (the module's `startSeaBattle { mode: 'auto' }`). Hull
 * points, gear, the exact chance and the auto-resolve cost sit behind Details. Without this screen the
 * decision would have no answer on screen and time would stop for good (ARCHITECTURE §6).
 */
import { useMemo, type ReactElement } from 'react';
import type { GameState, PendingDecision, SeaBattleSetup, SeaSideSetup } from '@sim/core/state';
import { seaWinProbability } from '@sim/seabattle/autoresolve';
import { loadContent } from '../../app/content';
import { useGame, usePending } from '../../app/gameStore';
import { useScreenRegistry } from '../../app/registryContext';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, useT } from '../../i18n/index';
import { Button, Modal, Tooltip } from '../../ui/index';
import { compassPoint } from '../seaBattle/logic';
import { ShipGlyph } from '../seaBattle/ShipGlyph';
import './seaBattleSetup.css';

/** Odds band of a win probability (balance.autoresolve.outcomeBands; same cut-offs as the land battle). */
export function seaBand(p: number, bands: { decisive: number; likely: number; even: number; risky: number }): 'decisive' | 'likely' | 'even' | 'risky' | 'hopeless' {
  if (p >= bands.decisive) return 'decisive';
  if (p >= bands.likely) return 'likely';
  if (p >= bands.even) return 'even';
  if (p >= bands.risky) return 'risky';
  return 'hopeless';
}

/** Ships shown as pictures before "+N" (a big fleet stays readable). */
const MAX_PICTURES = 6;

function crewOf(side: SeaSideSetup): number {
  return side.ships.reduce((a, s) => a + s.crew, 0);
}

function Fleet({ side, own, title }: { side: SeaSideSetup; own: boolean; title: string }): ReactElement {
  const t = useT();
  const shown = side.ships.slice(0, MAX_PICTURES);
  const more = side.ships.length - shown.length;
  const size = side.ships.length <= 2 ? 120 : side.ships.length <= 4 ? 96 : 78;
  return (
    <section className={`sbs-fleet ${own ? 'is-own' : 'is-foe'}`} data-testid={`sbs-side-${own ? 'player' : 'enemy'}`}>
      <h3>{title}</h3>
      <div className="sbs-ships">
        {shown.map((s) => (
          <ShipGlyph key={s.shipId} type={s.type} side={own ? 'own' : 'foe'} flip={!own} size={size} title={s.name ?? s.type} />
        ))}
        {more > 0 && <span className="sbs-more">+{more}</span>}
      </div>
      <p className="sbs-count">
        <span className="num">{t('seaView.setup.shipCount', { ships: side.ships.length })}</span>
        <span className="sbs-men num">{t('seaView.setup.men', { men: formatNumber(crewOf(side)) })}</span>
      </p>
    </section>
  );
}

function Details({ state, player, enemy, pct, penalty }: { state: GameState; player: SeaSideSetup; enemy: SeaSideSetup; pct: number | null; penalty: number }): ReactElement {
  const t = useT();
  const loaded = loadContent();
  const ships = loaded.ok ? loaded.content.balance.ships : undefined;
  const side = (s: SeaSideSetup, title: string) => {
    const captain = s.captainId !== undefined ? state.characters[s.captainId]?.name : undefined;
    return (
      <div className="sbs-detail-side">
        <h4>{title}</h4>
        <p className="muted">{t('seaView.setup.sideLine', { faction: state.factions[s.factionId]?.name ?? '', ships: s.ships.length, men: formatNumber(crewOf(s)) })}</p>
        {captain !== undefined && <p className="muted">{t('seaView.setup.captain', { name: captain })}</p>}
        <ul>
          {s.ships.map((x) => (
            <li key={x.shipId}>
              <span>{x.name ?? ships?.[x.type]?.name ?? x.type}</span>
              <span className="muted">{t('seaView.setup.hull', { hull: Math.round(x.hullHp), max: ships?.[x.type]?.hull ?? Math.round(x.hullHp) })}</span>
              <span className="num">{formatNumber(x.crew)}</span>
            </li>
          ))}
        </ul>
        <p className="muted">{t('seaView.setup.gear', { armour: s.armourTier, weapons: s.weaponTier, morale: Math.round(s.morale) })}</p>
      </div>
    );
  };
  return (
    <details className="sbs-details" data-testid="sea-battle-details">
      <summary>{t('seaView.setup.details')}</summary>
      <div className="sbs-details-body">
        {pct !== null && <p>{t('seaView.setup.chance', { pct })}</p>}
        {penalty > 0 && <p className="muted">{t('seaView.setup.autoPenalty', { pct: Math.round(penalty * 100) })}</p>}
        <div className="sbs-detail-sides">
          {side(player, t('seaView.setup.yours'))}
          {side(enemy, t('seaView.setup.theirs'))}
        </div>
      </div>
    </details>
  );
}

function SeaBattleSetupCard({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const registry = useScreenRegistry();
  const loaded = loadContent();
  const seaBattleId = (pending.payload as { seaBattleId?: string }).seaBattleId;
  const slot = state.subsims.seaBattle;
  const setup: SeaBattleSetup | undefined = slot && slot.id === seaBattleId ? slot.setup : undefined;
  const odds = useMemo(() => {
    if (!setup || !loaded.ok) return null;
    const p = seaWinProbability({ balance: loaded.content.balance, tunables: loaded.content.tunables.seabattle }, setup).pAttacker;
    return setup.attacker.isPlayer ? p : 1 - p;
  }, [setup, loaded]);
  const canFight = registry.forMode('seaBattle') !== undefined;
  const auto = () => dispatch({ type: 'startSeaBattle', seaBattleId, mode: 'auto' } as never);
  if (!setup || seaBattleId === undefined) {
    return (
      <Modal open layer="decision" title={t('seaView.setup.title')} data-testid="sea-battle-setup">
        <p>{t('seaView.setup.missing')}</p>
      </Modal>
    );
  }
  const player = setup.attacker.isPlayer ? setup.attacker : setup.defender;
  const enemy = setup.attacker.isPlayer ? setup.defender : setup.attacker;
  const pct = odds !== null ? Math.round(odds * 100) : null;
  const band = odds !== null && loaded.ok ? seaBand(odds, loaded.content.balance.autoresolve.outcomeBands) : null;
  const penalty = player.playerPenalty ?? 0;
  const fight = (
    <Button variant={canFight ? 'primary' : 'secondary'} size="lg" icon="ship" disabled={!canFight} onClick={() => dispatch({ type: 'startSeaBattle', seaBattleId, mode: 'fight' } as never)} data-autofocus={canFight ? true : undefined} data-testid="sea-battle-fight">
      {t('seaView.setup.fight')}
    </Button>
  );
  const downwind = setup.wind.dir + 180;
  return (
    <Modal
      open
      layer="decision"
      size="xl"
      title={t(setup.attacker.isPlayer ? 'seaView.setup.titleAttack' : 'seaView.setup.titleDefend', { faction: state.factions[enemy.factionId]?.name ?? '' })}
      subtitle={formatGameDate(pending.hour)}
      tone="important"
      className="sbs-modal"
      data-testid="sea-battle-setup"
    >
      <div className="sbs-scene">
        <Fleet side={player} own title={t('seaView.setup.yours')} />
        <div className="sbs-middle">
          <div className="sbs-wind" data-testid="sea-battle-wind">
            <svg viewBox="-20 -20 40 40" width="64" height="64" aria-hidden="true">
              <circle r="18" fill="rgba(10,30,40,0.55)" stroke="#9fc4cc" strokeWidth="1" />
              <text y="-10.5" textAnchor="middle" fontSize="7" fill="#e8d9b0" fontFamily="Cinzel, serif">
                N
              </text>
              <g transform={`rotate(${downwind})`}>
                <path d="M0 -13 L0 11" stroke="#e8f4f6" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M0 14 L-5 6 L5 6 Z" fill="#e8f4f6" />
              </g>
            </svg>
            <span>
              <strong>{t('seaView.wind.word', { str: setup.wind.str })}</strong> {t('seaView.wind.from', { dir: compassPoint(setup.wind.dir) })}
            </span>
          </div>
          <span className="sbs-vs">{t('seaView.setup.vs')}</span>
          {band !== null && (
            <div className={`sbs-odds band-${band}`} data-testid="sea-battle-odds" data-band={band}>
              {t('seaView.setup.oddsWord', { band })}
            </div>
          )}
        </div>
        <Fleet side={enemy} own={false} title={t('seaView.setup.theirs')} />
      </div>
      <div className="sbs-choices">
        <div className="sbs-choice">
          {canFight ? fight : <Tooltip content={t('seaView.setup.helmNotReady')}>{fight}</Tooltip>}
          <span className="muted">{t('seaView.setup.fightHint')}</span>
        </div>
        <div className="sbs-choice">
          <Button variant={canFight ? 'secondary' : 'primary'} size="lg" icon="dice" onClick={auto} data-autofocus={canFight ? undefined : true} data-testid="sea-battle-auto">
            {t('seaView.setup.auto')}
          </Button>
          <span className="muted">{t('seaView.setup.autoHint')}</span>
        </div>
      </div>
      <Details state={state} player={player} enemy={enemy} pct={pct} penalty={penalty} />
    </Modal>
  );
}

function SeaBattleSetupScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  if (!pending || !state || pending.kind !== 'seaBattle') return null;
  // While the fight is on (mode 'seaBattle'), this decision stays pending until the result is applied:
  // the sea-battle scene owns the screen, so the card is not shown over it.
  const slot = state.subsims.seaBattle;
  if (state.meta.mode === 'seaBattle' && slot?.status === 'running') return null;
  return <SeaBattleSetupCard pending={pending} state={state} />;
}

export const screen: ScreenDescriptor = { id: 'seaBattleSetup', pending: 'seaBattle', component: SeaBattleSetupScreen, layout: 'modal', titleKey: 'seaView.setup.title' };
