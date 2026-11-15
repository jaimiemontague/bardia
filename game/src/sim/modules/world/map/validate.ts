/**
 * Spatial validation of the geography against its rasterised map (§29.6 "every settlement is reachable, every
 * port touches a sea cell, provinces have no overlaps or gaps, every river is connected"). Errors fail
 * tools/validate-geography and the map tests; warnings are reported (e.g. while region packs are unfinished).
 *
 * The schema and cross-reference checks live in src/content/world.ts (checkGeographyReferences);
 * validateGeographyFull runs both.
 */
import { checkGeographyReferences, type Geography, type GeographyReport, type Point } from '@content/world';
import { buildStaticWorld } from './build';
import { CELL_LAKE, CELL_LAND, CELL_SEA, LAKE_PROCEDURAL, RIVER_NAVIGABLE, type StaticWorld } from './model';

function cellOf(world: StaticWorld, p: Point): number {
  const x = Math.floor(p[0]);
  const y = Math.floor(p[1]);
  return x < 0 || y < 0 || x >= world.width || y >= world.height ? -1 : y * world.width + x;
}

function fmt(p: Point): string {
  return `[${p[0]}, ${p[1]}]`;
}

/** A 4-connected piece of one province's land. */
export interface ProvincePiece {
  province: number;
  /** First cell of the piece in scan order. */
  cell: number;
  cells: number;
  /** Shares a land border with another province or neutral land (a spill, not an island). */
  touchesOtherLand: boolean;
}

/**
 * Pieces of a province (4-connected land and lake cells of one province, the same connectivity the build's
 * contiguity cleanup uses) that contain none of the province's anchors, largest first. `cells` counts land cells.
 * Islands without an anchor (`touchesOtherLand` false) and spills across borders show up here.
 */
export function detachedProvincePieces(world: StaticWorld): ProvincePiece[] {
  const W = world.width;
  const size = world.size;
  const piece = new Int32Array(size).fill(-1);
  const pieces: ProvincePiece[] = [];
  const stack = new Int32Array(size);
  const member = (i: number, p: number) => world.kind[i] !== CELL_SEA && world.provinceOf[i] === p;
  for (let start = 0; start < size; start++) {
    const p = world.provinceOf[start] as number;
    if (p < 0 || piece[start] !== -1 || world.kind[start] === CELL_SEA) continue;
    const id = pieces.length;
    let sp = 0;
    let count = 0;
    let touches = false;
    stack[sp++] = start;
    piece[start] = id;
    while (sp > 0) {
      const c = stack[--sp] as number;
      if (world.kind[c] === CELL_LAND) count++;
      const x = c % W;
      const visit = (n: number) => {
        if (member(n, p)) {
          if (piece[n] === -1) {
            piece[n] = id;
            stack[sp++] = n;
          }
        } else if (world.kind[n] !== CELL_SEA) touches = true;
      };
      if (x > 0) visit(c - 1);
      if (x < W - 1) visit(c + 1);
      if (c >= W) visit(c - W);
      if (c + W < size) visit(c + W);
    }
    pieces.push({ province: p, cell: start, cells: count, touchesOtherLand: touches });
  }
  const anchored = new Uint8Array(pieces.length);
  world.geo.provinces.forEach((def, pi) => {
    for (const a of [def.anchor, ...(def.anchors ?? [])]) {
      const c = cellOf(world, a);
      if (c >= 0 && (piece[c] as number) >= 0 && world.provinceOf[c] === pi) anchored[piece[c] as number] = 1;
    }
  });
  return pieces.filter((_, i) => anchored[i] === 0).sort((a, b) => b.cells - a.cells || a.cell - b.cell);
}

/** Spatial checks over a built world. */
export function validateWorld(world: StaticWorld): GeographyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const geo = world.geo;
  const build = geo.build;
  const kindName = (c: number) => (c < 0 ? 'off the map' : world.kind[c] === CELL_SEA ? 'in the sea' : world.kind[c] === CELL_LAKE ? (world.lakeOf[c] === LAKE_PROCEDURAL ? 'in a small lake' : 'in a lake') : 'on land');
  const provinceName = (c: number) => {
    const p = c < 0 ? -1 : (world.provinceOf[c] as number);
    return p < 0 ? 'no province' : `'${geo.provinces[p]?.id}'`;
  };

  // Provinces and anchors.
  geo.provinces.forEach((p, pi) => {
    const info = world.provinces[pi];
    if (info === undefined) return;
    if (info.landCells < build.minProvinceCells) errors.push(`province '${p.id}': only ${info.landCells} land cells (minimum ${build.minProvinceCells}); move or add anchors`);
    const ri = world.index.region[p.regionId];
    const ac = cellOf(world, p.anchor);
    if (ac < 0 || world.kind[ac] !== CELL_LAND) errors.push(`province '${p.id}': anchor ${fmt(p.anchor)} is ${kindName(ac)}`);
    else if (world.regionOf[ac] !== ri) errors.push(`province '${p.id}': anchor ${fmt(p.anchor)} lies in region '${geo.regions[world.regionOf[ac] as number]?.id}', not '${p.regionId}'`);
    else if (world.provinceOf[ac] !== pi) errors.push(`province '${p.id}': anchor cell belongs to ${provinceName(ac)}`);
    for (const a of p.anchors ?? []) {
      const c = cellOf(world, a);
      if (c < 0 || world.kind[c] !== CELL_LAND) errors.push(`province '${p.id}': extra anchor ${fmt(a)} is ${kindName(c)}`);
      else if (world.regionOf[c] !== ri) errors.push(`province '${p.id}': extra anchor ${fmt(a)} lies in region '${geo.regions[world.regionOf[c] as number]?.id}'`);
    }
  });

  // Province contiguity: a land piece of a province that holds none of its anchors is a spill across a channel or a
  // region seam (islets smaller than build.minProvinceCells are tolerated: skerries join the nearest province).
  for (const piece of detachedProvincePieces(world)) {
    if (!piece.touchesOtherLand || piece.cells < build.minProvinceCells) continue;
    const [x, y] = [(piece.cell % world.width) + 0.5, Math.floor(piece.cell / world.width) + 0.5];
    errors.push(`province '${geo.provinces[piece.province]?.id}': a detached piece of ${piece.cells} land cells at [${x}, ${y}] holds none of its anchors (add an anchor there or fix the region polygons)`);
  }

  // Regions.
  world.regions.forEach((info) => {
    const def = geo.regions[info.index];
    if (info.landCells === 0) errors.push(`region '${info.id}': no land cells`);
    if (info.unclaimedCells > 0) warnings.push(`region '${info.id}': ${info.unclaimedCells} land cells outside every region polygon were assigned to it`);
    if (def?.neutral === true) {
      let owned = 0;
      for (let i = 0; i < world.size; i++) if (world.regionOf[i] === info.index && world.provinceOf[i] !== -1) owned++;
      if (owned > 0) errors.push(`region '${info.id}' is neutral but ${owned} cells belong to provinces`);
    }
  });
  let orphans = 0;
  for (let i = 0; i < world.size; i++) {
    if (world.kind[i] !== CELL_LAND) continue;
    const r = world.regionOf[i] as number;
    if (r < 0) orphans++;
    else if (world.provinceOf[i] === -1 && geo.regions[r]?.neutral !== true) orphans++;
  }
  if (orphans > 0) errors.push(`${orphans} land cells belong to no province (outside every region or a region without anchors)`);

  // Sea zones and connectivity.
  const compHasSea: Record<string, true> = {};
  for (let i = 0; i < world.size; i++) if (world.kind[i] === CELL_SEA && (world.karviComponent[i] as number) >= 0) compHasSea[world.karviComponent[i] as number] = true;
  geo.seaZones.forEach((z, zi) => {
    const info = world.seaZones[zi];
    if (info === undefined || info.cells === 0) {
      errors.push(`sea zone '${z.id}': no sea cells`);
      return;
    }
    z.seeds.forEach((s) => {
      const c = cellOf(world, s);
      if (c < 0 || world.kind[c] !== CELL_SEA) errors.push(`sea zone '${z.id}': seed ${fmt(s)} is ${c < 0 ? 'off the map' : 'not in the sea'}`);
      else if (world.zoneOf[c] !== zi) warnings.push(`sea zone '${z.id}': seed ${fmt(s)} was claimed by '${geo.seaZones[world.zoneOf[c] as number]?.id}'`);
    });
    let bySea = false;
    let byKarvi = false;
    for (let i = 0; i < world.size; i++) {
      if (world.zoneOf[i] !== zi) continue;
      if (world.seaComponent[i] === world.referenceSeaComponent) bySea = true;
      if (world.karviComponent[i] === world.referenceKarviComponent) byKarvi = true;
      if (bySea && byKarvi) break;
    }
    if (z.riverAccessOnly === true) {
      if (bySea) errors.push(`sea zone '${z.id}': flagged riverAccessOnly but connected to '${build.referenceSeaZone}' by open sea`);
      if (!byKarvi) errors.push(`sea zone '${z.id}': not reachable by karvi from '${build.referenceSeaZone}' (rivers/portages broken)`);
    } else if (!bySea) errors.push(`sea zone '${z.id}': not connected to '${build.referenceSeaZone}' by sea`);
  });

  // Rivers.
  geo.rivers.forEach((r, ri) => {
    if (!r.navigable) return;
    const comps: Record<string, true> = {};
    let cells = 0;
    for (let i = 0; i < world.size; i++) {
      if (world.riverOf[i] !== ri || world.river[i] !== RIVER_NAVIGABLE) continue;
      cells++;
      comps[world.karviComponent[i] as number] = true;
    }
    const ids = Object.keys(comps);
    if (cells === 0) errors.push(`river '${r.id}': navigable but no navigable cells on land`);
    else if (ids.length > 1) errors.push(`river '${r.id}': navigable course is broken into ${ids.length} pieces`);
    else if (!Object.hasOwn(compHasSea, ids[0] as string)) errors.push(`river '${r.id}': navigable course does not reach the sea (directly or via portages)`);
  });
  geo.lakes.forEach((l, li) => {
    if (!l.navigable) return;
    let cells = 0;
    let connected = false;
    for (let i = 0; i < world.size; i++) {
      if (world.lakeOf[i] !== li) continue;
      cells++;
      if (Object.hasOwn(compHasSea, String(world.karviComponent[i]))) connected = true;
    }
    if (cells === 0) errors.push(`lake '${l.id}': no cells (outside land?)`);
    else if (!connected) errors.push(`lake '${l.id}': navigable but not connected to the sea by a navigable river`);
  });
  world.portages.forEach((p) => {
    if (!p.valid) errors.push(`portage '${p.id}': an end is not within 4 cells of navigable water`);
  });

  // Settlements.
  const spacingPoints: { label: string; pos: Point }[] = [];
  geo.settlements.forEach((s) => {
    const at = `settlement '${s.id}' ${fmt(s.pos)}`;
    spacingPoints.push({ label: `settlement '${s.id}'`, pos: s.pos });
    const c = cellOf(world, s.pos);
    if (c < 0 || world.kind[c] !== CELL_LAND) {
      errors.push(`${at}: ${kindName(c)}`);
      return;
    }
    if (s.provinceId === null) {
      const r = world.regionOf[c] as number;
      if (geo.regions[r]?.neutral !== true) errors.push(`${at}: provinceId is null but the cell is in province ${provinceName(c)}`);
    } else {
      const want = world.index.province[s.provinceId];
      if (world.provinceOf[c] !== want) errors.push(`${at}: lies in ${provinceName(c)}, not '${s.provinceId}'`);
    }
    const d = world.coastDist[c] as number;
    if (s.coastal && d > build.coastalMaxCells) errors.push(`${at}: flagged coastal but ${d.toFixed(1)} cells from the sea (max ${build.coastalMaxCells})`);
    if (!s.coastal && d < build.inlandMinCells) errors.push(`${at}: flagged inland but only ${d.toFixed(1)} cells from the sea (min ${build.inlandMinCells}); set coastal: true`);
    if (s.coastal || s.riverPort === true) {
      const pi = world.portOf[s.id];
      const port = pi === undefined ? undefined : world.ports[pi];
      if (port === undefined) errors.push(`${at}: no ${s.coastal ? 'sea' : 'navigable river/lake'} cell within reach for a port`);
      else if (port.kind === 'sea') {
        // Ports on a river-access-only sea (the Ember Sea) are reached by karvi only, by design.
        const riverOnlySea = geo.seaZones[port.zone]?.riverAccessOnly === true;
        if (!port.seaReachable && s.landlocked !== true && !riverOnlySea) errors.push(`${at}: port not reachable by sea from '${build.referenceSeaZone}' (flag landlocked if intended)`);
        if (port.seaReachable && s.landlocked === true) warnings.push(`${at}: flagged landlocked but its port is reachable by sea`);
        if (!port.karviReachable) errors.push(`${at}: port unreachable even by karvi`);
      } else if (!port.karviReachable) errors.push(`${at}: river port not reachable by karvi from '${build.referenceSeaZone}'`);
    }
    if (s.tier === 'capital' || s.tier === 'city') {
      const pi = s.provinceId === null ? undefined : world.index.province[s.provinceId];
      const prov = pi === undefined ? undefined : geo.provinces[pi];
      if (prov !== undefined && prov.capital === s.name) {
        const dx = prov.anchor[0] - s.pos[0];
        const dy = prov.anchor[1] - s.pos[1];
        if (dx * dx + dy * dy > 144) warnings.push(`${at}: capital is ${Math.sqrt(dx * dx + dy * dy).toFixed(0)} cells from its province anchor`);
      }
    }
  });

  // Sites.
  geo.sites.forEach((s) => {
    const at = `site '${s.id}' ${fmt(s.pos)}`;
    spacingPoints.push({ label: `site '${s.id}'`, pos: s.pos });
    const c = cellOf(world, s.pos);
    if (c < 0) errors.push(`${at}: off the map`);
    else if (world.kind[c] === CELL_LAKE) errors.push(`${at}: in a lake`);
    else if (world.kind[c] === CELL_SEA && (world.coastDist[c] as number) > build.siteMaxSeaCells) errors.push(`${at}: ${(world.coastDist[c] as number).toFixed(1)} cells out to sea (max ${build.siteMaxSeaCells})`);
  });

  // Spacing ("no overlaps").
  const min2 = build.minPointSpacing * build.minPointSpacing;
  const order = spacingPoints.map((_, i) => i).sort((a, b) => (spacingPoints[a] as { pos: Point }).pos[0] - (spacingPoints[b] as { pos: Point }).pos[0]);
  for (let ii = 0; ii < order.length; ii++) {
    const a = spacingPoints[order[ii] as number] as { label: string; pos: Point };
    for (let jj = ii + 1; jj < order.length; jj++) {
      const b = spacingPoints[order[jj] as number] as { label: string; pos: Point };
      const dx = b.pos[0] - a.pos[0];
      if (dx > build.minPointSpacing) break;
      const dy = b.pos[1] - a.pos[1];
      if (dx * dx + dy * dy < min2) errors.push(`${a.label} and ${b.label} are closer than ${build.minPointSpacing} cells`);
    }
  }
  return { errors, warnings };
}

/** Schema-independent full check of a parsed geography: references, then the map build and spatial checks. */
export function validateGeographyFull(geo: Geography): { report: GeographyReport; world: StaticWorld | undefined } {
  const refs = checkGeographyReferences(geo);
  if (refs.errors.length > 0) return { report: refs, world: undefined };
  const world = buildStaticWorld(geo);
  const spatial = validateWorld(world);
  return { report: { errors: [...refs.errors, ...spatial.errors], warnings: [...refs.warnings, ...spatial.warnings] }, world };
}
