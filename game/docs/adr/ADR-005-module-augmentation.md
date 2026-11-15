# ADR-005: Simulation modules extend the kernel by registration and TypeScript module augmentation

- **Status:** Accepted (2026-10-31)
- **Design document:** `Bardia_Design_and_Build_Plan.md` v0.2: §29.3, §30, §33.2
- **Related:** ADR-001 (single package, enforced boundaries), ADR-006 (parallel-phase conventions)

## Context

About fifteen agents implement simulation modules (world, weather, economy, diplomacy, …) **in parallel**. The §30
contract puts the whole game state, the command union and the event union in shared files. If every agent edited
`state.ts`, a central `Command` union or a central `switch` in `dispatch`, parallel work would collide constantly and
one agent could silently break another's types.

## Decision

1. **Registration, not editing.** Each module is a `SimModule` object (`id`, unique `order`, optional `version`,
   `init`, `migrate`, `handlers`, `commandSchemas`, `systems`, `effects`, `invariants`) exported as `module` from
   `src/sim/modules/<id>/index.ts`. The registry `src/sim/modules.ts` already lists every planned module id (stubs were
   created up front), so no agent edits it. The scheduler, dispatcher and effect router discover behaviour through the
   registry.
2. **Open type registries.** The kernel exports empty, augmentable interfaces and derives unions from them:
   - `CommandMap` → `Command = { [K in keyof CommandMap]: { type: K } & CommandMap[K] }[keyof CommandMap]`
   - `EventMap` → `SimEvent`; `EffectMap` (extends `CoreEffectMap`) → `Effect`;
   - `PendingPayloads` → `PendingDecision`; `IdPrefixMap` → typed `newId(prefix)`;
   - every entity (`GameState`, `Settlement`, `Character`, `Faction`, `Fleet`, …), `PlayerPolicies`, `GameOptions`
     and the pending payload interfaces are exported **interfaces** (never type aliases), so a module adds fields with
     `declare module '@sim/core/state' { interface Settlement { siege?: SiegeState } }`.
3. **Augmented fields are optional.** Core factories, older saves and other modules' tests do not know them; the owning
   module initialises them in `init` (new games) and `migrate` (old saves).
4. **Conflicts fail at startup.** `createSimEnv` throws `ModuleRegistryError` for duplicate module ids or orders, a
   command type handled by two modules (including core commands), an effect op implemented twice, or a command schema
   without a handler. Exactly one module owns each command type and effect op.
5. **Parallel-safe saves.** Core schema migrations stay a kernel-owned ordered list; each module versions its own
   state (`version` + `migrate`), tracked in `meta.moduleVersions`, and `GameSession.load` runs outdated modules'
   migrations.
6. **Proof.** `src/sim/core/augmentation.test.ts` adds a state field, a root slice, a command, an event, an effect op,
   a pending kind and an id prefix purely by augmentation, then checks the types (`expectTypeOf`) and runs them end to
   end through dispatch, the scheduler and the effect router.

## Consequences

- Module agents work only inside their folder; merges between modules touch disjoint files.
- Types stay global and precise: the client sees every command and event any module adds.
- Augmentations are program-wide, including test-only ones; tests prefix their names with `test`/`Test` and keep them
  optional. Since the integration review, test files are compiled in a program without the client
  (`tsconfig.json`) and the app program (`tsconfig.app.json`) has no tests, so test augmentations never reach client
  code.
- Open vocabularies (faction/site/role/battle kinds, fleet modes and intents, pacts, stances, intel fact keys, storylet
  scopes and triggers, entity-link kinds, character locations, game modes) are key-registry interfaces with
  `type X = keyof XRegistry`, so modules add members by augmentation too.
- A file that augments must itself be a module (a top-level import or `export {}`); otherwise `declare module`
  creates an ambient module that shadows the kernel file. The boundary test enforces this.
- Exhaustive `switch` statements over `Command`/`SimEvent` are discouraged in modules (other modules add members);
  handle your own types by key.
- Adding a brand-new module id later (beyond the pre-created set) is the only change that touches the registry, and it
  is a one-line kernel edit owned by the integrator.
