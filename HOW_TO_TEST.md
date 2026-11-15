# Bardia: how to play-test this build

**Build date:** 14 November 2026 (second build of the day, after the first play-test)

## Start the game

Double-click `Play Bardia.cmd` in this folder. It builds the game and opens it in your browser at http://localhost:4180. Leave the black window open while you play; close it to stop.

Start a **New Saga**. Saves from before this build may not load cleanly.

## What changed since your first play-test

- **You steer.** On the map your expedition is a little longship. Hold **W A S D** or the **arrow keys** to sail it; time passes while you hold a key and stops when you let go.
- **Touch a village to go in.** Sailing (or walking) into a settlement brings up its scene.
- **Scenes instead of pop-ups.** Meeting a ship or reaching a village sounds a horn, shows a banner, then changes the whole screen to a picture of what your crew sees, with up to four big choices.
- **March overland.** The expedition planner now asks "Set sail" or "March overland". A march works while the harbour is frozen.
- **Sea battles on screen.** You command your ships yourself.
- **Simpler menus.** Bigger text, about half as much on each screen, and a two-sided slider wherever something moves between two places (town and expedition, storehouse and market).

## Test 1: a sea battle in one click (3 minutes)

1. Main menu → **Skirmish** → pick one of the three cards under **At sea**.
2. Read the "How to command" card, then press **Set sail**.
3. Click one of your ships (or press Ctrl+A for all), then right-click an enemy ship to attack it. Right-click open water to sail there.
4. On the ship's card choose **Boarding** or **Arrows**. Speed buttons at the top: 1×, 2×, 4×. Space pauses.
5. **Esc** opens the battle menu; "Let your captains finish it" plays out the rest.
6. The battle ends on a summary of ships sunk, ships taken and men lost.

What to look for: do ships go where you send them, is it clear who is winning, does it feel like a fight.

The land battle is still under Skirmish, in the **On land** section.

## Test 2: the village and its menus (5 minutes)

1. Main menu → **New Saga** → **Quick Start**.
2. The village picture now fills the middle. On the right, the Counsel gives one piece of advice at a time; the arrow steps through them.
3. Click each building and see whether it reads at a glance:
   - **Great Hall**: your realm in five sentences, four big doors. Try **Muster**: pick a kind of warrior, drag the handle between "Stay on the farms" and the war-band.
   - **Shipyard**: ships as picture cards; pick a kind of ship and build it.
   - **Smithy**: two cards, armour and weapons.
   - **Market**: click a good (Salt), drag the handle between your storehouse and the market, then **Strike the deal**.
   - **Mead-hall**: four big choices.
   - **Longhouse**, **Seer's hut**, **Grove**.
4. Great Hall → **Affairs of State**: taxes as four cards, buildings, and a slider for the garrison.
5. Top-right icons: character sheet, family, ledger, chronicle. Hover your portrait (top left) for renown, honor and dread.

What to look for: is each screen calm and readable now, is anything you want missing, is anything still too busy.

## Test 3: march overland (5 minutes, works on day one)

1. From the village, click **Plan an expedition**.
2. Drag the handles to choose how many men go and how much food they carry. Both sides change as you drag.
3. At the bottom choose **March overland**, then **March out**.
4. On the map your war-band is a banner-bearer. Hold **W A S D** or the arrow keys to walk; let go to halt.
5. Walk into a settlement, or use **March to** and pick one, then hold a speed button at the top to let time run.
6. On arrival you get the banner, then the full-screen scene: **Enter**, **Raid**, **Assault** or leave.
7. To end the march: press **March home** from anywhere, or walk back into your own village and press **Come home**.

## Test 4: sail (10 minutes)

1. If the harbour is frozen, the Counsel has a **Wait for the thaw** button.
2. **Plan an expedition** → leave it on **Set sail** → **Launch**.
3. Hold **W A S D** or the arrow keys: the ship sails and the date moves. Let go: it stops. Drag the map, or hold Shift with the keys, to look around; the ship button on the right brings the view back.
4. Sail into any harbour: banner, then the arrival scene. **Enter** shows the village from the quay with its market and mead-hall. **Raid** leads to "Before the battle": **Take the field** or **Let the captains decide**.
5. Or use **Chart a course**, pick a harbour, and press a speed button to let the ship sail itself.
6. Somewhere at sea you will meet other ships: horn, banner, scene. Keys 1 to 4 pick a choice. **Attack** leads to the new sea-battle card: **Take the helm**.
7. Stop against a coast and press **Go ashore** to walk a party inland with the same keys; walk back onto the ship to re-board.
8. To end the voyage: press **Sail home** from anywhere, or steer into your home harbour and press **Come home**. At the **Market**, **Sell all loot**.

What to look for: does steering feel right (speed, turning, the camera), do the scenes get your attention, was it always clear what to do next.

## Test 5: your own ruler (3 minutes)

Main menu → **New Saga**, and go through the full wizard instead of Quick Start. Then open your character sheet (top-right, or click your portrait). Your choices should be there.

## Not built yet

- Rival rulers do not act on their own: no enemy fleets sail, nobody raids you.
- Diplomacy (audiences, envoys, alliances, marriage offers).
- Quests, relics and legends.
- The saga goals, ambitions and winning the game.
- The opening story (the prologue).
- Duels on screen. A duel is settled from the odds.
- Revolts, and attacks on your holdings.
- Dismissing men once mustered.
- Art, music and voices are placeholders drawn by the program. Every picture can be replaced by a real painting later without changing the game.

## Known rough edges

- The steering keys cannot be changed in Options yet, and a gamepad does not steer.
- Rivers stop a war-band you steer by hand, except where a road crosses. "March to" finds its own way across.
- In a sea battle, tired crews can trade arrows for a long while near the end. "Let your captains finish it" ends it.
- A captain duel after a boarding is settled on the spot, not fought.
- Shipbuilding and armoury upgrades take timber and iron from the town market for free instead of from your storehouse.
- Farms and watchtowers can be built but do nothing yet.
- Loading a save made in the middle of a battle restarts that battle.
- The odds shown before a battle are the auto-resolve odds. A battle you fight yourself can go quite differently.
- Removed to keep the menus simple: the mead-hall's "Have a drink", the inbox's filters by importance, the market's big price table (now "Other ports" under a deal).

## What to send back

For anything wrong, a sentence on what you did and what you saw is enough. A screenshot helps for anything visual.
