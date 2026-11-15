import { beforeEach, describe, expect, it } from 'vitest';
import { navigation, useNavigation } from './navigation';

describe('navigation', () => {
  beforeEach(() => {
    useNavigation.getState().reset();
    useNavigation.getState().showMenu('mainMenu');
  });

  it('stacks routes, re-opening the top one replaces its params, and back pops', () => {
    navigation.open('character', { id: 'chr_1' });
    navigation.open('character', { id: 'chr_2' });
    expect(useNavigation.getState().stack).toHaveLength(1);
    expect(useNavigation.getState().stack[0]?.params).toEqual({ id: 'chr_2' });
    navigation.open('ledger');
    expect(useNavigation.getState().stack.map((r) => r.id)).toEqual(['character', 'ledger']);
    expect(navigation.back()).toBe(true);
    expect(navigation.back()).toBe(true);
    expect(navigation.back()).toBe(false);
  });

  it('toggles a route that is on top, and closing removes everything above it', () => {
    navigation.toggle('codex');
    expect(useNavigation.getState().stack.map((r) => r.id)).toEqual(['codex']);
    navigation.toggle('codex');
    expect(useNavigation.getState().stack).toEqual([]);
    navigation.open('options');
    navigation.open('saveLoad');
    navigation.open('credits');
    const key = useNavigation.getState().stack[1]?.key ?? -1;
    useNavigation.getState().close(key);
    expect(useNavigation.getState().stack.map((r) => r.id)).toEqual(['options']);
  });

  it('shows menu pages and focus requests', () => {
    navigation.showMenu('newSaga');
    expect(useNavigation.getState().menuPage.id).toBe('newSaga');
    navigation.requestFocus({ kind: 'settlement', id: 'set_4' });
    const req = useNavigation.getState().focusRequest;
    expect(req).toMatchObject({ kind: 'settlement', id: 'set_4' });
    useNavigation.getState().clearFocus(req?.seq ?? -1);
    expect(useNavigation.getState().focusRequest).toBeNull();
  });
});
