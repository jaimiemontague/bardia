/**
 * SCR-02 New Saga Wizard (§5.1): ten steps, each with Random and Recommended, plus Quick Start
 * (random identity and homeland, recommended everything else, straight into the game). A summary of
 * the saga so far stays visible beside every step.
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import type { Content } from '@content/index';
import { SKILL_IDS } from '@content/schemas/ids';
import { loadContent } from '../../app/content';
import { beginSaga } from '../../app/lifecycle';
import { firstInvalidStep, previewCharacter, quickStartChoices, toNewGameOptions, validateStep, WIZARD_STEPS, type NewSagaChoices, type WizardStep } from '../../app/newSaga/model';
import { bundledJarldoms } from '../../app/newSaga/provinces';
import { useNewSaga, wizardDice } from '../../app/newSaga/store';
import { useScreenRegistry } from '../../app/registryContext';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Button, Frame, Icon, Portrait, ScrollArea } from '../../ui/index';
import { cultureName, STEP_COMPONENTS, traitName, upbringingName, wizardPortrait } from './steps';
import './newSaga.css';

function Summary({ c, content }: { c: NewSagaChoices; content: Content }): ReactElement {
  const t = useT();
  const preview = previewCharacter(c, content);
  const top = [...SKILL_IDS].sort((a, b) => preview.skills[b].total - preview.skills[a].total).slice(0, 3);
  return (
    <aside className="wizard-summary" aria-label={t('menu.newSaga.summary')}>
      <Portrait recipe={wizardPortrait(c)} alt={t('menu.newSaga.identity.portraitAlt', { name: c.name || '—' })} size="lg" initial={c.name.slice(0, 1)} />
      <div className="summary-name" data-testid="summary-name">
        {c.name || '—'}
      </div>
      <div className="summary-sub">{t('menu.newSaga.summaryLine', { homeland: cultureName(c.culture, content), upbringing: upbringingName(c.upbringing, content) })}</div>
      <ul className="summary-list">
        <li>
          <Icon name="character" />
          {t('menu.newSaga.summaryParent', { parent: c.slainParent })}
        </li>
        <li>
          <Icon name="star" />
          {preview.traits.map((id) => traitName(id, content)).join(', ') || t('menu.newSaga.summaryNoTraits')}
        </li>
        <li>
          <Icon name="sword" />
          {top.map((s) => `${t(`ui.skill.${s}`)} ${preview.skills[s].total}`).join(' · ')}
        </li>
        <li>
          <Icon name="shieldRound" />
          {t(`ui.difficulty.${c.difficulty}`)}
          {c.toggles.ironman ? ` · ${t('menu.newSaga.option.ironman')}` : ''}
        </li>
      </ul>
    </aside>
  );
}

function ContentError({ error, issues }: { error: string; issues: string[] }): ReactElement {
  const t = useT();
  return (
    <div className="wizard wizard-error">
      <MenuBackdrop dim />
      <Frame title={t('menu.newSaga.contentError')} ornate footer={<Button icon="arrowLeft" onClick={() => navigation.showMenu('mainMenu')}>{t('ui.common.back')}</Button>}>
        <p>{t('menu.newSaga.contentErrorBody')}</p>
        <ScrollArea label={t('menu.newSaga.contentError')} maxHeight="40vh">
          <pre className="error-pre">{issues.length > 0 ? issues.join('\n') : error}</pre>
        </ScrollArea>
      </Frame>
    </div>
  );
}

function Wizard({ content }: { content: Content }): ReactElement {
  const t = useT();
  const registry = useScreenRegistry();
  const jarldoms = useMemo(() => bundledJarldoms(), []);
  const { choices, step, visited, begin, update, goTo, next, back, random, recommend } = useNewSaga();

  useEffect(() => {
    if (!choices) begin(content);
  }, [choices, begin, content]);

  if (!choices) return <div className="wizard" />;
  const Step = STEP_COMPONENTS[step];
  const index = WIZARD_STEPS.indexOf(step);
  const issues = validateStep(step, choices, content, jarldoms);
  const allIssues = firstInvalidStep(choices, content, jarldoms);
  const isConfirm = step === 'confirm';

  const start = (c: NewSagaChoices) => {
    if (beginSaga(toNewGameOptions(c, content))) useNewSaga.getState().reset();
  };
  const quickStart = () => start(quickStartChoices(content, wizardDice(), jarldoms));
  const onNext = () => {
    if (isConfirm) {
      if (allIssues) goTo(allIssues);
      else start(choices);
    } else next();
  };

  return (
    <div className="wizard" data-testid="new-saga">
      <MenuBackdrop dim />
      <header className="wizard-head">
        <Button variant="ghost" icon="arrowLeft" onClick={() => navigation.showMenu('mainMenu')} data-testid="wizard-exit">
          {t('menu.newSaga.exit')}
        </Button>
        <h1 className="wizard-title">{t('menu.newSaga.title')}</h1>
        <Button variant="primary" icon="ship" onClick={quickStart} data-testid="quick-start">
          {t('menu.newSaga.quickStart')}
        </Button>
      </header>
      <div className="wizard-body">
        <nav className="wizard-rail" aria-label={t('menu.newSaga.steps')}>
          <ol>
            {WIZARD_STEPS.map((s: WizardStep, i) => {
              const ok = s === 'confirm' ? allIssues === null : validateStep(s, choices, content, jarldoms).length === 0;
              const seen = visited.includes(s);
              return (
                <li key={s}>
                  <button type="button" className={['rail-step', s === step && 'is-current', seen && 'is-visited', seen && !ok && 'has-issue'].filter(Boolean).join(' ')} aria-current={s === step ? 'step' : undefined} onClick={() => goTo(s)} data-testid={`step-${s}`}>
                    <span className="rail-num">{seen && ok && s !== step ? <Icon name="check" size={0.9} /> : i + 1}</span>
                    <span className="rail-label">{t(`menu.newSaga.step.${s}`)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <Frame className="wizard-stage" title={t(`menu.newSaga.step.${step}`)} subtitle={t(`menu.newSaga.intro.${step}`)} ornate data-testid={`wizard-step-${step}`}>
          <ScrollArea label={t(`menu.newSaga.step.${step}`)} className="wizard-scroll">
            <Step choices={choices} content={content} update={(p) => update(p, content)} jarldoms={jarldoms} registry={registry} />
          </ScrollArea>
        </Frame>
        <Summary c={choices} content={content} />
      </div>
      <footer className="wizard-foot">
        <Button icon="arrowLeft" onClick={back} disabled={index === 0} data-testid="wizard-back">
          {t('ui.common.back')}
        </Button>
        {!isConfirm && (
          <>
            <Button variant="ghost" icon="dice" onClick={() => random(content, jarldoms)} data-testid="wizard-random">
              {t('menu.newSaga.random')}
            </Button>
            <Button variant="ghost" icon="star" onClick={() => recommend(content, jarldoms)} data-testid="wizard-recommended">
              {t('menu.newSaga.recommended')}
            </Button>
          </>
        )}
        <span className="wizard-issues" role="status" aria-live="polite">
          {issues.length > 0 && (
            <>
              <Icon name="warning" /> {t(issues[0] as string)}
            </>
          )}
          {isConfirm && allIssues && (
            <>
              <Icon name="warning" /> {t('menu.newSaga.issue.incomplete', { step: t(`menu.newSaga.step.${allIssues}`) })}
            </>
          )}
        </span>
        <Button variant={isConfirm ? 'primary' : 'secondary'} size={isConfirm ? 'lg' : 'md'} iconAfter={isConfirm ? 'ship' : 'arrowRight'} onClick={onNext} data-testid="wizard-next">
          {isConfirm ? t('menu.newSaga.begin') : t('ui.common.next')}
        </Button>
      </footer>
    </div>
  );
}

function NewSagaScreen(_props: ScreenProps): ReactElement {
  const result = loadContent();
  if (!result.ok) return <ContentError error={result.error} issues={result.issues} />;
  return <Wizard content={result.content} />;
}

export const screen: ScreenDescriptor = { id: 'newSaga', route: 'newSaga', component: NewSagaScreen, layout: 'fullscreen', titleKey: 'menu.newSaga.title' };
