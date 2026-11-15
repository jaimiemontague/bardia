# Bardia — Architecture Guide

The engineering contract for everyone writing code in `game/`. Design reference: `../Bardia_Design_and_Build_Plan.md`
(§29–§31). ADRs: `docs/adr/` (ADR-001 stack, ADR-002 setting, ADR-003 battles, ADR-005 module augmentation, ADR-006
parallel-phase conventions).

## 1. Layers and folder ownership

| Folder | Owner | May import | Rules |
|---|---|---|---|
| `src/content/` | content agents / integrator | zod, relative paths | Data (`data/*.json`) + zod schemas. Never imports sim or client. |
| `src/content/data/tunables/<id>.json`, `schemas/tunables/<id>.ts`, `locales/en/<area>.json`, `assets/manifest/<area>.json` | **the module/area named by the file** | — | Per-area files, pre-created and pre-registered (§9). |
| `src/sim/core/`, `src/sim/save/`, `src/sim/session.ts`, `src/sim/game.ts`, `src/sim/modules.ts`, `src/sim/testing.ts`, `src/sim/index.ts` | **kernel (integrator)** | content | Pure TypeScript. **Module agents never edit these files.** |
| `src/sim/modules/<id>/` | one agent per module | core, content, other modules' *types* (`import type`) | Pure simulation. |
| `src/sim/battle/`, `duel/`, `seabattle/` | sub-sim agents | core, content, other modules' types | Fixed-step sims outside Immer. |
| `src/client/` | client agents | sim, content | React + Pixi. No game rules here. |
| `tools/<name>/index.ts` | tool agents | sim, content | Node scripts run with `npm run tool -- <name>`. Never the client. |
| `tests/e2e/` | e2e agent | — | Playwright, installed Chrome (`channel: 'chrome'`). |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vite/vitest/playwright` configs, `balance.json` | **integrator only** | — | Ask the integrator for a dependency, script, config or §31 balance change. |

Enforced by `src/sim/boundary.test.ts` and by three TypeScript programs (§16). The boundary test fails when sim code
imports the client or any package other than `zod`, `immer`, `fflate`; when a module folder imports **runtime** code
from another module folder (only `import type` may cross); when the kernel imports a module, the registry, the session
or the test helpers; on `Math.random`, any use of `Date`, timers (`setTimeout`, `setInterval`, `setImmediate`,
`queueMicrotask`, `requestAnimationFrame`), `performance.`, `window.`, `document.`, `globalThis`, `process.`,
`crypto`, `fetch(`, browser storage and `navigator.`; on engine-dependent `Math.exp/log/pow/sin/cos/tan/atan2/hypot/
cbrt/…` outside `core/dmath.ts`; on `new Map/Set/WeakMap/WeakSet` in module folders; when `src/content` imports
anything but zod/relative paths; and when a file containing `declare module '…'` has no top-level import/export (§4).

## 2. The golden rule

**Never edit a shared kernel file. Extend by augmentation and registration.** Every gameplay module id already has a
folder, a registry entry, a tunables file pair, a locale file and an asset-manifest fragment, so a module agent's whole
job happens inside `src/sim/modules/<id>/` plus its own per-area content files. If you believe the kernel needs a
change, say so in your report — do not make it. Who owns which effect op, command, pending kind, event, condition
function and state slice is fixed in `src/sim/core/ownership.ts` (§18); implement exactly what you own.

## 3. The module pattern

A module is a `SimModule` exported as `module` from `src/sim/modules/<id>/index.ts`:

```ts
import type { SimModule } from '@sim/core/module';
import './types'; // your augmentations (§4) — setTax, addMen and BattleEnded below are declared there
export const module: SimModule = {
  id: 'economy', order: 70, version: 1,
  init(draft, ctx) { /* new game — and a save made before this module existed (§12) */ },
  migrate(draft, fromVersion, ctx) { /* old save: upgrade this module's state */ },
  handlers: { setTax(draft, cmd, ctx) { /* … */ } },          // commands this module owns
  commandSchemas: { setTax: SetTaxSchema },                   // optional zod validation (§5)
  systems: { monthly(draft, ctx) { /* … */ } },               // hourly | daily | weekly | monthly | yearly
  effects: { addMen(draft, e, ctx) { /* … */ } },             // effect ops this module owns (§10)
  effectSchemas: { addMen: AddMenSchema },                    // optional zod validation (§10)
  reactions: { BattleEnded(draft, e, ctx) { /* … */ } },      // observe other modules' events (§11)
  conditionFns: { hasTrait: { args, returns: 'boolean', evaluate } }, // condition language (§10)
  invariants(state) { return []; },                          // violations, for tests/fuzzers
  // enabled: false,                                          // drop out of every env while broken (§16)
};
```

Registry (`src/sim/modules.ts`) and scheduler order (unique, validated at startup):

| order | module | order | module | order | module |
|---|---|---|---|---|---|
| −1000 | core (kernel) | 50 | news | 110 | faith |
| 10 | world (movement, world-gen) | 60 | ai | 120 | intel |
| 20 | weather | 65 | diplomacy | 130 | quests |
| 30 | encounters | 70 | economy | 140 | narrative |
| 40 | expeditions (food, sailing) | 80 | holdings (loyalty) | 150 | saga |
| 45 | settlements | 90 | military (recruitment) | 200/210/220 | battle / duel / seabattle |
| | | 100 | people (dynasty, aging) | | |

`createSimEnv()` rejects duplicate module ids/orders, two handlers for one command type, two implementations of one
effect op, two condition functions of one name, and command/effect schemas without handlers (`ModuleRegistryError`).
Several modules may react to the same event.

## 4. Extending the kernel by module augmentation

Augmented fields **must be optional** (core factories, other modules' tests and old saves don't know them). State must
stay JSON-serialisable: plain objects/arrays, finite numbers, strings, booleans, null.

```ts
// src/sim/modules/settlements/types.ts — MUST be a module: keep an import (or add `export {}`), otherwise
// `declare module` declares a new ambient module that SHADOWS the kernel file and breaks every agent's types.
import type { SettlementId, FactionId, Hour } from '@sim/core/state';
export interface SiegeState { besiegerId: FactionId; sinceHour: Hour; rams: number }

declare module '@sim/core/state' {
  interface Settlement { siege?: SiegeState }                 // entity field
  interface GameState { siegeLog?: SettlementId[] }           // new root slice
  interface AftermathPayload { lootValue?: number }           // extend a core pending payload
  interface PendingPayloads { siegeTerms: { settlementId: SettlementId; offer: number } } // new pending kind
  interface PlayerPolicies { ransom?: 'payAll' | 'haggle' }   // new steward policy — see below
  interface GameOptions { realisticSieges?: boolean }         // new-game option
  interface PactKinds { coalition: true }                     // new member of a vocabulary registry
  interface CharacterLocations { delve: { siteId: SiteId } }  // new character-location kind
}
declare module '@sim/core/commands' {
  interface CommandMap { besiege: { settlementId: SettlementId }; liftSiege: { settlementId: SettlementId } }
}
declare module '@sim/core/events' {
  interface EventMap { SiegeStarted: { settlementId: SettlementId; besiegerId: FactionId } }
  interface EntityLinkKinds { siege: true }
}
declare module '@sim/core/effects' {
  interface EffectMap { startSiege: { settlementId: SettlementId } }
}
declare module '@sim/core/ids' {
  interface IdPrefixMap { sgc: `sgc_${string}` }             // ctx.newId('sgc') → 'sgc_57'
}
```

After this, `Command`, `SimEvent`, `Effect`, `PendingDecision` and the handler maps are fully typed for everyone.
Augment the *specific file* (`@sim/core/state`, not `@sim/core`). Keep augmentations in `types.ts` inside your module
folder and import it from `index.ts`. `src/sim/core/augmentation.test.ts` proves the pattern end to end.

**Vocabulary registries.** Open vocabularies are interfaces whose keys are the members, with `type X = keyof XKinds`:
`GameModes`, `RoleKinds`, `FactionKinds`, `SiteKinds`, `FleetModes`, `FleetIntents`, `PactKinds`, `Stances`,
`IntelFactKeys`, `StoryletScopes`, `StoryletTriggers`, `BattleKinds` (state.ts), `EntityLinkKinds` (events.ts), and
`CharacterLocations` (kind → extra fields, derived into the `CharacterLocation` union). `WoundState` is deliberately
closed (ordered severity; lasting harm is an injury trait).

**Policies.** `setPolicy` accepts only keys that exist in `state.player.policies` (own properties), so a module that
augments `PlayerPolicies` must write its default in `init` (new games) **and** `migrate` (old saves).

## 5. Commands and dispatch

`dispatch(state, cmd, env) → { state, events, error? }` (`core/dispatch.ts`) runs the single owning handler inside one
kernel operation (§11). Reject a command by throwing `new CommandError(code, message)` — state is untouched and
nothing is logged; a `CommandError` thrown by a reaction rejects the command too. Any other exception is a bug and
propagates. Optional runtime validation: `commandSchemas: { besiege: zodSchema }`. The handler receives the schema's
**output** (defaults, trims, coercions and transforms applied, unknown keys stripped, `type` re-attached); the replay
log keeps the raw input and replays re-parse it, so schemas must be deterministic. Commands are camelCase,
JSON-serialisable and never use the key `type` in the payload. Core commands: `wait {days | untilEvent, maxDays}`,
`setPolicy {policy, value}`, `acknowledge {pendingId}` (message decisions).

## 6. Scheduler, time and pending decisions

`advance(state, hours, env)` (`core/scheduler.ts`) ticks one game hour at a time: `time.hour += 1`, every `hourly`
system in module order, then on boundaries `DayStarted` + `daily`, `WeekStarted` + `weekly`, `MonthStarted` +
`monthly`, `YearStarted` + `yearly`. Reactions to a boundary announcement run before that phase's systems; reactions to
a system's events run right after it. One `TimeAdvanced` event per call. Hour 0 = 1 Icebreak 812 A.S. (a Moonday);
360-day years, 7-day weeks running across years (`core/time.ts`). The first `daily` run is at hour 24; `init` covers
day 1.

**Pending decisions.** `ctx.pend({ kind, payload })` sets `state.pending` (or queues it in `pendingQueue`) and the
scheduler **stops immediately** (also when a reaction raised it); it returns the hours actually consumed. The rest of
the interrupted tick is not lost: `state.time.resume` records the cursor and the next advance finishes that tick
(without re-announcing started phases) before a new hour begins. **Time never advances while `pending` is non-null.**
The module that raised a decision owns the command that resolves it and calls `ctx.resolvePending(id)` (which promotes
the next queued decision); raiser/resolver per kind are in `ownership.ts`.

**Every decision must be answerable on screen.** Either a client screen registers for the pending kind, or the payload
carries what the shell's generic decision modal renders: `titleKey`, `key` (body) + `vars`, and
`choices: [{ id, labelKey, vars?, command, tone?, disabled?, previewKey? }]` with ready-made commands (when a command
needs the decision's id, set `choices` on `ctx.pend(...)`'s returned decision). A decision without either soft-locks the
game (time stops for good). `src/sim/headless.ts` must also know a default answer for every kind (tools, soak tests).
Note that a decision can stop time mid-tick: invariants that compare "last updated" hours must allow for
`state.time.resume` (the rest of the tick runs on the next advance).

## 7. Randomness — named RNG streams

xoshiro128** seeded by splitmix32 (`core/rng.ts`, verified against the reference vector). Each stream's 4×uint32 state
lives in `state.rng[name]`, created lazily from `seed + '|' + name`, so adding a stream never perturbs another.

**In handlers, systems, effects, reactions, init and migrate use `ctx.rng(stream)`.** It returns an `Rng`
(`u32, float, int(lo, hi), chance, range, pick, weighted, shuffle, gumbel, normal`) backed by a per-operation cache that
the kernel writes back to `state.rng` once at the end of the operation — a draw costs ~0.05 µs instead of ~2 µs through
the Immer draft. The functional API (`rngFloat(state, stream)`, `hostStream(state, stream)`, …) is for plain mutable
objects (tools, scripts, tests). Never use both for one stream in one operation: the kernel throws. Stream names are
own keys (`'toString'` is a valid stream); `'__proto__'`, `'constructor'`, `'prototype'` are rejected. `int(lo, hi)`
refuses ranges wider than 2^32 values.

**Stream naming:** your module id, or `<moduleId>:<sub>` (`economy`, `ai:fac_12`, `weather:storms`). Entity factories
(`createCharacter`, `createSettlement`, …) given the context draw from **the calling module's** streams
(`<moduleId>:factory`, `<moduleId>:names`; kernel code uses `factory`/`names`), so one module creating entities never
changes another module's names or birthdays. Sub-simulations use the standalone class: `new Rng(setup.seed)`
(serialisable via `getState/setState`); draw the seed with `seedStringFrom(ctx.rng('battle'))`.

**Hot paths (§29.8 budget: ≤ 2 ms per game day, ≤ 10 ms on month boundaries).** Every read or write through the draft
is a proxy trap. In `hourly` systems and passes over large tables: scan with `baseState(draft.table)` (the state when
the operation began — no proxies, ~50× cheaper; it does not see changes made earlier in the same operation, so filter
only on fields that cannot have changed) or keep a small index of active ids in your slice, then read/write only the
matching rows through the draft; keep hourly work minimal (do coarse work daily/monthly). `npm run perf` measures the
registry on a 1,500-character / 150-fleet world against the budget and shows a reference load that follows this
guidance (§16).

`Object.keys(draft.table)` traps the descriptor of every key; when you only need the keys of a large drafted table,
`Reflect.ownKeys(draft.table)` costs one trap (same keys, same order). `current()` of a table copies only rows changed
in this operation (cheap when little changed); reading hundreds of rows through the draft costs a proxy each — measure
before choosing. `baseState` is replay-safe only for filters whose outcome cannot change the result (consecutive
advances are replayed as one operation, so "the state when the operation began" differs between live play and replay).

## 8. Deterministic math and other determinism rules

Use `dexp, dlog, dlog2, dpow, dsin, dcos, datan, datan2, dtanh, dexpm1, dhypot, dsigmoid` from `core/dmath.ts` instead
of `Math.exp/log/pow/sin/cos/atan2/tanh/hypot` (engines differ in the last bit; the boundary test enforces it).
`dsin/dcos` are accurate over the whole double range (Payne–Hanek reduction for |x| ≥ 2^19), `dpow` follows the
`Math.pow` special-value rules, `dhypot` neither overflows nor underflows. `Math.sqrt/abs/floor/ceil/round/min/max/
imul/sign/trunc` are exact and fine. No `Date` at all, no `Map`/`Set` in module code; iterate records in insertion
order (deterministic) or sort explicitly. Record keys come from ids or `isSafeRecordKey`-checked strings; test
existence with `Object.hasOwn`, never `in` or truthiness. Ids come from `ctx.newId(prefix)` (`chr_`, `set_`, `prv_`,
`fac_`, `flt_`, `shp_`, `arm_`, `site_`, `rel_`, `qst_`, `news_`, `evt_`, `pnd_`, `bat_`, `duel_`, `sea_`, `rec_`). Id
types are template literals (`CharId = \`chr_${string}\``), so `'set_1'` is not assignable to `CharId`.

## 9. Balance and content

**Two places for tunables.**
- `src/content/data/balance.json` holds the design's §31 formula tables, validated by the strict zod schema
  `src/content/schemas/balance.ts`. It is **frozen during the parallel phase**: only the integrator edits it.
- **Module-owned tunables:** `src/content/data/tunables/<moduleId>.json` + `src/content/schemas/tunables/<moduleId>.ts`
  (strict zod; unknown keys are errors), pre-created for every module and aggregated by `src/content/tunables.ts`.
  Read them as `ctx.tunables.<moduleId>`; types come from your schema. Every new tunable you discover goes here.

In sim code read `ctx.balance` / `ctx.tunables` (tests and mods can substitute content); helpers in `core/balance.ts`.
Never hard-code a number that belongs in data.

**Single source per rule.** Per-culture, per-feat and per-trait effects live **only** in the modifier bags of
`cultures.json`, `feats.json`, `traits.json`; balance.json holds the general formulas and never repeats them. Examples:
Eyjar start walls = `fort.startTierDelta −1` (read by `createPlaceholderPlayer`), Hall-Burner = `fire.spreadPct 30`,
lost fingers = the `lostFingers` trait (an injury row that names a trait carries no skill/amount — validated).
Straits tolls are the §31.1 formula (`economy.straitsTollPerProvince × straitsTollMult.{eyjar,other}`) and the Eyjar
bonus is descriptive. The one-time-tribute cooldown is `diplomacy.cooldownDays.tribute`; the ongoing tributary share is
`economy.tributeShare`. Smithy/armoury gates follow §12.4 (equipment tier 3 needs Smithy II, tiers 4–5 Smithy III):
`buildings.smithy` `maxArmouryTier` is 2/3/5 (confirmed by the owner 2026-11-01; §10.4 updated to match); the schema
checks that the two tables agree.

**Design key → balance path** (§31.22 keys that moved; source of truth `src/content/designKeys.ts`, tested):

| Design key | balance.json path |
|---|---|
| `battle.chargeS` | `battle.charge.durationS` |
| `battle.chargeRunTiles` | `battle.charge.runTiles` |
| `battle.kRanged` | `battle.ranged.kRanged` |
| `battle.volleyS` | `battle.ranged.volleyS` |
| `diplomacy.tributeCooldownDays` | `diplomacy.cooldownDays.tribute` |

**Core catalogs** (`getContent()` / `ctx.content`): `balance, cultures, gods, traits, feats, titles, names,
upbringings` (§5.1: skill, unlocked starting trait, 6 positive step-7 traits) and `tunables`.

**Per-area files** (one per content area: `core`, each module id, and the client areas `ui, menu, hub, map, battleView,
duelView, seaView, codex, portraits, music` — `src/content/areas.ts`), pre-created and pre-registered so parallel
agents never share a file; `content.test.ts` fails on unregistered files:
- `src/content/locales/en/<area>.json` — ICU MessageFormat strings; every key starts with `<area>.`. The sim emits keys
  + `TextVars` only. `missingLocaleKeys()` / `missingEventKeys(events)` (testing.ts) and `npm run sim` flag keys
  without a string.
- `src/content/assets/manifest/<area>.json` — asset id (prefix `<area>.`) → `{ kind: image|music|sfx|voice, path,
  size/anchor/frames | durationS/loop | lineKey/voice, placeholder: { generator, params, label } }`. `path` is where the
  owner's final file goes (under `public/assets/`); the client prefers it and falls back to the procedural placeholder.

Locales and the manifest are imported by the client, tools and tests — never by sim runtime code. Other domain packs
(world geography, storylets, relics, quests) live in their own folders (`src/content/data/<pack>/` +
`src/content/<pack>.ts`) with their own schemas and are imported directly by their owning module; do not add them to
`src/content/index.ts`. **Storylets, relics and quests are JSON** (not YAML: no build step or parser needed; text lives
in the locale files), typed by `StoryletDef`/`RelicDef` in `core/defs.ts` and validated with `validateEffects`.

**Modifier vocabulary** (traits, feats, culture bonuses): dotted keys → number, e.g. `skill.speechcraft: 2`,
`attr.might: 1`, `morale.ownSquad: 10`, `duel.damagePct: 10`, `fort.startTierDelta: -1`, `fire.spreadPct: 30`,
`start.chartVelkar: 1`, `unit.<id>.bountyPct`, `goods.<id>.outputPct`. `*Pct` keys are percentages, `*Mult`
multipliers, others flat. The consuming module defines the meaning.

**Values not in the design** (first guesses for the balance harness): `defaults.*`, `difficulty.*.aiRaidCapPerYear`,
`envoyMinIntervalDays`, `holdings.startLoyalty`, `colonize.startLoyalty`, Strand-Rider bounty/wage, great bear
`atk 30`/`def 6` (used only by the generic melee/auto-resolve formulas; its design attack is the
`specials.maulDamage 25` maul), the `wreckers` guardian unit (outlaw-like, ambush/hide), the Kurgai
`steppeHorseArchers` unit, upbringing `startingTrait`/`traitOptions`, `battle.abilityCooldownS` (except rally),
`autoresolve.outcomeBands`, `diplomacy.oddsLabels`, `encounters.fleeMoraleCost`, `storms.harshWintersMult`,
`overland.terrain.mountain`, `ai.personalityNoise`, `sailing.pointOfSailDeg` (except 30°/60°),
`loyalty.renownTierBonus` split, galley/riverboat `founderSize`, `shipyard.timberSurchargePerTon`, pitch price,
non-homeland culture bonus magnitudes. The Kurgai culture and High Sky faith are integrator additions for the owner's
steppe peoples.

## 10. Effects and the condition language

Structured consequences `{ op, ...params }` applied with `ctx.applyEffects([...])` (`core/effects.ts`). Core implements
`addSilver, addGoods, addRations, changeOpinion, changeLoyalty, changeRenown, changeHonor, changeDread, changeFavor,
setFlag, addChronicle, notify, narrate, unlockCodex, scheduleStorylet`; every other §19.1 op has exactly one owner in
`ownership.ts` (people: woundCharacter, addTrait, removeTrait, marry, birth, kill, capture, giveItem; military: addMen,
killMen, spawnArmy; expeditions: spawnFleet; quests: startQuest, revealSite, giveRelic; intel: addIntel; news: addNews;
economy: changeEconomy; battle/duel/seabattle: startBattle/startDuel/startSeaBattle). Unknown ops throw `EffectError`.
Silver/goods floor at 0; standings clamp to `balance.standing` ranges. **Rations are a count:** fleets carry them in
`fleet.rations` (`addGoods {good:'rations', tons}` converts with `economy.rationsPerTon`; `addRations {count}` adds by
count); `fleet.cargo.rations` is never used; market stocks are tons for every good.

Each op may have a zod schema (`effectSchemas`; core ops have them). `applyEffect` validates and hands the parsed
output to the handler; `validateEffects(env, effects, where)` returns issues and is what content packs call at load
time (storylet choices, relic effects, quest rewards) so bad parameters fail in tests, not when a player clicks.

**Condition language (§29.7).** The narrative module owns the parser/evaluator; each module contributes the
whitelisted functions over its own data as `conditionFns` (`{ args: zod tuple, returns, evaluate(args, ctx) }`, pure;
ctx = `{ state, env, scope, rng? }`). Core provides `flag(name)`, `season()`, `opinion(a, b)`; owners of the others
(hasTrait, daysSince, rand, count, …) are in `ownership.ts`.

## 11. Events, reactions and the context

`ctx` (`SimContext`) gives: `state` (the draft), `balance`, `content`, `tunables`, `hour`, `moduleId`, `events`,
`emit(event)`, `rng(stream)`, `pend(request)`, `resolvePending(id)`, `applyEffects`, `newId`,
`notify(key, {priority, vars, link})`, `narrate(key, vars, voice)`, `chronicle(entry)`, `runAs`.

**One operation** (dispatch, advance, new game, load, `inDraft`) is one Immer `produce` with one context. At its end,
still inside the recipe, the kernel drains reactions, flushes `ctx.rng` streams and **snapshots every event**, so an
event never holds an Immer draft (you may pass draft objects as `vars`/payloads; they are copied).

**Reactions.** `reactions: { BattleEnded(draft, e, ctx) {…} }` lets a module observe events raised by any other module
(storylet triggers, news from `SettlementFate`/`Death`, saga/achievement tracking, XP and wounds after a battle, AI
belief updates) without importing or editing it. Reactions run in module order after the handler/system/effect that
emitted the event (also for events raised inside command handlers), attributed to the reacting module; events they emit
are reacted to in turn, up to `MAX_REACTION_DEPTH` (8) generations (deeper = a loop → `SimError`). **Domain events** are
the ones declared by their owner (`EVENT_OWNERS`: Arrived, BattleEnded, Death, SettlementFate, NewsHeard, RelicFound, …);
only the owner emits them, anyone may react. Events (PascalCase) are returned to the client, never stored. Core events:
TimeAdvanced, DayStarted, WeekStarted, MonthStarted, YearStarted, Notification, NarrationLine, ChronicleAdded,
PendingRaised, PendingResolved, StandingChanged, LoyaltyChanged, OpinionChanged, CodexUnlocked, PolicyChanged. Text is
never English in the sim: emit localisation keys + `TextVars` (ICU via intl-messageformat).

**Standing split.** Core implements the standing effects (`changeRenown/Honor/Dread/Favor/Loyalty/Opinion`: clamping
+ events). saga owns the rules that decide *when* Renown/Honor/Dread change (deed rewards, decay, tiers) and reacts to
`StandingChanged`; faith owns Favor decay/omens; diplomacy owns relations and pacts.

## 12. Saves and migrations

`serialize(state)` → JSON → gzip (fflate, fixed mtime) → base64, prefixed `BARDIA1:<crc32>:`; `deserialize` verifies
the checksum and runs the **core** migration chain (`save/migrations.ts`, kernel-owned, pure `vN→vN+1` functions on
`meta.schemaVersion`). **Module catch-up** (`upgradeLoadedState`, run by `GameSession.load` in module order): a module
the save has never seen (`meta.moduleVersions[id]` missing) gets its **`init`** — so `init` must work on a campaign
already under way; an older module version gets `migrate(draft, fromVersion, ctx)`; a newer one is refused. Every
module's version is then recorded. Save→load→save is byte-identical (tested).

## 13. Sub-simulations

Battle (20 Hz), duel (60 Hz) and sea battle (20 Hz) run outside Immer with their own mutable state, seeded by
`setup.seed` through `Rng`. GameState only holds `state.subsims.{battle,duel,seaBattle}` = `{ id, status, startedHour,
setup, result? }` (§30.8 contracts in `core/state.ts`). The owning folder registers a module (orders 200/210/220) for its
start/apply-result commands and `startBattle`/`startDuel`/`startSeaBattle` effects. Results are applied through commands
so they are logged and replayable; other modules react to `BattleEnded`/`DuelEnded`/`SeaBattleEnded`.

## 14. How the client consumes the simulation

```ts
import { GameSession, formatDate } from '@sim/index';   // bound to the full module registry
const session = GameSession.newGame({ seed, difficulty: 'raider', player: { culture: 'skarn', name: 'Sigrun' } });
const off = session.subscribe((state, events) => store.setState({ state, events }));  // zustand
session.dispatch({ type: 'wait', days: 3 });              // returns { state, events, error? }
const r = session.advance(hours);                          // client converts real time → whole hours
if (r.pending) showDecision(r.pending);                    // auto-pause; time is stopped until resolved
const blob = session.save(); GameSession.load(blob);       // playtime via session.addPlaytime(sec)
GameSession.replay(session.newGameOptions!, session.commandLog);  // golden replays / bug reports
```

`GameSessionWithDeps` (src/sim/session.ts) is the same class with an explicit `{ modules }` dependency (tests, tools
running a subset). Consecutive advances share one replay-log entry. The state is frozen; never mutate it in the
client. All art/audio/voice referenced by the sim are ids (portrait `seed`, narration `key`/`voice`), resolved by the
client through the asset manifest (placeholder or final file). **Client screens** (convention for client agents):
one folder per screen under `src/client/screens/<name>/` exporting a screen descriptor (the `GameMode` or pending kind
it serves); the app builds its registry with `import.meta.glob('./screens/*/index.tsx', { eager: true })`, so adding a
screen never edits a shared file.

## 15. New game and the placeholder player

`createNewGameState` (`core/lifecycle.ts`, wrapped by `GameSession.newGame`) → `createEmptyState` →
`createPlaceholderPlayer` (faction, 16-year-old ruler, placeholder province + capital with the §5.5 preset
men/ships/food/silver/lieutenants and start buildings; flag `state.flags.placeholderHome = <settlementId>`) → each
module's `init` in order (reactions drained after each). **The world module** generates the real map and re-homes the
player onto a real settlement (update `player.capitalId`, faction holdings, ruler location, ships' `dockedAt`, then
delete the placeholder province/settlement and the flag).

## 16. Testing, verification and tools

- Tests sit beside the code as `*.test.ts` (Vitest, `environment: 'node'`); property tests with fast-check.
- Helpers in `src/sim/testing.ts` — it imports only the kernel and content, never the registry, so your tests load
  core plus your module: `testEnv(modules)`, `testState({ modules, seed, difficulty })`,
  `inDraft(state, env, (draft, ctx) => …)`, `testWorld({ modules, factions, settlementsPerFaction, fleetsPerFaction })`
  (deterministic multi-faction world: rulers, coastal settlements with markets, the player's holdings, docked fleets with
  ships/men/rations, neutral relations) and `missingEventKeys(events)`.
- Module fixtures go in `src/sim/modules/<id>/testing.ts`; other modules' tests may import them.
- Test only your module plus core: `testEnv([module])`. Use fake modules for interactions. Never snapshot ids or state
  hashes from full-registry runs (ids come from one global counter); golden replays belong to the integrator.
- Test augmentations stay out of the client: `tsconfig.json` (sim + content + tools + tests, **no client**),
  `tsconfig.app.json` (client + sim + content, **no tests**; used by `build`; `src/client/tsconfig.json` points editors
  at it) and `tsconfig.sim.json` (sim + content without DOM/Node types). Still prefix test-only names `test`/`Test`.
- Every module ships invariants and a determinism test (same seed + same inputs → identical JSON).
- **Module agent gate:** `npm run verify:module -- <id>` — typechecks a program of kernel + content + your folder only,
  runs your folder's tests and the boundary rules scoped to your folder. Other agents' unfinished modules cannot fail it.
- **Integrator gate:** `npm run typecheck && npm test && npm run build && npm run sim -- --days 365` (sim fails on
  invariant violations and missing locale keys), plus `npm run perf` and, once the parallel phase is complete,
  `BARDIA_STRICT_OWNERSHIP=1 npm test`.
- **Headless runs:** time never advances past a pending decision; `headlessCommand(state, pending)`
  (`src/sim/headless.ts`) gives the default answer per kind (acknowledge, a storylet's default or first available
  choice, auto-resolved battles/duels/sea battles, wait in captivity, the expected heir, the first feat). `npm run sim`,
  `npm run perf` and the year-long session test use it; a new pending kind needs a default there.
- **Timing tests** multiply their budgets by `PERF_SLACK` (`process.env.BARDIA_STRICT_PERF === '1' ? 1 : 4`) so the
  parallel suite is not flaky; budgets are enforced as written in dedicated runs (`BARDIA_STRICT_PERF=1`, `npm run perf`).
- A module that is broken mid-work sets `enabled: false` in its own index.ts (it then drops out of every env, the
  sim and e2e). `npm run sim -- --modules a,b` or `BARDIA_MODULES=a,b` runs a subset.
- Agents should work in separate git worktrees (or at least never run `npm install`); only the integrator edits
  `package.json`/`package-lock.json`. Tools are `tools/<name>/index.ts`, run with `npm run tool -- <name>` (no
  package.json edit). Available dev dependencies include `fast-xml-parser` (for tools/map-build reading
  `bardia.svg`) and `intl-messageformat`. ESLint/typescript-eslint are **not** installed: typescript-eslint 8.x supports
  TypeScript < 6.1 and TypeScript 7 has no JS compiler API; the boundary test enforces the architectural rules instead.

## 17. Naming conventions

Files `camelCase.ts`; types/interfaces `PascalCase`; functions/variables `camelCase`; commands and effect ops
`camelCase` verbs (`besiege`, `addMen`); events `PascalCase` past tense (`SiegeStarted`); balance/tunable keys
`camelCase`; content ids `camelCase` (`fjordWallHuscarls`); localisation keys and asset ids dotted with the area prefix
(`hub.greatHall.title`). No default exports. No `any`. TSDoc on exported functions. Never write names, text or data
from the 1996 game, and never a real historical person or place name (content test denylist).

## 18. Ownership (summary; the source of truth is `src/sim/core/ownership.ts`)

| Module | Effects | Commands | Pending (raise → resolve) | State slices |
|---|---|---|---|---|
| core | addSilver, addGoods, addRations, changeOpinion/Loyalty/Renown/Honor/Dread/Favor, setFlag, unlockCodex, scheduleStorylet, addChronicle, notify, narrate | wait, setPolicy, acknowledge | message | meta, time, rng, pending, flags, chronicle, codex, player |
| world | computeRoute, steerEntity, revealArea, revealSettlement | — | — | factions, provinces, settlements, worldIndex, knowledge, world (+ `Arrived`) |
| weather | — | — | — | weather (+ `StormWarning`, `StormHit`) |
| ai | — | — | — | (faction `aiPlan`; reacts to everything) |
| encounters | — | resolveEncounter | encounter | — |
| expeditions | spawnFleet | plan/launchExpedition, setRoute, steer, makeLandfall, returnToShips, returnHome | — | fleets, expeditions |
| settlements | — | resolveArrival, chooseAftermath, loadCargo, tavernAction, leaveSettlement | arrival, aftermath | settlementsState (+ `SettlementFate`) |
| diplomacy | — | audience, respondEnvoy, thingAction | envoy, thing | relations |
| economy | changeEconomy | trade, haggle, setTradeRoute, clearTradeRoute | — | markets, economy |
| holdings | — | setTax, queueBuilding, setGarrison | — | (holding fields) |
| military | addMen, killMen, spawnArmy | muster, queueShip, repairShip, upgradeArmoury, transfer, promoteLieutenant, hireSellsword | — | ships, armies |
| people | woundCharacter, addTrait, removeTrait, marry, birth, kill, capture, giveItem | assignRole, heal, designateHeir, adopt, foster, captivityAction | captivity, succession | characters |
| faith | — | sacrifice, readOmen | — | — |
| intel / news | addIntel, observeSettlement / addNews, hearNews | buyMap / — | — | intel / news, newsIndex |
| quests | startQuest, revealSite, giveRelic | delveChoice | delve | quests, relics, sites |
| narrative | — | storyletChoice | storylet | storylets |
| saga | — | chooseAmbitions | yearEnd | (sagaLedger rules) |
| battle / duel / seabattle | startBattle, autoResolveBattle / startDuel / startSeaBattle | start*/apply*Result | battleSetup / duel / seaBattle | subsims.* |

Each module stub's header lists its full ownership. `src/sim/ownership.test.ts` fails when a listed item is registered
by any other module.

Module-owned additions (events, condition functions, module-internal commands and ops) are listed in
`ownership.ts` under "Module-owned additions"; register new ones there when a module adds them.

## 19. State-resident contracts between modules

Modules that cannot import each other's runtime code read these documented shapes (`import type` their types):

- **`state.worldIndex`** (world, `world/types.ts`): `settlements[id] = { geoId, provinceId, regionId, cell, port,
  portKind, seaZoneId, karviOnly, lanes: [{ to, seaDays, landDays, karvi? }] }` — per-settlement lanes to the nearest
  settlements (≤ `index.laneHorizonDays`), `provinces[id] = { neighbours, seaNeighbours, seaZones, kingdomId, … }`,
  `kingdoms`, `regions`, `seaZones`, `homelandProvinceIds`, `provinceByGeoId`, `settlementByGeoId`. News and economy
  build their networks from `settlements[id].lanes`.
- **`state.knowledge`** (world): `charted[y]` = sorted half-open runs `[x0, x1, x2, x3, …]` per grid row, `visited`
  (settlement → hour), `zoneCharted` (sea zone → charted cells). The client's fog decodes it (`render/map/knowledge.ts`).
- **Routes:** `fleet.route` / `army.route` are waypoint lists set by world's `computeRoute` effect (expeditions'
  `setRoute` applies it); `state.world.movers` indexes what moves hourly. `Arrived` fires at the end of a route.
- **`state.weather`** (weather, `weather/types.ts`), **`state.economy`** (economy), **`state.intel`** keyed
  `observer|settlementId` (intel) — see each module's types.ts header.
- **The expedition** (expeditions): `state.player.expeditionFleetId` is the player's fleet at sea (`meta.mode` = 'map'
  while it is out, back to 'hub' when it stands down at home); `state.expeditions` = `{ lastPlan, starving,
  landParties: army → fleet }`; `fleet.homeward` marks a fleet sailing home to stand down. The planner's validation is
  the pure `validateExpedition(state, content, plan)` (`expeditions/plan.ts`), shared by the command and the client.
- **The march** (expeditions; `plan.travel: 'land'`): the expedition fleet has no ships and carries `fleet.overland =
  { carryT }`. It is the war-band's baggage (food, silver, goods, plunder, the leaders' roll); every man marches as its
  land party (`landParties[army] = fleet`, the army the player steers). Hourly the baggage takes the war-band's position
  and stragglers in it join the war-band; daily `carryT` follows the marchers (goods beyond it are left behind).
  Economy trades from it (`carryT` is its hold, the war-band's position counts), settlements loads plunder into it and
  garrisons an annexed town from the war-band; it stands down when the war-band walks back into the hall.
- **The visit** (settlements): `state.settlementsState` = `{ battles: battleId → { settlementId, approach, fleetId? },
  inside?: settlementId (the hub screen), loot?: { settlementId, fleetId, untilHour } (the Cargo screen) }`;
  settlements gain `tributaryOf`, `raidedHour`, `lastFate`. Battles it starts carry `origin: 'settlements'`; its
  `BattleEnded` reaction applies a raid's fate or raises the Aftermath.

## 20. Menu and scene rules (owner play-test, 2026-11-14)

The owner found the menus "busy and cluttered", small and hard to read, and wants roughly **half as much on screen**,
bigger, and more immersive. These rules bind every client screen. Reference window: 1366×768 (also check 1600×1000).

1. **One question per panel.** A panel shows what the player needs for the decision in front of them: at most about six
   numbers at once. Everything else goes behind a "Details" disclosure or a tooltip, or is removed. Cutting a feature's
   UI (or the feature) to get there is allowed; say so in your report.
2. **Readable type.** Text the player must read is `--fs-md` or larger; numbers the player acts on are `--fs-lg` or
   larger. `--fs-xs` / `--fs-2xs` are for chips and key hints only.
3. **One primary action** per screen (the gold button) and at most three other buttons in view.
4. **Use the room.** A menu is a large framed screen (most of the viewport) or a full-screen scene, never a small dialog
   holding a dense table. Tables: at most four columns and about eight rows; prefer cards and pictures.
5. **Words before numbers.** "Food for 30 days", not "1,200 rations"; odds as a word ("likely"), the percentage in
   Details. One sentence of explanation at most; standing instructions belong in tooltips or a first-time hint.
6. **Moving things between two places** (men, food, silver, cargo, loot) uses the two-sided `TransferSlider` from
   `client/ui`: one side is what stays, the other what goes, and both amounts update live as the handle moves.
7. **Interruptions are scenes, not dialogs.** Meeting a ship, reaching a settlement, a battle: an attention cue first
   (sound + a short banner or animation over the map), then the whole screen changes to a painted scene of what the
   crew sees, then at most four big choices, each with one plain line saying what it does.
8. **The player steers.** On the map the expedition is a ship (or a war-band on land) the player moves directly;
   touching a settlement opens its scene.
9. **Existing `data-testid` values are a contract**: keep the id and its meaning on any element that still exists.
10. **Original work only.** Bardia is its own game: never copy the look, layout, art, names or text of any existing
    game, and never open the old disc image in the project root.
