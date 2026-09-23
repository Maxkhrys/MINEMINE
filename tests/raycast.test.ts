import { describe, expect, it } from 'vitest';
import { B } from '../src/world/blocks';
import { raycastVoxels, type RayHit } from '../src/world/raycast';

function worldOf(blocks: [number, number, number, number][]) {
  const m = new Map<string, number>();
  for (const [x, y, z, id] of blocks) m.set(`${x},${y},${z}`, id);
  return (x: number, y: number, z: number) => m.get(`${x},${y},${z}`) ?? B.AIR;
}

function cast(get: (x: number, y: number, z: number) => number, o: number[], d: number[], reach = 4.5): RayHit | null {
  return raycastVoxels(get, o[0], o[1], o[2], d[0], d[1], d[2], reach);
}

describe('raycastVoxels (3D DDA)', () => {
  it('hits the first solid voxel and reports the entered face', () => {
    const get = worldOf([[3, 0, 0, B.STONE]]);
    const hit = cast(get, [0.5, 0.5, 0.5], [1, 0, 0]);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([3, 0, 0]);
    expect([hit!.nx, hit!.ny, hit!.nz]).toEqual([-1, 0, 0]);
    expect(hit!.t).toBeCloseTo(2.5, 9);
  });

  it('never selects through a nearer block', () => {
    const get = worldOf([
      [2, 0, 0, B.DIRT],
      [3, 0, 0, B.STONE],
    ]);
    const hit = cast(get, [0.5, 0.5, 0.5], [1, 0.01, 0.02]);
    expect([hit!.x, hit!.y, hit!.z]).toEqual([2, 0, 0]);
  });

  it('respects the 4.5 block reach exactly', () => {
    const get = worldOf([[5, 0, 0, B.STONE]]);
    // Face at x = 5, origin at 0.5 → 4.5 away: in reach.
    expect(cast(get, [0.5, 0.5, 0.5], [1, 0, 0])?.x).toBe(5);
    // Origin at 0.49 → 4.51 away: out of reach.
    expect(cast(get, [0.49, 0.5, 0.5], [1, 0, 0])).toBeNull();
  });

  it('handles negative coordinates and floors correctly', () => {
    const get = worldOf([[-3, -1, -2, B.STONE]]);
    const hit = cast(get, [-2.3, 0.5, -1.4], [-1, -1, -1]);
    expect([hit!.x, hit!.y, hit!.z]).toEqual([-3, -1, -2]);
    // Crosses y = 0 first (x = -2.8, z = -1.9), so it enters through the top face.
    expect([hit!.nx, hit!.ny, hit!.nz]).toEqual([0, 1, 0]);
  });

  it('crosses chunk borders (x = -1 / 0 and 15 / 16)', () => {
    const get = worldOf([
      [-1, 10, 4, B.BRICKS],
      [16, 10, 4, B.GLASS],
    ]);
    const a = cast(get, [0.2, 10.5, 4.5], [-1, 0, 0]);
    expect([a!.x, a!.nx]).toEqual([-1, 1]);
    const b = cast(get, [15.9, 10.5, 4.5], [1, 0, 0]);
    expect([b!.x, b!.nx]).toEqual([16, -1]);
  });

  it('is deterministic for rays passing exactly through block edges and corners', () => {
    const get = worldOf([
      [1, 1, 0, B.STONE],
      [1, 0, 0, B.DIRT],
      [0, 1, 0, B.SAND],
    ]);
    // Diagonal through the shared edge at (1, 1): the neighbours are entered at the same
    // distance, the ray must pick one of them (never skip to the far voxel).
    const hit = cast(get, [0.5, 0.5, 0.5], [1, 1, 0]);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(Math.SQRT1_2, 9);
    expect([B.DIRT, B.SAND]).toContain(hit!.id);
    const again = cast(get, [0.5, 0.5, 0.5], [1, 1, 0]);
    expect([again!.x, again!.y, again!.z]).toEqual([hit!.x, hit!.y, hit!.z]);
  });

  it('stays on the near block for rays grazing a corner', () => {
    const get = worldOf([
      [2, 0, 0, B.STONE],
      [2, 0, 1, B.DIRT],
    ]);
    // Aimed a hair inside the z=0 block near its corner with z=1.
    const hit = cast(get, [0.5, 0.5, 0.5], [1.5, 0, 0.4999]);
    expect([hit!.x, hit!.z]).toEqual([2, 0]);
    const hit2 = cast(get, [0.5, 0.5, 0.5], [1.5, 0, 0.5001]);
    expect([hit2!.x, hit2!.z]).toEqual([2, 1]);
  });

  it('reports a top-face normal when looking down', () => {
    const get = worldOf([[0, 0, 0, B.GRASS]]);
    const hit = cast(get, [0.3, 2.62, 0.7], [0.1, -1, 0.05]);
    expect([hit!.nx, hit!.ny, hit!.nz]).toEqual([0, 1, 0]);
    expect([hit!.x + hit!.nx, hit!.y + hit!.ny, hit!.z + hit!.nz]).toEqual([0, 1, 0]);
  });

  it('passes through water but hits plants only inside their selection box', () => {
    const get = worldOf([
      [1, 0, 0, B.WATER],
      [2, 0, 0, B.TALL_GRASS],
      [3, 0, 0, B.STONE],
    ]);
    // Through the middle of the grass box.
    const mid = cast(get, [0.5, 0.4, 0.5], [1, 0, 0]);
    expect(mid!.id).toBe(B.TALL_GRASS);
    expect(mid!.t).toBeCloseTo(1.7, 9);
    // Above the grass box (box height 0.8): continues to the stone behind.
    const high = cast(get, [0.5, 0.9, 0.5], [1, 0, 0]);
    expect(high!.id).toBe(B.STONE);
  });

  it('returns null when nothing is in range', () => {
    const get = worldOf([]);
    expect(cast(get, [0, 0, 0], [0.3, 0.4, 0.5])).toBeNull();
  });

  it('does not select the block behind a camera resting on its face', () => {
    const get = worldOf([[5, 0, 0, B.STONE]]);
    expect(cast(get, [5, 0.5, 0.5], [-1, 0, 0])).toBeNull();
  });
});
