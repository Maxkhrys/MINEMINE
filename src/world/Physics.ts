import { B, IS_REPLACEABLE, isWater, waterLevel } from './blocks';
import { WORLD_HEIGHT } from './constants';
import type { World } from './World';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
type Cell = [number, number, number];
/** Deterministic 10 Hz block simulation. Work and queue sizes are bounded. */
export class WorldPhysics {
  private pending = new Map<string, Cell>();
  private clock = 0;
  private changing = false;
  constructor(private world: World) {
    world.onEdit((x, y, z) => { if (!this.changing) this.wake(x, y, z); });
    world.onColumn(col => {
      // Resume saved flows and unsupported granular blocks when chunks return.
      for (let i = 256; i < col.blocks.length; i++) {
        const id = col.blocks[i];
        const x = col.cx * 16 + (i & 15), y = i >> 8, z = col.cz * 16 + ((i >> 4) & 15);
        if ((isWater(id) && id !== B.WATER) || ((id === B.SAND || id === B.GRAVEL) && IS_REPLACEABLE[col.blocks[i - 256]])) this.wake(x, y, z);
        if ((i & 15) === 0 || (i & 15) === 15 || ((i >> 4) & 15) === 0 || ((i >> 4) & 15) === 15) {
          if (isWater(id)) this.wake(x, y, z);
        }
      }
    });
  }
  clear(): void { this.pending.clear(); this.clock = 0; }
  private add(x: number, y: number, z: number): void {
    if (y <= 0 || y >= WORLD_HEIGHT || !this.world.isLoadedAt(x, z)) return;
    const key = `${x},${y},${z}`;
    if (this.pending.size < 16384) this.pending.set(key, [x, y, z]);
  }
  wake(x: number, y: number, z: number): void {
    this.add(x, y, z); this.add(x, y + 1, z); this.add(x, y - 1, z);
    for (const [dx, dz] of SIDES) this.add(x + dx, y, z + dz);
  }
  private set(x: number, y: number, z: number, id: number): boolean {
    const changed = this.world.setBlock(x, y, z, id);
    if (changed) this.wake(x, y, z);
    return changed;
  }
  update(dt: number, intersects: (x: number, y: number, z: number) => boolean): boolean {
    this.clock += dt;
    if (this.clock < 0.1) return false;
    this.clock %= 0.1;
    const batch: Cell[] = [];
    for (const [key, cell] of this.pending) {
      this.pending.delete(key); batch.push(cell);
      if (batch.length >= 192) break;
    }
    let changed = false;
    this.changing = true;
    try {
      for (const [x, y, z] of batch) {
        if (!this.world.isLoadedAt(x, z)) continue;
        const id = this.world.getBlock(x, y, z);
        const below = this.world.getBlock(x, y - 1, z);
        if (id === B.CAMPFIRE) {
          if (isWater(this.world.getBlock(x, y + 1, z)) || SIDES.some(([dx, dz]) => isWater(this.world.getBlock(x + dx, y, z + dz))))
            changed = this.set(x, y, z, B.OAK_LOG) || changed;
          continue;
        }
        if (id === B.SAND || id === B.GRAVEL) {
          if (IS_REPLACEABLE[below] && y > 1) {
            if (intersects(x, y - 1, z)) { this.add(x, y, z); continue; }
            changed = this.set(x, y - 1, z, id) || changed;
            changed = this.set(x, y, z, isWater(below) ? below : B.AIR) || changed;
          }
          continue;
        }
        if (id === B.WATER) {
          // Source cells never decay. Wake only available downstream cells.
          if (IS_REPLACEABLE[below] && !isWater(below)) this.add(x, y - 1, z);
          if (!IS_REPLACEABLE[below]) for (const [dx, dz] of SIDES) {
            const n = this.world.getBlock(x + dx, y, z + dz);
            if (IS_REPLACEABLE[n] && n !== B.WATER) this.add(x + dx, y, z + dz);
          }
          continue;
        }
        if (!IS_REPLACEABLE[id]) continue;
        const above = this.world.getBlock(x, y + 1, z);
        let next = B.AIR as number;
        if (isWater(above)) next = B.FALLING_WATER;
        else {
          let level = 8;
          for (const [dx, dz] of SIDES) {
            // Do not infer empty space or a missing source across an unloaded border.
            if (!this.world.isLoadedAt(x + dx, z + dz)) { if (isWater(id)) level = Math.min(level, waterLevel(id)); continue; }
            const n = this.world.getBlock(x + dx, y, z + dz);
            const support = this.world.getBlock(x + dx, y - 1, z + dz);
            if (isWater(n) && !IS_REPLACEABLE[support]) level = Math.min(level, waterLevel(n) + 1);
          }
          if (level <= 7) next = B.FLOW_1 + Math.max(1, level) - 1;
        }
        // Only remove previous fluid, never erase a plant without incoming water.
        if (next !== B.AIR || isWater(id)) changed = this.set(x, y, z, next) || changed;
      }
    } finally { this.changing = false; }
    return changed;
  }
  get queued(): number { return this.pending.size; }
}
