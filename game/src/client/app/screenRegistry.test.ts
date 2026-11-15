import { describe, expect, it } from 'vitest';
import { buildRegistry, collectScreens, normalizeDescriptor } from './screenRegistry';

const A = () => null;
const B = () => null;

describe('screen registry (ARCHITECTURE §14)', () => {
  it('normalises mode / pending / route in every accepted spelling', () => {
    const d = normalizeDescriptor({ id: 'x', modes: ['map'], pendingKind: 'arrival', routes: ['a', 'b'], serves: [{ route: 'c' }, { pending: 'envoy' }], component: A, layout: 'modal', priority: 3 }, 'p');
    expect(d).toMatchObject({ id: 'x', modes: ['map'], pending: ['arrival', 'envoy'], routes: ['a', 'b', 'c'], layout: 'modal', priority: 3 });
    expect(normalizeDescriptor({ id: 'y', mode: 'hub', Component: A }, 'p')?.modes).toEqual(['hub']);
    expect(normalizeDescriptor({ id: 'z', mode: 'hub', component: A, layout: 'bogus' }, 'p')?.layout).toBeUndefined();
  });

  it('skips exports that are not descriptors', () => {
    expect(normalizeDescriptor({ id: 'x' }, 'p')).toBeUndefined();
    expect(normalizeDescriptor({ component: A }, 'p')).toBeUndefined();
    expect(normalizeDescriptor('hello', 'p')).toBeUndefined();
    expect(normalizeDescriptor(null, 'p')).toBeUndefined();
  });

  it('collects screens from module namespaces, flags duplicates and empty modules', () => {
    const { screens, problems } = collectScreens({
      './screens/one/index.tsx': { screen: { id: 'one', route: 'r1', component: A }, helper: 42 },
      './screens/two/index.tsx': { screens: [{ id: 'two', mode: 'map', component: B }, { id: 'one', route: 'r2', component: B }] },
      './screens/three/index.tsx': { nothing: true },
      './screens/four/index.tsx': { screen: { id: 'four', component: A } },
    });
    expect(screens.map((s) => s.id).sort()).toEqual(['four', 'one', 'two']);
    expect(problems.some((p) => p.includes("'one'") && p.includes('both'))).toBe(true);
    expect(problems.some((p) => p.includes('three') && p.includes('no screen descriptor'))).toBe(true);
    expect(problems.some((p) => p.includes("'four'") && p.includes('serves no'))).toBe(true);
  });

  it('picks the highest priority, so placeholders are replaced without deleting them', () => {
    const reg = buildRegistry({
      './screens/ph/index.tsx': { screen: { id: 'placeholderHub', mode: 'hub', component: A, priority: -100 } },
      './screens/hub/index.tsx': { screen: { id: 'homeHall', mode: 'hub', component: B } },
      './screens/o/index.tsx': { screen: { id: 'opts', route: 'options', pending: 'message', component: A } },
    });
    expect(reg.forMode('hub')?.id).toBe('homeHall');
    expect(reg.forRoute('options')?.id).toBe('opts');
    expect(reg.forPending('message')?.id).toBe('opts');
    expect(reg.forMode('battle')).toBeUndefined();
    expect(reg.byId('placeholderHub')?.priority).toBe(-100);
  });

  it('registers the shell’s own screens from the real folder', async () => {
    const modules = import.meta.glob('../screens/{mainMenu,newSaga,options,saveLoad,credits,hubPlaceholder,inbox,gameMenu}/index.tsx', { eager: true });
    const reg = buildRegistry(modules);
    expect(reg.problems).toEqual([]);
    for (const route of ['mainMenu', 'newSaga', 'options', 'saveLoad', 'credits', 'inbox', 'gameMenu']) expect(reg.forRoute(route), route).toBeDefined();
    expect(reg.forMode('hub')?.id).toBe('hubPlaceholder');
    expect(reg.forMode('hub')?.priority).toBeLessThan(0);
  });
});
