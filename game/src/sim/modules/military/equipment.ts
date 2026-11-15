/**
 * The realm armoury (§12.4): two realm-wide tracks (armour multiplies Def, weapons multiply Atk), tiers
 * 1–5 and the relic tier 6. An upgrade costs `costFlat + costPerMan × men under arms`, needs the
 * holding's Smithy tier (§10.4 gates) and iron from that holding's market, bought from the treasury at
 * a markup when the market is short. Tier 5 needs a master smith (flag `masterSmith`), tier 6 the
 * Anvil-Shard relic.
 */
import type { Content } from '@content/index';
import type { Balance } from '@content/schemas/balance';
import { CommandError } from '@sim/core/commands';
import { isSafeRecordKey } from '@sim/core/keys';
import type { SimContext } from '@sim/core/module';
import type { FactionId, GameState, SettlementId } from '@sim/core/state';
import { realmMen } from './men';
import { buildingNumber, buildingTier, factionCapitalId, holdingOf, holdingIdsOf } from './realm';
import type { ArmouryTrack, UpgradeArmouryCommand } from './types';

/** A rule the upgrade breaks (the first is the command's error code). */
export type UpgradeIssueCode = 'notYourHolding' | 'maxTier' | 'smithy' | 'requirement' | 'iron' | 'treasury';

/** What the Smithy screen shows for the next tier of one track. */
export interface UpgradePreview {
  track: ArmouryTrack;
  holdingId: SettlementId | undefined;
  currentTier: number;
  nextTier: number;
  armourName?: string;
  weaponName?: string;
  mult: number;
  men: number;
  costFlat: number;
  costPerMan: number;
  /** costFlat + costPerMan × men. */
  silver: number;
  ironT: number;
  ironFromMarket: number;
  ironBought: number;
  ironCost: number;
  /** silver + ironCost. */
  total: number;
  smithyTier: number;
  smithyRequired: number;
  requires: string[];
  unmet: string[];
  issues: UpgradeIssueCode[];
  ok: boolean;
}

/** The faction's current tier of a track. */
export function trackTier(state: GameState, factionId: FactionId, track: ArmouryTrack): number {
  const f = state.factions[factionId];
  if (!f) return 1;
  return track === 'armour' ? f.armouryTier : f.weaponTier;
}

/** True if the faction holds a relic (state.relics, `rel_<id>`) or the flag `relic:<id>` is set. */
export function holdsRelic(state: GameState, factionId: FactionId, relic: string): boolean {
  const flag = `relic:${relic}`;
  if (isSafeRecordKey(flag) && Object.hasOwn(state.flags, flag) && state.flags[flag] !== false) return true;
  for (const key of Object.keys(state.relics)) {
    const r = state.relics[key as keyof typeof state.relics];
    if (r && r.holder === factionId && (r.id === `rel_${relic}` || key === `rel_${relic}`)) return true;
  }
  return false;
}

/** Requirement strings of an equipment tier that are not met ('masterSmith', 'relic:<id>', 'flag:<name>'). */
export function unmetEquipmentRequirements(state: GameState, factionId: FactionId, requires: readonly string[]): string[] {
  const out: string[] = [];
  for (const req of requires) {
    const [kind, arg] = req.split(':');
    if (kind === 'relic' && arg !== undefined) {
      if (!holdsRelic(state, factionId, arg)) out.push(req);
      continue;
    }
    const flag = kind === 'flag' && arg !== undefined ? arg : req;
    const ok = isSafeRecordKey(flag) && Object.hasOwn(state.flags, flag) && state.flags[flag] !== false && state.flags[flag] !== 0;
    if (!ok) out.push(req);
  }
  return out;
}

function tierRow(balance: Balance, tier: number) {
  return balance.equipment.tiers.find((t) => t.tier === tier);
}

/** Best Smithy tier the faction could use: the named holding's (default capital). */
function smithyFor(state: GameState, holdingId: SettlementId | undefined): number {
  return holdingId !== undefined ? buildingTier(state.settlements[holdingId], 'smithy') : 0;
}

/** Pure upgrade preview for the player's faction (the Smithy screen and the command share it). */
export function upgradePreview(state: GameState, content: Content, cmd: UpgradeArmouryCommand): UpgradePreview {
  const balance = content.balance;
  const factionId = state.player.factionId;
  const holdingId = cmd.holdingId ?? factionCapitalId(state, factionId);
  const holding = holdingId !== undefined ? holdingOf(state, holdingId, factionId) : undefined;
  const currentTier = trackTier(state, factionId, cmd.track);
  const nextTier = currentTier + 1;
  const row = tierRow(balance, nextTier);
  const issues: UpgradeIssueCode[] = [];
  if (!holding) issues.push('notYourHolding');
  const men = realmMen(state, factionId).total;
  const smithyTier = smithyFor(state, holding ? holdingId : undefined);
  const maxBySmithy = buildingNumber(balance, 'smithy', smithyTier, 'maxArmouryTier');
  const requires = row?.requires ?? [];
  const isRelicTier = nextTier === balance.equipment.relicTier;
  let unmet: string[] = [];
  if (!row || nextTier > balance.equipment.relicTier) issues.push('maxTier');
  else {
    if (!isRelicTier && nextTier > balance.equipment.maxTier) issues.push('maxTier');
    // The relic tier ignores the Smithy's maximum (only the relic unlocks it) but still needs the forge tier.
    if (smithyTier < row.smithyTier || (!isRelicTier && maxBySmithy < nextTier)) issues.push('smithy');
    unmet = unmetEquipmentRequirements(state, factionId, requires);
    if (unmet.length > 0) issues.push('requirement');
  }
  const costFlat = row?.costFlat ?? 0;
  const costPerMan = row?.costPerMan ?? 0;
  const silver = costFlat + costPerMan * men;
  const ironT = row?.ironT ?? 0;
  const stock = holdingId !== undefined ? (state.markets[holdingId]?.stock.iron ?? 0) : 0;
  const ironFromMarket = Math.min(ironT, Math.max(0, stock));
  const missing = Math.max(0, ironT - ironFromMarket);
  const buyIron = cmd.buyIron ?? content.tunables.military.armoury.buyIronByDefault;
  const ironCost = Math.ceil(missing * balance.goods.iron.basePerTon * content.tunables.military.armoury.ironBuyMarkup);
  if (missing > 0 && !buyIron) issues.push('iron');
  const total = silver + (buyIron ? ironCost : 0);
  if (total > (state.factions[factionId]?.treasury ?? 0)) issues.push('treasury');
  const out: UpgradePreview = {
    track: cmd.track,
    holdingId: holding ? holdingId : undefined,
    currentTier,
    nextTier,
    mult: row?.mult ?? 1,
    men,
    costFlat,
    costPerMan,
    silver,
    ironT,
    ironFromMarket,
    ironBought: buyIron ? missing : 0,
    ironCost: buyIron ? ironCost : 0,
    total,
    smithyTier,
    smithyRequired: row?.smithyTier ?? 0,
    requires: [...requires],
    unmet,
    issues,
    ok: issues.length === 0,
  };
  if (row) {
    out.armourName = row.armour;
    out.weaponName = row.weapon;
  }
  return out;
}

/** `upgradeArmoury` handler. */
export function handleUpgradeArmoury(draft: GameState, cmd: UpgradeArmouryCommand, ctx: SimContext): void {
  const p = upgradePreview(draft, ctx.content, cmd);
  const first = p.issues[0];
  if (first) throw new CommandError(first, `upgradeArmoury rejected: ${first}`);
  const factionId = draft.player.factionId;
  const faction = draft.factions[factionId];
  if (!faction || p.holdingId === undefined) throw new CommandError('notYourHolding');
  const effects: Parameters<SimContext['applyEffects']>[0][number][] = [{ op: 'addSilver', amount: -p.total, factionId }];
  if (p.ironFromMarket > 0) effects.push({ op: 'addGoods', good: 'iron', tons: -p.ironFromMarket, settlementId: p.holdingId });
  ctx.applyEffects(effects);
  if (cmd.track === 'armour') faction.armouryTier = p.nextTier;
  else faction.weaponTier = p.nextTier;
  // The realm armoury equips every holding's garrison too.
  for (const id of holdingIdsOf(draft, factionId)) {
    const s = draft.settlements[id];
    if (!s) continue;
    if (cmd.track === 'armour') s.armourTier = Math.max(s.armourTier, p.nextTier);
    else s.weaponTier = Math.max(s.weaponTier, p.nextTier);
  }
  ctx.emit({ type: 'ArmouryUpgraded', factionId, track: cmd.track, tier: p.nextTier, cost: p.total });
  ctx.notify('military.armoury.upgraded', {
    vars: { track: cmd.track, tier: p.nextTier, name: (cmd.track === 'armour' ? p.armourName : p.weaponName) ?? '' },
  });
  ctx.chronicle({
    kind: 'military.armoury',
    textKey: 'military.chronicle.armoury',
    importance: 1,
    vars: { track: cmd.track, tier: p.nextTier },
    refs: [factionId],
  });
}
