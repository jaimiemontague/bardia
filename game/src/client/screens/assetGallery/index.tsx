/**
 * Asset gallery screen (dev): route 'assetGallery', fullscreen. Reachable by
 *   - `navigation.open('assetGallery')` / `navigation.showMenu('assetGallery')`,
 *   - the URL query `?gallery` (opens it at boot; `&galleryTab=icons` picks a tab),
 *   - the dev console: `__bardiaOpenAssetGallery()` (dev builds),
 *   - or standalone at /src/client/screens/assetGallery/standalone.html in `npm run dev`.
 */
import type { ReactElement } from 'react';
import type { ScreenDescriptor, ScreenProps } from '@client/app/screenTypes';
import { navigation } from '@client/app/navigation';
import { useGame } from '@client/app/gameStore';
import { AssetGallery } from './AssetGallery';

function AssetGalleryScreen(props: ScreenProps): ReactElement {
  // As a menu page (no game loaded) closing returns to the main menu; over a game it pops the route.
  const close = (): void => {
    if (useGame.getState().session) props.close();
    else navigation.showMenu('mainMenu');
  };
  return <AssetGallery close={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'assetGallery',
  route: 'assetGallery',
  layout: 'fullscreen',
  titleKey: 'portraits.gallery.title',
  component: AssetGalleryScreen,
};

/** Opens the gallery: as the menu page when no game is loaded, else over the scene. */
export function openAssetGallery(): void {
  if (useGame.getState().session) navigation.open('assetGallery');
  else navigation.showMenu('assetGallery');
}

// Deep link (?gallery) and dev-console hook. Deferred so the shell's stores are initialised first.
if (typeof window !== 'undefined') {
  try {
    if (import.meta.env.DEV) (window as unknown as { __bardiaOpenAssetGallery?: () => void }).__bardiaOpenAssetGallery = openAssetGallery;
    if (new URLSearchParams(window.location.search).has('gallery')) setTimeout(openAssetGallery, 0);
  } catch {
    /* non-browser environment */
  }
}
