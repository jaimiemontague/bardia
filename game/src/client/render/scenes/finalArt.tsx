/**
 * Final paintings by asset id. Each scene registers asset ids in the manifest (encounters.scene.*,
 * settlements.scene.*); while no final file exists the procedural picture is drawn, and once the owner drops
 * a painting at the manifest path (see ASSET_DROP_IN.md) it replaces the picture with no code change.
 */
import type { ReactElement, ReactNode } from 'react';
import { ensureFinalIndex, finalFileUrl, findFinalFile, getAssetSettings, manifestEntry, useAssetsVersion } from '../../assets/index';
import { useEffect } from 'react';

/** The URL of the final painting for an asset id, or null while only the placeholder exists. */
export function useFinalPainting(id: string): string | null {
  useAssetsVersion();
  useEffect(ensureFinalIndex, []);
  if (getAssetSettings().forcePlaceholders) return null;
  const entry = manifestEntry(id);
  if (!entry || entry.kind !== 'image') return null;
  const found = findFinalFile(entry.path, 'image');
  return found ? finalFileUrl(found.path, found.info) : null;
}

/** Shows the final painting for `assetId` when there is one, else the procedural picture. */
export function Painting({ assetId, children }: { assetId: string; children: ReactNode }): ReactElement {
  const url = useFinalPainting(assetId);
  return (
    <div className="scn-picture" data-asset-id={assetId} data-final={url ? 'yes' : 'no'}>
      {url ? <img className="scn-final" src={url} alt="" draggable={false} /> : children}
    </div>
  );
}
