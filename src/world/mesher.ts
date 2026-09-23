import { B, BLOCKS, IS_OCCLUDER, IS_OPAQUE, RENDER_KIND, tile } from './blocks';
import { CHUNK_MASK, CHUNK_SIZE, SECTION_SIZE, WORLD_HEIGHT, columnIndex } from './constants';
import type { Column } from './World';

/** Plain typed-array geometry, independent of three.js so it can be unit tested. */
export interface GeometryBuffers {
  positions: Float32Array;
  normals: Int8Array;
  /** Normalised 0..255 texture coordinates within a tile. */
  uvs: Uint8Array;
  /** Per vertex: [texture layer, ambient occlusion 0..255, sky visibility 0..255, flags]. */
  data: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
}

export interface SectionGeometry {
  solid: GeometryBuffers | null;
  cutout: GeometryBuffers | null;
  water: GeometryBuffers | null;
}

/** Vertex flags, mirrored in the terrain shaders. */
export const FLAG_LEAVES = 1;
export const FLAG_SWAY = 2;
export const FLAG_TINT = 4;
export const FLAG_EMISSIVE = 8;
export const FLAG_PLANT = 16;
/** Water: vertex belongs to a top surface. */
export const FLAG_WATER_TOP = 1;

export const WATER_SURFACE = 0.875;

class Builder {
  pos = new Float32Array(0);
  nor = new Int8Array(0);
  uv = new Uint8Array(0);
  dat = new Uint8Array(0);
  idx = new Uint32Array(0);
  vc = 0;
  ic = 0;

  constructor() {
    this.grow(4096);
  }

  reset(): void {
    this.vc = 0;
    this.ic = 0;
  }

  private grow(verts: number): void {
    const pos = new Float32Array(verts * 3);
    const nor = new Int8Array(verts * 3);
    const uv = new Uint8Array(verts * 2);
    const dat = new Uint8Array(verts * 4);
    const idx = new Uint32Array(Math.ceil(verts * 1.5));
    pos.set(this.pos.subarray(0, this.vc * 3));
    nor.set(this.nor.subarray(0, this.vc * 3));
    uv.set(this.uv.subarray(0, this.vc * 2));
    dat.set(this.dat.subarray(0, this.vc * 4));
    idx.set(this.idx.subarray(0, this.ic));
    this.pos = pos;
    this.nor = nor;
    this.uv = uv;
    this.dat = dat;
    this.idx = idx;
  }

  ensureQuad(): void {
    if (this.vc + 4 > this.pos.length / 3) this.grow((this.pos.length / 3) * 2);
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, d0: number, d1: number, d2: number, d3: number): void {
    const i = this.vc++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = nx;
    this.nor[i * 3 + 1] = ny;
    this.nor[i * 3 + 2] = nz;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.dat[i * 4] = d0;
    this.dat[i * 4 + 1] = d1;
    this.dat[i * 4 + 2] = d2;
    this.dat[i * 4 + 3] = d3;
  }

  /** Two triangles for the last four vertices; `flip` chooses the 1-3 diagonal. */
  quad(flip: boolean): void {
    const b = this.vc - 4;
    const idx = this.idx;
    let i = this.ic;
    if (flip) {
      idx[i++] = b + 1; idx[i++] = b + 2; idx[i++] = b + 3;
      idx[i++] = b + 1; idx[i++] = b + 3; idx[i++] = b;
    } else {
      idx[i++] = b; idx[i++] = b + 1; idx[i++] = b + 2;
      idx[i++] = b; idx[i++] = b + 2; idx[i++] = b + 3;
    }
    this.ic = i;
  }

  build(): GeometryBuffers | null {
    if (this.vc === 0) return null;
    const indices = this.vc <= 65535 ? new Uint16Array(this.idx.subarray(0, this.ic)) : this.idx.slice(0, this.ic);
    return {
      positions: this.pos.slice(0, this.vc * 3),
      normals: this.nor.slice(0, this.vc * 3),
      uvs: this.uv.slice(0, this.vc * 2),
      data: this.dat.slice(0, this.vc * 4),
      indices,
      vertexCount: this.vc,
    };
  }
}

const P = SECTION_SIZE + 2; // padded edge length (18)
const PH = P + 2; // padded heightmap edge length (20)
const DY = P * P;
const DZ = P;

type Vec3 = [number, number, number];

interface FaceDef {
  n: Vec3;
  u: Vec3;
  v: Vec3;
  /** Local corner positions for (cu, cv) = (0,0), (1,0), (1,1), (0,1). */
  corners: Vec3[];
  nOff: number;
  uOff: number;
  vOff: number;
}

function offsetOf(d: Vec3): number {
  return d[0] + d[1] * DY + d[2] * DZ;
}

/** Face order: +X, -X, +Y, -Y, +Z, -Z. U x V = N so corners wind counter-clockwise from outside. */
const FACES: FaceDef[] = (
  [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ] as [Vec3, Vec3, Vec3][]
).map(([n, u, v]) => {
  const corners: Vec3[] = [];
  for (const [cu, cv] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const p: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      if (n[a] > 0) p[a] = 1;
      if (u[a] !== 0) p[a] = u[a] > 0 ? cu : 1 - cu;
      if (v[a] !== 0) p[a] = v[a] > 0 ? cv : 1 - cv;
    }
    corners.push(p);
  }
  return { n, u, v, corners, nOff: offsetOf(n), uOff: offsetOf(u), vOff: offsetOf(v) };
});

const CORNER_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const SKY_FALLOFF = 0.1;

/** Converts a column-neighbourhood into section geometry. One instance is reused for all sections. */
export class SectionMesher {
  private pad = new Uint8Array(P * P * P);
  private hm = new Int16Array(PH * PH);
  private sky = new Float32Array(P * P * P);
  private depthCache = new Int8Array(P * P * P);
  private solid = new Builder();
  private cutout = new Builder();
  private water = new Builder();
  private baseY = 0;
  private cols: Column[] = [];

  /**
   * Meshes section `sy` of the centre column. `cols` holds the 3x3 neighbourhood in
   * row-major order (dz, dx) with the centre at index 4; all nine must be loaded.
   */
  mesh(cols: Column[], sy: number): SectionGeometry {
    this.cols = cols;
    const pad = this.pad;
    const baseY = sy * SECTION_SIZE - 1;
    this.baseY = baseY;

    // Padded copy of blocks: one block of margin on every side.
    for (let pz = 0; pz < P; pz++) {
      const lz = pz - 1;
      const cz = lz < 0 ? 0 : lz >= CHUNK_SIZE ? 2 : 1;
      const llz = lz & CHUNK_MASK;
      for (let px = 0; px < P; px++) {
        const lx = px - 1;
        const cx = lx < 0 ? 0 : lx >= CHUNK_SIZE ? 2 : 1;
        const blocks = cols[cz * 3 + cx].blocks;
        const llx = lx & CHUNK_MASK;
        for (let py = 0; py < P; py++) {
          const y = baseY + py;
          pad[py * DY + pz * DZ + px] = y < 0 ? B.BEDROCK : y >= WORLD_HEIGHT ? B.AIR : blocks[columnIndex(llx, y, llz)];
        }
      }
    }

    // Padded heightmap with two blocks of margin (sky is averaged over a 3x3 area).
    for (let hz = 0; hz < PH; hz++) {
      const lz = hz - 2;
      const cz = lz < 0 ? 0 : lz >= CHUNK_SIZE ? 2 : 1;
      for (let hx = 0; hx < PH; hx++) {
        const lx = hx - 2;
        const cx = lx < 0 ? 0 : lx >= CHUNK_SIZE ? 2 : 1;
        this.hm[hz * PH + hx] = cols[cz * 3 + cx].heightmap[((lz & CHUNK_MASK) << 4) | (lx & CHUNK_MASK)];
      }
    }

    this.sky.fill(-1);
    this.depthCache.fill(-1);
    this.solid.reset();
    this.cutout.reset();
    this.water.reset();

    for (let py = 1; py <= SECTION_SIZE; py++) {
      for (let pz = 1; pz <= SECTION_SIZE; pz++) {
        for (let px = 1; px <= SECTION_SIZE; px++) {
          const i = py * DY + pz * DZ + px;
          const id = pad[i];
          if (id === B.AIR) continue;
          const kind = RENDER_KIND[id];
          if (kind === 1 || kind === 2) this.emitBlock(i, px, py, pz, id, kind);
          else if (kind === 3) this.emitPlant(i, px, py, pz, id);
          else if (kind === 4) this.emitWater(i, px, py, pz);
        }
      }
    }

    return { solid: this.solid.build(), cutout: this.cutout.build(), water: this.water.build() };
  }

  /** Sky visibility (0..1) of a padded cell, averaged over its 3x3 column neighbourhood. */
  private skyAt(i: number): number {
    let s = this.sky[i];
    if (s >= 0) return s;
    const px = i % P;
    const pz = Math.floor(i / DZ) % P;
    const py = Math.floor(i / DY);
    const y = this.baseY + py;
    let sum = 0;
    for (let dz = 0; dz < 3; dz++) {
      const row = (pz + dz) * PH + px;
      for (let dx = 0; dx < 3; dx++) {
        const d = this.hm[row + dx] - y;
        sum += d <= 0 ? 1 : Math.max(0, 1 - d * SKY_FALLOFF);
      }
    }
    s = sum / 9;
    this.sky[i] = s;
    return s;
  }

  private emitBlock(i: number, px: number, py: number, pz: number, id: number, kind: number): void {
    const pad = this.pad;
    const def = BLOCKS[id];
    const builder = kind === 1 ? this.solid : this.cutout;
    const lx = px - 1;
    const ly = py - 1;
    const lz = pz - 1;
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const ni = i + face.nOff;
      const n = pad[ni];
      if (IS_OPAQUE[n]) continue;
      if (kind === 2 && n === id) continue;
      let flags = 0;
      if (def.wind) flags |= FLAG_LEAVES;
      if (def.tint && (id !== B.GRASS || f === 2)) flags |= FLAG_TINT;
      if (def.emissive) flags |= FLAG_EMISSIVE;
      this.emitFace(builder, face, ni, lx, ly, lz, def.faces[f], flags);
    }
  }

  private emitFace(builder: Builder, face: FaceDef, ni: number, lx: number, ly: number, lz: number, layer: number, flags: number): void {
    const pad = this.pad;
    builder.ensureQuad();
    const ao = [0, 0, 0, 0];
    const nx = face.n[0] * 127;
    const ny = face.n[1] * 127;
    const nz = face.n[2] * 127;
    const skyN = this.skyAt(ni);
    for (let c = 0; c < 4; c++) {
      const cu = CORNER_UV[c][0];
      const cv = CORNER_UV[c][1];
      const s1i = ni + (cu ? face.uOff : -face.uOff);
      const s2i = ni + (cv ? face.vOff : -face.vOff);
      const cri = s1i + (cv ? face.vOff : -face.vOff);
      const s1 = pad[s1i];
      const s2 = pad[s2i];
      const cr = pad[cri];
      const o1 = IS_OCCLUDER[s1];
      const o2 = IS_OCCLUDER[s2];
      const o3 = IS_OCCLUDER[cr];
      const a = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
      ao[c] = a;
      // Smooth sky light: average over the non-opaque cells touching this corner.
      let skySum = skyN;
      let skyN2 = 1;
      if (!IS_OPAQUE[s1]) {
        skySum += this.skyAt(s1i);
        skyN2++;
      }
      if (!IS_OPAQUE[s2]) {
        skySum += this.skyAt(s2i);
        skyN2++;
      }
      if (!IS_OPAQUE[cr] && !(o1 && o2)) {
        skySum += this.skyAt(cri);
        skyN2++;
      }
      const p = face.corners[c];
      builder.vertex(lx + p[0], ly + p[1], lz + p[2], nx, ny, nz, cu * 255, cv * 255, layer, a * 85, Math.round((skySum / skyN2) * 255), flags);
    }
    builder.quad(ao[0] + ao[2] > ao[1] + ao[3]);
  }

  private emitPlant(i: number, px: number, py: number, pz: number, id: number): void {
    const def = BLOCKS[id];
    const b = this.cutout;
    const lx = px - 1;
    const ly = py - 1;
    const lz = pz - 1;
    const layer = def.faces[0];
    const sky = Math.round(this.skyAt(i) * 255);
    const flagsBase = FLAG_PLANT | (def.tint ? FLAG_TINT : 0);
    const lo = 0.146;
    const hi = 0.854;
    const h = 0.95;
    const quads: [number, number, number, number][] = [
      [lo, lo, hi, hi],
      [lo, hi, hi, lo],
    ];
    for (const [x0, z0, x1, z1] of quads) {
      b.ensureQuad();
      b.vertex(lx + x0, ly, lz + z0, 0, 127, 0, 0, 0, layer, 128, sky, flagsBase);
      b.vertex(lx + x1, ly, lz + z1, 0, 127, 0, 255, 0, layer, 128, sky, flagsBase);
      b.vertex(lx + x1, ly + h, lz + z1, 0, 127, 0, 255, 255, layer, 255, sky, flagsBase | FLAG_SWAY);
      b.vertex(lx + x0, ly + h, lz + z0, 0, 127, 0, 0, 255, layer, 255, sky, flagsBase | FLAG_SWAY);
      b.quad(false);
    }
  }

  /** Depth of the water column starting at padded cell i (0 if not water). */
  private waterDepth(i: number): number {
    const cached = this.depthCache[i];
    if (cached >= 0) return cached;
    let d = 0;
    if (this.pad[i] === B.WATER) {
      const px = i % P;
      const pz = Math.floor(i / DZ) % P;
      const py = Math.floor(i / DY);
      const lx = px - 1;
      const lz = pz - 1;
      const col = this.cols[(lz < 0 ? 0 : lz >= CHUNK_SIZE ? 2 : 1) * 3 + (lx < 0 ? 0 : lx >= CHUNK_SIZE ? 2 : 1)];
      const llx = lx & CHUNK_MASK;
      const llz = lz & CHUNK_MASK;
      for (let y = this.baseY + py; y >= 0 && d < 12; y--) {
        if (col.blocks[columnIndex(llx, y, llz)] !== B.WATER) break;
        d++;
      }
    }
    this.depthCache[i] = d;
    return d;
  }

  private emitWater(i: number, px: number, py: number, pz: number): void {
    const pad = this.pad;
    const b = this.water;
    const lx = px - 1;
    const ly = py - 1;
    const lz = pz - 1;
    const lowered = pad[i + DY] !== B.WATER;
    const top = lowered ? WATER_SURFACE : 1;
    const layer = tile('water');
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const ni = i + face.nOff;
      const n = pad[ni];
      if (n === B.WATER || IS_OPAQUE[n]) continue;
      b.ensureQuad();
      const sky = Math.round(this.skyAt(ni) * 255);
      const isTop = f === 2;
      for (let c = 0; c < 4; c++) {
        const cu = CORNER_UV[c][0];
        const cv = CORNER_UV[c][1];
        const p = face.corners[c];
        let depth = this.waterDepth(i);
        if (isTop) {
          // Average the depth of the four cells sharing this corner for smooth shorelines.
          const s1i = i + (cu ? face.uOff : -face.uOff);
          const s2i = i + (cv ? face.vOff : -face.vOff);
          const cri = s1i + (cv ? face.vOff : -face.vOff);
          depth = (depth + this.waterDepth(s1i) + this.waterDepth(s2i) + this.waterDepth(cri)) / 4;
        }
        const y = p[1] === 1 ? top : 0;
        b.vertex(
          lx + p[0],
          ly + y,
          lz + p[2],
          face.n[0] * 127,
          face.n[1] * 127,
          face.n[2] * 127,
          cu * 255,
          Math.round((p[1] === 1 && !isTop ? top : cv) * 255),
          layer,
          Math.min(255, Math.round(depth * 20)),
          sky,
          isTop ? FLAG_WATER_TOP : 0,
        );
      }
      b.quad(false);
    }
  }
}
