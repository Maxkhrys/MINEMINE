import * as THREE from 'three';
import { BLOCKS, TILE_NAMES, type TileName, blockDef } from '../world/blocks';
import { mulberry32 } from '../world/noise';

/**
 * Original procedural pixel-art textures. Every tile is drawn in code at 16x16 from a
 * fixed seed, so the look is deterministic and no external image assets are needed.
 */

export const TILE = 16;
type RGBA = [number, number, number, number];

function hex(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}

function shade(c: RGBA, f: number): RGBA {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f), c[3]];
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

class Tile {
  readonly px = new Uint8ClampedArray(TILE * TILE * 4);
  constructor(readonly rand: () => number) {}

  set(x: number, y: number, c: RGBA): void {
    x = ((x % TILE) + TILE) % TILE;
    y = ((y % TILE) + TILE) % TILE;
    const i = (y * TILE + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    x = ((x % TILE) + TILE) % TILE;
    y = ((y % TILE) + TILE) % TILE;
    const i = (y * TILE + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }

  fill(fn: (x: number, y: number) => RGBA): this {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, fn(x, y));
    return this;
  }

  pick(palette: RGBA[]): RGBA {
    return palette[Math.floor(this.rand() * palette.length)];
  }
}

/** Tileable value noise on a small lattice, returns 0..1. */
function valueNoise(rand: () => number, cells: number): (x: number, y: number) => number {
  const g = new Float32Array(cells * cells).map(() => rand());
  const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  const scale = cells / TILE;
  return (x: number, y: number) => {
    const fx = x * scale;
    const fy = y * scale;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function noisy(t: Tile, palette: RGBA[], cells = 4, jitter = 0.35): Tile {
  const n = valueNoise(t.rand, cells);
  return t.fill((x, y) => {
    const v = Math.min(0.999, Math.max(0, n(x, y) * (1 - jitter) + t.rand() * jitter));
    return palette[Math.floor(v * palette.length)];
  });
}

const GRASS = ['#4c8a36', '#53943b', '#5a9c40', '#61a445', '#68ab4a'].map((h) => hex(h));
const DIRT = ['#6e4d33', '#79573b', '#846143', '#8f6b4b', '#9a7654'].map((h) => hex(h));
const STONE = ['#6a6c6f', '#747679', '#7e8083', '#888a8c', '#929496'].map((h) => hex(h));
const SAND = ['#cdbd86', '#d6c690', '#ddcf9b', '#e4d8a8'].map((h) => hex(h));
const SNOW = ['#e3ecf3', '#ebf2f7', '#f3f7fb', '#fbfdff'].map((h) => hex(h));

function drawOreClusters(t: Tile, colors: RGBA[], count: number): void {
  for (let c = 0; c < count; c++) {
    const cx = Math.floor(t.rand() * 13) + 1;
    const cy = Math.floor(t.rand() * 13) + 1;
    const size = 2 + Math.floor(t.rand() * 3);
    for (let k = 0; k < size + 2; k++) {
      const x = cx + Math.floor(t.rand() * 3) - 1;
      const y = cy + Math.floor(t.rand() * 3) - 1;
      t.set(x, y, t.pick(colors));
      if (t.rand() < 0.4) t.set(x + 1, y, shade(colors[0], 0.8));
    }
  }
}

function sideWithCap(t: Tile, capPalette: RGBA[], edge: RGBA): void {
  noisy(t, DIRT, 4, 0.5);
  for (let x = 0; x < TILE; x++) {
    let depth = 3 + (t.rand() < 0.55 ? 1 : 0) + (t.rand() < 0.2 ? 1 : 0);
    if (x % 5 === 2 && t.rand() < 0.6) depth += 1;
    for (let y = 0; y < depth; y++) t.set(x, y, y === depth - 1 ? edge : t.pick(capPalette));
  }
}

const painters: Record<TileName, (t: Tile) => void> = {
  grass_top(t) {
    noisy(t, GRASS, 4, 0.45);
    for (let k = 0; k < 10; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), hex('#72b44f'));
  },
  grass_side(t) {
    sideWithCap(t, GRASS, hex('#3b6e28'));
  },
  dirt(t) {
    noisy(t, DIRT, 4, 0.55);
    for (let k = 0; k < 6; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), hex('#9a8067'));
  },
  stone(t) {
    noisy(t, STONE, 4, 0.4);
    // A few hairline cracks.
    for (let c = 0; c < 3; c++) {
      let x = Math.floor(t.rand() * 16);
      let y = Math.floor(t.rand() * 16);
      for (let k = 0; k < 4; k++) {
        t.set(x, y, hex('#5d5f62'));
        x += t.rand() < 0.5 ? 1 : 0;
        y += 1;
      }
    }
  },
  cobblestone(t) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) pts.push([t.rand() * 16, t.rand() * 16, 0.82 + t.rand() * 0.3]);
    t.fill((x, y) => {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let oy = -16; oy <= 16; oy += 16) {
          for (let ox = -16; ox <= 16; ox += 16) {
            const dx = x + 0.5 - pts[i][0] - ox;
            const dy = y + 0.5 - pts[i][1] - oy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = i;
            } else if (d < d2) d2 = d;
          }
        }
      }
      if (d2 - d1 < 1.1) return hex('#4a4b4d');
      const base = shade(hex('#7c7e81'), pts[best][2]);
      const hi = d1 < 2.2 ? 1.1 : d1 > 4.5 ? 0.88 : 1;
      return shade(base, hi * (0.94 + t.rand() * 0.12));
    });
  },
  sand(t) {
    noisy(t, SAND, 8, 0.6);
    for (let k = 0; k < 8; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), hex('#bfae78'));
  },
  gravel(t) {
    const cols = ['#8a847d', '#99938b', '#a8a198', '#7a746e', '#b3ada3', '#8f8272'].map((h) => hex(h));
    t.fill(() => shade(hex('#7b766f'), 0.92 + t.rand() * 0.12));
    for (let k = 0; k < 26; k++) {
      const x = Math.floor(t.rand() * 16);
      const y = Math.floor(t.rand() * 16);
      const c = t.pick(cols);
      t.set(x, y, c);
      t.set(x + 1, y, shade(c, 0.9));
      t.set(x, y + 1, shade(c, 0.8));
      if (t.rand() < 0.5) t.set(x + 1, y + 1, shade(c, 0.7));
    }
  },
  oak_log_side(t) {
    const base = ['#5b4127', '#664a2d', '#705234', '#7b5b3a'].map((h) => hex(h));
    const colShade = Array.from({ length: 16 }, () => 0.85 + t.rand() * 0.3);
    t.fill((x, y) => {
      const groove = x % 4 === 0 || (x % 7 === 3 && (y + x) % 5 < 3);
      const c = base[Math.floor(((x * 7 + Math.floor(y / 3) * 3) % 11) / 3) % base.length];
      return shade(c, colShade[x] * (groove ? 0.72 : 1) * (0.95 + t.rand() * 0.1));
    });
  },
  oak_log_top(t) {
    t.fill((x, y) => {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 6.9) return shade(hex('#664a2d'), 0.9 + t.rand() * 0.15);
      const ring = Math.floor(d * 1.15) % 2 === 0;
      return shade(ring ? hex('#b48f5a') : hex('#a07c4b'), 0.95 + t.rand() * 0.08);
    });
  },
  oak_leaves(t) {
    const cols = ['#3a7a2c', '#428632', '#4a9138', '#549b3f', '#346f28'].map((h) => hex(h));
    noisy(t, cols, 4, 0.6);
    for (let k = 0; k < 14; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [0, 0, 0, 0]);
    for (let k = 0; k < 10; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), hex('#5aa545'));
  },
  oak_planks(t) {
    const tones = [hex('#a57f4b'), hex('#b08954'), hex('#9b7644'), hex('#aa8550')];
    t.fill((x, y) => {
      const row = Math.floor(y / 4);
      const joint = (row * 7 + 5) % 16;
      if (y % 4 === 3) return hex('#6b5030');
      if (x === joint) return hex('#7a5c37');
      const grain = (x * 3 + row * 5 + (y % 4)) % 9 === 0 ? 0.88 : 1;
      return shade(tones[row], grain * (0.95 + t.rand() * 0.1));
    });
  },
  glass(t) {
    t.fill(() => [0, 0, 0, 0]);
    const edge = hex('#d8ecf2');
    const edgeDark = hex('#a9c9d4');
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, edge);
      t.set(0, i, edge);
      t.set(i, 15, edgeDark);
      t.set(15, i, edgeDark);
    }
    for (const [x, y] of [
      [3, 4], [4, 3], [5, 2], [4, 5], [5, 4], [6, 3], [10, 11], [11, 10], [12, 9],
    ]) {
      t.set(x, y, hex('#f4fbfd'));
    }
  },
  bricks(t) {
    const tones = [hex('#95452f'), hex('#a24f38'), hex('#8b3f2b'), hex('#ab5941')];
    const mortar = hex('#bdb3a3');
    t.fill((x, y) => {
      const row = Math.floor(y / 4);
      if (y % 4 === 3) return shade(mortar, 0.95 + t.rand() * 0.08);
      const off = row % 2 ? 4 : 0;
      if ((x + off) % 8 === 7) return shade(mortar, 0.9 + t.rand() * 0.08);
      const brick = Math.floor((x + off) / 8) + row * 3;
      const c = tones[brick % tones.length];
      return shade(c, (y % 4 === 0 ? 1.08 : 1) * (0.92 + t.rand() * 0.14));
    });
  },
  snow(t) {
    noisy(t, SNOW, 4, 0.5);
  },
  snow_side(t) {
    sideWithCap(t, SNOW, hex('#cfdbe4'));
  },
  coal_ore(t) {
    painters.stone(t);
    drawOreClusters(t, ['#1f1f21', '#2c2c2f', '#38383b'].map((h) => hex(h)), 4);
  },
  iron_ore(t) {
    painters.stone(t);
    drawOreClusters(t, ['#c99873', '#d8ad88', '#e7c3a1', '#b9825d'].map((h) => hex(h)), 4);
  },
  birch_log_side(t) {
    const cols = ['#e7e2d4', '#dcd6c7', '#f0ece2'].map((h) => hex(h));
    noisy(t, cols, 4, 0.6);
    for (let k = 0; k < 7; k++) {
      const y = Math.floor(t.rand() * 16);
      const x = Math.floor(t.rand() * 13);
      const len = 2 + Math.floor(t.rand() * 3);
      for (let i = 0; i < len; i++) t.set(x + i, y, hex('#2f2c28'));
    }
  },
  birch_log_top(t) {
    t.fill((x, y) => {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 6.9) return shade(hex('#e4dfd1'), 0.92 + t.rand() * 0.1);
      const ring = Math.floor(d * 1.15) % 2 === 0;
      return shade(ring ? hex('#d6c496') : hex('#c7b384'), 0.95 + t.rand() * 0.08);
    });
  },
  birch_leaves(t) {
    const cols = ['#6b9a3e', '#78a847', '#85b451', '#92c05c', '#628f37'].map((h) => hex(h));
    noisy(t, cols, 4, 0.6);
    for (let k = 0; k < 14; k++) t.set(Math.floor(t.rand() * 16), Math.floor(t.rand() * 16), [0, 0, 0, 0]);
  },
  sandstone_side(t) {
    const bands = [hex('#d8c48b'), hex('#d0bb80'), hex('#e0cf99'), hex('#cbb579')];
    t.fill((x, y) => {
      if (y <= 1) return shade(hex('#e3d4a2'), 0.97 + t.rand() * 0.06);
      if (y >= 14) return shade(hex('#bfa96f'), 0.95 + t.rand() * 0.08);
      const band = bands[Math.floor((y + (x % 7 === 0 ? 1 : 0)) / 3) % bands.length];
      return shade(band, 0.96 + t.rand() * 0.08);
    });
  },
  sandstone_top(t) {
    noisy(t, ['#d5c28a', '#dccb95', '#e2d3a0'].map((h) => hex(h)), 4, 0.4);
  },
  tall_grass(t) {
    t.fill(() => [0, 0, 0, 0]);
    const cols = ['#4f8f35', '#5c9d3d', '#6aad47', '#447f2e'].map((h) => hex(h));
    for (let b = 0; b < 7; b++) {
      let x = 2 + Math.floor(t.rand() * 12);
      const h = 5 + Math.floor(t.rand() * 7);
      const lean = t.rand() < 0.5 ? -1 : 1;
      const c = t.pick(cols);
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        if (i > h * 0.55 && t.rand() < 0.35) x += lean;
        t.set(x, y, i > h - 3 ? shade(c, 1.15) : c);
      }
    }
  },
  red_flower(t) {
    t.fill(() => [0, 0, 0, 0]);
    const stem = hex('#3f7f2c');
    for (let y = 7; y < 16; y++) t.set(7 + (y > 12 ? 1 : 0), y, stem);
    t.set(6, 11, hex('#4f9436'));
    t.set(5, 10, hex('#4f9436'));
    t.set(9, 12, hex('#4f9436'));
    t.set(10, 11, hex('#4f9436'));
    const petal = hex('#d23a2e');
    const petalDark = hex('#a82a22');
    for (const [x, y] of [
      [6, 4], [7, 3], [8, 4], [9, 5], [8, 6], [7, 7], [6, 6], [5, 5], [7, 4], [8, 5], [6, 5], [7, 6],
    ]) {
      t.set(x, y, (x + y) % 3 === 0 ? petalDark : petal);
    }
    t.set(7, 5, hex('#2b1a12'));
  },
  yellow_flower(t) {
    t.fill(() => [0, 0, 0, 0]);
    const stem = hex('#467f2e');
    for (let y = 8; y < 16; y++) t.set(8, y, stem);
    t.set(7, 12, hex('#58983b'));
    t.set(9, 11, hex('#58983b'));
    const petal = hex('#f1cf3b');
    const petalDark = hex('#d9ad22');
    for (const [x, y] of [
      [7, 5], [8, 4], [9, 5], [8, 6], [6, 6], [10, 6], [7, 7], [9, 7], [8, 8],
    ]) {
      t.set(x, y, (x * y) % 4 === 0 ? petalDark : petal);
    }
    t.set(8, 6, hex('#e27d1c'));
  },
  water(t) {
    noisy(t, ['#2a62a0', '#2f6cad', '#3677ba', '#3f84c6'].map((h) => hex(h)), 4, 0.4);
  },
  bedrock(t) {
    noisy(t, ['#1f1f21', '#333336', '#48484b', '#5e5e61', '#2a2a2c'].map((h) => hex(h)), 8, 0.8);
  },
  glow_lamp(t) {
    const frame = hex('#7a5a2a');
    t.fill((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return shade(frame, 0.9 + t.rand() * 0.15);
      if (x === 1 || y === 1 || x === 14 || y === 14) return hex('#c8932e');
      const cx = Math.abs(x - 7.5);
      const cy = Math.abs(y - 7.5);
      const facet = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      const d = Math.max(cx, cy);
      const base = facet ? hex('#ffd66b') : hex('#ffe49a');
      return shade(base, 1.08 - d * 0.03 + t.rand() * 0.05);
    });
  },
  crafting_table_top(t) {
    painters.oak_planks(t);
    const dark = hex('#5e4527');
    for (let i = 1; i < 15; i++) {
      t.set(i, 1, dark);
      t.set(i, 14, dark);
      t.set(1, i, dark);
      t.set(14, i, dark);
      t.set(i, 7, shade(dark, 1.1));
      t.set(7, i, shade(dark, 1.1));
    }
  },
  crafting_table_side(t) {
    painters.oak_planks(t);
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, hex('#8a6a3e'));
      t.set(x, 1, hex('#6b5030'));
    }
    // A saw and a hammer hanging on the side.
    for (let x = 3; x < 8; x++) t.set(x, 5, hex('#c9ccd0'));
    for (let x = 3; x < 8; x++) if (x % 2) t.set(x, 6, hex('#9a9da1'));
    t.set(8, 5, hex('#4a3420'));
    t.set(9, 5, hex('#4a3420'));
    for (let y = 4; y < 11; y++) t.set(12, y, hex('#4a3420'));
    t.set(11, 4, hex('#8d9094'));
    t.set(13, 4, hex('#8d9094'));
    t.set(12, 3, hex('#8d9094'));
  },
  furnace_side(t) {
    noisy(t, ['#6f7174', '#78797c', '#818285', '#696a6d'].map((h) => hex(h)), 4, 0.5);
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, hex('#5a5b5e'));
      t.set(x, 15, hex('#4d4e51'));
    }
  },
  furnace_top(t) {
    noisy(t, ['#747578', '#7d7e81', '#86878a'].map((h) => hex(h)), 4, 0.4);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, hex('#5a5b5e'));
      t.set(0, i, hex('#5a5b5e'));
      t.set(i, 15, hex('#4d4e51'));
      t.set(15, i, hex('#4d4e51'));
    }
  },
  furnace_front(t) {
    painters.furnace_side(t);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) t.set(x, y, hex('#1c1c1e'));
    for (let x = 5; x < 11; x++) t.set(x, 12, x % 2 ? hex('#ff9a2e') : hex('#ffcf5a'));
    for (let x = 5; x < 11; x++) if (t.rand() < 0.6) t.set(x, 11, hex('#e0661c'));
    for (let x = 3; x < 13; x++) t.set(x, 7, hex('#55565a'));
    for (let x = 4; x < 12; x += 2) t.set(x, 3, hex('#3a3b3e'));
  },
  clay(t) {
    noisy(t, ['#979dab', '#a0a6b3', '#a9afbb'].map((h) => hex(h)), 4, 0.35);
  },
};

export interface BlockTextures {
  array: THREE.DataArrayTexture;
  /** Raw RGBA pixels per tile, top row first. */
  tiles: Uint8ClampedArray[];
  /** Data-URL icons per block id, for the hotbar and inventory. */
  icons: Map<number, string>;
  crack: THREE.DataTexture[];
}

function tileCanvas(px: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeIcon(id: number, canvases: HTMLCanvasElement[]): string {
  const def = blockDef(id);
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (def.render === 'plant') {
    ctx.drawImage(canvases[def.faces[0]], 4, 4, S - 8, S - 8);
    return c.toDataURL();
  }
  const W = S - 6;
  const ox = 3;
  const oy = 2;
  const h1 = W / 4;
  const side = W / 2 + 2;
  const face = (tileIdx: number, a: number, b: number, cc: number, d: number, e: number, f: number, dark: number) => {
    ctx.setTransform(a / TILE, b / TILE, cc / TILE, d / TILE, e, f);
    ctx.drawImage(canvases[tileIdx], 0, 0);
    if (dark > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.globalCompositeOperation = 'source-over';
    }
  };
  // Top: from the left corner, u towards the top corner, v towards the bottom corner.
  face(def.faces[2], W / 2, -h1, W / 2, h1, ox, oy + h1, 0);
  // Left (+Z face) and right (+X face).
  face(def.faces[4], W / 2, h1, 0, side, ox, oy + h1, 0.22);
  face(def.faces[0], W / 2, -h1, 0, side, ox + W / 2, oy + 2 * h1, 0.38);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL();
}

function makeCrackStages(): THREE.DataTexture[] {
  const rand = mulberry32(0xc7ac);
  const order: [number, number][] = [];
  const seen = new Set<number>();
  // Random walks from the centre; earlier pixels appear at earlier mining stages.
  for (let w = 0; w < 7; w++) {
    let x = 7 + Math.floor(rand() * 2);
    let y = 7 + Math.floor(rand() * 2);
    const ang = (w / 7) * Math.PI * 2 + rand() * 0.6;
    for (let k = 0; k < 11; k++) {
      const key = y * 16 + x;
      if (!seen.has(key)) {
        seen.add(key);
        order.push([x, y]);
      }
      x = Math.max(0, Math.min(15, Math.round(x + Math.cos(ang) + (rand() - 0.5))));
      y = Math.max(0, Math.min(15, Math.round(y + Math.sin(ang) + (rand() - 0.5))));
    }
  }
  const stages: THREE.DataTexture[] = [];
  const STAGES = 8;
  for (let s = 0; s < STAGES; s++) {
    const data = new Uint8Array(16 * 16 * 4);
    const n = Math.ceil(((s + 1) / STAGES) * order.length);
    const crackAt = new Set(order.slice(0, n).map(([x, y]) => y * 16 + x));
    for (let i = 0; i < n; i++) {
      const [x, y] = order[i];
      const o = ((15 - y) * 16 + x) * 4;
      data[o] = 16;
      data[o + 1] = 13;
      data[o + 2] = 12;
      data[o + 3] = 225;
      // A light chipped edge below-right of each crack pixel keeps it readable on dark blocks.
      const hx = x + 1;
      const hy = y + 1;
      if (hx < 16 && hy < 16 && !crackAt.has(hy * 16 + hx)) {
        const h = ((15 - hy) * 16 + hx) * 4;
        data[h] = 235;
        data[h + 1] = 235;
        data[h + 2] = 225;
        data[h + 3] = 80;
      }
    }
    const tex = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    stages.push(tex);
  }
  return stages;
}

export function createBlockTextures(maxAnisotropy: number): BlockTextures {
  const tiles: Uint8ClampedArray[] = [];
  const data = new Uint8Array(TILE * TILE * 4 * TILE_NAMES.length);
  TILE_NAMES.forEach((name, layer) => {
    const t = new Tile(mulberry32(0x9e3779b1 ^ (layer * 7919 + 17)));
    painters[name](t);
    tiles.push(t.px);
    // Texture rows go bottom-up (v = 0 at the bottom of the tile).
    for (let y = 0; y < TILE; y++) {
      const src = y * TILE * 4;
      const dst = layer * TILE * TILE * 4 + (TILE - 1 - y) * TILE * 4;
      data.set(t.px.subarray(src, src + TILE * 4), dst);
    }
  });

  const array = new THREE.DataArrayTexture(data, TILE, TILE, TILE_NAMES.length);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.colorSpace = THREE.SRGBColorSpace;
  array.magFilter = THREE.NearestFilter;
  array.minFilter = THREE.NearestMipmapLinearFilter;
  array.generateMipmaps = true;
  array.anisotropy = Math.min(8, maxAnisotropy);
  array.needsUpdate = true;

  const canvases = tiles.map(tileCanvas);
  const icons = new Map<number, string>();
  for (const b of BLOCKS) if (b.id !== 0) icons.set(b.id, makeIcon(b.id, canvases));

  return { array, tiles, icons, crack: makeCrackStages() };
}

/** A random opaque pixel colour from a block's side texture (for break particles). */
export function sampleTileColor(tiles: Uint8ClampedArray[], layer: number, rand: () => number): RGBA {
  const px = tiles[layer];
  for (let tries = 0; tries < 12; tries++) {
    const i = Math.floor(rand() * TILE * TILE) * 4;
    if (px[i + 3] > 128) return [px[i], px[i + 1], px[i + 2], 255];
  }
  return [128, 128, 128, 255];
}

export { mix as mixColor };
