// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionBus } from '../input/actions';
import { resetClientState } from '../testing/clientTestKit';
import { useSettings } from '../settings/store';
import { Button, FormulaBreakdown, Frame, IconButton, KeyHint, Meter, Modal, Panel, ScrollArea, SegmentBar, Segmented, Slider, Table, Tabs, Toggle, Tooltip, meterFraction, snapValue, toneFor } from './index';

beforeEach(() => {
  resetClientState();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Button and IconButton', () => {
  it('renders the label, the current key binding and busy/pressed states', () => {
    const onClick = vi.fn();
    render(
      <Button icon="save" keyHint="game.quicksave" onClick={onClick} pressed>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /Save/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(within(btn).getByText('F5')).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    cleanup();
    render(<Button busy>Wait</Button>);
    const busy = screen.getByRole('button', { name: 'Wait' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
  });

  it('IconButton is named by its label and shows a capped badge', () => {
    render(<IconButton icon="inbox" label="Inbox" badge={120} />);
    const btn = screen.getByRole('button', { name: 'Inbox' });
    expect(btn.textContent).toContain('99+');
  });

  it('key hints follow rebinding', () => {
    render(<KeyHint action="open.character" />);
    expect(screen.getByText('C')).toBeTruthy();
    act(() => {
      const bindings = useSettings.getState().settings.controls.bindings;
      useSettings.getState().update({ controls: { bindings: { ...bindings, 'open.character': ['Shift+KeyK'] } } });
    });
    expect(screen.getByText('Shift')).toBeTruthy();
    expect(screen.getByText('K')).toBeTruthy();
  });
});

describe('Frame and Panel', () => {
  it('render titles, actions, footer and a labelled panel', () => {
    render(
      <Frame title="Great Hall" subtitle="Brimstad" actions={<button type="button">x</button>} footer={<span>foot</span>} ornate titleId="fr">
        <Panel title="Garrison" aria-label="garrison">
          body
        </Panel>
      </Frame>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Great Hall' }).id).toBe('fr');
    expect(screen.getByRole('heading', { level: 3, name: 'Garrison' })).toBeTruthy();
    expect(screen.getByText('Brimstad')).toBeTruthy();
    expect(screen.getByText('foot')).toBeTruthy();
  });
});

describe('Slider', () => {
  function Harness({ initial = 100, onValue }: { initial?: number; onValue?: (v: number) => void }) {
    const [v, setV] = useState(initial);
    return (
      <Slider
        label="Text size"
        value={v}
        min={90}
        max={150}
        step={5}
        unit="%"
        onChange={(n) => {
          setV(n);
          onValue?.(n);
        }}
      />
    );
  }

  it('snaps and clamps values', () => {
    expect(snapValue(101, 90, 150, 5)).toBe(100);
    expect(snapValue(103, 90, 150, 5)).toBe(105);
    expect(snapValue(400, 90, 150, 5)).toBe(150);
    expect(snapValue(Number.NaN, 90, 150, 5)).toBe(90);
    expect(snapValue(0.26, 0, 1, 0.1)).toBe(0.3);
  });

  it('Min/Max buttons jump to the ends and disable at the limit', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: /Set to the maximum/ }));
    expect(onValue).toHaveBeenLastCalledWith(150);
    expect((screen.getByRole('button', { name: /Set to the maximum/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Set to the minimum/ }));
    expect(onValue).toHaveBeenLastCalledWith(90);
  });

  it('the typed field commits on Enter (snapped and clamped) and reverts on Escape', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const typed = screen.getByRole('textbox', { name: /Type a value/ }) as HTMLInputElement;
    fireEvent.focus(typed);
    fireEvent.change(typed, { target: { value: '123' } });
    fireEvent.keyDown(typed, { key: 'Enter' });
    expect(onValue).toHaveBeenLastCalledWith(125);
    expect(typed.value).toBe('125');
    fireEvent.focus(typed);
    fireEvent.change(typed, { target: { value: '999' } });
    fireEvent.keyDown(typed, { key: 'Escape' });
    expect(typed.value).toBe('125');
    fireEvent.change(typed, { target: { value: 'abc' } });
    fireEvent.blur(typed);
    expect(typed.value).toBe('125');
    const range = screen.getByRole('slider', { name: 'Text size' }) as HTMLInputElement;
    expect(range.getAttribute('aria-valuetext')).toBe('125%');
  });
});

describe('Tabs', () => {
  it('implements the ARIA tabs pattern with arrow keys, Home and End', () => {
    render(
      <Tabs label="Options" tabs={[{ id: 'a', label: 'Video' }, { id: 'b', label: 'Audio' }, { id: 'c', label: 'Locked', disabled: true }, { id: 'd', label: 'Controls' }]}>
        {(active) => <p>panel {active}</p>}
      </Tabs>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('panel a');
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('panel b');
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('panel d'); // disabled tab skipped
    fireEvent.keyDown(tabs[3] as HTMLElement, { key: 'Home' });
    expect(screen.getByRole('tabpanel').textContent).toBe('panel a');
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(screen.getByRole('tabpanel').textContent).toBe('panel d');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Controls' }).id);
  });
});

describe('Modal', () => {
  it('is a labelled dialog that takes focus, traps Tab and closes on Escape and the back action', () => {
    const onClose = vi.fn();
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const { rerender } = render(
      <Modal open title="Quit the saga?" onClose={onClose} footer={<button type="button">Stay</button>}>
        <button type="button" data-autofocus>
          First
        </button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Quit the saga?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.textContent).toBe('First');
    // Tab from the last control wraps to the dialog's first control (its Close button); Shift+Tab back.
    const stay = within(dialog).getByRole('button', { name: 'Stay' });
    stay.focus();
    fireEvent.keyDown(stay, { key: 'Tab', code: 'Tab' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(stay);
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      actionBus.trigger('ui.back');
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <Modal open={false} title="Quit the saga?" onClose={onClose}>
        x
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('critical modals are alert dialogs; non-dismissible ones ignore Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Your hall burns" tone="critical" onClose={onClose} dismissible={false}>
        <button type="button">Go</button>
      </Modal>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Your hall burns' });
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(actionBus.trigger('ui.back')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('Tooltip and FormulaBreakdown', () => {
  it('shows after the hover delay, describes its anchor and hides on Escape', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content={<FormulaBreakdown title="Recruit pool" total="142" rows={[{ label: 'Population', value: '1,580' }, { label: 'Share', value: '12%', op: '×' }, { label: 'Loyalty', value: '0.75', op: '×' }]} note="Monthly" />}>
        <button type="button">142</button>
      </Tooltip>,
    );
    const anchor = screen.getByRole('button', { name: '142' });
    fireEvent.mouseEnter(anchor.parentElement as HTMLElement);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Recruit pool');
    expect(tip.textContent).toContain('1,580');
    expect(within(tip).getAllByRole('row')).toHaveLength(3);
    expect(tip.textContent).toContain('×');
    expect(anchor.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not open when disabled or empty', () => {
    vi.useFakeTimers();
    render(
      <>
        <Tooltip content="x" disabled>
          <span>a</span>
        </Tooltip>
        <Tooltip content="">
          <span>b</span>
        </Tooltip>
      </>,
    );
    fireEvent.mouseEnter(screen.getByText('a').parentElement as HTMLElement);
    fireEvent.mouseEnter(screen.getByText('b').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Table', () => {
  const rows = [
    { id: 'a', name: 'Brimstad', pop: 1580 },
    { id: 'b', name: 'Askvik', pop: 420 },
    { id: 'c', name: 'Kolvik', pop: 900 },
  ];
  const columns = [
    { id: 'name', header: 'Name', cell: (r: (typeof rows)[number]) => r.name, sortValue: (r: (typeof rows)[number]) => r.name },
    { id: 'pop', header: 'People', cell: (r: (typeof rows)[number]) => String(r.pop), sortValue: (r: (typeof rows)[number]) => r.pop, align: 'end' as const },
  ];

  it('sorts by a column (aria-sort) and activates rows by click or Enter', () => {
    const onRow = vi.fn();
    render(<Table rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={onRow} caption="Holdings" />);
    const names = () => screen.getAllByRole('row').slice(1).map((r) => r.firstChild?.textContent);
    expect(names()).toEqual(['Brimstad', 'Askvik', 'Kolvik']);
    fireEvent.click(screen.getByRole('button', { name: /People/ }));
    expect(names()).toEqual(['Askvik', 'Kolvik', 'Brimstad']);
    expect(screen.getAllByRole('columnheader')[1]?.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(screen.getByRole('button', { name: /People/ }));
    expect(names()).toEqual(['Brimstad', 'Kolvik', 'Askvik']);
    expect(screen.getAllByRole('columnheader')[1]?.getAttribute('aria-sort')).toBe('descending');
    fireEvent.keyDown(screen.getAllByRole('row')[1] as HTMLElement, { key: 'Enter' });
    expect(onRow).toHaveBeenCalledWith(rows[0]);
  });

  it('shows the empty state', () => {
    render(<Table rows={[]} columns={columns} rowKey={(r) => r.id} empty="No holdings" />);
    expect(screen.getByText('No holdings')).toBeTruthy();
  });
});

describe('Meter, SegmentBar, Toggle, Segmented, ScrollArea', () => {
  it('meters expose their value and switch tone by threshold', () => {
    expect(meterFraction(50, 0, 200)).toBe(0.25);
    expect(meterFraction(500, 0, 200)).toBe(1);
    expect(toneFor(0.2, 'good', [[0.25, 'bad'], [0.5, 'warn']])).toBe('bad');
    expect(toneFor(0.4, 'good', [[0.5, 'warn'], [0.25, 'bad']])).toBe('warn');
    expect(toneFor(0.9, 'good', [[0.25, 'bad']])).toBe('good');
    render(<Meter label="Morale" value={20} max={100} thresholds={[[0.25, 'bad']]} tone="good" />);
    const meter = screen.getByRole('meter', { name: 'Morale' });
    expect(meter.getAttribute('aria-valuenow')).toBe('20');
    expect(meter.className).toContain('tone-bg-bad');
    render(<SegmentBar label="Hull" value={3} segments={4} />);
    expect(screen.getByRole('img', { name: 'Hull: 3/4' })).toBeTruthy();
  });

  it('Toggle is a switch; Segmented is a radio group', () => {
    function H() {
      const [on, setOn] = useState(false);
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <>
          <Toggle checked={on} onChange={setOn} label="High contrast" />
          <Segmented<'a' | 'b'> label="Theme" value={v} onChange={setV} options={[{ value: 'a', label: 'Oak' }, { value: 'b', label: 'Vellum' }]} />
        </>
      );
    }
    render(<H />);
    const sw = screen.getByRole('switch', { name: 'High contrast' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    const vellum = screen.getByRole('radio', { name: 'Vellum' }) as HTMLInputElement;
    fireEvent.click(vellum);
    expect(vellum.checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy();
  });

  it('ScrollArea is a focusable, labelled region', () => {
    render(
      <ScrollArea label="Chronicle">
        <p>entry</p>
      </ScrollArea>,
    );
    const region = screen.getByRole('region', { name: 'Chronicle' });
    expect(region.tabIndex).toBe(0);
  });
});
