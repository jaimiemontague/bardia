/**
 * Self-hosted web fonts (@fontsource; bundled by Vite, no network fetch at runtime):
 *   Cinzel                — display (titles, carved plates, numerals on the top bar)
 *   EB Garamond           — body text (narration, cards, tooltips)
 *   Atkinson Hyperlegible — accessibility option (§25.7), replaces both when chosen
 * Only the Latin subsets and the weights the theme uses are loaded.
 */
import '@fontsource/cinzel/latin-400.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';

/** Font stacks (mirrored by the CSS variables in theme.css). */
export const FONT_STACKS = {
  display: "'Cinzel', 'Trajan Pro', Georgia, serif",
  body: "'EB Garamond', Garamond, Georgia, serif",
  legible: "'Atkinson Hyperlegible', Verdana, 'Segoe UI', sans-serif",
} as const;
