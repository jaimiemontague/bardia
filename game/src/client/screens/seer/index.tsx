/**
 * The Seer's hut (hub building route 'building.seer', SCR-20): entering it shows the small dark hut
 * (render/interiors/rooms/seer.tsx). Its menu waits behind one person, the Seer at her table, and is laid out by
 * ARCHITECTURE §20: two big choices (read the omens with `readOmen`; tend the wounded with `heal`) and below them
 * what the seer says, one card per venture (the omen as a word and one line; its effect and how long it holds in a
 * tooltip), or the wounded of the house with the seer's or the church's care. Legends and relic clues belong to
 * the quests module and are not offered here yet.
 * Route params `{ person: 'seer', view?: 'heal' }` open her panel at once (on the wounded with `view: 'heal'`).
 *
 * Test ids: seer (the room's picture), seer-work, seer-read, seer-heal, seer-omens, seer-readings,
 * seer-no-readings, omen-<activity>, seer-healing, seer-no-wounded, wounded-<id>, heal-<method>-<id>,
 * heal-why-<method>-<id>.
 */
import { useState, type ReactElement } from 'react';
import { OMEN_ACTIVITIES, type OmenActivity } from '@content/schemas/tunables/faith';
import type { Command } from '@sim/core/commands';
import type { Character, SettlementId } from '@sim/core/state';
import { currentOmen, omenEffects } from '@sim/modules/faith/omens';
import { presentAt } from '@sim/modules/faith/state';
import type { HealMethod } from '@sim/modules/people/types';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { seerRoom } from '../../render/interiors/rooms/seer';
import { ambienceOf } from '../../render/scenes/ambience';
import { Button, ChoiceCard, ChoiceGrid, Portrait, recipeForCharacter, Tooltip } from '../../ui/index';
import {
  charById,
  dateText,
  displayName,
  godText,
  inPlayerHouse,
  NoGame,
  reasonText,
  runCommand,
  silverDelta,
  tryCommand,
  useHousehold,
  Why,
  type Household,
} from '../character/household';
import { useMusicState } from '../../audio/hooks';
import './seer.css';

/** What the Seer's panel shows under the two choices. */
export type SeerView = 'omens' | 'heal';

function rulerPlace(h: Household): { id: SettlementId; name: string } | undefined {
  const id = presentAt(h.state, h.content.tunables.faith, h.state.player.rulerId);
  if (id === undefined) return undefined;
  return { id, name: h.state.settlements[id]?.name ?? id };
}

/** The omen modifiers each activity's consumers read (weather: storms; battles: morale; duels: nerve; harvest). */
const OMEN_EFFECT_KEYS: Readonly<Record<OmenActivity, readonly string[]>> = {
  voyage: ['stormMult'],
  battle: ['moralePct'],
  duel: ['duel.nervePct'],
  harvest: ['harvest.outputPct'],
};

function effectLines(
  t: ReturnType<typeof useT>,
  h: Household,
  activity: OmenActivity,
  omen: string,
): string[] {
  const fx = omenEffects(
    h.content.balance,
    h.content.tunables.faith,
    activity,
    omen as Parameters<typeof omenEffects>[3],
  );
  const out: string[] = [];
  for (const key of OMEN_EFFECT_KEYS[activity]) {
    const value = fx[key];
    if (value === undefined) continue;
    const shown =
      key === 'moralePct'
        ? Math.round(value * 100)
        : key === 'stormMult'
          ? Math.round((value - 1) * 100)
          : value;
    if (shown === 0) continue;
    out.push(t(`faith.ui.effect.${key.replace('.', '_')}`, { value: shown, sign: shown > 0 ? '+' : '' }));
  }
  if (out.length === 0) out.push(t('faith.ui.effect.none'));
  return out;
}

const OMEN_ICON: Record<OmenActivity, 'ship' | 'sword' | 'shieldRound' | 'sun'> = {
  voyage: 'ship',
  battle: 'sword',
  duel: 'shieldRound',
  harvest: 'sun',
};

/** What the runes say, one card per venture. */
function OmenBoard({ h }: { h: Household }): ReactElement {
  const t = useT();
  const house = h.state.player.house;
  const now = h.state.time.hour;
  const readings = OMEN_ACTIVITIES.map((a) => ({ a, r: currentOmen(house.omens, a, now) }));
  const any = readings.some((x) => x.r !== undefined);
  return (
    <section className="sr-board" data-testid="seer-omens" aria-label={t('faith.ui.seer.omens')}>
      {!any && (
        <p className="sr-say" data-testid="seer-no-readings">
          {t('faith.ui.seer.noReadings')}
        </p>
      )}
      <ul className="sr-omens" data-testid="seer-readings">
        {readings.map(({ a, r }) => {
          const tone = r
            ? r.omen === 'blessed' || r.omen === 'fair'
              ? 'good'
              : r.omen === 'ill'
                ? 'bad'
                : 'neutral'
            : 'unread';
          const tip = r ? (
            <span className="hh-chip-tip">
              {t(`faith.omen.${r.signs ? 'signs' : 'runes'}.${a}.${r.omen}`)}{' '}
              {effectLines(t, h, a, r.omen).join(' ')}{' '}
              {t('faith.ui.seer.until', { date: dateText(r.untilHour) })}
            </span>
          ) : (
            <span className="hh-chip-tip">
              {t('faith.ui.seer.godsOf', {
                gods: h.content.balance.omens.activities[a].map((g) => godText(h.content, g)).join(', '),
              })}
            </span>
          );
          return (
            <li key={a}>
              <Tooltip content={tip} block>
                <div
                  className={`sr-omen tone-${tone}`}
                  tabIndex={0}
                  data-testid={`omen-${a}`}
                  data-omen={r?.omen ?? 'none'}
                >
                  <span className="sr-omen-what">{t(`faith.activity.${a}`)}</span>
                  <span className="sr-omen-word">
                    {r ? t(`faith.omen.name.${r.omen}`) : t('faith.ui.seer.unread')}
                  </span>
                  <span className="sr-omen-line">
                    {r
                      ? t(`faith.omen.${r.signs ? 'signs' : 'runes'}.${a}.${r.omen}`)
                      : t('faith.ui.seer.unreadLine')}
                  </span>
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HealButton({ h, c, method }: { h: Household; c: Character; method: HealMethod }): ReactElement {
  const t = useT();
  const cmd: Command = { type: 'heal', charId: c.id, method };
  const trial = tryCommand(h, cmd);
  const cost = -silverDelta(h, trial);
  const after = trial.ok ? trial.state.characters[c.id]?.health : undefined;
  const until = after?.woundUntilHour ?? after?.injuries.reduce((m, i) => Math.max(m, i.untilHour ?? 0), 0);
  return (
    <div className="sr-heal-option">
      <Button
        variant="secondary"
        icon={method === 'seer' ? 'eye' : 'crown'}
        disabled={!trial.ok}
        onClick={() => runCommand(cmd)}
        data-testid={`heal-${method}-${c.id}`}
      >
        {t(`faith.ui.heal.${method}`)}
      </Button>
      {trial.ok ? (
        <span className="hh-note">
          {t('faith.ui.heal.preview', {
            cost: formatNumber(cost),
            wound: after ? t(`people.wound.${after.wound}`) : '',
            date: until ? dateText(until) : '',
          })}
        </span>
      ) : (
        <Why text={reasonText(t, trial)} testId={`heal-why-${method}-${c.id}`} />
      )}
    </div>
  );
}

function hurtOf(h: Household): Character[] {
  const now = h.state.time.hour;
  return Object.values(h.state.characters).filter(
    (c) =>
      c.alive &&
      inPlayerHouse(h.state, c) &&
      (c.health.wound !== 'none' ||
        c.health.injuries.some((i) => i.untilHour !== undefined && i.untilHour > now)),
  );
}

/** The wounded of the house, each with the seer's and the church's care. */
function Healing({ h }: { h: Household }): ReactElement {
  const t = useT();
  const hurt = hurtOf(h);
  const healers = Object.values(h.state.characters).filter(
    (c) => c.alive && inPlayerHouse(h.state, c) && c.role?.kind === 'seer',
  );
  return (
    <section className="sr-board" data-testid="seer-healing" aria-label={t('faith.ui.heal.title')}>
      {healers.length > 0 && (
        <p className="sr-say">
          {t('faith.ui.heal.healers', { names: healers.map((c) => c.name).join(', ') })}
        </p>
      )}
      {hurt.length === 0 ? (
        <p className="hh-empty" data-testid="seer-no-wounded">
          {t('faith.ui.heal.none')}
        </p>
      ) : (
        <ul className="sr-wounded">
          {hurt.map((c) => {
            const w = c.health;
            const until = w.woundUntilHour ?? w.injuries.reduce((m, i) => Math.max(m, i.untilHour ?? 0), 0);
            const name = displayName(t, c);
            return (
              <li key={c.id} className="sr-patient" data-testid={`wounded-${c.id}`}>
                <Portrait
                  recipe={recipeForCharacter(c, h.state)}
                  alt={t('people.ui.portraitAlt', { name })}
                  size="md"
                  initial={c.name.slice(0, 1)}
                />
                <div className="sr-patient-text">
                  <span className="sr-patient-name">{name}</span>
                  <span className="hh-note">
                    {w.wound === 'mortal'
                      ? t('faith.ui.heal.mortalLine', { date: dateText(until) })
                      : t('faith.ui.heal.line', { date: dateText(until) })}
                  </span>
                </div>
                <div className="sr-patient-acts">
                  {w.treated ? (
                    <span className="hh-note">{t('faith.ui.heal.treated')}</span>
                  ) : (
                    <>
                      <HealButton h={h} c={c} method="seer" />
                      <HealButton h={h} c={c} method="church" />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The Seer's panel: the two choices, then the omens or the wounded. */
export function SeerWork({ h, initialView = 'omens' }: { h: Household; initialView?: SeerView }): ReactElement {
  const t = useT();
  const [view, setView] = useState<SeerView>(initialView);
  const place = rulerPlace(h);
  const cmd: Command = place ? { type: 'readOmen', settlementId: place.id } : { type: 'readOmen' };
  const trial = tryCommand(h, cmd);
  const cost = h.content.tunables.faith.omens.readCost;
  const ready =
    !trial.ok &&
    trial.code === 'seerCooldown' &&
    trial.details &&
    typeof trial.details === 'object' &&
    !Array.isArray(trial.details)
      ? trial.details['readyHour']
      : undefined;
  const why =
    typeof ready === 'number' ? t('faith.ui.seer.readyOn', { date: dateText(ready) }) : reasonText(t, trial);
  const hurt = hurtOf(h).length;
  return (
    <div className="sr-work" data-testid="seer-work">
      <ChoiceGrid columns={2} className="sr-choices" label={t('faith.ui.seer.choices')}>
        <ChoiceCard
          size="lg"
          icon="dice"
          title={t('faith.ui.seer.readTitle')}
          line={t('faith.ui.seer.readLine', { cost, days: h.content.balance.omens.readCooldownDays })}
          disabled={!trial.ok}
          reason={why}
          onClick={() => {
            if (runCommand(cmd)) setView('omens');
          }}
          data-testid="seer-read"
        />
        <ChoiceCard
          size="lg"
          icon="shieldRound"
          title={t('faith.ui.heal.title')}
          line={t('faith.ui.seer.healLine', { count: hurt })}
          selected={view === 'heal'}
          onClick={() => setView(view === 'heal' ? 'omens' : 'heal')}
          data-testid="seer-heal"
        />
      </ChoiceGrid>
      {view === 'heal' ? <Healing h={h} /> : <OmenBoard h={h} />}
    </div>
  );
}

/**
 * The Seer's hut for a household (exported for tests): the room with the Seer in it; her panel open when `person`
 * (controlled) or `initialPerson` says so, on the wounded when `initialView` is 'heal'.
 */
export function SeerHut({
  h,
  onClose,
  person,
  initialPerson,
  onPersonChange,
  initialView = 'omens',
}: {
  h: Household;
  onClose(): void;
  person?: string | null;
  initialPerson?: 'seer';
  onPersonChange?(id: string | null): void;
  initialView?: SeerView;
}): ReactElement {
  const t = useT();
  const place = rulerPlace(h);
  const ruler = charById(h.state, h.state.player.rulerId);
  return (
    <InteriorRoom
      room={seerRoom}
      ambience={ambienceOf(h.state)}
      subtitle={
        place
          ? t('faith.interior.seer.subtitle', { place: place.name })
          : t('faith.ui.seer.away', { name: ruler?.name ?? '' })
      }
      {...(person !== undefined ? { person } : { initialPerson: initialPerson ?? null })}
      onPersonChange={onPersonChange}
      stageTestId="seer"
      onLeave={onClose}
      panel={() => <SeerWork h={h} initialView={initialView} />}
    />
  );
}

function SeerScreen({ params, close }: ScreenProps): ReactElement {
  const h = useHousehold();
  useMusicState('delve');
  const [person, setPerson] = useRoutePerson(seerRoom, ['building.seer'], params);
  const [view] = useState<SeerView>(params?.['view'] === 'heal' ? 'heal' : 'omens');
  if (!h) return <NoGame close={close} />;
  return <SeerHut h={h} person={person} onPersonChange={setPerson} initialView={view} onClose={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'seer',
  route: 'building.seer', staysUnder: true,
  component: SeerScreen,
  layout: 'overlay',
  titleKey: 'ui.route.building.seer',
};
