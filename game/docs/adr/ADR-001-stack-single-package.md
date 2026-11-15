# ADR-001: TypeScript stack in a single npm package with enforced folder boundaries

- **Status:** Accepted (owner decision, 2026-10-31)
- **Design document:** `Bardia_Design_and_Build_Plan.md` v0.2: §29.1, §29.2, §29.11, §29.14
- **Supersedes:** the v0.1 plan of a pnpm workspace monorepo (`packages/sim`, `packages/content`, `packages/client`, …)
- **Amended:** 2026-10-31 by the integration review (boundary rules, three typecheck programs, scripts, dev
  dependencies — see the "Amendment" section and ADR-006)

## Context

Design v0.1 proposed a pnpm monorepo with one package per layer. The build machine has Node 24 and npm 11 but no
pnpm, and about fifteen agents will work in parallel. Separate packages would add workspace tooling, per-package
tsconfig/build steps and cross-package version pinning, without adding protection that a boundary test cannot give.

## Decision

1. **One npm package** at `game/` (`"type": "module"`, private, exact pinned versions, `package-lock.json`).
2. **Stack:** TypeScript (strict, `noUncheckedIndexedAccess`) · React 18 · PixiJS 8 · Vite · Vitest + fast-check ·
   Zod 3 · Immer · Zustand · Howler · fflate · intl-messageformat · Playwright (installed Chrome, `channel: 'chrome'`) ·
   tsx for Node tools · Electron later.
3. **Layers are folders, not packages:** `src/sim` (pure simulation), `src/content` (data + zod schemas),
   `src/client` (React/Pixi), `tools/` (tsx scripts), `tests/e2e`.
4. **Path aliases** `@sim/*`, `@content/*`, `@client/*`, identical in `tsconfig.json`, `vite.config.ts` and (through
   `mergeConfig`) `vitest.config.ts`. `moduleResolution: "bundler"`, JSON imported directly (works in Vite, Vitest and tsx).
5. **Boundaries are enforced mechanically**, not by convention:
   - `src/sim/boundary.test.ts` fails if `src/sim` or `src/content` or `tools/` import the client, if `src/content`
     imports `src/sim`, or if sim code uses `Math.random`, `Date.now`, `new Date(`, timers, `performance.now`,
     `window.` or `document.`;
   - `tsconfig.sim.json` re-typechecks `src/sim` + `src/content` with `lib: ["ES2023"]` and no `types`, so DOM or Node
     globals are compile errors there. `npm run typecheck` runs both passes.
6. **Scripts:** `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `typecheck`, `test`, `test:watch`, `e2e`,
   `sim` (`tsx tools/sim-cli.ts`).

## Consequences

- One `npm install`, one lockfile, one tsconfig family; agents run the same four verification commands.
- A layering mistake is a failing test or type error rather than a review comment.
- No per-layer publishing or independent versioning (not needed for a single game).
- Desktop packaging (Electron) is added later as `electron/` inside the same package.
## Amendment (integration review, 2026-10-31)

- **Boundary test** now also covers: the sim package allow-list (`zod`, `immer`, `fflate`); runtime imports across
  module folders (only `import type`); the kernel importing modules/registry/session/test helpers; any `Date`, more
  timers and globals; engine-dependent `Math` functions outside `core/dmath.ts`; `Map`/`Set` in module folders;
  `src/content` importing anything but zod; augmentation files that are scripts. `BARDIA_BOUNDARY_SCOPE` scopes it.
- **Three TypeScript programs** (`tsconfig.base.json` holds the options): `tsconfig.app.json` (client + sim + content,
  no tests — used by `build`), `tsconfig.json` (sim + content + tools + tests + configs, no client — so test-only
  augmentations never reach the client) and `tsconfig.sim.json` (no DOM/Node types). `typecheck` runs all three.
- **Scripts:** `build` = `tsc --noEmit -p tsconfig.app.json && vite build`; added `tool` (generic dispatcher for
  `tools/<name>/index.ts`), `verify:module` (per-module gate) and `perf` (§29.8 budget check).
- **Dependencies:** `fast-xml-parser` 5.11.2 (dev, for the map pipeline). Not added: `yaml` (storylets are JSON) and
  ESLint/typescript-eslint (typescript-eslint 8.72 supports TypeScript < 6.1; TypeScript 7 has no JS compiler API).
  Only the integrator edits `package.json` and the lockfile.

- Pinned versions at M0: typescript 7.0.2, vite 8.3.5, @vitejs/plugin-react 6.1.2, react/react-dom 18.3.1,
  pixi.js 8.22.0, zod 3.25.76, immer 11.2.9, zustand 5.0.16, howler 2.2.4, fflate 0.8.3, intl-messageformat 12.1.4,
  vitest + @vitest/coverage-v8 5.0.5, fast-check 4.10.2, @playwright/test 1.64.1, tsx 4.23.15, @types/node 24.19.2.
  Upgrades are deliberate commits that keep all verification commands green.
