# Bardia: noted for the next round

Things seen during the builds of 14 and 15 November 2026 and left as they are. None of them blocks play-testing.

## Rooms (15 November)

- **Rooms abroad.** Visiting a foreign settlement still shows its market and mead-hall as the older screens. The shared pieces are ready: about 40 lines in `screens/settlement/hub.tsx`, plus the ids `visit-panel-meadHall` and `visit-close` in `screens/arrivalScene/arrivalScene.test.tsx`.
- **A panel covers the people on its side.** With a panel open on the left, the people on the left are behind it; the player presses Back or a number key first.
- **Small windows (1366×768):** the market's deal panel just touches the fold; the Longhouse's office list scrolls; the last god card in the Grove is half hidden until scrolled; in the muster the None/Half/All chips need a small scroll.
- **Name plates at the edge:** when the picture slides for a panel, a quiet name plate at the far edge can be cut off.
- **Top bar:** the room covers the top bar's decorative bottom edge by about 5 px (`.route-host.layout-overlay` starts at 4.6rem).
- **Poses:** the room kit has standing, seated and working figures, no leaning one. The Seer stands upright behind her table and her ring glows on the table's front edge.
- **Mead-hall:** the drinking horns on the wall read a little like crescents.
- **Final art.** `ART_PROMPTS.md` holds a prompt for every painted scene (rebuild it with `npm run tool -- art-prompts` in `game`). Raw downloads go in `art\incoming\`; they still have to be cropped to the game's sizes and placed, and the click tables of the village and the rooms moved to match each painting. The village has no picture slot in code yet (`hub.panorama.home.*`), and neither have the battle and voyage cards or the extra event pictures.

## Battles (15 November)

- **Looking around a land battle** needs the middle mouse button, because left-drag draws a selection box and the arrow keys now move squads.
- **Clicking empty ground while a movement key is held** clears the selection, but the squads keep moving until the key is let go.
- **Squads moving up the screen** have their movement arrow partly behind the name badge.
- **No key for sail or oars** on the ship the player steers; the engine picks. The `propulsion` input has no effect on that ship.
- **Fall-of-shot circle at far zoom:** ships are drawn larger than life when zoomed out, the circle is true to scale.
- **Ship-name labels** can overlap when ships lie close together.
- **The battle keys are fixed.** W A S D, Space and P are read by the battle scenes themselves; Options lists them but cannot change them. Same for the steering keys on the map. A gamepad does not steer.

## Play

- **Your own villages have no scene.** Touching home stops the ship or war-band and offers "Come home"; your other holdings show nothing at all. They should get an arrival scene like foreign places.
- **Touching home prints two lines** in the news feed (the world's "has reached" and the new home notice). One is enough.
- **Rivers stop a war-band steered by hand** except at road crossings; this also applies to parties put ashore from ships. Check whether that feels right.
- **Sea battles:** tired crews can trade arrows for a long time near the end; a captain duel after a boarding is settled on the spot instead of fought; ships lashed together can overlap when zoomed out.
- **After annexing on a march,** a leader who becomes governor still counts as leader of his old squad, which then fights unled.
- **Veterancy resets** when men go ashore or march.
- **Silver has no weight** on a march.

## Screens

- **Mead-hall abroad** uses three choices with the sellswords listed below; at home it is now a room.
- **Market abroad:** all fifteen goods show, so the panel scrolls at 1366×768. Show only what is held or sold.
- **Affairs of State:** the build button sits low at 1280×720.
- **Grove** shows seven favour numbers, one over the "about six" rule.
- **Counsel and the big "Plan an expedition" button** both offer the planner when that is the top advice.
- **Choice cards:** a test id on the reason line would help tests; `Tabs` has no test id per tab.

## Tests

- **Browser tests on the production build (15 November), 40 tests:** no single full run was clean.
  - First full run: 34 passed, 3 skipped (dev-server only), 2 failed. Both failures were the land battle's test hook `__bardiaBattle`, which only development builds exposed. It is now exposed in every build and `battle.spec.ts` passes 3 of 3.
  - Second full run, on a slower machine (3.8 minutes against 1.7): 33 passed, 3 skipped, 3 failed: `expedition.spec.ts` (timed out), `scenes.spec.ts` (the meeting at sea) and `voyage.spec.ts` (arriving by touch). All three pass when run alone; `voyage.spec.ts` needed a second try with two workers and is the most sensitive to load.
  - The room specs (`interiors*.spec.ts`, `affairs.spec.ts`) pass 8 of 8 after the last change.
- **Sea "Come home"** is covered by a unit test only, not a browser test.
- **The Seer's wounded list** is unit-tested only: a new game has nobody wounded.
- **Dev-server only:** the scene gallery and the campaign sea-fight browser tests skip on a production build.
- **Chance at sea:** the browser tests that wait for a meeting at sea depend on luck. They recover from arrivals and homecomings, but can still run long.
- **Old test output folders** (`game\test-results-*`) from the build agents are not in the repository and can be deleted by hand.

## Housekeeping

- **Unused leftovers:** `.xp-hud` rules in `screens/expedition/expedition.css`, `mk-*` / `mh-*` rules in `screens/settlement/settlement.css`, old `economy.ui.market.*`, `known.*`, `routes.*` and `settlements.ui.hall.*` strings, the mead-hall "drink" strings, `faith.ui.seer.scene`, `faith.ui.grove.scene`, `faith.ui.seer.at`, and the `hubPlaceholder` folder (still imported by two tests).
- **Ledger strings** live in `holdings.json`; they belong in `economy.json`.
- **Design document:** `Bardia_Design_and_Build_Plan.md` is not in the public repository (its research chapter describes the old disc). Decide: publish as is, publish without chapters 2 and 3, or keep it private.
- **No license** in the repository yet.

## Still not built

Rival rulers acting on their own, diplomacy, quests and relics, saga goals and victory, the prologue, the duel scene, revolts and attacks on holdings, dismissing men, harvests. Shipbuilding and armoury upgrades still take timber and iron from the town market for free; farms and watchtowers do nothing.
