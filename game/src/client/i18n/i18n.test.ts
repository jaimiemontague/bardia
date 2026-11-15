import { describe, expect, it } from 'vitest';
import IntlMessageFormat from 'intl-messageformat';
import { EN_TABLES } from '@content/locales/index';
import { HOURS_PER_DAY, fromCalendar } from '@sim/core/time';
import { formatGameDate, formatGameDateTime, monthLabel, seasonLabel } from './calendar';
import { formatNumber, hasKey, missingKeysSeen, setMissingKeyWarnings, t, tOr } from './index';

setMissingKeyWarnings(false);

describe('i18n', () => {
  it('formats ICU messages with plurals and selects', () => {
    expect(t('ui.time.speedHint', { seconds: 1 })).toBe('One day passes in about 1 second');
    expect(t('ui.time.speedHint', { seconds: 4 })).toBe('One day passes in about 4 seconds');
    expect(t('menu.newSaga.summaryParent', { parent: 'mother' })).toBe('Child of a slain mother');
    expect(t('ui.topbar.jarlOf', { place: 'Brimhaven' })).toBe('Jarl of Brimhaven');
  });

  it('returns the key for missing strings and records it', () => {
    expect(t('ui.surely.missing.key')).toBe('ui.surely.missing.key');
    expect(missingKeysSeen()).toContain('ui.surely.missing.key');
    expect(hasKey('ui.common.close')).toBe(true);
    expect(tOr('core.trait.brave.name', 'Brave')).toBe('Brave');
  });

  it('formats numbers and game dates', () => {
    expect(formatNumber(4210)).toBe('4,210');
    expect(formatGameDate(0)).toBe('1 Icebreak 812 A.S.');
    const h = fromCalendar({ year: 813, monthIndex: 4, day: 12 }) + 14;
    expect(formatGameDate(h)).toBe('12 Hayfall 813 A.S.');
    expect(formatGameDateTime(h)).toMatch(/, 12 Hayfall 813 A\.S\., 14:00$/);
    expect(monthLabel(11)).toBe('Frostmoot');
    expect(seasonLabel(HOURS_PER_DAY * 100)).toBe('Summer');
  });

  it('the shell’s locale files are valid ICU, correctly prefixed, and use no bare apostrophes before braces', () => {
    for (const area of ['ui', 'menu'] as const) {
      for (const [key, msg] of Object.entries(EN_TABLES[area] as Record<string, string>)) {
        expect(key.startsWith(`${area}.`), key).toBe(true);
        expect(() => new IntlMessageFormat(msg, 'en'), key).not.toThrow();
        expect(/'[{}]/.test(msg), key).toBe(false);
      }
    }
  });
});
