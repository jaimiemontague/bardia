/**
 * Time controls (§7.2): Pause / 1× / 2× / 4× on real-time scenes. The pause button shows why time
 * stopped (auto-pause reason, pending decision, an open overlay).
 */
import type { ReactElement } from 'react';
import { useGame } from '../app/gameStore';
import { useT } from '../i18n/index';
import { IconButton, type IconName } from '../ui/index';
import { TIME_SPEEDS, type TimeSpeed } from '../app/clock';

const SPEED_ICON: Readonly<Record<TimeSpeed, IconName>> = { 1: 'play', 2: 'fast', 4: 'faster' };
const SPEED_ACTION: Readonly<Record<TimeSpeed, string>> = { 1: 'time.speed1', 2: 'time.speed2', 4: 'time.speed4' };

export interface TimeControlsProps {
  /** Locale key explaining a soft pause (overlay open, decision pending), if any. */
  blockedKey?: string | null;
}

/** Pause and speed buttons. */
export function TimeControls({ blockedKey = null }: TimeControlsProps): ReactElement {
  const t = useT();
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const reason = useGame((s) => s.pauseReason);
  const setSpeed = useGame((s) => s.setSpeed);
  const togglePause = useGame((s) => s.togglePause);
  const stopped = paused || blockedKey !== null;
  const why = blockedKey ?? reason;
  return (
    <div className={['time-controls', stopped && 'is-stopped'].filter(Boolean).join(' ')} role="group" aria-label={t('ui.time.controls')} data-testid="time-controls">
      <IconButton
        icon={paused ? 'play' : 'pause'}
        label={paused ? t('ui.time.resume') : t('ui.time.pause')}
        hint={why ? t(why) : undefined}
        keyHint="time.togglePause"
        pressed={paused}
        onClick={togglePause}
        size="sm"
        data-testid="time-pause"
      />
      {TIME_SPEEDS.map((s) => (
        <IconButton
          key={s}
          icon={SPEED_ICON[s]}
          label={t('ui.time.speed', { speed: s })}
          hint={t('ui.time.speedHint', { seconds: Math.round(4 / s) })}
          keyHint={SPEED_ACTION[s]}
          pressed={!paused && speed === s}
          onClick={() => setSpeed(s)}
          size="sm"
          data-testid={`time-speed-${s}`}
        />
      ))}
      <span className="time-status" aria-live="polite">
        {stopped ? t('ui.time.paused') : t('ui.time.running', { speed })}
      </span>
    </div>
  );
}
