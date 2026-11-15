/**
 * Developer console commands (design §29.12; dev builds or the Options toggle). The console never
 * changes game state behind the simulation's back: time passes through `session.advance`, and any
 * change goes through a real sim command (`cmd {json}` dispatches it, logged and replayable). The
 * rest is inspection (state, pending, events, invariants), export and client-only dev flags.
 *
 * `runDevCommand` is pure over a DevContext so it is unit tested without React.
 */
import type { Command } from '@sim/core/commands';
import type { DispatchResult } from '@sim/core/dispatch';
import type { AdvanceResult } from '@sim/core/scheduler';
import type { GameSession } from '@sim/session';
import { HOURS_PER_DAY } from '@sim/core/time';
import type { SimEventBatch } from '../app/simEvents';
import type { ScreenRegistry } from '../app/screenRegistry';
import type { DevFlagsStore } from '../app/devFlags';
import type { TimeSpeed } from '../app/clock';

export type DevTone = 'info' | 'ok' | 'warn' | 'error' | 'data' | 'echo';

/** One output line: a locale key (+vars) or raw data text. */
export type DevLine = { tone: DevTone; key: string; vars?: Record<string, string | number> } | { tone: DevTone; text: string };

export interface DevContext {
  session(): GameSession | null;
  advanceHours(hours: number): AdvanceResult | null;
  dispatch(cmd: Command): DispatchResult | null;
  flags(): Pick<DevFlagsStore, 'revealMap' | 'showIds' | 'forceRealtime'>;
  setFlags(patch: Partial<Pick<DevFlagsStore, 'revealMap' | 'showIds' | 'forceRealtime'>>): void;
  setSpeed(speed: TimeSpeed): void;
  setPaused(paused: boolean): void;
  registry(): ScreenRegistry;
  recentEvents(): readonly SimEventBatch[];
  missingKeys(): string[];
  download(filename: string, text: string, mime: string): void;
  formatDate(hour: number): string;
}

export interface DevCommandDef {
  name: string;
  aliases?: string[];
  /** Usage string (syntax, not prose). */
  usage: string;
  /** Locale key of the description. */
  descKey: string;
  needsGame?: boolean;
  run(args: string[], ctx: DevContext, raw: string): DevLine[];
}

const ok = (key: string, vars?: Record<string, string | number>): DevLine => ({ tone: 'ok', key, ...(vars ? { vars } : {}) });
const info = (key: string, vars?: Record<string, string | number>): DevLine => ({ tone: 'info', key, ...(vars ? { vars } : {}) });
const warn = (key: string, vars?: Record<string, string | number>): DevLine => ({ tone: 'warn', key, ...(vars ? { vars } : {}) });
const err = (key: string, vars?: Record<string, string | number>): DevLine => ({ tone: 'error', key, ...(vars ? { vars } : {}) });
const data = (text: string): DevLine => ({ tone: 'data', text });

/** Max characters printed for one JSON dump (export for more). */
export const DUMP_LIMIT = 6000;

/** Reads a dotted path ("player.house.renown", "characters.chr_1.skills") from a value. */
export function readPath(root: unknown, path: string): { found: boolean; value: unknown } {
  if (path === '' || path === '.') return { found: true, value: root };
  let cur: unknown = root;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return { found: false, value: undefined };
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
      cur = cur[i];
    } else {
      if (!Object.hasOwn(cur, part)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return { found: true, value: cur };
}

/** Pretty JSON, truncated to DUMP_LIMIT characters. */
export function dump(value: unknown, limit = DUMP_LIMIT): string {
  const s = JSON.stringify(value, null, 2) ?? String(value);
  return s.length > limit ? `${s.slice(0, limit)}\n… (${s.length - limit} more characters; use 'export')` : s;
}

function onOff(arg: string | undefined, current: boolean): boolean | null {
  if (arg === undefined || arg === 'toggle') return !current;
  if (['on', 'true', '1', 'yes'].includes(arg)) return true;
  if (['off', 'false', '0', 'no'].includes(arg)) return false;
  return null;
}

function advanceDays(ctx: DevContext, hours: number): DevLine[] {
  const session = ctx.session();
  if (!session) return [err('ui.dev.out.noGame')];
  if (session.getState().pending) return [warn('ui.dev.out.pendingBlocks', { kind: session.getState().pending?.kind ?? '' })];
  const from = session.getState().time.hour;
  const r = ctx.advanceHours(hours);
  if (!r) return [err('ui.dev.out.advanceFailed')];
  const out: DevLine[] = [ok('ui.dev.out.advanced', { hours: r.hoursAdvanced, date: ctx.formatDate(session.getState().time.hour), from: ctx.formatDate(from) })];
  if (r.pending) out.push(warn('ui.dev.out.stoppedAtPending', { kind: r.pending.kind }));
  return out;
}

export const DEV_COMMANDS: readonly DevCommandDef[] = [
  {
    name: 'help',
    aliases: ['?'],
    usage: 'help [command]',
    descKey: 'ui.dev.cmd.help',
    run(args) {
      const name = args[0];
      if (name) {
        const def = findCommand(name);
        if (!def) return [err('ui.dev.out.unknown', { name })];
        return [data(def.usage), { tone: 'info', key: def.descKey }];
      }
      return [info('ui.dev.out.helpIntro'), ...DEV_COMMANDS.map((c) => ({ tone: 'data' as const, key: 'ui.dev.out.helpLine', vars: { usage: c.usage.padEnd(28, ' '), desc: c.descKey } }))];
    },
  },
  {
    name: 'state',
    usage: 'state [path]',
    descKey: 'ui.dev.cmd.state',
    needsGame: true,
    run(args, ctx) {
      const st = ctx.session()?.getState();
      const path = args[0] ?? '';
      if (path === '') {
        const summary: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(st ?? {})) summary[k] = v !== null && typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`) : v;
        return [data(dump(summary))];
      }
      const r = readPath(st, path);
      return r.found ? [data(dump(r.value))] : [err('ui.dev.out.noPath', { path })];
    },
  },
  {
    name: 'seed',
    usage: 'seed',
    descKey: 'ui.dev.cmd.seed',
    needsGame: true,
    run(_args, ctx) {
      const st = ctx.session()?.getState();
      return [ok('ui.dev.out.seed', { seed: st?.meta.seed ?? '', difficulty: st?.meta.difficulty ?? '' })];
    },
  },
  {
    name: 'date',
    usage: 'date',
    descKey: 'ui.dev.cmd.date',
    needsGame: true,
    run(_args, ctx) {
      const hour = ctx.session()?.getState().time.hour ?? 0;
      return [ok('ui.dev.out.date', { date: ctx.formatDate(hour), hour })];
    },
  },
  {
    name: 'advance',
    aliases: ['days'],
    usage: 'advance <days>',
    descKey: 'ui.dev.cmd.advance',
    needsGame: true,
    run(args, ctx) {
      const days = Number(args[0] ?? '1');
      if (!Number.isInteger(days) || days <= 0 || days > 3600) return [err('ui.dev.out.badNumber', { value: args[0] ?? '' })];
      return advanceDays(ctx, days * HOURS_PER_DAY);
    },
  },
  {
    name: 'hours',
    usage: 'hours <n>',
    descKey: 'ui.dev.cmd.hours',
    needsGame: true,
    run(args, ctx) {
      const hours = Number(args[0] ?? '1');
      if (!Number.isInteger(hours) || hours <= 0 || hours > 86400) return [err('ui.dev.out.badNumber', { value: args[0] ?? '' })];
      return advanceDays(ctx, hours);
    },
  },
  {
    name: 'wait',
    usage: 'wait <days> | wait event',
    descKey: 'ui.dev.cmd.wait',
    needsGame: true,
    run(args, ctx) {
      const cmd: Command = args[0] === 'event' ? { type: 'wait', untilEvent: true } : { type: 'wait', days: Number(args[0] ?? '1') };
      const r = ctx.dispatch(cmd);
      if (!r) return [err('ui.dev.out.dispatchCrashed')];
      if (r.error) return [err('ui.dev.out.rejected', { code: r.error.code, message: r.error.message })];
      return [ok('ui.dev.out.dispatched', { type: 'wait', events: r.events.length })];
    },
  },
  {
    name: 'cmd',
    usage: 'cmd {"type":"…", …}',
    descKey: 'ui.dev.cmd.cmd',
    needsGame: true,
    run(_args, ctx, raw) {
      const json = raw.replace(/^\s*cmd\s*/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (e) {
        return [err('ui.dev.out.badJson', { message: e instanceof Error ? e.message : String(e) })];
      }
      if (parsed === null || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') return [err('ui.dev.out.notCommand')];
      const r = ctx.dispatch(parsed as Command);
      if (!r) return [err('ui.dev.out.dispatchCrashed')];
      if (r.error) return [err('ui.dev.out.rejected', { code: r.error.code, message: r.error.message })];
      return [ok('ui.dev.out.dispatched', { type: (parsed as { type: string }).type, events: r.events.length })];
    },
  },
  {
    name: 'pending',
    usage: 'pending',
    descKey: 'ui.dev.cmd.pending',
    needsGame: true,
    run(_args, ctx) {
      const st = ctx.session()?.getState();
      if (!st?.pending) return [info('ui.dev.out.noPending')];
      return [data(dump({ pending: st.pending, queued: st.pendingQueue.length }))];
    },
  },
  {
    name: 'events',
    usage: 'events [n]',
    descKey: 'ui.dev.cmd.events',
    run(args, ctx) {
      const n = Math.max(1, Math.min(200, Number(args[0] ?? '20') || 20));
      const all = ctx.recentEvents().flatMap((b) => b.events.map((e) => ({ origin: b.origin, hour: b.state.time.hour, event: e })));
      if (all.length === 0) return [info('ui.dev.out.noEvents')];
      return all.slice(-n).map((x) => data(`${ctx.formatDate(x.hour)} [${x.origin}] ${JSON.stringify(x.event)}`));
    },
  },
  {
    name: 'fog',
    usage: 'fog on|off',
    descKey: 'ui.dev.cmd.fog',
    run(args, ctx) {
      // "fog off" reveals the map, so the flag is the inverse of fog.
      const fogOn = onOff(args[0], !ctx.flags().revealMap);
      if (fogOn === null) return [err('ui.dev.out.onOff')];
      ctx.setFlags({ revealMap: !fogOn });
      return [ok(fogOn ? 'ui.dev.out.fogOn' : 'ui.dev.out.fogOff')];
    },
  },
  {
    name: 'ids',
    usage: 'ids on|off',
    descKey: 'ui.dev.cmd.ids',
    run(args, ctx) {
      const v = onOff(args[0], ctx.flags().showIds);
      if (v === null) return [err('ui.dev.out.onOff')];
      ctx.setFlags({ showIds: v });
      return [ok('ui.dev.out.flag', { flag: 'showIds', value: String(v) })];
    },
  },
  {
    name: 'clock',
    usage: 'clock on|off',
    descKey: 'ui.dev.cmd.clock',
    run(args, ctx) {
      const v = onOff(args[0], ctx.flags().forceRealtime);
      if (v === null) return [err('ui.dev.out.onOff')];
      ctx.setFlags({ forceRealtime: v });
      return [ok('ui.dev.out.flag', { flag: 'forceRealtime', value: String(v) })];
    },
  },
  {
    name: 'speed',
    usage: 'speed 1|2|4',
    descKey: 'ui.dev.cmd.speed',
    needsGame: true,
    run(args, ctx) {
      const s = Number(args[0]);
      if (s !== 1 && s !== 2 && s !== 4) return [err('ui.dev.out.badNumber', { value: args[0] ?? '' })];
      ctx.setSpeed(s);
      return [ok('ui.dev.out.speed', { speed: s })];
    },
  },
  {
    name: 'pause',
    usage: 'pause | resume',
    aliases: ['resume'],
    descKey: 'ui.dev.cmd.pause',
    needsGame: true,
    run(_args, ctx, raw) {
      const resume = raw.trim().startsWith('resume');
      ctx.setPaused(!resume);
      return [ok(resume ? 'ui.dev.out.resumed' : 'ui.dev.out.paused')];
    },
  },
  {
    name: 'export',
    usage: 'export [state|save|log]',
    descKey: 'ui.dev.cmd.export',
    needsGame: true,
    run(args, ctx) {
      const session = ctx.session();
      if (!session) return [err('ui.dev.out.noGame')];
      const what = args[0] ?? 'state';
      const st = session.getState();
      const stamp = `${st.meta.seed}-h${st.time.hour}`;
      if (what === 'state') ctx.download(`bardia-state-${stamp}.json`, JSON.stringify(st, null, 2), 'application/json');
      else if (what === 'save') ctx.download(`bardia-${stamp}.bardia`, session.save(), 'text/plain');
      else if (what === 'log') ctx.download(`bardia-replay-${stamp}.json`, JSON.stringify({ options: session.newGameOptions ?? null, log: session.commandLog }, null, 2), 'application/json');
      else return [err('ui.dev.out.exportWhat', { what })];
      return [ok('ui.dev.out.exported', { what })];
    },
  },
  {
    name: 'check',
    usage: 'check',
    descKey: 'ui.dev.cmd.check',
    needsGame: true,
    run(_args, ctx) {
      const session = ctx.session();
      if (!session) return [err('ui.dev.out.noGame')];
      const st = session.getState();
      const problems: string[] = [];
      for (const m of session.env.modules) {
        if (!m.invariants) continue;
        try {
          for (const v of m.invariants(st)) problems.push(`${m.id}: ${v}`);
        } catch (e) {
          problems.push(`${m.id}: invariants threw ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (problems.length === 0) return [ok('ui.dev.out.invariantsOk', { modules: session.env.modules.length })];
      return [warn('ui.dev.out.invariantsBad', { count: problems.length }), ...problems.slice(0, 50).map(data)];
    },
  },
  {
    name: 'modules',
    usage: 'modules',
    descKey: 'ui.dev.cmd.modules',
    needsGame: true,
    run(_args, ctx) {
      const session = ctx.session();
      if (!session) return [err('ui.dev.out.noGame')];
      return session.env.modules.map((m) => data(`${String(m.order).padStart(6)}  ${m.id.padEnd(12)} v${m.version ?? 0}`));
    },
  },
  {
    name: 'screens',
    usage: 'screens',
    descKey: 'ui.dev.cmd.screens',
    run(_args, ctx) {
      const reg = ctx.registry();
      const lines = reg.screens.map((s) => data(`${s.id.padEnd(18)} modes=[${s.modes.join(',')}] pending=[${s.pending.join(',')}] routes=[${s.routes.join(',')}] p=${s.priority}`));
      return [...lines, ...reg.problems.map((p) => ({ tone: 'warn' as const, text: p }))];
    },
  },
  {
    name: 'keys',
    usage: 'keys',
    descKey: 'ui.dev.cmd.keys',
    run(_args, ctx) {
      const keys = ctx.missingKeys();
      return keys.length === 0 ? [ok('ui.dev.out.noMissingKeys')] : [warn('ui.dev.out.missingKeys', { count: keys.length }), ...keys.map(data)];
    },
  },
  {
    name: 'log',
    usage: 'log',
    descKey: 'ui.dev.cmd.log',
    needsGame: true,
    run(_args, ctx) {
      const session = ctx.session();
      if (!session) return [err('ui.dev.out.noGame')];
      const log = session.commandLog;
      return [info('ui.dev.out.logSize', { count: log.length }), ...log.slice(-15).map((e) => data(e.kind === 'command' ? `h${e.hour} ${JSON.stringify(e.command)}` : `h${e.hour} advance ${e.hours}h`))];
    },
  },
];

/** Finds a command by name or alias. */
export function findCommand(name: string): DevCommandDef | undefined {
  const n = name.toLowerCase();
  return DEV_COMMANDS.find((c) => c.name === n || (c.aliases ?? []).includes(n));
}

/** Splits a command line into words (double quotes group words). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? '');
  return out;
}

/** Command names matching a prefix (Tab completion). */
export function complete(prefix: string): string[] {
  const p = prefix.toLowerCase();
  return DEV_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]).filter((n) => n.startsWith(p) && n !== '?');
}

/** Runs one console line. */
export function runDevCommand(line: string, ctx: DevContext): DevLine[] {
  const words = tokenize(line);
  const name = words[0];
  if (!name) return [];
  const def = findCommand(name);
  if (!def) return [err('ui.dev.out.unknown', { name })];
  if (def.needsGame && !ctx.session()) return [err('ui.dev.out.noGame')];
  try {
    return def.run(words.slice(1), ctx, line);
  } catch (e) {
    return [err('ui.dev.out.crashed', { message: e instanceof Error ? e.message : String(e) })];
  }
}
