/**
 * Pending decisions (§6 "time never advances while pending"): shows the screen registered for the
 * pending kind, or the generic decision modal for kinds that have no screen yet.
 *
 * The generic modal understands:
 *   - 'message' decisions → the text (payload.key + vars) and an Acknowledge button (core command);
 *   - any payload with `choices: [{ id, labelKey, vars?, command }]` → one button per choice that
 *     dispatches that exact command (the raising module builds it, so the client invents nothing);
 *   - 'storylet' decisions (narrative module) → its `choices: [{ index, labelKey, available }]` mapped
 *     onto `storyletChoice { instanceId, choice }` (plus "Later" when `canDefer`), until a dedicated
 *     storylet card screen registers for the kind;
 *   - otherwise an explanation that the decision's screen is not built yet (dev: the payload).
 *
 * Every card shows the payload's `illustration` (an image asset id, e.g. `people.illus.captivity` or
 * `narrative.vignette.storm`) at the top, 16:9 (`EventPicture`): the final painting when there is one, in
 * the game's season when that season has its own painting, else the procedural placeholder. The picture
 * shrinks on short windows so the choices stay in view.
 */
import type { ReactElement } from 'react';
import type { Command } from '@sim/core/commands';
import { AssetImage, manifestEntry } from '../assets/index';
import { useFinalPaintingInfo } from '../render/scenes/finalArt';
import { PENDING_OWNERS } from '@sim/core/ownership';
import type { PendingDecision, TextVars } from '@sim/core/state';
import { useGame, usePending } from '../app/gameStore';
import type { ScreenRegistry } from '../app/screenRegistry';
import { formatGameDate } from '../i18n/calendar';
import { hasKey, useT } from '../i18n/index';
import { Button, ButtonRow, Icon, Modal, Tooltip } from '../ui/index';

/** A choice carried by a pending payload (see the module docs above). */
export interface PendingChoice {
  id: string;
  labelKey: string;
  vars?: TextVars;
  command: Command;
  tone?: 'primary' | 'danger' | 'secondary';
  /** Shown but not selectable (a storylet choice whose condition fails). */
  disabled?: boolean;
  /** Locale key of a consequence preview shown as the button's tooltip. */
  previewKey?: string;
}

/** Choices of a narrative storylet decision (payload documented by the narrative module). */
export function storyletChoices(p: PendingDecision): PendingChoice[] {
  if (p.kind !== 'storylet') return [];
  const payload = rec(p.payload);
  const instanceId = payload.instanceId;
  if (typeof instanceId !== 'string') return [];
  const out: PendingChoice[] = [];
  if (Array.isArray(payload.choices)) {
    for (const raw of payload.choices) {
      const c = rec(raw);
      if (typeof c.index !== 'number' || typeof c.labelKey !== 'string') continue;
      out.push({
        id: String(c.index),
        labelKey: c.labelKey,
        command: { type: 'storyletChoice', instanceId, choice: c.index },
        ...(c.available === false ? { disabled: true } : {}),
        ...(typeof c.previewKey === 'string' ? { previewKey: c.previewKey } : {}),
      });
    }
  }
  if (payload.canDefer === true) out.push({ id: 'later', labelKey: 'ui.decision.later', command: { type: 'storyletChoice', instanceId, choice: 'later' }, tone: 'secondary' });
  return out;
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Extracts displayable text and choices from any pending payload. */
export function describePending(p: PendingDecision): { titleKey: string; textKey: string | null; vars: TextVars; choices: PendingChoice[]; illustration: string | null } {
  const payload = rec(p.payload);
  const vars = rec(payload.vars) as TextVars;
  const textKey = [payload.key, payload.textKey, payload.bodyKey].find((k): k is string => typeof k === 'string' && k.length > 0) ?? null;
  const explicitTitle = typeof payload.titleKey === 'string' ? payload.titleKey : null;
  const kindTitle = `ui.decision.kind.${p.kind}`;
  const titleKey = explicitTitle ?? (hasKey(kindTitle) ? kindTitle : 'ui.decision.title');
  const choices: PendingChoice[] = [];
  if (Array.isArray(payload.choices)) {
    for (const raw of payload.choices) {
      const c = rec(raw);
      const command = rec(c.command);
      if (typeof c.id === 'string' && typeof c.labelKey === 'string' && typeof command.type === 'string') {
        choices.push({
          id: c.id,
          labelKey: c.labelKey,
          command: command as unknown as Command,
          ...(c.vars ? { vars: rec(c.vars) as TextVars } : {}),
          ...(c.tone === 'primary' || c.tone === 'danger' || c.tone === 'secondary' ? { tone: c.tone } : {}),
          ...(c.disabled === true ? { disabled: true } : {}),
          ...(typeof c.previewKey === 'string' ? { previewKey: c.previewKey } : {}),
        });
      }
    }
  }
  if (choices.length === 0) choices.push(...storyletChoices(p));
  const illustration = typeof payload.illustration === 'string' && payload.illustration.length > 0 ? payload.illustration : null;
  return { titleKey, textKey, vars, choices, illustration };
}

/**
 * The picture of an event (decision cards, the critical alert box, an opened inbox entry): the final painting
 * for `assetId` (a season's own painting in that season), else the procedural placeholder, 16:9. Nothing when
 * the id is not an image in the manifest. `className` adds the place's own layout (`event-picture` is the base).
 */
export function EventPicture({ assetId, className, testId = 'decision-picture' }: { assetId: string; className?: string; testId?: string }): ReactElement | null {
  const info = useFinalPaintingInfo(assetId);
  const entry = manifestEntry(assetId);
  if (!entry || entry.kind !== 'image') return null;
  return (
    <div className={['event-picture', className ?? 'decision-picture'].join(' ')} data-testid={testId} data-asset-id={assetId} data-final={info ? 'yes' : 'no'} data-variant={info?.variant ?? ''} aria-hidden="true">
      {info ? <img src={info.url} alt="" draggable={false} decoding="async" /> : <AssetImage id={assetId} alt="" fit="cover" />}
    </div>
  );
}

/** The fallback modal for pending kinds without a registered screen. */
export function GenericDecision({ pending }: { pending: PendingDecision }): ReactElement {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const { titleKey, textKey, vars, choices, illustration } = describePending(pending);
  const isMessage = pending.kind === 'message';
  const priority = isMessage ? (rec(pending.payload).priority as string | undefined) : undefined;
  const owner = Object.hasOwn(PENDING_OWNERS, pending.kind) ? PENDING_OWNERS[pending.kind] : undefined;

  const footer = (
    <ButtonRow className={choices.length > 2 ? 'decision-stack' : undefined}>
      {choices.map((c, i) => {
        const button = (
          <Button key={c.id} variant={c.tone ?? (i === 0 ? 'primary' : 'secondary')} disabled={c.disabled} onClick={() => dispatch(c.command)} data-autofocus={i === 0 && !c.disabled ? true : undefined} data-testid={`decision-choice-${c.id}`}>
            {t(c.labelKey, { ...vars, ...c.vars })}
          </Button>
        );
        return c.previewKey ? (
          <Tooltip key={c.id} content={t(c.previewKey, { ...vars, ...c.vars })}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
      {isMessage && choices.length === 0 && (
        <Button variant="primary" icon="check" onClick={() => dispatch({ type: 'acknowledge', pendingId: pending.id })} data-autofocus data-testid="decision-acknowledge">
          {t('ui.decision.acknowledge')}
        </Button>
      )}
    </ButtonRow>
  );

  return (
    <Modal
      open
      layer="decision"
      title={t(titleKey, vars)}
      subtitle={formatGameDate(pending.hour)}
      tone={priority === 'critical' ? 'critical' : priority === 'high' ? 'important' : 'default'}
      footer={footer}
      size="md"
      className={illustration ? 'decision-card has-picture' : 'decision-card'}
      data-testid="generic-decision"
    >
      {illustration && <EventPicture assetId={illustration} />}
      {textKey ? (
        <p className="decision-text">{t(textKey, vars)}</p>
      ) : !isMessage && choices.length === 0 ? (
        <div className="decision-missing">
          <Icon name="hourglass" />
          <p>{t('ui.decision.noScreen', { kind: pending.kind, command: owner?.command ?? '—' })}</p>
        </div>
      ) : null}
      {import.meta.env.DEV && !isMessage && (
        <details className="decision-debug">
          <summary>{t('ui.decision.payload')}</summary>
          <pre>{JSON.stringify(pending, null, 2)}</pre>
        </details>
      )}
    </Modal>
  );
}

/** Hosts the screen (or generic modal) for the current pending decision. */
export function DecisionHost({ registry }: { registry: ScreenRegistry }): ReactElement | null {
  const pending = usePending();
  const mode = useGame((s) => s.state?.meta.mode);
  if (!pending) return null;
  // While the battle is being fought on the field, its Before-the-Battle decision stays pending until
  // the result is applied: the battle scene owns the screen, so no decision layer is shown over it.
  if (pending.kind === 'battleSetup' && mode === 'battle') return null;
  if (pending.kind === 'seaBattle' && mode === 'seaBattle') return null;
  const screen = registry.forPending(pending.kind);
  if (!screen) return <GenericDecision key={pending.id} pending={pending} />;
  const Component = screen.component;
  const layout = screen.layout ?? 'modal';
  return (
    <div className={`pending-host layout-${layout}`} data-focus-scope="modal" data-testid={`pending-${pending.kind}`}>
      <Component key={pending.id} params={{ pendingId: pending.id, kind: pending.kind }} close={() => {}} />
    </div>
  );
}
