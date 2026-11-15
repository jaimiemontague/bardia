/**
 * The Chronicle (top-bar route 'chronicle', SCR-29), laid out by ARCHITECTURE §20 as a reading column: the saga
 * so far, newest first, grouped by year and told in large type in each entry's own words, with the people it
 * names as quiet links to their character sheets. One filter: every entry, or only the great deeds.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { ChronicleEntry } from '@sim/core/state';
import { toCalendar } from '@sim/core/time';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { Segmented } from '../../ui/index';
import {
  charById,
  dateText,
  displayName,
  Empty,
  NoGame,
  openCharacter,
  ScreenFrame,
  useHousehold,
  type Household,
} from '../character/household';
import { useMusicState } from '../../audio/hooks';
import './chronicle.css';

type Filter = 'all' | 'notable';
/** Entries at or above this importance count as notable deeds. */
export const NOTABLE_IMPORTANCE = 3;

/** Chronicle entries newest first (stable for equal hours: later-added first), grouped by year. */
export function groupByYear(
  entries: readonly ChronicleEntry[],
  filter: Filter,
): { year: number; entries: { entry: ChronicleEntry; index: number }[] }[] {
  const indexed = entries
    .map((entry, index) => ({ entry, index }))
    .filter((x) => filter === 'all' || x.entry.importance >= NOTABLE_IMPORTANCE);
  indexed.sort((a, b) => b.entry.hour - a.entry.hour || b.index - a.index);
  const out: { year: number; entries: { entry: ChronicleEntry; index: number }[] }[] = [];
  for (const x of indexed) {
    const year = toCalendar(x.entry.hour).year;
    const last = out[out.length - 1];
    if (last && last.year === year) last.entries.push(x);
    else out.push({ year, entries: [x] });
  }
  return out;
}

function People({ h, refs }: { h: Household; refs: readonly string[] }): ReactElement | null {
  const t = useT();
  const people = refs.map((id) => charById(h.state, id)).filter((c) => c !== undefined);
  if (people.length === 0) return null;
  return (
    <span className="cr-people">
      {people.map((c) => (
        <button
          key={c.id}
          type="button"
          className="cr-person"
          onClick={() => openCharacter(c.id)}
          aria-label={t('people.ui.openSheet', { name: displayName(t, c) })}
          data-testid={`chronicle-person-${c.id}`}
        >
          {t('codex.chronicle.person', { name: displayName(t, c) })}
        </button>
      ))}
    </span>
  );
}

function ChronicleView({ h }: { h: Household }): ReactElement {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const groups = useMemo(() => groupByYear(h.state.chronicle, filter), [h.state.chronicle, filter]);
  const total = h.state.chronicle.length;
  return (
    <>
      <div className="cr-head">
        <span className="cr-count" data-testid="chronicle-count">
          {t('codex.chronicle.count', { count: total })}
        </span>
        <Segmented<Filter>
          label={t('codex.chronicle.filter')}
          hideLabel
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('codex.chronicle.filterAll') },
            { value: 'notable', label: t('codex.chronicle.filterNotable') },
          ]}
        />
      </div>
      {groups.length === 0 ? (
        <Empty testId="chronicle-empty">
          {total === 0 ? t('codex.chronicle.empty') : t('codex.chronicle.emptyFiltered')}
        </Empty>
      ) : (
        groups.map((g) => (
          <section key={g.year} className="cr-year" data-testid={`chronicle-year-${g.year}`}>
            <h3 className="cr-year-title">{t('codex.chronicle.year', { year: g.year })}</h3>
            <ol className="cr-entries">
              {g.entries.map(({ entry, index }) => (
                <li
                  key={index}
                  className={`cr-entry imp-${Math.max(0, Math.min(5, Math.round(entry.importance)))}`}
                  data-testid="chronicle-entry"
                  data-kind={entry.kind}
                >
                  <span className="cr-date">{dateText(entry.hour)}</span>
                  <span className="cr-text">{t(entry.textKey, entry.vars)}</span>
                  <People h={h} refs={entry.refs} />
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </>
  );
}

function ChronicleScreen({ close }: ScreenProps): ReactElement {
  const t = useT();
  const h = useHousehold();
  useMusicState('chronicle');
  if (!h) return <NoGame close={close} />;
  return (
    <ScreenFrame
      id="chronicle"
      title={t('ui.route.chronicle')}
      subtitle={h.state.factions[h.state.player.factionId]?.name}
      close={close}
      narrow
    >
      <ChronicleView h={h} />
    </ScreenFrame>
  );
}

export const screen: ScreenDescriptor = {
  id: 'chronicle',
  route: 'chronicle',
  component: ChronicleScreen,
  layout: 'overlay',
  titleKey: 'ui.route.chronicle',
};
