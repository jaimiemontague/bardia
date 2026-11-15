/**
 * Developer scene gallery (route 'sceneGallery', fullscreen): paints every scene variant from sample data,
 * one at a time, so the scenes can be looked at and screenshotted without sailing into each case.
 *
 *   /?scenes=sea-day-merchant            opens it on a variant (dev builds)
 *   /?scenes=sea-night-raiders&cue=1     shows that variant's attention cue first
 *
 * Choices dispatch nothing here. The variant list is developer data, not player text.
 */
import { useState, type ReactElement } from 'react';
import type { Command } from '@sim/core/commands';
import type { Settlement, TextVars } from '@sim/core/state';
import type { EncounterDecisionChoice, EncounterOption, EncounterPayloadExt } from '@sim/modules/encounters/types';
import type { AftermathFate, ArrivalChoice, DecisionOption } from '@sim/modules/settlements/types';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { FACTION_COLOURS, PLAYER_COLOUR, SceneStage, styleOfCulture, type Ambience, type SceneWeather, type SettlementPictureModel } from '../../render/scenes/index';
import { hashString } from '../../render/scenes/paint';
import { ArrivalScene } from '../arrivalScene/ArrivalScene';
import { planArrival, type ArrivalView } from '../arrivalScene/model';
import { VisitScene, type VisitPlace } from '../settlement/hub';
import { AftermathSceneBody } from '../settlement/index';
import { EncounterScene } from './EncounterScene';
import { planChoices, type EncounterView } from './model';

const FAIR: SceneWeather = { fog: false, wind: 'fresh', storm: false };

function amb(hourOfDay: number, weather: Partial<SceneWeather> = {}, season: Ambience['season'] = 'summer'): Ambience {
  return { hourOfDay, season, weather: { ...FAIR, ...weather } };
}

type Opt = [id: EncounterOption['id'], chance?: number, available?: boolean, reason?: string, extra?: TextVars];

function sampleEncounter(kind: EncounterPayloadExt['kind'], stage: EncounterPayloadExt['stage'], ambience: Ambience, ships: string[], men: number, opts: Opt[], defaultChoice: EncounterOption['id'], aggressive: boolean, colour?: string): EncounterView {
  const domain = kind === 'outlaws' || kind === 'landPatrol' ? 'land' : 'sea';
  const options: EncounterOption[] = opts.map(([id, chance, available = true, reason, extra]) => ({ id, available, ...(chance !== undefined ? { chance } : {}), ...(reason ? { reason } : {}), ...(extra ? { vars: extra } : {}) }));
  const choices: EncounterDecisionChoice[] = options.map((o, i) => ({
    id: o.id,
    labelKey: `encounters.choice.${o.id}`,
    vars: { who: 'Ketil', hasWho: o.id === 'evade' || o.id === 'hail' ? 'yes' : 'no', pct: Math.round((o.chance ?? 0) * 100), ...(o.vars ?? {}), ...(o.reason ? { reason: o.reason } : {}) },
    command: { type: 'resolveEncounter', choice: o.id } as never,
    tone: ['attack', 'fight', 'demandToll'].includes(o.id) ? 'danger' : i === 0 ? 'primary' : 'secondary',
    ...(o.available ? { previewKey: `encounters.preview.${o.id}` } : { disabled: true, previewKey: `encounters.reason.${o.reason ?? 'unavailable'}` }),
  }));
  const faction = colour ? 'Vargholm' : '';
  const vars: TextVars = { faction, ships: ships.length, men, ourMen: 60, zone: 'the Grey Sound', hasZone: 'yes', lookout: 'Ketil', leader: 'Sigrun', stronger: 'even', kind, peaceful: aggressive ? 'no' : 'yes' };
  const payload = {
    encounterId: `enc_gallery_${kind}_${stage}`,
    kind,
    stage,
    domain,
    aggressive,
    atWar: false,
    party: { ships: ships.map((type) => ({ type, crew: 30 })), men: { spearmen: men } },
    toll: { silver: 40, rations: 30 },
    variant: 1,
    defaultChoice,
    titleKey: stage === 'caught' ? `encounters.title.caught.${domain}` : `encounters.title.${kind}`,
    key: stage === 'caught' ? `encounters.caught.${domain}.1` : `encounters.sighted.${kind}.1`,
    vars,
    options,
    choices,
  } as unknown as EncounterView['payload'];
  const weather = ambience.weather.storm ? 'storm' : ambience.weather.fog ? 'fog' : 'clear';
  const tod = ambience.hourOfDay >= 5 && ambience.hourOfDay < 8 ? 'dawn' : ambience.hourOfDay >= 8 && ambience.hourOfDay < 18 ? 'day' : ambience.hourOfDay >= 18 && ambience.hourOfDay < 21 ? 'dusk' : 'night';
  const danger = stage === 'caught' || aggressive;
  return {
    payload,
    picture: { ambience, kind, stage, domain, ships, men, ...(colour ? { colour } : {}), ourColour: PLAYER_COLOUR, seed: hashString(`${kind}${stage}`) },
    assetId: stage === 'caught' ? `encounters.scene.caught.${domain}` : `encounters.scene.${kind}`,
    cue: { mainKey: `encounters.cue.${stage === 'caught' ? `caught.${domain}` : kind}`, subKey: `encounters.cue.${stage === 'caught' ? `caught.${domain}` : kind}.sub`, vars: { dir: 'ne', faction }, tone: danger ? 'danger' : 'calm', sound: 'none', glyph: domain === 'land' ? 'spears' : 'sail' },
    kickerVars: { tod, weather, zone: 'the Grey Sound', hasZone: domain === 'sea' ? 'yes' : 'no', domain },
    whoKey: `encounters.scene.who.${domain}`,
    whoVars: { ships: ships.length, men, faction, hasFaction: colour ? 'yes' : 'no' },
    ...planChoices({ choices, options, defaultChoice, aggressive }),
  };
}

const ALL_ARRIVAL: ArrivalChoice[] = ['enter', 'parley', 'trade', 'raid', 'assault', 'besiege', 'leave'];

function sampleSettlement(tier: string, fortTier: number, culture = 'skarn', faith = 'oldways', name = 'Hvitaness'): Settlement {
  return { id: `set_gallery_${tier}_${culture}`, name, tier, fortTier, culture, faith, pop: tier === 'hamlet' ? 60 : tier === 'village' ? 340 : tier === 'town' ? 1400 : tier === 'city' ? 5200 : tier === 'capital' ? 8800 : 420, coastal: true } as unknown as Settlement;
}

function sampleArrival(s: Settlement, ambience: Ambience, opts: { raided?: boolean; view?: SettlementPictureModel['view']; own?: boolean } = {}): ArrivalView {
  const options: DecisionOption<ArrivalChoice>[] = ALL_ARRIVAL.map((id) => (id === 'besiege' ? { id, available: false, reasonKey: s.fortTier < 1 ? 'settlements.reason.noWalls' : 'settlements.reason.siegeLater' } : opts.own && (id === 'raid' || id === 'assault' || id === 'parley') ? { id, available: false, reasonKey: 'settlements.reason.own' } : { id, available: true }));
  const picture: SettlementPictureModel = {
    ambience,
    tier: s.tier,
    fortTier: s.fortTier,
    style: styleOfCulture(s.culture),
    lantern: s.faith === 'lantern' || s.faith === 'goldenLantern',
    seed: hashString(s.id),
    colour: FACTION_COLOURS[1],
    ourColour: PLAYER_COLOUR,
    raided: opts.raided === true,
    coastal: true,
    view: opts.view ?? 'sea',
  };
  const tod = ambience.hourOfDay >= 5 && ambience.hourOfDay < 8 ? 'dawn' : ambience.hourOfDay >= 8 && ambience.hourOfDay < 18 ? 'day' : ambience.hourOfDay >= 18 && ambience.hourOfDay < 21 ? 'dusk' : 'night';
  return {
    settlement: s,
    picture,
    assetId: `settlements.scene.arrival.${s.tier}`,
    cue: { mainKey: opts.own ? 'settlements.cue.own' : opts.raided ? 'settlements.cue.raided' : opts.view === 'land' ? 'settlements.cue.overland' : `settlements.cue.${s.tier}`, vars: { settlement: s.name } },
    knownVars: { tier: s.tier, pop: s.pop, walls: String(s.fortTier), own: opts.own ? 'yes' : 'no', lord: 'House Vargholm', scarred: opts.raided ? 'yes' : 'no' },
    kickerVars: { tod, weather: ambience.weather.fog ? 'fog' : 'clear', men: 84, overland: opts.view === 'land' ? 'yes' : 'no' },
    ...planArrival(options),
  };
}

export type Variant = { kind: 'encounter'; view: EncounterView } | { kind: 'arrival'; view: ArrivalView } | { kind: 'aftermath' | 'visit'; s: Settlement; picture: SettlementPictureModel };

function variants(): Record<string, () => Variant> {
  const merchantOpts: Opt[] = [['hail'], ['trade', undefined, true, undefined, { deal: 'sell', good: 'salt', tons: 3, silver: 42 }], ['demandToll', 0.55], ['attack', 0.72], ['pass']];
  const raiderOpts: Opt[] = [['hail', undefined, false, 'noParley'], ['payToll', undefined, true, undefined, { silver: 40, rations: 30 }], ['attack', 0.46], ['evade', 0.64], ['flee', 0.3]];
  const patrolOpts: Opt[] = [['hail'], ['payToll', undefined, true, undefined, { silver: 25, rations: 0 }], ['demandToll', 0.2], ['attack', 0.38], ['evade', 0.7], ['pass']];
  const caughtSea: Opt[] = [['yield'], ['fight', 0.4]];
  const outlawOpts: Opt[] = [['hail', undefined, false, 'noParley'], ['payToll', undefined, true, undefined, { silver: 18, rations: 20 }], ['attack', 0.66], ['slipAway', 0.71]];
  const landPatrolOpts: Opt[] = [['hail'], ['payToll', undefined, true, undefined, { silver: 20, rations: 0 }], ['demandToll', 0.25], ['attack', 0.5], ['slipAway', 0.6]];
  const caughtLand: Opt[] = [['fallBack'], ['fight', 0.55]];
  const red = FACTION_COLOURS[0];
  const blue = FACTION_COLOURS[1];
  const gold = FACTION_COLOURS[2];
  const e = (v: EncounterView): Variant => ({ kind: 'encounter', view: v });
  const a = (v: ArrivalView): Variant => ({ kind: 'arrival', view: v });
  return {
    'sea-day-merchant': () => e(sampleEncounter('merchant', 'sighted', amb(12), ['knarr', 'knarr'], 34, merchantOpts, 'hail', false, gold)),
    'sea-dusk-patrol': () => e(sampleEncounter('patrol', 'sighted', amb(19), ['snekkja', 'karvi', 'snekkja'], 90, patrolOpts, 'hail', false, blue)),
    'sea-night-raiders': () => e(sampleEncounter('raiders', 'sighted', amb(23), ['snekkja', 'karvi', 'snekkja', 'karvi'], 120, raiderOpts, 'evade', true)),
    'sea-dawn-warfleet-fog': () => e(sampleEncounter('warfleet', 'sighted', amb(6, { fog: true }), ['drakkar', 'snekkja', 'snekkja', 'drakkar', 'karvi', 'snekkja', 'snekkja', 'karvi'], 420, raiderOpts, 'evade', true, red)),
    'sea-storm-galleys': () => e(sampleEncounter('warfleet', 'sighted', amb(14, { storm: true, wind: 'gale' }), ['galley', 'galley', 'galley'], 260, raiderOpts, 'evade', true, FACTION_COLOURS[4])),
    'sea-day-caught': () => e(sampleEncounter('raiders', 'caught', amb(15), ['drakkar', 'snekkja'], 140, caughtSea, 'yield', true)),
    'sea-night-caught': () => e(sampleEncounter('warfleet', 'caught', amb(2), ['drakkar', 'snekkja', 'snekkja'], 200, caughtSea, 'yield', true, red)),
    'land-day-outlaws': () => e(sampleEncounter('outlaws', 'sighted', amb(13), [], 40, outlawOpts, 'slipAway', true)),
    'land-dusk-patrol': () => e(sampleEncounter('landPatrol', 'sighted', amb(19), [], 50, landPatrolOpts, 'hail', false, blue)),
    'land-winter-patrol': () => e(sampleEncounter('landPatrol', 'sighted', amb(11, {}, 'winter'), [], 30, landPatrolOpts, 'hail', false, gold)),
    'land-caught': () => e(sampleEncounter('outlaws', 'caught', amb(17), [], 40, caughtLand, 'fallBack', true)),
    'arrival-hamlet': () => a(sampleArrival(sampleSettlement('hamlet', 0), amb(11))),
    'arrival-village': () => a(sampleArrival(sampleSettlement('village', 1), amb(19))),
    'arrival-town-walled': () => a(sampleArrival(sampleSettlement('town', 2, 'hvarn'), amb(10))),
    'arrival-town-night': () => a(sampleArrival(sampleSettlement('town', 3, 'eyjar'), amb(22))),
    'arrival-city-west': () => a(sampleArrival(sampleSettlement('city', 4, 'albric', 'lantern', 'Wenbury'), amb(13))),
    'arrival-capital-south': () => a(sampleArrival(sampleSettlement('capital', 4, 'corvani', 'goldenLantern', 'Castrovalle'), amb(16))),
    'arrival-cloister': () => a(sampleArrival(sampleSettlement('cloister', 0, 'cael', 'lantern', 'Inis Cael'), amb(7))),
    'arrival-fortress': () => a(sampleArrival(sampleSettlement('fortress', 4, 'velkar', 'riverSpirits', 'Volgrad'), amb(12, { fog: true }))),
    'arrival-emporium': () => a(sampleArrival(sampleSettlement('emporium', 1, 'eyjar', 'oldways', 'Birkey'), amb(9))),
    'arrival-templeStead': () => a(sampleArrival(sampleSettlement('templeStead', 1, 'skarn'), amb(20))),
    'arrival-sun': () => a(sampleArrival(sampleSettlement('town', 3, 'saraleonese', 'highSky', 'Qasr Amal'), amb(15))),
    'arrival-steppe': () => a(sampleArrival(sampleSettlement('village', 0, 'kurgai', 'highSky', 'Tor Ulan'), amb(18))),
    'arrival-raided': () => a(sampleArrival(sampleSettlement('village', 1), amb(12), { raided: true })),
    'arrival-overland': () => a(sampleArrival(sampleSettlement('town', 2, 'albric', 'lantern', 'Wenbury'), amb(15), { view: 'land' })),
    'arrival-own': () => a(sampleArrival(sampleSettlement('town', 1, 'skarn', 'oldways', 'Skarnvik'), amb(17), { own: true })),
    'visit-town': () => {
      const s = sampleSettlement('town', 2, 'skarn', 'oldways', 'Hvitaness');
      return { kind: 'visit', s, picture: { ...sampleArrival(s, amb(11)).picture, view: 'quay' } };
    },
    'visit-city-night': () => {
      const s = sampleSettlement('city', 4, 'albric', 'lantern', 'Wenbury');
      return { kind: 'visit', s, picture: { ...sampleArrival(s, amb(22)).picture, view: 'quay' } };
    },
    aftermath: () => {
      const s = sampleSettlement('town', 2, 'albric', 'lantern', 'Wenbury');
      return { kind: 'aftermath', s, picture: { ...sampleArrival(s, amb(20)).picture, raided: true, view: 'aftermath' } };
    },
  };
}

export const SCENE_VARIANTS: readonly string[] = Object.keys(variants());

/** One gallery variant's sample data (tests use it too). */
export function galleryVariant(name: string): Variant | undefined {
  return variants()[name]?.();
}

function readParams(): { variant: string; cue: boolean } {
  try {
    const q = new URLSearchParams(window.location.search);
    return { variant: q.get('scenes') || 'sea-day-merchant', cue: q.get('cue') === '1' };
  } catch {
    return { variant: 'sea-day-merchant', cue: false };
  }
}

/** One variant, painted full screen (exported for tests). */
export function SceneVariant({ name, cue }: { name: string; cue: boolean }): ReactElement | null {
  const make = variants()[name];
  if (!make) return null;
  const v = make();
  const noop = (_c: Command) => undefined;
  if (v.kind === 'encounter') return <EncounterScene key={`${name}${cue}`} view={v.view} onCommand={noop} cue={cue} />;
  if (v.kind === 'arrival') return <ArrivalScene key={`${name}${cue}`} view={v.view} onChoose={() => undefined} cue={cue} />;
  if (v.kind === 'visit') return <GalleryVisit s={v.s} picture={v.picture} />;
  const fates: DecisionOption<AftermathFate>[] = (['sackAndBurn', 'plunderAndLeave', 'spare', 'takeCaptives', 'makeTributary', 'annex', 'liberate'] as AftermathFate[]).map((id) => (id === 'liberate' ? { id, available: false, reasonKey: 'settlements.reason.noAlly' } : { id, available: true, preview: { renown: 5, dread: id === 'sackAndBurn' ? 12 : 2 } }));
  return (
    <SceneStage key={name} cue={null}>
      <AftermathSceneBody settlement={v.s} picture={v.picture} options={fates} governors={[]} onChoose={() => undefined} />
    </SceneStage>
  );
}

function GalleryVisit({ s, picture }: { s: Settlement; picture: SettlementPictureModel }): ReactElement {
  const t = useT();
  const [place, setPlace] = useState<VisitPlace | null>(null);
  return (
    <VisitScene
      name={s.name}
      line={t('settlements.ui.line', { tier: s.tier, lord: 'House Vargholm', pop: s.pop })}
      kicker={t('settlements.scene.visitKicker', { tod: picture.ambience.hourOfDay >= 21 ? 'night' : 'day' })}
      facts={t('settlements.scene.purseHold', { silver: 412, used: 6.5, capacity: 18 })}
      picture={picture}
      assetId={`settlements.scene.visit.${s.tier}`}
      marketOpen
      marketShut=""
      place={place}
      onPlace={setPlace}
      onLeave={() => undefined}
      panel={<p>{t('settlements.scene.place.meadHall')}</p>}
    />
  );
}

function SceneGallery({ close }: ScreenProps): ReactElement {
  const t = useT();
  const [{ variant, cue }, setSel] = useState(readParams);
  return (
    <div className="scn-gallery" data-testid="scene-gallery" data-variant={variant}>
      <SceneVariant name={variant} cue={cue} />
      <div className="scn-gallery-bar">
        <span>{t('encounters.gallery.title')}</span>
        <select value={variant} onChange={(e) => setSel({ variant: e.target.value, cue })} data-testid="scene-gallery-pick">
          {SCENE_VARIANTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button type="button" onClick={close}>
          ×
        </button>
      </div>
    </div>
  );
}

export const sceneGalleryScreen: ScreenDescriptor = { id: 'sceneGallery', route: 'sceneGallery', layout: 'fullscreen', titleKey: 'encounters.gallery.title', component: SceneGallery };

// Deep link in dev builds: /?scenes=<variant>[&cue=1].
if (typeof window !== 'undefined') {
  try {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('scenes')) setTimeout(() => navigation.showMenu('sceneGallery'), 0);
  } catch {
    /* non-browser environment */
  }
}
