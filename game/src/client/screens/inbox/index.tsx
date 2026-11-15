/**
 * The inbox (§25.9: "keeps everything with links"): every notification, newest first, in large type (ARCHITECTURE
 * §20), with read state and "Go to" links. One filter: everything, or only what is unread. Opened from the top
 * bar (I) or by clicking a feed chip or toast (which focuses that entry).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { followLink, linkLabelKey } from '../../app/links';
import { unreadCount, useNotifications, type GameNotification } from '../../app/notifications';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatGameDate } from '../../i18n/calendar';
import { useT } from '../../i18n/index';
import { TIER_ICON } from '../../shell/NotificationFeed';
import { Button, Frame, Icon, IconButton, ScrollArea, Segmented } from '../../ui/index';
import './inbox.css';

type Filter = 'all' | 'unread';

function InboxScreen({ params, close }: ScreenProps): ReactElement {
  const t = useT();
  const inbox = useNotifications((s) => s.inbox);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const [filter, setFilter] = useState<Filter>('all');
  const focusId = typeof params?.focus === 'number' ? params.focus : null;
  const focusRef = useRef<HTMLLIElement>(null);
  const items = useMemo(() => inbox.filter((n) => filter === 'all' || !n.read), [inbox, filter]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
    focusRef.current?.focus();
  }, [focusId]);

  const go = (n: GameNotification) => {
    markRead(n.id);
    if (n.link) {
      close();
      followLink(n.link);
    }
  };

  return (
    <div className="inbox-overlay">
      <Frame
        className="inbox-frame"
        title={t('ui.route.inbox')}
        subtitle={t('ui.inbox.unread', { count: unreadCount(inbox) })}
        ornate
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon="check"
              onClick={markAllRead}
              disabled={unreadCount(inbox) === 0}
            >
              {t('ui.inbox.markAll')}
            </Button>
            <IconButton
              icon="close"
              label={t('ui.common.close')}
              keyHint="ui.back"
              onClick={close}
              data-testid="inbox-close"
            />
          </>
        }
        data-testid="inbox"
      >
        <Segmented<Filter>
          label={t('ui.inbox.filter')}
          hideLabel
          value={filter}
          onChange={setFilter}
          options={(['all', 'unread'] as const).map((f) => ({ value: f, label: t(`ui.inbox.filter.${f}`) }))}
        />
        <ScrollArea label={t('ui.route.inbox')} className="inbox-scroll">
          {items.length === 0 ? (
            <div className="empty-state">
              <Icon name="inbox" />
              {t('ui.inbox.empty')}
            </div>
          ) : (
            <ol className="inbox-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  ref={n.id === focusId ? focusRef : undefined}
                  tabIndex={n.id === focusId ? -1 : undefined}
                  className={[
                    'inbox-item',
                    `tier-${n.tier}`,
                    n.read && 'is-read',
                    n.id === focusId && 'is-focus',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => !n.read && markRead(n.id)}
                >
                  <Icon
                    name={TIER_ICON[n.tier]}
                    label={t(`ui.notify.tier.${n.tier}`)}
                    className="inbox-icon"
                  />
                  <div className="inbox-text">
                    <span className="inbox-body">{t(n.key, n.vars)}</span>
                    <span className="inbox-meta">
                      {formatGameDate(n.hour)} · {t(`ui.notify.tier.${n.tier}`)}
                    </span>
                  </div>
                  {n.link && (
                    <Button icon="link" onClick={() => go(n)}>
                      {t(linkLabelKey(n.link))}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </ScrollArea>
      </Frame>
    </div>
  );
}

export const screen: ScreenDescriptor = {
  id: 'inbox',
  route: 'inbox',
  component: InboxScreen,
  layout: 'overlay',
  titleKey: 'ui.route.inbox',
};
