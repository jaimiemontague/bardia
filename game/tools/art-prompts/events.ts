/** Art prompts for the small event pictures and for the battle and voyage cards. */
import type { Anchor, ArtGroup, ArtScene } from './style';

const SMALL_VIEW = `A simple picture with one clear subject, seen from eye level and fairly close.`;

function small(id: string, file: string, title: string, anchor: Anchor, scene: string, status: ArtScene['status'] = 'manifest', composition = SMALL_VIEW): ArtScene {
  return { title, id, file, size: [640, 360], status, anchor, aspect: '16:9', small: true, scene, composition };
}

function vignette(key: string, fileKey: string, title: string, anchor: Anchor, scene: string, composition = SMALL_VIEW): ArtScene {
  return small(`narrative.vignette.${key}`, `narrative/vignettes/${fileKey}.jpg`, title, anchor, scene, 'new', composition);
}

function card(id: string, file: string, title: string, anchor: Anchor, scene: string, composition: string): ArtScene {
  return { title, id, file, size: [1920, 1080], status: 'new', anchor, aspect: '16:9', textLeft: true, scene, composition };
}

export const EVENT_GROUPS: readonly ArtGroup[] = [
  {
    title: 'Event pictures: the household and the realm',
    priority: 3,
    intro: 'Small pictures at the top of an event card. They are shown at 640 by 360, so each has one clear subject.',
    scenes: [
      small(
        'people.illus.birth',
        'people/birth.png',
        'A child is born',
        'indoor',
        `Night inside a longhouse. A tired, smiling mother sits up on a sleeping bench holding a newborn wrapped in wool. An old midwife sits beside her, and the father stands in the doorway with firelight on his face.`,
      ),
      small(
        'people.illus.wedding',
        'people/wedding.png',
        'A wedding',
        'outdoor',
        `A summer wedding in front of a great hall's door. A bride wearing a crown of flowers and a groom clasp hands over the hilt of a sword held upright between them, while an elder speaks. Guests raise drinking horns, and a table is laid outdoors.`,
      ),
      small(
        'people.illus.sickness',
        'people/sickness.png',
        'Old age weighs heavy',
        'indoor',
        `An old chieftain lies on a sleeping bench under furs, thin and grey. A grown daughter holds his hand, and an old woman brings a bowl of steeped herbs. Low firelight, quiet.`,
      ),
      small(
        'people.illus.succession',
        'people/succession.png',
        'The high seat stands empty',
        'indoor',
        `A great hall, crowded and silent. The carved high seat is empty, with a sword laid across it. A young heir stands before it with one hand on the seat's carved pillar while the whole household watches.`,
      ),
      small(
        'people.illus.houseFallen',
        'people/house-fallen.png',
        'The house falls silent',
        'indoor',
        `An empty great hall in winter. The high seat is empty with a cloak thrown over it, the hearth is cold grey ash, a drinking horn lies fallen on the floor, and snow drifts in through the open door.`,
      ),
      small(
        'people.illus.captivity',
        'people/captivity.png',
        'In chains',
        'indoor',
        `A chieftain held captive: sitting on straw in a dark timber storehouse with iron fetters on his wrists, head up, unbroken. A bar of daylight falls from the door, and the shadow of a guard with a spear crosses it.`,
      ),
      small(
        'people.illus.featChoice',
        'people/feat-choice.png',
        'A saga feat',
        'indoor',
        `A warrior is honoured in the great hall. He stands before the high seat while a chieftain fastens a silver arm-ring on his arm. On the benches men beat their shields and shout.`,
      ),
      small(
        'military.illus.muster',
        'military/muster.png',
        'The war-arrow',
        'outdoor',
        `Dawn at a turf farmhouse. A breathless runner hands a carved wooden arrow, the summons to war, to a farmer at his door. Behind the farmer his grown son lifts a spear and a round shield down from the wall. Across the valley other small figures are already walking toward the fjord with spears.`,
      ),
      small(
        'military.illus.shipyard',
        'military/shipyard.png',
        'A ship is launched',
        'outdoor',
        `A newly built ship slides stern-first down log rollers into the fjord, throwing up spray. Shipwrights and villagers haul on ropes and cheer.`,
      ),
      small(
        'military.illus.desertion',
        'military/desertion.png',
        'Gone in the night',
        'outdoor',
        `A war-band's camp at grey dawn. Men sleep in a ring around a dead fire, but three bedrolls are empty with their blankets thrown back, and footprints lead through wet grass into dark woods. One sentry stands staring after them.`,
      ),
      small(
        'military.illus.transferIntercepted',
        'military/transfer-intercepted.png',
        'Raiders on the road',
        'outdoor',
        `A forest road. A small column of men and pack ponies loaded with sacks has been stopped by armed raiders stepping out of the trees ahead and on both sides. The column's leader raises his shield.`,
      ),
      small(
        'news.illus.messenger',
        'news/messenger.png',
        'A rider brings word',
        'outdoor',
        `Rain at the door of a great hall. A rider on a steaming, mud-spattered horse, riding with no stirrups, pulls up hard while a doorkeeper runs out to take the bridle.`,
      ),
      small(
        'news.illus.tavernTalk',
        'news/tavern-talk.png',
        'Talk in the mead-hall',
        'indoor',
        `Three people lean close together over wooden cups at a mead-hall table by firelight. One whispers behind his hand, one listens wide-eyed, and one glances over his shoulder.`,
      ),
    ],
  },
  {
    title: 'Event pictures: stories',
    priority: 3,
    intro: 'Pictures for the written story events the game has today.',
    scenes: [
      small(
        'narrative.illus.ratsInTheStores',
        'narrative/storylets/rats-in-the-stores.png',
        'Rats in the stores',
        'indoor',
        `Inside a timber storehouse by lamplight. Among grain bins and sacks, one sack is gnawed open and spilling barley, three rats sit on a beam, and a grim estate manager holds up a clay lamp. A fat cat sleeps on a sack.`,
      ),
      small(
        'narrative.illus.boundaryStone',
        'narrative/storylets/boundary-stone.png',
        'The wandering stone',
        'outdoor',
        `Two farmers, muddy to the knee, argue nose to nose across a grey boundary stone standing in a barley field. One points at the ground. Neighbours watch from the field's edge, grinning.`,
      ),
      small(
        'narrative.illus.drunkenBoast',
        'narrative/storylets/drunken-boast.png',
        'A boast in the cups',
        'indoor',
        `Morning in a great hall after a feast. Guests sleep on the benches and the floor among overturned horns and cups. A chieftain sits up on the high seat holding his head, and a poet nearby grins at him, a small lyre on his knee.`,
      ),
      small(
        'narrative.illus.boastReckoning',
        'narrative/storylets/boast-reckoning.png',
        'The firth remembers',
        'outdoor',
        `A cold grey shore below a village in late winter. Half the village lines the beach in heavy cloaks. A chieftain stripped to his trousers wades into water the colour of an old blade, with ice at its edge. An old warrior holds a coil of rope beside a fire burning on the shingle.`,
      ),
      small(
        'narrative.illus.ravenOverTheWake',
        'narrative/storylets/raven-over-the-wake.png',
        'A raven over the wake',
        'sea',
        `Seen from the deck of a ship under sail, looking back over the stern. A raven rides the wind just above the stern-post, the steersman glances up at it, and the wake stretches away across grey sea.`,
      ),
      small(
        'narrative.illus.afterTheShieldWall',
        'narrative/storylets/after-the-shield-wall.png',
        'When the shields come down',
        'outdoor',
        `The quiet after a battle, in evening light. Exhausted warriors sit on trampled ground among dropped round shields and spears. One has his head bowed, one binds another's arm. A poet picks his way between them with a wax writing tablet. No dead are shown.`,
      ),
      small(
        'narrative.illus.skaldsDraft',
        'narrative/storylets/skalds-draft.png',
        "The skald's draft",
        'indoor',
        `Night by a camp fire. A poet sits scratching verses into a wax tablet with a pointed stylus, lips moving. Warriors sleep around the fire, and a chieftain wrapped in a cloak stands over him, listening.`,
      ),
    ],
  },
  {
    title: 'Event pictures: sea, weather and omens',
    priority: 4,
    intro: 'More small pictures for the kinds of event the game draws by itself today. I give each its own id when the picture exists.',
    scenes: [
      vignette('storm', 'storm', 'Storm at sea', 'sea', `An open ship in a gale under a black sky. The sail is reefed small, green water breaks over the bow, the crew bail and haul on ropes, and the steersman braces himself against the steering oar.`),
      vignette('fog', 'fog', 'Fog', 'sea', `A ship rowing blind through thick fog. A lookout in the bow listens with a hand cupped to his ear, and the stern is already lost in grey.`),
      vignette('wreck', 'wreck', 'Shipwreck', 'sea', `Dawn after a storm. A ship lies broken on rocks, its hull split and its mast down. Survivors drag themselves and one sea chest up a shingle beach.`),
      vignette('voyage', 'voyage', 'Under sail', 'sea', `A ship running fast under a full square sail on a bright, windy day, spray at the bow, the crew at ease along the benches and one man pointing ahead.`),
      vignette('landing', 'landing', 'Landfall', 'sea', `First light on an empty beach. A crew leap from the bow of a beached ship into the surf with shields and spears and run up the sand.`),
      vignette('winterShore', 'winter-shore', 'Winter on the shore', 'outdoor', `A winter shore. Ships are hauled up and roofed over with spars and sailcloth, snow lies deep, the inlet is frozen, and one man breaks the ice with an axe to draw water.`),
      vignette('ravens', 'ravens', 'Ravens', 'outdoor', `Dawn over a war-band's camp. Two ravens sit on a bare branch above the tents, one calling, and men below look up at them.`),
      vignette('comet', 'comet', 'A star with a tail', 'outdoor', `Night at a fjord village. Villagers stand outside their houses pointing up at a comet with a long pale tail above the mountains.`),
      vignette('northernLights', 'northern-lights', 'The northern lights', 'outdoor', `Green and violet northern lights over a snowbound village at night. One figure stands alone on the frozen fjord, looking up.`),
      vignette('barrow', 'barrow', 'The old mound', 'outdoor', `Dusk at an ancient burial mound with a dark, stone-lined doorway in its side. Wind moves the long grass. Two warriors with a torch hesitate at the entrance.`),
    ],
  },
  {
    title: 'Event pictures: the life of the realm',
    priority: 4,
    intro: 'The rest of the small pictures the game draws by itself today.',
    scenes: [
      vignette('feast', 'feast', 'A feast', 'indoor', `A midwinter feast in a great hall. Long tables, a roasted pig, horns raised, a poet with a lyre, firelight on laughing faces.`),
      vignette('thing', 'thing', 'The assembly', 'outdoor', `An open-air assembly on a grassy hill. Free men stand in a wide ring around a flat rock where a speaker raises a spear, and many in the ring lift their shields to agree.`),
      vignette('holmgang', 'holmgang', 'The duel', 'outdoor', `A duel on a small bare island. Two warriors with sword and shield circle each other inside a square marked out with hazel rods. Each has a second standing by with spare shields, and onlookers watch from boats.`),
      vignette('envoy', 'envoy', 'An envoy', 'indoor', `An envoy carrying a white shield, the sign of peace, stands with two attendants before a chieftain's high seat and offers a gift: a sword lying on a folded cloth.`),
      vignette('trade', 'trade', 'A bargain', 'outdoor', `Two traders on a strand weigh pieces of cut silver on a small balance scale over bundles of furs, each watching the other's hands. A ship lies behind them.`),
      vignette('harvest', 'harvest', 'Harvest', 'outdoor', `Barley harvest on a sloping field above the fjord in golden late light. Men and women cut with sickles, sheaves stand stacked, and children carry bundles.`),
      vignette('famine', 'famine', 'Hunger', 'indoor', `Late winter in a poor farmhouse. A mother scrapes the bottom of a nearly empty grain bin while two thin children watch. Snow shows through the open door.`),
      vignette('storehouse', 'storehouse', 'The storehouse', 'indoor', `A full storehouse in autumn. Grain bins are heaped, dried fish and smoked meat hang from the beams, barrels stand in rows, and an estate manager counts on his fingers.`),
      vignette('hunt', 'hunt', 'The hunt', 'outdoor', `A snowy birch wood. Three hunters with spears and a hound close in on a great bull elk that has turned to face them.`),
      vignette('funeral', 'funeral', 'A burial', 'outdoor', `Dusk on a hillside above the sea. A small ship has been set in a trench as a grave, with a body wrapped in a cloak laid in it beside a shield and a spear. Mourners stand around with torches, and men are beginning to raise a mound of earth over it.`),
      vignette('raid', 'raid', 'A raid', 'outdoor', `Seen from behind: raiders run up a beach from their ships toward a village. Villagers flee inland carrying bundles, and one thatched roof has just caught fire. No wounds are shown.`),
      vignette('shieldWall', 'shield-wall', 'The shield wall', 'outdoor', `A shield wall seen from one end: men shoulder to shoulder, round shields overlapping, spears levelled, bracing as another line comes on through the dust. The moment before they meet.`),
    ],
  },
  {
    title: 'Battle and voyage cards',
    priority: 3,
    intro:
      'These screens have no picture today: the planner, the cards before and after a fight, and the homecoming. I add the picture slots when you have the art.',
    scenes: [
      card(
        'expeditions.scene.planner',
        'expeditions/planner.jpg',
        'Loading the ships',
        'outdoor',
        `Early morning on the strand below a fjord village. Three ships lie with their bows on the shingle and gangplanks down. Men carry barrels, sacks of grain, bundles of spears and round shields aboard. A steersman checks his steering oar, a woman hands up a wrapped bundle of food, and children watch from the boat shed.`,
        `Eye level on the strand. The ships and the loading are in the right two thirds, with the fjord opening out behind them toward the sea.`,
      ),
      card(
        'expeditions.scene.homecoming',
        'expeditions/homecoming.jpg',
        'Homecoming',
        'sea',
        `Late afternoon. Our ships are coming home up the fjord under oars, sails furled, low in the water with what they carry. On the strand ahead the whole village is running down to the water, waving. Smoke rises from every roof.`,
        `Eye level from the deck of the leading ship. The carved stem-post rises in the bottom right corner. The village and its people are in the right two thirds, in the middle distance.`,
      ),
      card(
        'expeditions.scene.lost',
        'expeditions/lost.jpg',
        'The expedition is lost',
        'outdoor',
        `Rain on a grey shore road. A handful of survivors walk home on foot, soaked and worn out, without their ships: one leans on a spear as a staff, two carry a third between them on a cloak, and a few shields are slung on their backs. Far ahead, small, are the roofs of the home village.`,
        `Eye level on the road, looking along it. The survivors walk away from us in the right two thirds. The left third is rain, grey sea and sky.`,
      ),
      card(
        'battle.scene.before',
        'battle/before.jpg',
        'Before the battle',
        'outdoor',
        `A grey morning on open ground before a palisaded town. Our war-band is forming its line: men settle their shields on their arms, pull caps and a few helmets down, and plant spears. A banner-bearer stands beside the leader, who points toward the town. On the bank ahead the defenders are gathering in a dark line.`,
        `Eye level, a few paces behind our own line, looking past our men's backs and shields toward the town. Our men are in the right two thirds, with the town beyond them.`,
      ),
      card(
        'battle.scene.victory',
        'battle/victory.jpg',
        'The field is ours',
        'outdoor',
        `Evening after a battle won. Our warriors stand on a taken earth bank with a broken palisade, raising spears and shouting as the banner is planted. Below them the last of the enemy run for the trees. No dead are shown.`,
        `Eye level, looking up at the bank from below. Our men and the banner stand against the sky in the right two thirds.`,
      ),
      card(
        'battle.scene.defeat',
        'battle/defeat.jpg',
        'The day is lost',
        'outdoor',
        `Dusk after a battle lost. Our men fall back toward the ships on the shore: two carry a wounded friend between them, others walk backward with shields still raised. On the ridge behind stands the enemy line, dark against the last light, not following.`,
        `Eye level on the slope. Our retreating men are in the right foreground and the enemy on the ridge is beyond them. The left third is dusk sky and falling ground.`,
      ),
      card(
        'seabattle.scene.before',
        'seabattle/before.jpg',
        'Before the sea fight',
        'sea',
        `On our own deck as a sea fight draws near. The crew take their shields down from the rail, archers string their bows and set bundles of arrows ready, and the steersman leans on the steering oar. Ahead, four enemy sails are spreading out across the water.`,
        `Eye level on our deck, looking forward past our own men toward the bow. Our crew are in the right foreground and the enemy ships are beyond the bow in the right two thirds.`,
      ),
      card(
        'seabattle.scene.victory',
        'seabattle/victory.jpg',
        'The sea is ours',
        'sea',
        `After a sea fight won. A captured enemy ship lies lashed alongside ours, its sail down and its crew sitting disarmed on the benches. Our men cheer and one climbs its stem-post to take down its banner. Another enemy ship is fleeing, small, toward the horizon.`,
        `Eye level on our deck. The captured ship and our cheering men are in the right two thirds.`,
      ),
      card(
        'seabattle.scene.defeat',
        'seabattle/defeat.jpg',
        'Beaten at sea',
        'sea',
        `After a sea fight lost. Our ship labours away, low in the water, with a torn and scorched sail and half its oars gone, the crew rowing hard and one man bailing. Behind us the enemy ships hold the water where the fight was, and one of our own ships burns among them.`,
        `Eye level from the stern of our ship, looking back over the rowers. The enemy and the burning ship are in the distance, in the right two thirds.`,
      ),
    ],
  },
];
