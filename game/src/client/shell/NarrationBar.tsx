/**
 * Narration bar (§25.1 bottom: narration): the latest narration line with its speaker label,
 * revealed at the player's narration speed (instant with reduced motion); click or Enter completes
 * the line; the history button lists recent lines.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useFeeds, type NarrationEntry } from '../app/chronicleFeeds';
import { formatGameDate } from '../i18n/calendar';
import { useT } from '../i18n/index';
import { useSettings } from '../settings/store';
import type { NarrationSpeed } from '../settings/schema';
import { IconButton, ScrollArea } from '../ui/index';

/** Characters per second for each narration speed (Infinity = instant). */
export const NARRATION_CPS: Readonly<Record<NarrationSpeed, number>> = { slow: 28, normal: 55, fast: 120, instant: Infinity };

function useTypewriter(text: string, cps: number): [string, boolean, () => void] {
  const [shown, setShown] = useState(cps === Infinity ? text.length : 0);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
    if (cps === Infinity) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const n = Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  return [text.slice(0, shown), shown >= text.length, () => setShown(textRef.current.length)];
}

function Line({ entry }: { entry: NarrationEntry }): ReactElement {
  const t = useT();
  const speed = useSettings((s) => s.settings.accessibility.narrationSpeed);
  const reduced = useSettings((s) => s.settings.accessibility.reducedMotion);
  const labels = useSettings((s) => s.settings.accessibility.speakerLabels);
  const text = t(entry.key, entry.vars);
  const [shown, done, complete] = useTypewriter(text, reduced ? Infinity : NARRATION_CPS[speed]);
  return (
    <button type="button" className="narration-line" onClick={complete} aria-label={text} data-testid="narration-line">
      {labels && <span className="narration-speaker">{t(`ui.voice.${entry.voice}`)}</span>}
      <span className="narration-text" aria-hidden="true">
        “{shown}
        {done ? '”' : <span className="narration-caret" />}
      </span>
    </button>
  );
}

/** The narration strip with a history popover. */
export function NarrationBar({ idleKey = 'ui.narration.idle' }: { idleKey?: string }): ReactElement {
  const t = useT();
  const lines = useFeeds((s) => s.narration);
  const [history, setHistory] = useState(false);
  const last = lines[lines.length - 1];
  return (
    <div className="narration" data-testid="narration">
      <div className="narration-body" aria-live="polite">
        {last ? <Line key={last.id} entry={last} /> : <span className="narration-idle">{t(idleKey)}</span>}
      </div>
      <IconButton icon="feather" label={t('ui.narration.history')} onClick={() => setHistory((h) => !h)} pressed={history} disabled={lines.length === 0} size="sm" />
      {history && (
        <div className="narration-history" role="dialog" aria-label={t('ui.narration.history')}>
          <ScrollArea label={t('ui.narration.history')} maxHeight="16rem" stickToBottom>
            <ol className="narration-history-list">
              {lines.slice(-40).map((l) => (
                <li key={l.id}>
                  <span className="narration-history-meta">
                    {t(`ui.voice.${l.voice}`)} · {formatGameDate(l.hour)}
                  </span>
                  <span>{t(l.key, l.vars)}</span>
                </li>
              ))}
            </ol>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
