// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import type { Command } from '@sim/core/commands';
import type { GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { headlessCommand } from '@sim/headless';
import { GameSession } from '@sim/index';
import { tierInfo } from '@sim/modules/holdings/rules';
import { Affairs, type AffairsPanel } from './index';

afterEach(cleanup);

const content = getContent();

function session(): GameSession {
  const s = GameSession.newGame({ seed: 'affairs-ui', difficulty: 'raider', player: { culture: 'skarn', name: 'Sigrun' } });
  return s;
}

/** Advances the session, answering any decision with its headless default. */
function pass(s: GameSession, hours: number): void {
  const end = s.getState().time.hour + hours;
  for (let guard = 0; guard < 50 && s.getState().time.hour < end; guard++) {
    const st = s.getState();
    if (st.pending) {
      const answer = headlessCommand(st);
      if ('error' in answer) throw new Error(answer.error);
      s.dispatch(answer.command);
      continue;
    }
    s.advance(end - st.time.hour);
  }
}

function view(s: GameSession, commands: Command[] = [], panel?: AffairsPanel): { rerender(): void } {
  const dispatch = (cmd: Command) => {
    commands.push(cmd);
    return s.dispatch(cmd);
  };
  const el = () => <Affairs state={s.getState()} content={content} dispatch={dispatch} onClose={() => undefined} {...(panel ? { panel } : {})} />;
  const r = render(el());
  return { rerender: () => r.rerender(el()) };
}

describe('Affairs of State screen', () => {
  it('opens on the taxes of the capital; a tax card sets the tax and the forecast says what it does', () => {
    const s = session();
    const commands: Command[] = [];
    const v = view(s, commands);
    expect(screen.getByTestId('affairs')).toBeTruthy();
    // One decision in view: the taxes; the doors name the other two.
    expect(screen.getByTestId('affairs-panel-folk').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('affairs-buildings')).toBeNull();
    expect(screen.queryByTestId('affairs-garrison')).toBeNull();
    expect(screen.getByTestId('affairs-loyalty-forecast').textContent).toMatch(/Next month it/);
    expect(screen.getByTestId('affairs-tax-fair').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('affairs-tax-light').textContent).toMatch(/silver a month\. Loyalty rises/);
    fireEvent.click(screen.getByTestId('affairs-tax-light'));
    expect(commands).toEqual([{ type: 'setTax', holdingId: s.getState().player.capitalId, tax: 'light' }]);
    v.rerender();
    expect(screen.getByTestId('affairs-tax-light').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('affairs-loyalty-forecast').textContent).toMatch(/rises to/);
    // The reasons sit behind Details (mounted, hidden until opened).
    expect(screen.getByTestId('affairs-reasons').textContent).toMatch(/Light taxes/);
    expect(screen.getByTestId('affairs-folk-details-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('switches holdings one at a time', () => {
    const s = session();
    view(s);
    const chips = screen.queryAllByTestId(/^affairs-holding-/);
    if (chips.length > 1) {
      const other = chips[1] as HTMLElement;
      const id = (other.getAttribute('data-testid') ?? '').replace('affairs-holding-', '');
      fireEvent.click(other);
      expect(other.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('affairs').querySelector('[data-holding]')?.getAttribute('data-holding')).toBe(id);
    }
  });

  it('picks a building from its card, queues it, shows it under way, and says why another must wait', () => {
    const s = session();
    const v = view(s, [], 'buildings');
    const state: GameState = s.getState();
    const walls = state.settlements[state.player.capitalId]?.buildings['walls'] ?? 0;
    fireEvent.click(screen.getByTestId('affairs-building-walls'));
    expect(screen.getByTestId('affairs-building-walls').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('affairs-cost-walls').textContent).toContain(String(tierInfo(content, 'walls', walls + 1)?.days));
    fireEvent.click(screen.getByTestId('affairs-build-walls'));
    v.rerender();
    expect(screen.getByTestId('affairs-queue-walls')).toBeTruthy();
    expect(screen.getByTestId('affairs-underway-walls')).toBeTruthy();
    expect(screen.getByTestId('affairs-panel-buildings').textContent).toMatch(/Walls under way/);
    fireEvent.click(screen.getByTestId('affairs-building-market'));
    const market = screen.queryByTestId('affairs-build-market');
    if (market) {
      expect((market as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('affairs-why-market').textContent).toMatch(/builder/i);
    }
    pass(s, ((tierInfo(content, 'walls', walls + 1)?.days ?? 0) + 1) * HOURS_PER_DAY);
    v.rerender();
    expect(s.getState().settlements[state.player.capitalId]?.buildings['walls']).toBe(walls + 1);
    expect(screen.getByTestId('affairs-building-walls').getAttribute('data-tier')).toBe(String(walls + 1));
  });

  it('sends men home with the two-sided slider', () => {
    const s = session();
    const commands: Command[] = [];
    const v = view(s, commands, 'garrison');
    const cap = s.getState().settlements[s.getState().player.capitalId]!;
    const [unit, count] = Object.entries(cap.garrison).find(([, n]) => n > 1) as [string, number];
    const card = screen.queryByTestId(`affairs-unit-${unit}`);
    if (card) fireEvent.click(card);
    const button = screen.getByTestId(`affairs-send-${unit}`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('affairs-send-why').textContent).toMatch(/how many/i);
    const handle = within(screen.getByTestId('affairs-garrison-slider')).getByRole('slider');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(screen.getByTestId('affairs-garrison-slider-right').textContent).toBe('1');
    expect(screen.getByTestId('affairs-garrison-slider-left').textContent).toBe(String(count - 1));
    fireEvent.click(screen.getByTestId(`affairs-send-${unit}`));
    expect(commands.at(-1)).toEqual({ type: 'setGarrison', holdingId: cap.id, units: { [unit]: count - 1 } });
    v.rerender();
    expect(s.getState().settlements[cap.id]?.garrison[unit]).toBe(count - 1);
  });
});
