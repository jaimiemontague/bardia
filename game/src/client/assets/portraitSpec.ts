/**
 * Character → portrait params for the `portraits.character` manifest entry. The sim stores only
 * `character.portrait = { seed, layers? }` (§30.3); everything else a portrait shows (sex, culture,
 * age stage, rank, faith, injuries, death) is read from the character at display time, so the same
 * seed ages, greys and scars with the character.
 */
import type { Character } from '@sim/core/state';
import { HOURS_PER_YEAR } from '@sim/core/time';
import type { GeneratorParams } from './types';

/** Portrait rank from a character's role and rank hints. */
function rankOf(c: Character, opts: { isRuler?: boolean; clergy?: boolean; seer?: boolean; warrior?: boolean }): string {
  if (opts.clergy) return 'clergy';
  if (opts.seer || c.traits.includes('seerTaught')) return 'seer';
  if (opts.isRuler || c.role?.kind === 'ruler') return 'ruler';
  if (c.role?.kind === 'lieutenant' || c.role?.kind === 'captain' || opts.warrior || c.traits.includes('hirdTrained')) return 'warrior';
  if (c.role?.kind === 'governor' || c.role?.kind === 'regent' || c.role?.kind === 'steward' || c.role?.kind === 'envoy') return 'noble';
  return 'common';
}

/**
 * Params for `useAsset('portraits.character', portraitParamsForCharacter(c, state.time.hour))`.
 * Optional hints let screens mark rulers, clergy or seers the role field does not capture.
 */
export function portraitParamsForCharacter(
  c: Pick<Character, 'sex' | 'culture' | 'faith' | 'birthHour' | 'alive' | 'traits' | 'health' | 'portrait' | 'role'> & { death?: Character['death'] },
  nowHour: number,
  opts: { isRuler?: boolean; clergy?: boolean; seer?: boolean; warrior?: boolean } = {},
): GeneratorParams {
  const ageAt = c.alive || !c.death ? nowHour : c.death.hour;
  const age = Math.max(0, Math.floor((ageAt - c.birthHour) / HOURS_PER_YEAR));
  const traits = [...c.traits];
  for (const inj of c.health.injuries) if (inj.id === 'lostEye' && !traits.includes('oneEyed')) traits.push('oneEyed');
  const out: Record<string, string | number | boolean> = {
    seed: c.portrait.seed,
    sex: c.sex,
    culture: c.culture,
    faith: c.faith,
    age,
    rank: rankOf(c as Character, opts),
    traits: traits.join(','),
    wounded: c.health.wound === 'serious' || c.health.wound === 'mortal',
    dead: !c.alive,
  };
  for (const [k, v] of Object.entries(c.portrait.layers ?? {})) out[`layer.${k}`] = v;
  return out;
}
