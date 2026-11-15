// @vitest-environment jsdom
/**
 * The menu building blocks of ARCHITECTURE §20: TransferSlider (two piles, live amounts, limits with their
 * reasons, keyboard and pointer), Disclosure, ChoiceCard, StatLine and ShipPicture.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClientState } from '../testing/clientTestKit';
import { ChoiceCard, ChoiceGrid, Disclosure, Frame, ShipPicture, StatLine, TransferSlider, snapTransfer, transferKey, type TransferSliderProps } from './index';

beforeEach(() => resetClientState());
afterEach(() => cleanup());

function Live(props: Partial<TransferSliderProps> & { start?: number; onValue?(v: number): void }): ReactElement {
  const { start = 20, onValue, ...rest } = props;
  const [v, setV] = useState(start);
  return (
    <TransferSlider
      label="Bondi"
      total={60}
      left={{ label: 'Stay to guard the town', icon: 'men', note: (n) => `${n} at home` }}
      right={{ label: 'Sail with you', icon: 'ship', note: (n) => `${n} aboard` }}
      data-testid="men"
      {...rest}
      value={v}
      onChange={(next) => {
        setV(next);
        onValue?.(next);
      }}
    />
  );
}

const handle = () => screen.getByRole('slider', { name: 'Bondi' });
const amount = (side: 'left' | 'right') => screen.getByTestId(`men-${side}`).textContent;

describe('TransferSlider', () => {
  it('shows both piles with their words and is an ARIA slider over the left amount', () => {
    render(<Live />);
    expect(amount('left')).toBe('40');
    expect(amount('right')).toBe('20');
    expect(screen.getByText('40 at home')).toBeTruthy();
    expect(screen.getByText('20 aboard')).toBeTruthy();
    const h = handle();
    expect(h.getAttribute('aria-valuenow')).toBe('40');
    expect(h.getAttribute('aria-valuemin')).toBe('0');
    expect(h.getAttribute('aria-valuemax')).toBe('60');
    expect(h.getAttribute('aria-valuetext')).toBe('Stay to guard the town: 40. Sail with you: 20.');
    expect(screen.getByRole('group', { name: 'Bondi' })).toBeTruthy();
  });

  it('moves by arrows, Page Up/Down, Home and End, and both sides update', () => {
    const seen = vi.fn();
    render(<Live onValue={seen} step={1} bigStep={10} />);
    const h = handle();
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(amount('right')).toBe('21');
    expect(amount('left')).toBe('39');
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    fireEvent.keyDown(h, { key: 'ArrowUp' });
    expect(amount('right')).toBe('19');
    fireEvent.keyDown(h, { key: 'PageDown' });
    expect(amount('right')).toBe('29');
    fireEvent.keyDown(h, { key: 'PageUp' });
    expect(amount('right')).toBe('19');
    fireEvent.keyDown(h, { key: 'Home' });
    expect(amount('right')).toBe('60');
    expect(amount('left')).toBe('0');
    fireEvent.keyDown(h, { key: 'End' });
    expect(amount('right')).toBe('0');
    expect(seen).toHaveBeenLastCalledWith(0);
  });

  it('stops at a limit and says why; the natural ends say nothing', () => {
    render(<Live max={30} maxReason="The ships have benches for 30." min={5} minReason="The ship needs a crew." />);
    const h = handle();
    expect(screen.queryByTestId('men-limit')).toBeNull();
    fireEvent.keyDown(h, { key: 'Home' });
    expect(amount('right')).toBe('30');
    expect(screen.getByTestId('men-limit').textContent).toMatch(/benches for 30/);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(amount('right')).toBe('30');
    fireEvent.keyDown(h, { key: 'End' });
    expect(amount('right')).toBe('5');
    expect(screen.getByTestId('men-limit').textContent).toMatch(/needs a crew/);
    expect(h.getAttribute('aria-valuemin')).toBe('30');
    expect(h.getAttribute('aria-valuemax')).toBe('55');
  });

  it('shows a value beyond its limit as over, with the reason, until the player moves it', () => {
    render(<Live start={50} max={30} maxReason="Too many." />);
    expect(amount('right')).toBe('50');
    expect(screen.getByTestId('men').className).toMatch(/is-over/);
    expect(screen.getByTestId('men-limit').textContent).toMatch(/Too many/);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(amount('right')).toBe('30');
    expect(screen.getByTestId('men').className).not.toMatch(/is-over/);
  });

  it('follows the pointer along the track and snaps to the step', () => {
    render(<Live step={5} />);
    const track = screen.getByTestId('men-track');
    track.getBoundingClientRect = () => ({ left: 100, top: 0, width: 600, height: 40, right: 700, bottom: 40, x: 100, y: 0, toJSON: () => ({}) });
    // A quarter of the way along: the left keeps 15, the right takes 45.
    fireEvent.pointerDown(track, { clientX: 250, pointerId: 1, button: 0, pointerType: 'mouse' });
    expect(amount('left')).toBe('15');
    expect(amount('right')).toBe('45');
    fireEvent.pointerMove(track, { clientX: 640, pointerId: 1, pointerType: 'mouse' });
    expect(amount('right')).toBe('5');
    fireEvent.pointerUp(track, { clientX: 640, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(track, { clientX: 100, pointerId: 1, pointerType: 'mouse' });
    expect(amount('right')).toBe('5');
    expect(document.activeElement).toBe(handle());
  });

  it('quick marks and the suggested amount move the handle, clamped to the limits', () => {
    render(<Live quick={['none', 'half', 'all']} suggested={24} max={40} maxReason="Full." />);
    fireEvent.click(screen.getByTestId('men-mark-all'));
    expect(amount('right')).toBe('40');
    fireEvent.click(screen.getByTestId('men-mark-half'));
    expect(amount('right')).toBe('30');
    fireEvent.click(screen.getByTestId('men-mark-suggested'));
    expect(amount('right')).toBe('24');
    expect(screen.getByTestId('men-mark-suggested').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('men-mark-none'));
    expect(amount('right')).toBe('0');
  });

  it('is inert when disabled or empty', () => {
    const onChange = vi.fn();
    render(<TransferSlider label="Silver" total={0} value={0} onChange={onChange} left={{ label: 'Treasury' }} right={{ label: 'Taken' }} />);
    const h = screen.getByRole('slider', { name: 'Silver' });
    expect(h.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(h, { key: 'Home' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pure helpers snap to the grid but always reach the limits', () => {
    expect(snapTransfer(23, 0, 2713, 10)).toBe(20);
    expect(snapTransfer(2709, 0, 2713, 10)).toBe(2710);
    expect(snapTransfer(9999, 0, 2713, 10)).toBe(2713);
    expect(snapTransfer(-4, 5, 50, 10)).toBe(5);
    expect(transferKey('ArrowLeft', 2710, 0, 2713, 10, 100)).toBe(2713);
    expect(transferKey('ArrowRight', 2713, 0, 2713, 10, 100)).toBe(2710);
    expect(transferKey('ArrowRight', 37, 0, 100, 10, 50)).toBe(30);
    expect(transferKey('ArrowLeft', 37, 0, 100, 10, 50)).toBe(40);
    expect(transferKey('Tab', 37, 0, 100, 10, 50)).toBeNull();
  });
});

describe('Disclosure', () => {
  it('toggles a mounted, hidden region with aria-expanded', () => {
    render(
      <Disclosure data-testid="d">
        <span data-testid="inside">Upkeep</span>
      </Disclosure>,
    );
    const toggle = screen.getByTestId('d-toggle');
    expect(toggle.textContent).toBe('Details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const inside = screen.getByTestId('inside');
    expect(inside.closest('[hidden]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(inside.closest('[hidden]')).toBeNull();
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toBe(inside.parentElement);
  });

  it('can be controlled and lazy', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure open={false} onOpenChange={onOpenChange} lazy summary="More">
        <span data-testid="inside">x</span>
      </Disclosure>,
    );
    expect(screen.queryByTestId('inside')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    rerender(
      <Disclosure open lazy summary="More">
        <span data-testid="inside">x</span>
      </Disclosure>,
    );
    expect(screen.getByTestId('inside')).toBeTruthy();
  });
});

describe('ChoiceCard, StatLine, ShipPicture and the large Frame', () => {
  it('a choice card is a button with one line; toggles are pressed; disabled cards say why', () => {
    const onClick = vi.fn();
    render(
      <ChoiceGrid columns={2} label="Doors">
        <ChoiceCard icon="ship" title="Expedition planner" line="Choose who sails." onClick={onClick} data-testid="a" />
        <ChoiceCard title="Vigfrid" selected badge="Leads" data-testid="b" />
        <ChoiceCard title="Ledger" line="Hidden while locked" reason="Not yet built." disabled data-testid="c" />
      </ChoiceGrid>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Expedition planner/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByTestId('b').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('b').textContent).toContain('Leads');
    expect(screen.getByTestId('c').textContent).toContain('Not yet built.');
    expect(screen.getByTestId('c').textContent).not.toContain('Hidden while locked');
    expect(screen.getByRole('group', { name: 'Doors' })).toBeTruthy();
  });

  it('StatLine, ShipPicture and Frame size="screen" render', () => {
    render(
      <Frame size="screen" title="Hall" data-testid="f">
        <StatLine icon="men" label="Men at home" value="60" tone="warn" data-testid="s" />
        <ShipPicture type="drakkar" title="A drakkar" />
        <ShipPicture type="unknown-type" />
      </Frame>,
    );
    expect(screen.getByTestId('f').className).toMatch(/frame-screen/);
    expect(screen.getByTestId('s').textContent).toBe('Men at home60');
    expect(screen.getByTestId('s').className).toMatch(/tone-warn/);
    expect(screen.getByRole('img', { name: 'A drakkar' })).toBeTruthy();
  });
});

describe('act guard', () => {
  it('state updates inside the slider are wrapped', () => {
    render(<Live />);
    act(() => handle().focus());
    expect(document.activeElement).toBe(handle());
  });
});
