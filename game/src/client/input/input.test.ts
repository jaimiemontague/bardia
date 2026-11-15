import { describe, expect, it } from 'vitest';
import { ActionBus } from './actions';
import { ACTIONS, comboFromEvent, comboLabel, defaultBindings, findConflicts, normalizeCombo, type InputContext } from './bindings';
import { GamepadPoller, GAMEPAD_BUTTON_ACTIONS } from './gamepad';
import { ShortcutManager, type KeyEventLike } from './shortcuts';

function key(code: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat'>> = {}, target: EventTarget | null = null): KeyEventLike & { prevented: boolean } {
  const e = { code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, target, prevented: false, ...mods, preventDefault() {
    e.prevented = true;
  } };
  return e;
}

function manager(contexts: InputContext[], bindings = defaultBindings()) {
  const bus = new ActionBus();
  const fired: string[] = [];
  for (const a of ACTIONS) bus.on(a.id, (info) => void fired.push(`${a.id}:${info.phase}`));
  const m = new ShortcutManager({ bus, bindings: () => bindings, contexts: () => new Set(contexts) });
  return { m, bus, fired };
}

describe('bindings (§25.6)', () => {
  it('builds canonical, layout-independent combos', () => {
    expect(comboFromEvent({ code: 'KeyS', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe('Ctrl+Shift+KeyS');
    expect(comboFromEvent({ code: 'ShiftLeft', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('');
    expect(normalizeCombo(' Shift + Ctrl+KeyA')).toBe('Ctrl+Shift+KeyA');
    expect(comboLabel('Ctrl+KeyS')).toBe('Ctrl+S');
    expect(comboLabel('Digit3')).toBe('3');
  });

  it('ships the design defaults without conflicts', () => {
    const b = defaultBindings();
    expect(b['time.togglePause']).toEqual(['Space']);
    expect(b['open.codex']).toEqual(['F1']);
    expect(b['open.chronicle']).toEqual(['KeyJ']);
    expect(b['battle.shieldWall']).toEqual(['KeyQ']);
    expect(findConflicts(b)).toEqual({});
    expect(findConflicts({ ...b, 'open.ledger': ['KeyC'] })).toEqual({ KeyC: ['open.character', 'open.ledger'] });
  });
});

describe('shortcut manager', () => {
  it('routes digits to time speeds globally and to squads in battle', () => {
    const map = manager(['global', 'map']);
    map.m.handleKeyDown(key('Digit2'));
    expect(map.fired).toEqual(['time.speed2:down']);
    const battle = manager(['global', 'battle']);
    battle.m.handleKeyDown(key('Digit2'));
    expect(battle.fired).toEqual(['battle.squad2:down']);
  });

  it('turns off "outside battles" keys in battle and lets battle keys win', () => {
    const b = manager(['global', 'battle']);
    b.m.handleKeyDown(key('KeyC'));
    b.m.handleKeyDown(key('KeyF'));
    expect(b.fired).toEqual(['battle.cycleFormation:down']);
    const g = manager(['global']);
    g.m.handleKeyDown(key('KeyF'));
    expect(g.fired).toEqual(['open.family:down']);
  });

  it('ignores typing in text fields except Escape, and delivers key-up to the same action', () => {
    const { m, fired } = manager(['global']);
    const input = { tagName: 'INPUT', type: 'text' } as unknown as EventTarget;
    expect(m.handleKeyDown(key('KeyC', {}, input))).toBe(false);
    expect(m.handleKeyDown(key('Escape', {}, input))).toBe(true);
    m.handleKeyUp({ code: 'Escape' });
    expect(fired).toEqual(['ui.back:down', 'ui.back:up']);
  });

  it('uses rebound keys and captures the next combo for the rebinding UI', () => {
    const bindings = { ...defaultBindings(), 'open.character': ['Ctrl+KeyK'] };
    const { m, fired } = manager(['global'], bindings);
    m.handleKeyDown(key('KeyC'));
    m.handleKeyDown(key('KeyK', { ctrlKey: true }));
    expect(fired).toEqual(['open.character:down']);
    let captured = '';
    m.capture((c) => (captured = c));
    const e = key('KeyZ', { altKey: true });
    expect(m.handleKeyDown(e)).toBe(true);
    expect(captured).toBe('Alt+KeyZ');
    expect(e.prevented).toBe(true);
    expect(m.capturing).toBe(false);
  });

  it('newest handler wins, and returning false passes the action on', () => {
    const bus = new ActionBus();
    const order: string[] = [];
    bus.on('ui.back', () => void order.push('shell'));
    const off = bus.on('ui.back', () => {
      order.push('modal');
      return false;
    });
    expect(bus.trigger('ui.back')).toBe(true);
    off();
    bus.trigger('ui.back');
    expect(order).toEqual(['modal', 'shell', 'shell']);
    expect(new ActionBus().trigger('nobody')).toBe(false);
  });
});

describe('gamepad groundwork', () => {
  const pad = (pressed: number[], axes: number[] = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });

  it('fires actions on button edges with down/up phases', () => {
    const bus = new ActionBus();
    const seen: string[] = [];
    bus.observe((info) => seen.push(`${info.action}:${info.phase}`));
    const p = new GamepadPoller(bus);
    p.poll([pad([9])], 0);
    p.poll([pad([9])], 16);
    p.poll([pad([])], 32);
    expect(seen).toEqual([`${GAMEPAD_BUTTON_ACTIONS[9]}:down`, `${GAMEPAD_BUTTON_ACTIONS[9]}:up`]);
  });

  it('repeats held D-pad directions after a delay', () => {
    const bus = new ActionBus();
    let downs = 0;
    bus.observe((info) => {
      if (info.action === 'ui.navDown' && info.phase === 'down') downs++;
    });
    const p = new GamepadPoller(bus);
    for (let t = 0; t <= 1000; t += 16) p.poll([pad([13])], t);
    expect(downs).toBeGreaterThan(3);
    expect(downs).toBeLessThan(12);
  });
});
