/**
 * Standalone gallery entry (dev only): `npm run dev`, then open
 * http://localhost:5173/src/client/screens/assetGallery/standalone.html — the gallery without the
 * app shell, so art can be reviewed even while other screens are mid-work.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AssetGallery } from './AssetGallery';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <AssetGallery />
  </StrictMode>,
);
