/**
 * The way an interruption arrives (ARCHITECTURE §20.7): first an attention cue over the map (a horn, and a
 * banner of a few words: "A sail to the north!"), then the whole screen opens onto the painted scene.
 *
 *   <SceneStage cue={{ text: t('encounters.cue.raiders'), sound: 'hostile', glyph: 'sail' }}>
 *     …the scene (only mounted once the cue is over, so its buttons cannot be pressed early)…
 *   </SceneStage>
 *
 * The cue lasts CUE_MS (a still banner for CUE_STILL_MS under reduced motion); a click or a fresh key press
 * skips it. Keys held from before (auto-repeat) are swallowed, so a key held for steering never skips the
 * cue or answers the scene.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { playSfx } from '../../audio/index';

export const CUE_MS = 1600;
export const CUE_STILL_MS = 1200;

export type CueSound = 'hostile' | 'peaceful' | 'arrival' | 'none';
export type CueGlyph = 'sail' | 'shore' | 'spears';

export interface CueSpec {
  /** The banner's words (already localised). */
  text: string;
  /** A smaller line under it (optional, localised). */
  sub?: string;
  sound: CueSound;
  glyph: CueGlyph;
  /** Tints the banner: red for danger. */
  tone?: 'danger' | 'calm';
}

function reducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.dataset['motion'] === 'reduced') return true;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset['motion'] !== 'full';
  } catch {
    return false;
  }
}

function playCue(sound: CueSound): void {
  if (sound === 'none') return;
  try {
    if (sound === 'hostile') playSfx('battle.warHorn', { call: 'charge' });
    else if (sound === 'peaceful') playSfx('battle.warHorn', { call: 'muster' });
    else {
      playSfx('battle.warHorn', { call: 'retreat' });
      playSfx('sea.sailFlap', { strength: 0.6 });
    }
  } catch {
    /* audio is optional (tests, locked audio contexts) */
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/**
 * Fresh key presses while a scene is up. `onKey` returns true when it used the key. Auto-repeated presses of
 * keys that would press a focused button (Enter, Space, digits) are swallowed.
 */
export function useFreshKeys(onKey: (e: KeyboardEvent) => boolean, active = true): void {
  const ref = useRef(onKey);
  ref.current = onKey;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.repeat) {
        if (e.key === 'Enter' || e.key === ' ' || /^[0-9]$/.test(e.key)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (ref.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);
}

function Glyph({ glyph }: { glyph: CueGlyph }): ReactElement {
  if (glyph === 'shore')
    return (
      <svg viewBox="0 0 64 40" className="scn-cue-glyph" aria-hidden="true">
        <path d="M2 30 C 14 22, 22 24, 30 18 L36 8 L42 18 C 50 22, 56 22, 62 26 L62 32 L2 32 Z" fill="currentColor" opacity="0.9" />
        <path d="M10 36 q 6 -3 12 0 t 12 0 t 12 0 t 12 0" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  if (glyph === 'spears')
    return (
      <svg viewBox="0 0 64 40" className="scn-cue-glyph" aria-hidden="true">
        {[14, 26, 38, 50].map((x) => (
          <g key={x}>
            <line x1={x} y1="38" x2={x + 4} y2="6" stroke="currentColor" strokeWidth="2.5" />
            <path d={`M${x + 4} 2 l -3 8 l 6 0 Z`} fill="currentColor" />
          </g>
        ))}
      </svg>
    );
  return (
    <svg viewBox="0 0 64 40" className="scn-cue-glyph" aria-hidden="true">
      <path d="M8 30 Q 32 38 56 30 L52 34 Q 32 40 12 34 Z" fill="currentColor" />
      <line x1="32" y1="30" x2="32" y2="2" stroke="currentColor" strokeWidth="2" />
      <path d="M18 6 L46 6 L48 26 Q 32 30 16 26 Z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

/** Hosts a scene behind its attention cue (see the file header). */
export function SceneStage({ cue: cueProp, children, className }: { cue: CueSpec | null; children: ReactNode; className?: string }): ReactElement {
  // The cue is fixed when the scene arrives: later state updates never restart it.
  const [cue] = useState(cueProp);
  const [phase, setPhase] = useState<'cue' | 'scene'>(cue ? 'cue' : 'scene');
  const [still] = useState(reducedMotion);
  const played = useRef(false);
  const skip = useCallback(() => setPhase('scene'), []);
  useEffect(() => {
    if (phase !== 'cue' || !cue) return;
    if (!played.current) {
      played.current = true;
      playCue(cue.sound);
    }
    const timer = setTimeout(skip, still ? CUE_STILL_MS : CUE_MS);
    return () => clearTimeout(timer);
  }, [phase, cue, still, skip]);
  useFreshKeys((e) => {
    // The developer console's key and bare modifiers pass through untouched.
    if (e.code === 'Backquote' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return false;
    skip();
    return true;
  }, phase === 'cue');
  if (phase === 'cue' && cue) {
    return (
      <div className={`scn-cue scn-cue-phase${cue.tone === 'danger' ? ' is-danger' : ''}${still ? ' is-still' : ''}`} data-testid="scene-cue" role="alert" onClick={skip}>
        <div className="scn-cue-band">
          <Glyph glyph={cue.glyph} />
          <div className="scn-cue-words">
            <p className="scn-cue-text">{cue.text}</p>
            {cue.sub && <p className="scn-cue-sub">{cue.sub}</p>}
          </div>
        </div>
      </div>
    );
  }
  return <div className={`scn-stage${still ? '' : ' scn-enter'}${className ? ` ${className}` : ''}`}>{children}</div>;
}
