/**
 * The battlefield's objects each tick: torches and burning buildings with wind-driven spread
 * (§31.10, dmath), collapse after the burn time, burning gates, rams and axes on gates, dousing,
 * smoke, and loot caches (gathering in 5 s, carrying, securing at the extraction zone).
 */
import { fireSpreadChance } from '../formulas';
import { S, T } from '../map/grid';
import { emit } from './events';
import { distToRect } from './geometry';
import type { BattleState, BBuilding, BGate, BSquad, SideIdx } from './types';

/** Sets a building alight (no-op when already burning or collapsed). */
export function igniteBuilding(state: BattleState, b: BBuilding, side: SideIdx): void {
  if (b.burning || b.collapsed) return;
  b.burning = true;
  b.burnT = 0;
  b.igniter = side;
  state.smokeDirty = true;
  emit(state, 'buildingIgnited', { target: b.id, x: b.cx, y: b.cy, side });
}

/** Sets a gate alight. */
export function igniteGate(state: BattleState, g: BGate): void {
  if (g.burning || g.broken) return;
  g.burning = true;
  emit(state, 'buildingIgnited', { target: g.id, x: g.cx, y: g.cy });
}

/** A gate gives way: its tiles open (passable for everyone) and paths are re-planned. */
export function breakGate(state: BattleState, g: BGate): void {
  if (g.broken) return;
  g.broken = true;
  g.burning = false;
  g.hp = 0;
  const m = state.map;
  for (let y = g.y; y < g.y + g.h; y++)
    for (let x = g.x; x < g.x + g.w; x++) {
      const i = y * m.w + x;
      m.struct[i] = S.none;
      m.terrain[i] = T.rubble;
    }
  state.costsDirty = true;
  emit(state, 'gateBroken', { target: g.id, x: g.cx, y: g.cy });
}

function collapse(state: BattleState, b: BBuilding): void {
  b.burning = false;
  b.collapsed = true;
  state.buildingsBurned++;
  if (b.cache >= 0) {
    const c = state.caches[b.cache]!;
    state.lootBurned += c.value;
    c.value = 0;
  }
  const m = state.map;
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * m.w + x;
      m.struct[i] = S.none;
      m.terrain[i] = T.rubble;
    }
  state.costsDirty = true;
  state.smokeDirty = true;
  emit(state, 'buildingCollapsed', { target: b.id, x: b.cx, y: b.cy });
}

function near(s: BSquad, x: number, y: number, w: number, h: number, radius: number): boolean {
  return distToRect(s.x, s.y, x, y, w, h) <= radius + Math.max(s.hw, s.hd) * 0.6;
}

/** Torches, rams, axes, dousing and gathering by squads that reached their work. */
export function workAtSites(state: BattleState): void {
  const dt = state.dt;
  const bal = state.data.b;
  const t = state.data.t;
  for (const s of state.squads) {
    if (s.status !== 'active' || s.contacts !== 0) continue;
    const task = s.task;
    switch (task.kind) {
      case 'torch': {
        // Torch: 4 s, Wolf-coats (torch 2× faster) 2 s.
        const need = s.unit.torchSpeedMult > 1 ? bal.fire.wolfcoatTorchS : bal.fire.torchS;
        if (task.gateTarget) {
          const g = state.gates[task.target];
          if (!g || g.broken || g.burning) {
            task.kind = 'none';
            break;
          }
          if (!near(s, g.x, g.y, g.w, g.h, t.torchRadiusTiles)) break;
          s.actT += dt;
          if (s.actT >= need) {
            igniteGate(state, g);
            task.kind = 'none';
          }
          break;
        }
        const b = state.buildings[task.target];
        if (!b || b.burning || b.collapsed) {
          task.kind = 'none';
          break;
        }
        if (!near(s, b.x, b.y, b.w, b.h, t.torchRadiusTiles)) break;
        s.actT += dt;
        if (s.actT >= need) {
          igniteBuilding(state, b, s.side);
          task.kind = 'none';
        }
        break;
      }
      case 'douse': {
        const target = task.gateTarget ? state.gates[task.target] : state.buildings[task.target];
        if (!target || !target.burning) {
          task.kind = 'none';
          break;
        }
        if (!near(s, target.x, target.y, target.w, target.h, t.torchRadiusTiles)) break;
        s.actT += dt;
        if (s.actT >= t.douseS) {
          s.actT = 0;
          if (state.rng.chance(t.douseChance)) {
            target.burning = false;
            state.smokeDirty = true;
            emit(state, 'fireDoused', { squad: s, target: target.id });
            task.kind = 'none';
          }
        }
        break;
      }
      case 'gate': {
        const g = state.gates[task.target];
        if (!g || g.broken) {
          task.kind = 'none';
          break;
        }
        if (!near(s, g.x, g.y, g.w, g.h, 1.5)) break;
        const ram = state.sides[s.side].hasRam && s.unit.abilities.includes('ram');
        const dps = ram ? bal.ramGateDps : t.gateHackDpsPerMan * s.men;
        g.hp -= dps * dt;
        s.fighting = true;
        s.quietT = 0;
        if (g.hp <= 0) {
          breakGate(state, g);
          task.kind = 'none';
        }
        break;
      }
      case 'loot': {
        const c = state.caches[task.target];
        if (!c || c.value <= 0) {
          task.kind = 'none';
          s.gatherT = 0;
          break;
        }
        const dx = c.x - s.x;
        const dy = c.y - s.y;
        if (Math.sqrt(dx * dx + dy * dy) > t.gatherRadiusTiles + Math.max(s.hw, s.hd) * 0.6) break;
        s.gatherT += dt;
        if (s.gatherT < bal.lootGatherS) break;
        s.gatherT = 0;
        if (s.side === 1) {
          // Defenders take their wealth back to safety.
          emit(state, 'lootGathered', { squad: s, target: c.id, value: Math.round(c.value) });
          c.value = 0;
          task.kind = 'none';
          break;
        }
        const cap = Math.max(0, s.men * t.carryValuePerMan - s.loot);
        const take = Math.min(cap, c.value);
        if (take > 0) {
          s.loot += take;
          c.value -= take;
          emit(state, 'lootGathered', { squad: s, target: c.id, value: Math.round(take) });
          // Seizing the reliquary wins a cloister raid (§13.2).
          if (c.treasury && state.setup.kind === 'cloister') state.objectiveBreached = true;
        }
        if (c.value <= 1e-6 || cap - take <= 1e-6) task.kind = 'none';
        break;
      }
      default:
        break;
    }
  }
}

/** Burning, collapse, burning gates, wind-driven spread every few seconds, smoke. */
export function updateFire(state: BattleState): void {
  const dt = state.dt;
  const bal = state.data.b;
  const fire = bal.fire;
  for (const b of state.buildings) {
    if (!b.burning) continue;
    b.burnT += dt;
    if (b.cache >= 0) {
      const c = state.caches[b.cache]!;
      const loss = c.value * Math.min(1, fire.lootLossPerS * dt);
      c.value -= loss;
      state.lootBurned += loss;
    }
    if (b.burnT >= fire.burnS) collapse(state, b);
  }
  for (const g of state.gates) {
    if (!g.burning || g.broken) continue;
    g.hp -= state.data.t.gateBurnDps * dt;
    if (g.hp <= 0) breakGate(state, g);
  }
  state.fireClockT += dt;
  if (state.fireClockT >= fire.spreadIntervalS) {
    state.fireClockT -= fire.spreadIntervalS;
    const w = state.setup.weather;
    const t = state.data.t;
    const globalMult = (state.night ? t.nightFireMult : 1) * (w.rain ? t.rainFireMult : 1);
    const burning = state.buildings.filter((b) => b.burning);
    for (const b of burning) {
      const side = state.sides[b.igniter];
      for (const ni of b.neighbors) {
        const n = state.buildings[ni]!;
        if (n.burning || n.collapsed) continue;
        const p = fireSpreadChance(bal, n.flammability, w.windDir, w.windStr, n.cx - b.cx, n.cy - b.cy, side.emberCloak, side.fireSpreadMult * globalMult);
        if (state.rng.chance(p)) igniteBuilding(state, n, b.igniter);
      }
    }
  }
  if (state.smokeDirty) recomputeSmoke(state);
}

/** Tiles within the fire radius of a burning building or gate are smoky. */
export function recomputeSmoke(state: BattleState): void {
  const m = state.map;
  const r = state.data.b.morale.fireRadiusTiles;
  state.smoke.fill(0);
  const mark = (x0: number, y0: number, w: number, h: number) => {
    const ax = Math.max(0, Math.floor(x0 - r));
    const ay = Math.max(0, Math.floor(y0 - r));
    const bx = Math.min(m.w - 1, Math.ceil(x0 + w + r));
    const by = Math.min(m.h - 1, Math.ceil(y0 + h + r));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (distToRect(x + 0.5, y + 0.5, x0, y0, w, h) <= r) state.smoke[y * m.w + x] = 1;
  };
  for (const b of state.buildings) if (b.burning) mark(b.x, b.y, b.w, b.h);
  for (const g of state.gates) if (g.burning) mark(g.x, g.y, g.w, g.h);
  state.smokeDirty = false;
}
