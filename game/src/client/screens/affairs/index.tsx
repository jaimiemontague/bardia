/**
 * Affairs of State (SCR-09, design §10.3; route 'affairs', opened from the Great Hall), laid out by
 * ARCHITECTURE §20: one holding at a time (a row of names switches between them, the capital first), and
 * its three decisions as three doors on the left, each saying in words where things stand; the chosen
 * decision fills the rest of the screen:
 *   - taxes: four choice cards (light, fair, heavy, crushing), each with one line on silver and loyalty;
 *   - buildings: a card per building (what you have), then the chosen one's next tier in one line, one
 *     sentence of cost and one gold button;
 *   - garrison: one TransferSlider between the men under arms and the farms, its consequences in words.
 * The rest (loyalty reasons, the last reckoning, the folk, the garrison's breakdown) sits behind Details.
 *
 * Commands: holdings `setTax`, `queueBuilding`, `setGarrison`. Previews: the holdings module's pure rules
 * and the economy module's `settlementTax`, so the screen never re-implements a rule.
 *
 * Test ids: affairs, affairs-close, affairs-holding-<id>, affairs-panel-folk|buildings|garrison (the doors),
 * affairs-folk, affairs-tax, affairs-tax-<level>, affairs-loyalty, affairs-loyalty-forecast,
 * affairs-folk-details, affairs-reasons, affairs-last-report, affairs-people, affairs-buildings,
 * affairs-slots, affairs-building-<building> (data-tier), affairs-cost-<building>, affairs-build-<building>,
 * affairs-why-<building>, affairs-queue-<building> and affairs-underway-<building> (the chosen building's
 * progress while it is under way), affairs-buildings-details,
 * affairs-garrison, affairs-garrison-total, affairs-garrison-min, affairs-unit-<unit>,
 * affairs-garrison-slider (+ TransferSlider parts), affairs-send-<unit>, affairs-send-why,
 * affairs-garrison-details, affairs-garrison-breakdown.
 */
import { useState, type ReactElement } from 'react';
import type { Content } from '@content/index';
import type { Command } from '@sim/core/commands';
import type { GameState, SettlementId } from '@sim/core/state';
import { buildingOptions, loyaltyBand, menAtHome, playerHoldingIds } from '@sim/modules/holdings/rules';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { t } from '../../i18n/index';
import { ChoiceCard, Frame, IconButton } from '../../ui/index';
import { buildingName } from './format';
import { BuildingsPanel, FolkPanel, GarrisonPanel } from './sections';
import { useMusicState } from '../../audio/hooks';
import './affairs.css';

/** Props of the Affairs of State view (also rendered directly by tests). */
export interface AffairsProps {
  state: GameState;
  content: Content;
  dispatch(cmd: Command): unknown;
  onClose(): void;
  /** Holding shown first (default: the capital). */
  holdingId?: SettlementId;
  /** Decision shown first (default: taxes). */
  panel?: AffairsPanel;
}

/** The three decisions of a holding. */
export type AffairsPanel = 'folk' | 'buildings' | 'garrison';

/** The Affairs of State view for a state. */
export function Affairs({ state, content, dispatch, onClose, holdingId, panel: firstPanel = 'folk' }: AffairsProps): ReactElement {
  const ids = playerHoldingIds(state);
  const [chosen, setChosen] = useState<SettlementId | undefined>(holdingId);
  const [panel, setPanel] = useState<AffairsPanel>(firstPanel);
  const id = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0];
  const holding = id !== undefined ? state.settlements[id] : undefined;
  const close = <IconButton icon="close" label={t('holdings.ui.close')} onClick={onClose} data-testid="affairs-close" />;

  const doors = (() => {
    if (!holding?.holding) return null;
    const h = holding.holding;
    const band = t(`holdings.band.${loyaltyBand(content, h.loyalty)}`).toLowerCase();
    const busy = buildingOptions(state, content, holding.id as SettlementId).find((o) => o.building);
    const men = menAtHome(state, content, holding).total;
    return (
      <nav className="af-doors" aria-label={t('holdings.ui.decisions')}>
        <ChoiceCard
          icon="ledger"
          title={t('holdings.ui.door.folk')}
          line={t('holdings.ui.door.folkLine', { tax: t(`holdings.tax.${h.tax}`), band })}
          selected={panel === 'folk'}
          onClick={() => setPanel('folk')}
          data-testid="affairs-panel-folk"
        />
        <ChoiceCard
          icon="crown"
          title={t('holdings.ui.door.buildings')}
          line={busy ? t('holdings.ui.door.buildingsBusy', { name: buildingName(busy.buildingId), days: busy.building?.daysLeft ?? 0 }) : t('holdings.ui.door.buildingsIdle')}
          selected={panel === 'buildings'}
          onClick={() => setPanel('buildings')}
          data-testid="affairs-panel-buildings"
        />
        <ChoiceCard
          icon="men"
          title={t('holdings.ui.door.garrison')}
          line={t('holdings.ui.atHomeTotal', { men })}
          selected={panel === 'garrison'}
          onClick={() => setPanel('garrison')}
          data-testid="affairs-panel-garrison"
        />
      </nav>
    );
  })();

  return (
    <Frame size="screen" title={t('holdings.ui.title')} subtitle={t('holdings.ui.subtitle')} ornate className="af-affairs" actions={close} data-testid="affairs">
      {ids.length > 1 && (
        <nav className="af-holdings" aria-label={t('holdings.ui.holdings')}>
          {ids.map((hid) => {
            const s = state.settlements[hid];
            if (!s) return null;
            const active = hid === id;
            return (
              <button
                key={hid}
                type="button"
                className={`af-holding${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => setChosen(hid)}
                data-testid={`affairs-holding-${hid}`}
              >
                {hid === state.player.capitalId ? t('holdings.ui.capitalMark', { name: s.name }) : s.name}
              </button>
            );
          })}
        </nav>
      )}
      {holding ? (
        <div className="af-layout" data-holding={holding.id}>
          {doors}
          <div className="af-stage">
            {panel === 'folk' && <FolkPanel state={state} content={content} holding={holding} dispatch={dispatch} />}
            {panel === 'buildings' && <BuildingsPanel key={holding.id} state={state} content={content} holding={holding} dispatch={dispatch} />}
            {panel === 'garrison' && <GarrisonPanel key={holding.id} state={state} content={content} holding={holding} dispatch={dispatch} />}
          </div>
        </div>
      ) : (
        <p className="faint">{t('holdings.issue.notYourHolding')}</p>
      )}
    </Frame>
  );
}

function AffairsScreen({ close, params }: ScreenProps): ReactElement {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  useMusicState('affairs');
  const loaded = loadContent();
  if (!state || !loaded.ok) return <div />;
  const id = typeof params?.['id'] === 'string' ? (params['id'] as SettlementId) : undefined;
  return <Affairs state={state} content={loaded.content} dispatch={dispatch} onClose={close} {...(id !== undefined ? { holdingId: id } : {})} />;
}

export const screen: ScreenDescriptor = { id: 'affairs', route: 'affairs', component: AffairsScreen, layout: 'overlay', titleKey: 'holdings.ui.title' };
