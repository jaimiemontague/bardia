/**
 * Before the Sea Battle (pending 'seaBattle', design §15.2, §15.5), a full-screen scene by ARCHITECTURE §20.7:
 * the painting of our own deck as the enemy sails spread out ahead (`seabattle.scene.before`), and on the left
 * who we close with, the two fleets (a ship drawn in each side's colours, how many ships and men), the wind,
 * the odds as a word (from the module's own `seaWinProbability`, the numbers auto-resolve uses), and two big
 * choices: take the helm (the sea-battle scene, primary) or let the captains fight it (the module's
 * `startSeaBattle { mode: 'auto' }`, then the painted outcome: route 'seaBattleResult'). Hull points, gear, the
 * exact chance and the auto-resolve cost sit behind Details. Without this screen the decision would have no
 * answer on screen and time would stop for good (ARCHITECTURE §6).
 */
import { useMemo, type ReactElement } from 'react';
import type { GameState, PendingDecision, SeaBattleSetup, SeaSideSetup } from '@sim/core/state';
import { seaWinProbability } from '@sim/seabattle/autoresolve';
import { loadContent } from '../../app/content';
import { useGame, usePending } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import { useScreenRegistry } from '../../app/registryContext';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { SceneChoices, type SceneChoiceItem } from '../../render/scenes/index';
import { Disclosure } from '../../ui/index';
import { CardScene } from '../battle/cardScene';
import { compassPoint } from '../seaBattle/logic';
import { ShipGlyph } from '../seaBattle/ShipGlyph';
import { useMusicState } from '../../audio/hooks';
import './seaBattleSetup.css';

/** Odds band of a win probability (balance.autoresolve.outcomeBands; same cut-offs as the land battle). */
export function seaBand(p: number, bands: { decisive: number; likely: number; even: number; risky: number }): 'decisive' | 'likely' | 'even' | 'risky' | 'hopeless' {
  if (p >= bands.decisive) return 'decisive';
  if (p >= bands.likely) return 'likely';
  if (p >= bands.even) return 'even';
  if (p >= bands.risky) return 'risky';
  return 'hopeless';
}

const SHIP_ORDER = ['drakkar', 'galley', 'snekkja', 'karvi', 'knarr', 'riverboat'];

function crewOf(side: SeaSideSetup): number {
  return side.ships.reduce((a, s) => a + s.crew, 0);
}

/** The ship that stands for a fleet: its biggest. */
function flagType(side: SeaSideSetup): string {
  let best = side.ships[0]?.type ?? 'snekkja';
  for (const s of side.ships) if (SHIP_ORDER.indexOf(s.type) >= 0 && SHIP_ORDER.indexOf(s.type) < SHIP_ORDER.indexOf(best)) best = s.type;
  return best;
}

function Fleet({ side, own, title }: { side: SeaSideSetup; own: boolean; title: string }): ReactElement {
  const t = useT();
  return (
    <section className={`bc-side sbs-side ${own ? 'is-own' : 'is-foe'}`} data-testid={`sbs-side-${own ? 'player' : 'enemy'}`}>
      <span className="bc-side-banner sbs-banner">
        <ShipGlyph type={flagType(side)} side={own ? 'own' : 'foe'} flip={!own} size={64} title={title} />
      </span>
      <span className="bc-side-title">{title}</span>
      <span className="bc-side-who">{t('seaView.setup.shipCount', { ships: side.ships.length })}</span>
      <span className="bc-side-num">{t('seaView.setup.men', { men: formatNumber(crewOf(side)) })}</span>
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
    <Disclosure summary={t('seaView.setup.details')} className="bc-details sbs-details" data-testid="sea-battle-details">
      {pct !== null && <p>{t('seaView.setup.chance', { pct })}</p>}
      {penalty > 0 && <p className="muted">{t('seaView.setup.autoPenalty', { pct: Math.round(penalty * 100) })}</p>}
      {side(player, t('seaView.setup.yours'))}
      {side(enemy, t('seaView.setup.theirs'))}
    </Disclosure>
  );
}

/** The wind: a small rose (the arrow points downwind) and words. */
function Wind({ setup }: { setup: SeaBattleSetup }): ReactElement {
  const t = useT();
  const downwind = setup.wind.dir + 180;
  return (
    <p className="sbs-wind" data-testid="sea-battle-wind">
      <svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true">
        <circle r="18" fill="rgba(10,30,40,0.6)" stroke="#9fc4cc" strokeWidth="1" />
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
    </p>
  );
}

function SeaBattleSetupScene({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const registry = useScreenRegistry();
  const loaded = loadContent();
  useMusicState('battleSea');
  const seaBattleId = (pending.payload as { seaBattleId?: string }).seaBattleId;
  const slot = state.subsims.seaBattle;
  const setup: SeaBattleSetup | undefined = slot && slot.id === seaBattleId ? slot.setup : undefined;
  const odds = useMemo(() => {
    if (!setup || !loaded.ok) return null;
    const p = seaWinProbability({ balance: loaded.content.balance, tunables: loaded.content.tunables.seabattle }, setup).pAttacker;
    return setup.attacker.isPlayer ? p : 1 - p;
  }, [setup, loaded]);
  const canFight = registry.forMode('seaBattle') !== undefined;
  if (!setup || seaBattleId === undefined) {
    return <CardScene assetId="seabattle.scene.before" testId="sea-battle-setup" title={t('seaView.setup.title')} text={t('seaView.setup.missing')} />;
  }
  const player = setup.attacker.isPlayer ? setup.attacker : setup.defender;
  const enemy = setup.attacker.isPlayer ? setup.defender : setup.attacker;
  const pct = odds !== null ? Math.round(odds * 100) : null;
  const band = odds !== null && loaded.ok ? seaBand(odds, loaded.content.balance.autoresolve.outcomeBands) : null;
  const penalty = player.playerPenalty ?? 0;
  const auto = () => {
    const r = dispatch({ type: 'startSeaBattle', seaBattleId, mode: 'auto' } as never);
    if (r && !r.error) navigation.open('seaBattleResult', { seaBattleId });
  };
  const choices: SceneChoiceItem[] = [
    {
      id: 'fight',
      label: t('seaView.setup.fight'),
      line: canFight ? t('seaView.setup.fightHint') : t('seaView.setup.helmNotReady'),
      tone: canFight ? 'primary' : 'quiet',
      ...(canFight ? {} : { disabled: true }),
      testId: 'sea-battle-fight',
      onPick: () => dispatch({ type: 'startSeaBattle', seaBattleId, mode: 'fight' } as never),
    },
    { id: 'auto', label: t('seaView.setup.auto'), line: t('seaView.setup.autoHint'), tone: canFight ? 'safe' : 'primary', testId: 'sea-battle-auto', onPick: auto },
  ];
  return (
    <CardScene
      assetId="seabattle.scene.before"
      testId="sea-battle-setup"
      className="sbs-card"
      kicker={t('seabattle.setup.kicker')}
      title={t(setup.attacker.isPlayer ? 'seaView.setup.titleAttack' : 'seaView.setup.titleDefend', { faction: state.factions[enemy.factionId]?.name ?? '' })}
    >
      <div className="bc-face">
        <Fleet side={player} own title={t('seaView.setup.yours')} />
        <span className="bc-vs">{t('seaView.setup.vs')}</span>
        <Fleet side={enemy} own={false} title={t('seaView.setup.theirs')} />
      </div>
      <div className="sbs-line">
        <Wind setup={setup} />
        {band !== null && (
          <p className={`bc-odds band-${band}`} data-testid="sea-battle-odds" data-band={band}>
            <span className="bc-odds-word">{t('seaView.setup.oddsWord', { band })}</span>
          </p>
        )}
      </div>
      <SceneChoices inView={choices} more={[]} moreLabel="" backLabel="" label={t('seabattle.setup.choicesLabel')} />
      <Details state={state} player={player} enemy={enemy} pct={pct} penalty={penalty} />
    </CardScene>
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
  return <SeaBattleSetupScene key={pending.id} pending={pending} state={state} />;
}

export const screen: ScreenDescriptor = { id: 'seaBattleSetup', pending: 'seaBattle', component: SeaBattleSetupScreen, layout: 'fullscreen', titleKey: 'seaView.setup.title' };
