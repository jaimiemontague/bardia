/**
 * Key rebinding (§25.6 "all rebindable", §25.7 "full key rebinding"): every action with its bindings
 * per context, Rebind (captures the next key combination), Clear, Reset; conflicts are flagged.
 * The controller layout (Gamepad API standard mapping) is shown for reference.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { getShortcutManager } from '../../app/inputRuntime';
import { ACTIONS, comboLabel, findConflicts, type InputContext } from '../../input/bindings';
import { GAMEPAD_BUTTON_ACTIONS } from '../../input/gamepad';
import { useSettings } from '../../settings/store';
import { useT } from '../../i18n/index';
import { Button, Icon, IconButton, KeyHint, Panel, Toggle } from '../../ui/index';

const CONTEXT_ORDER: readonly InputContext[] = ['global', 'map', 'battle', 'duel', 'menu'];
const PAD_BUTTON_NAMES: Readonly<Record<number, string>> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start', 12: '↑', 13: '↓', 14: '←', 15: '→' };

/** The rebinding table. */
export function ControlsTab(): ReactElement {
  const t = useT();
  const bindings = useSettings((s) => s.settings.controls.bindings);
  const gamepad = useSettings((s) => s.settings.controls.gamepad);
  const update = useSettings((s) => s.update);
  const [capturing, setCapturing] = useState<string | null>(null);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const conflictCombos = new Set(Object.keys(conflicts));

  useEffect(() => {
    if (!capturing) return undefined;
    const release = getShortcutManager().capture((combo) => {
      setCapturing(null);
      if (combo === 'Escape' && capturing !== 'ui.back') return;
      const current = useSettings.getState().settings.controls.bindings;
      const list = (current[capturing] ?? []).filter((c) => c !== combo);
      useSettings.getState().update({ controls: { bindings: { ...current, [capturing]: [combo, ...list].slice(0, 2) } } });
    });
    return release;
  }, [capturing]);

  const setBindings = (id: string, combos: string[]) => update({ controls: { bindings: { ...bindings, [id]: combos } } });
  const resetOne = (id: string) => {
    const def = ACTIONS.find((a) => a.id === id);
    if (def) setBindings(id, [...def.defaults]);
  };
  const resetAll = () => {
    const out: Record<string, string[]> = {};
    for (const a of ACTIONS) out[a.id] = [...a.defaults];
    update({ controls: { bindings: out } });
  };

  return (
    <div className="stack">
      <div className="row wrap">
        <p className="muted grow" style={{ margin: 0 }}>
          {t('menu.options.controls.intro')}
        </p>
        <Button icon="reset" size="sm" onClick={resetAll} data-testid="bindings-reset-all">
          {t('menu.options.controls.resetAll')}
        </Button>
      </div>
      {Object.keys(conflicts).length > 0 && (
        <div className="options-warning" role="alert">
          <Icon name="warning" /> {t('menu.options.controls.conflicts', { count: Object.keys(conflicts).length })}
        </div>
      )}
      {CONTEXT_ORDER.map((ctx) => {
        const actions = ACTIONS.filter((a) => a.context === ctx);
        if (actions.length === 0) return null;
        return (
          <Panel key={ctx} title={t(`menu.options.controls.context.${ctx}`)}>
            <table className="bind-table">
              <tbody>
                {actions.map((a) => {
                  const combos = bindings[a.id] ?? [];
                  const isCap = capturing === a.id;
                  return (
                    <tr key={a.id} data-testid={`bind-${a.id}`}>
                      <th scope="row">{t(a.labelKey)}</th>
                      <td className="bind-keys">
                        {isCap ? (
                          <span className="bind-capture" aria-live="assertive">
                            {t('menu.options.controls.pressKey')}
                          </span>
                        ) : combos.length === 0 ? (
                          <span className="faint">{t('menu.options.controls.unbound')}</span>
                        ) : (
                          combos.map((c) => (
                            <span key={c} className={['bind-combo', conflictCombos.has(c) && 'is-conflict'].filter(Boolean).join(' ')} title={conflictCombos.has(c) ? t('menu.options.controls.conflictWith', { actions: (conflicts[c] ?? []).filter((x) => x !== a.id).map((x) => t(`ui.action.${x}`)).join(', ') }) : undefined}>
                              <KeyHint combo={c} />
                              <span className="sr-only">{comboLabel(c)}</span>
                            </span>
                          ))
                        )}
                      </td>
                      <td className="bind-actions">
                        {a.fixed ? (
                          <span className="faint">{t('menu.options.controls.fixed')}</span>
                        ) : isCap ? (
                          <Button size="sm" onClick={() => setCapturing(null)}>
                            {t('ui.common.cancel')}
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" onClick={() => setCapturing(a.id)} data-testid={`rebind-${a.id}`}>
                              {t('menu.options.controls.rebind')}
                            </Button>
                            <IconButton icon="trash" size="sm" label={t('menu.options.controls.clear')} onClick={() => setBindings(a.id, [])} disabled={combos.length === 0} />
                            <IconButton icon="reset" size="sm" label={t('menu.options.controls.reset')} onClick={() => resetOne(a.id)} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        );
      })}
      <Panel title={t('menu.options.controls.controller')}>
        <Toggle checked={gamepad} onChange={(v) => update({ controls: { gamepad: v } })} label={t('menu.options.controls.gamepad')} hint={t('menu.options.controls.gamepadHint')} />
        <dl className="pad-map">
          {Object.entries(GAMEPAD_BUTTON_ACTIONS).map(([btn, action]) => (
            <div key={btn} className="pad-row">
              <dt>
                <kbd className="pad-button">{PAD_BUTTON_NAMES[Number(btn)] ?? btn}</kbd>
              </dt>
              <dd>{t(`ui.action.${action}`)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
