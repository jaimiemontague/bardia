/**
 * The composed pictures: what the crew sees at sea (other ships from our own deck), on the march (another
 * band on the heath), arriving at a settlement (from the ship or overland), standing on its quay, and
 * looking back at a place just taken. Each is a pure function of a small model, so the screens, the tests
 * and the scene gallery paint the same thing.
 */
import { memo, type ReactElement } from 'react';
import type { SeasonId } from '@content/schemas/ids';
import { Figure, Heath, OwnSpears, Woods } from './land';
import { FogBank, HorizonHaze, Rain, Ridge, SceneSvg, Sea, Sky, Smoke, useSceneUid } from './layers';
import { BONE, INK, lightFor, mix, PLAYER_COLOUR, rng, shade, VIEW_W, type Light, type SceneWeather } from './paint';
import { SettlementView, type BuildStyle } from './settlement';
import { OwnBow, SHIP_LOOK, SideShip, shipPaint } from './ships';

const SHIP_LEN: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(SHIP_LOOK).map(([k, v]) => [k, 0.75 + v.len * 0.25]));

/** Time, season and weather of a picture. */
export interface Ambience {
  hourOfDay: number;
  season: SeasonId;
  weather: SceneWeather;
}

// ---------------------------------------------------------------------------------------------
// Encounters.

export interface EncounterPictureModel {
  ambience: Ambience;
  kind: 'merchant' | 'patrol' | 'raiders' | 'warfleet' | 'outlaws' | 'landPatrol' | string;
  stage: 'sighted' | 'caught';
  domain: 'sea' | 'land';
  /** Their hulls (sea) by type, in order; drawn up to 7. */
  ships: readonly string[];
  /** Their fighting men (land: how many figures to draw). */
  men: number;
  /** Their lord's banner colour (absent: no lord). */
  colour?: string;
  /** Our own banner colour. */
  ourColour?: string;
  seed: number;
}

/** Where distant hulls lie on the water (x, depth below the horizon in px). */
const FLEET_SLOTS: readonly [number, number][] = [
  [1220, 46],
  [1420, 28],
  [1080, 18],
  [1520, 58],
  [990, 8],
  [1330, 10],
  [860, 30],
];

export const MAX_DRAWN_SHIPS = FLEET_SLOTS.length;

function SeaEncounter({ m, light, uid }: { m: EncounterPictureModel; light: Light; uid: string }): ReactElement {
  const horizon = 430;
  const caught = m.stage === 'caught';
  const rough = m.kind === 'raiders';
  const paint = shipPaint(m.colour, rough);
  const aggressive = m.kind === 'raiders' || m.kind === 'warfleet' || caught;
  const ships = m.ships.slice(0, MAX_DRAWN_SHIPS);
  const drawn: ReactElement[] = [];
  const r = rng(m.seed);
  ships.forEach((type, i) => {
    if (caught && i === 0) return;
    const slot = FLEET_SLOTS[i] ?? [1200, 10];
    const depth = caught ? slot[1] + 60 : slot[1];
    const y = horizon + depth;
    const near = Math.min(1, depth / (caught ? 140 : 70));
    const L = (caught ? 170 : 92) * (0.6 + near * 1.1) * (0.9 + r() * 0.2) * (SHIP_LEN[type] ?? 1);
    drawn.push(
      <SideShip key={i} x={slot[0] + (r() - 0.5) * 30} y={y} L={L} type={type} paint={paint} light={light} distance={1 - near * 0.7} facing={aggressive ? -1 : 1} oarsOut={rough || caught} furled={rough && !caught} lit={light.lamps > 0.5} bob={r() * 5} />,
    );
  });
  // Far ships first (drawn back to front by depth).
  drawn.reverse();
  const lead = caught && ships[0] !== undefined ? <SideShip x={1330} y={705} L={760} type={ships[0]} paint={paint} light={light} distance={0.04} facing={-1} oarsOut furled={rough} lit={light.lamps > 0.5} bob={1} /> : null;
  return (
    <>
      <Sky uid={uid} light={light} horizon={horizon} seed={m.seed} />
      <Ridge y={horizon} height={34} colour={mix(light.far, light.haze, 0.45)} seed={m.seed + 3} roughness={0.6} step={90} />
      <Sea uid={uid} light={light} horizon={horizon} />
      <HorizonHaze uid={uid} light={light} horizon={horizon} />
      {drawn}
      {m.ambience.weather.fog && <FogBank light={light} y={horizon + 20} opacity={0.6} />}
      {lead}
      <OwnBow light={light} uid={uid} stemX={caught ? 760 : 930} stemY={caught ? 700 : 640} colour={m.ourColour ?? PLAYER_COLOUR} lantern={light.lamps > 0.5} />
      {light.rain && <Rain light={light} />}
    </>
  );
}

function LandEncounter({ m, light, uid }: { m: EncounterPictureModel; light: Light; uid: string }): ReactElement {
  const horizon = 470;
  const caught = m.stage === 'caught';
  const r = rng(m.seed);
  const outlaws = m.kind === 'outlaws';
  const colour = m.colour ?? '#5a4636';
  const n = Math.max(3, Math.min(caught ? 9 : 16, Math.round(m.men / 4)));
  const band: ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    if (caught) {
      const x = 760 + (i / Math.max(1, n - 1)) * 600 + (r() - 0.5) * 60;
      const y = 700 + r() * 70;
      band.push(<Figure key={i} x={x} y={y} h={120 + (y - 700) * 0.9} colour={shade(outlaws ? '#4a3a2a' : '#3a3530', 0.3)} shield={outlaws ? (r() < 0.4 ? '#5a4a36' : undefined) : colour} gear={outlaws ? (r() < 0.5 ? 'bow' : 'spear') : 'spear'} light={light} distance={0.05} flip={x > 1060} />);
    } else if (outlaws) {
      const x = 860 + r() * 280;
      const y = horizon + 84 + r() * 26;
      band.push(<Figure key={i} x={x} y={y} h={44 + (y - horizon - 84) * 0.5 + r() * 6} colour="#241a12" shield={r() < 0.3 ? '#5a4a36' : undefined} gear={r() < 0.5 ? 'bow' : 'spear'} light={light} distance={0.3} flip={r() < 0.5} />);
    } else {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const x = 1040 + col * 30 + row * 8;
      const y = horizon + 104 + row * 16;
      band.push(<Figure key={i} x={x} y={y} h={46 + row * 5} colour="#3a3530" shield={colour} gear={i === 1 ? 'banner' : 'spear'} light={light} distance={0.45 - row * 0.05} />);
    }
  }
  const arrows: ReactElement[] = [];
  if (caught) {
    for (let i = 0; i < 9; i++) {
      const x = 500 + r() * 900;
      const y = 140 + r() * 260;
      arrows.push(<line key={i} className="scn-arrow" style={{ animationDelay: `${r() * 2}s` }} x1={x} y1={y} x2={x - 40} y2={y + 26} stroke={INK} strokeWidth={2.4} />);
    }
  }
  return (
    <>
      <Sky uid={uid} light={light} horizon={horizon} seed={m.seed} />
      <Ridge y={horizon - 10} height={120} colour={mix(light.far, light.haze, 0.3)} seed={m.seed + 5} snowCaps={light.snow} />
      <Ridge y={horizon + 20} height={60} colour={mix(light.mid, light.haze, 0.25)} seed={m.seed + 7} roughness={0.5} step={120} />
      <HorizonHaze uid={uid} light={light} horizon={horizon + 20} />
      <Heath light={light} horizon={horizon} seed={m.seed + 11} />
      <Woods x0={480} x1={1180} y={horizon + 82} h={120} light={light} distance={0.45} seed={m.seed + 13} snow={light.snow} />
      <Woods x0={1300} x1={1800} y={horizon + 60} h={80} light={light} distance={0.6} seed={m.seed + 17} snow={light.snow} />
      {outlaws && !caught && <Smoke x={1010} y={horizon + 92} h={150} w={10} light={light} />}
      {m.ambience.weather.fog && <FogBank light={light} y={horizon + 60} opacity={0.55} />}
      {band}
      {arrows}
      <OwnSpears light={light} colour={m.ourColour ?? PLAYER_COLOUR} />
      {light.rain && <Rain light={light} />}
    </>
  );
}

/** The encounter scene's picture (sea or land). */
export const EncounterPicture = memo(function EncounterPicture({ model }: { model: EncounterPictureModel }): ReactElement {
  const uid = useSceneUid();
  const light = lightFor(model.ambience.hourOfDay, model.ambience.season, model.ambience.weather);
  return (
    <SceneSvg uid={uid} light={light} horizon={model.domain === 'land' ? 470 : 430} testId="encounter-picture">
      {model.domain === 'land' ? <LandEncounter m={model} light={light} uid={uid} /> : <SeaEncounter m={model} light={light} uid={uid} />}
    </SceneSvg>
  );
});

// ---------------------------------------------------------------------------------------------
// Settlements.

export interface SettlementPictureModel {
  ambience: Ambience;
  tier: string;
  fortTier: number;
  style: BuildStyle;
  lantern: boolean;
  seed: number;
  /** Their lord's banner colour. */
  colour: string;
  ourColour?: string;
  raided: boolean;
  coastal: boolean;
  /** How we see it: from our ship, overland from a hill, standing on its quay, or after taking it. */
  view: 'sea' | 'land' | 'quay' | 'aftermath';
}

/** Small places are drawn closer so the picture is never empty. */
function tierScale(tier: string): number {
  switch (tier) {
    case 'hamlet':
      return 1.5;
    case 'village':
    case 'cloister':
    case 'templeStead':
      return 1.3;
    case 'town':
    case 'fortress':
      return 1.15;
    default:
      return 1;
  }
}

function Coast({ light, horizon, baseY, seed }: { light: Light; horizon: number; baseY: number; seed: number }): ReactElement {
  const land = light.snow ? mix(light.mid, '#c4cacd', 0.3) : mix(light.mid, '#33331f', 0.3);
  return (
    <g>
      <Ridge y={horizon + 4} height={120} colour={mix(light.far, light.haze, 0.35)} seed={seed + 1} snowCaps={light.snow} />
      <path d={`M240 ${baseY + 14} C 360 ${baseY - 40}, 420 ${horizon + 70}, 560 ${horizon + 44} C 760 ${horizon + 6}, 980 ${horizon + 30}, 1180 ${horizon + 16} C 1380 ${horizon + 4}, 1600 ${horizon + 30}, ${VIEW_W + 220} ${horizon + 40} L${VIEW_W + 220} ${baseY + 20} Z`} fill={mix(land, light.haze, 0.25)} />
      <path d={`M300 ${baseY + 16} C 480 ${baseY - 60}, 700 ${baseY - 90}, 900 ${baseY - 96} C 1150 ${baseY - 104}, 1400 ${baseY - 70}, ${VIEW_W + 220} ${baseY - 80} L${VIEW_W + 220} ${baseY + 24} Z`} fill={land} />
    </g>
  );
}

function SeaArrival({ m, light, uid }: { m: SettlementPictureModel; light: Light; uid: string }): ReactElement {
  const horizon = 380;
  const baseY = 586;
  return (
    <>
      <Sky uid={uid} light={light} horizon={horizon} seed={m.seed} />
      <Sea uid={uid} light={light} horizon={horizon} />
      <HorizonHaze uid={uid} light={light} horizon={horizon} />
      <Coast light={light} horizon={horizon} baseY={baseY} seed={m.seed} />
      <SettlementView light={light} tier={m.tier} fortTier={m.fortTier} style={m.style} lantern={m.lantern} seed={m.seed} cx={1090} baseY={baseY} s={tierScale(m.tier)} d={0.28} colour={m.colour} raided={m.raided} burning={false} harbour={m.coastal} people />
      {m.ambience.weather.fog && <FogBank light={light} y={baseY - 40} opacity={0.45} />}
      <OwnBow light={light} uid={uid} stemX={780} stemY={830} colour={m.ourColour ?? PLAYER_COLOUR} lantern={light.lamps > 0.5} />
      {light.rain && <Rain light={light} />}
    </>
  );
}

function LandArrival({ m, light, uid, burning }: { m: SettlementPictureModel; light: Light; uid: string; burning: boolean }): ReactElement {
  const horizon = 400;
  const baseY = 600;
  const r = rng(m.seed + 99);
  const ours: ReactElement[] = [];
  if (burning) {
    for (let i = 0; i < 6; i++) ours.push(<Figure key={i} x={1120 + i * 74 + r() * 20} y={890 + r() * 14} h={170 + r() * 34} colour="#1c1612" shield={i % 2 === 0 || i === 3 ? (m.ourColour ?? PLAYER_COLOUR) : BONE} gear={i === 3 ? 'banner' : 'spear'} light={light} distance={0} />);
  }
  return (
    <>
      <Sky uid={uid} light={light} horizon={horizon} seed={m.seed} />
      {m.coastal ? <Sea uid={uid} light={light} horizon={horizon} /> : <Ridge y={horizon + 30} height={80} colour={mix(light.far, light.haze, 0.3)} seed={m.seed + 2} snowCaps={light.snow} />}
      <HorizonHaze uid={uid} light={light} horizon={horizon} />
      <Ridge y={baseY - 70} height={50} colour={mix(light.mid, light.haze, 0.2)} seed={m.seed + 4} roughness={0.4} step={140} />
      <SettlementView light={light} tier={m.tier} fortTier={m.fortTier} style={m.style} lantern={m.lantern} seed={m.seed} cx={1040} baseY={baseY} s={tierScale(m.tier) * 0.85} d={0.3} colour={m.colour} raided={m.raided || burning} burning={burning} harbour={false} people={!burning} />
      <Heath light={light} horizon={baseY + 10} seed={m.seed + 21} />
      {m.ambience.weather.fog && <FogBank light={light} y={baseY - 30} opacity={0.45} />}
      {burning ? ours : <OwnSpears light={light} colour={m.ourColour ?? PLAYER_COLOUR} />}
      {light.rain && <Rain light={light} />}
    </>
  );
}

function Quay({ m, light, uid }: { m: SettlementPictureModel; light: Light; uid: string }): ReactElement {
  const horizon = 300;
  const baseY = 640;
  const plank = shade(mix('#5c4329', light.rim, 0.12), light.tod === 'day' ? 0.1 : 0.45);
  const planks: ReactElement[] = [];
  for (let i = 0; i < 8; i++) planks.push(<line key={i} x1={-200} y1={790 + i * 18 + i * i * 2} x2={VIEW_W + 200} y2={784 + i * 18 + i * i * 2} stroke={shade(plank, 0.4)} strokeWidth={2 + i * 0.4} />);
  return (
    <>
      <Sky uid={uid} light={light} horizon={horizon} seed={m.seed} />
      <Sea uid={uid} light={light} horizon={horizon} />
      <Coast light={light} horizon={horizon} baseY={baseY} seed={m.seed} />
      <SettlementView light={light} tier={m.tier} fortTier={m.fortTier} style={m.style} lantern={m.lantern} seed={m.seed} cx={1000} baseY={baseY} s={1.4 * tierScale(m.tier)} d={0.1} colour={m.colour} raided={m.raided} burning={false} harbour people />
      {/* The quay we stand on, with our own ship's prow at its side. */}
      <path d={`M-200 784 L${VIEW_W + 200} 776 L${VIEW_W + 200} 1100 L-200 1100 Z`} fill={plank} />
      {planks}
      <rect x={-200} y={774} width={VIEW_W + 400} height={12} fill={mix(plank, light.rim, 0.3)} />
      {[360, 1180].map((x) => (
        <g key={x}>
          <rect x={x} y={730} width={26} height={70} rx={6} fill={shade(plank, 0.3)} stroke={INK} strokeWidth={2} />
          <ellipse cx={x + 13} cy={732} rx={14} ry={5} fill={mix(plank, light.rim, 0.3)} />
        </g>
      ))}
      <g>
        <rect x={1260} y={740} width={60} height={56} rx={6} fill={shade('#6b4b2c', 0.3)} stroke={INK} strokeWidth={2} />
        <rect x={1330} y={752} width={48} height={44} rx={5} fill={shade('#7d5f38', 0.35)} stroke={INK} strokeWidth={2} />
        <ellipse cx={1440} cy={784} rx={40} ry={14} fill="none" stroke={shade('#a08860', 0.3)} strokeWidth={6} />
      </g>
      <path d={`M-40 900 C 0 760, 60 640, 150 560 q 30 -30 10 -60`} stroke={shade('#2a1a0e', 0.1)} strokeWidth={30} fill="none" strokeLinecap="round" />
      {light.rain && <Rain light={light} />}
    </>
  );
}

/** The settlement scene's picture. */
export const SettlementPicture = memo(function SettlementPicture({ model, testId = 'settlement-picture' }: { model: SettlementPictureModel; testId?: string }): ReactElement {
  const uid = useSceneUid();
  const ambience = model.view === 'aftermath' ? { ...model.ambience, hourOfDay: model.ambience.hourOfDay } : model.ambience;
  const light = lightFor(ambience.hourOfDay, ambience.season, ambience.weather);
  if (model.view === 'aftermath') {
    // Firelight on everything: the sky takes the glow of the burning.
    light.sky = [light.sky[0], light.sky[1], mix(light.sky[2], '#a0452a', 0.45), mix(light.sky[3], '#e07a3a', 0.4)];
    light.lamps = Math.max(light.lamps, 0.6);
  }
  const horizon = model.view === 'quay' ? 300 : model.view === 'sea' ? 380 : 400;
  return (
    <SceneSvg uid={uid} light={light} horizon={horizon} testId={testId}>
      {model.view === 'sea' ? <SeaArrival m={model} light={light} uid={uid} /> : model.view === 'quay' ? <Quay m={model} light={light} uid={uid} /> : <LandArrival m={model} light={light} uid={uid} burning={model.view === 'aftermath'} />}
    </SceneSvg>
  );
});
