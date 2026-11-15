import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { CLIENT_AREAS, CONTENT_AREAS, MODULE_AREAS } from './areas';
import { MANIFEST_FRAGMENTS, validateAssetManifest } from './assets/index';
import { balancePathOf, DESIGN_EXCERPT_KEYS } from './designKeys';
import { ContentValidationError, RAW_CONTENT, getContent, validateContent, type RawContent } from './index';
import { EN_TABLES, missingLocaleKeys } from './locales/index';
import { CULTURE_IDS, GOD_IDS, HOMELAND_CULTURE_IDS, SKILL_IDS } from './schemas/ids';
import { UPBRINGING_IDS } from './schemas/upbringings';
import { TUNABLE_SCHEMAS } from './tunables';

const content = getContent();
const b = content.balance;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('bundled content', () => {
  it('validates', () => {
    expect(() => validateContent(RAW_CONTENT)).not.toThrow();
    expect(Object.keys(content.cultures).sort()).toEqual([...CULTURE_IDS].sort());
    expect(Object.keys(content.gods).sort()).toEqual([...GOD_IDS].sort());
    for (const c of HOMELAND_CULTURE_IDS) expect(content.cultures[c].playable).toBe(true);
    expect(Object.keys(content.feats)).toHaveLength(16);
    expect(content.titles).toHaveLength(20);
    expect(content.names.bynames.length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(content.traits).length).toBeGreaterThanOrEqual(41);
  });

  it('rejects invalid data with readable issues', () => {
    const bad = clone(RAW_CONTENT) as Record<string, any>;
    bad.balance.economy.taxPerCapita = -1;
    bad.balance.units.bondi.typoKey = 1;
    bad.cultures.skarn.uniqueUnits = ['ghostShip'];
    try {
      validateContent(bad as RawContent);
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentValidationError);
      const issues = (e as ContentValidationError).issues.join('\n');
      expect(issues).toMatch(/balance: economy\.taxPerCapita/);
      expect(issues).toMatch(/units\.bondi/);
    }
    const bad2 = clone(RAW_CONTENT) as Record<string, any>;
    bad2.cultures.skarn.uniqueUnits = ['ghostShip'];
    expect(() => validateContent(bad2 as RawContent)).toThrow(/unknown unit 'ghostShip'/);
  });
});

describe('balance: design values and owner decisions', () => {
  it('XP table matches round10(100·(n−1)^1.7) (§22.1)', () => {
    b.xp.levelTable.forEach((xp, i) => {
      const n = i + 1;
      expect(xp).toBe(Math.round((100 * Math.pow(n - 1, 1.7)) / 10) * 10);
    });
  });

  it('§31.1 sanity check: starting Raider jarldom income ≈ 232, upkeep ≈ 165', () => {
    const tax = 2000 * b.economy.taxPerCapita * b.economy.taxMult.fair * b.economy.prosperity.fair * (1 + b.economy.governorStewardshipTax * 2);
    expect(Math.floor(tax + (b.economy.marketTolls[1] ?? 0))).toBe(232);
    const wages = 40 * b.units.bondi!.wage! + 20 * b.units.archers!.wage!;
    const buildings = Object.entries(b.startBuildings).reduce((acc, [id, tier]) => {
      const def = b.buildings[id as keyof typeof b.buildings];
      return acc + (def.tiers.find((t) => t.tier === tier)?.upkeep ?? 0);
    }, 0);
    expect(wages + 2 * b.economy.lieutenantWage + 2 * b.ships.snekkja.upkeep + buildings).toBe(165);
  });

  it('period units replace lancers/crossbowmen; Strand-Riders charge 1.5', () => {
    expect(b.units.horsemen).toMatchObject({ culture: 'corvani', atk: 7, def: 6, speed: 1.9, morale: 65, charge: 1.6 });
    expect(b.units.javelinmen).toMatchObject({ culture: 'corvani', atk: 5, def: 4, ranged: { atk: 6, range: 6, reloadS: 4 }, speed: 1.1, morale: 45 });
    expect(b.units.strandRiders?.charge).toBe(1.5);
    for (const gone of ['lancers', 'crossbowmen', 'draugar', 'frostGiant']) expect(b.units[gone]).toBeUndefined();
  });

  it('guardians are humans or natural animals', () => {
    expect(b.units.barrowWardens).toMatchObject({ side: 'guardian', atk: 6, def: 6, speed: 0.95, morale: 80 });
    expect(b.units.hermitClan).toMatchObject({ side: 'guardian', atk: 5, def: 4, speed: 1.0, morale: 60 });
    expect(b.units.wolfPack).toMatchObject({ side: 'beast', atk: 5, def: 2, speed: 1.6, morale: 50 });
    // §12.2: 300 HP, speed 1.4, morale 90, 25-damage maul in a 2-tile radius, flees at 20% HP. atk/def are INVENTED values for the generic melee/auto-resolve formulas.
    expect(b.units.greatBear).toMatchObject({ side: 'beast', single: true, hp: 300, speed: 1.4, morale: 90 });
    expect(b.units.greatBear?.specials).toEqual({ maulDamage: 25, maulRadiusTiles: 2, fleeAtHpPct: 0.2 });
    expect(b.units.wreckers).toMatchObject({ side: 'guardian' });
    expect(b.units.wreckers?.abilities).toContain('ambush');
    expect(b.units.steppeHorseArchers?.culture).toBe('kurgai');
    expect(b.units.horseArchers?.culture).toBe('velkar');
    expect(b.units.menAtArms?.culture).toBe('corvani');
    expect(b.units.greatBear?.abilities).toContain('areaMaul');
  });

  it('no crossbows anywhere; galleys use sea-fire; swords are elite kit', () => {
    const data = clone(RAW_CONTENT) as Record<string, any>;
    delete data.balance.$notes; // the notes document the removals in prose
    expect(JSON.stringify(data).toLowerCase()).not.toMatch(/crossbow|wyrmfire|draug|frost-giant|frostgiant|lancer/);
    expect(b.ships.galley.tags).toContain('seaFire');
    expect(b.weapons.sword.minWeaponTier).toBe(3);
    expect(b.fortTiers[4]?.name).toMatch(/stone/i);
  });

  it('difficulty presets match §5.5', () => {
    expect(b.difficulty.raider).toMatchObject({ startSilver: 2000, lieutenants: 2, foodMonths: 6, skillPoints: 6, attributePoints: 5 });
    for (const [id, p] of Object.entries(b.difficulty)) {
      const men = Object.values(p.startUnits).reduce((a, n) => a + n, 0);
      expect({ id, men }).toEqual({ id, men: { hearthside: 90, raider: 60, seaKing: 45, longWinter: 35 }[id] });
    }
    expect(b.autoresolve.playerPenalty).toEqual({ hearthside: 0, raider: 0.05, seaKing: 0.1, longWinter: 0.1 });
    expect(b.ai.temperature).toEqual({ hearthside: 0.6, raider: 0.4, seaKing: 0.3, longWinter: 0.25 });
  });
});

describe('balance: single source per rule, gaps filled', () => {
  it('§22.9 ambitions and the §12.5 promoted-veteran level range', () => {
    expect(b.ambitions).toEqual({ offered: 3, maxChosen: 2, favorReward: 5, loyaltyReward: 5, failRenown: -5, boastMult: 2 });
    expect(b.renown.sources.ambition).toEqual([20, 60]);
    expect(b.recruit.promoteVeteranLevel).toEqual([1, 3]);
  });

  it('per-culture/feat/trait rules live only in modifier bags', () => {
    const raw = RAW_CONTENT.balance as Record<string, any>;
    expect(raw.holdings.eyjarStartWallsTier).toBeUndefined();
    expect(raw.battle.fire.hallBurnerMult).toBeUndefined();
    expect(raw.prices.tribute.cooldownDays).toBeUndefined();
    expect(content.feats.hallBurner?.modifiers['fire.spreadPct']).toBe(30);
    const eyjar = content.cultures.eyjar.bonuses;
    expect(eyjar.find((x) => x.id === 'openShores')?.modifiers['fort.startTierDelta']).toBe(-1);
    expect(eyjar.find((x) => x.id === 'straitsTolls')?.modifiers).toEqual({});
    expect(b.economy.straitsTollMult).toEqual({ eyjar: 1, other: 0.6 });
    expect(b.health.injuryTable.find((r) => r.id === 'lostFingers')).toEqual({ max: 78, id: 'lostFingers', trait: 'lostFingers' });
    const bad = clone(RAW_CONTENT) as Record<string, any>;
    bad.balance.health.injuryTable.find((r: { id: string }) => r.id === 'lostEye').skill = 'archery';
    expect(() => validateContent(bad as RawContent)).toThrow(/must not also set skill/);
  });

  it('smithy tiers and equipment tiers agree (§12.4 is canonical)', () => {
    expect(b.buildings.smithy.tiers.map((t) => t.effects.maxArmouryTier)).toEqual([2, 3, 5]);
    expect(b.equipment.tiers.map((t) => t.smithyTier)).toEqual([0, 1, 2, 3, 3, 3]);
    const bad = clone(RAW_CONTENT) as Record<string, any>;
    bad.balance.buildings.smithy.tiers[0].effects.maxArmouryTier = 3;
    expect(() => validateContent(bad as RawContent)).toThrow(/equipment tier 3 requires smithyTier 2/);
  });

  it('every §31.22 key resolves in balance.json (renamed keys through designKeys.ts)', () => {
    const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);
    for (const key of DESIGN_EXCERPT_KEYS) expect({ key, value: get(balancePathOf(key)) }).not.toEqual({ key, value: undefined });
    expect(get(balancePathOf('diplomacy.tributeCooldownDays'))).toBe(180);
  });
});

describe('cultures and names', () => {
  it('unique units are bound to their culture', () => {
    expect(content.cultures.kurgai.uniqueUnits).toEqual(['steppeHorseArchers']);
    const bad = clone(RAW_CONTENT) as Record<string, any>;
    bad.cultures.kurgai.uniqueUnits = ['horseArchers'];
    expect(() => validateContent(bad as RawContent)).toThrow(/unit 'horseArchers' belongs to culture 'velkar'/);
  });

  it('Hvarn River Contacts charts the Velkar Rivers (§4.3)', () => {
    const rc = content.cultures.hvarn.bonuses.find((x) => x.id === 'riverContacts');
    expect(rc?.modifiers).toEqual({ 'start.chartVelkar': 1 });
    expect(rc?.description).toMatch(/Velkar Rivers/);
  });

  it('no culture can produce the name of a real ruler or place of the period (§4.2)', () => {
    const denied = [
      'Kubrat', 'Kuvrat', 'Kuber', 'Asparukh', 'Asparuh', 'Batbayan', 'Kotrag', 'Tervel', 'Organa', 'Attila', 'Bayan',
      'Heraclius', 'Justinian', 'Dagobert', 'Clovis', 'Chlothar', 'Brunhild', 'Fredegund', 'Penda', 'Raedwald', 'Oswiu',
      'Kuban', 'Tashkent', 'Samarkand', 'Bukhara', 'Itil', 'Sarkel', 'Pliska', 'Uppsala', 'Vendel', 'Valsgarde',
    ].map((n) => n.toLowerCase());
    const join = (a: string, x: string) => (x.length > 0 && a.length > 0 && a.at(-1)?.toLowerCase() === x[0]?.toLowerCase() && !'aeiouy'.includes(x[0]!.toLowerCase()) ? a + x.slice(1) : a + x);
    const hits: string[] = [];
    for (const [cid, c] of Object.entries(content.cultures)) {
      const n = c.naming;
      const candidates = [...n.examples.male, ...n.examples.female];
      for (const st of n.starts) for (const e of [...n.maleEndings, ...n.femaleEndings]) candidates.push(join(st, e.toLowerCase()));
      for (const r of n.placeRoots) {
        for (const suf of n.placeSuffixes) candidates.push(join(r, suf.toLowerCase()));
        for (const pre of n.placePrefixes) candidates.push(pre.endsWith(' ') ? pre + r : join(pre, r.toLowerCase()));
      }
      for (const name of candidates) if (denied.includes(name.toLowerCase().replace(/\s+/g, ''))) hits.push(`${cid}: ${name}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('upbringings (§5.1) and trait texts', () => {
  it('8 upbringings, one per skill, each offering 6 positive creation traits', () => {
    expect(Object.keys(content.upbringings).sort()).toEqual([...UPBRINGING_IDS].sort());
    expect(Object.values(content.upbringings).map((u) => u.skill).sort()).toEqual([...SKILL_IDS].sort());
    for (const u of Object.values(content.upbringings)) {
      expect(u.traitOptions).toHaveLength(6);
      for (const t of u.traitOptions) expect(content.traits[t]?.creation).toBe('positive');
      expect(content.traits[u.startingTrait]).toBeDefined();
    }
    expect(content.upbringings.seerTouched).toMatchObject({ name: 'Seer-touched', skill: 'runecraft' });
    expect(b.character.upbringingSkillBonus).toBe(2);
  });

  it('player-facing trait descriptions carry no developer notes', () => {
    for (const [id, t] of Object.entries(content.traits)) expect({ id, d: t.description }).not.toEqual({ id, d: expect.stringMatching(/design|giant|TODO/i) });
  });
});

describe('per-area content files (parallel-safe scaffolding)', () => {
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  const jsonFiles = (dir: string) => readdirSync(here(dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

  it('areas: core + every module + client areas', () => {
    expect(CONTENT_AREAS).toEqual(['core', ...MODULE_AREAS, ...CLIENT_AREAS]);
    expect(MODULE_AREAS).toHaveLength(20);
  });

  it('module tunables: one registered strict file per module, exposed as content.tunables', () => {
    expect(Object.keys(TUNABLE_SCHEMAS).sort()).toEqual([...MODULE_AREAS].sort());
    expect(jsonFiles('./data/tunables/')).toEqual([...MODULE_AREAS].sort());
    expect(readdirSync(here('./schemas/tunables/')).map((f) => f.replace(/\.ts$/, '')).sort()).toEqual([...MODULE_AREAS].sort());
    expect(Object.keys(content.tunables).sort()).toEqual([...MODULE_AREAS].sort());
    const bad = clone(RAW_CONTENT) as Record<string, any>;
    bad.tunables.economy = { typoKey: 1 };
    expect(() => validateContent(bad as RawContent)).toThrow(/tunables\/economy/);
  });

  it('locales: every file registered, keys prefixed by their area, ICU syntax valid', () => {
    expect(jsonFiles('./locales/en/')).toEqual([...CONTENT_AREAS].sort());
    const problems: string[] = [];
    for (const [area, table] of Object.entries(EN_TABLES)) {
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        problems.push(`${area}: not an object`);
        continue;
      }
      for (const [key, msg] of Object.entries(table as Record<string, unknown>)) {
        if (!key.startsWith(`${area}.`)) problems.push(`${area}: key '${key}' must start with '${area}.'`);
        if (typeof msg !== 'string') problems.push(`${area}: '${key}' is not a string`);
        else {
          try {
            new IntlMessageFormat(msg, 'en');
          } catch (e) {
            problems.push(`${area}: '${key}' is not valid ICU: ${(e as Error).message}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(missingLocaleKeys(['core.surelyMissing', 'core.surelyMissing'])).toEqual(['core.surelyMissing']);
  });

  it('asset manifest: every fragment registered and valid; prefix and duplicate rules enforced', () => {
    expect(jsonFiles('./assets/manifest/')).toEqual([...CONTENT_AREAS].sort());
    expect(validateAssetManifest(MANIFEST_FRAGMENTS)).toEqual([]);
    const image = { kind: 'image', path: 'hub/hall.png', size: [640, 360], placeholder: { generator: 'panorama', label: 'Great hall' } };
    const voice = { kind: 'voice', path: 'vo/skald/intro.ogg', lineKey: 'narrative.intro', voice: 'skald', placeholder: { generator: 'tts' } };
    expect(validateAssetManifest({ hub: { 'hub.hall': image }, narrative: { 'narrative.vo.intro': voice } })).toEqual([]);
    const issues = validateAssetManifest({
      hub: { 'map.hall': image, 'hub.bad': { ...image, path: 'C:/Art/Hall.PNG' } },
      map: { 'map.hall': image },
    });
    expect(issues.join('\n')).toMatch(/must start with 'hub\.'/);
    expect(issues.join('\n')).toMatch(/path/);
    expect(issues.join('\n')).toMatch(/defined in both/);
  });
});
