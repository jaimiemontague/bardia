/**
 * The frame of the battle and voyage cards (ARCHITECTURE §20.7): Before the Battle, the field won or lost, the
 * same three at sea, the homecoming and the lost expedition. A painting fills the screen (the asset id's final
 * painting, else its manifest placeholder), a scrim darkens the left third, and the panel there carries a
 * kicker, the title, at most two sentences, one line of facts and the choices. The panel scrolls only when the
 * player opens its Details.
 *
 * Built on the scene kit's classes (scn-*) like SceneLayout, with two additions it needs: a title that carries
 * a test id and data (the outcome), and the panel's own class for the card's blocks.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { SeasonId } from '@content/schemas/ids';
import { AssetImage } from '../../assets/index';
import { Painting, SceneStage } from '../../render/scenes/index';
import './cardScene.css';

export interface CardSceneProps {
  /** The painting (manifest id). */
  assetId: string;
  /** undefined follows the game's season, null forces the base painting. */
  season?: SeasonId | null;
  testId: string;
  className?: string;
  /** Data attributes on the root (outcome, kind …). */
  data?: Readonly<Record<string, string>>;
  kicker?: ReactNode;
  title: ReactNode;
  titleTestId?: string;
  titleData?: Readonly<Record<string, string>>;
  text?: ReactNode;
  facts?: ReactNode;
  children?: ReactNode;
  /** Opens with the scene kit's entering animation (default true). */
  enter?: boolean;
}

function dataAttrs(data: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) out[`data-${k}`] = v;
  return out;
}

/** The painting of an asset id: the final file, else the manifest's placeholder picture. */
export function CardPainting({ assetId, season }: { assetId: string; season?: SeasonId | null }): ReactElement {
  return (
    <Painting assetId={assetId} {...(season !== undefined ? { season } : {})}>
      <AssetImage id={assetId} className="scn-final" />
    </Painting>
  );
}

/** The card scene (see the file header). */
export function CardScene({ assetId, season, testId, className, data, kicker, title, titleTestId, titleData, text, facts, children, enter = true }: CardSceneProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // Focus lands on the scene, so Tab reaches the choices and no held key presses one.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  const body = (
    <div ref={root} tabIndex={-1} className={`scn-root bc-root${className ? ` ${className}` : ''}`} data-testid={testId} data-asset={assetId} {...dataAttrs(data)}>
      <CardPainting assetId={assetId} {...(season !== undefined ? { season } : {})} />
      <div className="scn-scrim bc-scrim" aria-hidden="true" />
      <section className="scn-panel bc-panel" aria-labelledby={`${testId}-title`}>
        {kicker && <p className="scn-kicker">{kicker}</p>}
        <h1 className="scn-title" id={`${testId}-title`} data-testid={titleTestId} {...dataAttrs(titleData)}>
          {title}
        </h1>
        {text && <p className="scn-text">{text}</p>}
        {facts && <p className="scn-facts">{facts}</p>}
        {children}
      </section>
    </div>
  );
  return enter ? <SceneStage cue={null}>{body}</SceneStage> : body;
}
