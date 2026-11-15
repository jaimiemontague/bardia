/**
 * Tabs (WAI-ARIA tabs pattern): roving tabindex, ←/→ (or ↑/↓ when vertical), Home/End; panels are
 * labelled by their tab. Controlled (`value`/`onChange`) or uncontrolled (`defaultValue`).
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface TabDef {
  id: string;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** Small badge (counts, warnings). */
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: readonly TabDef[];
  value?: string;
  defaultValue?: string;
  onChange?(id: string): void;
  /** Renders the active panel. */
  children(active: string): ReactNode;
  orientation?: 'horizontal' | 'vertical';
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}

/** A tab strip with one visible panel. */
export function Tabs({ tabs, value, defaultValue, onChange, children, orientation = 'horizontal', label, className }: TabsProps): ReactElement {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.id ?? '');
  const active = value ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };
  const enabled = tabs.filter((t) => !t.disabled);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const i = enabled.findIndex((t) => t.id === active);
    let j = -1;
    if (e.key === prev) j = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === next) j = (i + 1) % enabled.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = enabled.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const target = enabled[j];
    if (!target) return;
    select(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div className={['tabs', `tabs-${orientation}`, className].filter(Boolean).join(' ')}>
      <div role="tablist" aria-label={label} aria-orientation={orientation} className="tabs-list" onKeyDown={onKey}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              className={['tab', selected && 'is-active'].filter(Boolean).join(' ')}
              onClick={() => select(tab.id)}
            >
              {tab.icon && <Icon name={tab.icon} />}
              <span>{tab.label}</span>
              {tab.badge !== undefined && <span className="tab-badge">{tab.badge}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel-${active}`} aria-labelledby={`${base}-tab-${active}`} className="tabs-panel" tabIndex={0}>
        {children(active)}
      </div>
    </div>
  );
}
