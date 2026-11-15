// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { EN_TABLES } from '@content/locales/index';
import { GameSession, serialize } from '@sim/index';
import type { CharId, GameState } from '@sim/core/state';
import { HOURS_PER_DAY } from '@sim/core/time';
import { heirCandidates } from '@sim/modules/people/death';
import { ASSIGNABLE_ROLES } from '@sim/modules/people/schemas';
import { useGame } from '../../app/gameStore';
import { resetClientState } from '../../testing/clientTestKit';
import { groupByYear } from '../chronicle/index';
import * as character from './index';
import * as family from '../family/index';
import * as longhouse from '../longhouse/index';
import * as seer from '../seer/index';
import * as grove from '../grove/index';
import * as chronicle from '../chronicle/index';

const strings: Record<string, string> = {
  ...(EN_TABLES.ui as Record<string, string>),
  ...(EN_TABLES.people as Record<string, string>),
  ...(EN_TABLES.faith as Record<string, string>),
  ...(EN_TABLES.codex as Record<string, string>),
};

/** A real campaign (full module registry), optionally edited before it is loaded. */
function startGame(edit?: (s: GameState) => void): GameSession {
  const fresh = GameSession.newGame({
    seed: 'household-test',
    difficulty: 'raider',
    player: { name: 'Sigrun', sex: 'female', culture: 'skarn' },
  });
  if (!edit) return fresh;
  const copy = structuredClone(fresh.getState()) as GameState;
  edit(copy);
  return GameSession.load(serialize(copy));
}

function attach(session: GameSession): void {
  act(() => useGame.getState().attach(session));
}

function state(): GameState {
  const s = useGame.getState().state;
  if (!s) throw new Error('no game');
  return s;
}

function lieutenant(s: GameState): CharId {
  const c = Object.values(s.characters).find(
    (x) => x.alive && x.factionId === s.player.factionId && x.role?.kind === 'lieutenant',
  );
  if (!c) throw new Error('no lieutenant');
  return c.id;
}

beforeEach(() => {
  resetClientState();
});
afterEach(() => {
  cleanup();
  act(() => useGame.getState().quit());
});

describe('household screens: registration and strings', () => {
  it('registers the six routes as overlays', () => {
    expect(character.screen.route).toBe('character');
    expect(family.screen.route).toBe('family');
    expect(chronicle.screen.route).toBe('chronicle');
    expect(longhouse.screen.route).toBe('building.longhouse');
    expect(seer.screen.route).toBe('building.seer');
    expect(grove.screen.route).toBe('building.grove');
    for (const s of [character, family, chronicle, longhouse, seer, grove])
      expect(s.screen.layout).toBe('overlay');
  });

  it('every literal key in these screens has a string, without em dashes', () => {
    const missing: string[] = [];
    const root = join(process.cwd(), 'src', 'client', 'screens');
    for (const folder of ['character', 'family', 'longhouse', 'seer', 'grove', 'chronicle']) {
      for (const name of readdirSync(join(root, folder))) {
        if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) continue;
        const text = readFileSync(join(root, folder, name), 'utf8');
        for (const m of text.matchAll(/['"`]((?:ui|people|faith|codex)\.[A-Za-z0-9_.]+)['"`]/g)) {
          const key = m[1] as string;
          if (key === 'ui.back' || key.endsWith('.') || /\.(css|tsx?|json)$/.test(key)) continue;
          if (!Object.hasOwn(strings, key)) missing.push(`${folder}/${name}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
    const mine = Object.entries(strings).filter(([k]) => /^(people\.ui|faith\.ui|codex)\./.test(k));
    expect(mine.filter(([, v]) => v.includes('—'))).toEqual([]);
  });

  it('templated key families are complete', () => {
    const content = getContent();
    const keys: string[] = [
      ...ASSIGNABLE_ROLES.map((r) => `people.ui.roleDesc.${r}`),
      ...ASSIGNABLE_ROLES.map((r) => `people.role.${r}`),
      ...['tutor', 'lieutenant', 'ally'].flatMap((m) => [
        `people.ui.foster.mode.${m}`,
        `people.ui.foster.choice.${m}`,
        `people.ui.foster.desc.${m}`,
      ]),
      ...[...new Set(Object.values(content.traits).map((t) => t.kind))].map(
        (k) => `people.ui.traitKind.${k}`,
      ),
      ...['spouses', 'parents', 'children', 'siblings'].map((g) => `people.ui.sheet.kinGroup.${g}`),
      ...Object.keys(content.gods).map((g) => `faith.ui.godEffect.${g}`),
      ...[...new Set(Object.values(content.gods).flatMap((g) => g.favorRises))].map(
        (r) => `faith.ui.rise.${r}`,
      ),
      ...['stormMult', 'moralePct', 'duel_nervePct', 'harvest_outputPct'].map((e) => `faith.ui.effect.${e}`),
      ...['seer', 'church'].map((m) => `faith.ui.heal.${m}`),
      ...['infant', 'child', 'youth', 'adult'].map((s) => `people.stage.${s}`),
    ];
    expect(keys.filter((k) => !Object.hasOwn(strings, k))).toEqual([]);
  });
});

describe('character sheet', () => {
  it('shows the ruler by default, and another character by id', () => {
    const session = startGame();
    attach(session);
    const Sheet = character.screen.component;
    const { unmount } = render(<Sheet close={() => undefined} />);
    expect(screen.getByTestId('character-name').textContent).toBe('Sigrun');
    // Six skill bars on the face of the sheet (§20); every skill and attribute behind Details.
    expect(within(screen.getByTestId('character-skills')).getAllByTestId(/^skill-/)).toHaveLength(6);
    expect(screen.getByTestId('attr-vigor')).toBeTruthy();
    expect(
      within(screen.getByTestId('character-standings')).getByTestId('standing-honor').textContent,
    ).toContain('10');
    expect(screen.getByTestId('standing-honor').textContent).toContain('Fair');
    fireEvent.click(screen.getByTestId('character-details-toggle'));
    fireEvent.click(screen.getByRole('tab', { name: 'All skills' }));
    expect(screen.getAllByTestId(/^skillrow-/)).toHaveLength(8);
    fireEvent.click(screen.getByRole('tab', { name: 'Level and deeds' }));
    expect(screen.getByTestId('character-level').textContent).toContain('1');
    unmount();
    const lt = lieutenant(state());
    render(<Sheet params={{ id: lt }} close={() => undefined} />);
    expect(screen.getByTestId('character-sheet').getAttribute('data-char')).toBe(lt);
    expect(screen.queryByTestId('standing-renown')).toBeNull();
  });

  it('says so when the character is unknown', () => {
    attach(startGame());
    const Sheet = character.screen.component;
    render(<Sheet params={{ id: 'chr_nobody' }} close={() => undefined} />);
    expect(screen.getByTestId('character-missing')).toBeTruthy();
  });
});

describe('longhouse', () => {
  it('appoints a steward by picking a card, and explains what cannot be done', () => {
    attach(startGame());
    const lt = lieutenant(state());
    const Screen = longhouse.screen.component;
    render(<Screen close={() => undefined} />);
    // The lieutenants' card shows its holders; the steward's seat is chosen and filled from the cards.
    fireEvent.click(screen.getByTestId('office-steward'));
    expect(screen.getByTestId('longhouse-focus').getAttribute('data-office')).toBe('steward');
    expect((screen.getByTestId('longhouse-appoint') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`assign-${lt}`));
    fireEvent.click(screen.getByTestId('longhouse-appoint'));
    expect(state().characters[lt]?.role?.kind).toBe('steward');
    expect(screen.getByTestId(`holder-${lt}`)).toBeTruthy();
    // The player has no fleet at the start: the captains' card is closed and says why.
    const fleets = Object.values(state().fleets).filter((f) => f.ownerId === state().player.factionId);
    if (fleets.length === 0) {
      expect((screen.getByTestId('office-captain') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('office-captain').textContent).toMatch(/no fleet/i);
    }
  });
});

describe('rune-seer', () => {
  it('reads the omens once, then names the day the seer casts again', () => {
    attach(startGame());
    const before = state().factions[state().player.factionId]?.treasury ?? 0;
    const Screen = seer.screen.component;
    render(<Screen close={() => undefined} />);
    expect(screen.getByTestId('seer-no-readings')).toBeTruthy();
    fireEvent.click(screen.getByTestId('seer-read'));
    expect(state().factions[state().player.factionId]?.treasury).toBe(
      before - getContent().tunables.faith.omens.readCost,
    );
    expect(screen.getByTestId('omen-voyage').getAttribute('data-omen')).not.toBe('none');
    expect((screen.getByTestId('seer-read') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('seer-read').textContent).toMatch(/cast again on/);
  });

  it('tends a wounded member of the house for silver', () => {
    let target = '' as CharId;
    const session = startGame((s) => {
      target = lieutenant(s);
      const c = s.characters[target];
      if (!c) return;
      c.health = {
        ...c.health,
        wound: 'serious',
        woundUntilHour: s.time.hour + 30 * HOURS_PER_DAY,
        hpPct: 40,
      };
      s.people?.woundedIds.push(target);
      // A household seer at the patient's side (the heal command needs one).
      const healer = Object.values(s.characters).find(
        (x) =>
          x.alive &&
          x.id !== target &&
          x.id !== s.player.rulerId &&
          x.factionId === s.player.factionId &&
          x.location.kind === c.location.kind,
      );
      if (healer) {
        healer.role = { kind: 'seer', factionId: s.player.factionId };
        healer.location = c.location;
        healer.skills.runecraft = Math.max(2, healer.skills.runecraft);
      }
    });
    attach(session);
    const Screen = seer.screen.component;
    render(<Screen close={() => undefined} />);
    fireEvent.click(screen.getByTestId('seer-heal'));
    const btn = screen.getByTestId(`heal-seer-${target}`) as HTMLButtonElement;
    expect(screen.queryByTestId(`heal-why-seer-${target}`)?.textContent ?? '').toBe('');
    expect(btn.disabled).toBe(false);
    const until = state().characters[target]?.health.woundUntilHour ?? 0;
    fireEvent.click(btn);
    expect(state().characters[target]?.health.treated).toBe(true);
    expect(state().characters[target]?.health.woundUntilHour ?? 0).toBeLessThan(until);
  });
});

describe('grove', () => {
  it('previews and makes an offering to the chosen god', () => {
    attach(startGame());
    const Screen = grove.screen.component;
    render(<Screen close={() => undefined} />);
    fireEvent.click(screen.getByTestId('god-select-saltha'));
    expect(screen.getByTestId('grove-preview').textContent).toMatch(/Saltha Favor \+\d+/);
    const favor = state().player.house.favor.saltha;
    fireEvent.click(screen.getByTestId('grove-sacrifice'));
    expect(state().player.house.favor.saltha).toBeGreaterThan(favor);
  });
});

describe('family', () => {
  it('names an heir: pick the person, then the one decision in front of you', () => {
    attach(startGame());
    const Screen = family.screen.component;
    render(<Screen close={() => undefined} />);
    expect(screen.getByTestId('family-heir')).toBeTruthy();
    const candidates = heirCandidates(state());
    if (candidates.length === 0) return;
    const id = candidates[candidates.length - 1] as string;
    const card = document.querySelector(`button.choice[data-char="${id}"]`) as HTMLButtonElement;
    fireEvent.click(card);
    expect(screen.getByTestId('family-focus').getAttribute('data-char')).toBe(id);
    fireEvent.click(screen.getByTestId(`designate-${id}`));
    const ruler = state().characters[state().player.rulerId];
    expect(ruler?.family.heirId).toBe(id);
    expect(screen.getByTestId('family-current-heir').textContent).toMatch(/named heir/);
  });
});

describe('chronicle', () => {
  it('groups entries by year, newest first, and filters great deeds', () => {
    const y = 360 * HOURS_PER_DAY;
    const entries = [
      { hour: 10, kind: 'a', importance: 1, textKey: 'x', vars: {}, refs: [] },
      { hour: y + 5, kind: 'b', importance: 4, textKey: 'x', vars: {}, refs: [] },
      { hour: y + 50, kind: 'c', importance: 2, textKey: 'x', vars: {}, refs: [] },
    ];
    const all = groupByYear(entries, 'all');
    expect(all.map((g) => g.year)).toEqual([813, 812]);
    expect(all[0]?.entries.map((e) => e.entry.kind)).toEqual(['c', 'b']);
    expect(groupByYear(entries, 'notable').flatMap((g) => g.entries.map((e) => e.entry.kind))).toEqual(['b']);
  });

  it('renders the saga with links to the people it names', () => {
    attach(startGame());
    const Screen = chronicle.screen.component;
    render(<Screen close={() => undefined} />);
    const n = state().chronicle.length;
    if (n === 0) expect(screen.getByTestId('chronicle-empty')).toBeTruthy();
    else expect(screen.getAllByTestId('chronicle-entry')).toHaveLength(n);
  });
});
