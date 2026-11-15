/**
 * The ten steps of the New Saga wizard (§5.1). Each step edits `choices` through `update`; rules
 * (points, caps, exclusions) live in app/newSaga/model.ts.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Content } from '@content/index';
import { ATTRIBUTE_IDS, DIFFICULTY_IDS, HOMELAND_CULTURE_IDS, SKILL_IDS, type AttributeId, type SkillId } from '@content/schemas/ids';
import { UPBRINGING_IDS } from '@content/schemas/upbringings';
import { generatePersonalName } from '@sim/core/names';
import {
  attributeAllocCap,
  attributePointsAvailable,
  attributePointsSpent,
  chosenTraits,
  negativeTraitIds,
  PORTRAIT_LAYER_COUNTS,
  PORTRAIT_LAYERS,
  previewCharacter,
  randomSeed,
  skillPointsAvailable,
  skillPointsSpent,
  TOGGLE_IDS,
  traitConflicts,
  withDifficulty,
  NAME_MAX,
  type NewSagaChoices,
  type PortraitLayerKey,
  type StatLine,
} from '../../app/newSaga/model';
import type { JarldomOption } from '../../app/newSaga/provinces';
import { wizardDice } from '../../app/newSaga/store';
import type { ScreenRegistry } from '../../app/screenRegistry';
import { AssetImage } from '../../assets/index';
import { formatNumber, tOr, useT } from '../../i18n/index';
import { Button, Field, FormulaBreakdown, Icon, IconButton, Portrait, Segmented, TextInput, Toggle, Tooltip, type PortraitRecipe } from '../../ui/index';

export interface StepProps {
  choices: NewSagaChoices;
  content: Content;
  update(patch: Partial<NewSagaChoices>): void;
  jarldoms: readonly JarldomOption[];
  registry: ScreenRegistry;
}

/** Display name of a content entry: locale override when present, else the data's name. */
export function traitName(id: string, content: Content): string {
  return tOr(`core.trait.${id}.name`, content.traits[id]?.name ?? id);
}
export function traitDesc(id: string, content: Content): string {
  return tOr(`core.trait.${id}.description`, content.traits[id]?.description ?? '');
}
export function cultureName(id: string, content: Content): string {
  return tOr(`core.culture.${id}.name`, content.cultures[id as keyof Content['cultures']]?.name ?? id);
}
export function upbringingName(id: string, content: Content): string {
  return tOr(`core.upbringing.${id}.name`, content.upbringings[id as keyof Content['upbringings']]?.name ?? id);
}

/** The portrait recipe of the character being created. */
export function wizardPortrait(c: NewSagaChoices, rank: PortraitRecipe['rank'] = 'ruler'): PortraitRecipe {
  const layers: Record<string, number> = {};
  for (const k of PORTRAIT_LAYERS) {
    const v = c.portrait.layers[k];
    if (v !== undefined) layers[k] = v;
  }
  return {
    seed: c.portrait.seed,
    sex: c.sex,
    culture: c.culture,
    age: 16,
    rank,
    traits: c.portrait.scars ? ['scarred'] : [],
    ...(Object.keys(layers).length > 0 ? { layers } : {}),
  };
}

function ChoiceCard({ selected, onSelect, title, children, disabled, testId, badge, picture }: { selected: boolean; onSelect(): void; title: ReactNode; children?: ReactNode; disabled?: boolean; testId?: string; badge?: ReactNode; picture?: ReactNode }): ReactElement {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} className={['choice-card', selected && 'is-selected', picture !== undefined && 'has-picture'].filter(Boolean).join(' ')} onClick={onSelect} data-testid={testId}>
      {picture !== undefined && (
        <span className="choice-card-picture" aria-hidden="true">
          {picture}
        </span>
      )}
      <span className="choice-card-head">
        <span className="choice-card-title">{title}</span>
        {badge}
        <span className="choice-card-check" aria-hidden="true">
          <Icon name="check" />
        </span>
      </span>
      {children && <span className="choice-card-body">{children}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Identity

export function IdentityStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  const cycle = (k: PortraitLayerKey, dir: 1 | -1) => {
    const n = PORTRAIT_LAYER_COUNTS[k];
    const cur = c.portrait.layers[k];
    const next = cur === undefined ? (dir === 1 ? 0 : n - 1) : (cur + dir + n) % n;
    update({ portrait: { ...c.portrait, layers: { ...c.portrait.layers, [k]: next } } });
  };
  return (
    <div className="step-identity">
      <div className="identity-portrait">
        <Portrait recipe={wizardPortrait(c)} alt={t('menu.newSaga.identity.portraitAlt', { name: c.name || '—' })} size="xl" initial={c.name.slice(0, 1)} />
        <div className="identity-layers">
          {PORTRAIT_LAYERS.filter((k) => k !== 'beard' || c.sex === 'male').map((k) => (
            <div key={k} className="layer-picker">
              <IconButton icon="chevronLeft" label={t('menu.newSaga.identity.prev', { layer: t(`menu.newSaga.identity.layer.${k}`) })} size="sm" onClick={() => cycle(k, -1)} noTooltip />
              <span className="layer-picker-label">
                {t(`menu.newSaga.identity.layer.${k}`)}
                <span className="num faint">{c.portrait.layers[k] === undefined ? t('menu.newSaga.identity.auto') : `${(c.portrait.layers[k] ?? 0) + 1}/${PORTRAIT_LAYER_COUNTS[k]}`}</span>
              </span>
              <IconButton icon="chevronRight" label={t('menu.newSaga.identity.next', { layer: t(`menu.newSaga.identity.layer.${k}`) })} size="sm" onClick={() => cycle(k, 1)} noTooltip />
            </div>
          ))}
          <Toggle checked={c.portrait.scars} onChange={(v) => update({ portrait: { ...c.portrait, scars: v } })} label={t('menu.newSaga.identity.scars')} />
          <Button size="sm" icon="dice" onClick={() => update({ portrait: { seed: wizardDice().u32(), layers: {}, scars: c.portrait.scars } })} data-testid="new-face">
            {t('menu.newSaga.identity.newFace')}
          </Button>
        </div>
      </div>
      <div className="identity-fields">
        <Field label={t('menu.newSaga.identity.name')} hint={t('menu.newSaga.identity.nameHint', { max: NAME_MAX })}>
          {(id, described) => (
            <div className="row">
              <TextInput id={id} aria-describedby={described} value={c.name} maxLength={NAME_MAX + 8} onChange={(e) => update({ name: e.currentTarget.value })} data-testid="saga-name" autoComplete="off" spellCheck={false} />
              <IconButton icon="dice" label={t('menu.newSaga.identity.randomName')} onClick={() => update({ name: generatePersonalName(wizardDice(), content.cultures[c.culture].naming, c.sex) })} variant="secondary" />
            </div>
          )}
        </Field>
        <Segmented
          label={t('menu.newSaga.identity.sex')}
          value={c.sex}
          onChange={(sex) => update({ sex })}
          options={[
            { value: 'female', label: t('menu.newSaga.identity.female') },
            { value: 'male', label: t('menu.newSaga.identity.male') },
          ]}
        />
        <p className="step-note">
          <Icon name="info" /> {t('menu.newSaga.identity.sexNote')}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Homeland

export function HomelandStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  return (
    <div className="card-grid card-grid-3 card-grid-homeland" role="radiogroup" aria-label={t('menu.newSaga.step.homeland')}>
      {HOMELAND_CULTURE_IDS.map((id) => {
        const def = content.cultures[id];
        return (
          <ChoiceCard
            key={id}
            selected={c.culture === id}
            onSelect={() => update({ culture: id, startProvinceId: c.culture === id ? c.startProvinceId : null })}
            title={cultureName(id, content)}
            testId={`homeland-${id}`}
            picture={<AssetImage id={`menu.homeland.${id}`} alt="" fit="cover" width="100%" height="100%" />}
          >
            <span className="card-meta">
              {t('menu.newSaga.homeland.region', { region: def.region })} · {t(`ui.faith.${def.faith}`)}
            </span>
            <ul className="bonus-list">
              {def.bonuses.map((b) => (
                <li key={b.id}>
                  <strong>{tOr(`core.culture.${id}.bonus.${b.id}.name`, b.name)}</strong>
                  <span>{tOr(`core.culture.${id}.bonus.${b.id}.description`, b.description)}</span>
                </li>
              ))}
            </ul>
            {def.uniqueUnits.length > 0 && (
              <span className="card-meta">
                <Icon name="shieldRound" /> {t('menu.newSaga.homeland.uniqueUnits', { units: def.uniqueUnits.map((u) => tOr(`core.unit.${u}.name`, content.balance.units[u]?.name ?? u)).join(', ') })}
              </span>
            )}
          </ChoiceCard>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Parentage

export function ParentageStep({ choices: c, update }: StepProps): ReactElement {
  const t = useT();
  return (
    <div className="stack">
      <p className="step-lede">{t('menu.newSaga.parentage.lede')}</p>
      <div className="card-grid card-grid-2" role="radiogroup" aria-label={t('menu.newSaga.step.parentage')}>
        {(['father', 'mother'] as const).map((p) => (
          <ChoiceCard key={p} selected={c.slainParent === p} onSelect={() => update({ slainParent: p })} title={t(`menu.newSaga.parentage.${p}`)} testId={`parentage-${p}`}>
            <span>{t(`menu.newSaga.parentage.${p}Desc`)}</span>
          </ChoiceCard>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Upbringing

export function UpbringingStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  const bonus = content.balance.character.upbringingSkillBonus;
  const starting = content.upbringings[c.upbringing].startingTrait;
  return (
    <div className="stack">
      <div className="card-grid card-grid-4" role="radiogroup" aria-label={t('menu.newSaga.step.upbringing')}>
        {UPBRINGING_IDS.map((id) => {
          const def = content.upbringings[id];
          return (
            <ChoiceCard key={id} selected={c.upbringing === id} onSelect={() => update({ upbringing: id })} title={upbringingName(id, content)} testId={`upbringing-${id}`}>
              <span className="card-stat">
                <Icon name="plus" /> {t('menu.newSaga.upbringing.skillBonus', { bonus, skill: t(`ui.skill.${def.skill}`) })}
              </span>
              <span className="card-meta">{t('menu.newSaga.upbringing.unlocks', { trait: traitName(def.startingTrait, content) })}</span>
            </ChoiceCard>
          );
        })}
      </div>
      <div className="step-callout">
        <Toggle
          checked={c.takeStartingTrait}
          onChange={(v) => update({ takeStartingTrait: v })}
          label={t('menu.newSaga.upbringing.takeTrait', { trait: traitName(starting, content) })}
          hint={traitDesc(starting, content)}
          data-testid="take-starting-trait"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 5–6. Points (skills, attributes)

function StatTip({ title, line, kind }: { title: string; line: StatLine; kind: 'skill' | 'attribute' }): ReactElement {
  const t = useT();
  const rows = [
    ...(kind === 'attribute' ? [{ label: t('menu.newSaga.points.base'), value: line.base, op: undefined }] : []),
    { label: t('menu.newSaga.points.allocated'), value: line.allocated },
    ...(line.upbringing ? [{ label: t('menu.newSaga.points.fromUpbringing'), value: line.upbringing }] : []),
    ...(line.culture ? [{ label: t('menu.newSaga.points.fromCulture'), value: line.culture }] : []),
    ...(line.traits ? [{ label: t('menu.newSaga.points.fromTraits'), value: line.traits }] : []),
  ];
  return (
    <FormulaBreakdown
      title={title}
      total={line.total}
      rows={rows.map((r, i) => ({ label: r.label, value: r.value > 0 && i > 0 ? `+${r.value}` : r.value, op: i === 0 ? undefined : r.value < 0 ? '−' : '+', tone: r.value < 0 ? 'bad' : undefined }))}
    />
  );
}

function PointRow({ id, label, desc, line, cap, canAdd, onChange, kind }: { id: string; label: string; desc: string; line: StatLine; cap: number; canAdd: boolean; onChange(v: number): void; kind: 'skill' | 'attribute' }): ReactElement {
  const t = useT();
  const bonus = line.upbringing + line.culture + line.traits;
  return (
    <div className="point-row" data-testid={`points-${id}`}>
      <div className="point-name">
        <span className="point-label">{label}</span>
        <span className="point-desc">{desc}</span>
      </div>
      <div className="point-ctrl">
        <IconButton icon="minus" label={t('menu.newSaga.points.decrease', { name: label })} size="sm" variant="secondary" disabled={line.allocated <= 0} onClick={() => onChange(line.allocated - 1)} noTooltip />
        <span className="point-pips" aria-label={t('menu.newSaga.points.allocatedAria', { value: line.allocated, max: cap })}>
          {Array.from({ length: cap }, (_, i) => (
            <span key={i} className={i < line.allocated ? 'pip is-on' : 'pip'} />
          ))}
        </span>
        <IconButton icon="plus" label={t('menu.newSaga.points.increase', { name: label })} size="sm" variant="secondary" disabled={!canAdd || line.allocated >= cap} onClick={() => onChange(line.allocated + 1)} noTooltip />
      </div>
      <span className={['point-bonus', bonus > 0 ? 'tone-good' : bonus < 0 ? 'tone-bad' : 'faint'].join(' ')}>{bonus === 0 ? '' : bonus > 0 ? `+${bonus}` : `${bonus}`}</span>
      <Tooltip content={<StatTip title={label} line={line} kind={kind} />} placement="left">
        <span className="point-total num" tabIndex={0} data-testid={`total-${id}`}>
          {line.total}
        </span>
      </Tooltip>
    </div>
  );
}

function PointsHeader({ spent, available, labelKey }: { spent: number; available: number; labelKey: string }): ReactElement {
  const t = useT();
  const left = available - spent;
  return (
    <div className={['points-header', left < 0 ? 'tone-bad' : left === 0 ? 'tone-good' : ''].join(' ')} aria-live="polite" data-testid="points-left">
      <Icon name={left === 0 ? 'check' : 'info'} />
      {t(labelKey, { left, available })}
    </div>
  );
}

export function SkillsStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  const preview = previewCharacter(c, content);
  const available = skillPointsAvailable(c, content);
  const spent = skillPointsSpent(c);
  const cap = content.balance.character.skillCreationCap;
  return (
    <div className="stack">
      <PointsHeader spent={spent} available={available} labelKey="menu.newSaga.skills.left" />
      <p className="step-note">{t('menu.newSaga.skills.rules', { cap, negative: content.balance.character.negativeTraitSkillPoints })}</p>
      <div className="point-list">
        {SKILL_IDS.map((s: SkillId) => (
          <PointRow key={s} id={s} kind="skill" label={t(`ui.skill.${s}`)} desc={t(`ui.skillDesc.${s}`)} line={preview.skills[s]} cap={cap} canAdd={spent < available} onChange={(v) => update({ skills: { ...c.skills, [s]: v } })} />
        ))}
      </div>
    </div>
  );
}

export function AttributesStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  const preview = previewCharacter(c, content);
  const available = attributePointsAvailable(c, content);
  const spent = attributePointsSpent(c);
  const cap = attributeAllocCap(content);
  return (
    <div className="stack">
      <PointsHeader spent={spent} available={available} labelKey="menu.newSaga.attributes.left" />
      <p className="step-note">{t('menu.newSaga.attributes.rules', { start: content.balance.character.attributeStart, cap: content.balance.character.attributeCreationCap })}</p>
      <div className="point-list">
        {ATTRIBUTE_IDS.map((a: AttributeId) => (
          <PointRow key={a} id={a} kind="attribute" label={t(`ui.attribute.${a}`)} desc={t(`ui.attributeDesc.${a}`)} line={preview.attributes[a]} cap={cap} canAdd={spent < available} onChange={(v) => update({ attributes: { ...c.attributes, [a]: v } })} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Trait

export function TraitStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  const options = content.upbringings[c.upbringing].traitOptions;
  const others = chosenTraits({ ...c, negativeTrait: null }, content);
  const negatives = negativeTraitIds(content);
  return (
    <div className="stack">
      <h3 className="step-subhead">{t('menu.newSaga.trait.positive')}</h3>
      <div className="card-grid card-grid-3" role="radiogroup" aria-label={t('menu.newSaga.trait.positive')}>
        {options.map((id) => (
          <ChoiceCard key={id} selected={c.positiveTrait === id} onSelect={() => update({ positiveTrait: id })} title={traitName(id, content)} testId={`trait-${id}`}>
            <span>{traitDesc(id, content)}</span>
          </ChoiceCard>
        ))}
      </div>
      <h3 className="step-subhead">{t('menu.newSaga.trait.negative', { points: content.balance.character.negativeTraitSkillPoints })}</h3>
      <div className="chip-grid" role="radiogroup" aria-label={t('menu.newSaga.trait.negativeAria')}>
        <button type="button" role="radio" aria-checked={c.negativeTrait === null} className={['trait-chip', c.negativeTrait === null && 'is-selected'].filter(Boolean).join(' ')} onClick={() => update({ negativeTrait: null })}>
          {t('menu.newSaga.trait.none')}
        </button>
        {negatives.map((id) => {
          const conflict = traitConflicts(id, others, content);
          return (
            <Tooltip key={id} content={conflict ? t('menu.newSaga.trait.conflict') : traitDesc(id, content)}>
              <button type="button" role="radio" aria-checked={c.negativeTrait === id} disabled={conflict} className={['trait-chip', 'is-flaw', c.negativeTrait === id && 'is-selected'].filter(Boolean).join(' ')} onClick={() => update({ negativeTrait: id })} data-testid={`flaw-${id}`}>
                {traitName(id, content)}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 8. Jarldom

function Pips({ n }: { n: 1 | 2 | 3 }): ReactElement {
  const t = useT();
  return (
    <span className="difficulty-pips" aria-label={t('menu.newSaga.jarldom.difficultyAria', { n })}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'pip is-on' : 'pip'} />
      ))}
    </span>
  );
}

export function JarldomStep({ choices: c, content, update, jarldoms, registry }: StepProps): ReactElement {
  const t = useT();
  const picker = registry.forRoute('jarldomPicker');
  const preset = content.balance.difficulty[c.difficulty];
  const men = Object.values(preset.startUnits).reduce((a, b) => a + b, 0);
  const ships = Object.entries(preset.ships)
    .map(([k, n]) => `${n} ${tOr(`core.ship.${k}.name`, content.balance.ships[k as keyof typeof content.balance.ships]?.name ?? k)}`)
    .join(', ');
  if (picker) {
    const Picker = picker.component;
    return <Picker params={{ culture: c.culture, selected: c.startProvinceId ?? '' }} close={() => {}} />;
  }
  const mine = jarldoms.filter((j) => j.culture === c.culture);
  return (
    <div className="stack">
      <p className="step-lede">{t('menu.newSaga.jarldom.lede', { homeland: cultureName(c.culture, content) })}</p>
      <div className="card-grid card-grid-3" role="radiogroup" aria-label={t('menu.newSaga.step.jarldom')}>
        <ChoiceCard selected={c.startProvinceId === null} onSelect={() => update({ startProvinceId: null })} title={t('menu.newSaga.jarldom.fate')} testId="jarldom-fate">
          <span>{t('menu.newSaga.jarldom.fateDesc')}</span>
        </ChoiceCard>
        {mine.map((j) => (
          <ChoiceCard key={j.provinceId} selected={c.startProvinceId === j.provinceId} onSelect={() => update({ startProvinceId: j.provinceId })} title={j.name} badge={<Pips n={j.difficultyPips} />} testId={`jarldom-${j.provinceId}`}>
            <span className="card-meta">{t('menu.newSaga.jarldom.kingdom', { kingdom: j.kingdomName })}</span>
            <span>{j.capitalName ? (j.capitalTier ? t('menu.newSaga.jarldom.capital', { capital: j.capitalName, tier: t(`ui.tier.${j.capitalTier}`) }) : t('menu.newSaga.jarldom.capitalOnly', { capital: j.capitalName })) : t('menu.newSaga.jarldom.noCapital')}</span>
            <span className="card-meta">{t('menu.newSaga.jarldom.forces', { men, ships })}</span>
            {j.tags.length > 0 && (
              <span className="tag-row">
                {j.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="badge">
                    {tOr(`ui.provinceTag.${tag}`, tag)}
                  </span>
                ))}
              </span>
            )}
          </ChoiceCard>
        ))}
      </div>
      {mine.length === 0 && (
        <p className="step-note">
          <Icon name="info" /> {t('menu.newSaga.jarldom.noMap')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 9. Difficulty and options

export function DifficultyStep({ choices: c, content, update }: StepProps): ReactElement {
  const t = useT();
  return (
    <div className="stack">
      <div className="card-grid card-grid-4" role="radiogroup" aria-label={t('menu.newSaga.step.difficulty')}>
        {DIFFICULTY_IDS.map((id) => {
          const p = content.balance.difficulty[id];
          const men = Object.values(p.startUnits).reduce((a, b) => a + b, 0);
          const ships = Object.values(p.ships).reduce((a, b) => a + b, 0);
          return (
            <ChoiceCard
              key={id}
              selected={c.difficulty === id}
              onSelect={() => update(withDifficulty(c, id, content))}
              title={t(`ui.difficulty.${id}`)}
              badge={id === 'raider' ? <span className="badge badge-accent">{t('menu.newSaga.difficulty.default')}</span> : undefined}
              testId={`difficulty-${id}`}
            >
              <span className="card-meta italic">{t(`ui.difficultyDesc.${id}`)}</span>
              <dl className="preset-table">
                <dt>{t('ui.topbar.silver')}</dt>
                <dd className="num">{formatNumber(p.startSilver)}</dd>
                <dt>{t('ui.topbar.men')}</dt>
                <dd className="num">{men}</dd>
                <dt>{t('menu.newSaga.difficulty.ships')}</dt>
                <dd className="num">{ships}</dd>
                <dt>{t('menu.newSaga.difficulty.lieutenants')}</dt>
                <dd className="num">{p.lieutenants}</dd>
                <dt>{t('ui.topbar.food')}</dt>
                <dd className="num">{t('ui.topbar.months', { months: p.foodMonths })}</dd>
                <dt>{t('menu.newSaga.difficulty.points')}</dt>
                <dd className="num">
                  {p.skillPoints} / {p.attributePoints}
                </dd>
                <dt>{t('menu.newSaga.difficulty.aggression')}</dt>
                <dd className="num">×{p.aiAggressionMult}</dd>
              </dl>
            </ChoiceCard>
          );
        })}
      </div>
      <div className="toggle-grid">
        {TOGGLE_IDS.map((id) => (
          <Toggle key={id} checked={c.toggles[id]} onChange={(v) => update({ toggles: { ...c.toggles, [id]: v } })} label={t(`menu.newSaga.option.${id}`)} hint={t(`menu.newSaga.option.${id}Hint`)} data-testid={`option-${id}`} />
        ))}
      </div>
      <Field label={t('menu.newSaga.difficulty.seed')} hint={t('menu.newSaga.difficulty.seedHint')}>
        {(id, described) => (
          <div className="row seed-row">
            <TextInput id={id} aria-describedby={described} value={c.seed} onChange={(e) => update({ seed: e.currentTarget.value })} spellCheck={false} autoComplete="off" data-testid="saga-seed" />
            <IconButton icon="dice" label={t('menu.newSaga.difficulty.newSeed')} variant="secondary" onClick={() => update({ seed: randomSeed(wizardDice()) })} />
          </div>
        )}
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 10. Confirm

export function ConfirmStep({ choices: c, content, jarldoms }: StepProps): ReactElement {
  const t = useT();
  const preview = previewCharacter(c, content);
  const province = jarldoms.find((j) => j.provinceId === c.startProvinceId);
  const topSkills = [...SKILL_IDS].sort((a, b) => preview.skills[b].total - preview.skills[a].total).slice(0, 4);
  return (
    <div className="confirm-card" data-testid="confirm-card">
      <Portrait recipe={wizardPortrait(c)} alt={t('menu.newSaga.identity.portraitAlt', { name: c.name })} size="lg" initial={c.name.slice(0, 1)} />
      <div className="confirm-text">
        <p className="confirm-verse">
          {t('menu.newSaga.confirm.verse', {
            name: c.name,
            sex: c.sex,
            homeland: cultureName(c.culture, content),
            parent: c.slainParent,
            upbringing: upbringingName(c.upbringing, content),
          })}
        </p>
        <dl className="confirm-facts">
          <dt>{t('menu.newSaga.step.homeland')}</dt>
          <dd>{cultureName(c.culture, content)}</dd>
          <dt>{t('menu.newSaga.step.upbringing')}</dt>
          <dd>{upbringingName(c.upbringing, content)}</dd>
          <dt>{t('menu.newSaga.confirm.traits')}</dt>
          <dd>{preview.traits.map((id) => traitName(id, content)).join(', ') || '—'}</dd>
          <dt>{t('menu.newSaga.confirm.strengths')}</dt>
          <dd>{topSkills.map((s) => `${t(`ui.skill.${s}`)} ${preview.skills[s].total}`).join(' · ')}</dd>
          <dt>{t('menu.newSaga.confirm.attributes')}</dt>
          <dd>{ATTRIBUTE_IDS.map((a) => `${t(`ui.attribute.${a}`)} ${preview.attributes[a].total}`).join(' · ')}</dd>
          <dt>{t('menu.newSaga.step.jarldom')}</dt>
          <dd>{province ? province.name : t('menu.newSaga.jarldom.fate')}</dd>
          <dt>{t('menu.newSaga.step.difficulty')}</dt>
          <dd>
            {t(`ui.difficulty.${c.difficulty}`)}
            {TOGGLE_IDS.filter((id) => id !== 'duelAssist' && id !== 'blood' && c.toggles[id]).map((id) => (
              <span key={id} className="badge badge-accent" style={{ marginLeft: 6 }}>
                {t(`menu.newSaga.option.${id}`)}
              </span>
            ))}
          </dd>
          <dt>{t('menu.newSaga.difficulty.seed')}</dt>
          <dd className="num">{c.seed}</dd>
        </dl>
      </div>
    </div>
  );
}

export const STEP_COMPONENTS = {
  identity: IdentityStep,
  homeland: HomelandStep,
  parentage: ParentageStep,
  upbringing: UpbringingStep,
  skills: SkillsStep,
  attributes: AttributesStep,
  trait: TraitStep,
  jarldom: JarldomStep,
  difficulty: DifficultyStep,
  confirm: ConfirmStep,
} as const;
