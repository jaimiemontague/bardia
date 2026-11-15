# Bardia: how to play-test this build

**Build date:** 15 November 2026 (rooms inside the buildings; battles fought with the keys)

## Start the game

Double-click `Play Bardia.cmd` in this folder. It builds the game and opens it in your browser at http://localhost:4180. Leave the black window open while you play; close it to stop.

Start a **New Saga**. Saves from before this build may not load cleanly.

## What changed since your last play-test

- **You walk into buildings.** Clicking a building in the village changes the whole screen to the inside of it. The menus are still there, but each one now belongs to a person in the room: click the person to open it.
- **Land battles are fought with the keys.** Hold **W A S D** to move your squads, **Space** to attack.
- **Sea battles are fought from the helm.** **W A S D** steers your own ship. Hold **Space** to draw, let go to loose your arrows. You have to aim.
- **Pause is now P** in both kinds of battle, because Space attacks.
- **The pictures are still stand-ins** drawn by the program. `ART_PROMPTS.md` in this folder has a prompt for every picture, ready for an image generator.

## Test 1: walk into the buildings (5 minutes)

1. Main menu → **New Saga** → **Quick Start**.
2. Click a building in the village. The screen becomes the room. Each person you can click has a name plate and a number.
3. Click a person (or press their number). Their menu opens beside them. **Back** returns to the room; **Back to the village** leaves. Esc does the same, one step at a time.

| Building | Who is there | What they give you |
|---|---|---|
| Great Hall | The Hirdmaster (on the high seat) | Your realm in five sentences, **Muster**, **Plan an expedition** |
| | The Steward (by the chest) | The **Ledger** |
| | The Lawspeaker (with the staff) | **Affairs of State** |
| Smithy | The Smith | Armour and weapons |
| Shipyard | The Shipwright | Order a ship; what is on the slipways |
| | Ships on the strand | Your ships and repairs |
| Market | The Merchant | Sell all loot, buy provisions, every good, trade routes |
| Mead-hall | The Hall-keeper | Ask for news, buy a round |
| | The Travellers | Hear the travellers |
| | The Sellswords | Hire fighters |
| Longhouse | The House-elder | Who holds which office; appoint and relieve |
| Seer's hut | The Seer | Read the omens; tend the wounded |
| Grove | The Grove-keeper | The gods and an offering |

What to look for: does it feel like going inside, is it obvious who to click, is anything now harder to find than it was.

## Test 2: a land battle with the keys (3 minutes)

1. Main menu → **Skirmish** → a card under **On land**.
2. Read the "How to command" card, then press **To battle!** (or just press a movement key).
3. Your whole war-band is selected at the start.

| Key | What it does |
|---|---|
| W A S D or the arrow keys | Move the selected squads. Let go and they halt. They fight whatever they meet. |
| Shift (held) | Run |
| Space | Swordsmen and spearmen charge the enemy in front of them. Archers: hold to aim (a marker runs out and back), let go to loose. |
| 1 to 8, Tab | Pick one squad. Ctrl+A picks all. |
| P | Pause |
| C | Bring the camera back to your squads |
| Esc | The battle menu; "Let the captains finish it" plays out the rest |

Right-click orders still work if you want them. Q, E, R, T, F and Backspace do what they did before.

What to look for: does moving feel direct, can you tell which squads you are driving, is charging with Space satisfying, is aiming the archers too hard or too easy.

## Test 3: a sea battle from the helm (3 minutes)

1. Main menu → **Skirmish** → a card under **At sea**.
2. Read the "How to command" card, then press **Set sail**.
3. Your ship has a gold ring round it.

| Key | What it does |
|---|---|
| W | Make way (row or sail ahead) |
| S | Slow down and back water |
| A, D | Turn to port, turn to starboard |
| Space | Hold to draw: a marker sweeps out from the side facing the enemy and back. Let go to loose. The arrows take a moment to fly, so aim ahead of a moving ship. |
| G | Throw grapnels when you lie alongside an enemy (and cut the lines when you are boarded) |
| 1 to 9, Tab | Take the helm of another of your ships |
| P | Pause |
| C | Bring the camera back to your ship |

The strip at the bottom left says whether your bows are ready ("Bows ready", "Drawing…", "Nocking…"). Your other ships follow you and shoot by themselves. The ship you steer only shoots when you do.

What to look for: does the ship feel like it has weight, is it fun to turn side-on and time the shot, is hitting too hard or too easy, is it clear when you can shoot again.

## Test 4: march overland (5 minutes, works on day one)

1. From the village, click **Plan an expedition** (or Great Hall → the Hirdmaster → Plan an expedition).
2. Drag the handles to choose how many men go and how much food they carry.
3. At the bottom choose **March overland**, then **March out**.
4. On the map hold **W A S D** or the arrow keys to walk; let go to halt.
5. Walk into a settlement. You get the banner, then the full-screen scene: **Enter**, **Raid**, **Assault** or leave. **Raid** → **Take the field** puts you in a land battle with the new keys.
6. To end the march: press **March home**, or walk back into your own village and press **Come home**.

## Test 5: sail (10 minutes)

1. If the harbour is frozen, the Counsel has a **Wait for the thaw** button.
2. **Plan an expedition** → leave it on **Set sail** → **Launch**.
3. Hold **W A S D** or the arrow keys to sail. Sail into any harbour for the arrival scene.
4. Somewhere at sea you will meet other ships. **Attack** leads to the sea-battle card: **Take the helm** puts you in a sea battle with the new keys.
5. To end the voyage: press **Sail home**, or steer into your home harbour and press **Come home**. Then Market → the Merchant → **Sell all loot**.

## Not built yet

- Rival rulers do not act on their own: no enemy fleets sail, nobody raids you.
- Diplomacy (audiences, envoys, alliances, marriage offers).
- Quests, relics and legends.
- The saga goals, ambitions and winning the game.
- The opening story (the prologue).
- Duels on screen. A duel is settled from the odds.
- Revolts, and attacks on your holdings.
- Dismissing men once mustered.
- Final art, music and voices. Every picture can be replaced by a painting later without changing the game.

## Known rough edges

- **Rooms abroad:** visiting a foreign settlement still shows its market and mead-hall as the older screens, not as rooms.
- **Small windows:** in a small window a few room menus need a little scrolling (the market, the Longhouse's offices, the last god in the Grove).
- **A menu can cover people:** when a menu is open on the left, the people on that side are behind it. Press Back or a number key.
- **Looking around a land battle** needs the middle mouse button; the arrow keys now move your squads. C brings the view back.
- **Sail or oars:** the ship you steer picks sail or oars by itself.
- **The battle keys cannot be changed** in Options yet, nor the steering keys on the map. A gamepad does not steer.
- In a sea battle, tired crews can trade arrows for a long while near the end. "Let your captains finish it" ends it.
- A captain duel after a boarding is settled on the spot, not fought.
- Shipbuilding and armoury upgrades take timber and iron from the town market for free instead of from your storehouse.
- Farms and watchtowers can be built but do nothing yet.
- Loading a save made in the middle of a battle restarts that battle.
- The odds shown before a battle are the auto-resolve odds. A battle you fight yourself can go quite differently.

## What to send back

For anything wrong, a sentence on what you did and what you saw is enough. A screenshot helps for anything visual.
