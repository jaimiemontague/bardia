/**
 * The home village as its final painting: the picture fills the village box (it is exactly the viewBox, so it is
 * never cropped and the labels cannot drift), and a transparent SVG over it holds each building's click area,
 * the ships on the strand and the ice on the water, all placed by the painting's own table (paintedLayouts.ts).
 * The same structure as the procedural village (`data-building-id`, `.hv-hit`, `hub-ships`), so tests and
 * styles read both. Buildings at tier 0 are painted anyway; their label says they are not built.
 */
import { memo, type ReactElement } from 'react';
import type { PaintingVariant } from '../../render/scenes/finalArt';
import { useT } from '../../i18n/index';
import type { PaintedLayout } from './paintedLayouts';
import type { VillageModel } from './VillageScene';
import { VIEW_H, VIEW_W, VILLAGE, type HallBuildingId } from './village';

export interface PaintedVillageProps {
  url: string;
  variant: PaintingVariant;
  culture: string;
  layout: PaintedLayout;
  model: VillageModel;
  /** CSS filter grading the painting (a season it has no painting of its own for), or undefined. */
  grade: string | undefined;
  /** The building whose label is hovered: its painted building lights up. */
  hot: HallBuildingId | null;
  onOpen(id: HallBuildingId): void;
  onShips(): void;
}

export const PaintedVillage = memo(function PaintedVillage({ url, variant, culture, layout, model, grade, hot, onOpen, onShips }: PaintedVillageProps): ReactElement {
  const t = useT();
  const [sx0, sy0, sx1, sy1] = layout.ships;
  // A season's winter painting already shows its ice; any other painting gets a light sheet of ice on the water.
  const iceDrawn = model.iced && variant !== 'winter';
  return (
    <>
      <img className="hub-painting" src={url} alt="" draggable={false} style={grade ? { filter: grade } : undefined} />
      <svg
        className="hv-painted"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        data-testid="hub-village"
        data-final="yes"
        data-variant={variant}
        data-culture={culture}
      >
        <defs>
          <linearGradient id="hv-ice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e6eef2" stopOpacity="0.1" />
            <stop offset="0.08" stopColor="#e6eef2" stopOpacity="0.5" />
            <stop offset="0.45" stopColor="#d2e0e8" stopOpacity="0.36" />
            <stop offset="1" stopColor="#c4d4de" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        {model.iced && (
          <g data-testid="hub-ice" data-painted={iceDrawn ? 'no' : 'yes'} pointerEvents="none">
            {iceDrawn && <rect x={0} y={layout.water} width={VIEW_W} height={VIEW_H - layout.water} fill="url(#hv-ice)" />}
          </g>
        )}
        {VILLAGE.map((spot) => {
          const [x0, y0, x1, y1] = layout.buildings[spot.id].box;
          return (
            <g
              key={spot.id}
              className={`hv-building${hot === spot.id ? ' is-hot' : ''}`}
              data-building-id={spot.id}
              data-tier={model.tiers[spot.id]}
              onClick={() => onOpen(spot.id)}
            >
              <rect className="hv-hit" x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={18} />
            </g>
          );
        })}
        <g className="hv-building" data-testid="hub-ships" data-count={model.ships.length} onClick={onShips}>
          <title>{t('hub.ships.strand', { count: model.ships.length })}</title>
          <rect className="hv-hit" x={sx0} y={sy0} width={sx1 - sx0} height={sy1 - sy0} rx={18} />
        </g>
      </svg>
    </>
  );
});
