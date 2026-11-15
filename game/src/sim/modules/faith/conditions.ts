/**
 * Condition-language functions over faith data (design §29.7), for storylets and line pools —
 * notably the Missionary storylet family (§17.7) the narrative module fires:
 *
 *   favor('saltha') > 10          the player's Favor with a god
 *   omen('voyage') == 'ill'       the reading in force ('none' when there is none)
 *   faithWrath() >= 30            Faith Wrath
 *   piety() >= 50                 Piety (0 before conversion)
 *   isConverted()                 the house keeps the Lantern
 *   hasChapel()                   a chapel stands in one of the house's holdings
 *   canConvert()                  every §17.7 conversion requirement is met
 *   recentLanternContact()        traded with, visited or hosted the Lantern within the window
 */
import { GodIdSchema } from '@content/schemas/ids';
import { OmenActivitySchema } from '@content/schemas/tunables/faith';
import type { ConditionFns } from '@sim/core/module';
import type { GodId } from '@sim/core/state';
import { z } from 'zod';
import { conversionBlockers, hasChapel } from './conversion';
import { currentOmen } from './omens';
import { isLanternFaith } from './state';

export const FAITH_CONDITION_FNS: ConditionFns = {
  favor: {
    args: z.tuple([GodIdSchema]),
    returns: 'number',
    evaluate: ([god], { state }) => {
      const favor = state.player.house.favor;
      const g = String(god);
      return Object.hasOwn(favor, g) ? (favor[g as GodId] ?? 0) : 0;
    },
  },
  omen: {
    args: z.tuple([OmenActivitySchema]),
    returns: 'string',
    evaluate: ([activity], { state }) => {
      const parsed = OmenActivitySchema.safeParse(activity);
      if (!parsed.success) return 'none';
      return currentOmen(state.player.house.omens, parsed.data, state.time.hour)?.omen ?? 'none';
    },
  },
  faithWrath: {
    args: z.tuple([]),
    returns: 'number',
    evaluate: (_args, { state }) => state.player.house.faithWrath,
  },
  piety: {
    args: z.tuple([]),
    returns: 'number',
    evaluate: (_args, { state }) => state.player.house.piety ?? 0,
  },
  isConverted: {
    args: z.tuple([]),
    returns: 'boolean',
    evaluate: (_args, { state, env }) => isLanternFaith(env.content.tunables.faith, state.player.house.faith),
  },
  hasChapel: {
    args: z.tuple([]),
    returns: 'boolean',
    evaluate: (_args, { state }) => hasChapel(state),
  },
  canConvert: {
    args: z.tuple([]),
    returns: 'boolean',
    evaluate: (_args, { state, env }) => conversionBlockers(state, env.content.tunables.faith).length === 0,
  },
  recentLanternContact: {
    args: z.tuple([]),
    returns: 'boolean',
    evaluate: (_args, { state, env }) => {
      const at = state.faith?.lanternContactHour;
      if (at === undefined) return false;
      return state.time.hour - at <= env.content.tunables.faith.conversion.contactWindowDays * 24;
    },
  },
};
