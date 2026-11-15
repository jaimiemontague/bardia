/**
 * Family-tree queries (§23): parents, children, siblings, kin distance, heir pools and the
 * "nearest adult kin" rule of succession. Edges are parent ↔ child links (adoptive parents count).
 * Plain records and arrays only (no Map/Set in module code).
 */
import type { Content } from '@content/index';
import type { Character, CharId, GameState, Hour } from '@sim/core/state';
import { byAgeDesc, charOf, isAdultAt } from './util';

/** Parents of a character: father, mother and adoptive parent (existing characters, unique). */
export function parentIds(state: GameState, c: Character): CharId[] {
  const out: CharId[] = [];
  for (const id of [c.family.fatherId, c.family.motherId, c.family.adoptedById]) {
    if (id !== undefined && !out.includes(id) && charOf(state, id)) out.push(id);
  }
  return out;
}

/** Children (biological and adopted) that exist. */
export function childIds(state: GameState, c: Character): CharId[] {
  return c.family.childIds.filter((id) => charOf(state, id) !== undefined);
}

/** Siblings and half-siblings (children of any parent), eldest first. */
export function siblingIds(state: GameState, c: Character): CharId[] {
  const out: CharId[] = [];
  for (const pid of parentIds(state, c)) {
    const p = charOf(state, pid);
    if (!p) continue;
    for (const k of p.family.childIds) if (k !== c.id && !out.includes(k) && charOf(state, k)) out.push(k);
  }
  return out.sort(byAgeDesc(state));
}

/**
 * Blood (and adoptive) relatives within `maxDepth` degrees, nearest first (then eldest), excluding
 * the root. Each entry is [id, degree]. Kinship follows blood lines only: up to a common ancestor,
 * then down (sibling 2, niece 3, cousin 4) — never down and up again, so the other parent of one's
 * child is not kin.
 */
export function kinByDistance(state: GameState, rootId: CharId, maxDepth: number): [CharId, number][] {
  const root = charOf(state, rootId);
  if (!root) return [];
  const found: Record<string, number> = { [rootId]: 0 };
  const seenUp: Record<string, true> = { [rootId]: true };
  const seenDown: Record<string, true> = {};
  const out: [CharId, number][] = [];
  let frontier: { id: CharId; up: boolean }[] = [{ id: rootId, up: true }];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: { id: CharId; up: boolean }[] = [];
    const fresh: CharId[] = [];
    const reach = (id: CharId) => {
      if (Object.hasOwn(found, id)) return;
      found[id] = depth;
      fresh.push(id);
    };
    for (const node of frontier) {
      const c = charOf(state, node.id);
      if (!c) continue;
      if (node.up) {
        for (const p of parentIds(state, c)) {
          if (Object.hasOwn(seenUp, p)) continue;
          seenUp[p] = true;
          next.push({ id: p, up: true });
          reach(p);
        }
      }
      for (const k of childIds(state, c)) {
        if (k === rootId || Object.hasOwn(seenDown, k) || Object.hasOwn(seenUp, k)) continue;
        seenDown[k] = true;
        next.push({ id: k, up: false });
        reach(k);
      }
    }
    fresh.sort(byAgeDesc(state));
    for (const id of fresh) out.push([id, depth]);
    frontier = next;
  }
  return out;
}

/** Parent/child steps between two characters (undefined beyond `maxDepth`). */
export function kinDistance(state: GameState, a: CharId, b: CharId, maxDepth: number): number | undefined {
  if (a === b) return 0;
  for (const [id, d] of kinByDistance(state, a, maxDepth)) if (id === b) return d;
  return undefined;
}

function alive(state: GameState, id: CharId): boolean {
  return charOf(state, id)?.alive === true;
}

/** Rules another faction (a queen married abroad does not inherit this house). */
function rulesElsewhere(state: GameState, c: Character, factionId: string | undefined): boolean {
  return c.role?.kind === 'ruler' && c.role.factionId !== undefined && c.role.factionId !== factionId;
}

/**
 * Who may be named heir (§23.4), in default order: children (incl. adopted), then siblings, then
 * nieces and nephews — each group eldest first. Living characters only.
 */
export function heirPool(state: GameState, ruler: Character): CharId[] {
  const factionId = ruler.factionId;
  const out: CharId[] = [];
  const add = (ids: CharId[]) => {
    for (const id of ids) {
      const c = charOf(state, id);
      if (!c || !c.alive || id === ruler.id || out.includes(id) || rulesElsewhere(state, c, factionId)) continue;
      out.push(id);
    }
  };
  add([...childIds(state, ruler)].sort(byAgeDesc(state)));
  const siblings = siblingIds(state, ruler);
  add(siblings);
  const nephews: CharId[] = [];
  for (const s of siblings) {
    const sc = charOf(state, s);
    if (sc) for (const k of childIds(state, sc)) if (!nephews.includes(k)) nephews.push(k);
  }
  add(nephews.sort(byAgeDesc(state)));
  return out;
}

/** The designated heir if still eligible, otherwise the first of the heir pool. */
export function defaultHeir(state: GameState, ruler: Character): CharId | undefined {
  const pool = heirPool(state, ruler);
  const designated = ruler.family.heirId;
  if (designated !== undefined && pool.includes(designated)) return designated;
  return pool[0];
}

/** Nearest living adult blood relative (then the eldest at that distance), or undefined. */
export function nearestAdultKin(state: GameState, deceased: Character, hour: Hour, content: Content, maxDepth: number): CharId | undefined {
  for (const [id] of kinByDistance(state, deceased.id, maxDepth)) {
    const c = charOf(state, id);
    if (!c || !c.alive || rulesElsewhere(state, c, deceased.factionId)) continue;
    if (isAdultAt(c, hour, content)) return id;
  }
  return undefined;
}

/** Living spouses, eldest first. */
export function livingSpouses(state: GameState, c: Character): CharId[] {
  return c.family.spouseIds.filter((id) => alive(state, id)).sort(byAgeDesc(state));
}
