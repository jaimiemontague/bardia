/**
 * The developer console overlay (backtick). Command history (↑/↓), Tab completion, scrollback.
 * Available in dev builds, or in release builds when enabled in Options → Gameplay.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useDevFlags } from '../app/devFlags';
import { useGame } from '../app/gameStore';
import type { ScreenRegistry } from '../app/screenRegistry';
import { formatGameDateTime } from '../i18n/calendar';
import { missingKeysSeen, useT } from '../i18n/index';
import { Icon, IconButton, ScrollArea } from '../ui/index';
import { complete, runDevCommand, type DevContext, type DevLine } from './commands';
import { recentEventBatches } from './eventLog';

/** Triggers a browser download of text content. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The live context the console runs against. */
export function liveDevContext(registry: ScreenRegistry): DevContext {
  return {
    session: () => useGame.getState().session,
    advanceHours: (h) => useGame.getState().advanceHours(h),
    dispatch: (c) => useGame.getState().dispatch(c),
    flags: () => useDevFlags.getState(),
    setFlags: (p) => useDevFlags.getState().set(p),
    setSpeed: (s) => useGame.getState().setSpeed(s),
    setPaused: (p) => useGame.getState().setPaused(p),
    registry: () => registry,
    recentEvents: recentEventBatches,
    missingKeys: missingKeysSeen,
    download: downloadText,
    formatDate: formatGameDateTime,
  };
}

interface Entry {
  id: number;
  line: DevLine;
}

let entrySeq = 1;
const HISTORY_KEY = 'bardia.devconsole.history';

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

/** The console overlay (renders nothing while closed). */
export function DevConsole({ registry }: { registry: ScreenRegistry }): ReactElement | null {
  const t = useT();
  const open = useDevFlags((s) => s.consoleOpen);
  const toggle = useDevFlags((s) => s.toggleConsole);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [cursor, setCursor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ctx = useMemo(() => liveDevContext(registry), [registry]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const print = (lines: DevLine[]) => setEntries((e) => [...e, ...lines.map((line) => ({ id: entrySeq++, line }))].slice(-400));

  const submit = () => {
    const line = input.trim();
    setInput('');
    setCursor(null);
    if (!line) return;
    const nextHistory = [...history.filter((h) => h !== line), line].slice(-50);
    setHistory(nextHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      // History is a convenience.
    }
    if (line === 'clear' || line === 'cls') {
      setEntries([]);
      return;
    }
    print([{ tone: 'echo', text: `› ${line}` }, ...runDevCommand(line, ctx)]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length === 0) return;
      const i = cursor === null ? (e.key === 'ArrowUp' ? history.length - 1 : null) : cursor + (e.key === 'ArrowUp' ? -1 : 1);
      if (i === null || i >= history.length) {
        setCursor(null);
        setInput('');
      } else {
        const j = Math.max(0, i);
        setCursor(j);
        setInput(history[j] ?? '');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const word = input.trimStart();
      if (word.includes(' ')) return;
      const matches = complete(word);
      if (matches.length === 1) setInput(`${matches[0]} `);
      else if (matches.length > 1) print([{ tone: 'info', text: matches.join('  ') }]);
    } else if (e.key === 'Escape' || e.key === '`') {
      e.preventDefault();
      e.stopPropagation();
      toggle(false);
    }
  };

  return (
    <div className="devconsole" role="dialog" aria-label={t('ui.dev.title')} data-testid="dev-console">
      <div className="devconsole-head">
        <Icon name="terminal" />
        <span className="devconsole-title">{t('ui.dev.title')}</span>
        <span className="devconsole-hint">{t('ui.dev.hint')}</span>
        <span className="spacer" />
        <IconButton icon="close" label={t('ui.common.close')} size="sm" onClick={() => toggle(false)} noTooltip />
      </div>
      <ScrollArea label={t('ui.dev.output')} className="devconsole-out" stickToBottom>
        {entries.length === 0 && <div className="devconsole-line tone-info">{t('ui.dev.welcome')}</div>}
        {entries.map(({ id, line }) => (
          <div key={id} className={`devconsole-line tone-${line.tone}`}>
            {'text' in line ? line.text : line.vars && typeof line.vars.desc === 'string' && line.key === 'ui.dev.out.helpLine' ? t(line.key, { ...line.vars, desc: t(line.vars.desc) }) : t(line.key, line.vars)}
          </div>
        ))}
      </ScrollArea>
      <div className="devconsole-input-row">
        <span className="devconsole-prompt" aria-hidden="true">
          ›
        </span>
        <input
          ref={inputRef}
          className="devconsole-input"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          aria-label={t('ui.dev.input')}
          spellCheck={false}
          autoComplete="off"
          data-testid="dev-console-input"
        />
      </div>
    </div>
  );
}
