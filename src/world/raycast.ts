import { BLOCKS, IS_TARGETABLE } from './blocks';

export interface RayHit {
  /** Integer coordinates of the selected voxel. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face the ray entered through (all zero if the ray starts inside). */
  nx: number;
  ny: number;
  nz: number;
  /** Distance from the ray origin to the entry point. */
  t: number;
  /** Block id of the selected voxel. */
  id: number;
}

export type BlockGetter = (x: number, y: number, z: number) => number;

const EPS = 1e-9;

/**
 * Ray / axis-aligned box intersection. Returns the entry distance and writes the entry
 * normal into `out`, or returns -1 when the ray misses or the box is behind the origin.
 */
function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  out: RayHit,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [x0, y0, z0];
  const hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < EPS) {
      if (o[a] <= lo[a] || o[a] >= hi[a]) return -1;
      continue;
    }
    let t1 = (lo[a] - o[a]) / d[a];
    let t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
    }
    if (t2 < tmax) tmax = t2;
  }
  if (tmax <= Math.max(tmin, 0)) return -1;
  out.nx = out.ny = out.nz = 0;
  if (tmin < 0) return 0; // origin inside the box
  if (axis === 0) out.nx = dx > 0 ? -1 : 1;
  else if (axis === 1) out.ny = dy > 0 ? -1 : 1;
  else out.nz = dz > 0 ? -1 : 1;
  return tmin;
}

/**
 * Camera-centred voxel raycast using a 3D DDA grid traversal (Amanatides & Woo).
 * Visits voxels strictly in the order the ray enters them and returns the first
 * targetable one within `maxDist`. Full blocks are hit on entry; blocks with a smaller
 * selection box (plants) are tested against that box inside their cell.
 * Works for negative coordinates and across chunk borders because it only uses
 * integer world coordinates and a block getter.
 */
export function raycastVoxels(
  getBlock: BlockGetter,
  ox: number, oy: number, oz: number,
  dirX: number, dirY: number, dirZ: number,
  maxDist: number,
  out: RayHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0, id: 0 },
): RayHit | null {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < EPS || !(maxDist > 0)) return null;
  const dx = dirX / len;
  const dy = dirY / len;
  const dz = dirZ / len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? 1 / Math.abs(dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? 1 / Math.abs(dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;

  let t = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let first = true;

  // A ray within reach can only cross a bounded number of cells.
  const maxSteps = Math.ceil(maxDist) * 3 + 6;
  for (let step = 0; step <= maxSteps; step++) {
    const id = getBlock(x, y, z);
    if (IS_TARGETABLE[id]) {
      const b = BLOCKS[id].box;
      const full = b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1 && b[4] === 1 && b[5] === 1;
      if (full && !first) {
        out.x = x;
        out.y = y;
        out.z = z;
        out.nx = nx;
        out.ny = ny;
        out.nz = nz;
        out.t = t;
        out.id = id;
        return out;
      }
      // Starting cell, or a partial box: exact box test inside this cell.
      const tb = rayBox(ox, oy, oz, dx, dy, dz, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5], out);
      if (tb >= 0 && tb <= maxDist) {
        out.x = x;
        out.y = y;
        out.z = z;
        out.t = tb;
        out.id = id;
        return out;
      }
    }
    first = false;

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}
