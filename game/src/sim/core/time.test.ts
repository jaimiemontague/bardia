import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  HOURS_PER_DAY,
  HOURS_PER_YEAR,
  addDays,
  ageInYears,
  boundariesBetween,
  calendarDaysBetween,
  daysBetween,
  formatDate,
  formatDateTime,
  fromCalendar,
  isBirthday,
  monthName,
  nextDate,
  season,
  toCalendar,
  weekday,
} from './time';

describe('calendar conversions', () => {
  it('hour 0 is 1 Icebreak 812 A.S., a Moonday', () => {
    expect(toCalendar(0)).toEqual({ year: 812, monthIndex: 0, day: 1, hour: 0 });
    expect(formatDate(0)).toBe('1 Icebreak 812 A.S.');
    expect(weekday(0)).toBe('Moonday');
    expect(formatDateTime(14)).toBe('Moonday, 1 Icebreak 812 A.S., 14:00');
  });

  it('formats the design example', () => {
    const h = fromCalendar({ year: 813, monthIndex: 4, day: 12 });
    expect(formatDate(h)).toBe('12 Hayfall 813 A.S.');
    expect(monthName(4)).toBe('Hayfall');
  });

  it('round-trips any hour (including negative, pre-campaign hours)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100 * HOURS_PER_YEAR, max: 100 * HOURS_PER_YEAR }), (h) => {
        expect(fromCalendar(toCalendar(h))).toBe(h);
        const c = toCalendar(h);
        expect(c.day).toBeGreaterThanOrEqual(1);
        expect(c.day).toBeLessThanOrEqual(30);
        expect(c.monthIndex).toBeGreaterThanOrEqual(0);
        expect(c.monthIndex).toBeLessThan(12);
        expect(c.hour).toBeGreaterThanOrEqual(0);
        expect(c.hour).toBeLessThan(24);
      }),
    );
    expect(toCalendar(-1)).toEqual({ year: 811, monthIndex: 11, day: 30, hour: 23 });
  });

  it('validates inputs', () => {
    expect(() => fromCalendar({ year: 812, monthIndex: 12, day: 1 })).toThrow();
    expect(() => fromCalendar({ year: 812, monthIndex: 0, day: 31 })).toThrow();
    expect(() => fromCalendar({ year: 812, monthIndex: 0, day: 1, hour: 24 })).toThrow();
    expect(() => toCalendar(1.5)).toThrow();
    expect(() => monthName(12)).toThrow();
  });

  it('seasons are three months each from Icebreak', () => {
    const at = (m: number) => season(fromCalendar({ year: 812, monthIndex: m, day: 1 }));
    expect([0, 1, 2].map(at)).toEqual(['spring', 'spring', 'spring']);
    expect([3, 4, 5].map(at)).toEqual(['summer', 'summer', 'summer']);
    expect([6, 7, 8].map(at)).toEqual(['autumn', 'autumn', 'autumn']);
    expect([9, 10, 11].map(at)).toEqual(['winter', 'winter', 'winter']);
  });

  it('weeks run continuously across years (360 is not a multiple of 7)', () => {
    expect(weekday(7 * HOURS_PER_DAY)).toBe('Moonday');
    expect(weekday(HOURS_PER_YEAR)).toBe('Thunday'); // day 360 = 51·7 + 3 → weekday index 3
  });
});

describe('day arithmetic', () => {
  it('addDays / daysBetween / calendarDaysBetween', () => {
    expect(addDays(0, 3)).toBe(72);
    expect(addDays(10, 0.5)).toBe(22);
    expect(daysBetween(0, 47)).toBe(1);
    expect(daysBetween(47, 0)).toBe(-2);
    expect(calendarDaysBetween(23, 24)).toBe(1);
    expect(daysBetween(23, 24)).toBe(0);
  });

  it('ageInYears is exact with 360-day years', () => {
    const birth = fromCalendar({ year: 796, monthIndex: 5, day: 10 });
    expect(ageInYears(birth, fromCalendar({ year: 812, monthIndex: 5, day: 9, hour: 23 }))).toBe(15);
    expect(ageInYears(birth, fromCalendar({ year: 812, monthIndex: 5, day: 10 }))).toBe(16);
    expect(isBirthday(birth, fromCalendar({ year: 820, monthIndex: 5, day: 10, hour: 12 }))).toBe(true);
    expect(isBirthday(birth, fromCalendar({ year: 820, monthIndex: 5, day: 11 }))).toBe(false);
  });

  it('nextDate finds the next occurrence strictly after', () => {
    const allthing = nextDate(0, 3, 15);
    expect(formatDate(allthing)).toBe('15 Highsun 812 A.S.');
    expect(formatDate(nextDate(allthing, 3, 15))).toBe('15 Highsun 813 A.S.');
  });
});

describe('boundary detection', () => {
  it('detects new day/week/month/year between two hours', () => {
    expect(boundariesBetween(0, 1)).toEqual({ newDay: false, newWeek: false, newMonth: false, newYear: false });
    expect(boundariesBetween(23, 24)).toEqual({ newDay: true, newWeek: false, newMonth: false, newYear: false });
    expect(boundariesBetween(7 * 24 - 1, 7 * 24).newWeek).toBe(true);
    expect(boundariesBetween(30 * 24 - 1, 30 * 24)).toMatchObject({ newDay: true, newMonth: true, newYear: false });
    expect(boundariesBetween(HOURS_PER_YEAR - 1, HOURS_PER_YEAR)).toMatchObject({ newMonth: true, newYear: true });
    expect(boundariesBetween(0, HOURS_PER_YEAR * 2)).toEqual({ newDay: true, newWeek: true, newMonth: true, newYear: true });
  });

  it('a year of hourly steps crosses exactly 360 days, 12 months, 1 year', () => {
    let days = 0;
    let weeks = 0;
    let months = 0;
    let years = 0;
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      const b = boundariesBetween(h, h + 1);
      if (b.newDay) days++;
      if (b.newWeek) weeks++;
      if (b.newMonth) months++;
      if (b.newYear) years++;
    }
    expect({ days, weeks, months, years }).toEqual({ days: 360, weeks: 51, months: 12, years: 1 });
  });
});
