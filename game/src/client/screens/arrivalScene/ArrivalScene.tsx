/**
 * The arrival scene (pending 'arrival', §20.7): a horn and "Land!" over the map, then the settlement as the
 * crew sees it from the ship (or from a hill when a war-band comes overland), its name, one line of what is
 * known, and the options as big buttons. Test ids match the old Arrival Card: `arrival-card` on the scene,
 * `choose-<id>` on each button and `option-<id>` on its row.
 */
import { useMemo, type ReactElement } from 'react';
import type { ArrivalChoice, DecisionOption } from '@sim/modules/settlements/types';
import { formatNumber, useT } from '../../i18n/index';
import { Painting, SceneChoices, SceneLayout, SceneStage, SettlementPicture, type CueSpec, type SceneChoiceItem } from '../../render/scenes/index';
import type { ArrivalView } from './model';

function tone(o: DecisionOption<ArrivalChoice>): SceneChoiceItem['tone'] {
  if (!o.available) return 'quiet';
  if (o.id === 'raid' || o.id === 'assault' || o.id === 'besiege') return 'danger';
  if (o.id === 'leave') return 'quiet';
  if (o.id === 'enter') return 'safe';
  return 'primary';
}

/** The scene itself (no cue). */
export function ArrivalSceneBody({ view, onChoose }: { view: ArrivalView; onChoose(choice: ArrivalChoice): void }): ReactElement {
  const t = useT();
  const s = view.settlement;
  const item = (o: DecisionOption<ArrivalChoice>): SceneChoiceItem => ({
    id: o.id,
    label: t(`settlements.arrival.${o.id}`),
    line: !o.available && o.reasonKey !== undefined ? t(o.reasonKey) : t(`settlements.arrival.hint.${o.id}`),
    tone: tone(o),
    ...(o.available ? {} : { disabled: true }),
    testId: `choose-${o.id}`,
    itemTestId: `option-${o.id}`,
    onPick: () => onChoose(o.id),
  });
  return (
    <SceneLayout
      testId="arrival-card"
      className="scn-arrival"
      data={{ tier: s.tier, fort: String(s.fortTier), view: view.picture.view, scarred: view.picture.raided ? 'yes' : 'no' }}
      picture={
        <Painting assetId={view.assetId}>
          <SettlementPicture model={view.picture} testId="arrival-picture" />
        </Painting>
      }
      kicker={t('settlements.scene.kicker', { ...view.kickerVars, men: formatNumber(Number(view.kickerVars['men'] ?? 0)) })}
      title={s.name}
      text={t('settlements.scene.known', { ...view.knownVars, pop: formatNumber(Number(view.knownVars['pop'] ?? 0)) })}
    >
      <SceneChoices inView={view.inView.map(item)} more={view.more.map(item)} moreLabel={t('settlements.scene.more', { count: view.more.length })} backLabel={t('settlements.scene.back')} label={t('settlements.scene.choicesLabel')} />
    </SceneLayout>
  );
}

/** The cue then the scene. */
export function ArrivalScene({ view, onChoose, cue = true }: { view: ArrivalView; onChoose(choice: ArrivalChoice): void; cue?: boolean }): ReactElement {
  const t = useT();
  const spec = useMemo<CueSpec | null>(() => (cue ? { text: t(view.cue.mainKey, view.cue.vars), sub: view.settlement.name, sound: 'arrival', glyph: 'shore', tone: 'calm' } : null), [cue, t, view]);
  return (
    <SceneStage cue={spec}>
      <ArrivalSceneBody view={view} onChoose={onChoose} />
    </SceneStage>
  );
}
