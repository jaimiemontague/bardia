/**
 * Localised calendar text. The simulation's `formatDate` is an English debugging helper; the UI
 * formats dates from `toCalendar` with locale keys (`ui.calendar.month.<name>`, `ui.calendar.date`).
 */
import { MONTHS, WEEKDAYS, toCalendar, weekdayIndex, type Hour } from '@sim/core/time';
import { t } from './index';

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Localised month name for a month index 0–11. */
export function monthLabel(monthIndex: number): string {
  const name = MONTHS[monthIndex];
  return name === undefined ? String(monthIndex + 1) : t(`ui.calendar.month.${lowerFirst(name)}`);
}

/** Localised weekday name for an hour. */
export function weekdayLabel(hour: Hour): string {
  const name = WEEKDAYS[weekdayIndex(hour)];
  return name === undefined ? '' : t(`ui.calendar.weekday.${lowerFirst(name)}`);
}

/** "12 Hayfall 813 A.S." */
export function formatGameDate(hour: Hour): string {
  const c = toCalendar(hour);
  return t('ui.calendar.date', { day: c.day, month: monthLabel(c.monthIndex), year: c.year });
}

/** "Thunday, 12 Hayfall 813 A.S., 14:00" */
export function formatGameDateTime(hour: Hour): string {
  const c = toCalendar(hour);
  return t('ui.calendar.dateTime', {
    weekday: weekdayLabel(hour),
    date: formatGameDate(hour),
    time: `${String(c.hour).padStart(2, '0')}:00`,
  });
}

/** Season key ('spring' …) of an hour, localised. */
export function seasonLabel(hour: Hour): string {
  const c = toCalendar(hour);
  const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
  return t(`ui.calendar.season.${seasons[Math.floor(c.monthIndex / 3)] ?? 'spring'}`);
}
