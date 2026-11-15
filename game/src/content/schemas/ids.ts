/**
 * Closed id vocabularies shared by content data, schemas and the simulation.
 * This is the lowest layer of the codebase: it imports nothing from sim or client.
 *
 * Owner decisions applied (see ARCHITECTURE.md): an Avar/Bulgar-like steppe culture
 * ('kurgai') and its sky faith ('highSky') were added to the design's §30.1 lists.
 */
import { z } from 'zod';

export const CULTURE_IDS = [
  'skarn',
  'hvarn',
  'eyjar',
  'albric',
  'cael',
  'corvani',
  'velkar',
  'kurgai',
  'saraleonese',
  'isafolder',
  'rime',
] as const;
export type CultureId = (typeof CULTURE_IDS)[number];
export const CultureIdSchema = z.enum(CULTURE_IDS);

/** The three playable homeland cultures. */
export const HOMELAND_CULTURE_IDS = ['skarn', 'hvarn', 'eyjar'] as const;
export type HomelandCultureId = (typeof HOMELAND_CULTURE_IDS)[number];

export const FAITH_IDS = ['oldways', 'lantern', 'goldenLantern', 'riverSpirits', 'highSky'] as const;
export type FaithId = (typeof FAITH_IDS)[number];
export const FaithIdSchema = z.enum(FAITH_IDS);

export const SKILL_IDS = [
  'melee',
  'archery',
  'command',
  'seafaring',
  'wildcraft',
  'speechcraft',
  'stewardship',
  'runecraft',
] as const;
export type SkillId = (typeof SKILL_IDS)[number];
export const SkillIdSchema = z.enum(SKILL_IDS);

export const ATTRIBUTE_IDS = ['might', 'agility', 'wits', 'vigor'] as const;
export type AttributeId = (typeof ATTRIBUTE_IDS)[number];
export const AttributeIdSchema = z.enum(ATTRIBUTE_IDS);

export const GOD_IDS = ['valgrim', 'dunnar', 'saltha', 'fjorna', 'eidr', 'skell', 'grayQueen'] as const;
export type GodId = (typeof GOD_IDS)[number];
export const GodIdSchema = z.enum(GOD_IDS);

/** §30.1 goods plus 'pitch' (needed by fire arrows, §12.2/§15.2). */
export const GOOD_IDS = [
  'rations',
  'salt',
  'timber',
  'iron',
  'pitch',
  'furs',
  'ivory',
  'amber',
  'cloth',
  'wine',
  'mead',
  'honey',
  'jewelry',
  'silk',
  'weapons',
] as const;
export type GoodId = (typeof GOOD_IDS)[number];
export const GoodIdSchema = z.enum(GOOD_IDS);

export const SHIP_TYPE_IDS = ['karvi', 'snekkja', 'drakkar', 'knarr', 'galley', 'riverboat'] as const;
export type ShipTypeId = (typeof SHIP_TYPE_IDS)[number];
export const ShipTypeIdSchema = z.enum(SHIP_TYPE_IDS);

export const DIFFICULTY_IDS = ['hearthside', 'raider', 'seaKing', 'longWinter'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];
export const DifficultyIdSchema = z.enum(DIFFICULTY_IDS);

export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonId = (typeof SEASON_IDS)[number];

export const FORMATION_IDS = ['line', 'shieldWall', 'wedge', 'loose'] as const;
export type FormationId = (typeof FORMATION_IDS)[number];
export const FormationIdSchema = z.enum(FORMATION_IDS);

export const SETTLEMENT_TIER_IDS = [
  'hamlet',
  'village',
  'town',
  'city',
  'capital',
  'cloister',
  'fortress',
  'emporium',
  'templeStead',
] as const;
export type SettlementTierId = (typeof SETTLEMENT_TIER_IDS)[number];
export const SettlementTierIdSchema = z.enum(SETTLEMENT_TIER_IDS);

export const ECONOMY_STATE_IDS = ['ruined', 'destitute', 'poor', 'fair', 'thriving'] as const;
export type EconomyStateId = (typeof ECONOMY_STATE_IDS)[number];
export const EconomyStateIdSchema = z.enum(ECONOMY_STATE_IDS);

export const TAX_RATE_IDS = ['light', 'fair', 'heavy', 'crushing'] as const;
export type TaxRateId = (typeof TAX_RATE_IDS)[number];

/** Duel weapons (§14.4, §30.8). 'daneAxe' is the two-handed axe (id only; displayed as "Two-handed axe"). */
export const DUEL_WEAPON_IDS = ['sword', 'axe', 'spear', 'daneAxe', 'hammer'] as const;
export type DuelWeaponId = (typeof DUEL_WEAPON_IDS)[number];
export const DuelWeaponIdSchema = z.enum(DUEL_WEAPON_IDS);

export const OMEN_IDS = ['ill', 'uncertain', 'fair', 'blessed'] as const;
export type OmenId = (typeof OMEN_IDS)[number];

export const BUILDING_IDS = [
  'hall',
  'walls',
  'smithy',
  'shipyard',
  'market',
  'grove',
  'farms',
  'watchtowers',
  'meadhall',
  'seersHut',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
export const BuildingIdSchema = z.enum(BUILDING_IDS);
