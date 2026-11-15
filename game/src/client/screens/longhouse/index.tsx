/**
 * The Longhouse (hub building route 'building.longhouse'): entering it shows the inside of the household's own
 * hall (render/interiors/rooms/longhouse.tsx). Its menu waits behind one person, the House-elder on his carved
 * chair by the hearth, who knows every man and woman of the hird. His panel is laid out by ARCHITECTURE §20: one
 * line on the hird (who holds office, who sits idle, who is hurt), then each office as a card with its holders'
 * portraits and one line on what it does: steward, lieutenants, a governor per holding, a captain per fleet, envoy
 * and seer. Choosing an office brings it forward with its holders (each can be relieved) and the people who could
 * take it as portrait cards; pick one and Appoint (`assignRole`). Every choice is the real command tried first, so
 * a card the people module would refuse says why. Route params `{ person: 'houseElder' }` open his panel at once.
 *
 * Test ids: longhouse (the room's picture), longhouse-work, longhouse-summary, longhouse-to-seer,
 * longhouse-to-family, office-<key>, seat-<key>, holder-<id>, relieve-<id>, assign-<id>, longhouse-focus,
 * longhouse-appoint.
 */
import { useState, type ReactElement } from 'react';
import type { Command } from '@sim/core/commands';
import type { Character, FleetId, SettlementId } from '@sim/core/state';
import type { AssignableRole } from '@sim/modules/people/types';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { longhouseRoom } from '../../render/interiors/rooms/longhouse';
import { ambienceOf } from '../../render/scenes/ambience';
import {
  Button,
  ChoiceCard,
  ChoiceGrid,
  Icon,
  Portrait,
  recipeForCharacter,
  type IconName,
} from '../../ui/index';
import {
  ageNow,
  displayName,
  Empty,
  fleetName,
  inPlayerHouse,
  NoGame,
  PersonChoice,
  reasonText,
  roleText,
  runCommand,
  stageOf,
  tryCommand,
  useHousehold,
  Why,
  type Household,
  type Trial,
} from '../character/household';
import { capitalOf } from '../hub/counsel';
import { useMusicState } from '../../audio/hooks';
import './longhouse.css';

/** One seat: an office kind, and the holding or fleet it is tied to. */
interface Seat {
  key: string;
  role: AssignableRole;
  holdingId?: SettlementId;
  fleetId?: FleetId;
  title: string;
  holders: Character[];
}

/** An office card: one seat, or a group of seats (a governor per holding, a captain per fleet). */
interface Office {
  key: string;
  role: AssignableRole;
  title: string;
  icon: IconName;
  holders: Character[];
  seats: Seat[];
  /** Why the office cannot be filled at all (no holding, no fleet). */
  closed?: Trial;
}

const ICONS: Record<AssignableRole, IconName> = {
  steward: 'ledger',
  lieutenant: 'sword',
  governor: 'crown',
  captain: 'ship',
  envoy: 'feather',
  seer: 'eye',
  npc: 'character',
};

function officesOf(h: Household, t: ReturnType<typeof useT>, members: Character[]): Office[] {
  const f = h.state.factions[h.state.player.factionId];
  const holds = (role: AssignableRole, extra?: (c: Character) => boolean) =>
    members.filter((c) => c.role?.kind === role && (!extra || extra(c)));
  const single = (role: AssignableRole, title: string): Office => {
    const holders = holds(role);
    return {
      key: role,
      role,
      title,
      icon: ICONS[role],
      holders,
      seats: [{ key: role, role, title, holders }],
    };
  };
  const holdings = (f?.holdingIds ?? []).filter(
    (id) => Object.hasOwn(h.state.settlements, id) && h.state.settlements[id]?.holding,
  );
  const governors: Seat[] = holdings.map((id) => ({
    key: `governor:${id}`,
    role: 'governor',
    holdingId: id,
    title: t('people.ui.role.governorOf', { place: h.state.settlements[id]?.name ?? id }),
    holders: holds('governor', (c) => c.role?.holdingId === id),
  }));
  const fleets = (Object.keys(h.state.fleets) as FleetId[]).filter(
    (id) => h.state.fleets[id]?.ownerId === h.state.player.factionId,
  );
  const captains: Seat[] = fleets.map((id) => ({
    key: `captain:${id}`,
    role: 'captain',
    fleetId: id,
    title: t('people.ui.role.captainOf', { fleet: fleetName(h.state, id) || id }),
    holders: holds('captain', (c) => c.role?.fleetId === id),
  }));
  const noHoldings: Trial = { ok: false, code: 'noHoldings' };
  const noFleets: Trial = { ok: false, code: 'noFleets' };
  return [
    single('steward', t('people.role.steward')),
    single('lieutenant', t('people.ui.longhouse.lieutenants')),
    {
      key: 'governor',
      role: 'governor',
      title: t('people.ui.longhouse.governors'),
      icon: ICONS.governor,
      holders: holds('governor'),
      seats: governors,
      ...(governors.length === 0 ? { closed: noHoldings } : {}),
    },
    {
      key: 'captain',
      role: 'captain',
      title: t('people.ui.longhouse.captains'),
      icon: ICONS.captain,
      holders: holds('captain'),
      seats: captains,
      ...(captains.length === 0 ? { closed: noFleets } : {}),
    },
    single('envoy', t('people.role.envoy')),
    single('seer', t('people.role.seer')),
  ];
}

function assignCmd(o: Seat, c: Character): Command {
  if (o.holdingId !== undefined)
    return { type: 'assignRole', charId: c.id, role: o.role, holdingId: o.holdingId };
  if (o.fleetId !== undefined) return { type: 'assignRole', charId: c.id, role: o.role, fleetId: o.fleetId };
  return { type: 'assignRole', charId: c.id, role: o.role };
}

/** An office card: the holders' portraits, the office, one line. */
function OfficeCard({
  h,
  o,
  selected,
  onSelect,
}: {
  h: Household;
  o: Office;
  selected: boolean;
  onSelect(): void;
}): ReactElement {
  const t = useT();
  const shown = o.holders.slice(0, 3);
  const picture =
    shown.length === 0 ? (
      <span className="lh-empty-seat">
        <Icon name={o.icon} />
      </span>
    ) : (
      <span className="lh-faces">
        {shown.map((c) => (
          <Portrait
            key={c.id}
            recipe={recipeForCharacter(c, h.state)}
            alt=""
            size="sm"
            initial={c.name.slice(0, 1)}
          />
        ))}
      </span>
    );
  const who =
    o.holders.length === 0
      ? t('people.ui.longhouse.vacant')
      : o.holders.length === 1
        ? displayName(t, o.holders[0] as Character)
        : t('people.ui.longhouse.holderCount', { count: o.holders.length });
  return (
    <ChoiceCard
      className="lh-office"
      picture={picture}
      title={o.title}
      line={t('people.ui.longhouse.officeLine', { who, what: t(`people.ui.officeShort.${o.role}`) })}
      selected={selected}
      disabled={o.closed !== undefined}
      reason={o.closed ? reasonText(t, o.closed) : undefined}
      onClick={onSelect}
      data-testid={`office-${o.key}`}
    />
  );
}

/** The chosen office: what it does, which seat (governors and captains), who holds it, and who could. */
function OfficeFocus({ h, o, people }: { h: Household; o: Office; people: Character[] }): ReactElement {
  const t = useT();
  const [seatKey, setSeatKey] = useState<string>(o.seats[0]?.key ?? '');
  const [pick, setPick] = useState<string | null>(null);
  const seat = o.seats.find((x) => x.key === seatKey) ?? o.seats[0];
  const many = o.seats.length > 1;
  const candidates = seat ? people.filter((c) => !seat.holders.includes(c)) : [];
  const chosen = candidates.find((c) => c.id === pick);
  const trialOf = (c: Character): Trial =>
    !seat
      ? { ok: false, code: 'invalidCommand' }
      : c.role?.kind === seat.role && seat.holdingId === undefined && seat.fleetId === undefined
        ? { ok: false, code: 'alreadyHolds' }
        : tryCommand(h, assignCmd(seat, c));
  const trials = new Map<string, Trial>(candidates.map((c) => [c.id, trialOf(c)]));
  const chosenTrial = chosen ? trials.get(chosen.id) : undefined;
  return (
    <aside className="hh-focus lh-focus" data-testid="longhouse-focus" data-office={o.key}>
      <h3 className="hh-focus-name">{o.title}</h3>
      <p className="hh-focus-line">{t(`people.ui.roleDesc.${o.role}`)}</p>
      {many && (
        <>
          <p className="hh-ask">
            {t(o.role === 'captain' ? 'people.ui.longhouse.askFleet' : 'people.ui.longhouse.askHolding')}
          </p>
          <ChoiceGrid columns={2}>
            {o.seats.map((x) => (
              <ChoiceCard
                key={x.key}
                size="sm"
                title={x.title}
                line={
                  x.holders.length > 0
                    ? displayName(t, x.holders[0] as Character)
                    : t('people.ui.longhouse.vacant')
                }
                selected={seat?.key === x.key}
                onClick={() => {
                  setSeatKey(x.key);
                  setPick(null);
                }}
                data-testid={`seat-${x.key}`}
              />
            ))}
          </ChoiceGrid>
        </>
      )}
      {seat && seat.holders.length > 0 && (
        <ul className="lh-holders">
          {seat.holders.map((c) => {
            const relieve: Command = { type: 'assignRole', charId: c.id, role: 'npc' };
            const trial = tryCommand(h, relieve);
            return (
              <li key={c.id} className="lh-holder" data-testid={`holder-${c.id}`}>
                <Portrait
                  recipe={recipeForCharacter(c, h.state)}
                  alt=""
                  size="sm"
                  initial={c.name.slice(0, 1)}
                />
                <span className="lh-holder-name">{displayName(t, c)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!trial.ok}
                  onClick={() => runCommand(relieve)}
                  data-testid={`relieve-${c.id}`}
                >
                  {t('people.ui.longhouse.relieve')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hh-ask">
        {many && seat
          ? t('people.ui.longhouse.askWhoSeat', { seat: seat.title })
          : t('people.ui.longhouse.askWho')}
      </p>
      {candidates.length === 0 ? (
        <Empty>{t('people.ui.longhouse.noCandidates')}</Empty>
      ) : (
        <ChoiceGrid columns={1} className="lh-candidates">
          {candidates.map((c) => {
            const trial = trials.get(c.id) as Trial;
            return (
              <PersonChoice
                key={c.id}
                h={h}
                c={c}
                size="sm"
                line={t('people.ui.longhouse.candidateLine', {
                  role: roleText(t, h.state, c),
                  age: ageNow(h.state, c),
                  hurt: c.health.wound !== 'none' ? 'yes' : 'no',
                })}
                selected={pick === c.id}
                disabled={!trial.ok}
                reason={reasonText(t, trial)}
                onSelect={() => setPick(c.id)}
                testId={`assign-${c.id}`}
              />
            );
          })}
        </ChoiceGrid>
      )}
      <div className="hh-actions">
        <Button
          variant="primary"
          disabled={!seat || !chosen || !chosenTrial?.ok}
          onClick={() => {
            if (seat && chosen && runCommand(assignCmd(seat, chosen))) setPick(null);
          }}
          data-testid="longhouse-appoint"
        >
          {chosen
            ? t('people.ui.longhouse.appointName', { name: chosen.name })
            : t('people.ui.longhouse.assign')}
        </Button>
        {chosenTrial && !chosenTrial.ok && <Why text={reasonText(t, chosenTrial)} />}
      </div>
    </aside>
  );
}

/** The House-elder's panel: the line on the hird, the offices as cards and the chosen office. */
export function LonghouseWork({ h }: { h: Household }): ReactElement {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const members = Object.values(h.state.characters).filter(
    (c) => c.alive && c.id !== h.state.player.rulerId && inPlayerHouse(h.state, c),
  );
  const adults = members
    .filter((c) => stageOf(h.state, h.content, c) === 'adult' && c.location.kind !== 'captive')
    .sort((a, b) => a.birthHour - b.birthHour || (a.id < b.id ? -1 : 1));
  const officers = adults.filter((c) => c.role && c.role.kind !== 'npc');
  const idle = adults.length - officers.length;
  const wounded = members.filter((c) => c.health.wound !== 'none').length;
  const offices = officesOf(h, t, adults);
  const open = offices.filter((o) => !o.closed);
  const chosen = offices.find((o) => o.key === picked && !o.closed) ?? open[0];
  return (
    <div className="lh-work" data-testid="longhouse-work">
      <div className="lh-top">
        <p className="hh-big" data-testid="longhouse-summary">
          {t('people.ui.longhouse.summary', { officers: officers.length, idle, wounded })}
        </p>
        {wounded > 0 && (
          <Button
            icon="eye"
            onClick={() => navigation.open('building.seer', { person: 'seer', view: 'heal' })}
            data-testid="longhouse-to-seer"
          >
            {t('people.ui.longhouse.toSeer', { count: wounded })}
          </Button>
        )}
        <Button
          variant="ghost"
          icon="family"
          onClick={() => navigation.open('family')}
          data-testid="longhouse-to-family"
        >
          {t('people.ui.longhouse.toFamily')}
        </Button>
      </div>
      {adults.length === 0 && (
        <Empty>
          {t('people.ui.longhouse.empty', {
            name: displayName(t, h.state.characters[h.state.player.rulerId] as Character),
          })}
        </Empty>
      )}
      <div className="lh-layout">
        <ChoiceGrid columns={1} className="lh-offices" label={t('people.ui.longhouse.offices')}>
          {offices.map((o) => (
            <OfficeCard
              key={o.key}
              h={h}
              o={o}
              selected={chosen?.key === o.key}
              onSelect={() => setPicked(o.key)}
            />
          ))}
        </ChoiceGrid>
        {chosen && <OfficeFocus key={chosen.key} h={h} o={chosen} people={adults} />}
      </div>
    </div>
  );
}

/**
 * The Longhouse for a household (exported for tests): the room with the House-elder in it; his panel open when
 * `person` (controlled) or `initialPerson` says so.
 */
export function Longhouse({
  h,
  onClose,
  person,
  initialPerson,
  onPersonChange,
}: {
  h: Household;
  onClose(): void;
  person?: string | null;
  initialPerson?: 'houseElder';
  onPersonChange?(id: string | null): void;
}): ReactElement {
  const t = useT();
  const capital = capitalOf(h.state);
  return (
    <InteriorRoom
      room={longhouseRoom}
      ambience={ambienceOf(h.state)}
      subtitle={capital ? t('people.interior.longhouse.subtitle', { place: capital.name }) : undefined}
      {...(person !== undefined ? { person } : { initialPerson: initialPerson ?? null })}
      onPersonChange={onPersonChange}
      stageTestId="longhouse"
      onLeave={onClose}
      panel={() => <LonghouseWork h={h} />}
    />
  );
}

function LonghouseScreen({ params, close }: ScreenProps): ReactElement {
  const h = useHousehold();
  useMusicState('longhouse');
  const [person, setPerson] = useRoutePerson(longhouseRoom, ['building.longhouse'], params);
  if (!h) return <NoGame close={close} />;
  return <Longhouse h={h} person={person} onPersonChange={setPerson} onClose={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'longhouse',
  route: 'building.longhouse', staysUnder: true,
  component: LonghouseScreen,
  layout: 'overlay',
  titleKey: 'ui.route.building.longhouse',
};
