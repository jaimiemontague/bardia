/**
 * What the encounter scene shows, worked out from the pending `encounter` payload and the state (pure, so
 * the screen, its tests and the scene gallery agree): the picture's model, the cue, and the choices split
 * into the (at most four) in view and the rest behind "More".
 */
import type { FleetId, GameState, PendingDecision, TextVars } from '@sim/core/state';
import type { EncounterDecisionChoice, EncounterOption, EncounterPayloadExt } from '@sim/modules/encounters/types';
import { ambienceOf, approxMen, bannerColour, compassWord, oddsBand, PLAYER_COLOUR, timeOfDay, type Ambience, type CueGlyph, type CueSound, type EncounterPictureModel, type OddsBand } from '../../render/scenes/index';
import { hashString } from '../../render/scenes/paint';

export type EncounterPayloadView = EncounterPayloadExt & { fleetId?: FleetId; otherFleetId?: FleetId };

export interface PlannedChoice {
  choice: EncounterDecisionChoice;
  option?: EncounterOption;
  /** The odds of the risky ones, as the player's success (flee: getting away). */
  odds?: { band: OddsBand; success: number };
}

export interface EncounterView {
  payload: EncounterPayloadView;
  picture: EncounterPictureModel;
  assetId: string;
  cue: { mainKey: string; subKey: string; vars: TextVars; tone: 'danger' | 'calm'; sound: CueSound; glyph: CueGlyph };
  kickerVars: TextVars;
  whoKey: string;
  whoVars: TextVars;
  inView: PlannedChoice[];
  more: PlannedChoice[];
}

/** How often a choice is the one wanted (lower: more common, shown first after the safe default). */
function rank(id: string, peaceful: boolean): number {
  switch (id) {
    case 'yield':
    case 'fallBack':
      return 0;
    case 'trade':
    case 'fight':
      return 1;
    case 'pass':
      return peaceful ? 1.5 : 3;
    case 'attack':
      return 2;
    case 'evade':
    case 'slipAway':
      return 2.5;
    case 'payToll':
      return 3;
    case 'flee':
      return 4;
    case 'hail':
      return 4;
    case 'demandToll':
      return 5;
    default:
      return 6;
  }
}

const RISKY = new Set(['attack', 'fight', 'demandToll', 'evade', 'slipAway', 'flee']);

/** Splits the payload's choices: the safe default first, then the most common, at most four in view. */
export function planChoices(p: Pick<EncounterPayloadView, 'choices' | 'options' | 'defaultChoice' | 'aggressive'>): { inView: PlannedChoice[]; more: PlannedChoice[] } {
  const options = p.options ?? [];
  const plan = (c: EncounterDecisionChoice): PlannedChoice => {
    const option = options.find((o) => o.id === c.id);
    const chance = option?.chance;
    const out: PlannedChoice = { choice: c, ...(option ? { option } : {}) };
    if (chance !== undefined && RISKY.has(c.id)) {
      const success = c.id === 'flee' ? 1 - chance : chance;
      out.odds = { band: oddsBand(success), success };
    }
    return out;
  };
  const choices = (p.choices ?? []).map(plan);
  const open = choices.filter((c) => c.choice.disabled !== true);
  const off = choices.filter((c) => c.choice.disabled === true);
  const first = open.find((c) => c.choice.id === p.defaultChoice) ?? open[0];
  const peaceful = !p.aggressive;
  const rest = open
    .filter((c) => c !== first)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.choice.id, peaceful) - rank(b.c.choice.id, peaceful) || a.i - b.i)
    .map((x) => x.c);
  if (!first) return { inView: off.slice(0, 4), more: off.slice(4) };
  return { inView: [first, ...rest.slice(0, 3)], more: [...rest.slice(3), ...off] };
}

/** The scene's view of a pending encounter. */
export function encounterView(state: GameState, pending: PendingDecision): EncounterView {
  const p = pending.payload as unknown as EncounterPayloadView;
  const fleet = p.fleetId !== undefined ? state.fleets[p.fleetId] : undefined;
  const other = p.otherFleetId !== undefined ? state.fleets[p.otherFleetId] : undefined;
  const party = p.party ?? { ships: [], men: {} };
  const ambience: Ambience = ambienceOf(state, { zoneId: p.zoneId ?? null, ...(fleet ? { pos: fleet.pos } : {}) });
  const faction = party.factionId !== undefined ? state.factions[party.factionId] : undefined;
  const men = Object.values(party.men ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const domain = p.domain ?? 'sea';
  const stage = p.stage ?? 'sighted';
  const kind = p.kind ?? 'merchant';
  const picture: EncounterPictureModel = {
    ambience,
    kind,
    stage,
    domain,
    ships: (party.ships ?? []).map((s) => s.type),
    men,
    ...(faction ? { colour: bannerColour(faction, state.player.factionId) } : {}),
    ourColour: PLAYER_COLOUR,
    seed: hashString(p.encounterId ?? pending.id),
  };
  const danger = stage === 'caught' || p.aggressive === true;
  const dir = domain === 'sea' && fleet && other ? compassWord(fleet.pos, other.pos) : 'none';
  const cueKind = stage === 'caught' ? `caught.${domain}` : kind;
  const weather = ambience.weather.storm ? 'storm' : ambience.weather.fog ? 'fog' : 'clear';
  const vars = p.vars ?? {};
  return {
    payload: p,
    picture,
    assetId: stage === 'caught' ? `encounters.scene.caught.${domain}` : `encounters.scene.${kind}`,
    cue: { mainKey: `encounters.cue.${cueKind}`, subKey: `encounters.cue.${cueKind}.sub`, vars: { dir, faction: faction?.name ?? '' }, tone: danger ? 'danger' : 'calm', sound: danger ? 'hostile' : 'peaceful', glyph: domain === 'land' ? 'spears' : 'sail' },
    kickerVars: { tod: timeOfDay(ambience.hourOfDay), weather, zone: String(vars['zone'] ?? ''), hasZone: vars['hasZone'] === 'yes' ? 'yes' : 'no', domain },
    whoKey: `encounters.scene.who.${domain}`,
    whoVars: { ships: party.ships?.length ?? 0, men: approxMen(men), faction: faction?.name ?? '', hasFaction: faction ? 'yes' : 'no' },
    ...planChoices(p),
  };
}
