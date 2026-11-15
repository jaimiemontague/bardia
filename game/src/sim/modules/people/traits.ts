/**
 * Trait bookkeeping (§5.4, §32.6): adding a trait replaces its mutually exclusive opposite
 * (Brave/Craven …); effects live only in the modifier bags of traits.json (read via util.ts).
 */
import { EffectError } from '@sim/core/effects';
import type { SimContext } from '@sim/core/module';
import type { Character } from '@sim/core/state';
import { notifyHouse, removeValue } from './util';

/** Adds a trait (removing its opposite). Returns false if the character already had it. */
export function addTrait(ctx: SimContext, c: Character, trait: string, source: string): boolean {
  const def = Object.hasOwn(ctx.content.traits, trait) ? ctx.content.traits[trait] : undefined;
  if (!def) throw new EffectError(`addTrait: unknown trait '${trait}'`);
  if (c.traits.includes(trait)) return false;
  if (def.opposite !== undefined && removeValue(c.traits, def.opposite)) {
    ctx.emit({ type: 'TraitLost', charId: c.id, trait: def.opposite });
  }
  c.traits.push(trait);
  ctx.emit({ type: 'TraitGained', charId: c.id, trait, source });
  notifyHouse(ctx, c, 'people.notify.traitGained', { trait });
  return true;
}

/** Removes a trait. Returns false if the character did not have it. */
export function removeTrait(ctx: SimContext, c: Character, trait: string): boolean {
  if (!removeValue(c.traits, trait)) return false;
  ctx.emit({ type: 'TraitLost', charId: c.id, trait });
  notifyHouse(ctx, c, 'people.notify.traitLost', { trait });
  return true;
}

/** Whether a character has a trait, by id or by its display name (case-insensitive). */
export function hasTraitNamed(ctx: Pick<SimContext, 'content'>, c: Character, trait: string): boolean {
  if (c.traits.includes(trait)) return true;
  const needle = trait.toLowerCase();
  for (const t of c.traits) {
    if (t.toLowerCase() === needle) return true;
    const name = ctx.content.traits[t]?.name;
    if (name !== undefined && name.toLowerCase() === needle) return true;
  }
  return false;
}
