# Bardia: noted for the next round

Things seen during the build of 14 November 2026 and left as they are. None of them blocks play-testing.

## Play

- **Your own villages have no scene.** Touching home stops the ship or war-band and offers "Come home"; your other holdings show nothing at all. They should get an arrival scene like foreign places.
- **Touching home prints two lines** in the news feed (the world's "has reached" and the new home notice). One is enough.
- **Steering keys** cannot be changed in Options, and a gamepad does not steer.
- **Rivers stop a war-band steered by hand** except at road crossings; this now also applies to parties put ashore from ships. Check whether that feels right.
- **Sea battles:** tired crews can trade arrows for a long time near the end; a captain duel after a boarding is settled on the spot instead of fought; ships lashed together can overlap when zoomed out.
- **After annexing on a march,** a leader who becomes governor still counts as leader of his old squad, which then fights unled.
- **Veterancy resets** when men go ashore or march.
- **Silver has no weight** on a march.

## Screens

- **Mead-hall abroad** uses three choices with the sellswords listed below; at home it is the four-choice scene. `settlement/hub.tsx` could mount `MeadHallScene` so both match.
- **Market abroad:** all fifteen goods show, so the panel scrolls at 1366×768. Show only what is held or sold.
- **Affairs of State:** the build button sits low at 1280×720.
- **Grove** shows seven favour numbers, one over the "about six" rule.
- **Counsel and the big "Plan an expedition" button** both offer the planner when that is the top advice.
- **Choice cards:** a test id on the reason line would help tests; `Tabs` has no test id per tab.

## Tests

- **Sea "Come home"** is covered by a unit test only, not a browser test.
- **Dev-server only:** the scene gallery and the campaign sea-fight browser tests skip on a production build.
- **Final full browser run (production build):** 28 passed, 3 skipped, 2 failed. `march.spec.ts` (second test) had not switched on the developer console; fixed, and both march tests pass on the production build. `voyage.spec.ts` (steering back into a harbour by touch) failed in the full parallel run and passed when run alone: it is sensitive to load. No full run was made after these two re-runs.
- **Chance at sea:** the two browser tests that wait for a meeting at sea depend on luck. They now recover from arrivals and homecomings, but can still run long.

## Housekeeping

- **Unused leftovers:** `.xp-hud` rules in `screens/expedition/expedition.css`, `mk-*` / `mh-*` rules in `screens/settlement/settlement.css`, old `economy.ui.market.*`, `known.*`, `routes.*` and `settlements.ui.hall.*` strings, the mead-hall "drink" strings, and the `hubPlaceholder` folder (still imported by two tests).
- **Ledger strings** live in `holdings.json`; they belong in `economy.json`.
- **Design document:** `Bardia_Design_and_Build_Plan.md` is not in the public repository (its research chapter describes the old disc). Decide: publish as is, publish without chapters 2 and 3, or keep it private.
- **No license** in the repository yet.

## Still not built

Rival rulers acting on their own, diplomacy, quests and relics, saga goals and victory, the prologue, the duel scene, revolts and attacks on holdings, dismissing men, harvests. Shipbuilding and armoury upgrades still take timber and iron from the town market for free; farms and watchtowers do nothing.
