/**
 * The shared wording of every art prompt (the owner's brief, 2026-11-15: every scene except the map repainted
 * as an artist's rendering of real life in Norway around 700 AD, all in one style, fed one at a time to
 * ChatGPT's image generator). Change the style here and run `npm run tool -- art-prompts`: every prompt in
 * ART_PROMPTS.md is rebuilt with the same words.
 */

/** Which approved style picture the owner attaches with a prompt. */
export type Anchor = 'outdoor' | 'indoor' | 'sea';

/** One picture to paint. */
export interface ArtScene {
  title: string;
  /** Asset id: one already in the manifest, or the id the picture will get. */
  id: string;
  /** Final file under public/assets/. */
  file: string;
  /** Size the game shows it at. */
  size: readonly [number, number];
  /** 'manifest': the id exists today. 'new': the id is registered when the picture exists. */
  status: 'manifest' | 'new';
  /** A season's own painting of the asset `id` (its file is the id's path with `-<season>` added). */
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  anchor: Anchor;
  /** This picture is itself the anchor for its kind (made first, nothing attached). */
  isAnchor?: boolean;
  aspect: '16:9' | '4:3';
  /** Shown small (640×360): keep it simple and bold. */
  small?: boolean;
  /** The game lays text over the left third. */
  textLeft?: boolean;
  /** What is in the picture. */
  scene: string;
  /** Viewpoint and layout. */
  composition: string;
  /** For the owner, outside the prompt. */
  note?: string;
}

/** A batch of pictures made in one sitting. */
export interface ArtGroup {
  title: string;
  /** 1 = seen all the time, 4 = can wait. */
  priority: 1 | 2 | 3 | 4;
  intro: string;
  scenes: readonly ArtScene[];
}

/** The style block that opens every prompt, word for word. */
export const STYLE = `Create one image.

STYLE REFERENCE: If an image is attached to this message, it is a style reference only. Match its brushwork, colours, lighting and level of finish exactly. Do not copy its subject or its composition.

ART STYLE (the same for every picture in this series): A hand-painted historical illustration, like a colour plate in a well-researched history book. Painterly realism: real-looking people, weather, materials and light, but clearly painted with a brush. Visible brushstrokes, opaque paint like oil or gouache on canvas, soft edges in the distance and crisper detail on the main subject. It is an artist's painting of real life. It is not a photograph, not photorealistic, not a 3D render, not a cartoon, not anime and not glossy fantasy concept art. Colours are natural and slightly muted: sea grey, slate blue, pine and moss green, peat brown, weathered timber and undyed wool, with small accents of madder red, woad blue, ochre and firelight orange. Light is natural: soft overcast or low northern sun outdoors, warm firelight and deep brown shadow indoors. People are ordinary, weathered, working people of different ages, calm and unposed, and nobody looks at the viewer.

PERIOD AND PLACE: Unless the scene says otherwise, western Norway and its seas around the year 700 AD, the late Iron Age just before the Viking Age. Long low houses of timber and turf with bowed walls and roofs of turf, thatch or birch bark, smoke rising through a roof opening. Boat sheds on the shore. Open clinker-built ships with one mast, one square woollen sail, oars and a steering oar on the right side. Round wooden shields with an iron boss, spears, axes, long knives and a few swords. A few plain iron helmets; most men are bareheaded or wear wool caps. Wool and linen clothes: tunics, trousers with leg wraps, cloaks pinned with a brooch; women in long wool dresses with a pair of brooches and beads. Everything is hand-made, worn and practical.

NEVER SHOW: horned or winged helmets, fantasy armour, plate armour, fur-and-leather-strap barbarian costumes, war paint, stone castles, glass windows, chimneys, stirrups, modern objects, magic or monsters. No blood or wounds in close view. No text, letters, runes, captions, borders, frames, logos, watermark or signature anywhere in the picture.`;

/** The lines that close a prompt. */
export function formatLines(scene: ArtScene): string {
  const lines: string[] = [];
  if (scene.textLeft) {
    lines.push(
      'Keep the left third of the picture calm and nearly empty (open water, sky, mist or plain ground), because the game lays text over it. Put everything that matters in the right two thirds.',
    );
  }
  if (scene.small) {
    lines.push('This picture is shown small in the game: one clear subject, a few large simple shapes, strong light and dark.');
  }
  lines.push(
    `FORMAT: One painting that fills the whole image from edge to edge, landscape, aspect ratio ${scene.aspect}. Keep faces and anything important away from the outer edges.`,
  );
  return lines.join('\n\n');
}

/** The full text the owner pastes for one picture. */
export function promptFor(scene: ArtScene): string {
  return `${STYLE}\n\nSCENE: ${scene.scene}\n\nCOMPOSITION: ${scene.composition}\n\n${formatLines(scene)}`;
}

/** Shown at the top of ART_PROMPTS.md. `{outdoor}`, `{indoor}` and `{sea}` become the anchor pictures' numbers. */
export const HOW_TO = `## How to use this file

Every picture below has a grey box. The box is the whole prompt: the shared style first, then the scene. Copy the whole box each time, so every picture gets the same style words.

### Set up once

1. In ChatGPT, make a **Project** called "Bardia art" and do all of this inside it. It keeps the chats together.
2. In the project's instructions, paste this:

   > Every image made in this project belongs to one series of paintings for a game. Follow the STYLE section of each prompt exactly and never drift from it. Make exactly one image per message. Never put text, letters or a signature in an image. When I attach an image with a prompt, it is a style reference only: match its brushwork, colours and finish, and do not copy its subject. When I write "Same picture. Change only:", keep everything else as it is.

3. Downloads go in the \`art\\incoming\` folder inside the Bardia folder (next to this file). The folder is already there.

### Step 1: paint the three anchor pictures

These three lock the look for everything else, so spend your time here.

| Anchor | Picture | Save a copy as |
|---|---|---|
| Outdoors | #{outdoor} | \`anchor-outdoor.png\` |
| Indoors, firelight | #{indoor} | \`anchor-indoor.png\` |
| At sea | #{sea} | \`anchor-sea.png\` |

1. Start a new chat in the project, paste the box for #{outdoor}, send.
2. Push it until you like the style. One change per message works best, for example:
   - "Same picture. Change only: more visible brushstrokes, less like a photograph."
   - "Same picture. Change only: colours a little more muted and grey."
   - "Same picture. Change only: more realistic faces and hands."
3. When it is right, download it and save a copy as \`anchor-outdoor.png\`.
4. For #{indoor} and #{sea}, attach \`anchor-outdoor.png\` with the prompt, so all three look like the same painter made them. Save those as the other two anchors.

If you had to change the look a lot to get there, tell me what you changed. I put it into the style block and rebuild this file, so the remaining prompts ask for that look from the start.

### Step 2: every other picture

1. Work one group at a time, in the order below. Start a **new chat** in the project for each group.
2. For each picture: attach the anchor named in its header, paste the whole grey box, send. One picture per message.
3. Attach the anchor again with **every** prompt. It is the strongest thing keeping the style the same.
4. If a size or shape chooser is shown, pick the widest landscape option. The prompt asks for the shape as well. If a picture comes back a little less wide than asked, keep it: I crop it to fit.
5. Look for the usual mistakes before you accept a picture: horned helmets, writing or runes, stirrups, anything modern, a hand with the wrong number of fingers, somebody staring at the viewer.
6. Fix small things by replying: "Same picture. Change only: ..." and one thing. If it takes more than three tries, start over with the prompt.
7. If the look starts to drift after several pictures, start a new chat and attach the anchor again.

### Versions of the same place

For winter, night or a burned version of a picture you already have, stay in that picture's chat and reply:

> Same picture, same place, same buildings and people in the same positions. Change only: (what is different).

That keeps the place the same. The few such versions in this file have their own prompt as well, in case the chat is gone.

### Seasons

Any picture can have its own painting for spring, summer, autumn or winter; the game shows it in that season and the original in the others. Make a season's painting by editing the original: attach the finished picture as the image to edit and ask for the season only, keeping the framing, the buildings, the people, what they are doing, the time of day and the style. A painting made that way lines up with the original, so the click labels in the village and the rooms fit it too.

1. Save each one in \`art\\incoming\\seasonal\` as the original's file name with the season added: \`001-panorama-home-skarn-spring.png\`, \`-fall.png\` for autumn, \`-winter.png\`.
2. List them in \`art\\incoming\\seasonal\\manifest.json\` (each picture's number, asset id and game path, and for each season the file name and the game path \`<path>-<season>.jpg\`).
3. Tell me they are there. I cut them to the game's size and put each beside its original.

A season painted from its own prompt (#002) is a new painting rather than an edit, so things in it stand a little apart; I place its labels separately.

### Saving

1. Download each picture at full size.
2. Name it exactly as its header says and put it in the \`art\\incoming\` folder.
3. Do not put pictures into the game's folders yourself. Tell me a batch is in \`incoming\`, and I crop each one to the game's size, put it in place, and move the click labels in the village and the rooms to match what was painted.

### If something goes wrong

- **"You've reached the image limit":** wait and carry on later. Nothing else needs to change.
- **A picture is refused** (a few of the battle scenes might be): send it once more. If it is refused again, delete the sentence it objects to and send again.
- **People look like the same person in every picture:** add one line to the scene, for example "the smith is fair-haired and heavier".

### What is not in this file

- The map (you said it is fine as it is).
- The land battle and sea battle fields. They are seen from above and built from small sprites and tiles, which is a different kind of art from a painting.
- Character portraits. They are built from layers (hair, beard, face, clothes) so that people can age, and need their own instructions.
- Icons.

Ask for any of these and I write that set too.`;
