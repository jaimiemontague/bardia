import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { testWorld } from '@sim/testing';
import { levelTitle, playerSummary, renownTierOf } from './playerSummary';

const content = getContent();

describe('top-bar summary', () => {
  const world = testWorld({ factions: 2, fleetsPerFaction: 1, difficulty: 'raider' });
  const s = playerSummary(world.state, content);

  it('adds up silver, men and food with a line per source', () => {
    const faction = world.state.factions[world.state.player.factionId];
    expect(s.silver.lines[0]).toMatchObject({ labelKey: 'ui.topbar.breakdown.treasury', value: faction?.treasury });
    expect(s.silver.total).toBe(s.silver.lines.reduce((a, l) => a + l.value, 0));
    expect(s.men.total).toBe(s.men.lines.reduce((a, l) => a + l.value, 0));
    expect(s.men.lines.some((l) => l.labelKey === 'ui.topbar.breakdown.fleet')).toBe(true);
    expect(s.foodMonths).toBe(content.balance.difficulty.raider.foodMonths);
  });

  it('names the ruler with a byname or the level title', () => {
    const ruler = world.state.characters[world.state.player.rulerId];
    expect(s.rulerName).toBe(ruler?.name);
    expect(s.epithet).toBe(ruler?.byname ?? levelTitle(ruler?.level ?? 1, content));
    expect(s.capital?.id).toBe(world.state.player.capitalId);
  });

  it('finds renown tiers by threshold', () => {
    expect(renownTierOf(0, content)).toBe('unknown');
    expect(renownTierOf(182, content)).toBe('known');
    expect(renownTierOf(10_000, content)).toBe('legendary');
    expect(renownTierOf(5, null)).toBe('unknown');
  });
});
