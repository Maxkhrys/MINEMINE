import { describe, expect, it } from 'vitest';
import { B } from '../src/world/blocks';
import { SEA_LEVEL, SECTION_COUNT, WORLD_HEIGHT, columnIndex, columnKey } from '../src/world/constants';
import { TerrainGenerator } from '../src/world/generator';
import { SectionMesher } from '../src/world/mesher';
import { World } from '../src/world/World';

function flatWorld(): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 20; y++) blocks[columnIndex(x, y, z)] = B.STONE;
      world.addColumn(cx, cz, blocks);
    }
  }
  return world;
}

describe('World', () => {
  it('reads and writes negative coordinates in the right column', () => {
    const world = flatWorld();
    expect(world.getBlock(-1, 20, -1)).toBe(B.STONE);
    expect(world.setBlock(-1, 21, -16, B.BRICKS)).toBe(true);
    expect(world.getBlock(-1, 21, -16)).toBe(B.BRICKS);
    const col = world.getColumn(-1, -1)!;
    expect(col.blocks[columnIndex(15, 21, 0)]).toBe(B.BRICKS);
    expect(world.edits.get(columnKey(-1, -1))?.get(columnIndex(15, 21, 0))).toBe(B.BRICKS);
  });

  it('marks neighbouring chunk sections dirty for edits on a chunk border', () => {
    const world = flatWorld();
    for (const col of world.columns.values()) col.dirty.fill(0);
    world.urgent.clear();
    world.setBlock(0, 20, 5, B.AIR); // x = 0 is the western edge of chunk 0
    expect(world.getColumn(0, 0)!.dirty[1]).toBe(1);
    expect(world.getColumn(-1, 0)!.dirty[1]).toBe(1);
    expect(world.getColumn(1, 0)!.dirty[1]).toBe(0);
    // y = 20 → section 1 only (y 19..21 all inside section 1), but the heightmap
    // change also reaches further down within the ±2 neighbourhood.
    expect(world.getColumn(0, 0)!.dirty[SECTION_COUNT - 1]).toBe(0);
  });

  it('keeps the heightmap in sync with edits', () => {
    const world = flatWorld();
    const col = world.getColumn(0, 0)!;
    expect(col.heightmap[(3 << 4) | 2]).toBe(20);
    world.setBlock(2, 40, 3, B.GLASS); // glass does not block the sky
    expect(col.heightmap[(3 << 4) | 2]).toBe(20);
    world.setBlock(2, 41, 3, B.DIRT);
    expect(col.heightmap[(3 << 4) | 2]).toBe(41);
    world.setBlock(2, 41, 3, B.AIR);
    expect(col.heightmap[(3 << 4) | 2]).toBe(20);
  });
});

describe('SectionMesher', () => {
  it('culls faces between solid neighbours, including across chunk borders', () => {
    const world = flatWorld();
    const mesher = new SectionMesher();
    const cols = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cols.push(world.getColumn(dx, dz)!);
    // Section 1 holds y 16..31; the stone top is at y = 20 → only 16*16 top faces.
    const geo = mesher.mesh(cols, 1);
    expect(geo.solid!.vertexCount).toBe(16 * 16 * 4);
    expect(geo.cutout).toBeNull();
    // Removing a block on the chunk edge exposes faces in both chunks.
    world.setBlock(15, 20, 8, B.AIR);
    const geo2 = mesher.mesh(cols, 1);
    // top faces: 255 + floor of the hole (1) ; walls of the hole: 3 inside this chunk
    expect(geo2.solid!.vertexCount).toBe((255 + 1 + 3) * 4);
  });
});

describe('TerrainGenerator', () => {
  it('is deterministic for a seed and places spawn on dry land', () => {
    const a = new TerrainGenerator(12345);
    const b = new TerrainGenerator(12345);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.generateColumn(-3, 7)).toEqual(b.generateColumn(-3, 7));
    expect(a.spawn.y).toBeGreaterThan(SEA_LEVEL + 1);
    const col = a.generateColumn(Math.floor(a.spawn.x / 16), Math.floor(a.spawn.z / 16));
    const lx = Math.floor(a.spawn.x) & 15;
    const lz = Math.floor(a.spawn.z) & 15;
    const below = col[columnIndex(lx, a.spawn.y - 1, lz)];
    expect([B.GRASS, B.DIRT]).toContain(below);
    expect(col[columnIndex(lx, a.spawn.y + 1, lz)]).toBe(B.AIR);
  });

  it('generates different worlds for different seeds', () => {
    const a = new TerrainGenerator(1).generateColumn(0, 0);
    const b = new TerrainGenerator(2).generateColumn(0, 0);
    expect(a).not.toEqual(b);
  });
});
