# Dropping in final art, music and voice

Every picture, track, sound and voice line in Bardia is referenced by an **asset id** (for example
`portraits.layer.hair.braids-two` or `menu.backdrop.main`), never by a file name. Each id has an entry
in the asset manifest (`src/content/assets/manifest/<area>.json`) that says:

- **where its final file goes**, a path under `public/assets/`;
- **what size or length** the game expects;
- **how to draw a stand-in** (a procedural placeholder) until that file exists.

When a file is present at that path, the game uses it. When it is not, the game draws the
placeholder. Swapping in final assets needs **no code changes**.

`ASSET_LIST.md` (generated, next to this file) lists every id with its path, size or duration, a short
brief and its status, **final** or **placeholder**.

---

## 1. Quick start

1. Open `ASSET_LIST.md` and find the asset id you are delivering. Note its **path** and **size**.
2. Save your file at `public/assets/<path>`, creating folders as needed. Example: the id
   `menu.backdrop.main` with path `menu/backdrop-main.png` goes to
   `public/assets/menu/backdrop-main.png`.
3. Run the index tool from the `game` folder:

   ```
   npm run tool -- assets-index
   ```

   It rewrites `public/assets/final-index.json` (the list the game reads at runtime) and
   `ASSET_LIST.md`, and prints warnings: wrong size, wrong length, a season painting with no base
   file, or a file no id uses (usually a typo in the name).
4. Check the result in the gallery (section 6). The **Manifest** tab shows the id as **final**.

Delivering a batch is the same: drop all the files in, then run the tool once.

---

## 2. Folder layout and naming

- Files live under `public/assets/` at exactly the manifest path: **lower case, words separated by
  hyphens**, with folders by area (`portraits/…`, `menu/…`, `music/…`, `sfx/…`, `voice/…`).
- The file name comes from the manifest, never from the art. If a name is wrong, the tool lists the
  file under *Files no manifest entry uses*.
- **Another format is fine.** The path says `.png` but you have a `.webp`? Save it with the same name
  and the new extension (`menu/backdrop-main.webp`). The game accepts, for images: `png`, `webp`, `jpg`,
  `jpeg`, `avif`, `svg`; for audio: `ogg`, `opus`, `mp3`, `m4a`, `wav`, `flac`.
- Do not put anything else in `public/assets/`; every file there ships with the game.
  `README.md` and `final-index.json` are ignored by the tool.

---

## 3. Formats and sizes

### Images

| Kind | Format | Size | Notes |
|---|---|---|---|
| Panoramas, interiors, vignettes, menu backdrops | PNG, or WebP/JPEG (opaque art) | As listed (e.g. 1600×900, 1920×1080, 640×360) | A painting may have its own version for a season (`-winter` and so on, section 5). Nothing else is graded: what you paint is what the player sees. |
| Portrait layer pieces | PNG with transparency | **512×640** each | See section 4. |
| Icons | PNG with transparency (or SVG) | As listed (usually 64×64) | Larger art at the same aspect ratio is scaled down. |
| Relic emblems | PNG with transparency | 256×256 | Round emblem on a transparent background. |
| Unit sprites | PNG with transparency | Frame size × frames | Seen from above, **facing up (north)**. A strip of *N* frames is *N* frames wide: a 48×48 sprite with 6 frames is one 288×48 file, frames left to right. |
| Ship sprites | PNG with transparency | As listed (96×200 by default) | Seen from above, **bow up**. |
| Battle ground tiles | PNG | As listed (128×128 by default) | Must tile seamlessly on all four edges. |

General rules:

- **Colour:** sRGB, 8 bits per channel. No embedded colour profiles other than sRGB.
- **Size:** deliver exactly the listed size where you can. A file at the same aspect ratio but larger
  (for example 2× for crispness) is accepted and scaled; the tool notes it. A different aspect ratio
  is cropped or stretched, and the tool warns.
- **Anchor:** sprites with an `anchor` in the manifest are positioned on that point (0 to 1 across,
  0 to 1 down; the default is the centre). Keep the figure's feet or the hull's centre there.

### Audio

| Kind | Format | Notes |
|---|---|---|
| Music and stems | OGG Vorbis or Opus, 44.1 or 48 kHz, stereo | Length as listed (±15% is fine). Loops (`loop`) must loop seamlessly: no fade in or out, matching ends. Battle stems (low, mid, high) must be the **same length** and start together. Target about −16 LUFS integrated. |
| Sound effects | OGG (WAV accepted) | Trim silence at the start; peaks at or below −1 dBTP. |
| Voice | OGG, mono, 48 kHz | One file per line. Lines are named after their text's locale key (each voice entry in `ASSET_LIST.md` gives the folder and the naming pattern). Target about −18 LUFS. Subtitles are always shown, so the delivered take must match the text. |

---

## 4. Portraits (layered)

Portraits are **built from layers**, so that thousands of characters can be drawn from a few hundred
pieces and every character **ages** on screen (greying, lines, beard growth). Each piece is a separate
asset id `portraits.layer.<slot>.<variant>` with its own file in `public/assets/portraits/layers/`.
You can replace them **one at a time**: every piece you deliver replaces the procedural one, and the
rest stays procedural until you get to it. The game composes the portrait from the pieces at
display time.

**Canvas.** Every piece is a **512×640 PNG with transparency**, painted in place on the same canvas,
so the pieces line up when stacked. Adult proportions (child and youth faces sit lower and smaller):

| Guide | Position (px) |
|---|---|
| Centre line | x = 256 |
| Crown of the head | y ≈ 126 |
| Eye line | y ≈ 248 |
| Tip of the nose | y ≈ 303 |
| Mouth | y ≈ 337 |
| Chin | y ≈ 388 |
| Shoulder line | y ≈ 458 |

The gallery's **Portraits → Layer pieces** section shows every piece over a faint head-and-shoulders
guide; a screenshot of it is a good template.

**Stacking order, bottom to top:** background · hair behind the shoulders (`hairBack`) · body and
clothing · face · scars · age overlay · beard · hair · headwear · accessories.

**Tinting.** One painted piece serves every colour:

| Slot | Paint it | The game multiplies it by |
|---|---|---|
| `hair`, `hairBack`, `beard` | in **greyscale** (light grey where the hair is lightest) | the character's hair colour, greyed with age |
| `face` | in **greyscale** shading | the character's skin tone |
| `body` | the cloth in **greyscale**; metal, trim and brooches in full colour | the clothing colour |
| everything else | in full colour | nothing |

**Whole portraits.** The id `portraits.character` is the composed portrait. A file at its path would
replace *every* generic portrait with one picture, so do not deliver it; deliver the pieces. Special
characters can get their own ids with a fixed portrait.

---

## 5. Season and time of day

Every painting is listed once per view, as one asset id, and is shown in every season and at every hour.
Paint it as you want it to be seen in general; the base file is what the game shows unless a season has its
own painting.

**A painting for one season.** Save it next to the base file, with the season added to the file name:

| Base file | Winter painting |
|---|---|
| `hub/panorama-home-skarn.jpg` | `hub/panorama-home-skarn-winter.jpg` |

- The seasons are `spring`, `summer`, `autumn` and `winter`. Any accepted image format works, and it need
  not match the base file's (`panorama-home-skarn-winter.webp` next to a `.jpg` is fine).
- Make as many or as few as you like. No manifest entry and no code is needed: the file name is the whole
  rule. Run the index tool afterwards.
- **In that season** the game shows that season's painting. **In any other season**, or when the season has
  no painting of its own, it shows the base file. The base file is always required: a season file alone is
  ignored (the placeholder shows) and the tool warns.
- A season's painting has the same size as the base file. The tool checks it like the base file and
  lists it in `ASSET_LIST.md` with the id (for example "final; own paintings for autumn, winter").
- Do not give a base file a name that ends in a season (`...-winter.png`): the game would read it as a
  winter painting of another id. No manifest path does.

**It is a new painting, not a recolour.** Things in a winter painting may sit a little apart from where
they are in the summer one: a longhouse a few pixels over, a different hearth. Anything the game places
over a painting (the village's building labels, the people you click in a room) therefore keeps its own
table of positions **per painting**, and falls back to the base file's table for a season without one. If
you move things in a season's painting, tell the developer, so that the table gets an entry.

**What the game does about time of day and season grading.** Nothing, for a final painting. A final file
is drawn exactly as delivered, scaled to fill the screen (`object-fit: cover`), in every season and at
every hour; no colour filter is applied to it. (The procedural placeholders are drawn for the season and the
hour; the `panorama` generator can also hand a grading filter to a final file, but no screen in the game
passes it a season or an hour, so it never takes effect.) If a view should look different in winter, at
night or at dusk, that needs its own painting: for seasons, the file name rule above. For an hour of the
day, ask for a separate asset id.

---

## 6. Checking your work in the gallery

1. Start the game in development mode: `npm run dev`.
2. Open the gallery:
   - in the app: `http://localhost:5173/?gallery` (add `&galleryTab=manifest` to jump to a tab), or
     type `__bardiaOpenAssetGallery()` in the browser console;
   - on its own page: `http://localhost:5173/src/client/screens/assetGallery/standalone.html`.
3. The **Manifest** tab lists every id with a preview and its status, **final** or **placeholder**.
   Filter by id, path or generator. The summary line counts finals and placeholders.
4. **Ignore final files** shows the placeholders again, so you can compare. **Placeholder label**
   stamps every stand-in with its name, which helps spot placeholders in screenshots.
5. The other tabs show every placeholder generator and its variants: portraits (with the aging strip
   and every layer piece), panoramas, interiors, vignettes, the icon set, relics, unit and ship
   sprites, ground tiles and fallback cards.

In development the game also checks the server directly for files the index does not list yet, so a
freshly dropped file usually shows up on reload even before you run the tool. **Run the tool anyway**:
the packaged game (and its desktop build) only knows the files listed in `final-index.json`.

---

## 7. The index tool

```
npm run tool -- assets-index           # scan, then write public/assets/final-index.json and ASSET_LIST.md
npm run tool -- assets-index --check   # write nothing; fail if either file is out of date (for CI)
npm run tool -- assets-index --strict  # also fail on size/length warnings and unused files
```

- `final-index.json` records each file's size in bytes, a checksum (so a replaced file is never served
  from a stale browser cache), and the pixel size or duration the tool could measure (PNG, JPEG,
  WebP, GIF, SVG; WAV, OGG, FLAC).
- Both files are deterministic: running the tool twice without changes produces identical files.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| The gallery still shows the placeholder | Check the path and spelling against `ASSET_LIST.md` (lower case, hyphens). Run the tool. Reload without cache (Ctrl+F5). Make sure **Ignore final files** is off. |
| The tool says *Files no manifest entry uses* | The file name or folder does not match any id's path. Rename it. |
| A season painting does not show | The base file must exist too. The name is the base name plus `-spring`, `-summer`, `-autumn` or `-winter` (lower case), in the same folder. Run the tool and reload without cache. The game only shows it in that season (the saga's date decides). |
| The tool warns about size | Re-export at the listed size, or at a larger size with the same aspect ratio. For sprite strips, the width is frame width × frames. |
| A portrait piece is misaligned | Paint on the full 512×640 canvas at the guide positions above; do not crop to the drawn area. |
| Hair or skin pieces come out too dark | Paint them lighter: tinting multiplies, so white stays the pure tint and black stays black. |

---

## 9. For developers: adding manifest entries

Each area owns `src/content/assets/manifest/<area>.json` (ids start with `<area>.`). An entry:

```json
"hub.panorama.homeSkarn": {
  "kind": "image",
  "path": "hub/panorama-home-skarn.png",
  "size": [1600, 900],
  "placeholder": {
    "generator": "panorama",
    "params": { "culture": "skarn", "tier": "capital", "economy": "thriving" },
    "label": "Home hall panorama, Skarn: fjord, longhouses, ships on the strand"
  }
}
```

The `label` is the brief the owner reads in `ASSET_LIST.md`: describe what the final art should show.
Callers pass runtime params that are merged over the manifest's (`useAsset(id, { season, time })`).
In React use `<AssetImage id … altKey …/>` or `useAsset`; elsewhere `resolveAsset` /
`resolveAssetAsync` (`src/client/assets/index.ts`). Character portraits:
`useAsset('portraits.character', portraitParamsForCharacter(character, state.time.hour))`.
Inline UI icons that follow the text colour: `<GlyphIcon glyph="silver" />`.

Code that must keep working without the asset library (the shell discovers it with
`import.meta.glob('../assets/resolver/index.ts')`) calls `resolvePlaceholderUrl(id, params?)` from
`src/client/assets/resolver/index.ts`: the placeholder data URL of a registered image id, or `undefined`
(unknown id, audio, unregistered generator) so the caller can show its own fallback.

The gallery's **Manifest** tab lists recipe problems (unknown generators or parameter values).

### Placeholder generators

All generators are deterministic: the same params always draw the same picture. Unknown params are
ignored and bad values fall back to defaults; an unknown generator draws a labelled card.

| Generator | Draws | Key params |
|---|---|---|
| `portrait` | A layered character portrait | `seed`, `sex`, `culture`, `age`, `rank` (common, warrior, noble, ruler, clergy, seer), `faith`, `traits` (comma list: scarred, oneEyed, towering, slight, sickly, strong), `wounded`, `dead`, `background`, `layer.<feature>` picks |
| `portraitLayer` | One portrait layer piece over a faint guide | `slot`, `variant` |
| `silhouette` | A hooded unknown figure | `seed` |
| `panorama` | A settlement seen from the water or the approach | `culture`, `tier` (hamlet … templeStead), `economy` (ruined … thriving), `season`, `time` (dawn, day, dusk, night), `terrain` (auto, fjord, coast, river, plain), `seed`, `focus` (0.3 to 0.8: where the settlement centre sits across the width, for views shown centre-cropped), `scene` presets (nightFjord, homeHallDusk, homeHall, burningTown, goldenCity, riverFort, steppeCamp) |
| `interior` | A building interior or yard | `kind` (greatHall, meadHall, smithy, shipyard, market, seerHut, grove, church, longhouse, leadersHall) or `building` (buildings.json id), `culture`, `light` (day, night), `season`, `seed` |
| `vignette` | An event illustration | `scene` (storm, voyage, landing, raid, funeral, wedding, birth, ravens, comet, northernLights, thing, holmgang, sickness, harvest, famine, wreck, hunt, envoy, trade, shieldWall, fog, barrow, captivity, feast, storehouse, shore, aftermath, nightFjord; aliases granary, fields, hallFeast, skald, winterShore, shipAtSea, battlefield, menu), `palette` (winter, summer, spring, autumn, firelight, overcast, dusk, dawn, night, day), `culture`, `other`, `season`, `time`, `seed` |
| `menuBackdrop` | A large title painting: by default a longship crossing a moonlit fjord under the northern lights, composed to leave the left third dark for the menu | as `vignette` (default scene `nightFjord`) |
| `icon` | One of ~170 glyphs | `glyph` (glyph id or a content id: goods, ship types, skills, attributes, gods, faiths, buildings, units, omens, seasons), `style` (carved, flat, ink, outlined), `badge`, `color`, `field`, `culture` |
| `relic` | A relic emblem (§21.2) | `relic` (drownedBell, ravenQuill, anvilShard, oathstone, goldenSheaf, emberCloak, whaleboneHorn, grayQueensComb, sailOfSevenWinds, harpOfHollowBone, ironSeed, firstWolfPelt, moonSilverScales, weepingShield, salthasPearl, highKingsCrown), `seed` |
| `unitSprite` | A soldier, rider or animal from above; strips when `frames` > 1 | `unit` (balance.units id) or `kind`, `culture`, `team` (player, enemy, ally, neutral), `anim` (idle, walk, attack, shoot, die, rout), `facing`, `ring` |
| `shipSprite` | A ship from above, bow up | `ship` (karvi … riverboat), `culture`, `team`, `state` (intact, damaged, burning, wrecked), `sail` (set, furled) |
| `terrainTile` | A seamless battle ground tile | `biome` (grass, forest, marsh, sand, snow, rock, mud, field, road, shallows, water, heath), `seed` |
| `card` | A labelled card (also the fallback for unknown ids) | `title`, `subtitle`, `glyph`, `tone` (oak, parchment, iron) |

Audio placeholders (`kind` music, sfx or voice) are synthesised by the audio system, which registers
its own generators (`registerGenerator`) under its ids.

---

## 10. Licensing

Final art, music and voice must be licence-clean, and AI-generated content must be disclosed where
storefronts require it (design §27.3). Keep the source files (layered paintings, project files,
stems) outside `public/assets/`; only the delivered files belong there.
