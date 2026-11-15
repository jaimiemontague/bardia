/**
 * Integrator test: the running module registry agrees with the ownership tables in
 * core/ownership.ts. A module registering an op, command or condition function that is listed for
 * another module fails here (before two agents can collide). With BARDIA_STRICT_OWNERSHIP=1 (once
 * the parallel phase is complete) every listed item must also be registered by its owner.
 */
import { describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '@content/areas';
import { createSimEnv } from './core/env';
import {
  COMMAND_OWNERS,
  CONDITION_FN_OWNERS,
  DESIGN_EFFECT_PRIMITIVES,
  EFFECT_OWNERS,
  EVENT_OWNERS,
  PENDING_OWNERS,
  SLICE_OWNERS,
} from './core/ownership';
import { createEmptyState } from './core/initialState';
import { MODULE_IDS, MODULES } from './modules';

const STRICT = process.env.BARDIA_STRICT_OWNERSHIP === '1';
const KNOWN_OWNERS = new Set(['core', ...MODULE_IDS]);

describe('ownership tables', () => {
  it('cover every §19.1 effect primitive, every core pending kind and every root slice', () => {
    for (const op of DESIGN_EFFECT_PRIMITIVES) expect({ op, owner: EFFECT_OWNERS[op] }).not.toEqual({ op, owner: undefined });
    const corePending = ['encounter', 'arrival', 'envoy', 'storylet', 'battleSetup', 'duel', 'seaBattle', 'aftermath', 'captivity', 'succession', 'thing', 'delve', 'yearEnd', 'message'];
    expect(Object.keys(PENDING_OWNERS).sort()).toEqual([...corePending].sort());
    expect(Object.keys(createEmptyState({ seed: 's' })).filter((k) => k !== 'subsims').sort()).toEqual(
      Object.keys(SLICE_OWNERS).filter((k) => !k.startsWith('subsims.')).sort(),
    );
  });

  it('name only real module ids', () => {
    const owners = [
      ...Object.values(EFFECT_OWNERS),
      ...Object.values(COMMAND_OWNERS).filter((o) => o !== 'session' && o !== 'client'),
      ...Object.values(PENDING_OWNERS).flatMap((p) => [p.raisedBy, p.resolvedBy].filter((o) => o !== 'any')),
      ...Object.values(EVENT_OWNERS).map((o) => o.split(':')[0] as string),
      ...Object.values(CONDITION_FN_OWNERS),
      ...Object.values(SLICE_OWNERS),
    ];
    expect(owners.filter((o) => !KNOWN_OWNERS.has(o))).toEqual([]);
    for (const p of Object.values(PENDING_OWNERS)) expect(COMMAND_OWNERS[p.command]).toBe(p.resolvedBy);
  });

  it('content areas list exactly the registered module ids', () => {
    expect([...MODULE_AREAS].sort()).toEqual([...MODULE_IDS].sort());
  });

  it('the running registry registers listed items only through their owners', () => {
    const env = createSimEnv({ modules: MODULES });
    const wrong: string[] = [];
    for (const [op, entry] of env.effects) if (EFFECT_OWNERS[op] && EFFECT_OWNERS[op] !== entry.moduleId) wrong.push(`effect ${op}: ${entry.moduleId} (owner ${EFFECT_OWNERS[op]})`);
    for (const [type, entry] of env.handlers) if (COMMAND_OWNERS[type] && COMMAND_OWNERS[type] !== entry.moduleId) wrong.push(`command ${type}: ${entry.moduleId} (owner ${COMMAND_OWNERS[type]})`);
    for (const [name, entry] of env.conditionFns) if (CONDITION_FN_OWNERS[name] && CONDITION_FN_OWNERS[name] !== entry.moduleId) wrong.push(`condition ${name}: ${entry.moduleId} (owner ${CONDITION_FN_OWNERS[name]})`);
    expect(wrong).toEqual([]);
  });

  it.skipIf(!STRICT)('(BARDIA_STRICT_OWNERSHIP=1) every listed op, command and condition function is registered', () => {
    const env = createSimEnv({ modules: MODULES });
    const missing = [
      ...Object.keys(EFFECT_OWNERS).filter((op) => !env.effects.has(op)).map((op) => `effect ${op} (${EFFECT_OWNERS[op]})`),
      ...Object.entries(COMMAND_OWNERS)
        .filter(([, owner]) => owner !== 'session' && owner !== 'client')
        .filter(([type]) => !env.handlers.has(type))
        .map(([type, owner]) => `command ${type} (${owner})`),
      ...Object.keys(CONDITION_FN_OWNERS).filter((n) => !env.conditionFns.has(n)).map((n) => `condition ${n} (${CONDITION_FN_OWNERS[n]})`),
    ];
    expect(missing).toEqual([]);
  });
});
