/**
 * Skirmish match-ups: every land preset builds a battle setup, every sea preset a sea-battle setup the
 * seabattle engine fights to an end, with the player on one side and the invented names resolved.
 */
import { describe, expect, it } from 'vitest';
import { getContent } from '@content/index';
import { SeaBattleEngine, seaContent } from '@sim/seabattle/index';
import { setMissingKeyWarnings, t } from '../../i18n/index';
import { SEA_SKIRMISH_PRESETS, seaSkirmishCaptainName, seaSkirmishSetup, SKIRMISH_PRESETS, skirmishSetup } from './presets';

setMissingKeyWarnings(false);
const content = getContent();

describe('skirmish presets', () => {
  it('every land match-up still builds', () => {
    for (const p of SKIRMISH_PRESETS) expect(skirmishSetup(content, p.id, 1).attacker.squads.length).toBeGreaterThan(0);
  });

  it('every sea match-up builds a setup with the player on one side and named ships', () => {
    const ids = new Set<string>();
    for (const p of SEA_SKIRMISH_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      const setup = seaSkirmishSetup(content, p.id, 3, (k) => t(k));
      expect(setup.attacker.isPlayer !== setup.defender.isPlayer).toBe(true);
      expect(setup.origin).toBe('skirmish');
      for (const s of [...setup.attacker.ships, ...setup.defender.ships]) {
        expect(s.name).toBeTruthy();
        expect(s.name!.startsWith('seaView.')).toBe(false);
      }
      expect(t(p.titleKey)).not.toBe(p.titleKey);
      expect(t(p.bodyKey)).not.toBe(p.bodyKey);
    }
  });

  it('a different run gives fresh water; the same run the same battle', () => {
    const a = seaSkirmishSetup(content, 'seaPair', 1, (k) => t(k));
    const b = seaSkirmishSetup(content, 'seaPair', 2, (k) => t(k));
    expect(a.seed).not.toBe(b.seed);
    expect(seaSkirmishSetup(content, 'seaPair', 1, (k) => t(k))).toEqual(a);
  });

  it('the merchant carries plunder, and every sea match-up fights to an end', () => {
    const merchant = seaSkirmishSetup(content, 'seaMerchant', 1, (k) => t(k));
    expect(merchant.defender.silver).toBeGreaterThan(0);
    expect(Object.keys(merchant.defender.cargo ?? {}).length).toBeGreaterThan(0);
    for (const p of SEA_SKIRMISH_PRESETS) {
      const e = new SeaBattleEngine(seaSkirmishSetup(content, p.id, 5, (k) => t(k)), seaContent(content), { aiControlsPlayer: true });
      const r = e.runToEnd();
      expect(e.status).toBe('ended');
      expect(['attacker', 'defender', 'none']).toContain(r.winner);
    }
  });

  it('names the invented captains', () => {
    const setup = seaSkirmishSetup(content, 'seaPair', 1, (k) => t(k));
    expect(seaSkirmishCaptainName(setup.attacker.captainId!, (k) => t(k))).toBe(t('seaView.skirmish.captain.player'));
    expect(seaSkirmishCaptainName(setup.defender.captainId!, (k) => t(k))).toBe(t('seaView.skirmish.captain.enemy'));
    expect(seaSkirmishCaptainName('chr_1', (k) => t(k))).toBeUndefined();
  });
});
