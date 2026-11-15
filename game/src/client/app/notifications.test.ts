import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '@sim/core/events';
import { INBOX_LIMIT, TOAST_LIMIT, tierOf, unreadCount, useNotifications } from './notifications';

const note = (priority: 'low' | 'normal' | 'high' | 'critical', key = 'core.test'): SimEvent => ({ type: 'Notification', priority, key, vars: {} });

describe('notifications (§25.9)', () => {
  beforeEach(() => useNotifications.getState().clear());

  it('maps simulation priorities onto Critical / Important / Info', () => {
    expect(tierOf('critical')).toBe('critical');
    expect(tierOf('high')).toBe('important');
    expect(tierOf('normal')).toBe('info');
    expect(tierOf('low')).toBe('info');
  });

  it('feeds every tier into the inbox, toasts Important ones and queues Critical modals', () => {
    const fresh = useNotifications.getState().ingest([note('low'), note('high', 'core.envoy'), note('critical', 'core.attack'), { type: 'DayStarted', hour: 24, year: 812, monthIndex: 0, day: 2 }], 24);
    expect(fresh).toHaveLength(3);
    const s = useNotifications.getState();
    expect(s.inbox.map((n) => n.tier)).toEqual(['critical', 'important', 'info']);
    expect(s.toasts.map((t) => t.key)).toEqual(['core.envoy']);
    expect(s.critical.map((n) => n.key)).toEqual(['core.attack']);
    expect(unreadCount(s.inbox)).toBe(3);
  });

  it('acknowledging a Critical one marks it read and dequeues it', () => {
    useNotifications.getState().ingest([note('critical'), note('critical', 'core.two')], 0);
    const first = useNotifications.getState().critical[0];
    if (!first) throw new Error('missing');
    useNotifications.getState().acknowledgeCritical(first.id);
    const s = useNotifications.getState();
    expect(s.critical.map((n) => n.key)).toEqual(['core.two']);
    expect(s.inbox.find((n) => n.id === first.id)?.read).toBe(true);
  });

  it('caps the inbox and the toast stack', () => {
    const many = Array.from({ length: INBOX_LIMIT + 20 }, () => note('normal'));
    useNotifications.getState().ingest(many, 0);
    expect(useNotifications.getState().inbox).toHaveLength(INBOX_LIMIT);
    for (let i = 0; i < TOAST_LIMIT + 3; i++) useNotifications.getState().pushToast('ui.toast.saved', { vars: { name: String(i) } });
    expect(useNotifications.getState().toasts).toHaveLength(TOAST_LIMIT);
    useNotifications.getState().markAllRead();
    expect(unreadCount(useNotifications.getState().inbox)).toBe(0);
  });
});
