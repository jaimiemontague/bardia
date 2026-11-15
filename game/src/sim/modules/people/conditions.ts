/**
 * Condition-language functions over characters (§29.7). A character argument may be a `chr_` id,
 * a scope binding name (e.g. 'character' → scope.character), or one of 'ruler'/'player', 'heir',
 * 'spouse' (the ruler's first living spouse). Unknown characters read as false / 0 / ''.
 */
import { ATTRIBUTE_IDS, SKILL_IDS, type AttributeId, type SkillId } from '@content/schemas/ids';
import type { ConditionEvalContext, ConditionFns } from '@sim/core/module';
import type { Character, JsonValue } from '@sim/core/state';
import { z } from 'zod';
import { marriageBlocker } from './dynasty';
import { defaultHeir, kinDistance, livingSpouses } from './kin';
import { hasTraitNamed } from './traits';
import { ageOf, charOf, effectiveAttribute, effectiveSkill, isAdultAt, lifeStageOf } from './util';

const ref = z.string().min(1);

/** Resolves a character reference against the state and the scope. */
export function resolveCharRef(arg: JsonValue | undefined, ctx: ConditionEvalContext): Character | undefined {
  if (typeof arg !== 'string' || arg.length === 0) return undefined;
  const { state, scope } = ctx;
  if (arg.startsWith('chr_')) return charOf(state, arg);
  if (Object.hasOwn(scope, arg)) {
    const bound = scope[arg];
    if (bound !== undefined && bound !== arg) return resolveCharRef(bound, ctx);
  }
  const ruler = charOf(state, state.player.rulerId);
  switch (arg) {
    case 'ruler':
    case 'player':
      return ruler;
    case 'heir': {
      const regency = state.people?.regency;
      if (regency) return charOf(state, regency.heirId);
      return ruler ? charOf(state, defaultHeir(state, ruler)) : undefined;
    }
    case 'spouse':
      return ruler ? charOf(state, livingSpouses(state, ruler)[0]) : undefined;
    default:
      return undefined;
  }
}

/** The people module's condition functions. */
export function peopleConditionFns(): ConditionFns {
  return {
    /** hasTrait(c, 'Brave') → the character has the trait (id or name, any case). */
    hasTrait: {
      args: z.tuple([ref, z.string().min(1)]),
      returns: 'boolean',
      evaluate: ([c, trait], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch !== undefined && typeof trait === 'string' && hasTraitNamed({ content: ctx.env.content }, ch, trait);
      },
    },
    /** hasFeat(c, 'seaWise'). */
    hasFeat: {
      args: z.tuple([ref, z.string().min(1)]),
      returns: 'boolean',
      evaluate: ([c, feat], ctx) => resolveCharRef(c, ctx)?.feats.includes(String(feat)) === true,
    },
    /** age(c) → whole years (0 when unknown). */
    age: {
      args: z.tuple([ref]),
      returns: 'number',
      evaluate: ([c], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch ? ageOf(ch, ctx.state.time.hour) : 0;
      },
    },
    /** isAdult(c) → 16 or older. */
    isAdult: {
      args: z.tuple([ref]),
      returns: 'boolean',
      evaluate: ([c], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch !== undefined && isAdultAt(ch, ctx.state.time.hour, ctx.env.content);
      },
    },
    /** lifeStage(c) → 'infant' | 'child' | 'youth' | 'adult' ('' when unknown). */
    lifeStage: {
      args: z.tuple([ref]),
      returns: 'string',
      evaluate: ([c], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch ? lifeStageOf(ageOf(ch, ctx.state.time.hour), ctx.env.content) : '';
      },
    },
    isAlive: {
      args: z.tuple([ref]),
      returns: 'boolean',
      evaluate: ([c], ctx) => resolveCharRef(c, ctx)?.alive === true,
    },
    /** isMarried(c) → has a living spouse. */
    isMarried: {
      args: z.tuple([ref]),
      returns: 'boolean',
      evaluate: ([c], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch !== undefined && livingSpouses(ctx.state, ch).length > 0;
      },
    },
    isCaptive: {
      args: z.tuple([ref]),
      returns: 'boolean',
      evaluate: ([c], ctx) => resolveCharRef(c, ctx)?.location.kind === 'captive',
    },
    isPregnant: {
      args: z.tuple([ref]),
      returns: 'boolean',
      evaluate: ([c], ctx) => resolveCharRef(c, ctx)?.pregnancy !== undefined,
    },
    /** hasHeir() / hasHeir(c) → the ruler (or c) has someone to inherit. */
    hasHeir: {
      args: z.union([z.tuple([]), z.tuple([ref])]),
      returns: 'boolean',
      evaluate: (args, ctx) => {
        const ch = resolveCharRef(args[0] ?? 'ruler', ctx);
        if (!ch) return false;
        if (ch.id === ctx.state.player.rulerId && ctx.state.people?.regency !== undefined) return true;
        return defaultHeir(ctx.state, ch) !== undefined;
      },
    },
    level: {
      args: z.tuple([ref]),
      returns: 'number',
      evaluate: ([c], ctx) => resolveCharRef(c, ctx)?.level ?? 0,
    },
    /** skill(c, 'speechcraft') → effective skill (traits, injuries, wounds). */
    skill: {
      args: z.tuple([ref, z.enum(SKILL_IDS)]),
      returns: 'number',
      evaluate: ([c, s], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch && (SKILL_IDS as readonly string[]).includes(String(s)) ? effectiveSkill(ch, s as SkillId, ctx.env.content) : 0;
      },
    },
    /** attribute(c, 'might') → effective attribute. */
    attribute: {
      args: z.tuple([ref, z.enum(ATTRIBUTE_IDS)]),
      returns: 'number',
      evaluate: ([c, a], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch && (ATTRIBUTE_IDS as readonly string[]).includes(String(a)) ? effectiveAttribute(ch, a as AttributeId, ctx.env.content) : 0;
      },
    },
    /** woundState(c) → 'none' | 'minor' | 'serious' | 'mortal' ('' when unknown). */
    woundState: {
      args: z.tuple([ref]),
      returns: 'string',
      evaluate: ([c], ctx) => resolveCharRef(c, ctx)?.health.wound ?? '',
    },
    /** childCount(c) → living children (adopted included). */
    childCount: {
      args: z.tuple([ref]),
      returns: 'number',
      evaluate: ([c], ctx) => {
        const ch = resolveCharRef(c, ctx);
        return ch ? ch.family.childIds.filter((id) => charOf(ctx.state, id)?.alive === true).length : 0;
      },
    },
    /** canMarry(a, b) → the `marry` effect would accept the pair. */
    canMarry: {
      args: z.tuple([ref, ref]),
      returns: 'boolean',
      evaluate: ([a, b], ctx) => {
        const ca = resolveCharRef(a, ctx);
        const cb = resolveCharRef(b, ctx);
        return ca !== undefined && cb !== undefined && marriageBlocker(ctx.state, ctx.env.content, ca, cb, ctx.state.time.hour) === undefined;
      },
    },
    /** isKin(a, b) → blood or adoptive relatives within the kin search depth. */
    isKin: {
      args: z.tuple([ref, ref]),
      returns: 'boolean',
      evaluate: ([a, b], ctx) => {
        const ca = resolveCharRef(a, ctx);
        const cb = resolveCharRef(b, ctx);
        if (!ca || !cb || ca.id === cb.id) return false;
        return kinDistance(ctx.state, ca.id, cb.id, ctx.env.content.tunables.people.kinSearchDepth) !== undefined;
      },
    },
  };
}
