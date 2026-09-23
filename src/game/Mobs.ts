import * as THREE from 'three';
import { B, IS_SOLID } from '../world/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../world/constants';
import { mulberry32 } from '../world/noise';
import type { World } from '../world/World';
import { I } from './items';
import { Player } from './Player';

export type MobKind = 'pig' | 'cow' | 'chicken';

interface MobSpec {
  width: number;
  height: number;
  health: number;
  speed: number;
  drops: [number, number, number][]; // item, min, max
  build(): THREE.Group;
}

type BoxDef = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

function model(boxes: BoxDef[], legs: BoxDef[]): THREE.Group {
  const g = new THREE.Group();
  const add = (b: BoxDef, isLeg: boolean) => {
    const geo = new THREE.BoxGeometry(b[0], b[1], b[2]);
    // Legs pivot at the top so they can swing.
    if (isLeg) geo.translate(0, -b[1] / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: b[6] }));
    m.position.set(b[3], b[4] + (isLeg ? b[1] / 2 : 0), b[5]);
    m.castShadow = true;
    m.receiveShadow = true;
    if (isLeg) m.userData.leg = true;
    g.add(m);
  };
  for (const b of boxes) add(b, false);
  for (const l of legs) add(l, true);
  return g;
}

const SPECS: Record<MobKind, MobSpec> = {
  pig: {
    width: 0.8,
    height: 0.85,
    health: 10,
    speed: 1.6,
    drops: [[I.RAW_PORK, 1, 3]],
    build: () =>
      model(
        [
          [0.62, 0.5, 0.95, 0, 0.55, 0, 0xeba0a3],
          [0.5, 0.46, 0.44, 0, 0.72, -0.62, 0xefa9ab],
          [0.26, 0.18, 0.08, 0, 0.66, -0.86, 0xd7858a],
          [0.07, 0.07, 0.02, -0.14, 0.82, -0.85, 0x2a1a1a],
          [0.07, 0.07, 0.02, 0.14, 0.82, -0.85, 0x2a1a1a],
        ],
        [
          [0.2, 0.3, 0.2, -0.19, 0.3, -0.3, 0xdc8f93],
          [0.2, 0.3, 0.2, 0.19, 0.3, -0.3, 0xdc8f93],
          [0.2, 0.3, 0.2, -0.19, 0.3, 0.32, 0xdc8f93],
          [0.2, 0.3, 0.2, 0.19, 0.3, 0.32, 0xdc8f93],
        ],
      ),
  },
  cow: {
    width: 0.9,
    height: 1.35,
    health: 10,
    speed: 1.4,
    drops: [[I.RAW_BEEF, 1, 3]],
    build: () =>
      model(
        [
          [0.78, 0.66, 1.15, 0, 0.98, 0, 0x5a3b28],
          [0.4, 0.42, 0.5, 0.2, 1.02, 0.1, 0xf1ece4],
          [0.5, 0.48, 0.42, 0, 1.16, -0.74, 0x4b3120],
          [0.36, 0.2, 0.08, 0, 1.02, -0.97, 0xe8c9b8],
          [0.08, 0.14, 0.08, -0.22, 1.44, -0.74, 0xe3dccf],
          [0.08, 0.14, 0.08, 0.22, 1.44, -0.74, 0xe3dccf],
          [0.08, 0.08, 0.02, -0.14, 1.24, -0.96, 0x151010],
          [0.08, 0.08, 0.02, 0.14, 1.24, -0.96, 0x151010],
        ],
        [
          [0.24, 0.66, 0.24, -0.24, 0.66, -0.36, 0x4b3120],
          [0.24, 0.66, 0.24, 0.24, 0.66, -0.36, 0xf1ece4],
          [0.24, 0.66, 0.24, -0.24, 0.66, 0.4, 0xf1ece4],
          [0.24, 0.66, 0.24, 0.24, 0.66, 0.4, 0x4b3120],
        ],
      ),
  },
  chicken: {
    width: 0.45,
    height: 0.7,
    health: 4,
    speed: 1.3,
    drops: [[I.RAW_CHICKEN, 1, 1]],
    build: () =>
      model(
        [
          [0.36, 0.34, 0.46, 0, 0.42, 0, 0xf6f4ef],
          [0.26, 0.3, 0.2, 0, 0.66, -0.24, 0xfbfaf6],
          [0.14, 0.08, 0.12, 0, 0.64, -0.39, 0xf0a32a],
          [0.08, 0.1, 0.06, 0, 0.55, -0.35, 0xd8322c],
          [0.05, 0.05, 0.02, -0.08, 0.72, -0.345, 0x151010],
          [0.05, 0.05, 0.02, 0.08, 0.72, -0.345, 0x151010],
          [0.06, 0.24, 0.3, -0.21, 0.44, 0.02, 0xe9e6de],
          [0.06, 0.24, 0.3, 0.21, 0.44, 0.02, 0xe9e6de],
        ],
        [
          [0.06, 0.26, 0.06, -0.08, 0.26, 0, 0xe0a43a],
          [0.06, 0.26, 0.06, 0.08, 0.26, 0, 0xe0a43a],
        ],
      ),
  },
};

export class Mob extends Player {
  readonly spec: MobSpec;
  readonly mesh: THREE.Group;
  health: number;
  private wanderTimer = 0;
  private moving = false;
  private turnTo = 0;
  panic = 0;
  hurtFlash = 0;
  dead = false;
  deathTimer = 0;
  private legPhase = 0;
  private soundTimer = 3 + Math.random() * 8;
  private rand: () => number;

  constructor(
    world: World,
    readonly kind: MobKind,
    seed: number,
  ) {
    super(world);
    this.spec = SPECS[kind];
    this.width = this.spec.width;
    this.height = this.spec.height;
    this.eyeHeight = this.spec.height * 0.8;
    this.walkSpeed = this.spec.speed;
    this.sprintSpeed = this.spec.speed * 2.4;
    this.health = this.spec.health;
    this.mesh = this.spec.build();
    this.rand = mulberry32(seed);
    this.yaw = this.rand() * Math.PI * 2;
    this.turnTo = this.yaw;
  }

  /** Returns true when the mob wants to make a sound this frame. */
  think(dt: number, playerX: number, playerZ: number): boolean {
    this.wanderTimer -= dt;
    this.panic = Math.max(0, this.panic - dt);
    if (this.panic > 0) {
      // Run away from the player, zig-zagging a little.
      this.turnTo = Math.atan2(this.x - playerX, this.z - playerZ) + Math.sin(this.panic * 5) * 0.5;
      this.moving = true;
    } else if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + this.rand() * 5;
      this.moving = this.rand() < 0.55;
      this.turnTo = this.yaw + (this.rand() - 0.5) * Math.PI * 1.4;
    }
    // Smoothly turn towards the goal heading (Player yaw convention: forward = -Z at 0).
    let d = this.turnTo - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 4);
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) {
      this.soundTimer = 6 + this.rand() * 12;
      return true;
    }
    return false;
  }

  tick(dt: number): void {
    const ahead = this.moving && !this.dead;
    const wantJump = ahead && (this.blocked || this.inWater);
    this.update(dt, { forward: ahead ? 1 : 0, strafe: 0, jump: wantJump, down: false, sprint: this.panic > 0 }, false);
    // Don't walk off cliffs taller than two blocks when calm.
    if (ahead && this.panic <= 0 && this.onGround) {
      const fx = Math.floor(this.x - Math.sin(this.yaw) * 0.8);
      const fz = Math.floor(this.z - Math.cos(this.yaw) * 0.8);
      const fy = Math.floor(this.y);
      if (!IS_SOLID[this.world.getBlock(fx, fy - 1, fz)] && !IS_SOLID[this.world.getBlock(fx, fy - 2, fz)] && !IS_SOLID[this.world.getBlock(fx, fy - 3, fz)]) {
        this.turnTo = this.yaw + Math.PI;
      }
    }
  }

  updateMesh(dt: number): void {
    const m = this.mesh;
    m.position.set(this.x, this.y, this.z);
    // Model faces -Z; Player yaw rotates the forward vector the same way.
    m.rotation.set(0, this.yaw, this.dead ? Math.min(Math.PI / 2, this.deathTimer * 6) : 0);
    this.legPhase += dt * this.horizontalSpeed * 7;
    const swing = Math.sin(this.legPhase) * Math.min(0.7, this.horizontalSpeed * 0.5);
    let k = 0;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    for (const c of m.children) {
      const mesh = c as THREE.Mesh;
      if (mesh.userData.leg) mesh.rotation.x = (k++ % 2 === 0 ? 1 : -1) * swing * (k > 2 ? -1 : 1);
      const mat = mesh.material as THREE.MeshLambertMaterial;
      mat.emissive.setRGB(this.hurtFlash > 0 ? 0.6 : 0, 0, 0);
    }
  }

  /** Ray / box distance, or -1 on a miss. */
  hitDistance(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const b = this.bounds();
    let tmin = 0;
    let tmax = Infinity;
    const o = [ox, oy, oz];
    const d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < b[a] || o[a] > b[a + 3]) return -1;
        continue;
      }
      let t1 = (b[a] - o[a]) / d[a];
      let t2 = (b[a + 3] - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  rollDrops(): [number, number][] {
    return this.spec.drops.map(([id, lo, hi]) => [id, lo + Math.floor(this.rand() * (hi - lo + 1))]);
  }
}

const MAX_MOBS = 14;

/** Spawns, simulates and despawns passive animals around the player. */
export class MobManager {
  readonly group = new THREE.Group();
  mobs: Mob[] = [];
  private spawnTimer = 1;
  private seed = 1;

  constructor(private world: World) {
    this.group.name = 'mobs';
  }

  clear(): void {
    for (const m of this.mobs) this.group.remove(m.mesh);
    this.mobs = [];
    this.spawnTimer = 1;
  }

  /** Returns mobs that made a sound this frame (for audio). */
  update(dt: number, px: number, pz: number): Mob[] {
    const noisy: Mob[] = [];
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      if (this.mobs.length < MAX_MOBS) this.trySpawn(px, pz);
    }
    for (const m of this.mobs) {
      // Only simulate when the ground under it is loaded.
      if (!this.world.isLoadedAt(Math.floor(m.x), Math.floor(m.z))) continue;
      if (m.dead) {
        m.deathTimer += dt;
      } else {
        if (m.think(dt, px, pz)) noisy.push(m);
        m.tick(dt);
      }
      m.updateMesh(dt);
    }
    const keep: Mob[] = [];
    for (const m of this.mobs) {
      const far = Math.hypot(m.x - px, m.z - pz) > 96;
      if ((m.dead && m.deathTimer > 0.7) || far || m.y < -10) this.group.remove(m.mesh);
      else keep.push(m);
    }
    this.mobs = keep;
    return noisy;
  }

  private trySpawn(px: number, pz: number): void {
    const r = mulberry32(this.seed++ * 7919 + Math.floor(px) * 31 + Math.floor(pz));
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = r() * Math.PI * 2;
      const dist = 18 + r() * 30;
      const x = Math.floor(px + Math.cos(ang) * dist);
      const z = Math.floor(pz + Math.sin(ang) * dist);
      const col = this.world.getColumn(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      if (!col || !col.meshedOnce) continue;
      const h = col.heightmap[((z & 15) << 4) | (x & 15)];
      if (h <= 0 || h >= WORLD_HEIGHT - 3) continue;
      const ground = this.world.getBlock(x, h, z);
      if (ground !== B.GRASS && ground !== B.SNOWY_GRASS) continue;
      if (IS_SOLID[this.world.getBlock(x, h + 1, z)] || IS_SOLID[this.world.getBlock(x, h + 2, z)]) continue;
      const roll = r();
      const kind: MobKind = roll < 0.4 ? 'pig' : roll < 0.7 ? 'cow' : 'chicken';
      // Animals come in small groups.
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n && this.mobs.length < MAX_MOBS; i++) {
        const m = new Mob(this.world, kind, Math.floor(r() * 1e9));
        m.x = x + 0.5 + (r() - 0.5) * 2;
        m.z = z + 0.5 + (r() - 0.5) * 2;
        m.y = h + 1;
        m.resolveStuck();
        m.peakY = m.y;
        this.mobs.push(m);
        this.group.add(m.mesh);
        m.updateMesh(0);
      }
      return;
    }
  }

  /** Closest living mob hit by the ray within maxDist. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { mob: Mob; t: number } | null {
    let best: { mob: Mob; t: number } | null = null;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const t = m.hitDistance(ox, oy, oz, dx, dy, dz);
      if (t >= 0 && t <= maxDist && (!best || t < best.t)) best = { mob: m, t };
    }
    return best;
  }
}
