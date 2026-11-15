/**
 * Frames and panels: the carved-oak containers every screen is built from.
 *   Frame — a heavy oak board with black-iron corner brackets and a carved title plate
 *   Panel — a sunken section inside a frame (lists, stats, forms)
 */
import type { CSSProperties, ElementType, ReactElement, ReactNode } from 'react';

export type FrameVariant = 'oak' | 'iron' | 'vellum';

export interface FrameProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Header controls on the right (close button, tabs, …). */
  actions?: ReactNode;
  footer?: ReactNode;
  variant?: FrameVariant;
  /** Draws the knotwork band under the title. */
  ornate?: boolean;
  /**
   * 'screen': a large menu screen that uses most of the viewport (ARCHITECTURE §20 rule 4): up to
   * --screen-w wide and --screen-h tall, the body scrolls. Default 'auto' (sized by its content).
   */
  size?: 'auto' | 'screen';
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  /** id of the title element (for aria-labelledby). */
  titleId?: string;
  children?: ReactNode;
  'data-testid'?: string;
}

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }): ReactElement {
  return (
    <svg className={`frame-corner frame-corner-${pos}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M2 38V8a6 6 0 016-6h30v9H14a3 3 0 00-3 3v24z" className="frame-corner-iron" />
      <circle cx="7" cy="7" r="2.3" className="frame-rivet" />
      <circle cx="28" cy="6.5" r="1.7" className="frame-rivet" />
      <circle cx="6.5" cy="28" r="1.7" className="frame-rivet" />
    </svg>
  );
}

/** A carved frame with iron corners and an optional title plate. */
export function Frame({ title, subtitle, actions, footer, variant = 'oak', ornate = false, size = 'auto', className, style, as, titleId, children, ...rest }: FrameProps): ReactElement {
  const Tag = (as ?? 'section') as ElementType;
  return (
    <Tag className={['frame', `frame-${variant}`, size === 'screen' && 'frame-screen', className].filter(Boolean).join(' ')} style={style} data-testid={rest['data-testid']}>
      <Corner pos="tl" />
      <Corner pos="tr" />
      <Corner pos="bl" />
      <Corner pos="br" />
      {(title || actions) && (
        <header className="frame-header">
          <div className="frame-titles">
            {title && (
              <h2 className="frame-title" id={titleId}>
                {title}
              </h2>
            )}
            {subtitle && <div className="frame-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="frame-actions">{actions}</div>}
        </header>
      )}
      {ornate && <div className="frame-knot" aria-hidden="true" />}
      <div className="frame-body">{children}</div>
      {footer && <footer className="frame-footer">{footer}</footer>}
    </Tag>
  );
}

export interface PanelProps {
  title?: ReactNode;
  /** Small controls next to the title. */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Flat panels have no sunken background. */
  flat?: boolean;
  as?: ElementType;
  'aria-label'?: string;
}

/** A sunken section inside a frame. */
export function Panel({ title, actions, className, style, children, flat = false, as, ...rest }: PanelProps): ReactElement {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={['panel', flat && 'panel-flat', className].filter(Boolean).join(' ')} style={style} aria-label={rest['aria-label']}>
      {(title || actions) && (
        <div className="panel-header">
          {title && <h3 className="panel-title">{title}</h3>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

/** A thin carved divider with a centred ornament. */
export function Divider({ label }: { label?: ReactNode }): ReactElement {
  return (
    <div className="divider" role="separator">
      {label && <span className="divider-label">{label}</span>}
    </div>
  );
}
