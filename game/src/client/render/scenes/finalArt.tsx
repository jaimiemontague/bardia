/**
 * Final paintings by asset id. Each scene registers asset ids in the manifest (encounters.scene.*,
 * settlements.scene.*); while no final file exists the procedural picture is drawn, and once the owner drops
 * a painting at the manifest path (see ASSET_DROP_IN.md) it replaces the picture with no code change.
 *
 * Seasons: a painting may have its own version for a season, saved next to it with the season's name added to
 * the file name (`hub/panorama-home-skarn.jpg` → `hub/panorama-home-skarn-winter.jpg`; seasons are spring,
 * summer, autumn and winter). In that season the game shows the season's own painting; in the others, the base
 * file. A season's painting is a new painting, not a recolour: things in it can sit a little apart from where
 * they are in the base file, so anything placed over a painting (village labels, people in a room) reads
 * `variant` and keeps a table per painting, falling back to the base file's table.
 */
import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';
import type { SeasonId } from '@content/schemas/ids';
import { season as seasonOfHour } from '@sim/core/time';
import { useGameState } from '../../app/gameStore';
import { ensureFinalIndex, finalFileUrl, findFinalFile, getAssetSettings, manifestEntry, useAssetsVersion } from '../../assets/index';

/** Which painting is on screen: the base file, or a season's own painting. */
export type PaintingVariant = 'base' | SeasonId;

/** The final painting shown for an asset id. */
export interface FinalPaintingInfo {
  url: string;
  variant: PaintingVariant;
}

/** The file of a season's own painting for a manifest path (`a/b.jpg` → `a/b-winter.jpg`). */
export function seasonalPath(path: string, season: SeasonId): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? `${path.slice(0, dot)}-${season}${path.slice(dot)}` : `${path}-${season}`;
}

/**
 * The final painting for an asset id in a season (not a hook: tests and non-React callers). `season` null or
 * undefined: the base file only. Null while only the placeholder exists.
 */
export function finalPaintingFor(id: string, season: SeasonId | null | undefined): FinalPaintingInfo | null {
  if (getAssetSettings().forcePlaceholders) return null;
  const entry = manifestEntry(id);
  if (!entry || entry.kind !== 'image') return null;
  const base = findFinalFile(entry.path, 'image');
  if (!base) return null;
  if (season) {
    const own = findFinalFile(seasonalPath(entry.path, season), 'image');
    if (own) return { url: finalFileUrl(own.path, own.info), variant: season };
  }
  return { url: finalFileUrl(base.path, base.info), variant: 'base' };
}

/** The season of the running game (null on the menus, with no game). */
export function useGameSeason(): SeasonId | null {
  return useGameState((s) => seasonOfHour(s.time.hour), null);
}

/**
 * The final painting for `id`, with the variant shown. `season`: undefined follows the running game's season,
 * a season picks that season's painting when there is one, null always shows the base file.
 */
export function useFinalPaintingInfo(id: string, season?: SeasonId | null): FinalPaintingInfo | null {
  useAssetsVersion();
  useEffect(ensureFinalIndex, []);
  const gameSeason = useGameSeason();
  return finalPaintingFor(id, season === undefined ? gameSeason : season);
}

/** The URL of the final painting for an asset id, or null while only the placeholder exists. */
export function useFinalPainting(id: string, season?: SeasonId | null): string | null {
  return useFinalPaintingInfo(id, season)?.url ?? null;
}

/**
 * Shows the final painting for `assetId` when there is one, else the procedural picture. `season` as in
 * useFinalPaintingInfo. The wrapper says which painting is shown: `data-final` yes/no, `data-variant`.
 */
export function Painting({ assetId, season, children }: { assetId: string; season?: SeasonId | null; children: ReactNode }): ReactElement {
  const info = useFinalPaintingInfo(assetId, season);
  return (
    <div className="scn-picture" data-asset-id={assetId} data-final={info ? 'yes' : 'no'} data-variant={info?.variant ?? ''}>
      {info ? <img className="scn-final" src={info.url} alt="" draggable={false} /> : children}
    </div>
  );
}
