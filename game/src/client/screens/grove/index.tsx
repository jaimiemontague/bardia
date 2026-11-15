/**
 * The Sacred Grove (hub building route 'building.grove'): entering it shows the clearing with its standing
 * stones, god-posts and altar stone (render/interiors/rooms/grove.tsx). Its menu waits behind one person, the
 * Grove-keeper beside the altar, and is laid out by ARCHITECTURE §20: the gods of the Old Ways as cards (name, one
 * line, the house's Favor), and beside them the one thing to do here: honour the chosen god with a sacrifice
 * (`sacrifice`): what to give, how much, and in one line what it costs and the Favor it would bring (the real
 * command tried on a copy of the state). What the god's Favor does, the omens it feeds and what raises it are
 * behind Details. Route params `{ person: 'groveKeeper' }` open his panel at once.
 *
 * Test ids: grove (the room's picture), grove-work, god-select-<god>, favor-<god>, grove-offering,
 * grove-kind-<kind>, grove-size-<size>, grove-preview, grove-sacrifice, grove-why, grove-details.
 */
import { useState, type ReactElement } from 'react';
import { GOD_IDS, type GodId } from '@content/schemas/ids';
import { OMEN_ACTIVITIES, type OfferingKind, type OfferingSize } from '@content/schemas/tunables/faith';
import type { Command } from '@sim/core/commands';
import { groveTierOf } from '@sim/modules/faith/favor';
import { monthCount, monthOf, presentAt } from '@sim/modules/faith/state';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { InteriorRoom, useRoutePerson } from '../../render/interiors/index';
import { groveRoom } from '../../render/interiors/rooms/grove';
import { ambienceOf } from '../../render/scenes/ambience';
import { Button, ChoiceCard, ChoiceGrid, Disclosure } from '../../ui/index';
import {
  faithText,
  godText,
  NoGame,
  reasonText,
  runCommand,
  silverDelta,
  tryCommand,
  useHousehold,
  Why,
  type Household,
} from '../character/household';
import { favorWord } from '../character/standing';
import { useMusicState } from '../../audio/hooks';
import './grove.css';

const KINDS: readonly OfferingKind[] = ['silver', 'livestock'];
const SIZES: readonly OfferingSize[] = ['modest', 'generous', 'lavish'];

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function GodDetails({ h, god }: { h: Household; god: GodId }): ReactElement {
  const t = useT();
  const def = h.content.gods[god];
  const activities = OMEN_ACTIVITIES.filter((a) => h.content.balance.omens.activities[a].includes(god));
  const offered = h.state.faith
    ? monthCount(h.state.faith.offerings, h.state.player.factionId, god, monthOf(h.state.time.hour))
    : 0;
  const fav = h.content.balance.standing.favor;
  return (
    <div className="gv-details">
      <p className="hh-note">{tOr(`faith.god.${god}.description`, def.description)}</p>
      <p className="hh-note">
        {t(`faith.ui.godEffect.${god}`, {
          perDie: h.content.tunables.faith.omens.valgrimFavorPerExtraDie,
          pct: Math.round((100 / Math.max(1, h.content.balance.dynasty.fjornaFavorDivisor)) * 10) / 10,
          min: h.content.balance.aging.grayQueenFavorMin,
        })}
      </p>
      <p className="hh-note">
        {activities.length > 0
          ? t('faith.ui.grove.feedsOmens', {
              activities: activities.map((a) => t(`faith.activity.${a}`)).join(', '),
            })
          : t('faith.ui.grove.noOmens')}
      </p>
      <p className="hh-note">
        {t('faith.ui.grove.rises', { deeds: def.favorRises.map((r) => t(`faith.ui.rise.${r}`)).join(', ') })}
      </p>
      {offered > 0 && <p className="hh-note">{t('faith.ui.grove.offeredThisMonth', { count: offered })}</p>}
      <p className="hh-note">{t('faith.ui.grove.rules')}</p>
      <p className="hh-note">
        {t('faith.ui.grove.about', { min: fav.min, max: fav.max, neglect: fav.neglectPerMonth })}
      </p>
    </div>
  );
}

/** Honour the chosen god: what, how much, the cost and the gain in one line, and the one gold button. */
function Offering({ h, god }: { h: Household; god: GodId }): ReactElement {
  const t = useT();
  const [kind, setKind] = useState<OfferingKind>('silver');
  const [size, setSize] = useState<OfferingSize>('modest');
  const place = presentAt(h.state, h.content.tunables.faith, h.state.player.rulerId);
  const cmd: Command =
    place !== undefined
      ? { type: 'sacrifice', god, kind, size, settlementId: place }
      : { type: 'sacrifice', god, kind, size };
  const trial = tryCommand(h, cmd);
  const sz = h.content.tunables.faith.sacrifice.sizes[size];
  const gainEvent = trial.ok ? trial.events.find((e) => e.type === 'OfferingMade') : undefined;
  const gain = gainEvent && gainEvent.type === 'OfferingMade' ? gainEvent.gain : 0;
  const silver = -silverDelta(h, trial);
  const cost =
    kind === 'silver'
      ? t('faith.ui.grove.costSilver', { silver: formatNumber(trial.ok ? silver : sz.silver) })
      : t('faith.ui.grove.costLivestock', { tons: sz.livestockTons });
  const name = godText(h.content, god);
  const favor = h.state.player.house.favor[god] ?? 0;
  return (
    <aside className="hh-focus gv-offer" data-testid="grove-offering">
      <h3 className="hh-focus-name">{t('faith.ui.grove.honour', { god: name })}</h3>
      <p className="hh-focus-line">
        {t('faith.ui.grove.favorNow', {
          word: t('people.ui.word.favor', { band: favorWord(favor) }),
          favor: signed(favor),
        })}
      </p>
      <p className="hh-ask">{t('faith.ui.grove.askWhat')}</p>
      <ChoiceGrid columns={2}>
        {KINDS.map((k) => (
          <ChoiceCard
            key={k}
            size="sm"
            icon={k === 'silver' ? 'silver' : 'food'}
            title={t(`faith.offering.kind.${k}`)}
            selected={kind === k}
            onClick={() => setKind(k)}
            data-testid={`grove-kind-${k}`}
          />
        ))}
      </ChoiceGrid>
      <p className="hh-ask">{t('faith.ui.grove.askSize')}</p>
      <ChoiceGrid columns={3}>
        {SIZES.map((s) => (
          <ChoiceCard
            key={s}
            size="sm"
            title={t(`faith.offering.size.${s}`)}
            selected={size === s}
            onClick={() => setSize(s)}
            data-testid={`grove-size-${s}`}
          />
        ))}
      </ChoiceGrid>
      <p className="hh-big" data-testid="grove-preview">
        {trial.ok
          ? t('faith.ui.grove.previewLine', { cost, god: name, gain })
          : t('faith.ui.grove.costOnly', { cost })}
      </p>
      {trial.ok && gain === 0 && <p className="hh-note tone-warn">{t('faith.ui.grove.diminished')}</p>}
      <div className="hh-actions">
        <Button
          variant="primary"
          size="lg"
          icon="favor"
          disabled={!trial.ok}
          onClick={() => runCommand(cmd)}
          data-testid="grove-sacrifice"
        >
          {t('faith.ui.grove.offer')}
        </Button>
        <Why text={reasonText(t, trial)} testId="grove-why" />
      </div>
      <Disclosure data-testid="grove-details">
        <GodDetails h={h} god={god} />
      </Disclosure>
    </aside>
  );
}

/** The Grove-keeper's panel: the gods as cards and the offering to the chosen one. */
export function GroveWork({ h }: { h: Household }): ReactElement {
  const t = useT();
  const [god, setGod] = useState<GodId>('valgrim');
  const house = h.state.player.house;
  const oldWays = house.faith === 'oldways';
  return (
    <div className="gv-work" data-testid="grove-work">
      {!oldWays && (
        <p className="hh-big tone-warn">
          {t('faith.ui.grove.notOldWays', { faith: faithText(house.faith) })}
        </p>
      )}
      <div className="gv-layout">
        <ChoiceGrid columns={1} className="gv-gods" label={t('faith.ui.grove.gods')}>
          {GOD_IDS.map((g) => {
            const favor = house.favor[g] ?? 0;
            return (
              <ChoiceCard
                key={g}
                size="sm"
                icon="sun"
                title={godText(h.content, g)}
                line={tOr(`faith.god.${g}.epithet`, h.content.gods[g].epithet)}
                selected={g === god}
                badge={
                  <span className={`gv-favor ${favor < 0 ? 'is-low' : ''}`} data-testid={`favor-${g}`}>
                    {signed(favor)}
                  </span>
                }
                onClick={() => setGod(g)}
                data-testid={`god-select-${g}`}
              />
            );
          })}
        </ChoiceGrid>
        <Offering h={h} god={god} />
      </div>
    </div>
  );
}

/**
 * The Sacred Grove for a household (exported for tests): the clearing with the Grove-keeper in it; his panel open
 * when `person` (controlled) or `initialPerson` says so.
 */
export function Grove({
  h,
  onClose,
  person,
  initialPerson,
  onPersonChange,
}: {
  h: Household;
  onClose(): void;
  person?: string | null;
  initialPerson?: 'groveKeeper';
  onPersonChange?(id: string | null): void;
}): ReactElement {
  const t = useT();
  const place = presentAt(h.state, h.content.tunables.faith, h.state.player.rulerId);
  const s = place !== undefined ? h.state.settlements[place] : undefined;
  const tier = s ? groveTierOf(h.content.tunables.faith, s) : 0;
  return (
    <InteriorRoom
      room={groveRoom}
      ambience={ambienceOf(h.state)}
      subtitle={s ? t('faith.ui.grove.at', { place: s.name, tier }) : t('faith.ui.grove.away')}
      {...(person !== undefined ? { person } : { initialPerson: initialPerson ?? null })}
      onPersonChange={onPersonChange}
      stageTestId="grove"
      onLeave={onClose}
      panel={() => <GroveWork h={h} />}
    />
  );
}

function GroveScreen({ params, close }: ScreenProps): ReactElement {
  const h = useHousehold();
  useMusicState('delve');
  const [person, setPerson] = useRoutePerson(groveRoom, ['building.grove'], params);
  if (!h) return <NoGame close={close} />;
  return <Grove h={h} person={person} onPersonChange={setPerson} onClose={close} />;
}

export const screen: ScreenDescriptor = {
  id: 'grove',
  route: 'building.grove', staysUnder: true,
  component: GroveScreen,
  layout: 'overlay',
  titleKey: 'ui.route.building.grove',
};
