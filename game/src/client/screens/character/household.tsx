/**
 * Shared pieces of the household screens (character sheet, family, longhouse, rune-seer, grove,
 * chronicle): access to the state and content, a side-effect-free trial of a command (so every
 * control can say *why* it is unavailable using the module's own rules), name and status helpers,
 * a person card and the common overlay frame.
 *
 * No game rule lives here: eligibility, costs and outcomes come from running the real command on a
 * copy of the state (`tryCommand`), never from re-implementing a handler.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Content } from '@content/index';
import type { Command, CommandFailure } from '@sim/core/commands';
import { dispatch } from '@sim/core/dispatch';
import type { SimEvent } from '@sim/core/events';
import type { SimEnv } from '@sim/core/module';
import type { Character, CharId, GameState, JsonValue } from '@sim/core/state';
import { ageOf, lifeStageOf } from '@sim/modules/people/util';
import { loadContent } from '../../app/content';
import { useGame } from '../../app/gameStore';
import { navigation } from '../../app/navigation';
import { formatGameDate } from '../../i18n/calendar';
import { hasKey, tOr, useT, type t as translate } from '../../i18n/index';
import {
  ChoiceCard,
  Frame,
  Icon,
  IconButton,
  Portrait,
  recipeForCharacter,
  Tooltip,
  type IconName,
} from '../../ui/index';
import './household.css';

type T = typeof translate;

/** What every household screen needs. */
export interface Household {
  state: GameState;
  content: Content;
  /** The running session's environment (null outside a session; commands cannot be tried then). */
  env: SimEnv | null;
}

/** The current game state, content and simulation environment (null while no game is loaded). */
export function useHousehold(): Household | null {
  const state = useGame((s) => s.state);
  const session = useGame((s) => s.session);
  const loaded = loadContent();
  if (!state || !loaded.ok) return null;
  return { state, content: loaded.content, env: session?.env ?? null };
}

/** The outcome of trying a command on a copy of the state. */
export type Trial =
  | { ok: true; state: GameState; events: readonly SimEvent[] }
  | { ok: false; code: string; details?: JsonValue };

/**
 * Runs a command against the current state without committing it (the simulation's `dispatch` is
 * pure). The result tells whether the command would be accepted and, if so, what it would change.
 */
export function tryCommand(h: Household, cmd: Command): Trial {
  if (!h.env) return { ok: false, code: 'noSession' };
  try {
    const r = dispatch(h.state, cmd, h.env);
    if (r.error) return failure(r.error);
    return { ok: true, state: r.state, events: r.events };
  } catch {
    return { ok: false, code: 'failed' };
  }
}

function failure(e: CommandFailure): Trial {
  return e.details !== undefined
    ? { ok: false, code: e.code, details: e.details }
    : { ok: false, code: e.code };
}

/** Issues a command for real (a rejection is shown by the shell's error toast). */
export function runCommand(cmd: Command): boolean {
  const r = useGame.getState().dispatch(cmd);
  return r !== null && !r.error;
}

/** The player-facing reason for a rejected trial (people, then faith strings, then a generic line). */
export function reasonText(t: T, trial: Trial): string {
  if (trial.ok) return '';
  for (const key of [`people.ui.error.${trial.code}`, `faith.error.${trial.code}`])
    if (hasKey(key)) return t(key);
  return t('people.ui.error.generic');
}

/** Treasury change of a trial (negative = it costs silver). */
export function silverDelta(h: Household, trial: Trial): number {
  if (!trial.ok) return 0;
  const id = h.state.player.factionId;
  return (trial.state.factions[id]?.treasury ?? 0) - (h.state.factions[id]?.treasury ?? 0);
}

/** A character by id (undefined when unknown). */
export function charById(state: GameState, id: string | undefined): Character | undefined {
  if (id === undefined || !Object.hasOwn(state.characters, id)) return undefined;
  return state.characters[id as CharId];
}

/** "Sigrun" or "Sigrun Ironhand". */
export function displayName(t: T, c: Character): string {
  return c.byname ? t('people.ui.nameWithByname', { name: c.name, byname: c.byname }) : c.name;
}

/** The deed-name or level title ("the Untried"), or '' when none is known. */
export function epithetOf(t: T, c: Character): string {
  if (c.deedName) return t(c.deedName.key, c.deedName.vars);
  if (c.title) return t(c.title);
  return '';
}

/** Age in whole years (at death for the dead). */
export function ageNow(state: GameState, c: Character): number {
  return ageOf(c, c.alive ? state.time.hour : (c.death?.hour ?? state.time.hour));
}

/** Infant, child, youth or adult. */
export function stageOf(
  state: GameState,
  content: Content,
  c: Character,
): 'infant' | 'child' | 'youth' | 'adult' {
  return lifeStageOf(ageNow(state, c), content);
}

/** True when the character serves the player's house (or rules it). */
export function inPlayerHouse(state: GameState, c: Character): boolean {
  return (
    c.id === state.player.rulerId || (c.factionId !== undefined && c.factionId === state.player.factionId)
  );
}

/** A fleet's display name: its flagship's name (fleets carry no name of their own). */
export function fleetName(state: GameState, fleetId: string): string {
  const f = Object.hasOwn(state.fleets, fleetId)
    ? state.fleets[fleetId as keyof GameState['fleets']]
    : undefined;
  const first = f?.shipIds[0];
  const ship = first !== undefined && Object.hasOwn(state.ships, first) ? state.ships[first] : undefined;
  return ship?.name ?? '';
}

/** Role label ("Lieutenant", "Governor of Isholm"). */
export function roleText(t: T, state: GameState, c: Character): string {
  const role = c.role;
  if (!role) return t('people.ui.role.none');
  const base = t(`people.role.${role.kind}`);
  if (role.kind === 'governor' && role.holdingId !== undefined) {
    const s = Object.hasOwn(state.settlements, role.holdingId)
      ? state.settlements[role.holdingId]
      : undefined;
    if (s) return t('people.ui.role.governorOf', { place: s.name });
  }
  if (role.kind === 'captain' && role.fleetId !== undefined) {
    const f = Object.hasOwn(state.fleets, role.fleetId) ? state.fleets[role.fleetId] : undefined;
    if (f) return t('people.ui.role.captainOf', { fleet: fleetName(state, f.id) });
  }
  return base;
}

/** Where the character is, in words. */
export function whereText(t: T, state: GameState, c: Character): string {
  const loc = c.location;
  switch (loc.kind) {
    case 'settlement': {
      const s = Object.hasOwn(state.settlements, loc.id) ? state.settlements[loc.id] : undefined;
      return s ? t('people.ui.where.settlement', { place: s.name }) : t('people.ui.where.unknown');
    }
    case 'fleet': {
      const f = Object.hasOwn(state.fleets, loc.id) ? state.fleets[loc.id] : undefined;
      return f ? t('people.ui.where.fleet', { fleet: fleetName(state, f.id) }) : t('people.ui.where.atSea');
    }
    case 'army':
      return t('people.ui.where.army');
    case 'captive': {
      const s = Object.hasOwn(state.settlements, loc.at) ? state.settlements[loc.at] : undefined;
      const f = Object.hasOwn(state.factions, loc.by) ? state.factions[loc.by] : undefined;
      return t('people.ui.where.captive', { place: s?.name ?? '', captor: f?.name ?? '' });
    }
    default:
      return c.alive ? t('people.ui.where.unknown') : t('people.ui.where.dead');
  }
}

export type StatusTone = 'good' | 'bad' | 'warn' | 'info' | 'neutral';
export interface StatusTag {
  key: string;
  label: string;
  tone: StatusTone;
}

/** Short status tags: dead, captive, wounded, with child, fostered, minor, idle. */
export function statusTags(t: T, h: Household, c: Character): StatusTag[] {
  const { state } = h;
  const out: StatusTag[] = [];
  if (!c.alive) return [{ key: 'dead', label: t('people.ui.status.dead'), tone: 'neutral' }];
  if (c.location.kind === 'captive')
    out.push({ key: 'captive', label: t('people.ui.status.captive'), tone: 'bad' });
  if (c.health.wound !== 'none')
    out.push({
      key: 'wounded',
      label: t(`people.wound.${c.health.wound}`),
      tone: c.health.wound === 'minor' ? 'warn' : 'bad',
    });
  else if (c.health.injuries.some((i) => i.untilHour !== undefined && i.untilHour > state.time.hour))
    out.push({ key: 'hurt', label: t('people.ui.status.hurt'), tone: 'warn' });
  if (c.pregnancy) out.push({ key: 'pregnant', label: t('people.ui.status.pregnant'), tone: 'info' });
  if (c.upbringing)
    out.push({ key: 'fostered', label: t(`people.ui.foster.mode.${c.upbringing.mode}`), tone: 'info' });
  const stage = stageOf(state, h.content, c);
  if (stage !== 'adult') out.push({ key: 'stage', label: t(`people.stage.${stage}`), tone: 'neutral' });
  else if (
    c.id !== state.player.rulerId &&
    (!c.role || c.role.kind === 'npc') &&
    inPlayerHouse(state, c) &&
    c.location.kind !== 'captive'
  ) {
    out.push({ key: 'idle', label: t('people.ui.status.idle'), tone: 'neutral' });
  }
  return out;
}

/** Opens a character sheet (the ruler's when `id` is omitted). */
export function openCharacter(id?: string): void {
  navigation.open('character', id !== undefined ? { id } : undefined);
}

/** A trait's display name and effect text (locale override, else the catalog's own text). */
export function traitText(content: Content, id: string): { name: string; description: string; kind: string } {
  const def = Object.hasOwn(content.traits, id) ? content.traits[id] : undefined;
  return {
    name: tOr(`core.trait.${id}.name`, def?.name ?? id),
    description: tOr(`core.trait.${id}.description`, def?.description ?? ''),
    kind: def?.kind ?? 'personality',
  };
}

/** A feat's display name and effect text. */
export function featText(content: Content, id: string): { name: string; description: string } {
  const def = Object.hasOwn(content.feats, id) ? content.feats[id] : undefined;
  return {
    name: tOr(`core.feat.${id}.name`, def?.name ?? id),
    description: tOr(`core.feat.${id}.description`, def?.description ?? ''),
  };
}

/** A culture's display name. */
export function cultureText(content: Content, id: string): string {
  const def = Object.hasOwn(content.cultures, id)
    ? content.cultures[id as keyof Content['cultures']]
    : undefined;
  return tOr(`core.culture.${id}.name`, def?.name ?? id);
}

/** A faith's display name. */
export function faithText(id: string): string {
  return tOr(`ui.faith.${id}`, id);
}

/** A god's display name. */
export function godText(content: Content, id: string): string {
  const def = Object.hasOwn(content.gods, id) ? content.gods[id as keyof Content['gods']] : undefined;
  return tOr(`faith.god.${id}`, def?.name ?? id);
}

/** A date line ("12 Hayfall 813 A.S."). */
export function dateText(hour: number): string {
  return formatGameDate(hour);
}

// ---------------------------------------------------------------------------------------------
// Components

/** A clickable person: portrait, name and a sub-line; opens the character sheet. */
export function PersonCard({
  h,
  c,
  sub,
  extra,
  size = 'sm',
  testId,
}: {
  h: Household;
  c: Character;
  sub?: ReactNode;
  extra?: ReactNode;
  size?: 'xs' | 'sm' | 'md';
  testId?: string;
}): ReactElement {
  const t = useT();
  const name = displayName(t, c);
  const tags = statusTags(t, h, c);
  return (
    <div
      className={['hh-person', !c.alive && 'is-dead'].filter(Boolean).join(' ')}
      data-testid={testId}
      data-char={c.id}
    >
      <button
        type="button"
        className="hh-person-main"
        onClick={() => openCharacter(c.id)}
        aria-label={t('people.ui.openSheet', { name })}
      >
        <Portrait
          recipe={recipeForCharacter(c, h.state)}
          alt={t('people.ui.portraitAlt', { name })}
          size={size}
          initial={c.name.slice(0, 1)}
        />
        <span className="hh-person-text">
          <span className="hh-person-name">{name}</span>
          {sub !== undefined && <span className="hh-person-sub">{sub}</span>}
          {tags.length > 0 && (
            <span className="hh-tags">
              {tags.map((tag) => (
                <span key={tag.key} className={`hh-tag tone-${tag.tone}`}>
                  {tag.label}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {extra !== undefined && <div className="hh-person-extra">{extra}</div>}
    </div>
  );
}

/**
 * The common screen of the household (ARCHITECTURE §20 rule 4): a large framed screen with a title, an
 * optional one-line explanation and a close button; the body scrolls when it must. `narrow` keeps a reading
 * column (chronicle, seer) centred in the frame.
 */
export function ScreenFrame({
  id,
  title,
  lede,
  subtitle,
  close,
  narrow = false,
  className,
  footer,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  subtitle?: ReactNode;
  close(): void;
  narrow?: boolean;
  className?: string;
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const t = useT();
  return (
    <Frame
      size="screen"
      title={title}
      subtitle={subtitle}
      ornate
      className={['hh-frame', narrow && 'is-narrow', className].filter(Boolean).join(' ')}
      actions={
        <IconButton
          icon="close"
          label={t('ui.common.close')}
          keyHint="ui.back"
          onClick={close}
          data-testid={`${id}-close`}
        />
      }
      footer={footer}
      data-testid={id}
    >
      <div className="hh-body">
        {lede && <p className="hh-lede">{lede}</p>}
        {children}
      </div>
    </Frame>
  );
}

/** A person as a big choice card: portrait, name and one plain line. */
export function PersonChoice({
  h,
  c,
  line,
  selected,
  onSelect,
  disabled,
  reason,
  badge,
  size = 'md',
  testId,
}: {
  h: Household;
  c: Character;
  line?: ReactNode;
  selected?: boolean;
  onSelect(): void;
  disabled?: boolean;
  reason?: ReactNode;
  badge?: ReactNode;
  size?: 'sm' | 'md';
  testId?: string;
}): ReactElement {
  const t = useT();
  const name = displayName(t, c);
  return (
    <ChoiceCard
      size={size}
      className={['hh-pick', !c.alive && 'is-dead'].filter(Boolean).join(' ')}
      picture={
        <Portrait
          recipe={recipeForCharacter(c, h.state)}
          alt=""
          size={size === 'sm' ? 'sm' : 'md'}
          initial={c.name.slice(0, 1)}
        />
      }
      title={name}
      line={line}
      selected={selected}
      disabled={disabled}
      reason={reason}
      badge={badge}
      onClick={onSelect}
      data-testid={testId}
      data-char={c.id}
    />
  );
}

/** Trait chips; each names what the trait does in a tooltip. */
export function TraitChips({
  h,
  c,
  testPrefix = 'trait-',
}: {
  h: Household;
  c: Character;
  testPrefix?: string;
}): ReactElement | null {
  const t = useT();
  if (c.traits.length === 0) return null;
  return (
    <ul className="hh-chips" aria-label={t('people.ui.sheet.traits')}>
      {c.traits.map((id) => {
        const tr = traitText(h.content, id);
        return (
          <li key={id}>
            <Tooltip
              content={
                <span className="hh-chip-tip">
                  {t('people.ui.chipTip', {
                    kind: t(`people.ui.traitKind.${tr.kind}`),
                    text: tr.description,
                  })}
                </span>
              }
              placement="bottom"
            >
              <span className={`hh-chip kind-${tr.kind}`} tabIndex={0} data-testid={`${testPrefix}${id}`}>
                {tr.name}
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** A titled block inside a screen. */
export function Section({
  title,
  icon,
  children,
  testId,
  aside,
}: {
  title: string;
  icon?: IconName;
  children: ReactNode;
  testId?: string;
  aside?: ReactNode;
}): ReactElement {
  return (
    <section className="hh-section" data-testid={testId}>
      <h3 className="hh-section-title">
        {icon && <Icon name={icon} />}
        <span>{title}</span>
        {aside !== undefined && <span className="hh-section-aside">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

/** A quiet "nothing here" line. */
export function Empty({ children, testId }: { children: ReactNode; testId?: string }): ReactElement {
  return (
    <p className="hh-empty" data-testid={testId}>
      {children}
    </p>
  );
}

/** The reason a control is unavailable, shown under it. */
export function Why({ text, testId }: { text: string; testId?: string }): ReactElement | null {
  if (!text) return null;
  return (
    <span className="hh-why" data-testid={testId}>
      <Icon name="info" size={0.95} />
      {text}
    </span>
  );
}

/** Shown when no game is loaded or the content failed to validate. */
export function NoGame({ close }: { close(): void }): ReactElement {
  const t = useT();
  return (
    <Frame
      title={t('people.ui.noGame.title')}
      actions={<IconButton icon="close" label={t('ui.common.close')} onClick={close} />}
    >
      <p>{t('people.ui.noGame.body')}</p>
    </Frame>
  );
}

/** A cause of death in words. */
export function causeText(t: T, cause: string | undefined): string {
  const key = `people.cause.${cause ?? ''}`;
  return hasKey(key) ? t(key) : t('people.ui.cause.unknown');
}
