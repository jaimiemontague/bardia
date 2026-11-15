# ADR-006: Conventions that keep ~15 parallel module agents out of each other's way

- **Status:** Accepted (2026-10-31, integration review of the foundation)
- **Design document:** `Bardia_Design_and_Build_Plan.md` v0.2: §19.1, §29.2–§29.8, §30.7, §33.3
- **Related:** ADR-001 (single package), ADR-005 (module augmentation)

## Context

ADR-005 removed collisions on the kernel's type registries, but independent reviews found the remaining shared choke
points of the parallel phase: every agent would have edited `balance.json` (strict schema), a single locale file and a
single asset manifest; nobody owned most §19.1 effect ops, commands, pending kinds or events; modules could not observe
each other's events without importing each other; the test helpers loaded every module (one broken module failed every
agent's tests); the RNG API cost ~2 µs per draw through Immer drafts; and events could hold revoked Immer drafts.

## Decision

1. **Ownership is data.** `src/sim/core/ownership.ts` maps every design effect op, command, pending kind (raiser and
   resolver), event, condition function and root state slice to one module. `src/sim/ownership.test.ts` fails when a
   listed item is registered by another module; `BARDIA_STRICT_OWNERSHIP=1` additionally requires every listed item to
   be registered (integrator gate at the end of the phase). Each module stub's header repeats its ownership.
2. **Per-area files, pre-registered.** Every module (and `core` and the client areas) owns
   `data/tunables/<id>.json` + `schemas/tunables/<id>.ts` (read as `ctx.tunables.<id>`), `locales/en/<area>.json`
   (keys prefixed `<area>.`) and `assets/manifest/<area>.json` (ids prefixed `<area>.`). Aggregators import them
   explicitly (works in Vite, Vitest and tsx); a content test fails on unregistered files and prefix violations.
   `balance.json` keeps the §31 tables and is frozen during the phase.
3. **Reactions.** `SimModule.reactions` subscribes to any event; the kernel drains reactions after each handler,
   system, init/migrate and at the end of every operation, in module order, with a depth cap of 8 generations.
4. **One operation = one context.** `runOperation` wraps dispatch, advance, new game, load and `inDraft`; at its end
   it drains reactions, writes `ctx.rng(stream)` caches back to `state.rng` once, and snapshots events so none holds a
   draft. `ctx.rng` is the RNG API for module code; mixing it with the functional API on one stream throws.
5. **Effects and conditions are validated per module.** `effectSchemas` (zod per op; core ops included) power
   `validateEffects(env, effects)` for content packs and `applyEffect`; `conditionFns` let each module contribute
   condition-language functions over its own data. `StoryletDef`/`RelicDef` (`core/defs.ts`) are the shared contracts;
   storylets, relics and quests are JSON.
6. **Isolation for verification.** `src/sim/testing.ts` imports only the kernel; `GameSession` in `session.ts` takes
   modules explicitly and the registry-bound subclass lives in `game.ts` (exported from `@sim/index`). `npm run
   verify:module -- <id>` typechecks kernel + content + one module folder, runs its tests and the boundary rules scoped
   to it. A broken module can set `enabled: false`; tools accept `--modules`/`BARDIA_MODULES`.
7. **Performance guardrails.** `npm run perf` checks the §29.8 budget on a 1,500-character / 150-fleet world and
   reports a reference load that follows the hot-path guidance (`ctx.rng`, `baseState` scans, minimal hourly work).

## Consequences

- An agent touches only its folder and its own per-area files; shared files change only through the integrator.
- A cross-module feature is built by emitting an owned event and reacting to it, or by applying the owner's effect —
  never by importing another module's runtime code (the boundary test enforces this).
- Factories draw from the calling module's own streams, so modules do not perturb each other's generated names; ids
  still come from one global counter, so only the integrator keeps golden hashes.
- Adding a content area, an ownership entry or a dependency is a small integrator change.
