# ADR-003: Real-time-with-pause squad battles

- **Status:** Accepted (owner decision, 2026-10-31)
- **Design document:** `Bardia_Design_and_Build_Plan.md` v0.2: §12.2–§12.3, §13 (land battles), §15.2 (sea battles), §18.10, §29.3, §29.8, §31.8–§31.11, §35 (D3)

## Context

Bardia's land battles must deliver the raid fantasy: shield walls breaking, halls burning in the wind, loot carried back to the ships before the defenders muster. They must also stay readable and accessible (pillar P5) and fix the 1996 reference game's clumsy tactical controls (lessons L8, L12).

The options considered were:

1. **Real-time with pause (RTwP), squad-based.** Up to 8 player squads, each a leader plus up to 80 men of one unit type.
2. **Turn-based on a hex grid.**
3. **Pure real-time** with no pause.

Constraints: the simulation must be deterministic (fixed tick, seeded RNG streams, no `Math.random`, no `Date`, no timers in `src/sim`) so that battles are replayable, testable headless, and comparable with auto-resolve. The game is built by AI agents and verified with tests and browser automation.

## Decision

Land battles are **real-time with pause and squad-based** (owner decision D3):

- The simulation runs at a fixed **20 ticks per second**, deterministic and headless-capable (`src/sim/battle`). The client renders at 60 fps with interpolation.
- The player controls **squads, not individual men**: up to 8 squads (you plus lieutenants), each with one unit type, a formation (Line, Shield Wall, Wedge, Loose), a stance and cooldown abilities.
- **Pause is always available** (Space), and a full order queue can be issued while paused. Battle speeds are 0.5×, 1× and 2× (§7.2, §13.5).
- Combat uses the design's casualties-per-second model with formations, flanking, charge, terrain, fatigue, morale and wind-driven fire (§31.8–§31.10). **No crossbows and no couched-lance knights:** Corvani horsemen charge at ×1.6 and Strand-Riders at ×1.5; an intact front shield wall negates a charge.
- **Auto-resolve** uses squad power (§31.11) and MUST stay within ±10% of simulated win rates (the parity harness).
- **Retreat to Ships** always works (no soft-locks).
- Sea battles (§15.2) follow the same real-time-with-pause model, with ships as the controllable units.

## Consequences

- **Feel and accessibility:** this mode is closest to the reference genre's feel, and pausing makes it playable for people who dislike real-time micro-management. Assisted options and auto-resolve cover the rest.
- **Determinism is mandatory:** all randomness goes through sim RNG streams, and fractional casualties accumulate deterministically. Golden replays and the parity harness depend on it.
- **Performance budget:** ≤ 4 ms per 20 Hz step with ≤ 300 figures and ≤ 150 projectiles on a mid-range laptop. The rendering scale is 1 figure = 5 men.
- **AI** needs a commander layer and a squad utility layer that act in real time. Difficulty changes reaction time and coordination, never stats.
- **Testing:** battles run headless in Vitest (unit and property tests, golden replays, parity runs) and are driven end to end in Playwright through the pause and order UI.
- **Cost:** RTwP is harder to build than turn-based (pathing, collision, timing and AI reaction), and it is harder for screen-reader users. Mitigations are full pause-and-order play, the 0.5× speed, clear readouts, and auto-resolve for every battle.
- **Not chosen:** turn-based hex was rejected because it loses the timed-raid tension and wind-driven fire. Pure real-time was rejected for accessibility reasons. Revisiting this decision requires a new ADR.
