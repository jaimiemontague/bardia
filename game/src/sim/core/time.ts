/**
 * Game time and the calendar of Bardia (design §4.6, §7).
 *
 * Time is an absolute integer hour count since campaign start (`Hour`). Hour 0 is the first hour
 * of 1 Icebreak 812 A.S. (a Moonday). Years have 12 months × 30 days = 360 days; weeks have 7 days
 * and run continuously across years. Negative hours are valid (characters born before the start).
 */
import type { SeasonId } from '@content/schemas/ids';

/** Absolute game hours since campaign start. */
export type Hour = number;

export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360
export const HOURS_PER_MONTH = HOURS_PER_DAY * DAYS_PER_MONTH; // 720
export const HOURS_PER_YEAR = HOURS_PER_DAY * DAYS_PER_YEAR; // 8640
export const HOURS_PER_WEEK = HOURS_PER_DAY * DAYS_PER_WEEK; // 168

/** Year (A.S., "After the Sundering") at hour 0. */
export const START_YEAR = 812;

export const MONTHS = [
  'Icebreak',
  'Seedtide',
  'Greening',
  'Highsun',
  'Hayfall',
  'Ripening',
  'Reaping',
  'Slaughtermonth',
  'Fogmonth',
  'Yuledark',
  'Wolfmonth',
  'Frostmoot',
] as const;
export type MonthName = (typeof MONTHS)[number];

export const WEEKDAYS = ['Moonday', 'Tyrsday', 'Wodensday', 'Thunday', 'Freyday', 'Lawday', 'Sunday'] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];

/** Seasons, 3 months each, starting with spring in Icebreak. */
export const SEASONS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** A calendar date. `monthIndex` 0–11, `day` 1–30, `hour` 0–23. */
export interface CalendarDate {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function assertHour(h: number): void {
  if (!Number.isInteger(h)) throw new RangeError(`time: hour must be an integer, got ${h}`);
}

/** Absolute day index (day 0 = 1 Icebreak 812). */
export function dayIndex(hour: Hour): number {
  assertHour(hour);
  return floorDiv(hour, HOURS_PER_DAY);
}

/** Converts an absolute hour to a calendar date. */
export function toCalendar(hour: Hour): CalendarDate {
  assertHour(hour);
  const day = floorDiv(hour, HOURS_PER_DAY);
  const yearOffset = floorDiv(day, DAYS_PER_YEAR);
  const dayOfYear = mod(day, DAYS_PER_YEAR);
  return {
    year: START_YEAR + yearOffset,
    monthIndex: floorDiv(dayOfYear, DAYS_PER_MONTH),
    day: mod(dayOfYear, DAYS_PER_MONTH) + 1,
    hour: mod(hour, HOURS_PER_DAY),
  };
}

/** Converts a calendar date (hour defaults to 0) to an absolute hour. Validates ranges. */
export function fromCalendar(date: { year: number; monthIndex: number; day: number; hour?: number }): Hour {
  const hour = date.hour ?? 0;
  if (!Number.isInteger(date.year)) throw new RangeError('fromCalendar: bad year');
  if (!Number.isInteger(date.monthIndex) || date.monthIndex < 0 || date.monthIndex >= MONTHS_PER_YEAR)
    throw new RangeError(`fromCalendar: bad monthIndex ${date.monthIndex}`);
  if (!Number.isInteger(date.day) || date.day < 1 || date.day > DAYS_PER_MONTH) throw new RangeError(`fromCalendar: bad day ${date.day}`);
  if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS_PER_DAY) throw new RangeError(`fromCalendar: bad hour ${hour}`);
  const days = (date.year - START_YEAR) * DAYS_PER_YEAR + date.monthIndex * DAYS_PER_MONTH + (date.day - 1);
  return days * HOURS_PER_DAY + hour;
}

/** hour + days·24. */
export function addDays(hour: Hour, days: number): Hour {
  return hour + Math.round(days * HOURS_PER_DAY);
}

/** Whole elapsed days from `a` to `b` (floor((b − a) / 24); negative if b < a). */
export function daysBetween(a: Hour, b: Hour): number {
  return floorDiv(b - a, HOURS_PER_DAY);
}

/** Number of midnights crossed from `a` to `b` (calendar-day difference). */
export function calendarDaysBetween(a: Hour, b: Hour): number {
  return dayIndex(b) - dayIndex(a);
}

/** Season of the given hour. */
export function season(hour: Hour): SeasonId {
  return SEASONS[floorDiv(toCalendar(hour).monthIndex, 3)] as SeasonId;
}

/** Weekday index 0–6 (0 = Moonday). */
export function weekdayIndex(hour: Hour): number {
  return mod(dayIndex(hour), DAYS_PER_WEEK);
}

/** Weekday name. */
export function weekday(hour: Hour): WeekdayName {
  return WEEKDAYS[weekdayIndex(hour)] as WeekdayName;
}

/** Month name for a monthIndex 0–11. */
export function monthName(monthIndex: number): MonthName {
  const m = MONTHS[monthIndex];
  if (m === undefined) throw new RangeError(`monthName: bad index ${monthIndex}`);
  return m;
}

/** Calendar boundaries crossed in the half-open interval (from, to]. */
export interface Boundaries {
  newDay: boolean;
  newWeek: boolean;
  newMonth: boolean;
  newYear: boolean;
}

/** Which day/week/month/year boundaries were crossed moving from `from` to `to` (to > from). */
export function boundariesBetween(from: Hour, to: Hour): Boundaries {
  const d0 = dayIndex(from);
  const d1 = dayIndex(to);
  if (d1 <= d0) return { newDay: false, newWeek: false, newMonth: false, newYear: false };
  return {
    newDay: true,
    newWeek: floorDiv(d1, DAYS_PER_WEEK) > floorDiv(d0, DAYS_PER_WEEK),
    newMonth: floorDiv(d1, DAYS_PER_MONTH) > floorDiv(d0, DAYS_PER_MONTH),
    newYear: floorDiv(d1, DAYS_PER_YEAR) > floorDiv(d0, DAYS_PER_YEAR),
  };
}

/** "12 Hayfall 813 A.S." */
export function formatDate(hour: Hour): string {
  const c = toCalendar(hour);
  return `${c.day} ${monthName(c.monthIndex)} ${c.year} A.S.`;
}

/** "Thunday, 12 Hayfall 813 A.S., 14:00" */
export function formatDateTime(hour: Hour): string {
  const c = toCalendar(hour);
  return `${weekday(hour)}, ${formatDate(hour)}, ${String(c.hour).padStart(2, '0')}:00`;
}

/** Full years of age at `nowHour` for someone born at `birthHour` (exact: every year is 360 days). */
export function ageInYears(birthHour: Hour, nowHour: Hour): number {
  return floorDiv(nowHour - birthHour, HOURS_PER_YEAR);
}

/** True if `nowHour` falls on the calendar anniversary (same month and day) of `birthHour`. */
export function isBirthday(birthHour: Hour, nowHour: Hour): boolean {
  const a = toCalendar(birthHour);
  const b = toCalendar(nowHour);
  return a.monthIndex === b.monthIndex && a.day === b.day;
}

/** The first hour of the next occurrence (strictly after `fromHour`) of `monthIndex`/`day`. */
export function nextDate(fromHour: Hour, monthIndex: number, day: number): Hour {
  const c = toCalendar(fromHour);
  let candidate = fromCalendar({ year: c.year, monthIndex, day });
  if (candidate <= fromHour) candidate = fromCalendar({ year: c.year + 1, monthIndex, day });
  return candidate;
}
