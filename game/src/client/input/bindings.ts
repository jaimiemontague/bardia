/**
 * Input actions and their default key bindings (design §25.6; all rebindable, §25.7).
 *
 * A binding is a KeyboardEvent.code with optional modifiers, written "Ctrl+Shift+KeyS" (layout
 * independent, so rebinding survives keyboard layouts). Each action belongs to a context; the
 * shortcut manager prefers the most specific active context (battle beats global for "1"…"3",
 * "F"), so screens never fight over keys.
 */

/** Where an action is live. 'global' is always live (except where noted by `outsideBattles`). */
export type InputContext = 'global' | 'map' | 'battle' | 'duel' | 'menu';

export interface ActionDef {
  id: string;
  context: InputContext;
  /** Default bindings (KeyboardEvent.code with modifiers). */
  defaults: readonly string[];
  /** Locale key for the action label in the rebinding UI. */
  labelKey: string;
  /** Global actions that are disabled while a battle/duel is on screen (§25.6 "outside battles"). */
  outsideBattles?: boolean;
  /** Fixed actions cannot be rebound (e.g. the dev console key is shown but locked). */
  fixed?: boolean;
}

function action(id: string, context: InputContext, defaults: string[], extra: Partial<ActionDef> = {}): ActionDef {
  return { id, context, defaults, labelKey: `ui.action.${id}`, ...extra };
}

/** Every action the shell knows about, in rebinding-UI order. Screens may handle any of them. */
export const ACTIONS: readonly ActionDef[] = [
  action('time.togglePause', 'global', ['Space']),
  action('time.speed1', 'global', ['Digit1']),
  action('time.speed2', 'global', ['Digit2']),
  action('time.speed4', 'global', ['Digit3']),
  action('time.slower', 'global', ['Minus', 'NumpadSubtract']),
  action('time.faster', 'global', ['Equal', 'NumpadAdd']),
  action('open.codex', 'global', ['F1']),
  action('open.character', 'global', ['KeyC'], { outsideBattles: true }),
  action('open.family', 'global', ['KeyF'], { outsideBattles: true }),
  action('open.ledger', 'global', ['KeyL'], { outsideBattles: true }),
  action('open.chronicle', 'global', ['KeyJ'], { outsideBattles: true }),
  action('open.sagaLedger', 'global', ['KeyG'], { outsideBattles: true }),
  action('open.inbox', 'global', ['KeyI'], { outsideBattles: true }),
  action('game.quicksave', 'global', ['F5']),
  action('ui.back', 'global', ['Escape']),
  action('dev.console', 'global', ['Backquote'], { fixed: true }),
  action('map.returnHome', 'map', ['KeyH']),
  action('map.landfall', 'map', ['KeyB']),
  action('battle.squad1', 'battle', ['Digit1']),
  action('battle.squad2', 'battle', ['Digit2']),
  action('battle.squad3', 'battle', ['Digit3']),
  action('battle.squad4', 'battle', ['Digit4']),
  action('battle.squad5', 'battle', ['Digit5']),
  action('battle.squad6', 'battle', ['Digit6']),
  action('battle.squad7', 'battle', ['Digit7']),
  action('battle.squad8', 'battle', ['Digit8']),
  action('battle.cycleFormation', 'battle', ['KeyF']),
  action('battle.shieldWall', 'battle', ['KeyQ']),
  // Direct control (owner play-test 2026-11-15): W A S D / arrows move, Space attacks, P pauses. The battle
  // scenes read these keys themselves, so they are listed here for the Options screen and cannot be rebound yet.
  action('battle.charge', 'battle', ['Space'], { fixed: true }),
  action('battle.pause', 'battle', ['KeyP'], { fixed: true }),
  action('battle.torchVolley', 'battle', ['KeyE']),
  action('battle.rally', 'battle', ['KeyR']),
  action('battle.challenge', 'battle', ['KeyT']),
  action('battle.retreat', 'battle', ['Backspace']),
];

/** Action id → definition. */
export const ACTION_BY_ID: Readonly<Record<string, ActionDef>> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

/** Default bindings for every action. */
export function defaultBindings(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of ACTIONS) out[a.id] = [...a.defaults];
  return out;
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

/** Canonical combo string for a keyboard event ("Ctrl+KeyS"); modifier keys alone return ''. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  if (/^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(e.code) || e.code === '') return '';
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, e.code].join('+');
}

/** Normalises a combo string (modifier order, whitespace) so stored bindings compare reliably. */
export function normalizeCombo(combo: string): string {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const code = parts.filter((p) => !(MODIFIER_ORDER as readonly string[]).includes(p)).pop() ?? '';
  const mods = MODIFIER_ORDER.filter((m) => parts.includes(m));
  return code === '' ? '' : [...mods, code].join('+');
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  Backquote: '`',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Minus: '-',
  Equal: '=',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
};

/** Human label for a combo ("Ctrl+S", "Space", "1", "F1"). */
export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      if (Object.hasOwn(CODE_LABELS, part)) return CODE_LABELS[part] as string;
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      if (/^Numpad[0-9]$/.test(part)) return `Num ${part.slice(6)}`;
      return part;
    })
    .join('+');
}

/**
 * Bindings that collide inside one context (or between a context and 'global' where both are
 * live). Returns combo → action ids for every combo bound to more than one action.
 */
export function findConflicts(bindings: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const byContext: Record<string, Record<string, string[]>> = {};
  for (const a of ACTIONS) {
    for (const combo of bindings[a.id] ?? []) {
      const ctxs = a.context === 'global' ? ['global'] : [a.context];
      for (const c of ctxs) {
        const table = (byContext[c] ??= {});
        (table[combo] ??= []).push(a.id);
      }
    }
  }
  const out: Record<string, string[]> = {};
  for (const table of Object.values(byContext)) {
    for (const [combo, ids] of Object.entries(table)) {
      if (ids.length > 1) out[combo] = [...new Set([...(out[combo] ?? []), ...ids])];
    }
  }
  return out;
}
