import { isWater, isLadder, blockDef } from '../world/blocks';
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
  sneak?: boolean;
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
  /** Collision box size; mobs reuse this class with their own dimensions. */
  width = PLAYER_WIDTH;
  height = PLAYER_HEIGHT;
  eyeHeight = EYE_HEIGHT;
  walkSpeed = WALK_SPEED;
  sprintSpeed = SPRINT_SPEED;
  /** Horizontal movement hit a wall during the last step. */
  blocked = false;
  /** Seconds of reduced control after a knockback. */
  stun = 0;
  /** Highest point since last on the ground; used for fall damage. */
  peakY = 0;
  /** Distance fallen on the most recent landing (consumed by the game). */
  lastFall = 0;

  knockback(dx: number, dz: number, strength: number): void {
    const len = Math.hypot(dx, dz) || 1;
    this.vx = (dx / len) * strength;
    this.vz = (dz / len) * strength;
    this.vy = Math.max(this.vy, 4.5);
    this.onGround = false;
    this.stun = 0.35;
  }

  constructor(protected world: World) {}

  get eyeY(): number {
    return this.y + this.eyeHeight;
  }

  /** Axis-aligned bounds of the player: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): [number, number, number, number, number, number] {
    const h = this.width / 2;
    return [this.x - h, this.y, this.z - h, this.x + h, this.y + this.height, this.z + h];
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
          if (this.world.isSolidForCollision(x, y, z)) {
            const q=blockDef(this.world.getBlock(x,y,z)).box??[0,0,0,1,1,1];
            if(b[0]<x+q[3]-EPS&&b[3]>x+q[0]+EPS&&b[1]<y+q[4]-EPS&&b[4]>y+q[1]+EPS&&b[2]<z+q[5]-EPS&&b[5]>z+q[2]+EPS)return true;
          }
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
    if(d===0)return 0;
    const b=this.bounds(),lo=b.slice(0,3),hi=b.slice(3),a1=(axis+1)%3,a2=(axis+2)%3;
    lo[axis]+=Math.min(0,d);hi[axis]+=Math.max(0,d);let move=d;
    for(let x=Math.floor(lo[0]+EPS);x<=Math.floor(hi[0]-EPS);x++)for(let y=Math.floor(lo[1]+EPS);y<=Math.floor(hi[1]-EPS);y++)for(let z=Math.floor(lo[2]+EPS);z<=Math.floor(hi[2]-EPS);z++){
      if(!this.world.isSolidForCollision(x,y,z))continue;
      const q=blockDef(this.world.getBlock(x,y,z)).box??[0,0,0,1,1,1],o=[x,y,z];
      if(b[a1+3]<=o[a1]+q[a1]+EPS||b[a1]>=o[a1]+q[a1+3]-EPS||b[a2+3]<=o[a2]+q[a2]+EPS||b[a2]>=o[a2]+q[a2+3]-EPS)continue;
      if(d>0){const gap=o[axis]+q[axis]-b[axis+3];if(gap>=-EPS&&gap<move)move=Math.max(0,gap-1e-7);}
      else{const gap=o[axis]+q[axis+3]-b[axis];if(gap<=EPS&&gap>move)move=Math.min(0,gap+1e-7);}
    }return move;
  }

  private checkWater(): void {
    const h = this.width / 2 - 0.05;
    const w = this.world;
    const fx = Math.floor(this.x - h);
    const tx = Math.floor(this.x + h);
    const fz = Math.floor(this.z - h);
    const tz = Math.floor(this.z + h);
    let body = false;
    for (let z = fz; z <= tz && !body; z++) {
      for (let x = fx; x <= tx && !body; x++) {
        for (let y = Math.floor(this.y + 0.1); y <= Math.floor(this.y + Math.min(1.2, this.height * 0.66)); y++) {
          if (isWater(w.getBlock(x, y, z))) body = true;
        }
      }
    }
    this.inWater = body;
    this.headInWater = isWater(w.getBlock(Math.floor(this.x), Math.floor(this.eyeY + 0.08), Math.floor(this.z)));
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
    let speed = input.sprint ? this.sprintSpeed : this.walkSpeed;
    if (this.flying) speed = input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED * (input.sprint ? 1.3 : 1);
    if (input.sneak && !this.flying && !this.inWater) speed *= 0.3;
    const tx = fx * speed;
    const tz = fz * speed;
    const accel = (this.flying ? 10 : this.onGround ? 16 : this.inWater ? 6 : 4) * (this.stun > 0 ? 0.08 : 1);
    this.stun = Math.max(0, this.stun - dt);
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
      if (input.down) this.vy = Math.max(-4, this.vy - 14 * dt);
      if (this.vy < -4) this.vy = -4;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -60) this.vy = -60;
      if (input.jump && this.onGround) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
    }

    let ladder=false;
    for(let lx=Math.floor(this.x-.35);lx<=Math.floor(this.x+.35);lx++)for(let lz=Math.floor(this.z-.35);lz<=Math.floor(this.z+.35);lz++)
      for(let ly=Math.floor(this.y);ly<=Math.floor(this.y+this.height);ly++)if(isLadder(this.world.getBlock(lx,ly,lz)))ladder=true;
    if(ladder&&!this.flying){this.vy=input.sneak?0:input.jump||input.forward>0?3.2:Math.max(-1.5,this.vy);this.peakY=this.y;this.lastFall=0;}
    // Sweep one axis at a time: vertical first, then horizontal.
    const wantY = this.vy * dt;
    const dy = this.moveAxis(1, wantY);
    this.y += dy;
    const wasGround = this.onGround;
    if (dy !== wantY) {
      if (wantY < 0) {
        if (!wasGround) {
          this.landedImpact = -this.vy;
          this.lastFall = Math.max(0, this.peakY - (this.y));
        }
        this.onGround = true;
        if (this.flying) this.flying = false;
      }
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    // Jumping out of water onto a ledge: small boost when pushing against a wall.
    const supported = (x: number, z: number) => {
      const h = this.width / 2 - EPS;
      for (const dx of [-h, h]) for (const dz of [-h, h])
        if (this.world.isSolidForCollision(Math.floor(x + dx), Math.floor(this.y - 0.08), Math.floor(z + dz))) return true;
      return false;
    };
    const edge = input.sneak && this.onGround && !this.flying && !this.inWater;
    let wantX = this.vx * dt;
    if (edge && !supported(this.x + wantX, this.z)) { wantX = 0; this.vx = 0; }
    const dx = this.moveAxis(0, wantX);
    this.x += dx;
    if (dx !== wantX) this.vx = 0;
    let wantZ = this.vz * dt;
    if (edge && !supported(this.x, this.z + wantZ)) { wantZ = 0; this.vz = 0; }
    const dz = this.moveAxis(2, wantZ);
    this.z += dz;
    if (dz !== wantZ) this.vz = 0;
    if (this.inWater && input.jump && (dx !== wantX || dz !== wantZ)) this.vy = Math.max(this.vy, 4.2);

    this.blocked = dx !== wantX || dz !== wantZ;
    if (this.onGround || this.inWater || this.flying) this.peakY = this.y;
    else this.peakY = Math.max(this.peakY, this.y);
    this.horizontalSpeed = Math.hypot(this.vx, this.vz);
    if (this.onGround) this.walked += Math.hypot(dx, dz);
    if (this.y < -64) {
      this.y = 140;
      this.vy = 0;
    }
  }
}

