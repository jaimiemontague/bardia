/**
 * The shared frame of the hall's building screens (SCR-06 "Building Interior": Great hall, Shipyard, Smithy):
 * an ornate overlay screen (Frame size="screen", ARCHITECTURE §20 rule 4) with a title, a subtitle, a close button, and a "why not" note helper so every
 * disabled action says why in plain words.
 */
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../i18n/index';
import { Frame, Icon, IconButton } from '../../ui/index';
import './building.css';

/** The overlay frame of a building screen. */
export function BuildingFrame({
  title,
  subtitle,
  onClose,
  testId,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose(): void;
  testId: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const t = useT();
  return (
    <Frame
      size="screen"
      title={title}
      subtitle={subtitle}
      ornate
      className={['bld-frame', className].filter(Boolean).join(' ')}
      actions={
        <IconButton
          icon="close"
          label={t('military.ui.close')}
          onClick={onClose}
          data-testid={`${testId}-close`}
        />
      }
      data-testid={testId}
    >
      {children}
    </Frame>
  );
}

/** Why an action is unavailable (or that it is ready), shown right next to its button. */
export function WhyNot({
  reasons,
  ok,
  okTone = 'good',
  testId,
}: {
  reasons: readonly string[];
  ok?: string;
  /** 'hint': the `ok` text is advice (neutral), not a green light. */
  okTone?: 'good' | 'hint';
  testId?: string;
}): ReactElement | null {
  if (reasons.length === 0) {
    if (ok === undefined) return null;
    return (
      <p className={`bld-why ${okTone === 'hint' ? 'muted' : 'tone-good'}`} data-testid={testId}>
        <Icon name={okTone === 'hint' ? 'info' : 'check'} /> {ok}
      </p>
    );
  }
  return (
    <ul className="bld-why" data-testid={testId}>
      {reasons.map((r, i) => (
        <li key={`${i}-${r}`} className="tone-bad">
          <Icon name="warning" /> {r}
        </li>
      ))}
    </ul>
  );
}
