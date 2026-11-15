/**
 * Data table: typed columns, optional sorting (click or Enter on a header; aria-sort), selectable
 * rows (Enter/Space activate a focused row), zebra striping and an empty state.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface Column<R> {
  id: string;
  header: ReactNode;
  cell(row: R): ReactNode;
  /** Enables sorting by this column. */
  sortValue?(row: R): number | string;
  align?: 'start' | 'end' | 'center';
  width?: string;
}

export interface TableProps<R> {
  rows: readonly R[];
  columns: readonly Column<R>[];
  rowKey(row: R): string;
  caption?: string;
  onRowClick?(row: R): void;
  selectedKey?: string | null;
  initialSort?: { column: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  dense?: boolean;
  className?: string;
  /** Extra attributes per row (data-testid, aria-*). */
  rowProps?(row: R): Record<string, string | undefined>;
}

/** A sortable, keyboard-friendly table. */
export function Table<R>({ rows, columns, rowKey, caption, onRowClick, selectedKey, initialSort, empty, dense = false, className, rowProps }: TableProps<R>): ReactElement {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.column);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, columns, sort]);

  const toggleSort = (id: string) => {
    setSort((s) => (s && s.column === id ? { column: id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { column: id, dir: 'asc' }));
  };

  return (
    <div className={['table-wrap', className].filter(Boolean).join(' ')}>
      <table className={['table', dense && 'table-dense', onRowClick && 'table-interactive'].filter(Boolean).join(' ')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.column === c.id;
              const ariaSort = active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined;
              return (
                <th key={c.id} scope="col" style={{ width: c.width, textAlign: c.align === 'end' ? 'right' : c.align === 'center' ? 'center' : 'left' }} aria-sort={ariaSort}>
                  {c.sortValue ? (
                    <button type="button" className="table-sort" onClick={() => toggleSort(c.id)}>
                      {c.header}
                      <Icon name={active && sort?.dir === 'desc' ? 'chevronDown' : 'chevronUp'} size={0.9} className={active ? undefined : 'table-sort-idle'} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const key = rowKey(row);
              const selected = selectedKey === key;
              return (
                <tr
                  key={key}
                  className={selected ? 'is-selected' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={onRowClick ? selected : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  {...(rowProps ? rowProps(row) : {})}
                >
                  {columns.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align === 'end' ? 'right' : c.align === 'center' ? 'center' : 'left' }}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
