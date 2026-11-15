// @vitest-environment jsdom
/**
 * The picture at the top of an event card (DecisionHost: describePending's `illustration`, EventPicture):
 * the procedural placeholder while there is no final file, the final painting once there is one, and a
 * season's own painting in the running game's season. Notifications carry their picture to the critical alert
 * box and the inbox (thumbnail, whole picture when opened), never to toasts.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetEntry } from '@content/schemas/assets';
import type { PendingDecision } from '@sim/core/state';
import { season as seasonOfHour } from '@sim/core/time';
import type { SimEvent } from '@sim/core/events';
import { useGame } from '../app/gameStore';
import { useNotifications } from '../app/notifications';
import { setAssetSettings } from '../assets/index';
import { resetFinalIndex, setFinalIndex } from '../assets/resolver/finalIndex';
import { setManifestForTests } from '../assets/resolver/manifest';
import { clearAssetCache } from '../assets/resolver/resolve';
import { resetClientState, testShellSession } from '../testing/clientTestKit';
import { screen as inboxScreen } from '../screens/inbox/index';
import { CriticalHost } from './CriticalHost';
import { describePending, GenericDecision } from './DecisionHost';

const ENTRIES: Record<string, AssetEntry> = {
  'narrative.vignette.testStorm': { kind: 'image', path: 'narrative/vignettes/test-storm.jpg', size: [640, 360], placeholder: { generator: 'vignette', params: { scene: 'storm', seed: 1 } } },
  'music.test.theme': { kind: 'music', path: 'music/theme.ogg', durationS: 10, placeholder: { generator: 'audio.music' } },
};

function index(files: string[]): void {
  setFinalIndex({ format: 1, files: Object.fromEntries(files.map((f, i) => [f, { bytes: 5, hash: `h${i}` }])) });
}

function decision(kind: PendingDecision['kind'], payload: Record<string, unknown>): PendingDecision {
  return { id: 'pnd_test' as never, kind, hour: 0, source: 'test', payload } as unknown as PendingDecision;
}

const message = (illustration?: string) => decision('message', { key: 'ui.comingSoon.sceneBody', vars: {}, ...(illustration !== undefined ? { illustration } : {}) });

beforeEach(() => {
  resetClientState();
  setManifestForTests(ENTRIES);
  setFinalIndex({ format: 1, files: {} });
  setAssetSettings({ devProbe: false, forcePlaceholders: false, watermark: 'off' });
  clearAssetCache();
});

afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
  setManifestForTests(undefined);
  resetFinalIndex();
  setAssetSettings({ forcePlaceholders: false });
  clearAssetCache();
});

describe('describePending: illustration', () => {
  it('reads the payload illustration of any kind, and is null without one', () => {
    expect(describePending(message('narrative.vignette.testStorm')).illustration).toBe('narrative.vignette.testStorm');
    expect(describePending(decision('captivity', { illustration: 'people.illus.captivity' })).illustration).toBe('people.illus.captivity');
    expect(describePending(message()).illustration).toBeNull();
    expect(describePending(message('')).illustration).toBeNull();
    expect(describePending(decision('message', { key: 'x', vars: {}, illustration: 7 })).illustration).toBeNull();
  });
});

describe('the event card picture', () => {
  it('draws the procedural placeholder at the top of the card while there is no final file', () => {
    render(<GenericDecision pending={message('narrative.vignette.testStorm')} />);
    const card = screen.getByTestId('generic-decision');
    expect(card.classList.contains('has-picture')).toBe(true);
    const pic = within(card).getByTestId('decision-picture');
    expect(pic.dataset.assetId).toBe('narrative.vignette.testStorm');
    expect(pic.dataset.final).toBe('no');
    const img = pic.querySelector('img');
    expect(img?.getAttribute('data-asset-status')).toBe('placeholder');
    // The picture comes before the text, and the acknowledge button stays.
    const body = card.querySelector('.frame-body');
    expect(body?.firstElementChild).toBe(pic);
    expect(within(card).getByTestId('decision-acknowledge')).toBeTruthy();
  });

  it('shows the final painting once its file is there', () => {
    index(['narrative/vignettes/test-storm.jpg']);
    render(<GenericDecision pending={message('narrative.vignette.testStorm')} />);
    const pic = screen.getByTestId('decision-picture');
    expect(pic.dataset.final).toBe('yes');
    expect(pic.dataset.variant).toBe('base');
    expect(pic.querySelector('img')?.getAttribute('src')).toContain('narrative/vignettes/test-storm.jpg');
  });

  it("shows the season's own painting in the running game's season", () => {
    const session = testShellSession();
    act(() => useGame.getState().attach(session));
    const season = seasonOfHour(session.getState().time.hour);
    index(['narrative/vignettes/test-storm.jpg', `narrative/vignettes/test-storm-${season}.jpg`]);
    render(<GenericDecision pending={message('narrative.vignette.testStorm')} />);
    const pic = screen.getByTestId('decision-picture');
    expect(pic.dataset.variant).toBe(season);
    expect(pic.querySelector('img')?.getAttribute('src')).toContain(`test-storm-${season}.jpg`);
  });

  it('leaves the picture out without an illustration, or for an id that is not an image', () => {
    const { unmount } = render(<GenericDecision pending={message()} />);
    expect(screen.queryByTestId('decision-picture')).toBeNull();
    expect(screen.getByTestId('generic-decision').classList.contains('has-picture')).toBe(false);
    unmount();
    render(<GenericDecision pending={message('music.test.theme')} />);
    expect(screen.queryByTestId('decision-picture')).toBeNull();
    render(<GenericDecision pending={message('nothing.here')} />);
    expect(screen.queryByTestId('decision-picture')).toBeNull();
  });
});

const note = (priority: 'critical' | 'high' | 'normal', key: string, illustration?: string): SimEvent =>
  ({ type: 'Notification', priority, key, vars: {}, ...(illustration !== undefined ? { illustration } : {}) }) as SimEvent;

describe('notification pictures', () => {
  it('the inbox entry keeps the illustration; a critical alert draws it, a toast does not', () => {
    act(() => {
      useNotifications.getState().ingest([note('critical', 'ui.comingSoon.sceneBody', 'narrative.vignette.testStorm'), note('high', 'ui.comingSoon.sceneBody', 'narrative.vignette.testStorm')], 0);
    });
    const { inbox, toasts } = useNotifications.getState();
    expect(inbox.map((n) => n.illustration)).toEqual(['narrative.vignette.testStorm', 'narrative.vignette.testStorm']);
    expect(toasts).toHaveLength(1);
    expect(Object.hasOwn(toasts[0] ?? {}, 'illustration')).toBe(false);
    render(<CriticalHost />);
    const modal = screen.getByTestId('critical-modal');
    expect(modal.classList.contains('has-picture')).toBe(true);
    expect(within(modal).getByTestId('decision-picture').dataset.assetId).toBe('narrative.vignette.testStorm');
  });

  it('a critical alert without a picture keeps its small box and icon', () => {
    act(() => {
      useNotifications.getState().ingest([note('critical', 'ui.comingSoon.sceneBody')], 0);
    });
    render(<CriticalHost />);
    const modal = screen.getByTestId('critical-modal');
    expect(modal.classList.contains('modal-sm')).toBe(true);
    expect(within(modal).queryByTestId('decision-picture')).toBeNull();
  });

  it('the inbox shows a thumbnail, and the whole picture once the entry is opened', () => {
    act(() => {
      useNotifications.getState().ingest([note('normal', 'ui.comingSoon.sceneBody', 'narrative.vignette.testStorm'), note('normal', 'ui.comingSoon.sceneBody')], 0);
    });
    const [withPicture] = useNotifications.getState().inbox.filter((n) => n.illustration);
    const Inbox = inboxScreen.component;
    render(<Inbox close={() => {}} />);
    expect(screen.getAllByTestId('inbox-thumb-picture')).toHaveLength(1);
    expect(screen.queryByTestId('inbox-picture')).toBeNull();
    const thumb = screen.getByTestId(`inbox-thumb-${withPicture?.id}`);
    fireEvent.click(thumb);
    expect(thumb.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('inbox-picture').dataset.assetId).toBe('narrative.vignette.testStorm');
    expect(useNotifications.getState().inbox.find((n) => n.id === withPicture?.id)?.read).toBe(true);
    fireEvent.click(thumb);
    expect(screen.queryByTestId('inbox-picture')).toBeNull();
  });

  it('an entry focused from a toast opens with its picture', () => {
    act(() => {
      useNotifications.getState().ingest([note('high', 'ui.comingSoon.sceneBody', 'narrative.vignette.testStorm')], 0);
    });
    // jsdom has no scrolling.
    Element.prototype.scrollIntoView ??= () => {};
    const id = useNotifications.getState().inbox[0]?.id ?? -1;
    const Inbox = inboxScreen.component;
    render(<Inbox close={() => {}} params={{ focus: id }} />);
    expect(screen.getByTestId('inbox-picture')).toBeTruthy();
  });
});
