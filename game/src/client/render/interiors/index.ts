/**
 * The interior kit: entering a building replaces the whole view (below the top bar) with a painting of its
 * inside. The menus live behind the people in it: click a person, their panel opens over one side of the room,
 * the room and the person stay in view on the other side.
 *
 * ## What each export does
 *
 * Stage
 *   InteriorRoom      The room on screen: painting, people buttons (name plate, glow, digit key), title plate,
 *                     Leave, the panel (role, one line of greeting, Back, the menu). Keys: 1..n pick a person,
 *                     Esc closes the panel and then leaves. Enter transition ENTER_MS (none under reduced motion).
 *   useRoutePerson    Keeps the open person in the route's params: `{ person: '<id>' }` deep-links straight to a
 *                     panel, and coming back from a screen opened on top shows the panel again.
 *   ROOM_W, ROOM_H    The 1600 × 900 viewBox every room paints into. Keep people between x 200 and 1400.
 *   InteriorRoomDef   A room: id (the building id), titleKey, assetId (final art), Painting, people, final.
 *   InteriorPerson    One person or spot: id, x/y (feet centre), w/h (click box up from the feet), nameKey,
 *                     greetingKey, icon, plate ('above' | 'below'), plateAt (the plate's centre, when neither
 *                     above nor below will do), panel side ('left' | 'right' | 'auto'),
 *                     wide (a wider panel for a grid of cards).
 *   FinalSpots        Where the people stand in the final paintings: `final: { base: { smith: { x, y, w, h } } }`
 *                     for the base file; a season's own painting adds `winter: { … }` (a person missing there
 *                     stands where `base` puts them). Optional `plate`, `plateAt` and `panel` per spot. The people's own
 *                     x/y/w/h stay for the procedural painting ("Ignore final files").
 *   personBox, plateSpot, panelSideOf, roomKey, findPerson, placePeople, spotOf   The pure layout and key logic (unit-tested).
 *
 * Light
 *   roomLight(ambience)   The light inside: the hour outside (`outdoor`, the scenes' Light), daylight, firelight.
 *   lit(light, colour, warm, depth)   Any colour as it looks in that light (warm: near a fire; depth: far).
 *   outside(light, colour, distance)  A colour seen out through an opening, hazed by distance.
 *
 * Painting helpers (paint.tsx, people.tsx; each takes viewBox coordinates and the RoomLight)
 *   RoomSvg (the canvas and gradients; pass `sky` for open rooms), useRoomUid, PlankedWall, Post, Beam, Floor,
 *   Hearth, Flames, FireGlow, SmokeHaze, SideBench, Bench, Table, Hanging, Shield, HighSeat, Chest, Anvil,
 *   Forge, ToolRack, Barrel, Overhang (an open shelter's roof), Landscape (sky, mountains, meadow), and
 *   Person: people with faces, clothes lit by the fire, poses (standing, seated, working) and things in hand
 *   (staff, keys, hammer and tongs, sword, horn, cup). Scenes' Sky, Ridge, Woods, Smoke work inside RoomSvg.
 *
 * Gallery
 *   `/?interiors=<building>[&hour=21][&season=winter][&person=<id>]` on dev builds paints a room without a save.
 *   Rooms are found by glob (registry.ts): a new file under ./rooms appears there with no other edit.
 *
 * ## A new room in about 60 lines (copy rooms/smithy.tsx for an open shelter, rooms/greatHall.tsx for a hall)
 *
 * ```tsx
 * // src/client/render/interiors/rooms/shipyard.tsx
 * import type { ReactElement } from 'react';
 * import { Barrel, Floor, Landscape, Overhang, Post, RoomSvg, useRoomUid } from '../paint';
 * import { Person } from '../people';
 * import type { InteriorRoomDef, RoomPaintingProps } from '../types';
 *
 * export function ShipyardPainting({ light, seed }: RoomPaintingProps): ReactElement {
 *   const uid = useRoomUid();
 *   return (
 *     <RoomSvg uid={uid} light={light} sky={{ horizon: 480 }} testId="interior-painting-shipyard">
 *       <Landscape uid={uid} light={light} horizon={480} groundY={690} seed={seed} />
 *       <Floor y={690} light={light} kind="boards" seed={seed} />
 *       <Overhang y={160} light={light} />
 *       <Post x={120} top={110} bottom={880} w={60} light={light} carved={false} />
 *       <Barrel x={1200} y={870} w={110} h={120} light={light} />
 *       <Person x={760} y={830} h={450} hold="hammer" pose="working" light={light} warmSide="left"
 *               look={{ tunic: '#4e5a3a', apron: true, bareArms: true, beard: 'short', build: 'broad' }} />
 *     </RoomSvg>
 *   );
 * }
 *
 * export const shipyardRoom: InteriorRoomDef = {
 *   id: 'shipyard', titleKey: 'hub.building.shipyard.name', assetId: 'hub.interior.shipyard',
 *   Painting: ShipyardPainting,
 *   people: [{ id: 'shipwright', x: 760, y: 860, w: 320, h: 560, icon: 'ship',
 *              nameKey: 'hub.interior.shipyard.shipwright.name', greetingKey: 'hub.interior.shipyard.shipwright.greeting' }],
 * };
 *
 * // src/client/screens/shipyard/index.tsx: the route screen puts the old menu behind the person.
 * function ShipyardScreen({ params, close }: ScreenProps): ReactElement {
 *   const state = useGame((s) => s.state);
 *   const [person, setPerson] = useRoutePerson(shipyardRoom, ['building.shipyard'], params);
 *   if (!state) return <div />;
 *   return <InteriorRoom room={shipyardRoom} ambience={ambienceOf(state)} person={person} onPersonChange={setPerson}
 *            subtitle={…} stageTestId="shipyard" onLeave={close} panel={() => <ShipyardWork state={state} />} />;
 * }
 * // descriptor: { id: 'shipyard', route: 'building.shipyard', component: ShipyardScreen, layout: 'overlay' }
 * ```
 *
 * The painting never holds hotspots. A final painting registered under `assetId` (ASSET_DROP_IN.md, 1600 × 900, so
 * a pixel is a viewBox unit) replaces the drawn one; its people are placed by the room's `final` table, measured on
 * that painting (cover the whole figure and the prop they stand by; the ring sits at the feet). Strings go under `hub.interior.<building>.<person>.*`.
 */
export { InteriorRoom, ENTER_MS, prefersStill, type InteriorRoomProps } from './InteriorRoom';
export { useRoutePerson } from './route';
export { ROOM_W, ROOM_H, type FinalSpots, type InteriorPerson, type InteriorRoomDef, type PanelSide, type PersonSpot, type RoomAmbience, type RoomPaintingProps, type SpotTable } from './types';
export { personBox, plateSpot, panelSideOf, placePeople, spotOf, roomKey, findPerson, type PersonBox, type RoomKeyAction } from './layout';
export { roomLight, lit, outside, type RoomLight } from './light';
export {
  RoomSvg,
  useRoomUid,
  PlankedWall,
  Post,
  Beam,
  Floor,
  Hearth,
  Flames,
  FireGlow,
  SmokeHaze,
  SideBench,
  Bench,
  Table,
  Hanging,
  Shield,
  HighSeat,
  Chest,
  Anvil,
  Forge,
  ToolRack,
  Barrel,
  Overhang,
  Landscape,
} from './paint';
export { Person, type PersonLook, type PersonPose, type PersonHold } from './people';
