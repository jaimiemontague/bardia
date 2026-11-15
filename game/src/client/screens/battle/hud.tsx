/**
 * The battle HUD (design §25 battle screen, §13.5): the top bar (time, speed, raid timer, wind, the
 * general retreat, the pause menu), objectives, the roster of the player's squads, the squad panel
 * (men, morale with its reasons, fatigue, formation, stance, abilities, orders), the battle log, and the
 * cards that interrupt play: how to command, the pause menu, a duel, the captains' fast-forward and the
 * after-battle summary. Everything reads the BattleController; every button gives an engine order
 * through it.
 */
import type { ReactElement, ReactNode } from 'react';
import { ABILITY_IDS, type AbilityId } from '@sim/battle/data';
import type { SquadView } from '@sim/battle/index';
import type { SquadStance } from '@sim/battle/types';
import type { FormationId } from '@sim/core/state';
import { formatNumber, useT } from '../../i18n/index';
import { Button, Icon, KeyHint, Tooltip } from '../../ui/index';
import type { BattleController, SpeedSetting } from './controller';
import type { BattleSummary } from './summary';

/** Key hint of each ability button: a rebindable action, or a fixed key (Space charges and looses). */
const ABILITY_KEYS: Readonly<Partial<Record<AbilityId, { action: string } | { combo: string }>>> = {
  shieldWall: { action: 'battle.shieldWall' },
  charge: { combo: 'Space' },
  volley: { combo: 'Space' },
  torch: { action: 'battle.torchVolley' },
  rally: { action: 'battle.rally' },
  challenge: { action: 'battle.challenge' },
};
const STANCES: readonly SquadStance[] = ['engage', 'hold', 'skirmish'];

/** m:ss */
export function clock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

// ---- top bar ---------------------------------------------------------------------------------

export function TopBar({ c, title, onMenu, onRetreatAll }: { c: BattleController; title: string; onMenu(): void; onRetreatAll(): void }): ReactElement {
  const t = useT();
  const snap = c.snap;
  const speedButton = (s: SpeedSetting) => (
    <button key={s} type="button" className={`bv-speed${!c.paused && c.speed === s ? ' is-on' : ''}`} aria-pressed={!c.paused && c.speed === s} onClick={() => c.setSpeed(s)} data-testid={`battle-speed-${s}`}>
      {t('battleView.speed', { n: s })}
    </button>
  );
  // The bearing the wind comes from; the arrow points downwind (CSS rotation is clockwise from +x).
  const windDeg = snap.wind.dir + 90;
  return (
    <header className="bv-top" data-testid="battle-topbar">
      <div className="bv-title">
        <span className="bv-title-main">{title}</span>
        <span className="bv-title-sub">{t(`battleView.sideIs.${c.side}`)}</span>
      </div>
      <div className="bv-time">
        <button type="button" className={`bv-play${c.paused ? ' is-paused' : ''}`} onClick={() => c.togglePause()} aria-pressed={c.paused} aria-label={t(c.paused ? 'battleView.resume' : 'battleView.pause')} data-testid="battle-pause">
          <Icon name={c.paused ? 'play' : 'pause'} />
        </button>
        {([1, 2, 4] as const).map(speedButton)}
        <span className="bv-clock num" data-testid="battle-clock">
          {clock(snap.timeS)}
        </span>
        {snap.timeLeftS !== null && (
          <Tooltip content={t('battleView.raidTimerTip')}>
            <span className={`bv-timer num${snap.timeLeftS < 45 ? ' is-urgent' : ''}`} data-testid="battle-timer">
              <Icon name="hourglass" /> {t('battleView.raidTimer', { time: clock(snap.timeLeftS) })}
            </span>
          </Tooltip>
        )}
      </div>
      <div className="bv-top-right">
        <Tooltip content={t('battleView.windTip', { str: Math.round(snap.wind.str * 100) })}>
          <span className="bv-wind" aria-label={t('battleView.wind')}>
            <Icon name="wind" />
            <span className="bv-wind-arrow" style={{ transform: `rotate(${windDeg}deg)` }}>
              ➜
            </span>
          </span>
        </Tooltip>
        <Button variant="danger" size="sm" icon="ship" onClick={onRetreatAll} disabled={snap.status === 'ended'} data-testid="battle-retreat-all">
          {t(c.side === 'attacker' ? 'battle.ability.retreat' : 'battleView.withdraw')}
        </Button>
        <Button variant="secondary" size="sm" icon="menu" onClick={onMenu} data-testid="battle-menu">
          {t('battleView.menu')}
        </Button>
      </div>
    </header>
  );
}

// ---- objectives ------------------------------------------------------------------------------

export function Objectives({ c }: { c: BattleController }): ReactElement {
  const t = useT();
  const snap = c.snap;
  const kind = snap.kind;
  const carried = c.ownSquads().reduce((a, s) => a + s.loot, 0);
  const left = snap.buildings.reduce((a, b) => a + b.loot, 0) + snap.caches.filter((x) => x.dropped).reduce((a, x) => a + x.value, 0);
  const ownMen = c.ownSquads().reduce((a, s) => a + (s.status === 'routing' ? 0 : s.men), 0);
  const enemySeen = snap.squads.filter((s) => s.side !== c.side);
  const enemyMen = enemySeen.reduce((a, s) => a + (s.status === 'routing' ? 0 : s.men), 0);
  return (
    <section className="bv-card bv-objectives" data-testid="battle-objectives">
      <h3>{t('battleView.objectives')}</h3>
      <p>{t(`battleView.goal.${c.side}`, { kind })}</p>
      <dl className="bv-facts">
        <div>
          <dt>{t('battleView.fact.yourMen')}</dt>
          <dd className="num">{formatNumber(ownMen)}</dd>
        </div>
        <div>
          <dt>{t('battleView.fact.enemySeen')}</dt>
          <dd className="num">{formatNumber(enemyMen)}</dd>
        </div>
        {(kind === 'raid' || kind === 'cloister' || left > 0) && c.side === 'attacker' && (
          <>
            <div>
              <dt>{t('battleView.fact.lootCarried')}</dt>
              <dd className="num">{formatNumber(carried)}</dd>
            </div>
            <div>
              <dt>{t('battleView.fact.lootSecured')}</dt>
              <dd className="num" data-testid="battle-loot-secured">
                {formatNumber(snap.lootSecured)}
              </dd>
            </div>
            <div>
              <dt>{t('battleView.fact.lootLeft')}</dt>
              <dd className="num">{formatNumber(left)}</dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

// ---- roster ----------------------------------------------------------------------------------

function moraleTone(m: number, c: BattleController): string {
  const b = c.content.balance.battle;
  return m < b.routAt ? 'bad' : m < b.waverAt ? 'warn' : 'good';
}

export function Roster({ c, onFocus }: { c: BattleController; onFocus(x: number, y: number): void }): ReactElement {
  const t = useT();
  const ids = c.rosterIds();
  return (
    <nav className="bv-roster" aria-label={t('battleView.roster')} data-testid="battle-roster">
      {ids.map((id, i) => {
        const s = c.squad(id);
        const gone = !s;
        const sel = c.selected.includes(id);
        const status = s ? s.status : c.squadStatus(id);
        return (
          <button
            key={id}
            type="button"
            className={`bv-squad-card${sel ? ' is-selected' : ''}${gone ? ' is-gone' : ''}${s?.status === 'routing' ? ' is-routing' : ''}${s?.wavering ? ' is-wavering' : ''}`}
            onClick={(e) => (s ? c.select([id], e.shiftKey) : undefined)}
            onDoubleClick={() => s && onFocus(s.x, s.y)}
            disabled={gone}
            data-testid={`battle-squad-card-${id}`}
          >
            <span className="bv-sc-key">{i + 1}</span>
            <span className="bv-sc-name">{c.squadName(id)}</span>
            <span className="bv-sc-unit">{s ? c.unitName(s.unit) : t(`battleView.status.${status}`)}</span>
            {s && (
              <>
                <span className="bv-sc-men num">
                  {s.men}
                  <span className="muted">/{s.startMen}</span>
                </span>
                <span className={`bv-sc-bar tone-${moraleTone(s.morale, c)}`}>
                  <span style={{ width: `${Math.max(0, Math.min(100, s.morale))}%` }} />
                </span>
                {s.status !== 'active' && <span className="bv-sc-status">{t(`battleView.status.${s.status}`)}</span>}
                {s.status === 'active' && s.wavering && <span className="bv-sc-status">{t('battleView.wavering')}</span>}
              </>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ---- morale explanation ----------------------------------------------------------------------

export function MoraleExplain({ c, s }: { c: BattleController; s: SquadView }): ReactElement {
  const t = useT();
  const b = c.content.balance.battle;
  const recent = c.morale.breakdown(s.id);
  const why = c.morale.whyBroke(s.id);
  const state = s.status === 'routing' ? 'routing' : s.wavering ? 'wavering' : 'steady';
  return (
    <div className="bv-morale-tip" data-testid="battle-morale-tip">
      <strong>{t('battleView.morale.title', { m: Math.round(s.morale), start: Math.round(s.moraleStart) })}</strong>
      <p>{t(`battleView.morale.state.${state}`, { pct: Math.round(b.moraleMult.wavering * 100) })}</p>
      <ul>
        <li>{t('battleView.morale.rule.waver', { at: b.waverAt, pct: Math.round(b.moraleMult.wavering * 100) })}</li>
        <li>{t('battleView.morale.rule.rout', { at: b.routAt })}</li>
        <li>{t('battleView.morale.rule.rally', { at: b.rallyAt })}</li>
        <li>{t('battleView.morale.rule.causes', { losses: Math.abs(b.morale.lossesMult), fire: Math.abs(b.morale.fireNearbyPerS), flank: Math.abs(b.morale.firstFlanked), leader: Math.abs(b.morale.leaderKilled), friends: Math.abs(b.morale.adjacentRout) })}</li>
      </ul>
      {why && why.length > 0 && (
        <p className="bv-why" data-testid="battle-why-broke">
          {t('battleView.morale.broke', { reasons: why.slice(0, 3).map((r) => t(`battleView.cause.${r.cause}`)).join(', ') })}
        </p>
      )}
      {recent.length > 0 && (
        <>
          <p className="muted">{t('battleView.morale.recent')}</p>
          <ul className="bv-causes">
            {recent.slice(0, 5).map((r) => (
              <li key={r.cause} className={r.delta < 0 ? 'neg' : 'pos'}>
                <span>{t(`battleView.cause.${r.cause}`)}</span>
                <span className="num">{r.delta > 0 ? `+${Math.round(r.delta)}` : Math.round(r.delta)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---- squad panel -----------------------------------------------------------------------------

function orderText(c: BattleController, s: SquadView, t: ReturnType<typeof useT>): string {
  const plan = c.planned[s.id];
  const kind = plan?.kind ?? s.task;
  const target = plan?.target ?? s.taskTarget ?? '';
  const name = /^[ad]\d+$/.test(target) ? c.squadName(target) : target ? c.structureName(target) : '';
  if (s.status === 'routing') return t('battleView.order.routing');
  if (s.activity === 'fighting' && kind !== 'retreat') return t('battleView.order.fighting', { target: name, hasTarget: name !== '' ? 'yes' : 'no' });
  if (kind === 'none' && s.held) return t('battleView.order.held');
  return t(`battleView.order.${kind}`, { target: name, planned: plan ? 'yes' : 'no' });
}

function Stat({ label, children, tip }: { label: string; children: ReactNode; tip?: ReactNode }): ReactElement {
  const body = (
    <div className="bv-stat">
      <span className="bv-stat-label">{label}</span>
      <span className="bv-stat-value">{children}</span>
    </div>
  );
  return tip ? (
    <Tooltip content={tip} block placement="top">
      <span tabIndex={0} className="bv-stat-anchor">
        {body}
      </span>
    </Tooltip>
  ) : (
    body
  );
}

function Bar({ value, tone }: { value: number; tone: string }): ReactElement {
  return (
    <span className={`bv-bar tone-${tone}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function SquadDetails({ c, s, own }: { c: BattleController; s: SquadView; own: boolean }): ReactElement {
  const t = useT();
  const b = c.content.balance.battle;
  return (
    <div className="bv-details">
      <header className="bv-panel-head">
        <span className={`bv-swatch ${own ? 'is-own' : 'is-foe'}`} />
        <div>
          <h3 data-testid="battle-panel-name">{c.squadName(s.id)}</h3>
          <p className="muted">
            {c.unitName(s.unit)}
            {s.leaderName && !s.unnamed ? ` · ${t(s.isPlayer ? 'battleView.ledByYou' : s.isChief ? 'battleView.chief' : 'battleView.ledBy', { name: s.leaderName })}` : ''}
            {s.vetStars > 0 ? ` · ${'★'.repeat(s.vetStars)}` : ''}
          </p>
        </div>
      </header>
      <div className="bv-stats">
        <Stat label={t('battleView.stat.men')} tip={t('battleView.tip.men', { lost: s.lost, wounded: s.wounded })}>
          <span className="num" data-testid="battle-panel-men">
            {s.men}/{s.startMen}
          </span>
        </Stat>
        <Stat label={t('battleView.stat.morale')} tip={<MoraleExplain c={c} s={s} />}>
          <Bar value={s.morale} tone={moraleTone(s.morale, c)} />
          <span className="num">{Math.round(s.morale)}</span>
        </Stat>
        <Stat label={t('battleView.stat.stamina')} tip={t('battleView.tip.stamina', { low: b.fatigue.lowAt, pct: Math.round(b.fatigue.lowMult * 100) })}>
          <Bar value={s.stamina} tone={s.stamina < b.fatigue.lowAt ? 'warn' : 'info'} />
          <span className="num">{Math.round(s.stamina)}</span>
        </Stat>
        <Stat label={t('battleView.stat.order')}>
          <span data-testid="battle-panel-order">{orderText(c, s, t)}</span>
        </Stat>
        {s.carryCap > 0 && (s.loot > 0 || c.side === 'attacker') && own && (
          <Stat label={t('battleView.stat.loot')} tip={t('battleView.tip.loot')}>
            <span className="num">
              {s.loot}/{s.carryCap}
            </span>
          </Stat>
        )}
        {s.playerHp !== null && (
          <Stat label={t('battleView.stat.health')} tip={t('battleView.tip.health')}>
            <Bar value={s.playerHp} tone={s.playerHp < 30 ? 'bad' : 'good'} />
            <span className="num">{s.playerHp}</span>
          </Stat>
        )}
      </div>
    </div>
  );
}

export function SquadPanel({ c }: { c: BattleController }): ReactElement | null {
  const t = useT();
  const sel = c.selectedSquads();
  const inspected = c.squad(c.inspected);
  if (sel.length === 0 && !inspected) {
    return (
      <section className="bv-card bv-panel is-empty" data-testid="battle-squad-panel">
        <p className="muted">{t('battleView.panel.none')}</p>
      </section>
    );
  }
  if (sel.length === 0 && inspected) {
    return (
      <section className="bv-card bv-panel" data-testid="battle-squad-panel">
        <SquadDetails c={c} s={inspected} own={false} />
      </section>
    );
  }
  const first = sel[0]!;
  const formations: FormationId[] = [];
  for (const s of sel) for (const f of s.formations) if (!formations.includes(f)) formations.push(f);
  // Dousing only matters to the side whose buildings burn (the defenders).
  const abilities = ABILITY_IDS.filter((a) => (a !== 'douse' || c.side === 'defender') && sel.some((s) => s.abilities.includes(a)));
  return (
    <section className="bv-card bv-panel" data-testid="battle-squad-panel">
      {sel.length === 1 ? (
        <SquadDetails c={c} s={first} own />
      ) : (
        <header className="bv-panel-head">
          <span className="bv-swatch is-own" />
          <div>
            <h3 data-testid="battle-panel-name">{t('battleView.panel.many', { n: sel.length })}</h3>
            <p className="muted">{t('battleView.panel.manyMen', { men: sel.reduce((a, s) => a + s.men, 0) })}</p>
          </div>
        </header>
      )}
      <div className="bv-row" role="group" aria-label={t('battleView.formation')}>
        <span className="bv-row-label">{t('battleView.formation')}</span>
        {formations.map((f) => (
          <Tooltip key={f} content={t(`battleView.formationTip.${f}`)}>
            <button type="button" className={`bv-chip${sel.every((s) => s.formation === f) ? ' is-on' : ''}`} onClick={() => c.setFormation(f)} data-testid={`battle-formation-${f}`}>
              {t(`battle.formation.${f}`)}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="bv-row" role="group" aria-label={t('battleView.stance')}>
        <span className="bv-row-label">{t('battleView.stance')}</span>
        {STANCES.map((st) => (
          <Tooltip key={st} content={t(`battleView.stanceTip.${st}`)}>
            <button type="button" className={`bv-chip${sel.every((s) => s.stance === st) ? ' is-on' : ''}`} onClick={() => c.setStance(st)} data-testid={`battle-stance-${st}`}>
              {t(`battle.stance.${st}`)}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="bv-row bv-abilities" role="group" aria-label={t('battleView.abilities')}>
        {abilities.map((a) => {
          const r = c.abilityReady(a);
          const key = ABILITY_KEYS[a];
          return (
            <Tooltip key={a} content={t(`battleView.abilityTip.${a}`)}>
              <button type="button" className={`bv-ability${c.targeting === a ? ' is-on' : ''}${r.ready ? '' : ' is-cooling'}`} onClick={() => c.useAbility(a)} data-testid={`battle-ability-${a}`}>
                <span>{t(`battle.ability.${a}`)}</span>
                {!r.ready && <span className="bv-cd num">{Math.ceil(r.cooldown)}</span>}
                {key && ('action' in key ? <KeyHint action={key.action} /> : <KeyHint combo={key.combo} />)}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="bv-row">
        <Button size="sm" variant="ghost" onClick={() => c.halt()} data-testid="battle-halt">
          {t('battleView.halt')}
        </Button>
        <Button size="sm" variant="ghost" icon="ship" onClick={() => c.retreatSelected()} data-testid="battle-retreat-squad">
          {t('battleView.retreatSquad')}
        </Button>
      </div>
      {c.targeting !== null && (
        <p className="bv-targeting" data-testid="battle-targeting">
          {t(`battleView.target.${c.targeting}`)}
        </p>
      )}
    </section>
  );
}

// ---- log -------------------------------------------------------------------------------------

export function BattleLog({ c, onFocus }: { c: BattleController; onFocus(x: number, y: number): void }): ReactElement {
  const t = useT();
  const recent = c.log.slice(-8).reverse();
  return (
    <section className="bv-card bv-log" data-testid="battle-log" aria-live="polite">
      <h3>{t('battleView.log')}</h3>
      <ol>
        {recent.map((e) => (
          <li key={e.id} className={`tone-${e.tone}`}>
            <button type="button" onClick={() => e.x !== undefined && e.y !== undefined && onFocus(e.x, e.y)}>
              <span className="bv-log-time num">{clock(e.timeS)}</span> {e.text}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- cards -----------------------------------------------------------------------------------

/** The "how to command" card: the keys first, in a few plain lines (§20). */
export function HowTo({ onPlan, onStart }: { onPlan(): void; onStart(): void }): ReactElement {
  const t = useT();
  const rows: [string, string][] = [
    ['battleView.howto.moveKey', 'battleView.howto.move'],
    ['battleView.howto.attackKey', 'battleView.howto.attack'],
    ['battleView.howto.pickKey', 'battleView.howto.pick'],
    ['battleView.howto.abilityKey', 'battleView.howto.ability'],
    ['battleView.howto.mouseKey', 'battleView.howto.mouse'],
  ];
  return (
    <div className="bv-modal" role="dialog" aria-modal="true" aria-labelledby="bv-howto-title" data-testid="battle-howto">
      <div className="bv-modal-card">
        <h2 id="bv-howto-title">{t('battleView.howto.title')}</h2>
        <p>{t('battleView.howto.intro')}</p>
        <dl className="bv-howto">
          {rows.map(([k, v]) => (
            <div key={v}>
              <dt>{t(k)}</dt>
              <dd>{t(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{t('battleView.howto.morale')}</p>
        <div className="bv-modal-actions">
          <Button variant="secondary" onClick={onPlan} data-testid="battle-howto-plan">
            {t('battleView.howto.plan')}
          </Button>
          <Button variant="primary" icon="sword" onClick={onStart} data-autofocus data-testid="battle-howto-start">
            {t('battleView.howto.start')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onCaptains, onRetreat, onHelp, leave }: { onResume(): void; onCaptains(): void; onRetreat(): void; onHelp(): void; leave: { labelKey: string; onClick(): void } }): ReactElement {
  const t = useT();
  return (
    <div className="bv-modal" role="dialog" aria-modal="true" aria-labelledby="bv-menu-title" data-testid="battle-pause-menu">
      <div className="bv-modal-card bv-menu">
        <h2 id="bv-menu-title">{t('battleView.pausedTitle')}</h2>
        <Button variant="primary" icon="play" block onClick={onResume} data-autofocus data-testid="battle-resume">
          {t('battleView.resume')}
        </Button>
        <Tooltip content={t('battleView.captainsTip')} block>
          <Button variant="secondary" icon="faster" block onClick={onCaptains} data-testid="battle-captains">
            {t('battleView.captains')}
          </Button>
        </Tooltip>
        <Button variant="danger" icon="ship" block onClick={onRetreat} data-testid="battle-menu-retreat">
          {t('battle.ability.retreat')}
        </Button>
        <Button variant="ghost" icon="info" block onClick={onHelp} data-testid="battle-menu-help">
          {t('battleView.howto.title')}
        </Button>
        <Button variant="ghost" icon="arrowLeft" block onClick={leave.onClick} data-testid="battle-leave">
          {t(leave.labelKey)}
        </Button>
      </div>
    </div>
  );
}

export function ConfirmRetreat({ c, onYes, onNo }: { c: BattleController; onYes(): void; onNo(): void }): ReactElement {
  const t = useT();
  return (
    <div className="bv-modal" role="dialog" aria-modal="true" data-testid="battle-confirm-retreat">
      <div className="bv-modal-card bv-menu">
        <h2>{t(c.side === 'attacker' ? 'battle.ability.retreat' : 'battleView.withdraw')}</h2>
        <p>{t(`battleView.retreatConfirm.${c.side}`)}</p>
        <div className="bv-modal-actions">
          <Button variant="secondary" onClick={onNo} data-autofocus data-testid="battle-retreat-no">
            {t('battleView.keepFighting')}
          </Button>
          <Button variant="danger" icon="ship" onClick={onYes} data-testid="battle-retreat-yes">
            {t('battleView.soundRetreat')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DuelCard({ c }: { c: BattleController }): ReactElement | null {
  const t = useT();
  const d = c.snap.duel;
  if (!d) return null;
  return (
    <div className="bv-modal" role="dialog" aria-modal="true" data-testid="battle-duel">
      <div className="bv-modal-card bv-menu">
        <h2>{t('battleView.duel.title')}</h2>
        <p>{t('battleView.duel.body', { challenger: c.squadName(d.challengerSquad), chief: c.squadName(d.chiefSquad) })}</p>
        <Button variant="primary" icon="sword" onClick={() => c.settleDuel()} data-autofocus data-testid="battle-duel-fight">
          {t('battleView.duel.fight')}
        </Button>
      </div>
    </div>
  );
}

export function FastForward(): ReactElement {
  const t = useT();
  return (
    <div className="bv-ff" data-testid="battle-fastforward">
      <Icon name="faster" /> {t('battleView.captainsRunning')}
    </div>
  );
}

export function Summary({
  c,
  summary,
  reasonKey,
  children,
  error,
}: {
  c: BattleController;
  summary: BattleSummary;
  reasonKey: string | null;
  children: ReactNode;
  error?: string | null;
}): ReactElement {
  const t = useT();
  const rows: [string, keyof BattleSummary['own']][] = [
    ['battleView.sum.men', 'men'],
    ['battleView.sum.killed', 'killed'],
    ['battleView.sum.wounded', 'wounded'],
    ['battleView.sum.captured', 'captured'],
  ];
  return (
    <div className="bv-modal bv-summary-wrap" role="dialog" aria-modal="true" aria-labelledby="bv-sum-title" data-testid="battle-summary">
      <div className={`bv-modal-card bv-summary outcome-${summary.outcome}`}>
        <h2 id="bv-sum-title" data-testid="battle-outcome" data-outcome={summary.outcome}>
          {t(`battleView.outcome.${summary.outcome}`)}
        </h2>
        {reasonKey && <p className="bv-reason">{t(reasonKey)}</p>}
        <p className="muted">{t('battleView.sum.duration', { time: clock(summary.durationS) })}</p>
        <table className="bv-sum-table">
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
        <ul className="bv-sum-facts">
          {(summary.lootValue > 0 || c.side === 'attacker') && <li data-testid="battle-sum-loot">{t('battleView.sum.loot', { value: summary.lootValue, silver: summary.lootSilver })}</li>}
          {summary.lootGoods.length > 0 && (
            <li>
              {t('battleView.sum.goods', {
                list: [...summary.lootGoods]
                  .sort((a, b) => b.tons - a.tons)
                  .slice(0, 6)
                  .map((g) => t('battleView.sum.good', { tons: formatNumber(g.tons, { maximumFractionDigits: 2 }), good: t(`economy.good.${g.good}`) }))
                  .join(', '),
                more: Math.max(0, summary.lootGoods.length - 6),
              })}
            </li>
          )}
          {summary.buildingsBurned > 0 && <li>{t('battleView.sum.burned', { n: summary.buildingsBurned })}</li>}
          {(summary.chief.killed || summary.chief.captured) && <li>{t(summary.chief.killed ? 'battleView.sum.chiefKilled' : 'battleView.sum.chiefCaptured')}</li>}
        </ul>
        {summary.leaders.length > 0 && (
          <div className="bv-sum-leaders">
            <h3>{t('battleView.sum.leaders')}</h3>
            <ul>
              {summary.leaders.map((l) => (
                <li key={l.id} className={`fate-${l.fate}`} data-testid={`battle-leader-${l.id}`}>
                  <span className={`bv-swatch ${l.side === c.side ? 'is-own' : 'is-foe'}`} />
                  <span>{l.name}</span>
                  <span className="muted">{t(`battleView.fate.${l.fate}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="bv-error" role="alert" data-testid="battle-return-error">
            {error}
          </p>
        )}
        <div className="bv-modal-actions">{children}</div>
      </div>
    </div>
  );
}
