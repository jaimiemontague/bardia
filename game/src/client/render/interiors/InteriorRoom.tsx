/**
 * The room stage: entering a building replaces the whole view below the top bar with the room's painting. The
 * people in it are real buttons (name plate, glow on hover and focus, digit key); clicking one opens their
 * panel over one side of the room while the picture pans so the chosen person stays in view on the other side.
 *
 * Keys: 1..n pick a person; Tab/Enter as usual; Esc closes the open panel, and on the next press leaves.
 * The entering transition lasts ENTER_MS (none under reduced motion).
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useRouteActive } from '../../app/routeActive';
import { useT } from '../../i18n/index';
import { Button, Icon } from '../../ui/index';
import { Painting } from '../scenes/finalArt';
import { useFreshKeys } from '../scenes/SceneStage';
import { findPerson, panelSideOf, personBox, roomKey } from './layout';
import { roomLight } from './light';
import { ROOM_W, type InteriorRoomDef, type RoomAmbience } from './types';
import './interiors.css';

/** The entering transition's length (ms). */
export const ENTER_MS = 380;

/** Whether the player asked for reduced motion (the game's own setting first, then the system's). */
export function prefersStill(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.dataset['motion'] === 'reduced') return true;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset['motion'] !== 'full';
  } catch {
    return false;
  }
}

export interface InteriorRoomProps {
  room: InteriorRoomDef;
  ambience: RoomAmbience;
  /** A short line under the building's name (e.g. "at Skarnvik"). */
  subtitle?: string;
  /** The open person, when the caller controls it (`useRoutePerson`); leave undefined to let the room keep it. */
  person?: string | null;
  /** The person whose panel is open at first (uncontrolled rooms). */
  initialPerson?: string | null;
  /** Called whenever a panel opens (id) or closes (null). */
  onPersonChange?(id: string | null): void;
  /** The content of a person's panel (their menu). */
  panel(personId: string): ReactNode;
  /** Back to the village. */
  onLeave(): void;
  /** An extra test id on the picture stage (keeps an older screen's id, e.g. 'great-hall'). */
  stageTestId?: string;
  /** Layout seed for the painting (default: from the room id). */
  seed?: number;
}

/** A full-screen room with its people and their panels (see the file header). */
export function InteriorRoom({ room, ambience, subtitle, person, initialPerson = null, onPersonChange, panel, onLeave, stageTestId, seed }: InteriorRoomProps): ReactElement {
  const t = useT();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [inner, setInner] = useState<string | null>(() => findPerson(room, initialPerson)?.id ?? null);
  const controlled = person !== undefined;
  const open = findPerson(room, controlled ? person : inner)?.id ?? null;
  const [still] = useState(prefersStill);
  const lastOpen = useRef<string | null>(null);
  // Under a panel opened from this room (the ledger over the hall) the room is drawn but answers no keys.
  const active = useRouteActive();

  const setOpen = (id: string | null) => {
    if (!controlled) setInner(id);
    onPersonChange?.(id);
  };

  // Focus follows the panel: into it when it opens, back to the person's button when it closes.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
    else if (lastOpen.current) rootRef.current?.querySelector<HTMLElement>(`[data-person-id="${lastOpen.current}"]`)?.focus({ preventScroll: true });
    lastOpen.current = open;
  }, [open]);

  useFreshKeys((e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    // Only while the room is what the player is looking at (not under a decision or another dialog).
    const root = rootRef.current;
    const target = e.target as Node | null;
    if (!root || (target && target !== document.body && target !== document.documentElement && !root.contains(target))) return false;
    const action = roomKey(e.key, room, open);
    if (action.kind === 'open') setOpen(action.person);
    else if (action.kind === 'closePanel') setOpen(null);
    else if (action.kind === 'leave') onLeave();
    else return false;
    return true;
  }, active);

  const light = roomLight(ambience);
  const title = t(room.titleKey);
  const openPerson = open ? findPerson(room, open) : undefined;
  const side = openPerson ? panelSideOf(openPerson) : 'right';
  const vars = { '--px': openPerson ? openPerson.x / ROOM_W : 0.5 } as CSSProperties;
  const RoomPainting = room.Painting;
  const titleId = `int-${uid}-title`;
  const panelTitleId = `int-${uid}-panel`;

  return (
    <div
      ref={rootRef}
      className={`int-root${open ? ` is-open side-${side}` : ''}${openPerson?.wide ? ' is-wide' : ''}${still ? ' is-still' : ' int-enter'}`}
      role="region"
      aria-labelledby={titleId}
      data-testid={`interior-${room.id}`}
      data-person={open ?? ''}
      data-tod={light.tod}
      style={vars}
    >
      <div className="int-stage" data-testid={stageTestId}>
        <div className="int-picture">
          <Painting assetId={room.assetId}>
            <RoomPainting light={light} seed={seed ?? room.id.length * 7919} />
          </Painting>
          {room.people.map((p, i) => {
            const box = personBox(p);
            const name = t(p.nameKey);
            const selected = p.id === open;
            return (
              <button
                key={p.id}
                type="button"
                className={`int-person${selected ? ' is-selected' : ''}${open && !selected ? ' is-quiet' : ''}${p.plate === 'below' ? ' plate-below' : ''}`}
                style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
                onClick={() => setOpen(selected ? null : p.id)}
                aria-label={t(p.kind === 'place' ? 'hub.interior.goTo' : 'hub.interior.speakTo', { name })}
                aria-expanded={selected}
                aria-controls={selected ? panelTitleId : undefined}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                data-person-id={p.id}
                data-testid={`interior-person-${p.id}`}
                {...(i === 0 && !open ? { 'data-autofocus': true } : {})}
              >
                <span className="int-ring" aria-hidden="true" />
                <span className="int-plate" aria-hidden="true">
                  {p.icon && <Icon name={p.icon} />}
                  <span className="int-plate-name">{name}</span>
                  {i < 9 && <kbd className="int-key">{i + 1}</kbd>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <header className="int-head">
        <Button icon="arrowLeft" onClick={onLeave} className="int-leave" data-testid="interior-leave">
          {t('hub.interior.leave')}
        </Button>
        <div className="int-title">
          <h1 id={titleId}>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </header>

      {!open && (
        <p className="int-hint" data-testid="interior-hint">
          {t('hub.interior.hint')}
        </p>
      )}

      {openPerson && (
        <section key={openPerson.id} ref={panelRef} tabIndex={-1} className={`int-panel int-panel-${side}`} aria-labelledby={panelTitleId} data-testid="interior-panel" data-person={openPerson.id}>
          <header className="int-panel-head">
            <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => setOpen(null)} className="int-back" data-testid="interior-back">
              {t('hub.interior.back')}
            </Button>
            <h2 id={panelTitleId} className="int-panel-title">
              {openPerson.icon && <Icon name={openPerson.icon} />}
              {t(openPerson.nameKey)}
            </h2>
            <p className="int-greeting">{t(openPerson.greetingKey)}</p>
          </header>
          <div className="int-panel-body">{panel(openPerson.id)}</div>
        </section>
      )}
    </div>
  );
}
