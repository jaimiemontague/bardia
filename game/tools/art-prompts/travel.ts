/** Art prompts for reaching and visiting settlements, the aftermath of an assault, and meetings at sea and on the march. */
import type { ArtGroup, ArtScene } from './style';

const FROM_OUR_BOW = `Seen from the deck of our own ship as it comes in from the sea. The carved stem-post of our ship and a little of its rail rise in the bottom right corner, with the back of one of our crew.`;

const ARRIVAL_VIEW = `Eye level from our own deck, looking across a stretch of open water to the shore. The settlement sits in the right two thirds of the picture, in the middle distance, with the land rising behind it.`;

function arrival(tier: string, fileTier: string, title: string, scene: string, extra: Partial<ArtScene> = {}): ArtScene {
  return {
    title: `Arriving by sea: ${title}`,
    id: `settlements.scene.arrival.${tier}`,
    file: `settlements/arrival-${fileTier}.jpg`,
    size: [1920, 1080],
    status: 'manifest',
    anchor: 'sea',
    aspect: '16:9',
    textLeft: true,
    scene: `${FROM_OUR_BOW} ${scene}`,
    composition: ARRIVAL_VIEW,
    ...extra,
  };
}

const ON_THE_QUAY = `We have just stepped ashore and stand on the landing place, looking up at the settlement close above the strand. Mooring posts, a coil of rope and a barrel stand in the near foreground.`;

const VISIT_VIEW = `Eye level, standing on the landing place. The settlement fills the right two thirds, close enough to see people's faces in the middle distance. The left third is open water and sky with one moored boat at most.`;

function visit(tier: string, fileTier: string, title: string, scene: string): ArtScene {
  return {
    title: `Ashore: ${title}`,
    id: `settlements.scene.visit.${tier}`,
    file: `settlements/visit-${fileTier}.jpg`,
    size: [1920, 1080],
    status: 'manifest',
    anchor: 'outdoor',
    aspect: '16:9',
    textLeft: true,
    scene: `${ON_THE_QUAY} ${scene}`,
    composition: VISIT_VIEW,
  };
}

const SEA_VIEW = `Eye level from our own deck, looking forward over the bow. The carved stem-post of our ship and a little of its rail rise in the bottom right corner. The other ships are in the right two thirds of the picture.`;

const LAND_VIEW = `Eye level, standing among our own men. Two of our spear shafts and the rim of a round shield show at the bottom right corner. The others are in the right two thirds of the picture.`;

export const TRAVEL_GROUPS: readonly ArtGroup[] = [
  {
    title: 'Arriving at a settlement',
    priority: 2,
    intro: 'Shown when the ship reaches a place, before the player chooses to enter, trade or raid. One picture for each kind of place.',
    scenes: [
      arrival(
        'hamlet',
        'hamlet',
        'a hamlet',
        `Ahead lies a hamlet: three or four turf longhouses and one boat shed above a stony beach, under bare green hills. Two small boats are drawn up, fish dry on wooden racks, and a few sheep graze. A woman and a child have stopped their work to stare at us.`,
      ),
      arrival(
        'village',
        'village',
        'a village',
        `Ahead lies a fishing and farming village: a dozen turf longhouses along a curved strand, with a short timber jetty, several boats and one ship drawn up on the shingle, a low wattle fence, small fields behind and smoke rising from many roofs. People are gathering on the shore to see who is coming.`,
      ),
      arrival(
        'town',
        'town',
        'a town',
        `Ahead lies a northern trading town: fifty or more timber houses crowded behind a curved earth bank topped with a timber palisade, with a gate facing the harbour. Three timber jetties have ships moored at them, there are boat sheds along the shore, and one large hall roof stands above the rest. A watchman on the bank is pointing at us.`,
      ),
      arrival(
        'city',
        'city',
        'a city',
        `Ahead lies the greatest town for many days' sail: hundreds of roofs behind a high earth rampart and palisade with timber gate towers. Long timber quays are crowded with ships of many kinds, with warehouses behind them. On rising ground inside stand a great hall and a tall carved temple hall. A haze of hearth smoke hangs over everything.`,
      ),
      arrival(
        'capital',
        'capital',
        "a king's seat",
        `Ahead lies a king's seat: a huge royal hall with a high shingled roof and carved, painted gables on a rise above the harbour, lesser halls gathered round it, and the grassy burial mounds of old kings along the ridge behind. A strong palisade with a gate tower guards the landing. The harbour is full of warships with shields along their rails, and banners fly from tall poles.`,
      ),
      arrival(
        'cloister',
        'cloister',
        'a cloister',
        `This scene is in another land, far to the west. Ahead, on a rocky headland, lies a small cloister of a quiet faith whose sign is a lantern: a ring wall of dry stone enclosing a plain little stone chapel with a lit lantern hanging above its door, a cluster of round stone huts shaped like beehives, and a walled vegetable garden. A wooden landing stage lies below. Brothers in undyed wool robes have stopped work to watch us. There are no crosses anywhere.`,
      ),
      arrival(
        'fortress',
        'fortress',
        'a fortress',
        `Ahead lies a fortress: a great ring fort on a headland, its high rampart of stone and turf crowned with a timber palisade and a fighting platform, with a single gate tower over the landing. Spear points and a few helmets show along the wall, an iron fire basket for a beacon stands on the highest point, and a few boats lie inside a small guarded cove.`,
      ),
      arrival(
        'emporium',
        'emporium',
        'a trading strand',
        `Ahead lies a trading strand in the market season: a long beach lined with rows of booths, tents and small workshops, with the smoke of craftsmen's fires above them. Dozens of ships from many lands are drawn up side by side or lie at anchor, broad-bellied traders among slim northern ships. Crowds move between the booths with pack ponies. There is no wall, only a low boundary ditch.`,
      ),
      arrival(
        'templeStead',
        'temple-stead',
        'a holy place',
        `Ahead lies a holy place: on a green rise above the landing stands a tall timber temple hall with a steep roof in stacked tiers and carved posts at its door, a row of great burial mounds beside it and an ancient grove behind. A road lined with carved wooden posts leads up from the shore. A few pilgrims climb it, and a priest waits at the top with a white horse.`,
      ),
      arrival(
        'raided',
        'raided',
        'a place raided not long ago',
        `Ahead lies a village that was raided a few days ago: charred roof frames, two houses still smouldering with thin black smoke, and an empty strand with one burned boat and scattered belongings. Crows sit on the fence posts. No people are in sight except one small figure watching from far up the hillside.`,
      ),
      {
        title: 'Arriving overland',
        id: 'settlements.scene.overland',
        file: 'settlements/arrival-overland.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'outdoor',
        aspect: '16:9',
        textLeft: true,
        scene: `Our war-band has just come over a rise on the heath. Below us, half a mile off, lies a walled northern town: timber houses behind an earth bank and palisade, a road winding down to its gate, fields and two farmsteads around it, and the sea beyond. It is a clear afternoon with long cloud shadows on the land.`,
        composition: `Eye level on the hilltop, looking down. The backs of three or four of our own men with spears and round shields stand in the bottom right corner. The town lies in the right two thirds of the picture, in the middle distance.`,
      },
    ],
  },
  {
    title: 'Arriving in other lands',
    priority: 4,
    intro:
      'The game has one arrival picture for each kind of place today. These are versions for the peoples who do not build like the north. They can wait; I wire them in when the pictures exist.',
    scenes: [
      arrival(
        'town.west',
        'town-west',
        'a town of the western lowlands',
        `This scene is in another land, in green lowland country to the west. Ahead, at a river mouth, lies a town: thatched timber halls and wattle houses inside an old earth bank with a timber gate, and among them a small plain stone hall of a quiet faith, with a lit lantern hanging above its door. Fish traps of woven stakes stand in the shallows, there are water meadows and oak woods behind, and broad river boats lie at a wooden wharf. There are no crosses anywhere.`,
        { status: 'new' },
      ),
      arrival(
        'city.south',
        'city-south',
        'a city of the warm south',
        `This scene is in another land, on a warm southern coast. Ahead lies an old city: stone walls built by a fallen empire, patched with brick, with square towers; red tiled roofs; a harbour sheltered by a stone breakwater; dark cypress trees and grey olive groves on the hills. A great pillared hall with a gilded lantern on its roof stands above the houses. Merchant ships with striped sails and two oared galleys lie in the harbour. The light is golden and the sea is deep blue.`,
        { status: 'new' },
      ),
      arrival(
        'fortress.east',
        'fortress-east',
        'a river stronghold of the east',
        `This scene is in another land, far to the east, on a wide, slow river. Ahead, where the river bends, lies a stronghold: high walls of stacked logs on an earth rampart with a roofed gate tower, steep-roofed log houses inside with carved horse heads on their gables, dugout boats and broad river ships on the mud bank, and endless birch forest behind. Mist lies on the water.`,
        { status: 'new' },
      ),
      arrival(
        'town.sun',
        'town-sun',
        'a port of the far south',
        `This scene is in another land, far to the south, under a hot sun. Ahead lies a port: pale stone walls and flat-roofed houses stacked up a dry hillside, date palms, one low dome above the roofs, bright cloth awnings over a market by the water, and a stone quay where slender oared war galleys lie. Heat haze blurs the hills. The sea is turquoise near the shore.`,
        { status: 'new' },
      ),
      arrival(
        'village.steppe',
        'village-steppe',
        'a camp of the grass plains',
        `This scene is in another land, far to the east, where a great river crosses an endless plain of grass. Ahead on the bank lies a camp of horse people: dozens of round felt tents, wooden wagons, herds of horses out to the horizon, and tall poles with horse tails flying from them. Riders watch us from the bank, and a flat ferry is drawn up at a ford. The sky is huge.`,
        { status: 'new' },
      ),
    ],
  },
  {
    title: 'Ashore: on the quay',
    priority: 2,
    intro: 'Shown after the player chooses to enter a place, with the market and the mead-hall as choices. One picture for each kind of place.',
    scenes: [
      visit(
        'hamlet',
        'hamlet',
        'a hamlet',
        `It is a hamlet: a single plank walkway over the stones leads up to three turf longhouses and a boat shed. A fisherman is gutting cod at a bench, a girl carries a wooden bucket, a dog barks at us, and smoke drifts from the roofs. Bare green hillside rises behind.`,
      ),
      visit(
        'village',
        'village',
        'a village',
        `It is a village: from a short timber jetty a muddy lane runs up between turf longhouses to a larger farm hall. Villagers carry baskets of fish, an old man mends a net stretched between poles, geese wander, and boats lie on the shingle.`,
      ),
      visit(
        'town',
        'town',
        'a town',
        `It is a trading town: a busy timber quay leads to an open gate in the earth bank and palisade, where a guard leans on his spear. Just inside the gate a lane of market booths begins, and a large hall roof shows above the houses. Porters carry bales past us.`,
      ),
      visit(
        'city',
        'city',
        'a city',
        `It is a great town: long timber quays crowded with people, timber warehouses, ox carts, and traders from several lands in different dress. Above them rise the rampart and its timber gate towers, and beyond, on higher ground, a tall temple hall and a great hall.`,
      ),
      visit(
        'capital',
        'capital',
        "a king's seat",
        `It is a king's seat: we stand on the royal landing among warships with shields along their rails. The king's guards, in good cloaks and helmets with spears, stand at the gate tower. A road of split logs climbs to the huge royal hall high above, where banners fly.`,
      ),
      visit(
        'cloister',
        'cloister',
        'a cloister',
        `This scene is in another land, far to the west. It is a small cloister of a quiet faith whose sign is a lantern: a wooden stair climbs the rock from the landing to a ring wall of dry stone. Brothers in undyed wool robes carry baskets of fish up the stair, and one tends a garden. Above the wall show round stone huts and a plain little chapel with a lit lantern above its door. There are no crosses anywhere.`,
      ),
      visit(
        'fortress',
        'fortress',
        'a fortress',
        `It is a fortress: we stand on a narrow landing directly under the wall. The rampart of stone and turf with its palisade towers over us, and the gate tower is straight above, with guards looking down. Stacked spears, barrels and a wooden hoist stand by the gate.`,
      ),
      visit(
        'emporium',
        'emporium',
        'a trading strand',
        `It is a trading strand in the market season: we stand in the middle of the beach market with booths on both sides. A bead-maker, a comb-maker and a weapon-smith work at their stalls among furs, amber, glass and cloth. Buyers of many peoples crowd the sand, and the prows of beached ships rise behind the booths.`,
      ),
      visit(
        'templeStead',
        'temple-stead',
        'a holy place',
        `It is a holy place: from the landing a road lined with carved wooden posts climbs to a tall timber temple hall with a steep tiered roof. Sellers of offerings sit by the road with wreaths and small carved figures, pilgrims climb, and great burial mounds stand beside the hall.`,
      ),
    ],
  },
  {
    title: 'After the assault',
    priority: 2,
    intro: 'Shown when the player has taken a place by force.',
    scenes: [
      {
        title: 'After the assault',
        id: 'settlements.scene.aftermath',
        file: 'settlements/aftermath.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'outdoor',
        aspect: '16:9',
        textLeft: true,
        scene: `Dusk after a town has been taken by storm. In the middle distance the town's palisade gate hangs broken, and smoke rises red against the evening sky from several roofs. In the foreground our own warriors rest around a banner pole planted in the ground: some sit on their shields, one binds another's arm with a strip of cloth, one drinks from a horn. Beside them is a heap of plunder: chests, bolts of cloth, silver cups, sacks. They are tired, not triumphant. No dead are shown.`,
        composition: `Eye level, among our own men. The resting warriors and the banner are in the right foreground, and the smoking town is behind them in the right two thirds of the picture.`,
      },
    ],
  },
  {
    title: 'Meetings at sea',
    priority: 2,
    intro: 'Shown when the expedition meets other ships. The merchant picture is the sea anchor.',
    scenes: [
      {
        title: 'At sea: a merchant',
        id: 'encounters.scene.merchant',
        file: 'encounters/scene-merchant.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'sea',
        isAnchor: true,
        aspect: '16:9',
        textLeft: true,
        scene: `Open sea on a fair day with a long, easy swell. About a mile ahead, two broad-bellied trading ships ride low in the water under plain, patched sails, heavy with cargo. Their small crews have gathered at the rail to watch us. Gulls wheel overhead, and a low line of land lies far off on the horizon.`,
        composition: SEA_VIEW,
      },
      {
        title: "At sea: a lord's patrol",
        id: 'encounters.scene.patrol',
        file: 'encounters/scene-patrol.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'sea',
        aspect: '16:9',
        textLeft: true,
        scene: `Open sea in clear evening light. Three longships with painted round shields along their rails cross our course in good order under oars and sail. A lord's long banner flies from the mast of the leading ship, and a man stands in its bow with one hand raised to hail us.`,
        composition: SEA_VIEW,
      },
      {
        title: 'At sea: raiders',
        id: 'encounters.scene.raiders',
        file: 'encounters/scene-raiders.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'sea',
        aspect: '16:9',
        textLeft: true,
        scene: `Grey, choppy sea under low cloud. Three lean, dark ships with no banner are closing on us fast from ahead, their oars beating together and their sails furled. Their crews crouch behind shields along the rails, and spear points catch the dull light.`,
        composition: SEA_VIEW,
      },
      {
        title: 'At sea: a war-fleet',
        id: 'encounters.scene.warfleet',
        file: 'encounters/scene-warfleet.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'sea',
        aspect: '16:9',
        textLeft: true,
        scene: `Dawn at sea with mist lying on the water. Across the horizon a line of nine warships comes on under sail beneath one great banner. The largest ship, in the centre, has a tall carved stem and a striped sail. Shields line every rail.`,
        composition: SEA_VIEW,
      },
      {
        title: 'At sea: caught',
        id: 'encounters.scene.caught.sea',
        file: 'encounters/scene-caught-sea.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'sea',
        aspect: '16:9',
        textLeft: true,
        scene: `An enemy ship has caught us. Its hull grinds along our bow, its crew crowd their rail with spears and shields raised, iron grappling hooks on ropes fly toward us, and its great sail fills the sky above. In the foreground our own men brace behind their shields, seen from behind. The moment before the fight: no wounds are shown.`,
        composition: `Eye level on our own deck, close and crowded. The enemy ship and its sail fill the right two thirds of the picture, and the backs of two of our men with shields are in the bottom right.`,
      },
    ],
  },
  {
    title: 'Meetings on the march',
    priority: 2,
    intro: 'Shown when a war-band marching overland meets someone.',
    scenes: [
      {
        title: 'On the march: outlaws',
        id: 'encounters.scene.outlaws',
        file: 'encounters/scene-outlaws.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'outdoor',
        aspect: '16:9',
        textLeft: true,
        scene: `A heath of heather and rough grass on a grey day. A bowshot away, at the edge of a pine wood, stand a dozen ragged outlaws with bows and axes, half hidden among the trunks, watching us. Thin smoke from a cooking fire rises out of the trees behind them.`,
        composition: LAND_VIEW,
      },
      {
        title: "On the march: a lord's patrol",
        id: 'encounters.scene.landPatrol',
        file: 'encounters/scene-land-patrol.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'outdoor',
        aspect: '16:9',
        textLeft: true,
        scene: `A track across open heath at dusk. Twenty spearmen in a loose line bar the way under a lord's banner. Their leader sits a shaggy pony a few paces in front, riding with no stirrups, one hand raised to stop us.`,
        composition: LAND_VIEW,
      },
      {
        title: 'On the march: ambushed',
        id: 'encounters.scene.caught.land',
        file: 'encounters/scene-caught-land.jpg',
        size: [1920, 1080],
        status: 'manifest',
        anchor: 'outdoor',
        aspect: '16:9',
        textLeft: true,
        scene: `An ambush on a narrow forest track. Armed men spring out from behind rocks and trees close in front of us, shouting, with spears and axes raised, and arrows are in the air. Our front rank is throwing up its shields. The moment before the clash: no wounds are shown.`,
        composition: `Eye level, just behind our own front rank, close and sudden. The backs and raised shields of two of our men are in the bottom right, and the attackers fill the right two thirds of the picture.`,
      },
    ],
  },
];
