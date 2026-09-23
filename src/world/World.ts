import { B, IS_SKY_BLOCKING, IS_SOLID } from './blocks';
import {
  CHUNK_MASK,
  CHUNK_SHIFT,
  SECTION_COUNT,
  SECTION_SIZE,
  WORLD_HEIGHT,
  columnIndex,
  columnKey,
} from './constants';

export interface SectionMeshes {
  solid: import('three').Mesh | null;
  cutout: import('three').Mesh | null;
  water: import('three').Mesh | null;
}

/** A 16 x 128 x 16 column of blocks, split into 8 sections for meshing. */
export class Column {
  readonly key: number;
  /** Highest sky-blocking block per (x, z); -1 when the column is open to the void. */
  readonly heightmap = new Int16Array(256);
  readonly meshes: (SectionMeshes | null)[] = new Array(SECTION_COUNT).fill(null);
  /** 1 when a section's mesh is missing or out of date. */
  readonly dirty = new Uint8Array(SECTION_COUNT).fill(1);
  /** True once every section has been meshed at least once. */
  meshedOnce = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly blocks: Uint8Array,
  ) {
    this.key = columnKey(cx, cz);
    this.recomputeHeightmap();
  }

  recomputeHeightmap(): void {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) this.heightmap[(lz << 4) | lx] = this.scanDown(lx, lz, WORLD_HEIGHT - 1);
    }
  }

  scanDown(lx: number, lz: number, fromY: number): number {
    for (let y = fromY; y >= 0; y--) {
      if (IS_SKY_BLOCKING[this.blocks[columnIndex(lx, y, lz)]]) return y;
    }
    return -1;
  }

  hasDirty(): boolean {
    for (let i = 0; i < SECTION_COUNT; i++) if (this.dirty[i]) return true;
    return false;
  }
}

export type EditListener = (x: number, y: number, z: number, oldId: number, newId: number) => void;

/**
 * Block storage for all loaded columns plus the record of every player-made change.
 * World coordinates are integers; negative coordinates are fully supported.
 */
export class World {
  readonly columns = new Map<number, Column>();
  /** Player-made changes, grouped by column key → (column index → block id). */
  readonly edits = new Map<number, Map<number, number>>();
  /** Sections whose meshes must be rebuilt right away (player edits). Key: columnKey * 8 + section. */
  readonly urgent = new Set<number>();
  editsVersion = 0;
  private listeners: EditListener[] = [];

  onEdit(fn: EditListener): void {
    this.listeners.push(fn);
  }

  getColumn(cx: number, cz: number): Column | undefined {
    return this.columns.get(columnKey(cx, cz));
  }

  isLoadedAt(x: number, z: number): boolean {
    return this.columns.has(columnKey(x >> CHUNK_SHIFT, z >> CHUNK_SHIFT));
  }

  /** Block id at integer world coordinates. Unloaded columns read as air. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const col = this.columns.get(columnKey(x >> CHUNK_SHIFT, z >> CHUNK_SHIFT));
    if (!col) return B.AIR;
    return col.blocks[columnIndex(x & CHUNK_MASK, y, z & CHUNK_MASK)];
  }

  /** Collision query: unloaded columns and the world floor are treated as solid. */
  isSolidForCollision(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= WORLD_HEIGHT) return false;
    const col = this.columns.get(columnKey(x >> CHUNK_SHIFT, z >> CHUNK_SHIFT));
    if (!col) return true;
    return IS_SOLID[col.blocks[columnIndex(x & CHUNK_MASK, y, z & CHUNK_MASK)]] === 1;
  }

  /** Adds a freshly generated column, re-applying any saved player edits first. */
  addColumn(cx: number, cz: number, blocks: Uint8Array): Column {
    const key = columnKey(cx, cz);
    const edits = this.edits.get(key);
    if (edits) for (const [idx, id] of edits) blocks[idx] = id;
    const col = new Column(cx, cz, blocks);
    this.columns.set(key, col);
    return col;
  }

  removeColumn(col: Column): void {
    this.columns.delete(col.key);
  }

  /**
   * Changes one block. Marks every section whose mesh depends on it (including
   * neighbouring chunks at borders) as urgently dirty. Returns false if nothing changed.
   */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> CHUNK_SHIFT;
    const cz = z >> CHUNK_SHIFT;
    const col = this.columns.get(columnKey(cx, cz));
    if (!col) return false;
    const lx = x & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const idx = columnIndex(lx, y, lz);
    const old = col.blocks[idx];
    if (old === id) return false;
    col.blocks[idx] = id;

    let edits = this.edits.get(col.key);
    if (!edits) {
      edits = new Map();
      this.edits.set(col.key, edits);
    }
    edits.set(idx, id);
    this.editsVersion++;

    // Heightmap maintenance for the sky-visibility term.
    const hi = (lz << 4) | lx;
    const oldH = col.heightmap[hi];
    let newH = oldH;
    if (IS_SKY_BLOCKING[id] && y > oldH) newH = y;
    else if (!IS_SKY_BLOCKING[id] && y === oldH) newH = col.scanDown(lx, lz, y - 1);
    col.heightmap[hi] = newH;

    // Faces, ambient occlusion and lighting of all 26 neighbours can change.
    this.markRange(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1);
    if (newH !== oldH) {
      // Sky visibility is sampled over a 3x3 neighbourhood and falls off over ~10 blocks.
      const lo = Math.min(oldH, newH) - 11;
      const hiY = Math.max(oldH, newH) + 1;
      this.markRange(x - 2, lo, z - 2, x + 2, hiY, z + 2);
    }
    for (const fn of this.listeners) fn(x, y, z, old, id);
    return true;
  }

  /** Marks all sections overlapping the given block-space box as urgently dirty. */
  markRange(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const sy0 = Math.max(0, Math.floor(y0 / SECTION_SIZE));
    const sy1 = Math.min(SECTION_COUNT - 1, Math.floor(y1 / SECTION_SIZE));
    for (let cz = z0 >> CHUNK_SHIFT; cz <= z1 >> CHUNK_SHIFT; cz++) {
      for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx++) {
        const col = this.columns.get(columnKey(cx, cz));
        if (!col) continue;
        for (let sy = sy0; sy <= sy1; sy++) {
          col.dirty[sy] = 1;
          this.urgent.add(col.key * SECTION_COUNT + sy);
        }
      }
    }
  }

  clear(): void {
    this.columns.clear();
    this.edits.clear();
    this.urgent.clear();
    this.editsVersion++;
  }
}
