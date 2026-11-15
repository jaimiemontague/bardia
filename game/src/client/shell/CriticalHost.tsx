/**
 * Critical notifications (§25.9: holding attacked, captured, death) appear as modals, oldest first,
 * until acknowledged; they also auto-pause per settings (services.ts). "Go to" follows the link. An alert with an
 * `illustration` (the house fallen, a fleet lost to a storm, the ruler's death) is a wider card with its picture
 * under the title, like the decision cards (DecisionHost EventPicture).
 */
import type { ReactElement } from 'react';
import { followLink, linkLabelKey } from '../app/links';
import { manifestEntry } from '../assets/index';
import { useNotifications } from '../app/notifications';
import { formatGameDate } from '../i18n/calendar';
import { useT } from '../i18n/index';
import { Button, ButtonRow, Icon, Modal } from '../ui/index';
import { EventPicture } from './DecisionHost';

/** Shows the oldest unacknowledged Critical notification. */
export function CriticalHost(): ReactElement | null {
  const t = useT();
  const first = useNotifications((s) => s.critical[0]);
  const remaining = useNotifications((s) => s.critical.length);
  const acknowledge = useNotifications((s) => s.acknowledgeCritical);
  if (!first) return null;
  const close = () => acknowledge(first.id);
  const picture = first.illustration !== undefined && manifestEntry(first.illustration)?.kind === 'image' ? first.illustration : undefined;
  return (
    <Modal
      open
      tone="critical"
      title={t('ui.notify.criticalTitle')}
      subtitle={formatGameDate(first.hour)}
      onClose={close}
      size={picture ? 'md' : 'sm'}
      {...(picture ? { className: 'decision-card has-picture' } : {})}
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
      {picture && <EventPicture assetId={picture} />}
      <div className="critical-body">
        {!picture && <Icon name="critical" size={2.2} className="tone-bad" />}
        <p>{t(first.key, first.vars)}</p>
      </div>
    </Modal>
  );
}
