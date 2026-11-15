/**
 * Map labels (pure): which names the chart shows at each zoom band, how large and how important they are. The
 * renderer measures the real text, turns visible definitions into declutter candidates and shows the survivors.
 *
 *   regions      — large spaced capitals (world and region zoom)
 *   sea zones    — spaced italics in sea ink (every zoom)
 *   provinces    — small capitals (region and local zoom)
 *   settlements  — beside their icon; capitals from the world zoom, every settlement up close
 *   sites        — italics, local zoom only
 */
import type { SettlementTierId } from '@content/schemas/ids';
import type { StaticWorld } from '@sim/modules/world/map/index';
import { tierRank } from './scene';
import type { MapScene, Vec2, ZoomBand } from './types';
import type { LabelPlacement } from './declutter';

export type LabelKind = 'region' | 'sea' | 'province' | 'settlement' | 'site';

export interface MapLabelDef {
  /** Stable id (`r:<regionId>`, `z:<zoneId>`, `p:<provinceId>`, the settlement/site marker key). */
  id: string;
  kind: LabelKind;
  text: string;
  pos: Vec2;
  tier?: SettlementTierId;
  /** The player's seat (red ink). */
  home?: boolean;
  /** Synthetic planned capitals are drawn fainter. */
  faint?: boolean;
}

/** Display text of a sea zone name ('the Whale-Road' → 'The Whale-Road'). */
export function seaLabelText(name: string): string {
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** All label definitions for a scene (static geography labels plus the scene's settlements and sites). */
export function buildLabelDefs(world: StaticWorld, scene: MapScene): MapLabelDef[] {
  const out: MapLabelDef[] = [];
  for (const r of world.geo.regions) out.push({ id: `r:${r.id}`, kind: 'region', text: r.name.toUpperCase(), pos: r.label });
  for (const z of world.geo.seaZones) out.push({ id: `z:${z.id}`, kind: 'sea', text: seaLabelText(z.name), pos: z.label });
  world.geo.provinces.forEach((p, i) => {
    const info = world.provinces[i];
    out.push({ id: `p:${p.id}`, kind: 'province', text: p.name.toUpperCase(), pos: p.label ?? info?.labelAt ?? p.anchor });
  });
  for (const s of scene.settlements) out.push({ id: s.key, kind: 'settlement', text: s.name, pos: s.pos, tier: s.tier, home: s.isHome, faint: s.synthetic });
  for (const s of scene.sites) out.push({ id: s.key, kind: 'site', text: s.name, pos: s.pos });
  return out;
}

/** Whether a label shows at a zoom band. */
export function labelVisible(def: MapLabelDef, band: ZoomBand): boolean {
  switch (def.kind) {
    case 'region':
      return band !== 'local';
    case 'sea':
      return true;
    case 'province':
      return band !== 'world';
    case 'settlement': {
      if (band === 'local') return true;
      const rank = tierRank(def.tier ?? 'hamlet');
      if (band === 'region') return rank >= 2 || def.home === true;
      return rank >= 4 || def.home === true;
    }
    case 'site':
      return band === 'local';
  }
}

/** Font size (px) of a label at a zoom band. */
export function labelFontSize(def: MapLabelDef, band: ZoomBand): number {
  switch (def.kind) {
    case 'region':
      return band === 'world' ? 17 : 24;
    case 'sea':
      return band === 'world' ? 13 : band === 'region' ? 17 : 19;
    case 'province':
      return band === 'region' ? 11 : 13;
    case 'settlement': {
      const rank = tierRank(def.tier ?? 'hamlet');
      const base = band === 'world' ? 12 : band === 'region' ? 13 : 14;
      return base + (rank >= 4 ? 2 : rank >= 3 ? 1 : 0) + (def.home ? 1 : 0);
    }
    case 'site':
      return 12;
  }
}

/** Letter spacing (px) of a label at a zoom band. */
export function labelLetterSpacing(def: MapLabelDef, band: ZoomBand): number {
  switch (def.kind) {
    case 'region':
      return band === 'world' ? 4 : 7;
    case 'sea':
      return band === 'world' ? 1.5 : 3;
    case 'province':
      return 1.6;
    default:
      return 0;
  }
}

/** Declutter priority of a label at a zoom band (higher first). */
export function labelPriority(def: MapLabelDef, band: ZoomBand): number {
  switch (def.kind) {
    case 'region':
      return 100;
    case 'sea':
      return 92;
    case 'province':
      return band === 'region' ? 62 : 34;
    case 'settlement': {
      const rank = tierRank(def.tier ?? 'hamlet');
      return (def.home ? 96 : 40 + rank * 9) - (def.faint ? 3 : 0);
    }
    case 'site':
      return 28;
  }
}

/** Placements a label may try around its anchor. */
export function labelPlacements(def: MapLabelDef): readonly LabelPlacement[] {
  return def.kind === 'settlement' || def.kind === 'site' ? ['right', 'left', 'below', 'above'] : ['center'];
}

/** Screen size (px) of a settlement icon at a zoom band. */
export function settlementIconSize(tier: SettlementTierId, band: ZoomBand): number {
  const rank = tierRank(tier);
  const base = band === 'world' ? 14 : band === 'region' ? 20 : 26;
  return Math.round(base * (0.72 + rank * 0.1));
}

/** Whether a settlement icon shows at a zoom band (hamlets and villages only up close). */
export function settlementIconVisible(tier: SettlementTierId, band: ZoomBand, home: boolean): boolean {
  if (home) return true;
  const rank = tierRank(tier);
  if (band === 'world') return rank >= 3;
  if (band === 'region') return rank >= 1;
  return true;
}
