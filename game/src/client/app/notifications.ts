/**
 * Notifications (design §25.9): Notification events become inbox entries with three tiers.
 *   Critical  (sim priority 'critical')        → modal + auto-pause (setting) + feed
 *   Important (sim priority 'high')            → toast + feed, auto-pause optional
 *   Info      (sim priority 'normal' | 'low')  → feed only
 * The inbox keeps everything (capped) with links ("Go to …"). System toasts (saved, errors) share
 * the toast stack.
 */
import { create } from 'zustand';
import type { EntityLink, SimEvent } from '@sim/core/events';
import type { Hour, NotificationPriority, TextVars } from '@sim/core/state';

export type NotificationTier = 'critical' | 'important' | 'info';

/** Maps a simulation priority onto the §25.9 tiers. */
export function tierOf(priority: NotificationPriority): NotificationTier {
  switch (priority) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'important';
    default:
      return 'info';
  }
}

export interface GameNotification {
  id: number;
  tier: NotificationTier;
  priority: NotificationPriority;
  key: string;
  vars: TextVars;
  link?: EntityLink;
  hour: Hour;
  read: boolean;
}

export type ToastTone = 'info' | 'success' | 'warning' | 'danger' | 'important';

export interface Toast {
  id: number;
  key: string;
  vars?: TextVars;
  tone: ToastTone;
  /** Inbox entry the toast mirrors (opens it on click). */
  notificationId?: number;
  link?: EntityLink;
  /** Milliseconds before it fades (0 = until dismissed). */
  ttlMs: number;
}

/** Inbox cap (oldest entries drop off). */
export const INBOX_LIMIT = 300;
/** Toasts visible at once. */
export const TOAST_LIMIT = 4;

export interface NotificationStore {
  /** Newest first. */
  inbox: GameNotification[];
  toasts: Toast[];
  /** Critical notifications awaiting acknowledgement (shown as modals, oldest first). */
  critical: GameNotification[];
  /** Turns Notification events into entries; returns the new entries. */
  ingest(events: readonly SimEvent[], hour: Hour): GameNotification[];
  markRead(id: number): void;
  markAllRead(): void;
  acknowledgeCritical(id: number): void;
  pushToast(key: string, opts?: { vars?: TextVars; tone?: ToastTone; ttlMs?: number; link?: EntityLink }): number;
  dismissToast(id: number): void;
  clear(): void;
}

let seq = 1;

export const useNotifications = create<NotificationStore>()((set, get) => ({
  inbox: [],
  toasts: [],
  critical: [],

  ingest(events, hour) {
    const fresh: GameNotification[] = [];
    for (const e of events) {
      if (e.type !== 'Notification') continue;
      const n: GameNotification = {
        id: seq++,
        tier: tierOf(e.priority),
        priority: e.priority,
        key: e.key,
        vars: e.vars ?? {},
        hour,
        read: false,
        ...(e.link ? { link: e.link } : {}),
      };
      fresh.push(n);
    }
    if (fresh.length === 0) return fresh;
    set((s) => {
      const inbox = [...fresh.slice().reverse(), ...s.inbox].slice(0, INBOX_LIMIT);
      const critical = [...s.critical, ...fresh.filter((n) => n.tier === 'critical')];
      const newToasts: Toast[] = fresh
        .filter((n) => n.tier === 'important')
        .map((n) => ({ id: seq++, key: n.key, vars: n.vars, tone: 'important' as const, notificationId: n.id, ttlMs: 7000, ...(n.link ? { link: n.link } : {}) }));
      const toasts = [...s.toasts, ...newToasts].slice(-TOAST_LIMIT);
      return { inbox, critical, toasts };
    });
    return fresh;
  },

  markRead(id) {
    set((s) => ({ inbox: s.inbox.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)) }));
  },

  markAllRead() {
    set((s) => ({ inbox: s.inbox.map((n) => (n.read ? n : { ...n, read: true })) }));
  },

  acknowledgeCritical(id) {
    set((s) => ({ critical: s.critical.filter((n) => n.id !== id) }));
    get().markRead(id);
  },

  pushToast(key, opts = {}) {
    const id = seq++;
    const toast: Toast = { id, key, tone: opts.tone ?? 'info', ttlMs: opts.ttlMs ?? 4000, ...(opts.vars ? { vars: opts.vars } : {}), ...(opts.link ? { link: opts.link } : {}) };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-TOAST_LIMIT) }));
    return id;
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clear() {
    set({ inbox: [], toasts: [], critical: [] });
  },
}));

/** Unread inbox entries. */
export function unreadCount(inbox: readonly GameNotification[]): number {
  let n = 0;
  for (const e of inbox) if (!e.read) n++;
  return n;
}
