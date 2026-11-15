/**
 * The encounter scene (pending 'encounter', §20.7): a horn and a banner over the map, then the whole screen
 * becomes what the crew sees (their sails from our deck, or their band on the heath), with the title, two
 * sentences, who and how many in words, and at most four big choices. Each choice dispatches the payload's
 * ready-made command; the client decides nothing itself.
 */
import { useMemo, type ReactElement } from 'react';
import type { Command } from '@sim/core/commands';
import type { TextVars } from '@sim/core/state';
import { useT } from '../../i18n/index';
import { EncounterPicture, firstSentences, Painting, SceneChoices, SceneLayout, SceneStage, type CueSpec, type SceneChoiceItem } from '../../render/scenes/index';
import type { EncounterView, PlannedChoice } from './model';

function choiceItem(t: ReturnType<typeof useT>, view: EncounterView, c: PlannedChoice, first: boolean, pick: (command: Command) => void): SceneChoiceItem {
  const id = c.choice.id;
  const vars: TextVars = { ...view.payload.vars, ...(c.choice.vars ?? {}) };
  const off = c.choice.disabled === true;
  const reason = typeof vars['reason'] === 'string' ? (vars['reason'] as string) : 'unavailable';
  const danger = c.choice.tone === 'danger';
  return {
    id,
    label: t(`encounters.scene.choice.${id}`, vars),
    line: off ? t(`encounters.reason.${reason}`, vars) : t(`encounters.scene.line.${id}`, vars),
    tone: off ? 'quiet' : first ? 'safe' : danger ? 'danger' : 'primary',
    ...(off ? { disabled: true } : {}),
    ...(c.odds ? { odds: { word: t(`encounters.scene.odds.${c.odds.band}`), band: c.odds.band } } : {}),
    ...(c.choice.previewKey && !off ? { tip: t(c.choice.previewKey, vars) } : {}),
    testId: `decision-choice-${id}`,
    onPick: () => pick(c.choice.command),
  };
}

/** At most two sentences of the body, without a first sentence that only repeats the title. */
export function bodyText(title: string, body: string): string {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const first = body.match(/^[^.!?]+[.!?]+\s*/)?.[0] ?? '';
  const rest = first && norm(first) === norm(title) ? body.slice(first.length) : body;
  return firstSentences(rest, 2);
}

/** The scene itself (no cue): used by the screen after its cue, by the gallery and by tests. */
export function EncounterSceneBody({ view, onCommand }: { view: EncounterView; onCommand(command: Command): void }): ReactElement {
  const t = useT();
  const p = view.payload;
  const vars = p.vars ?? {};
  const inView = view.inView.map((c, i) => choiceItem(t, view, c, i === 0, onCommand));
  const more = view.more.map((c) => choiceItem(t, view, c, false, onCommand));
  return (
    <SceneLayout
      testId="encounter-scene"
      data={{ kind: String(p.kind ?? ''), stage: String(p.stage ?? ''), domain: String(p.domain ?? '') }}
      picture={
        <Painting assetId={view.assetId}>
          <EncounterPicture model={view.picture} />
        </Painting>
      }
      kicker={t('encounters.scene.kicker', view.kickerVars)}
      title={t(p.titleKey ?? 'ui.decision.kind.encounter', vars)}
      text={p.key ? bodyText(p.titleKey ? t(p.titleKey, vars) : '', t(p.key, vars)) : ''}
      facts={t(view.whoKey, view.whoVars)}
    >
      <SceneChoices inView={inView} more={more} moreLabel={t('encounters.scene.more', { count: more.length })} backLabel={t('encounters.scene.back')} label={t('encounters.scene.choicesLabel')} />
    </SceneLayout>
  );
}

/** The cue then the scene. */
export function EncounterScene({ view, onCommand, cue = true }: { view: EncounterView; onCommand(command: Command): void; cue?: boolean }): ReactElement {
  const t = useT();
  const spec = useMemo<CueSpec | null>(() => {
    if (!cue) return null;
    const where = t('encounters.cue.dir', view.cue.vars);
    return { text: t(view.cue.mainKey, { ...view.cue.vars, where }), sub: t(view.cue.subKey, view.cue.vars), sound: view.cue.sound, glyph: view.cue.glyph, tone: view.cue.tone };
  }, [cue, t, view]);
  return (
    <SceneStage cue={spec}>
      <EncounterSceneBody view={view} onCommand={onCommand} />
    </SceneStage>
  );
}
