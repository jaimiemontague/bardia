/**
 * The Arrival Card (pending 'arrival', design §9.5; the arrivalScene screen replaces it with a full-screen
 * scene at a higher priority) and the Aftermath scene (pending 'aftermath', §16.3, full screen).
 * Both read the options the settlements module put in the payload (availability, the reason an option is
 * greyed out, preview numbers) and dispatch its commands, so the client decides nothing itself.
 */
import { useState, type ReactElement } from 'react';
import type { CharId, GameState, PendingDecision, Settlement, SettlementId } from '@sim/core/state';
import { governorCandidates } from '@sim/modules/settlements/index';
import type { AftermathFate, ArrivalChoice, DecisionOption } from '@sim/modules/settlements/types';
import { useGame, usePending } from '../../app/gameStore';
import { useMusicState } from '../../audio/hooks';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { ambienceOf, bannerColour, Painting, PLAYER_COLOUR, SceneChoices, SceneLayout, SceneStage, SettlementPicture, styleOfCulture, type SceneChoiceItem, type SettlementPictureModel } from '../../render/scenes/index';
import { hashString } from '../../render/scenes/paint';
import { Button, Icon, Modal, Select } from '../../ui/index';
import { GenericDecision } from '../../shell/DecisionHost';
import { sumMen } from '../expedition/names';
import './settlement.css';

function factionName(state: GameState, id: string): string {
  return state.factions[id as never]?.name ?? id;
}

/** One line about the place: tier, lord, people. */
export function settlementLine(state: GameState, s: Settlement, t: ReturnType<typeof useT>): string {
  return t('settlements.ui.line', { tier: tOr(`ui.tier.${s.tier}`, s.tier), lord: factionName(state, s.factionId), pop: formatNumber(s.pop) });
}

function OptionButton({ id, labelKey, hintKey, option, tone, onPick }: { id: string; labelKey: string; hintKey: string; option: DecisionOption<string>; tone: 'primary' | 'danger' | 'secondary'; onPick(): void }): ReactElement {
  const t = useT();
  return (
    <li className={`st-option${option.available ? '' : ' st-option-off'}`} data-testid={`option-${id}`}>
      <Button variant={tone} disabled={!option.available} onClick={onPick} data-testid={`choose-${id}`}>
        {t(labelKey)}
      </Button>
      <div className="st-option-text">
        <span>{t(hintKey)}</span>
        {!option.available && option.reasonKey !== undefined && (
          <span className="tone-bad st-reason">
            <Icon name="warning" /> {t(option.reasonKey)}
          </span>
        )}
      </div>
    </li>
  );
}

function ArrivalCard({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const payload = pending.payload as { settlementId: SettlementId; options?: DecisionOption<ArrivalChoice>[] };
  const s = state.settlements[payload.settlementId];
  const fleet = state.player.expeditionFleetId !== undefined ? state.fleets[state.player.expeditionFleetId] : undefined;
  const options = payload.options ?? [];
  const tone = (id: ArrivalChoice) => (id === 'raid' || id === 'assault' ? 'danger' : id === 'leave' ? 'secondary' : 'primary');
  return (
    <Modal open layer="decision" size="lg" title={s?.name ?? t('ui.decision.kind.arrival')} subtitle={formatGameDate(pending.hour)} data-testid="arrival-card">
      {s && (
        <div className="st-facts">
          <p>{settlementLine(state, s, t)}</p>
          <p className="muted">
            {t('settlements.ui.walls', { tier: tOr(`ui.fortTier.${s.fortTier}`, String(s.fortTier)) })} · {t('settlements.ui.yourMen', { men: formatNumber(fleet ? sumMen(fleet.men) : 0) })}
          </p>
        </div>
      )}
      <ul className="st-options">
        {options.map((o) => (
          <OptionButton key={o.id} id={o.id} labelKey={`settlements.arrival.${o.id}`} hintKey={`settlements.arrival.hint.${o.id}`} option={o} tone={tone(o.id)} onPick={() => dispatch({ type: 'resolveArrival', choice: o.id })} />
        ))}
      </ul>
    </Modal>
  );
}

const PREVIEW_KEYS = ['renown', 'dread', 'honor', 'opinion', 'silver', 'garrison'] as const;

/** Fates in view first: the ones open to the player, in the order a raider weighs them (at most four). */
const FATE_ORDER: readonly AftermathFate[] = ['plunderAndLeave', 'spare', 'makeTributary', 'sackAndBurn', 'annex', 'takeCaptives', 'liberate'];

/** Splits the Aftermath's fates: at most four open ones in view, the rest (and the closed ones) behind More. */
export function planFates(options: readonly DecisionOption<AftermathFate>[]): { inView: DecisionOption<AftermathFate>[]; more: DecisionOption<AftermathFate>[] } {
  const rank = (o: DecisionOption<AftermathFate>) => FATE_ORDER.indexOf(o.id);
  const open = options.filter((o) => o.available).sort((a, b) => rank(a) - rank(b));
  const closed = options.filter((o) => !o.available).sort((a, b) => rank(a) - rank(b));
  return { inView: open.slice(0, 4), more: [...open.slice(4), ...closed] };
}

/** The picture of a place just taken (seen from the field, smoke rising). */
export function aftermathPicture(state: GameState, s: Settlement): SettlementPictureModel {
  return {
    ambience: ambienceOf(state, { pos: s.mapPos }),
    tier: s.tier,
    fortTier: s.fortTier,
    style: styleOfCulture(s.culture),
    lantern: s.faith === 'lantern' || s.faith === 'goldenLantern',
    seed: hashString(s.id),
    colour: bannerColour(state.factions[s.factionId], state.player.factionId),
    ourColour: PLAYER_COLOUR,
    raided: true,
    coastal: s.coastal,
    view: 'aftermath',
  };
}

/** The Aftermath scene (§16.3): the taken place behind, at most four fates in view, the rest behind More. */
export function AftermathSceneBody({ settlement, picture, options, governors, onChoose }: { settlement: Settlement; picture: SettlementPictureModel; options: readonly DecisionOption<AftermathFate>[]; governors: { id: CharId; name: string }[]; onChoose(fate: AftermathFate, governorId?: CharId): void }): ReactElement {
  const t = useT();
  const [governor, setGovernor] = useState<CharId | undefined>(governors[0]?.id);
  const { inView, more } = planFates(options);
  const tip = (o: DecisionOption<AftermathFate>) =>
    PREVIEW_KEYS.filter((k) => o.preview?.[k] !== undefined && o.preview[k] !== 0)
      .map((k) => t(`settlements.preview.${k}`, { value: o.preview?.[k] ?? 0 }))
      .join(' · ');
  const item = (o: DecisionOption<AftermathFate>): SceneChoiceItem => {
    const details = tip(o);
    return {
      id: o.id,
      label: t(`settlements.fate.${o.id}`),
      line: !o.available && o.reasonKey !== undefined ? t(o.reasonKey) : t(`settlements.fate.hint.${o.id}`),
      tone: !o.available ? 'quiet' : o.id === 'sackAndBurn' ? 'danger' : o.id === 'plunderAndLeave' ? 'safe' : 'primary',
      ...(o.available ? {} : { disabled: true }),
      ...(details ? { tip: details } : {}),
      testId: `choose-${o.id}`,
      itemTestId: `option-${o.id}`,
      onPick: () => onChoose(o.id, o.id === 'annex' ? governor : undefined),
      extra:
        o.id === 'annex' && o.available && governors.length > 1 ? (
          <Select className="st-governor" aria-label={t('settlements.ui.governor')} value={governor ?? ''} onChange={(e) => setGovernor(e.target.value as CharId)} data-testid="annex-governor">
            {governors.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        ) : null,
    };
  };
  return (
    <SceneLayout
      testId="aftermath"
      className="scn-aftermath"
      data={{ tier: settlement.tier }}
      picture={
        <Painting assetId="settlements.scene.aftermath">
          <SettlementPicture model={picture} testId="aftermath-picture" />
        </Painting>
      }
      kicker={t('settlements.scene.aftermathKicker')}
      title={t('settlements.fate.title', { settlement: settlement.name })}
      text={t('settlements.scene.aftermathText', { settlement: settlement.name })}
    >
      <SceneChoices inView={inView.map(item)} more={more.map(item)} moreLabel={t('settlements.scene.more', { count: more.length })} backLabel={t('settlements.scene.back')} label={t('settlements.scene.choicesLabel')} />
    </SceneLayout>
  );
}

function AftermathScreen({ pending, state }: { pending: PendingDecision; state: GameState }): ReactElement | null {
  const dispatch = useGame((s) => s.dispatch);
  const payload = pending.payload as { settlementId: SettlementId; options?: DecisionOption<AftermathFate>[] };
  const s = state.settlements[payload.settlementId];
  if (!s) return <GenericDecision pending={pending} />;
  const governors = governorCandidates(state, state.player.expeditionFleetId).map((id) => ({ id, name: state.characters[id]?.name ?? id }));
  return (
    <SceneStage cue={null}>
      <AftermathSceneBody
        settlement={s}
        picture={aftermathPicture(state, s)}
        options={payload.options ?? []}
        governors={governors}
        onChoose={(fate, governorId) => dispatch({ type: 'chooseAftermath', fate, ...(fate === 'annex' && governorId !== undefined ? { governorId } : {}) })}
      />
    </SceneStage>
  );
}

function ArrivalScreen(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  useMusicState(pending?.kind === 'arrival' ? 'arrival' : null);
  if (!pending || !state || pending.kind !== 'arrival') return null;
  return <ArrivalCard pending={pending} state={state} />;
}

function AftermathHost(_props: ScreenProps): ReactElement | null {
  const pending = usePending();
  const state = useGame((s) => s.state);
  useMusicState(pending?.kind === 'aftermath' ? 'settlement' : null);
  if (!pending || !state || pending.kind !== 'aftermath') return null;
  return <AftermathScreen pending={pending} state={state} />;
}

export const screens: ScreenDescriptor[] = [
  { id: 'arrival', pending: 'arrival', component: ArrivalScreen, layout: 'modal', titleKey: 'ui.decision.kind.arrival' },
  { id: 'aftermath', pending: 'aftermath', component: AftermathHost, layout: 'fullscreen', titleKey: 'ui.decision.kind.aftermath' },
];
