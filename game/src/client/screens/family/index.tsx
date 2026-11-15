/**
 * Family and Dynasty (top-bar route 'family', SCR-27), laid out by ARCHITECTURE §20: the heir in one sentence,
 * then the people as portrait cards in three simple groups (you and your spouse, children, kin), one line each.
 * Choosing a person brings them forward on the right with the one decision in front of you, as choice cards:
 * name them heir (`designateHeir`), arrange a child's upbringing (`foster`: tutor, a lieutenant or an allied
 * court, then who or what), bring a fostered child home, or adopt a ward or a kinsman's child (`adopt`). Every
 * choice is the real command tried first, so a refusal says why. The dead of the house wait behind Details.
 * Marriage has no command of its own yet (it happens through audiences and events), so it has no button here.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { SKILL_IDS, type SkillId } from '@content/schemas/ids';
import type { Command } from '@sim/core/commands';
import type { Character, CharId, FactionId } from '@sim/core/state';
import { heirCandidates } from '@sim/modules/people/death';
import {
  childIds,
  defaultHeir,
  kinByDistance,
  livingSpouses,
  parentIds,
  siblingIds,
} from '@sim/modules/people/kin';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import {
  Button,
  ChoiceCard,
  ChoiceGrid,
  Disclosure,
  Icon,
  Portrait,
  recipeForCharacter,
} from '../../ui/index';
import {
  ageNow,
  causeText,
  charById,
  dateText,
  displayName,
  Empty,
  inPlayerHouse,
  NoGame,
  openCharacter,
  PersonCard,
  PersonChoice,
  reasonText,
  runCommand,
  ScreenFrame,
  Section,
  TraitChips,
  tryCommand,
  useHousehold,
  Why,
  type Household,
  type Trial,
} from '../character/household';
import './family.css';

type FosterChoice = 'tutor' | 'lieutenant' | 'ally';
type Relation = 'self' | 'spouse' | 'child' | 'parent' | 'sibling' | 'ward' | 'kin';

interface Person {
  c: Character;
  relation: Relation;
  testId: string;
}

/** Everyone the family screen shows, grouped (the ruler first). */
function familyOf(
  h: Household,
  ruler: Character,
): {
  you: Person[];
  children: Person[];
  kin: Person[];
  dead: Character[];
  adoptable: Set<string>;
  candidates: Set<string>;
} {
  const seen = new Set<string>([ruler.id]);
  const live = (ids: readonly string[]) =>
    ids.map((id) => charById(h.state, id)).filter((c): c is Character => c !== undefined && c.alive);
  const you: Person[] = [{ c: ruler, relation: 'self', testId: 'family-ruler-card' }];
  for (const s of live(livingSpouses(h.state, ruler))) {
    seen.add(s.id);
    you.push({ c: s, relation: 'spouse', testId: `spouse-${s.id}` });
  }
  const children: Person[] = [];
  for (const c of live(childIds(h.state, ruler))) {
    seen.add(c.id);
    children.push({ c, relation: 'child', testId: `child-${c.id}` });
  }
  const kin: Person[] = [];
  for (const c of live(parentIds(h.state, ruler))) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    kin.push({ c, relation: 'parent', testId: `elder-${c.id}` });
  }
  for (const c of live(siblingIds(h.state, ruler))) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    kin.push({ c, relation: 'sibling', testId: `elder-${c.id}` });
  }
  // Wards and kin's children who may be adopted.
  const adultAge = h.content.balance.character.adultAge;
  const own = new Set(ruler.family.childIds);
  const pool = new Set<string>();
  for (const [id] of kinByDistance(h.state, ruler.id, h.content.tunables.people.kinSearchDepth)) pool.add(id);
  for (const c of Object.values(h.state.characters))
    if (c.family.fosteredAt === ruler.id || c.family.fosteredAt === h.state.player.factionId) pool.add(c.id);
  const adoptable = new Set<string>();
  for (const c of live([...pool])) {
    if (own.has(c.id) || c.id === ruler.id || ageNow(h.state, c) >= adultAge) continue;
    adoptable.add(c.id);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    kin.push({ c, relation: 'ward', testId: `adoptable-${c.id}` });
  }
  const candidates = new Set<string>(heirCandidates(h.state));
  for (const c of live([...candidates])) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    kin.push({ c, relation: 'kin', testId: `heir-candidate-${c.id}` });
  }
  const dead = Object.values(h.state.characters)
    .filter(
      (c) =>
        !c.alive &&
        (c.factionId === h.state.player.factionId ||
          ruler.family.childIds.includes(c.id) ||
          parentIds(h.state, ruler).includes(c.id)),
    )
    .sort((a, b) => (b.death?.hour ?? 0) - (a.death?.hour ?? 0));
  return { you, children, kin, dead, adoptable, candidates };
}

function personLine(
  t: ReturnType<typeof useT>,
  h: Household,
  p: Person,
  heirId: string | undefined,
  named: boolean,
): string {
  const age = ageNow(h.state, p.c);
  const heir = p.c.id === heirId ? (named ? 'named' : 'default') : 'no';
  const fostered = p.c.upbringing ? 'yes' : 'no';
  return t('people.ui.family.cardLine', { relation: p.relation, age, heir, fostered });
}

/** The upbringing of a child: first how, then who or what, then Arrange. */
function FosterFlow({ h, child, onBack }: { h: Household; child: Character; onBack(): void }): ReactElement {
  const t = useT();
  const [mode, setMode] = useState<FosterChoice | null>(null);
  const [skill, setSkill] = useState<SkillId | null>(null);
  const [mentor, setMentor] = useState<string | null>(null);
  const [court, setCourt] = useState<string | null>(null);

  const mentors = useMemo(
    () =>
      mode !== 'lieutenant'
        ? []
        : Object.values(h.state.characters).filter(
            (c) =>
              c.alive &&
              c.id !== child.id &&
              c.id !== h.state.player.rulerId &&
              inPlayerHouse(h.state, c) &&
              tryCommand(h, { type: 'foster', childId: child.id, mode: 'lieutenant', lieutenantId: c.id }).ok,
          ),
    [h, child.id, mode],
  );
  const courts = useMemo(
    () =>
      mode !== 'ally'
        ? []
        : (Object.keys(h.state.factions) as FactionId[])
            .filter(
              (id) =>
                id !== h.state.player.factionId &&
                tryCommand(h, { type: 'foster', childId: child.id, mode: 'ally', factionId: id }).ok,
            )
            .map((id) => ({ id, name: h.state.factions[id]?.name ?? id })),
    [h, child.id, mode],
  );

  let cmd: Command | null = null;
  if (mode === 'tutor' && skill)
    cmd = { type: 'foster', childId: child.id, mode: 'tutor', focusSkill: skill };
  else if (mode === 'lieutenant' && mentor)
    cmd = { type: 'foster', childId: child.id, mode: 'lieutenant', lieutenantId: mentor as CharId };
  else if (mode === 'ally' && court)
    cmd = { type: 'foster', childId: child.id, mode: 'ally', factionId: court as FactionId };
  const trial: Trial | null = cmd
    ? tryCommand(h, cmd)
    : mode === 'lieutenant' && mentors.length === 0
      ? { ok: false, code: 'noMentor' }
      : mode === 'ally' && courts.length === 0
        ? { ok: false, code: 'noCourtFound' }
        : null;

  return (
    <div className="fam-flow" data-testid={`foster-${child.id}`}>
      {mode === null ? (
        <>
          <p className="hh-ask">{t('people.ui.family.askUpbringing')}</p>
          <ChoiceGrid columns={1}>
            {(['tutor', 'lieutenant', 'ally'] as const).map((m) => (
              <ChoiceCard
                key={m}
                icon={m === 'tutor' ? 'quill' : m === 'lieutenant' ? 'sword' : 'crown'}
                title={t(`people.ui.foster.choice.${m}`)}
                line={t(`people.ui.foster.short.${m}`)}
                onClick={() => setMode(m)}
                data-testid={`foster-mode-${m}`}
              />
            ))}
          </ChoiceGrid>
        </>
      ) : (
        <>
          <p className="hh-ask">{t(`people.ui.family.ask.${mode}`)}</p>
          {mode === 'tutor' && (
            <ChoiceGrid columns={2}>
              {SKILL_IDS.map((s) => (
                <ChoiceCard
                  key={s}
                  size="sm"
                  title={t(`ui.skill.${s}`)}
                  selected={skill === s}
                  onClick={() => setSkill(s)}
                  data-testid={`foster-skill-${s}`}
                />
              ))}
            </ChoiceGrid>
          )}
          {mode === 'lieutenant' &&
            (mentors.length === 0 ? null : (
              <ChoiceGrid columns={2}>
                {mentors.map((m) => (
                  <PersonChoice
                    key={m.id}
                    h={h}
                    c={m}
                    size="sm"
                    line={t('people.ui.ageShort', { age: ageNow(h.state, m) })}
                    selected={mentor === m.id}
                    onSelect={() => setMentor(m.id)}
                    testId={`foster-mentor-${m.id}`}
                  />
                ))}
              </ChoiceGrid>
            ))}
          {mode === 'ally' &&
            (courts.length === 0 ? null : (
              <ChoiceGrid columns={2}>
                {courts.map((c) => (
                  <ChoiceCard
                    key={c.id}
                    size="sm"
                    icon="crown"
                    title={c.name}
                    selected={court === c.id}
                    onClick={() => setCourt(c.id)}
                    data-testid={`foster-court-${c.id}`}
                  />
                ))}
              </ChoiceGrid>
            ))}
          {trial && !trial.ok && <Why text={reasonText(t, trial)} />}
        </>
      )}
      <div className="hh-actions">
        <Button
          variant="ghost"
          icon="arrowLeft"
          onClick={mode === null ? onBack : () => setMode(null)}
          data-testid="foster-back"
        >
          {t('people.ui.family.back')}
        </Button>
        {mode !== null && (
          <Button
            variant="primary"
            disabled={!cmd || !trial?.ok}
            onClick={() => cmd && runCommand(cmd) && onBack()}
            data-testid={`foster-send-${child.id}`}
          >
            {t('people.ui.family.fosterSend')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The chosen person, large, with the decisions that apply to them. */
function Focus({
  h,
  p,
  line,
  adoptable,
  candidate,
  isHeir,
}: {
  h: Household;
  p: Person;
  line: string;
  adoptable: boolean;
  candidate: boolean;
  isHeir: boolean;
}): ReactElement {
  const t = useT();
  const [fostering, setFostering] = useState(false);
  const c = p.c;
  const name = displayName(t, c);
  const ruler = charById(h.state, h.state.player.rulerId);
  const named = ruler?.family.heirId === c.id;
  const ft = h.content.tunables.people.fosterage;
  const age = ageNow(h.state, c);
  const regency = h.state.people?.regency;

  const heirCmd: Command = { type: 'designateHeir', heirId: c.id };
  const heirTrial = candidate && !named && !regency ? tryCommand(h, heirCmd) : null;
  const adoptCmd: Command = { type: 'adopt', childId: c.id };
  const adoptTrial = adoptable ? tryCommand(h, adoptCmd) : null;
  const homeCmd: Command = { type: 'foster', childId: c.id, mode: 'home' };
  const homeTrial = c.upbringing ? tryCommand(h, homeCmd) : null;
  const canFoster =
    p.relation === 'child' &&
    !c.upbringing &&
    c.location.kind !== 'captive' &&
    age >= ft.minAge &&
    age <= ft.maxAge;
  const tooYoung = p.relation === 'child' && !c.upbringing && age < ft.minAge;

  return (
    <aside className="hh-focus fam-focus" data-testid="family-focus" data-char={c.id}>
      <div className="hh-focus-head">
        <Portrait
          recipe={recipeForCharacter(c, h.state)}
          alt={t('people.ui.portraitAlt', { name })}
          size="lg"
          initial={c.name.slice(0, 1)}
        />
        <div>
          <h3 className="hh-focus-name">{name}</h3>
          <p className="hh-focus-line">{line}</p>
        </div>
      </div>
      <TraitChips h={h} c={c} testPrefix={`family-trait-`} />
      {c.upbringing && (
        <p className="hh-note">
          {t('people.ui.sheet.upbringing', {
            mode: c.upbringing.mode,
            skill: t(`ui.skill.${c.upbringing.focusSkill}`),
            mentor: charById(h.state, c.upbringing.mentorId)?.name ?? '',
            court:
              c.upbringing.factionId !== undefined
                ? (h.state.factions[c.upbringing.factionId]?.name ?? '')
                : '',
          })}
        </p>
      )}
      {fostering ? (
        <FosterFlow h={h} child={c} onBack={() => setFostering(false)} />
      ) : (
        <>
          {(heirTrial || adoptTrial || homeTrial || canFoster) && (
            <p className="hh-ask">{t('people.ui.family.askWhat')}</p>
          )}
          <ChoiceGrid columns={1}>
            {heirTrial && (
              <ChoiceCard
                icon="crown"
                title={t('people.ui.family.designate')}
                line={t('people.ui.family.designateLine', { name: c.name })}
                disabled={!heirTrial.ok}
                reason={reasonText(t, heirTrial)}
                onClick={() => runCommand(heirCmd)}
                data-testid={`designate-${c.id}`}
              />
            )}
            {canFoster && (
              <ChoiceCard
                icon="quill"
                title={t('people.ui.family.arrange')}
                line={t('people.ui.family.arrangeLine')}
                onClick={() => setFostering(true)}
                data-testid={`foster-start-${c.id}`}
              />
            )}
            {homeTrial && (
              <ChoiceCard
                icon="arrowLeft"
                title={t('people.ui.family.bringHome')}
                line={t('people.ui.family.bringHomeLine')}
                disabled={!homeTrial.ok}
                reason={reasonText(t, homeTrial)}
                onClick={() => runCommand(homeCmd)}
                data-testid={`foster-home-${c.id}`}
              />
            )}
            {adoptTrial && (
              <ChoiceCard
                icon="plus"
                title={t('people.ui.family.adopt')}
                line={t('people.ui.family.adoptLine', {
                  honor: h.content.balance.dynasty.succession.adoptionHonorMin,
                })}
                disabled={!adoptTrial.ok}
                reason={reasonText(t, adoptTrial)}
                onClick={() => runCommand(adoptCmd)}
                data-testid={`adopt-${c.id}`}
              />
            )}
          </ChoiceGrid>
          {isHeir && named && (
            <p className="hh-big fam-named">
              <Icon name="crown" /> {t('people.ui.family.namedHeir')}
            </p>
          )}
          {tooYoung && <p className="hh-note">{t('people.ui.family.fosterLater', { age: ft.minAge })}</p>}
        </>
      )}
      <div className="hh-actions">
        <Button
          variant="ghost"
          icon="character"
          onClick={() => openCharacter(c.id)}
          data-testid="family-open-sheet"
        >
          {t('people.ui.family.openSheet')}
        </Button>
      </div>
    </aside>
  );
}

function HeirLine({ h, ruler }: { h: Household; ruler: Character }): ReactElement {
  const t = useT();
  const regency = h.state.people?.regency;
  const heir = charById(h.state, defaultHeir(h.state, ruler));
  return (
    <p className="fam-heir" data-testid="family-heir">
      <Icon name="crown" />
      {regency ? (
        <span data-testid="family-regency">
          {t('people.ui.family.regency', {
            heir: charById(h.state, regency.heirId)?.name ?? '',
            regent: charById(h.state, regency.regentId)?.name ?? '',
            hasRegent: regency.regentId !== undefined ? 'yes' : 'no',
          })}
        </span>
      ) : heir ? (
        <span data-testid="family-current-heir">
          {t('people.ui.family.heirLine', {
            name: displayName(t, heir),
            named: ruler.family.heirId === heir.id ? 'yes' : 'no',
          })}
        </span>
      ) : (
        <span data-testid="family-no-heir">{t('people.ui.family.noHeir')}</span>
      )}
    </p>
  );
}

function FamilyView({ h }: { h: Household }): ReactElement {
  const t = useT();
  const ruler = charById(h.state, h.state.player.rulerId);
  const [picked, setPicked] = useState<string | null>(null);
  if (!ruler) return <Empty>{t('people.ui.family.noRuler')}</Empty>;
  const fam = familyOf(h, ruler);
  const heirId = defaultHeir(h.state, ruler);
  const named = ruler.family.heirId !== undefined && ruler.family.heirId === heirId;
  const everyone = [...fam.you, ...fam.children, ...fam.kin];
  const chosen =
    everyone.find((p) => p.c.id === picked) ?? everyone.find((p) => p.c.id === heirId) ?? everyone[0];
  const card = (p: Person) => (
    <PersonChoice
      key={p.c.id}
      h={h}
      c={p.c}
      line={personLine(t, h, p, heirId, named)}
      selected={chosen?.c.id === p.c.id}
      onSelect={() => setPicked(p.c.id)}
      {...(p.c.id === heirId ? { badge: t('people.ui.family.heirBadge') } : {})}
      testId={p.testId}
    />
  );
  return (
    <div className="fam-layout">
      <div className="fam-people">
        <HeirLine h={h} ruler={ruler} />
        <Section
          title={t('people.ui.family.you', { married: fam.you.length > 1 ? 'yes' : 'no' })}
          icon="character"
          testId="family-ruler"
        >
          <div className="fam-grid">{fam.you.map(card)}</div>
          {fam.you.length === 1 && (
            <p className="hh-note" data-testid="family-no-spouse">
              {t('people.ui.family.unmarried')}
            </p>
          )}
        </Section>
        <Section
          title={t('people.ui.family.children')}
          icon="family"
          testId="family-children"
          aside={
            fam.children.length > 0
              ? t('people.ui.family.childCount', { count: fam.children.length })
              : undefined
          }
        >
          {fam.children.length === 0 ? (
            <Empty testId="family-no-children">{t('people.ui.family.noChildren')}</Empty>
          ) : (
            <div className="fam-grid">{fam.children.map(card)}</div>
          )}
        </Section>
        <Section title={t('people.ui.family.kin')} icon="family" testId="family-kin">
          {fam.kin.length === 0 ? (
            <Empty>{t('people.ui.family.noKin')}</Empty>
          ) : (
            <div className="fam-grid">{fam.kin.map(card)}</div>
          )}
        </Section>
        <Disclosure
          summary={t('people.ui.family.deadCount', { count: fam.dead.length })}
          data-testid="family-dead"
        >
          {fam.dead.length === 0 ? (
            <Empty>{t('people.ui.family.noDead')}</Empty>
          ) : (
            <div className="hh-grid">
              {fam.dead.map((c) => (
                <PersonCard
                  key={c.id}
                  h={h}
                  c={c}
                  size="xs"
                  sub={t('people.ui.family.deathLine', {
                    age: ageNow(h.state, c),
                    date: dateText(c.death?.hour ?? 0),
                    cause: causeText(t, c.death?.cause),
                  })}
                  testId={`dead-${c.id}`}
                />
              ))}
            </div>
          )}
        </Disclosure>
      </div>
      {chosen && (
        <Focus
          key={chosen.c.id}
          h={h}
          p={chosen}
          line={personLine(t, h, chosen, heirId, named)}
          adoptable={fam.adoptable.has(chosen.c.id)}
          candidate={fam.candidates.has(chosen.c.id)}
          isHeir={chosen.c.id === heirId}
        />
      )}
    </div>
  );
}

function FamilyScreen({ close }: ScreenProps): ReactElement {
  const t = useT();
  const h = useHousehold();
  if (!h) return <NoGame close={close} />;
  return (
    <ScreenFrame
      id="family"
      title={t('ui.route.family')}
      subtitle={h.state.factions[h.state.player.factionId]?.name}
      close={close}
    >
      <FamilyView h={h} />
    </ScreenFrame>
  );
}

export const screen: ScreenDescriptor = {
  id: 'family',
  route: 'family',
  component: FamilyScreen,
  layout: 'overlay',
  titleKey: 'ui.route.family',
};
