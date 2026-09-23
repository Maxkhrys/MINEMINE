import { B } from './blocks';
import { CHUNK_SIZE, COLUMN_VOLUME, SEA_LEVEL, WORLD_HEIGHT, columnIndex } from './constants';
import { SimplexNoise, hash2, hash3, mulberry32, smoothstep } from './noise';

export const BIOME = {
  PLAINS: 0,
  FOREST: 1,
  BIRCH: 2,
  DESERT: 3,
  TUNDRA: 4,
  PEAKS: 5,
  BEACH: 6,
  OCEAN: 7,
} as const;

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Margin around a chunk for which surface data is computed (trees reach across borders). */
const M = 3;
const AREA = CHUNK_SIZE + M * 2;
const CAVE_STEP = 4;
const CAVE_NX = CHUNK_SIZE / CAVE_STEP + 1;
const CAVE_NY = WORLD_HEIGHT / CAVE_STEP + 1;
const SPAWN_CLEAR_RADIUS = 6;

/**
 * Deterministic terrain generator. Given the same seed, every column is always
 * generated identically, whichever order chunks are requested in.
 */
export class TerrainGenerator {
  readonly seed: number;
  readonly spawn: SpawnPoint;
  private continental: SimplexNoise;
  private hills: SimplexNoise;
  private detail: SimplexNoise;
  private mountains: SimplexNoise;
  private climate: SimplexNoise;
  private caves: SimplexNoise;
  private caves2: SimplexNoise;
  private flora: SimplexNoise;

  // Scratch buffers reused for every column.
  private heights = new Int16Array(AREA * AREA);
  private biomes = new Uint8Array(AREA * AREA);
  private tops = new Uint8Array(AREA * AREA);
  private caveA = new Float64Array(CAVE_NX * CAVE_NX * CAVE_NY);
  private caveB = new Float64Array(CAVE_NX * CAVE_NX * CAVE_NY);
  private sampleH = 0;
  private sampleBiome = 0;

  constructor(seed: number, spawn?: SpawnPoint) {
    this.seed = seed >>> 0;
    this.continental = new SimplexNoise(this.seed ^ 0x1a2b3c);
    this.hills = new SimplexNoise(this.seed ^ 0x55aa11);
    this.detail = new SimplexNoise(this.seed ^ 0x77e3);
    this.mountains = new SimplexNoise(this.seed ^ 0x3141592);
    this.climate = new SimplexNoise(this.seed ^ 0x2718281);
    this.caves = new SimplexNoise(this.seed ^ 0xc4fe);
    this.caves2 = new SimplexNoise(this.seed ^ 0xbeef);
    this.flora = new SimplexNoise(this.seed ^ 0xf10a);
    this.spawn = spawn ?? this.findSpawn();
  }

  /** Samples the surface height and biome at a world column. Result in sampleH / sampleBiome. */
  private sample(x: number, z: number): void {
    const c = this.continental.fbm2(x * 0.0016, z * 0.0016, 4);
    const e = this.hills.fbm2(x * 0.0042 + 31.7, z * 0.0042 - 17.3, 4);
    const d = this.detail.fbm2(x * 0.021, z * 0.021, 3);
    const r = this.mountains.ridged2(x * 0.0036 + 50.1, z * 0.0036 - 80.4, 5);
    const mask = smoothstep(0.02, 0.5, this.mountains.fbm2(x * 0.0011 - 300, z * 0.0011 + 200, 3));

    let h = SEA_LEVEL + 4 + c * 15;
    if (c < -0.22) h -= (-0.22 - c) * 30;
    h += e * 9 * (0.45 + 0.55 * smoothstep(-0.2, 0.35, c));
    h += d * 2.2;
    h += r * r * mask * 58 * smoothstep(-0.15, 0.2, c);
    const height = Math.max(4, Math.min(WORLD_HEIGHT - 10, Math.floor(h)));

    const temp = this.climate.fbm2(x * 0.0021 + 500, z * 0.0021 - 500, 3);
    const moist = this.climate.fbm2(x * 0.0025 - 900, z * 0.0025 + 900, 3);

    let biome: number;
    if (height > 90 + d * 5) biome = BIOME.PEAKS;
    else if (height < SEA_LEVEL - 2) biome = BIOME.OCEAN;
    else if (height <= SEA_LEVEL + 1 && temp > -0.3) biome = BIOME.BEACH;
    else if (temp > 0.26 && moist < 0.08) biome = BIOME.DESERT;
    else if (temp < -0.3) biome = BIOME.TUNDRA;
    else if (moist > 0.1) biome = temp < -0.04 ? BIOME.BIRCH : BIOME.FOREST;
    else biome = BIOME.PLAINS;

    this.sampleH = height;
    this.sampleBiome = biome;
  }

  heightAt(x: number, z: number): number {
    this.sample(x, z);
    return this.sampleH;
  }

  biomeAt(x: number, z: number): number {
    this.sample(x, z);
    return this.sampleBiome;
  }

  private caveFieldA(x: number, y: number, z: number): number {
    return this.caves.noise3(x * 0.022, y * 0.034, z * 0.022);
  }

  private caveFieldB(x: number, y: number, z: number): number {
    return this.caves2.noise3(x * 0.022 + 40, y * 0.034, z * 0.022 - 40);
  }

  private static carves(a: number, b: number, y: number): boolean {
    // Two noise zero-surfaces intersecting form winding tunnels ("spaghetti" caves).
    const widen = y < 24 ? 0.018 : 0.012;
    return a * a + b * b < widen;
  }

  /** Whether the cave carver removes (x, y, z). Matches the grid-interpolated result used in columns. */
  isCave(x: number, y: number, z: number, surface: number): boolean {
    if (!this.caveAllowed(y, surface)) return false;
    const gx = Math.floor(x / CAVE_STEP) * CAVE_STEP;
    const gy = Math.floor(y / CAVE_STEP) * CAVE_STEP;
    const gz = Math.floor(z / CAVE_STEP) * CAVE_STEP;
    const fx = (x - gx) / CAVE_STEP;
    const fy = (y - gy) / CAVE_STEP;
    const fz = (z - gz) / CAVE_STEP;
    const tri = (f: (x: number, y: number, z: number) => number) => {
      const c000 = f(gx, gy, gz);
      const c100 = f(gx + CAVE_STEP, gy, gz);
      const c010 = f(gx, gy + CAVE_STEP, gz);
      const c110 = f(gx + CAVE_STEP, gy + CAVE_STEP, gz);
      const c001 = f(gx, gy, gz + CAVE_STEP);
      const c101 = f(gx + CAVE_STEP, gy, gz + CAVE_STEP);
      const c011 = f(gx, gy + CAVE_STEP, gz + CAVE_STEP);
      const c111 = f(gx + CAVE_STEP, gy + CAVE_STEP, gz + CAVE_STEP);
      const x00 = c000 + (c100 - c000) * fx;
      const x10 = c010 + (c110 - c010) * fx;
      const x01 = c001 + (c101 - c001) * fx;
      const x11 = c011 + (c111 - c011) * fx;
      const y0 = x00 + (x10 - x00) * fy;
      const y1 = x01 + (x11 - x01) * fy;
      return y0 + (y1 - y0) * fz;
    };
    const a = tri((px, py, pz) => this.caveFieldA(px, py, pz));
    const b = tri((px, py, pz) => this.caveFieldB(px, py, pz));
    return TerrainGenerator.carves(a, b, y);
  }

  private caveAllowed(y: number, surface: number): boolean {
    if (y < 4) return false;
    if (surface < SEA_LEVEL + 3) return y < surface - 7;
    return y <= surface;
  }

  private topBlock(biome: number, height: number, slope: number, x: number, z: number): number {
    switch (biome) {
      case BIOME.DESERT:
        return B.SAND;
      case BIOME.BEACH:
        return hash2(x, z, this.seed + 3) < 0.08 ? B.GRAVEL : B.SAND;
      case BIOME.OCEAN: {
        const n = this.flora.noise2(x * 0.05, z * 0.05);
        if (n > 0.45) return B.CLAY;
        if (n < -0.4) return B.GRAVEL;
        return B.SAND;
      }
      case BIOME.PEAKS:
        return slope > 6 ? B.STONE : B.SNOW;
      case BIOME.TUNDRA:
        return slope > 4 ? B.STONE : B.SNOWY_GRASS;
      default:
        if (slope > 5 && height > SEA_LEVEL + 12) return B.STONE;
        return B.GRASS;
    }
  }

  /** Generates a full column of blocks for chunk (cx, cz). */
  generateColumn(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(COLUMN_VOLUME);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const heights = this.heights;
    const biomes = this.biomes;
    const tops = this.tops;

    // 1. Surface heights and biomes, including a margin for neighbouring trees.
    for (let az = 0; az < AREA; az++) {
      for (let ax = 0; ax < AREA; ax++) {
        this.sample(x0 + ax - M, z0 + az - M);
        heights[az * AREA + ax] = this.sampleH;
        biomes[az * AREA + ax] = this.sampleBiome;
      }
    }
    for (let az = 0; az < AREA; az++) {
      for (let ax = 0; ax < AREA; ax++) {
        const i = az * AREA + ax;
        const h = heights[i];
        const hx0 = heights[az * AREA + Math.max(0, ax - 1)];
        const hx1 = heights[az * AREA + Math.min(AREA - 1, ax + 1)];
        const hz0 = heights[Math.max(0, az - 1) * AREA + ax];
        const hz1 = heights[Math.min(AREA - 1, az + 1) * AREA + ax];
        const slope = Math.abs(hx1 - hx0) + Math.abs(hz1 - hz0);
        tops[i] = this.topBlock(biomes[i], h, slope, x0 + ax - M, z0 + az - M);
      }
    }

    // 2. Cave noise on a coarse grid, trilinearly interpolated below.
    const caveA = this.caveA;
    const caveB = this.caveB;
    for (let gy = 0; gy < CAVE_NY; gy++) {
      for (let gz = 0; gz < CAVE_NX; gz++) {
        for (let gx = 0; gx < CAVE_NX; gx++) {
          const wx = x0 + gx * CAVE_STEP;
          const wy = gy * CAVE_STEP;
          const wz = z0 + gz * CAVE_STEP;
          const i = (gy * CAVE_NX + gz) * CAVE_NX + gx;
          caveA[i] = this.caveFieldA(wx, wy, wz);
          caveB[i] = this.caveFieldB(wx, wy, wz);
        }
      }
    }
    const caveAt = (lx: number, y: number, lz: number): boolean => {
      const gx = lx >> 2;
      const gy = y >> 2;
      const gz = lz >> 2;
      const fx = (lx & 3) / CAVE_STEP;
      const fy = (y & 3) / CAVE_STEP;
      const fz = (lz & 3) / CAVE_STEP;
      const i000 = (gy * CAVE_NX + gz) * CAVE_NX + gx;
      const i010 = i000 + CAVE_NX * CAVE_NX;
      const i001 = i000 + CAVE_NX;
      const i011 = i010 + CAVE_NX;
      const lerp3 = (f: Float64Array) => {
        const x00 = f[i000] + (f[i000 + 1] - f[i000]) * fx;
        const x10 = f[i010] + (f[i010 + 1] - f[i010]) * fx;
        const x01 = f[i001] + (f[i001 + 1] - f[i001]) * fx;
        const x11 = f[i011] + (f[i011 + 1] - f[i011]) * fx;
        const y0 = x00 + (x10 - x00) * fy;
        const y1 = x01 + (x11 - x01) * fy;
        return y0 + (y1 - y0) * fz;
      };
      return TerrainGenerator.carves(lerp3(caveA), lerp3(caveB), y);
    };

    // 3. Fill terrain layers, water and caves.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const ai = (lz + M) * AREA + (lx + M);
        const h = heights[ai];
        const biome = biomes[ai];
        const top = tops[ai];
        const wx = x0 + lx;
        const wz = z0 + lz;
        const subDepth = biome === BIOME.DESERT ? 4 : 3;
        const sub =
          top === B.SAND || top === B.GRAVEL || top === B.CLAY
            ? top === B.CLAY
              ? B.CLAY
              : B.SAND
            : top === B.STONE
              ? B.STONE
              : top === B.SNOW
                ? B.STONE
                : B.DIRT;
        const maxY = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= maxY; y++) {
          let id: number;
          if (y === 0) id = B.BEDROCK;
          else if (y <= 2 && hash3(wx, y, wz, this.seed) < (y === 1 ? 0.6 : 0.25)) id = B.BEDROCK;
          else if (y <= h) {
            const depth = h - y;
            if (depth === 0) id = top;
            else if (depth <= subDepth) id = sub;
            else if (biome === BIOME.DESERT && depth <= subDepth + 3) id = B.SANDSTONE;
            else id = B.STONE;
            if (this.caveAllowed(y, h) && caveAt(lx, y, lz)) id = B.AIR;
          } else {
            id = B.WATER;
          }
          blocks[columnIndex(lx, y, lz)] = id;
        }
      }
    }

    // 4. Ore veins (deterministic per chunk).
    const rand = mulberry32((this.seed ^ Math.imul(cx, 0x632be5ab) ^ Math.imul(cz, 0x85157af5)) >>> 0);
    this.placeVeins(blocks, rand, B.COAL_ORE, 16, 7, 6, 90);
    this.placeVeins(blocks, rand, B.IRON_ORE, 9, 5, 4, 56);
    this.placeVeins(blocks, rand, B.GRAVEL, 4, 10, 4, 70);

    // 5. Trees on a jittered grid so trunks never touch.
    const cell = 5;
    const gxMin = Math.floor((x0 - M) / cell);
    const gxMax = Math.floor((x0 + CHUNK_SIZE + M - 1) / cell);
    const gzMin = Math.floor((z0 - M) / cell);
    const gzMax = Math.floor((z0 + CHUNK_SIZE + M - 1) / cell);
    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const tx = gx * cell + Math.floor(hash2(gx, gz, this.seed + 11) * (cell - 1));
        const tz = gz * cell + Math.floor(hash2(gx, gz, this.seed + 13) * (cell - 1));
        const ax = tx - x0 + M;
        const az = tz - z0 + M;
        if (ax < 0 || az < 0 || ax >= AREA || az >= AREA) continue;
        const ai = az * AREA + ax;
        const biome = biomes[ai];
        const chance =
          biome === BIOME.FOREST ? 0.78 : biome === BIOME.BIRCH ? 0.7 : biome === BIOME.PLAINS ? 0.045 : biome === BIOME.TUNDRA ? 0.08 : 0;
        if (chance === 0 || hash2(gx, gz, this.seed + 7) >= chance) continue;
        const top = tops[ai];
        if (top !== B.GRASS && top !== B.SNOWY_GRASS) continue;
        const h = heights[ai];
        if (h <= SEA_LEVEL || h > WORLD_HEIGHT - 16) continue;
        const dxs = tx - this.spawn.x;
        const dzs = tz - this.spawn.z;
        if (dxs * dxs + dzs * dzs < SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS) continue;
        if (this.isCave(tx, h, tz, h) || this.isCave(tx, h - 1, tz, h)) continue;
        const kind = hash2(gx, gz, this.seed + 17);
        const birch = biome === BIOME.BIRCH || biome === BIOME.TUNDRA || (biome === BIOME.FOREST && kind < 0.18);
        this.placeTree(blocks, x0, z0, tx, h + 1, tz, birch, hash2(tx, tz, this.seed + 19));
      }
    }

    // 6. Grass tufts and flowers.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const ai = (lz + M) * AREA + (lx + M);
        const h = heights[ai];
        if (h + 1 >= WORLD_HEIGHT || h < SEA_LEVEL) continue;
        if (blocks[columnIndex(lx, h, lz)] !== B.GRASS) continue;
        if (blocks[columnIndex(lx, h + 1, lz)] !== B.AIR) continue;
        const biome = biomes[ai];
        const wx = x0 + lx;
        const wz = z0 + lz;
        const sdx = wx - this.spawn.x;
        const sdz = wz - this.spawn.z;
        if (sdx * sdx + sdz * sdz < 16) continue;
        const r = hash2(wx, wz, this.seed + 23);
        const patch = this.flora.noise2(wx * 0.045, wz * 0.045);
        const grassChance = biome === BIOME.PLAINS ? 0.1 + patch * 0.07 : 0.05;
        const flowerChance = patch > 0.35 ? (biome === BIOME.PLAINS ? 0.09 : 0.03) : 0.004;
        let plant = 0;
        if (r < flowerChance) plant = hash2(wx, wz, this.seed + 29) < 0.5 ? B.RED_FLOWER : B.YELLOW_FLOWER;
        else if (r < flowerChance + grassChance) plant = B.TALL_GRASS;
        if (plant) blocks[columnIndex(lx, h + 1, lz)] = plant;
      }
    }

    return blocks;
  }

  private placeVeins(
    blocks: Uint8Array,
    rand: () => number,
    ore: number,
    count: number,
    size: number,
    minY: number,
    maxY: number,
  ): void {
    for (let v = 0; v < count; v++) {
      let x = rand() * CHUNK_SIZE;
      let y = minY + rand() * (maxY - minY);
      let z = rand() * CHUNK_SIZE;
      const n = Math.max(2, Math.floor(size * (0.5 + rand())));
      for (let i = 0; i < n; i++) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        if (ix >= 0 && iz >= 0 && ix < CHUNK_SIZE && iz < CHUNK_SIZE && iy > 0 && iy < WORLD_HEIGHT) {
          const idx = columnIndex(ix, iy, iz);
          if (blocks[idx] === B.STONE) blocks[idx] = ore;
        }
        x += rand() * 2 - 1;
        y += rand() * 1.4 - 0.7;
        z += rand() * 2 - 1;
      }
    }
  }

  private placeTree(
    blocks: Uint8Array,
    x0: number,
    z0: number,
    tx: number,
    baseY: number,
    tz: number,
    birch: boolean,
    r: number,
  ): void {
    const log = birch ? B.BIRCH_LOG : B.OAK_LOG;
    const leaves = birch ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const trunk = birch ? 5 + Math.floor(r * 3) : 4 + Math.floor(r * 3);
    const topY = baseY + trunk - 1;
    const set = (x: number, y: number, z: number, id: number, overwrite: boolean) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const idx = columnIndex(lx, y, lz);
      const cur = blocks[idx];
      if (cur === B.AIR || cur === B.TALL_GRASS || cur === B.RED_FLOWER || cur === B.YELLOW_FLOWER || (overwrite && cur === leaves)) {
        blocks[idx] = id;
      }
    };
    // Canopy: two wide layers and two narrow layers.
    for (let dy = -2; dy <= 1; dy++) {
      const y = topY + dy;
      const radius = dy <= -1 ? 2 : 1;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (corner) {
            if (dy === 1) continue;
            if (hash3(tx + dx, y, tz + dz, this.seed + 31) < (radius === 2 ? 0.55 : 0.7)) continue;
          }
          if (dy === 1 && (dx !== 0 || dz !== 0) && Math.abs(dx) + Math.abs(dz) > 1) continue;
          set(tx + dx, y, tz + dz, leaves, false);
        }
      }
    }
    for (let y = baseY; y <= topY; y++) set(tx, y, tz, log, true);
    // Ground under the trunk becomes dirt.
    const lx = tx - x0;
    const lz = tz - z0;
    if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE) {
      blocks[columnIndex(lx, baseY - 1, lz)] = B.DIRT;
    }
  }

  /** Finds a flat, dry, tree-free spot near the origin. */
  private findSpawn(): SpawnPoint {
    const ok = (x: number, z: number): number | null => {
      this.sample(x, z);
      const h = this.sampleH;
      const biome = this.sampleBiome;
      if (h <= SEA_LEVEL + 1 || h > SEA_LEVEL + 24) return null;
      if (biome !== BIOME.PLAINS && biome !== BIOME.FOREST && biome !== BIOME.BIRCH) return null;
      for (const [dx, dz] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
        [2, 2],
        [-2, -2],
      ]) {
        if (Math.abs(this.heightAt(x + dx, z + dz) - h) > 1) return null;
      }
      for (let y = h - 4; y <= h; y++) if (this.isCave(x, y, z, h)) return null;
      return h;
    };
    for (let ring = 0; ring <= 96; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [x, z] of [
          [i * 4, -ring * 4],
          [i * 4, ring * 4],
          [-ring * 4, i * 4],
          [ring * 4, i * 4],
        ]) {
          const h = ok(x, z);
          if (h !== null) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
    }
    const h = Math.max(this.heightAt(0, 0), SEA_LEVEL);
    return { x: 0.5, y: h + 1, z: 0.5 };
  }
}
