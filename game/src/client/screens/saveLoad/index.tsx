/**
 * SCR-03 Save / Load (§29.9): manual slots, three rotating autosaves and Ironman (one slot per
 * campaign, no manual saves). Load, overwrite, delete (with confirmation), import and export of
 * save files. Opened from the main menu (load) or the game menu (save/load).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useGame } from '../../app/gameStore';
import { loadBlob, loadSlot, saveToSlot } from '../../app/lifecycle';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { downloadText } from '../../devtools/DevConsole';
import { formatGameDate } from '../../i18n/calendar';
import { formatNumber, getLanguage, useT } from '../../i18n/index';
import { getSaveManager, type SaveMeta } from '../../saves/saveManager';
import { MenuBackdrop } from '../../shell/MenuBackdrop';
import { Button, ButtonRow, Field, Frame, Icon, IconButton, Modal, Segmented, Table, TextInput, type Column } from '../../ui/index';
import './saveLoad.css';

type Mode = 'save' | 'load';

/** "3 h 05 min" style play time. */
export function formatPlaytime(sec: number): string {
  const total = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

function formatWallClock(ms: number): string {
  try {
    return new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return '';
  }
}

interface Confirm {
  kind: 'delete' | 'overwrite' | 'load';
  meta: SaveMeta;
}

function SaveLoadScreen({ params, close }: ScreenProps): ReactElement {
  const t = useT();
  const session = useGame((s) => s.session);
  const inGame = session !== null;
  const ironman = useGame((s) => s.state?.meta.options.ironman === true);
  const [mode, setMode] = useState<Mode>(inGame && params?.mode !== 'load' ? 'save' : 'load');
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSaves(await getSaveManager().list());
    } catch {
      setSaves([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kindLabel = (k: SaveMeta['kind']) => t(`menu.saves.kind.${k}`);
  const columns: Column<SaveMeta>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('menu.saves.col.name'),
        sortValue: (m) => m.name.toLowerCase(),
        cell: (m) => (
          <span className="save-name">
            <span className={`badge ${m.kind === 'ironman' ? 'badge-danger' : m.kind === 'auto' ? '' : 'badge-accent'}`}>{kindLabel(m.kind)}</span>
            <span className="save-title">{m.id === 'manual-quick' ? t('menu.saves.quickSlot') : m.name}</span>
          </span>
        ),
      },
      { id: 'ruler', header: t('menu.saves.col.ruler'), sortValue: (m) => m.rulerName, cell: (m) => <span>{m.rulerName}{m.houseName && <span className="faint"> · {m.houseName}</span>}</span> },
      { id: 'date', header: t('menu.saves.col.date'), sortValue: (m) => m.hour, cell: (m) => <span className="num">{formatGameDate(m.hour)}</span> },
      { id: 'difficulty', header: t('menu.saves.col.difficulty'), cell: (m) => t(`ui.difficulty.${m.difficulty}`) },
      { id: 'played', header: t('menu.saves.col.played'), sortValue: (m) => m.playtimeSec, align: 'end', cell: (m) => <span className="num">{formatPlaytime(m.playtimeSec)}</span> },
      { id: 'saved', header: t('menu.saves.col.saved'), sortValue: (m) => m.savedAt, align: 'end', cell: (m) => <span className="num faint">{formatWallClock(m.savedAt)}</span> },
    ],
    [t],
  );

  const doLoad = async (meta: SaveMeta) => {
    setBusy(true);
    const ok = await loadSlot(meta.id);
    setBusy(false);
    if (ok && inGame) close();
  };
  const doSave = async (slotId?: string) => {
    setBusy(true);
    const meta = await saveToSlot(name, slotId);
    setBusy(false);
    if (meta) {
      setName('');
      setSelected(meta.id);
      await refresh();
    }
  };
  const doDelete = async (meta: SaveMeta) => {
    await getSaveManager().delete(meta.id);
    if (selected === meta.id) setSelected(null);
    await refresh();
  };
  const runConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'delete') await doDelete(c.meta);
    else if (c.kind === 'overwrite') await doSave(c.meta.id);
    else await doLoad(c.meta);
  };
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (loadBlob(text) && inGame) close();
  };

  const selectedMeta = saves?.find((m) => m.id === selected) ?? null;
  const visible = (saves ?? []).filter((m) => mode === 'load' || m.kind === 'manual');
  const canSave = inGame && !ironman;

  const frame = (
    <Frame
      className="saves-frame"
      title={t(mode === 'save' ? 'menu.saves.titleSave' : 'menu.saves.titleLoad')}
      ornate
      actions={<IconButton icon="close" label={t('ui.common.close')} keyHint="ui.back" onClick={close} data-testid="saves-close" />}
      data-testid="save-load"
      footer={
        <ButtonRow align="between">
          <span className="row">
            <Button variant="ghost" icon="load" onClick={() => fileInput.current?.click()}>
              {t('menu.saves.import')}
            </Button>
            <input ref={fileInput} type="file" accept=".bardia,.txt" hidden onChange={(e) => void onImport(e.currentTarget.files?.[0])} />
            {selectedMeta && (
              <>
                <Button
                  variant="ghost"
                  icon="save"
                  onClick={async () => {
                    const blob = await getSaveManager().loadBlob(selectedMeta.id);
                    downloadText(`${selectedMeta.rulerName || 'bardia'}-${selectedMeta.id}.bardia`, blob, 'text/plain');
                  }}
                >
                  {t('menu.saves.export')}
                </Button>
                <Button variant="ghost" icon="trash" onClick={() => setConfirm({ kind: 'delete', meta: selectedMeta })} data-testid="save-delete">
                  {t('menu.saves.delete')}
                </Button>
              </>
            )}
          </span>
          <span className="row">
            {mode === 'load' ? (
              <Button variant="primary" icon="load" disabled={!selectedMeta || busy} busy={busy} onClick={() => selectedMeta && (inGame ? setConfirm({ kind: 'load', meta: selectedMeta }) : void doLoad(selectedMeta))} data-testid="save-load-button">
                {t('menu.saves.load')}
              </Button>
            ) : (
              <Button variant="primary" icon="save" disabled={!canSave || !selectedMeta || busy} onClick={() => selectedMeta && setConfirm({ kind: 'overwrite', meta: selectedMeta })}>
                {t('menu.saves.overwrite')}
              </Button>
            )}
          </span>
        </ButtonRow>
      }
    >
      <div className="saves-body">
        {inGame && (
          <Segmented
            label={t('menu.saves.mode')}
            hideLabel
            value={mode}
            onChange={(m) => {
              setMode(m);
              setSelected(null);
            }}
            options={[
              { value: 'save', label: t('menu.saves.save'), icon: 'save' },
              { value: 'load', label: t('menu.saves.load'), icon: 'load' },
            ]}
          />
        )}
        {mode === 'save' &&
          (ironman ? (
            <div className="saves-ironman">
              <Icon name="critical" /> {t('menu.saves.ironmanNote')}
            </div>
          ) : (
            <form
              className="saves-new"
              onSubmit={(e) => {
                e.preventDefault();
                void doSave();
              }}
            >
              <Field label={t('menu.saves.newName')}>
                {(id) => <TextInput id={id} value={name} placeholder={t('menu.saves.newPlaceholder')} onChange={(e) => setName(e.currentTarget.value)} maxLength={40} data-testid="save-name" />}
              </Field>
              <Button type="submit" variant="primary" icon="save" disabled={!canSave || busy} data-testid="save-new">
                {t('menu.saves.saveNew')}
              </Button>
            </form>
          ))}
        {saves === null ? (
          <div className="empty-state">
            <Icon name="hourglass" />
            {t('menu.saves.loading')}
          </div>
        ) : (
          <Table
            rows={visible}
            columns={columns}
            rowKey={(m) => m.id}
            caption={t('menu.saves.caption')}
            selectedKey={selected}
            onRowClick={(m) => setSelected(m.id)}
            initialSort={{ column: 'saved', dir: 'desc' }}
            rowProps={(m) => ({ 'data-testid': `save-row-${m.id}` })}
            empty={
              <span className="row" style={{ justifyContent: 'center' }}>
                <Icon name="chronicle" /> {t('menu.saves.empty')}
              </span>
            }
          />
        )}
        {visible.length > 0 && <p className="faint saves-count">{t('menu.saves.count', { count: visible.length, size: formatNumber(Math.round(visible.reduce((sum, m) => sum + m.size, 0) / 1024)) })}</p>}
      </div>
    </Frame>
  );

  return (
    <div className={inGame ? 'saves-overlay' : 'saves-page'}>
      {!inGame && <MenuBackdrop dim />}
      {frame}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? t(`menu.saves.confirm.${confirm.kind}Title`) : ''}
        size="sm"
        tone={confirm?.kind === 'delete' ? 'critical' : 'default'}
        footer={
          <ButtonRow>
            <Button onClick={() => setConfirm(null)}>{t('ui.common.cancel')}</Button>
            <Button variant={confirm?.kind === 'delete' ? 'danger' : 'primary'} onClick={() => void runConfirm()} data-autofocus data-testid="confirm-yes">
              {confirm ? t(`menu.saves.confirm.${confirm.kind}`) : ''}
            </Button>
          </ButtonRow>
        }
      >
        {confirm && <p>{t(`menu.saves.confirm.${confirm.kind}Body`, { name: confirm.meta.name, date: formatGameDate(confirm.meta.hour) })}</p>}
      </Modal>
    </div>
  );
}

export const screen: ScreenDescriptor = { id: 'saveLoad', route: 'saveLoad', component: SaveLoadScreen, layout: 'overlay', titleKey: 'menu.saves.titleLoad' };
