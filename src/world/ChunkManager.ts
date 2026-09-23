import { CHUNK_SIZE, SECTION_COUNT, columnKey } from './constants';
import { TerrainGenerator, type SpawnPoint } from './generator';
import { SectionMesher, type SectionGeometry } from './mesher';
import { World, type Column } from './World';

/** Render-side hooks so the world code does not depend on three.js directly. */
export interface SectionSink {
  applySection(col: Column, sy: number, geometry: SectionGeometry): void;
  disposeColumn(col: Column): void;
}

interface ChunkMsg {
  type: 'chunk' | 'skip';
  worldId: number;
  cx: number;
  cz: number;
  blocks?: Uint8Array;
}

/**
 * Streams columns around the player: generation happens in web workers (with a
 * main-thread fallback), meshing happens here within a per-frame time budget, and
 * sections touched by player edits are rebuilt immediately.
 */
export class ChunkManager {
  private workers: Worker[] = [];
  private nextWorker = 0;
  private requested = new Set<number>();
  private received: ChunkMsg[] = [];
  private mesher = new SectionMesher();
  private worldId = 0;
  private fallbackGen: TerrainGenerator | null = null;
  private neighbourhood: Column[] = new Array(9);
  renderDistance = 6;
  /** Statistics for the debug overlay. */
  stats = { meshedSections: 0, lastMeshMs: 0, workers: 0 };

  constructor(
    private world: World,
    private sink: SectionSink,
  ) {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<ChunkMsg>) => this.received.push(e.data);
        w.onerror = (e) => {
          e.preventDefault();
          this.disableWorkers();
        };
        this.workers.push(w);
      }
    } catch {
      this.disableWorkers();
    }
    this.stats.workers = this.workers.length;
  }

  private disableWorkers(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.requested.clear();
    this.stats.workers = 0;
  }

  /** Starts streaming a new world. Existing columns must already be cleared. */
  start(seed: number, spawn: SpawnPoint): void {
    this.worldId++;
    this.requested.clear();
    this.received.length = 0;
    this.fallbackGen = new TerrainGenerator(seed, spawn);
    for (const w of this.workers) w.postMessage({ type: 'init', worldId: this.worldId, seed, spawn });
  }

  /** Removes every column and its meshes. */
  unloadAll(): void {
    for (const col of this.world.columns.values()) this.sink.disposeColumn(col);
    this.world.columns.clear();
    this.requested.clear();
    this.received.length = 0;
  }

  private neighboursLoaded(col: Column): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.world.columns.get(columnKey(col.cx + dx, col.cz + dz));
        if (!n) return false;
        this.neighbourhood[(dz + 1) * 3 + dx + 1] = n;
      }
    }
    return true;
  }

  private meshSection(col: Column, sy: number): void {
    const geo = this.mesher.mesh(this.neighbourhood, sy);
    this.sink.applySection(col, sy, geo);
    col.dirty[sy] = 0;
    this.stats.meshedSections++;
    if (!col.meshedOnce && !col.hasDirty()) col.meshedOnce = true;
  }

  /** Rebuilds sections changed by player edits right now, so feedback is instant. */
  flushUrgent(): void {
    const world = this.world;
    if (world.urgent.size === 0) return;
    for (const key of world.urgent) {
      const colKey = Math.floor(key / SECTION_COUNT);
      const sy = key - colKey * SECTION_COUNT;
      const col = world.columns.get(colKey);
      if (!col || !col.dirty[sy]) continue;
      // Only columns that are already visible are rebuilt eagerly; others follow the queue.
      if (!col.meshedOnce && !col.meshes.some((m) => m)) continue;
      if (!this.neighboursLoaded(col)) continue;
      this.meshSection(col, sy);
    }
    world.urgent.clear();
  }

  update(px: number, pz: number, dirX: number, dirZ: number, budgetMs: number): void {
    const world = this.world;
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const R = this.renderDistance;

    // 1. Accept generated columns.
    if (this.received.length) {
      for (const msg of this.received) {
        const key = columnKey(msg.cx, msg.cz);
        if (msg.worldId !== this.worldId) continue;
        this.requested.delete(key);
        if (msg.type !== 'chunk' || !msg.blocks || world.columns.has(key)) continue;
        const d = Math.max(Math.abs(msg.cx - pcx), Math.abs(msg.cz - pcz));
        if (d > R + 3) continue;
        world.addColumn(msg.cx, msg.cz, msg.blocks);
      }
      this.received.length = 0;
    }

    // 2. Request missing columns, nearest first (data radius is one larger than the view).
    const loadR = R + 1;
    const wanted: [number, number, number][] = [];
    for (let dz = -loadR; dz <= loadR; dz++) {
      for (let dx = -loadR; dx <= loadR; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (loadR + 0.5) * (loadR + 0.5)) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = columnKey(cx, cz);
        if (world.columns.has(key) || this.requested.has(key)) continue;
        wanted.push([d2, cx, cz]);
      }
    }
    if (wanted.length) {
      wanted.sort((a, b) => a[0] - b[0]);
      if (this.workers.length) {
        const cap = this.workers.length * 3;
        for (const [, cx, cz] of wanted) {
          if (this.requested.size >= cap) break;
          this.requested.add(columnKey(cx, cz));
          this.workers[this.nextWorker].postMessage({ type: 'gen', worldId: this.worldId, cx, cz });
          this.nextWorker = (this.nextWorker + 1) % this.workers.length;
        }
      } else if (this.fallbackGen) {
        // No workers: generate on the main thread within a small budget.
        const t0 = performance.now();
        for (const [, cx, cz] of wanted) {
          world.addColumn(cx, cz, this.fallbackGen.generateColumn(cx, cz));
          if (performance.now() - t0 > budgetMs * 0.5) break;
        }
      }
    }

    // 3. Unload far columns.
    for (const col of world.columns.values()) {
      const d = Math.max(Math.abs(col.cx - pcx), Math.abs(col.cz - pcz));
      if (d > R + 3) {
        this.sink.disposeColumn(col);
        world.removeColumn(col);
      }
    }

    // 4. Player edits first, then background meshing by priority.
    this.flushUrgent();
    const t0 = performance.now();
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / dirLen;
    const fz = dirZ / dirLen;
    const candidates: [number, Column][] = [];
    for (const col of world.columns.values()) {
      if (!col.hasDirty()) continue;
      const dx = col.cx - pcx;
      const dz = col.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + 0.5) * (R + 0.5)) continue;
      // Prefer columns in front of the camera.
      const len = Math.sqrt(d2) || 1;
      const facing = (dx * fx + dz * fz) / len;
      candidates.push([d2 * (1.6 - facing * 0.6), col]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    let meshed = 0;
    outer: for (const [, col] of candidates) {
      if (!this.neighboursLoaded(col)) continue;
      for (let sy = 0; sy < SECTION_COUNT; sy++) {
        if (!col.dirty[sy]) continue;
        this.meshSection(col, sy);
        meshed++;
        if (performance.now() - t0 > budgetMs) break outer;
      }
    }
    if (meshed) this.stats.lastMeshMs = (performance.now() - t0) / meshed;
  }

  /** True when every column within `radius` of (x, z) exists and has been meshed. */
  isAreaReady(x: number, z: number, radius: number): boolean {
    return this.areaProgress(x, z, radius) >= 1;
  }

  areaProgress(x: number, z: number, radius: number): number {
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    let total = 0;
    let done = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        total += 2;
        const col = this.world.columns.get(columnKey(pcx + dx, pcz + dz));
        if (col) done++;
        if (col?.meshedOnce) done++;
      }
    }
    return done / total;
  }

  get pendingRequests(): number {
    return this.requested.size;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
