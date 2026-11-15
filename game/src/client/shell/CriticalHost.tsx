/**
 * Critical notifications (§25.9: holding attacked, captured, death) appear as modals, oldest first,
 * until acknowledged; they also auto-pause per settings (services.ts). "Go to" follows the link.
 */
import type { ReactElement } from 'react';
import { followLink, linkLabelKey } from '../app/links';
import { useNotifications } from '../app/notifications';
import { formatGameDate } from '../i18n/calendar';
import { useT } from '../i18n/index';
import { Button, ButtonRow, Icon, Modal } from '../ui/index';

/** Shows the oldest unacknowledged Critical notification. */
export function CriticalHost(): ReactElement | null {
  const t = useT();
  const first = useNotifications((s) => s.critical[0]);
  const remaining = useNotifications((s) => s.critical.length);
  const acknowledge = useNotifications((s) => s.acknowledgeCritical);
  if (!first) return null;
  const close = () => acknowledge(first.id);
  return (
    <Modal
      open
      tone="critical"
      title={t('ui.notify.criticalTitle')}
      subtitle={formatGameDate(first.hour)}
      onClose={close}
      size="sm"
      data-testid="critical-modal"
      footer={
        <ButtonRow>
          {remaining > 1 && <span className="muted">{t('ui.notify.moreCritical', { count: remaining - 1 })}</span>}
          {first.link && (
            <Button
              icon="link"
              onClick={() => {
                close();
                if (first.link) followLink(first.link);
              }}
            >
              {t(linkLabelKey(first.link))}
            </Button>
          )}
          <Button variant="primary" icon="check" onClick={close} data-autofocus>
            {t('ui.decision.acknowledge')}
          </Button>
        </ButtonRow>
      }
    >
      <div className="critical-body">
        <Icon name="critical" size={2.2} className="tone-bad" />
        <p>{t(first.key, first.vars)}</p>
      </div>
    </Modal>
  );
}
