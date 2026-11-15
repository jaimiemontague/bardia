/**
 * The Bardia UI kit. Screens import components from '@client/ui' (styles load once with the shell):
 *
 *   import { Frame, Panel, Button, IconButton, Tooltip, FormulaBreakdown, Slider, Tabs, Modal,
 *            Table, Meter, SegmentBar, KeyHint, ScrollArea, Toggle, Segmented, Field, TextInput,
 *            Select, Icon, Portrait, AssetImage,
 *            TransferSlider, Disclosure, ChoiceCard, ChoiceGrid, StatLine, ShipPicture } from '@client/ui';
 *
 * Text in components is always a locale key formatted with `useT()` (src/client/i18n).
 *
 * ## Menu rules (ARCHITECTURE.md §20) and the components built for them
 *
 * At most about six numbers per panel, words before numbers, one gold button per screen, menus as large
 * screens. The reference screens are the Expedition Planner (screens/expedition/index.tsx), the home hall
 * (screens/hub) and the Great hall with its Muster (screens/greatHall).
 *
 * ### Large screens: `<Frame size="screen">`
 * A framed menu that uses most of the viewport (up to the theme's `--screen-w` × `--screen-h`); its body
 * scrolls. Put the one primary action in `footer`.
 * ```tsx
 * <Frame size="screen" title={t('x.title')} ornate actions={<IconButton icon="close" label={t('ui.common.close')} onClick={close} />}
 *        footer={<Button variant="primary">{t('x.go')}</Button>}>…</Frame>
 * ```
 *
 * ### `TransferSlider`: moving a quantity between two places (rule 6)
 * `value` is the amount on the RIGHT side (what goes); the left side holds `total - value`. Both amounts
 * update live; the track is filled by the two piles (tokens of each side's `icon`). `min`/`max` limit the
 * right side, with `minReason`/`maxReason` shown in words when the handle rests on that limit. `quick`
 * adds "None / Half / All" chips, `suggested` a chip and a tick. Keyboard: arrows, Page Up/Down, Home/End.
 * Test ids derive from `data-testid` T: `T-handle` (role slider), `T-left`, `T-right`, `T-track`,
 * `T-limit`, `T-mark-none|half|all|suggested`.
 * ```tsx
 * <TransferSlider label={t('food')} total={stores} value={aboard} onChange={setAboard} step={10}
 *   left={{ label: t('town'), icon: 'food', note: (n) => t('keeps', { months: n / perMonth }) }}
 *   right={{ label: t('aboard'), icon: 'ship', note: (n) => t('days', { days: n / perDay }) }}
 *   max={holdRations} maxReason={t('holdsFull')} quick={['none', 'all']} suggested={plan30}
 *   data-testid="planner-rations" />
 * ```
 * Helpers: `snapTransfer(v, lo, hi, step)` and `transferKey(key, value, lo, hi, step, big)` (pure).
 *
 * ### `Disclosure`: the "Details" section (rule 1)
 * A toggle (default text "Details") and the section it reveals; the content stays mounted while hidden.
 * `variant="bar"` draws a full-width bar; `lazy` unmounts while closed; `open`/`onOpenChange` control it.
 * ```tsx
 * <Disclosure data-testid="planner-details"><StatLine label={t('upkeep')} value={80} /></Disclosure>
 * ```
 * The toggle's test id is `<data-testid>-toggle`.
 *
 * ### `ChoiceCard` and `ChoiceGrid`: big choices (rules 4 and 7)
 * A large card button with a picture or icon, a title and one plain line. `selected` makes it a toggle
 * (aria-pressed, a check in the corner); a disabled card shows `reason` instead of its line; `badge` is a
 * corner tag; `size` 'sm' | 'md' | 'lg' ('lg' stacks the picture above the text).
 * ```tsx
 * <ChoiceGrid columns={2}>
 *   <ChoiceCard size="lg" icon="ship" title={t('planner')} line={t('plannerInfo')} onClick={open} data-testid="hall-planner" />
 * </ChoiceGrid>
 * ```
 *
 * ### `StatLine`: icon + word + number on one line
 * ```tsx
 * <StatLine icon="men" label={t('menAtHome')} value={formatNumber(60)} tone={low ? 'warn' : undefined} />
 * ```
 *
 * ### `ShipPicture`: a small painted ship under sail, by ship type
 * ```tsx
 * <ChoiceCard picture={<ShipPicture type={ship.type} size="sm" />} title={ship.name} line={…} selected={on} />
 * ```
 */
import './ui.css';
import './menus.css';

export { Icon, ICON_NAMES, type IconName, type IconProps } from './Icon';
export { Button, IconButton, ButtonRow, type ButtonProps, type ButtonVariant, type ButtonSize, type IconButtonProps } from './Button';
export { Frame, Panel, Divider, type FrameProps, type PanelProps, type FrameVariant } from './Frame';
export { Tooltip, FormulaBreakdown, type TooltipProps, type FormulaRow, type FormulaBreakdownProps } from './Tooltip';
export { Slider, snapValue, type SliderProps } from './Slider';
export { Tabs, type TabDef, type TabsProps } from './Tabs';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { Table, type Column, type TableProps } from './Table';
export { Meter, SegmentBar, meterFraction, toneFor, type MeterProps, type MeterTone, type SegmentBarProps } from './Meter';
export { KeyHint, useBinding, useBindingLabel, comboParts, type KeyHintProps } from './KeyHint';
export { ScrollArea, type ScrollAreaProps } from './ScrollArea';
export { Toggle, Segmented, Field, TextInput, Select, type ToggleProps, type SegmentedProps, type SegmentedOption, type FieldProps } from './Form';
export { Portrait, portraitUrl, recipeForCharacter, monogramSvg, type PortraitRecipe, type PortraitProps } from './Portrait';
export { AssetImage, lookupImageAsset, finalAssetUrl, type AssetImageProps } from './AssetImage';
export {
  TransferSlider,
  snapTransfer,
  transferKey,
  type TransferSliderProps,
  type TransferSide,
  type TransferMark,
  type TransferQuickMark,
} from './TransferSlider';
export { Disclosure, type DisclosureProps } from './Disclosure';
export { ChoiceCard, ChoiceGrid, StatLine, type ChoiceCardProps, type StatLineProps } from './ChoiceCard';
export { ShipPicture, type ShipPictureProps } from './ShipPicture';
