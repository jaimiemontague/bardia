/**
 * The character sheet (top-bar route 'character', SCR-26): the ruler by default, or any character with
 * `params.id`. Laid out by ARCHITECTURE §20: the portrait large with the name, title and four facts in words
 * (age, health, where, what they are known for) and the traits as chips; beside it the standing of the house
 * in words with the numbers next to them (the top bar no longer shows most of it) and the six best skills as
 * bars. Attributes, every skill (and spending points), level and feats, kin and the life story sit behind
 * Details, one tab each.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ATTRIBUTE_IDS, SKILL_IDS, type AttributeId, type SkillId } from '@content/schemas/ids';
import type { Command } from '@sim/core/commands';
import type { Character } from '@sim/core/state';
import { childIds, livingSpouses, parentIds, siblingIds } from '@sim/modules/people/kin';
import { allocatesManually } from '@sim/modules/people/progression';
import { effectiveAttribute, effectiveSkill } from '@sim/modules/people/util';
import { renownTierOf } from '../../app/playerSummary';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { formatNumber, tOr, useT } from '../../i18n/index';
import {
  Button,
  Disclosure,
  Icon,
  IconButton,
  Meter,
  Portrait,
  recipeForCharacter,
  Tabs,
  Tooltip,
  type IconName,
} from '../../ui/index';
import {
  ageNow,
  causeText,
  charById,
  cultureText,
  dateText,
  displayName,
  Empty,
  epithetOf,
  faithText,
  featText,
  godText,
  inPlayerHouse,
  NoGame,
  PersonCard,
  reasonText,
  roleText,
  runCommand,
  ScreenFrame,
  Section,
  stageOf,
  TraitChips,
  tryCommand,
  whereText,
  useHousehold,
  type Household,
} from './household';
import { dreadWord, favorSummary, favorWord, honorWord, loyaltyWord, pietyWord } from './standing';
import './character.css';

/** Skills shown as bars on the face of the sheet (the rest are in Details). */
const FACE_SKILLS = 6;

type DetailTab = 'attributes' | 'skills' | 'deeds' | 'kin' | 'life';

/** The `n` best skills, highest first (ties keep the catalog order). */
export function bestSkills(c: Character, n: number): SkillId[] {
  return SKILL_IDS.map((s, i) => ({ s, i, v: c.skills[s] ?? 0 }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.s);
}

function Fact({
  icon,
  children,
  tone,
  testId,
}: {
  icon: IconName;
  children: ReactNode;
  tone?: 'bad' | 'warn';
  testId?: string;
}): ReactElement {
  return (
    <li className={['cs-fact', tone && `tone-${tone}`].filter(Boolean).join(' ')} data-testid={testId}>
      <Icon name={icon} />
      <span>{children}</span>
    </li>
  );
}

function healthText(
  t: ReturnType<typeof useT>,
  h: Household,
  c: Character,
): { text: string; tone?: 'bad' | 'warn' } {
  const hp = c.health;
  const now = h.state.time.hour;
  if (hp.wound === 'mortal')
    return { text: t('people.ui.sheet.mortal', { date: dateText(hp.woundUntilHour ?? now) }), tone: 'bad' };
  if (hp.wound !== 'none') {
    const line = t('people.ui.sheet.woundUntil', {
      wound: t(`people.wound.${hp.wound}`),
      date: dateText(hp.woundUntilHour ?? now),
    });
    return {
      text: hp.treated ? `${line} ${t('people.ui.sheet.treated')}` : line,
      tone: hp.wound === 'minor' ? 'warn' : 'bad',
    };
  }
  const inj = hp.injuries.find((i) => i.untilHour !== undefined && i.untilHour > now);
  if (inj)
    return {
      text: t('people.ui.sheet.injuryUntil', {
        injury: t(`people.injury.${inj.id}`),
        date: dateText(inj.untilHour ?? now),
      }),
      tone: 'warn',
    };
  return { text: t('people.ui.sheet.hale') };
}

/** The left column: the portrait, who they are and four facts in words. */
function Hero({ h, c }: { h: Household; c: Character }): ReactElement {
  const t = useT();
  const name = displayName(t, c);
  const epithet = epithetOf(t, c);
  const age = ageNow(h.state, c);
  const stage = stageOf(h.state, h.content, c);
  const isRuler = c.id === h.state.player.rulerId;
  const health = c.alive ? healthText(t, h, c) : null;
  const wounded =
    c.alive &&
    (c.health.wound !== 'none' ||
      c.health.injuries.some((i) => i.untilHour !== undefined && i.untilHour > h.state.time.hour));
  const best = bestSkills(c, 1)[0];
  const bestValue = best !== undefined ? (c.skills[best] ?? 0) : 0;
  return (
    <div className="cs-hero" data-testid="character-identity">
      <div className="cs-portrait">
        <Portrait
          recipe={recipeForCharacter(c, h.state)}
          alt={t('people.ui.portraitAlt', { name })}
          size="xl"
          initial={c.name.slice(0, 1)}
        />
      </div>
      <div className="cs-who">
        <h3 className="cs-name" data-testid="character-name">
          {name}
        </h3>
        {epithet && <span className="cs-epithet">{epithet}</span>}
        <span className="cs-title">
          {isRuler
            ? t('people.ui.sheet.rulerOfHouse', {
                house: h.state.factions[h.state.player.factionId]?.name ?? '',
              })
            : roleText(t, h.state, c)}
        </span>
      </div>
      <ul className="cs-facts">
        <Fact icon="hourglass" testId="character-age">
          {c.alive
            ? t('people.ui.sheet.ageWords', { age, stage })
            : t('people.ui.sheet.diedAt', { age, date: dateText(c.death?.hour ?? 0) })}
        </Fact>
        {health && (
          <Fact icon="shieldRound" tone={health.tone} testId="character-health">
            <Tooltip content={t('people.ui.sheet.vitalityTip', { pct: Math.round(c.health.hpPct) })}>
              <span tabIndex={0} data-testid="character-wound">
                {health.text}
              </span>
            </Tooltip>
          </Fact>
        )}
        {c.captivity && (
          <Fact icon="warning" tone="bad">
            {t('people.ui.sheet.captivity', {
              captor: h.state.factions[c.captivity.byFactionId]?.name ?? '',
              ransom: formatNumber(c.captivity.ransom),
            })}
          </Fact>
        )}
        {c.pregnancy && (
          <Fact icon="family">{t('people.ui.sheet.pregnant', { date: dateText(c.pregnancy.dueHour) })}</Fact>
        )}
        {!c.alive && c.death ? (
          <Fact icon="moon">{causeText(t, c.death.cause)}</Fact>
        ) : (
          <Fact icon="ship">{whereText(t, h.state, c)}</Fact>
        )}
        <Fact icon="star" testId="character-known">
          {best !== undefined && bestValue > 0
            ? t('people.ui.sheet.knownFor', { skill: t(`ui.skill.${best}`) })
            : t('people.ui.sheet.knownForNothing')}
        </Fact>
      </ul>
      <TraitChips h={h} c={c} />
      {c.traits.length === 0 && <p className="hh-note">{t('people.ui.sheet.noTraitsShort')}</p>}
      {wounded && inPlayerHouse(h.state, c) && !c.health.treated && (
        <div className="hh-actions">
          <Button icon="eye" onClick={() => navigation.open('building.seer')} data-testid="character-to-seer">
            {t('people.ui.sheet.toSeer')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One standing: a word, then the number. */
function StandingRow({
  icon,
  label,
  word,
  value,
  tip,
  testId,
}: {
  icon: IconName;
  label: string;
  word: string;
  value: string;
  tip: string;
  testId: string;
}): ReactElement {
  return (
    <Tooltip content={<span className="hh-chip-tip">{tip}</span>} block>
      <div className="cs-standing" tabIndex={0} data-testid={testId}>
        <Icon name={icon} className="cs-standing-icon" />
        <span className="cs-standing-label">{label}</span>
        <span className="cs-standing-word">{word}</span>
        <span className="cs-standing-value num">{value}</span>
      </div>
    </Tooltip>
  );
}

function Standings({ h, c }: { h: Household; c: Character }): ReactElement | null {
  const t = useT();
  const house = h.state.player.house;
  if (c.id === h.state.player.rulerId) {
    const tier = renownTierOf(house.renown, h.content);
    const { avg, top } = favorSummary(house.favor);
    const lantern = house.piety !== undefined && house.faith !== 'oldways';
    return (
      <Section title={t('people.ui.sheet.standings')} icon="crown" testId="character-standings">
        <StandingRow
          icon="renown"
          label={t('ui.standing.renown')}
          word={t(`ui.renownTier.${tier}`)}
          value={formatNumber(house.renown)}
          tip={t('ui.standing.renownDesc')}
          testId="standing-renown"
        />
        <StandingRow
          icon="honor"
          label={t('ui.standing.honor')}
          word={t('people.ui.word.honor', { band: honorWord(house.honor) })}
          value={formatNumber(house.honor)}
          tip={t('ui.standing.honorDesc')}
          testId="standing-honor"
        />
        <StandingRow
          icon="dread"
          label={t('ui.standing.dread')}
          word={t('people.ui.word.dread', { band: dreadWord(house.dread) })}
          value={formatNumber(house.dread)}
          tip={t('ui.standing.dreadDesc')}
          testId="standing-dread"
        />
        {lantern ? (
          <StandingRow
            icon="favor"
            label={t('ui.standing.piety')}
            word={t('people.ui.word.piety', { band: pietyWord(house.piety ?? 0) })}
            value={formatNumber(house.piety ?? 0)}
            tip={t('ui.standing.pietyDesc')}
            testId="standing-piety"
          />
        ) : (
          <StandingRow
            icon="favor"
            label={t('ui.standing.favor')}
            word={t('people.ui.word.favor', { band: favorWord(avg) })}
            value={formatNumber(avg)}
            tip={
              top
                ? `${t('people.ui.sheet.favorDesc')} ${t('people.ui.sheet.favorTop', { god: godText(h.content, top[0]), favor: top[1] })}`
                : t('people.ui.sheet.favorDesc')
            }
            testId="standing-favor"
          />
        )}
      </Section>
    );
  }
  const rows: ReactElement[] = [];
  if (c.loyalty !== undefined && c.alive) {
    rows.push(
      <StandingRow
        key="loyalty"
        icon="favor"
        label={t('people.ui.sheet.loyalty')}
        word={t('people.ui.word.loyalty', { band: loyaltyWord(c.loyalty) })}
        value={formatNumber(Math.round(c.loyalty))}
        tip={t('people.ui.sheet.loyaltyDesc')}
        testId="standing-loyalty"
      />,
    );
  }
  if (c.personalRenown !== undefined) {
    rows.push(
      <StandingRow
        key="renown"
        icon="renown"
        label={t('ui.standing.renown')}
        word={t(`ui.renownTier.${renownTierOf(c.personalRenown, h.content)}`)}
        value={formatNumber(c.personalRenown)}
        tip={t('people.ui.sheet.personalDesc')}
        testId="standing-renown"
      />,
    );
  }
  if (c.personalHonor !== undefined) {
    rows.push(
      <StandingRow
        key="honor"
        icon="honor"
        label={t('ui.standing.honor')}
        word={t('people.ui.word.honor', { band: honorWord(c.personalHonor) })}
        value={formatNumber(c.personalHonor)}
        tip={t('people.ui.sheet.personalDesc')}
        testId="standing-honor"
      />,
    );
  }
  if (rows.length === 0) return null;
  return (
    <Section title={t('people.ui.sheet.personalStandings')} icon="crown" testId="character-standings">
      {rows}
    </Section>
  );
}

/** The six best skills as bars. */
function SkillBars({ h, c, onSpend }: { h: Household; c: Character; onSpend?(): void }): ReactElement {
  const t = useT();
  const max = h.content.balance.character.skillMax;
  const unspent = (c.unspentSkillPoints ?? 0) + (c.unspentAttributePoints ?? 0);
  return (
    <Section title={t('people.ui.sheet.skills')} icon="sword" testId="character-skills">
      <div className="cs-bars">
        {bestSkills(c, FACE_SKILLS).map((s) => {
          const v = c.skills[s] ?? 0;
          return (
            <Tooltip key={s} content={<span className="hh-chip-tip">{t(`ui.skillDesc.${s}`)}</span>} block>
              <div className="cs-bar" tabIndex={0} data-testid={`skill-${s}`}>
                <span className="cs-bar-name">{t(`ui.skill.${s}`)}</span>
                <Meter value={v} max={max} label={t(`ui.skill.${s}`)} showLabel={false} size="md" />
                <span className="cs-bar-value hh-stat-value num">{v}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>
      {onSpend && unspent > 0 && (
        <div className="hh-actions">
          <Button variant="primary" icon="plus" onClick={onSpend} data-testid="character-spend">
            {t('people.ui.sheet.spend', { points: unspent })}
          </Button>
        </div>
      )}
    </Section>
  );
}

function AllocateButton({ h, cmd, label }: { h: Household; cmd: Command; label: string }): ReactElement {
  const t = useT();
  const trial = tryCommand(h, cmd);
  return (
    <IconButton
      icon="plus"
      size="sm"
      label={trial.ok ? label : reasonText(t, trial)}
      disabled={!trial.ok}
      onClick={() => runCommand(cmd)}
    />
  );
}

function Attributes({
  h,
  c,
  canAllocate,
}: {
  h: Household;
  c: Character;
  canAllocate: boolean;
}): ReactElement {
  const t = useT();
  const unspent = c.unspentAttributePoints ?? 0;
  const max = h.content.balance.character.attributeMax;
  return (
    <div className="cs-tab" data-testid="character-attributes">
      {canAllocate && unspent > 0 && (
        <p className="hh-big">{t('people.ui.sheet.unspent', { points: unspent })}</p>
      )}
      {ATTRIBUTE_IDS.map((a: AttributeId) => {
        const base = c.attributes[a];
        const eff = effectiveAttribute(c, a, h.content);
        return (
          <div key={a} className="hh-stat" data-testid={`attr-${a}`}>
            <span className="hh-stat-name">{t(`ui.attribute.${a}`)}</span>
            <span className="hh-stat-value num">{base}</span>
            <span className="hh-stat-desc">
              {t(`ui.attributeDesc.${a}`)}
              {eff !== base && (
                <span className="hh-delta">
                  {' '}
                  {t('people.ui.sheet.effective', { value: formatNumber(Math.round(eff * 10) / 10) })}
                </span>
              )}
            </span>
            <span className="hh-stat-extra">
              {canAllocate && unspent > 0 && (
                <AllocateButton
                  h={h}
                  cmd={{ type: 'allocatePoints', charId: c.id, attributes: { [a]: 1 } }}
                  label={t('people.ui.sheet.raise', { stat: t(`ui.attribute.${a}`), max })}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AllSkills({
  h,
  c,
  canAllocate,
}: {
  h: Household;
  c: Character;
  canAllocate: boolean;
}): ReactElement {
  const t = useT();
  const unspent = c.unspentSkillPoints ?? 0;
  const max = h.content.balance.character.skillMax;
  return (
    <div className="cs-tab" data-testid="character-all-skills">
      {canAllocate && unspent > 0 && (
        <p className="hh-big">{t('people.ui.sheet.unspent', { points: unspent })}</p>
      )}
      {SKILL_IDS.map((s: SkillId) => {
        const base = c.skills[s] ?? 0;
        const eff = effectiveSkill(c, s, h.content);
        return (
          <div key={s} className="hh-stat" data-testid={`skillrow-${s}`}>
            <span className="hh-stat-name">{t(`ui.skill.${s}`)}</span>
            <span className="hh-stat-value num">{base}</span>
            <span className="hh-stat-desc">
              {t(`ui.skillDesc.${s}`)}
              {eff !== base && (
                <span className="hh-delta">
                  {' '}
                  {t('people.ui.sheet.effective', { value: formatNumber(Math.round(eff * 10) / 10) })}
                </span>
              )}
            </span>
            <span className="hh-stat-extra">
              {canAllocate && unspent > 0 && (
                <AllocateButton
                  h={h}
                  cmd={{ type: 'allocatePoints', charId: c.id, skills: { [s]: 1 } }}
                  label={t('people.ui.sheet.raise', { stat: t(`ui.skill.${s}`), max })}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Deeds({ h, c }: { h: Household; c: Character }): ReactElement {
  const t = useT();
  const xp = h.content.balance.xp;
  const table = xp.levelTable;
  const atMax = c.level >= xp.maxLevel;
  const from = table[c.level - 1] ?? 0;
  const to = table[c.level] ?? from;
  const nextFeat = xp.featLevels.find((l) => l > c.level);
  return (
    <div className="cs-tab" data-testid="character-progress">
      <p className="hh-big" data-testid="character-level">
        {t('people.ui.sheet.level', { level: c.level })}
      </p>
      {!atMax && (
        <Meter
          value={c.xp - from}
          max={Math.max(1, to - from)}
          label={t('people.ui.sheet.xp')}
          readout={t('people.ui.sheet.xpToNext', { xp: formatNumber(c.xp), next: formatNumber(to) })}
          size="sm"
        />
      )}
      {atMax && <p className="hh-note">{t('people.ui.sheet.maxLevel')}</p>}
      <p className="hh-note">{t('people.ui.sheet.xpHow')}</p>
      {nextFeat !== undefined && (
        <p className="hh-note">{t('people.ui.sheet.nextFeat', { level: nextFeat })}</p>
      )}
      {c.feats.length === 0 ? (
        <Empty>{t('people.ui.sheet.noFeats')}</Empty>
      ) : (
        <ul className="hh-list">
          {c.feats.map((id) => {
            const f = featText(h.content, id);
            return (
              <li key={id} className="hh-item" data-testid={`feat-${id}`}>
                <span className="hh-item-title">{f.name}</span>
                <span className="hh-item-desc">{f.description}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Kin({ h, c }: { h: Household; c: Character }): ReactElement {
  const t = useT();
  const groups: { key: string; ids: string[] }[] = [
    { key: 'spouses', ids: c.alive ? livingSpouses(h.state, c) : c.family.spouseIds },
    { key: 'parents', ids: parentIds(h.state, c) },
    { key: 'children', ids: childIds(h.state, c) },
    { key: 'siblings', ids: siblingIds(h.state, c) },
  ];
  const any = groups.some((g) => g.ids.length > 0);
  return (
    <div className="cs-tab" data-testid="character-kin">
      {!any && <Empty>{t('people.ui.sheet.noKin')}</Empty>}
      {groups.map((g) =>
        g.ids.length === 0 ? null : (
          <div key={g.key} className="hh-section">
            <span className="hh-kind">{t(`people.ui.sheet.kinGroup.${g.key}`)}</span>
            <div className="hh-grid">
              {g.ids.map((id) => {
                const k = charById(h.state, id);
                return k ? (
                  <PersonCard
                    key={id}
                    h={h}
                    c={k}
                    size="xs"
                    sub={
                      k.alive
                        ? t('people.ui.ageShort', { age: ageNow(h.state, k) })
                        : t('people.ui.diedOn', { date: dateText(k.death?.hour ?? 0) })
                    }
                    testId={`kin-${id}`}
                  />
                ) : null;
              })}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function Life({ h, c }: { h: Household; c: Character }): ReactElement {
  const t = useT();
  const ub =
    c.upbringingId !== undefined && Object.hasOwn(h.content.upbringings, c.upbringingId)
      ? h.content.upbringings[c.upbringingId as keyof typeof h.content.upbringings]
      : undefined;
  return (
    <div className="cs-tab" data-testid="character-life">
      <dl className="hh-facts">
        <dt>{t('people.ui.sheet.born')}</dt>
        <dd>{dateText(c.birthHour)}</dd>
        <dt>{t('people.ui.sheet.culture')}</dt>
        <dd>{cultureText(h.content, c.culture)}</dd>
        {ub && (
          <>
            <dt>{t('people.ui.sheet.upbringingFact')}</dt>
            <dd data-testid="character-upbringing">
              {t('people.ui.sheet.upbringingValue', {
                name: tOr(`core.upbringing.${c.upbringingId}.name`, ub.name),
                skill: t(`ui.skill.${ub.skill}`),
              })}
            </dd>
          </>
        )}
        <dt>{t('people.ui.sheet.faith')}</dt>
        <dd>{faithText(c.faith)}</dd>
        {c.alive && (
          <>
            <dt>{t('people.ui.sheet.vitality')}</dt>
            <dd>{t('people.ui.sheet.vitalityValue', { pct: Math.round(c.health.hpPct) })}</dd>
          </>
        )}
        {!c.alive && c.death && (
          <>
            <dt>{t('people.ui.sheet.cause')}</dt>
            <dd>{causeText(t, c.death.cause)}</dd>
          </>
        )}
      </dl>
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
    </div>
  );
}

/** The sheet itself (exported for tests). */
export function CharacterSheet({ h, c }: { h: Household; c: Character }): ReactElement {
  const t = useT();
  const canAllocate = c.alive && inPlayerHouse(h.state, c) && allocatesManually(h.state, c);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>('attributes');
  const detailsRef = useRef<HTMLDivElement>(null);
  // Opening Details brings it into view (it sits under the skill bars, below the fold on small windows).
  useEffect(() => {
    if (open) detailsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [open, tab]);
  const spend = () => {
    setTab((c.unspentSkillPoints ?? 0) > 0 ? 'skills' : 'attributes');
    setOpen(true);
  };
  return (
    <div className="cs-sheet" data-testid="character-sheet" data-char={c.id}>
      <Hero h={h} c={c} />
      <div className="cs-side">
        <Standings h={h} c={c} />
        <SkillBars h={h} c={c} {...(canAllocate ? { onSpend: spend } : {})} />
        <div ref={detailsRef}>
          <Disclosure
            variant="bar"
            summary={t('people.ui.sheet.details')}
            open={open}
            onOpenChange={setOpen}
            data-testid="character-details"
          >
            <Tabs
              label={t('people.ui.sheet.details')}
              value={tab}
              onChange={(id) => setTab(id as DetailTab)}
              tabs={[
                { id: 'attributes', label: t('people.ui.sheet.attributes') },
                { id: 'skills', label: t('people.ui.sheet.allSkills') },
                { id: 'deeds', label: t('people.ui.sheet.progress') },
                { id: 'kin', label: t('people.ui.sheet.kin') },
                { id: 'life', label: t('people.ui.sheet.life') },
              ]}
            >
              {(active) =>
                active === 'skills' ? (
                  <AllSkills h={h} c={c} canAllocate={canAllocate} />
                ) : active === 'deeds' ? (
                  <Deeds h={h} c={c} />
                ) : active === 'kin' ? (
                  <Kin h={h} c={c} />
                ) : active === 'life' ? (
                  <Life h={h} c={c} />
                ) : (
                  <Attributes h={h} c={c} canAllocate={canAllocate} />
                )
              }
            </Tabs>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

function CharacterScreen({ params, close }: ScreenProps): ReactElement {
  const t = useT();
  const h = useHousehold();
  if (!h) return <NoGame close={close} />;
  const id = typeof params?.id === 'string' ? params.id : h.state.player.rulerId;
  const c = charById(h.state, id);
  const isRuler = c?.id === h.state.player.rulerId;
  return (
    <ScreenFrame
      id="character"
      title={t('ui.route.character')}
      subtitle={c ? (isRuler ? t('people.ui.sheet.yourRuler') : displayName(t, c)) : undefined}
      close={close}
    >
      {c ? (
        <CharacterSheet key={c.id} h={h} c={c} />
      ) : (
        <Empty testId="character-missing">{t('people.ui.sheet.missing')}</Empty>
      )}
    </ScreenFrame>
  );
}

export const screen: ScreenDescriptor = {
  id: 'character',
  route: 'character',
  component: CharacterScreen,
  layout: 'overlay',
  titleKey: 'ui.route.character',
};
