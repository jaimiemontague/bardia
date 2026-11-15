/**
 * The sea-battle HUD (§20: about half as much on screen, bigger): a slim top bar (time and pace, the
 * wind rose, withdraw, menu), one line per fleet with the balance of the fight between them, a slim
 * card per selected ship (name, hull, crew, what it is doing) with the attack style and two orders,
 * the last few happenings, and the cards that interrupt play: how to command, the pause menu,
 * withdraw, a captain duel, the captains' fast-forward and the summary. Everything reads the
 * SeaController; every button gives an engine input through it.
 */
import type { ReactElement, ReactNode } from 'react';
import { formatNumber, useT } from '../../i18n/index';
import { Button, Icon, Tooltip } from '../../ui/index';
import type { SeaController, SeaSpeed } from './controller';
import { ATTACK_STYLES, balanceWord, clock, compassPoint, doingKey, strengthShare, type SeaSummary } from './logic';
import { ShipGlyph } from './ShipGlyph';

// ---- top bar ---------------------------------------------------------------------------------

export function WindRose({ dir, str }: { dir: number; str: string }): ReactElement {
  const t = useT();
  // The arrow points downwind (the wind blows FROM `dir`).
  const down = dir + 180;
  return (
    <Tooltip content={t('seaView.wind.tip')}>
      <span className="sv-wind" data-testid="sea-wind" tabIndex={0}>
        <svg viewBox="-20 -20 40 40" width="38" height="38" aria-hidden="true">
          <circle r="18" fill="rgba(10,30,40,0.7)" stroke="#9fc4cc" strokeWidth="1" />
          <text y="-10.5" textAnchor="middle" fontSize="7" fill="#e8d9b0" fontFamily="Cinzel, serif">
            N
          </text>
          <g transform={`rotate(${down})`}>
            <path d="M0 -13 L0 11" stroke="#e8f4f6" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M0 14 L-5 6 L5 6 Z" fill="#e8f4f6" />
            <path d="M-4 -13 L0 -9 L4 -13" stroke="#e8f4f6" strokeWidth="1.6" fill="none" />
          </g>
        </svg>
        <span className="sv-wind-text">
          <strong>{t('seaView.wind.word', { str })}</strong>
          <span>{t('seaView.wind.from', { dir: compassPoint(dir) })}</span>
        </span>
      </span>
    </Tooltip>
  );
}

export function TopBar({ c, title, onMenu, onWithdraw }: { c: SeaController; title: string; onMenu(): void; onWithdraw(): void }): ReactElement {
  const t = useT();
  const snap = c.snap;
  const speed = (s: SeaSpeed) => (
    <button key={s} type="button" className={`sv-speed${!c.paused && c.speed === s ? ' is-on' : ''}`} aria-pressed={!c.paused && c.speed === s} onClick={() => c.setSpeed(s)} data-testid={`sea-speed-${s}`}>
      {t('seaView.speed', { n: s })}
    </button>
  );
  return (
    <header className="sv-top" data-testid="sea-topbar">
      <div className="sv-title">
        <span className="sv-title-main">{title}</span>
        <span className="sv-title-sub">{t(`seaView.sideIs.${c.side}`)}</span>
      </div>
      <div className="sv-time">
        <button type="button" className={`sv-play${c.paused ? ' is-paused' : ''}`} onClick={() => c.togglePause()} aria-pressed={c.paused} aria-label={t(c.paused ? 'seaView.resume' : 'seaView.pause')} data-testid="sea-pause">
          <Icon name={c.paused ? 'play' : 'pause'} />
        </button>
        {([1, 2, 4] as const).map(speed)}
        <span className="sv-clock num" data-testid="sea-clock">
          {clock(snap.timeS)}
        </span>
      </div>
      <div className="sv-top-right">
        <WindRose dir={snap.wind.dir} str={snap.wind.str} />
        <Button variant="danger" icon="ship" onClick={onWithdraw} disabled={snap.status === 'ended' || c.fastForward} data-testid="sea-withdraw-all">
          {t('seaView.withdrawAll')}
        </Button>
        <Button variant="secondary" icon="menu" onClick={onMenu} data-testid="sea-menu">
          {t('seaView.menu')}
        </Button>
      </div>
    </header>
  );
}

// ---- fleets ----------------------------------------------------------------------------------

export function FleetBar({ c }: { c: SeaController }): ReactElement {
  const t = useT();
  const side = (key: 'attacker' | 'defender') => {
    let ships = 0;
    let men = 0;
    for (const s of c.snap.ships) {
      if (s.side !== key || s.status !== 'active') continue;
      ships++;
      men += s.crew;
    }
    return { ships, men: Math.round(men) };
  };
  const own = side(c.side);
  const foe = side(c.enemySide);
  const share = strengthShare(c.snap, c.side);
  const word = balanceWord(share);
  return (
    <section className="sv-fleets" data-testid="sea-fleets" data-balance={word}>
      <div className="sv-fleet is-own" data-testid="sea-fleet-own">
        <span className="sv-fleet-name">{t('seaView.fleet.own')}</span>
        <span className="sv-fleet-line num">{t('seaView.fleet.line', { ships: own.ships, men: formatNumber(own.men) })}</span>
      </div>
      <div className="sv-balance" aria-label={t(`seaView.balance.${word}`)}>
        <div className="sv-balance-bar">
          <span className="is-own" style={{ width: `${Math.round(share * 100)}%` }} />
          <span className="is-foe" style={{ width: `${Math.round((1 - share) * 100)}%` }} />
        </div>
        <span className={`sv-balance-word word-${word}`} data-testid="sea-balance">
          {t(`seaView.balance.${word}`)}
        </span>
      </div>
      <div className="sv-fleet is-foe" data-testid="sea-fleet-enemy">
        <span className="sv-fleet-name">{t('seaView.fleet.enemy')}</span>
        <span className="sv-fleet-line num">{t('seaView.fleet.line', { ships: foe.ships, men: formatNumber(foe.men) })}</span>
      </div>
    </section>
  );
}

// ---- selected ships --------------------------------------------------------------------------

function HullBar({ pct }: { pct: number }): ReactElement {
  const v = Math.max(0, Math.min(1, pct));
  return (
    <span className={`sv-hullbar tone-${v < 0.35 ? 'bad' : v < 0.65 ? 'warn' : 'good'}`}>
      <span style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}

export function ShipCards({ c, onFocus }: { c: SeaController; onFocus(x: number, y: number): void }): ReactElement | null {
  const t = useT();
  const sel = c.selectedShips();
  if (sel.length === 0 || c.fastForward || c.snap.status === 'ended') return null;
  const roster = c.roster();
  const shown = sel.slice(0, 4);
  const anyRam = sel.some((s) => c.canRam(s));
  const styles = ATTACK_STYLES.filter((st) => st !== 'ram' || anyRam);
  return (
    <section className="sv-cards" data-testid="sea-ship-cards">
      <div className="sv-card-row">
        {shown.map((s) => {
          const grappled = s.grappledTo >= 0;
          const target = c.ship(s.orderTarget);
          const doing = t(doingKey(s, grappled));
          return (
            <button key={s.idx} type="button" className="sv-card" onClick={() => onFocus(s.x, s.y)} data-testid={`sea-ship-card-${s.idx}`}>
              <span className="sv-card-key">{roster.findIndex((r) => r.idx === s.idx) + 1}</span>
              <span className="sv-card-name">{s.name}</span>
              <span className="sv-card-type muted">
                {c.typeName(s.type)}
                {s.isPlayer ? ` · ${t('seaView.card.flagship')}` : ''}
              </span>
              <span className="sv-card-crew num">{t('seaView.card.crew', { crew: formatNumber(Math.round(s.crew)) })}</span>
              <HullBar pct={s.hullPct} />
              <span className="sv-card-doing" data-testid="sea-ship-doing">
                {doing}
                {target && (s.goal === 'board' || s.goal === 'range' || s.goal === 'ram') ? `: ${target.name}` : ''}
              </span>
            </button>
          );
        })}
        {sel.length > shown.length && <span className="sv-card-more">{t('seaView.card.more', { n: sel.length - shown.length })}</span>}
      </div>
      <div className="sv-orders" role="group" aria-label={t('seaView.style.label')}>
        <span className="sv-orders-label">{t('seaView.style.label')}</span>
        {styles.map((st) => (
          <Tooltip key={st} content={t(`seaView.styleTip.${st}`)}>
            <button type="button" className={`sv-chip${sel.every((s) => c.styleOf(s.idx) === st) ? ' is-on' : ''}`} onClick={() => c.setStyle(st)} data-testid={`sea-style-${st}`}>
              {t(`seaView.style.${st}`)}
            </button>
          </Tooltip>
        ))}
        <span className="sv-orders-gap" />
        <Tooltip content={t('seaView.holdTip')}>
          <button type="button" className="sv-chip" onClick={() => c.holdSelected()} data-testid="sea-hold">
            {t('seaView.hold')}
          </button>
        </Tooltip>
        <Tooltip content={t('seaView.withdrawTip')}>
          <button type="button" className="sv-chip is-danger" onClick={() => c.withdrawSelected()} data-testid="sea-withdraw">
            {t('seaView.withdraw')}
          </button>
        </Tooltip>
      </div>
    </section>
  );
}

// ---- happenings ------------------------------------------------------------------------------

export function Ticker({ c, onFocus }: { c: SeaController; onFocus(x: number, y: number): void }): ReactElement {
  const t = useT();
  const recent = c.log.filter((l) => c.realTime - l.at < 9).slice(-3);
  return (
    <section className="sv-ticker" data-testid="sea-log" aria-live="polite" aria-label={t('seaView.log.label')}>
      <ol>
        {recent.map((l) => {
          const s = l.ship !== undefined ? c.ship(l.ship) : undefined;
          return (
            <li key={l.id} className={`tone-${l.tone}`} style={{ opacity: Math.max(0.25, 1 - Math.max(0, c.realTime - l.at - 6) / 3) }}>
              <button type="button" onClick={() => s && onFocus(s.x, s.y)}>
                {l.text}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---- cards -----------------------------------------------------------------------------------

export function HowTo({ onPlan, onStart }: { onPlan(): void; onStart(): void }): ReactElement {
  const t = useT();
  const rows = ['select', 'order', 'style', 'pause', 'camera'];
  return (
    <div className="sv-modal" role="dialog" aria-modal="true" aria-labelledby="sv-howto-title" data-testid="sea-howto">
      <div className="sv-modal-card">
        <h2 id="sv-howto-title">{t('seaView.howto.title')}</h2>
        <p className="sv-lead">{t('seaView.howto.intro')}</p>
        <dl className="sv-howto">
          {rows.map((r) => (
            <div key={r}>
              <dt>{t(`seaView.howto.${r}Key`)}</dt>
              <dd>{t(`seaView.howto.${r}`)}</dd>
            </div>
          ))}
        </dl>
        <div className="sv-modal-actions">
          <Button variant="secondary" onClick={onPlan} data-testid="sea-howto-plan">
            {t('seaView.howto.plan')}
          </Button>
          <Button variant="primary" icon="ship" onClick={onStart} data-autofocus data-testid="sea-howto-start">
            {t('seaView.howto.start')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onCaptains, onWithdraw, onHelp, leave }: { onResume(): void; onCaptains(): void; onWithdraw(): void; onHelp(): void; leave: { labelKey: string; onClick(): void } }): ReactElement {
  const t = useT();
  return (
    <div className="sv-modal" role="dialog" aria-modal="true" aria-labelledby="sv-menu-title" data-testid="sea-pause-menu">
      <div className="sv-modal-card sv-menu">
        <h2 id="sv-menu-title">{t('seaView.menuCard.title')}</h2>
        <Button variant="primary" icon="play" block onClick={onResume} data-autofocus data-testid="sea-resume">
          {t('seaView.menuCard.resume')}
        </Button>
        <Tooltip content={t('seaView.menuCard.captainsTip')} block>
          <Button variant="secondary" icon="faster" block onClick={onCaptains} data-testid="sea-captains">
            {t('seaView.menuCard.captains')}
          </Button>
        </Tooltip>
        <Button variant="danger" icon="ship" block onClick={onWithdraw} data-testid="sea-menu-withdraw">
          {t('seaView.menuCard.withdraw')}
        </Button>
        <div className="sv-menu-small">
          <Button variant="ghost" icon="info" onClick={onHelp} data-testid="sea-menu-help">
            {t('seaView.menuCard.help')}
          </Button>
          <Button variant="ghost" icon="arrowLeft" onClick={leave.onClick} data-testid="sea-leave">
            {t(leave.labelKey)}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmWithdraw({ onYes, onNo }: { onYes(): void; onNo(): void }): ReactElement {
  const t = useT();
  return (
    <div className="sv-modal" role="dialog" aria-modal="true" data-testid="sea-confirm-withdraw">
      <div className="sv-modal-card sv-menu">
        <h2>{t('seaView.confirm.title')}</h2>
        <p className="sv-lead">{t('seaView.confirm.body')}</p>
        <div className="sv-modal-actions">
          <Button variant="secondary" onClick={onNo} data-autofocus data-testid="sea-withdraw-no">
            {t('seaView.confirm.no')}
          </Button>
          <Button variant="danger" icon="ship" onClick={onYes} data-testid="sea-withdraw-yes">
            {t('seaView.confirm.yes')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DuelCard({ c, captainName }: { c: SeaController; captainName(id: string): string | undefined }): ReactElement | null {
  const t = useT();
  const d = c.snap.duel;
  if (!d || c.fastForward) return null;
  const name = captainName(d.enemyCaptainId) ?? t('seaView.duel.theirCaptain');
  return (
    <div className="sv-modal" role="dialog" aria-modal="true" data-testid="sea-duel">
      <div className="sv-modal-card sv-menu">
        <h2>{t('seaView.duel.title')}</h2>
        <p className="sv-lead">{t(d.playerWonDeck ? 'seabattle.duel.prompt.won' : 'seabattle.duel.prompt.lastStand', { ship: c.shipName(d.enemyShip), name })}</p>
        <div className="sv-modal-actions">
          <Button variant="secondary" onClick={() => c.declineDuel()} data-testid="sea-duel-decline">
            {t('seabattle.duel.decline')}
          </Button>
          <Button variant="primary" icon="sword" onClick={() => c.fightDuel()} data-autofocus data-testid="sea-duel-fight">
            {t('seabattle.duel.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FastForward(): ReactElement {
  const t = useT();
  return (
    <div className="sv-ff" data-testid="sea-fastforward">
      <Icon name="faster" /> {t('seaView.captainsRunning')}
    </div>
  );
}

function plunderText(s: SeaSummary, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (s.plunderSilver > 0) parts.push(t('seaView.sum.plunderSilver', { silver: formatNumber(s.plunderSilver) }));
  const tons = s.plunderGoods.reduce((a, g) => a + g.tons, 0);
  if (tons > 0) parts.push(t('seaView.sum.plunderGoods', { tons: formatNumber(tons, { maximumFractionDigits: 1 }) }));
  return parts.length > 0 ? parts.join(', ') : t('seaView.sum.plunderNone');
}

export function Summary({ summary, children, error }: { summary: SeaSummary; children: ReactNode; error?: string | null }): ReactElement {
  const t = useT();
  const stat = (label: string, value: ReactNode, sub?: ReactNode, id?: string) => (
    <div className="sv-sum-stat" data-testid={id}>
      <span className="sv-sum-value num">{value}</span>
      <span className="sv-sum-label">{label}</span>
      {sub !== undefined && <span className="sv-sum-sub muted">{sub}</span>}
    </div>
  );
  const fleet = (title: string, fates: SeaSummary['own']['fates'], side: 'own' | 'foe') => (
    <div className={`sv-sum-fleet is-${side}`}>
      <h3>{title}</h3>
      <ul>
        {fates.map((f) => (
          <li key={f.shipId} className={`fate-${f.fate}`}>
            <ShipGlyph type={f.type} side={side} flip={side === 'foe'} fate={f.fate} size={72} />
            <span className="sv-sum-ship">{f.name}</span>
            <span className="sv-sum-fate">{t(`seaView.sum.fate.${f.fate}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="sv-modal sv-summary-wrap" role="dialog" aria-modal="true" aria-labelledby="sv-sum-title" data-testid="sea-summary">
      <div className={`sv-modal-card sv-summary outcome-${summary.outcome}`}>
        <h2 id="sv-sum-title" data-testid="sea-outcome" data-outcome={summary.outcome}>
          {t(`seaView.outcome.${summary.outcome}`)}
        </h2>
        <p className="sv-lead">
          {t(`seaView.sum.line.${summary.outcome}`)} {t('seaView.sum.duration', { time: clock(summary.durationS) })}
        </p>
        <div className="sv-sum-stats">
          {stat(t('seaView.sum.sunk'), summary.enemySunk, undefined, 'sea-sum-sunk')}
          {stat(t('seaView.sum.taken'), summary.enemyTaken, undefined, 'sea-sum-taken')}
          {stat(t('seaView.sum.lost'), summary.ownLost, undefined, 'sea-sum-lost')}
          {stat(t('seaView.sum.menLost'), formatNumber(summary.own.killed + summary.own.captured), t('seaView.sum.theirMen', { n: formatNumber(summary.enemy.killed + summary.enemy.captured) }), 'sea-sum-men')}
        </div>
        <p className="sv-sum-plunder" data-testid="sea-sum-plunder">
          <strong>{t('seaView.sum.plunder')}:</strong> {plunderText(summary, t)}
        </p>
        <div className="sv-sum-fleets">
          {fleet(t('seaView.sum.yours'), summary.own.fates, 'own')}
          {fleet(t('seaView.sum.theirs'), summary.enemy.fates, 'foe')}
        </div>
        {error && (
          <p className="sv-error" role="alert" data-testid="sea-return-error">
            {error}
          </p>
        )}
        <div className="sv-modal-actions">{children}</div>
      </div>
    </div>
  );
}
