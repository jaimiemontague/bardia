/**
 * "Coming soon" card for routes and modes whose screens are not built yet, so every top-bar button
 * and menu entry works from day one (screens arrive through the registry without shell changes).
 */
import type { ReactElement } from 'react';
import { hasKey, useT } from '../i18n/index';
import { Button, ButtonRow, Frame, Icon, Modal } from '../ui/index';

/** Locale key of a route's title (ui.route.<id>, falling back to a generic title). */
export function routeTitleKey(id: string): string {
  const key = `ui.route.${id}`;
  return hasKey(key) ? key : 'ui.route.unknown';
}

/** A modal placeholder for an unbuilt route. */
export function ComingSoonModal({ routeId, onClose }: { routeId: string; onClose(): void }): ReactElement {
  const t = useT();
  return (
    <Modal open title={t(routeTitleKey(routeId), { id: routeId })} onClose={onClose} size="sm" data-testid="coming-soon" footer={<ButtonRow><Button variant="primary" onClick={onClose} data-autofocus>{t('ui.common.close')}</Button></ButtonRow>}>
      <div className="coming-soon">
        <Icon name="quill" size={2.4} />
        <p>{t('ui.comingSoon.body')}</p>
      </div>
    </Modal>
  );
}

/** A full-area placeholder for a game mode without a scene. */
export function ComingSoonScene({ mode }: { mode: string }): ReactElement {
  const t = useT();
  return (
    <div className="scene-placeholder" data-testid="scene-placeholder">
      <Frame title={t('ui.comingSoon.sceneTitle', { mode })} ornate>
        <div className="coming-soon">
          <Icon name="quill" size={2.4} />
          <p>{t('ui.comingSoon.sceneBody')}</p>
        </div>
      </Frame>
    </div>
  );
}

/** A full-page placeholder for a menu page without a screen. */
export function ComingSoonPage({ routeId, onBack }: { routeId: string; onBack(): void }): ReactElement {
  const t = useT();
  return (
    <div className="menu-page-placeholder">
      <Frame title={t(routeTitleKey(routeId), { id: routeId })} ornate footer={<ButtonRow><Button onClick={onBack} icon="arrowLeft">{t('ui.common.back')}</Button></ButtonRow>}>
        <div className="coming-soon">
          <Icon name="quill" size={2.4} />
          <p>{t('ui.comingSoon.body')}</p>
        </div>
      </Frame>
    </div>
  );
}
