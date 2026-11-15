/**
 * Content areas: every simulation module (plus 'core') and every client area owns ONE file in each
 * per-area content folder, named after the area:
 *
 *   src/content/data/tunables/<moduleId>.json   + src/content/schemas/tunables/<moduleId>.ts
 *   src/content/locales/en/<area>.json           keys start with '<area>.'
 *   src/content/assets/manifest/<area>.json      asset ids start with '<area>.'
 *
 * The files are pre-created and pre-registered (like the module registry), so parallel agents only
 * ever edit their own files. A new area is an integrator change (add it here, create its files and
 * register them in the aggregators); src/content/content.test.ts fails on unregistered files.
 */

/** Simulation module ids (must equal the registry in src/sim/modules.ts; checked by a sim test). */
export const MODULE_AREAS = ["world","weather","encounters","expeditions","settlements","news","ai","diplomacy","economy","holdings","military","people","faith","intel","quests","narrative","saga","battle","duel","seabattle"] as const;
export type ModuleArea = (typeof MODULE_AREAS)[number];

/** Client areas (React/Pixi screens and shared UI). */
export const CLIENT_AREAS = ["ui","menu","hub","map","battleView","duelView","seaView","codex","portraits","music"] as const;
export type ClientArea = (typeof CLIENT_AREAS)[number];

/** Every content area: 'core', the modules, then the client areas. */
export const CONTENT_AREAS = ['core', ...MODULE_AREAS, ...CLIENT_AREAS] as const;
export type ContentArea = (typeof CONTENT_AREAS)[number];
