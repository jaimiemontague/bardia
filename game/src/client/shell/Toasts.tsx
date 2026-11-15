/**
 * Toasts (§25.9 Important notifications, plus system messages: saved, errors). Auto-dismiss after
 * their TTL (paused while hovered or focused); Important toasts open the inbox entry on click.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { followLink } from '../app/links';
import { navigation } from '../app/navigation';
import { useNotifications, type Toast as ToastData, type ToastTone } from '../app/notifications';
import { useT } from '../i18n/index';
import { Icon, IconButton, type IconName } from '../ui/index';

const TONE_ICON: Readonly<Record<ToastTone, IconName>> = { info: 'info', success: 'check', warning: 'warning', danger: 'critical', important: 'important' };

function ToastItem({ toast }: { toast: ToastData }): ReactElement {
  const t = useT();
  const dismiss = useNotifications((s) => s.dismissToast);
  const markRead = useNotifications((s) => s.markRead);
  const [hold, setHold] = useState(false);
  const remaining = useRef(toast.ttlMs);
  useEffect(() => {
    if (toast.ttlMs <= 0 || hold) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(400, remaining.current - (Date.now() - started));
    };
  }, [toast.id, toast.ttlMs, hold, dismiss]);

  const clickable = toast.notificationId !== undefined || toast.link !== undefined;
  const open = () => {
    if (toast.notificationId !== undefined) {
      markRead(toast.notificationId);
      navigation.open('inbox', { focus: toast.notificationId });
    } else if (toast.link) followLink(toast.link);
    dismiss(toast.id);
  };
  return (
    <li
      className={`toast toast-${toast.tone}`}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
      data-testid="toast"
    >
      <Icon name={TONE_ICON[toast.tone]} className="toast-icon" />
      {clickable ? (
        <button type="button" className="toast-text toast-link" onClick={open}>
          {t(toast.key, toast.vars)}
        </button>
      ) : (
        <span className="toast-text">{t(toast.key, toast.vars)}</span>
      )}
      <IconButton icon="close" label={t('ui.common.dismiss')} size="sm" noTooltip onClick={() => dismiss(toast.id)} />
      {toast.ttlMs > 0 && <span className={['toast-timer', hold && 'is-held'].filter(Boolean).join(' ')} style={{ animationDuration: `${toast.ttlMs}ms` }} />}
    </li>
  );
}

/** The toast stack (bottom right). */
export function Toasts(): ReactElement {
  const t = useT();
  const toasts = useNotifications((s) => s.toasts);
  const urgent = toasts.some((x) => x.tone === 'danger' || x.tone === 'important');
  return (
    <ol className="toasts" aria-live={urgent ? 'assertive' : 'polite'} aria-label={t('ui.notify.toasts')}>
      {toasts.map((x) => (
        <ToastItem key={x.id} toast={x} />
      ))}
    </ol>
  );
}
