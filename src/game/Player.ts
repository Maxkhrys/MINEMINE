import { B } from '../world/blocks';
import type { World } from '../world/World';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const JUMP_VELOCITY = 8.7;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.8;
const FLY_SPEED = 10;
const FLY_SPRINT_SPEED = 18;
const SWIM_SPEED = 2.6;
const EPS = 1e-4;

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  down: boolean;
  sprint: boolean;
}

/** First-person player: an axis-aligned box swept through the voxel grid one axis at a time. */
export class Player {
  /** Feet position (centre of the bottom face of the collision box). */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  flying = false;
  inWater = false;
  headInWater = false;
  /** Distance walked on the ground, drives view bobbing and footsteps. */
  walked = 0;
  horizontalSpeed = 0;
  landedImpact = 0;

  constructor(private world: World) {}

  get eyeY(): number {
    return this.y + EYE_HEIGHT;
  }

  /** Axis-aligned bounds of the player: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): [number, number, number, number, number, number] {
    const h = PLAYER_WIDTH / 2;
    return [this.x - h, this.y, this.z - h, this.x + h, this.y + PLAYER_HEIGHT, this.z + h];
  }

  /** Whether the player's box overlaps the unit block at (bx, by, bz). */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    const b = this.bounds();
    const m = 1e-3;
    return b[0] < bx + 1 - m && b[3] > bx + m && b[1] < by + 1 - m && b[4] > by + m && b[2] < bz + 1 - m && b[5] > bz + m;
  }

  private overlapsSolid(): boolean {
    const b = this.bounds();
    for (let y = Math.floor(b[1] + EPS); y <= Math.floor(b[4] - EPS); y++) {
      for (let z = Math.floor(b[2] + EPS); z <= Math.floor(b[5] - EPS); z++) {
        for (let x = Math.floor(b[0] + EPS); x <= Math.floor(b[3] - EPS); x++) {
          if (this.world.isSolidForCollision(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /** Pushes the player up out of any block they ended up inside (e.g. after loading). */
  resolveStuck(): void {
    for (let i = 0; i < 128 && this.overlapsSolid(); i++) this.y = Math.floor(this.y) + 1;
  }

  /** Moves along one axis, stopping at the first solid voxel face. Returns the distance moved. */
  private moveAxis(axis: 0 | 1 | 2, d: number): number {
    if (d === 0) return 0;
    const b = this.bounds();
    const min = [b[0], b[1], b[2]];
    const max = [b[3], b[4], b[5]];
    const a1 = axis === 0 ? 1 : 0;
    const a2 = axis === 2 ? 1 : 2;
    const lo1 = Math.floor(min[a1] + EPS);
    const hi1 = Math.floor(max[a1] - EPS);
    const lo2 = Math.floor(min[a2] + EPS);
    const hi2 = Math.floor(max[a2] - EPS);
    const c = [0, 0, 0];
    const solidSlice = (k: number): boolean => {
      c[axis] = k;
      for (let i = lo1; i <= hi1; i++) {
        c[a1] = i;
        for (let j = lo2; j <= hi2; j++) {
          c[a2] = j;
          if (this.world.isSolidForCollision(c[0], c[1], c[2])) return true;
        }
      }
      return false;
    };
    if (d > 0) {
      const start = Math.ceil(max[axis] - EPS);
      const end = Math.ceil(max[axis] + d) - 1;
      for (let k = start; k <= end; k++) {
        if (solidSlice(k)) return Math.max(0, k - max[axis] - 1e-7);
      }
    } else {
      const start = Math.floor(min[axis] + EPS) - 1;
      const end = Math.floor(min[axis] + d);
      for (let k = start; k >= end; k--) {
        if (solidSlice(k)) return Math.min(0, k + 1 - min[axis] + 1e-7);
      }
    }
    return d;
  }

  private checkWater(): void {
    const h = PLAYER_WIDTH / 2 - 0.05;
    const w = this.world;
    const fx = Math.floor(this.x - h);
    const tx = Math.floor(this.x + h);
    const fz = Math.floor(this.z - h);
    const tz = Math.floor(this.z + h);
    let body = false;
    for (let z = fz; z <= tz && !body; z++) {
      for (let x = fx; x <= tx && !body; x++) {
        for (let y = Math.floor(this.y + 0.1); y <= Math.floor(this.y + 1.2); y++) {
          if (w.getBlock(x, y, z) === B.WATER) body = true;
        }
      }
    }
    this.inWater = body;
    this.headInWater = w.getBlock(Math.floor(this.x), Math.floor(this.eyeY + 0.08), Math.floor(this.z)) === B.WATER;
  }

  update(dt: number, input: MoveInput, canFly: boolean): void {
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / 120);
      this.step(step, input, canFly);
      remaining -= step;
    }
  }

  private step(dt: number, input: MoveInput, canFly: boolean): void {
    if (!canFly) this.flying = false;
    this.checkWater();

    // Desired horizontal velocity from yaw.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let fx = -sin * input.forward + cos * input.strafe;
    let fz = -cos * input.forward - sin * input.strafe;
    const len = Math.hypot(fx, fz);
    if (len > 1) {
      fx /= len;
      fz /= len;
    }
    let speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    if (this.flying) speed = input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED * (input.sprint ? 1.3 : 1);
    const tx = fx * speed;
    const tz = fz * speed;
    const accel = this.flying ? 10 : this.onGround ? 16 : this.inWater ? 6 : 4;
    const k = Math.min(1, accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    if (this.flying) {
      const ty = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vy += (ty * speed * 0.8 - this.vy) * Math.min(1, 10 * dt);
    } else if (this.inWater) {
      this.vy -= 9 * dt;
      this.vy *= Math.max(0, 1 - 2.2 * dt);
      if (input.jump) this.vy = Math.min(this.vy + 30 * dt, 3.4);
      if (this.vy < -4) this.vy = -4;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -60) this.vy = -60;
      if (input.jump && this.onGround) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
    }

    // Sweep one axis at a time: vertical first, then horizontal.
    const wantY = this.vy * dt;
    const dy = this.moveAxis(1, wantY);
    this.y += dy;
    const wasGround = this.onGround;
    if (dy !== wantY) {
      if (wantY < 0) {
        if (!wasGround) this.landedImpact = -this.vy;
        this.onGround = true;
        if (this.flying) this.flying = false;
      }
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    // Jumping out of water onto a ledge: small boost when pushing against a wall.
    const wantX = this.vx * dt;
    const dx = this.moveAxis(0, wantX);
    this.x += dx;
    if (dx !== wantX) this.vx = 0;
    const wantZ = this.vz * dt;
    const dz = this.moveAxis(2, wantZ);
    this.z += dz;
    if (dz !== wantZ) this.vz = 0;
    if (this.inWater && input.jump && (dx !== wantX || dz !== wantZ)) this.vy = Math.max(this.vy, 4.2);

    this.horizontalSpeed = Math.hypot(this.vx, this.vz);
    if (this.onGround) this.walked += Math.hypot(dx, dz);
    if (this.y < -64) {
      this.y = 140;
      this.vy = 0;
    }
  }
}
