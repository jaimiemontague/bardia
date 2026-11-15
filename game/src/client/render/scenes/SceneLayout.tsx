/**
 * The frame of a scene: the painting fills the screen; a scrim on the left carries a short kicker, the
 * title, at most two sentences, one line of facts and the choices. The picture's subject is painted on the
 * right two thirds so the text never hides it.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import './scenes.css';

export interface SceneLayoutProps {
  picture: ReactNode;
  kicker?: string;
  title: string;
  text?: string;
  facts?: string;
  children?: ReactNode;
  testId?: string;
  className?: string;
  /** Data attributes for tests and styling (kind, stage, tier …). */
  data?: Readonly<Record<string, string>>;
}

/** Keeps at most `n` sentences of a text (the scene's body never runs longer than two). */
export function firstSentences(text: string, n = 2): string {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*/g);
  if (!parts || parts.length <= n) return text.trim();
  return parts.slice(0, n).join('').trim();
}

/** The scene frame (see the file header). */
export function SceneLayout({ picture, kicker, title, text, facts, children, testId, className, data }: SceneLayoutProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // Focus lands on the scene (not on a choice), so Tab reaches the choices and no held key can press one.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) attrs[`data-${k}`] = v;
  return (
    <div ref={root} tabIndex={-1} className={`scn-root${className ? ` ${className}` : ''}`} data-testid={testId} {...attrs}>
      {picture}
      <div className="scn-scrim" aria-hidden="true" />
      <section className="scn-panel" aria-labelledby={testId ? `${testId}-title` : undefined}>
        {kicker && <p className="scn-kicker">{kicker}</p>}
        <h1 className="scn-title" id={testId ? `${testId}-title` : undefined}>
          {title}
        </h1>
        {text && <p className="scn-text">{text}</p>}
        {facts && <p className="scn-facts">{facts}</p>}
        {children}
      </section>
    </div>
  );
}
