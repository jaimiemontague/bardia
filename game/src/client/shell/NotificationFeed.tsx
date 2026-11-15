/**
 * The notification feed (§25.1 bottom, §25.9): the latest entries as compact chips with tier icons
 * (icons accompany the colours); clicking one opens the inbox at that entry.
 */
import type { ReactElement } from 'react';
import { navigation } from '../app/navigation';
import { useNotifications, type GameNotification, type NotificationTier } from '../app/notifications';
import { useT } from '../i18n/index';
import { Icon, Tooltip, type IconName } from '../ui/index';
import { formatGameDate } from '../i18n/calendar';

export const TIER_ICON: Readonly<Record<NotificationTier, IconName>> = { critical: 'critical', important: 'important', info: 'info' };

/** Compact chip for one notification. */
export function FeedChip({ n, onOpen }: { n: GameNotification; onOpen(n: GameNotification): void }): ReactElement {
  const t = useT();
  const text = t(n.key, n.vars);
  return (
    <Tooltip content={`${formatGameDate(n.hour)} · ${text}`} placement="top">
      <button type="button" className={['feed-chip', `tier-${n.tier}`, n.read && 'is-read'].filter(Boolean).join(' ')} onClick={() => onOpen(n)} data-testid="feed-chip">
        <Icon name={TIER_ICON[n.tier]} label={t(`ui.notify.tier.${n.tier}`)} />
        <span className="feed-chip-text">{text}</span>
      </button>
    </Tooltip>
  );
}

/** The latest few notifications. */
export function NotificationFeed({ limit = 3 }: { limit?: number }): ReactElement {
  const t = useT();
  const inbox = useNotifications((s) => s.inbox);
  const markRead = useNotifications((s) => s.markRead);
  const items = inbox.slice(0, limit);
  const open = (n: GameNotification) => {
    markRead(n.id);
    navigation.open('inbox', { focus: n.id });
  };
  return (
    <div className="feed" aria-label={t('ui.notify.feed')} role="log" data-testid="feed">
      {items.length === 0 ? <span className="feed-empty">{t('ui.notify.empty')}</span> : items.map((n) => <FeedChip key={n.id} n={n} onOpen={open} />)}
    </div>
  );
}
