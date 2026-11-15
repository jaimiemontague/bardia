/**
 * The big choice buttons over a scene (§20.7: at most four in view, one plain line each). Choices beyond
 * the first four wait behind "More"; pressing it swaps the list for the rest (with a way back), so the
 * screen never shows more than four. Fresh presses of 1–4 pick the choices in view.
 */
import { useState, type ReactElement } from 'react';
import { Tooltip } from '../../ui/index';
import { useFreshKeys } from './SceneStage';

export type SceneChoiceTone = 'safe' | 'primary' | 'danger' | 'quiet';

export interface SceneChoiceItem {
  id: string;
  label: string;
  /** One plain line: what it does (or why it cannot be done). */
  line: string;
  tone: SceneChoiceTone;
  disabled?: boolean;
  /** The odds as a word, its band (for colour) and the exact figure for the tooltip. */
  odds?: { word: string; band: string };
  /** Tooltip text (details: the percentage, the full preview). */
  tip?: string;
  testId: string;
  /** Test id of the list item wrapping the button (arrival and aftermath keep `option-<id>`). */
  itemTestId?: string;
  onPick(): void;
  /** Extra control under the line (the aftermath's governor picker). */
  extra?: ReactElement | null;
}

function Choice({ c, index }: { c: SceneChoiceItem; index: number | null }): ReactElement {
  const button = (
    <button type="button" className={`scn-choice tone-${c.tone}`} disabled={c.disabled} onClick={c.onPick} data-testid={c.testId} data-choice={c.id}>
      {index !== null && (
        <span className="scn-choice-key" aria-hidden="true">
          {index}
        </span>
      )}
      <span className="scn-choice-body">
        <span className="scn-choice-label">
          <span>{c.label}</span>
          {c.odds && !c.disabled && (
            <span className="scn-odds" data-band={c.odds.band}>
              {c.odds.word}
            </span>
          )}
        </span>
        <span className="scn-choice-line">{c.line}</span>
      </span>
    </button>
  );
  return (
    <li className={`scn-choice-item${c.disabled ? ' is-off' : ''}`} data-testid={c.itemTestId}>
      {c.tip ? (
        <Tooltip content={c.tip} block placement="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {c.extra}
    </li>
  );
}

/** The list of choices with the More swap (see the file header). */
export function SceneChoices({ inView, more, moreLabel, backLabel, label }: { inView: readonly SceneChoiceItem[]; more: readonly SceneChoiceItem[]; moreLabel: string; backLabel: string; label: string }): ReactElement {
  const [showMore, setShowMore] = useState(false);
  const visible = showMore ? more : inView;
  useFreshKeys((e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 4) return false;
    const c = visible[n - 1];
    if (!c || c.disabled) return false;
    c.onPick();
    return true;
  });
  return (
    <div className="scn-choices" role="group" aria-label={label}>
      <ul className="scn-choice-list" hidden={showMore}>
        {inView.map((c, i) => (
          <Choice key={c.id} c={c} index={i + 1} />
        ))}
        {more.length > 0 && (
          <li className="scn-choice-item">
            <button type="button" className="scn-more" onClick={() => setShowMore(true)} data-testid="scene-more">
              {moreLabel}
            </button>
          </li>
        )}
      </ul>
      {more.length > 0 && (
        <ul className="scn-choice-list" hidden={!showMore}>
          {more.map((c, i) => (
            <Choice key={c.id} c={c} index={showMore ? i + 1 : null} />
          ))}
          <li className="scn-choice-item">
            <button type="button" className="scn-more" onClick={() => setShowMore(false)} data-testid="scene-less">
              {backLabel}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
