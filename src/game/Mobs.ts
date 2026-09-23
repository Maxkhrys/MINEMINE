import * as THREE from 'three';
import { B, IS_SOLID, isWater } from '../world/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../world/constants';
import { mulberry32 } from '../world/noise';
import type { World } from '../world/World';
import { I } from './items';
import { Player } from './Player';
import { raycastVoxels } from '../world/raycast';
import type { Adventure, Village } from './Adventure';

export type MobKind = 'pig' | 'cow' | 'chicken' | 'fish' | 'bird' | 'villager' | 'zombie' | 'skeleton';

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

const SPECS = {
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
    drops: [[I.RAW_BEEF, 1, 3],[I.LEATHER,1,2]],
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
    drops: [[I.RAW_CHICKEN, 1, 1],[I.FEATHER,1,2]],
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
} as Record<MobKind, MobSpec>;

function humanoid(color:number,skin:number,skeleton=false):THREE.Group {
 const g=model([[.45,.65,.25,0,1.05,0,color],[.43,.43,.42,0,1.61,0,skin],[.07,.07,.02,-.12,1.65,-.22,0x171d16],[.07,.07,.02,.12,1.65,-.22,0x171d16],[.11,.16,.13,0,1.52,-.25,skin]],[[.15,.62,.16,-.16,.35,0,color],[.15,.62,.16,.16,.35,0,color],[.14,.6,.14,-.32,1.02,0,skin],[.14,.6,.14,.32,1.02,0,skin]]);
 if(skeleton){const bow=model([[.035,.66,.045,.39,1.1,-.22,0x725035],[.03,.05,.23,.39,1.43,-.12,0xa27a49],[.03,.05,.23,.39,.77,-.12,0xa27a49],[.012,.65,.012,.39,1.1,0,0xdac79e]],[]);g.add(...[...bow.children]);}return g;
}
SPECS.fish={width:.45,height:.3,health:4,speed:1.5,drops:[[I.RAW_FISH,1,1]],build:()=>model([[.19,.22,.55,0,.14,0,0x82b5b0],[.3,.24,.055,0,.14,.31,0xc88361],[.2,.035,.23,0,.28,.04,0x467c84],[.025,.04,.04,-.1,.2,-.2,0x172329],[.025,.04,.04,.1,.2,-.2,0x172329]],[])};
SPECS.bird={width:.35,height:.35,health:4,speed:2,drops:[[I.FEATHER,1,2]],build:()=>model([[.21,.25,.36,0,.18,0,0x6483a0],[.21,.2,.2,0,.34,-.2,0x3e5c78],[.09,.07,.17,0,.3,-.35,0xe2b162],[.035,.04,.02,-.07,.37,-.31,0x151a20],[.035,.04,.02,.07,.37,-.31,0x151a20]],[[.42,.045,.23,-.28,.2,0,0x416584],[.42,.045,.23,.28,.2,0,0x416584]])};
SPECS.villager={width:.6,height:1.85,health:20,speed:1.6,drops:[],build:()=>humanoid(0x7c6452,0xc79a74)};
SPECS.zombie={width:.6,height:1.85,health:20,speed:2.5,drops:[[I.BONE,0,2]],build:()=>humanoid(0x526b76,0x668354)};
SPECS.skeleton={width:.55,height:1.85,health:16,speed:2.3,drops:[[I.BONE,1,3],[I.ARROW,1,4]],build:()=>humanoid(0xcac5b2,0xded9c4,true)};
export interface MobSave {kind:MobKind;x:number;y:number;z:number;health:number;baby:number;love:number;breedCooldown:number;home:{x:number;y:number;z:number}|null;role:string;}

export class Mob extends Player {
  readonly spec: MobSpec;
  readonly mesh: THREE.Group;
  health: number;
  baby=0;love=0;breedCooldown=0;attackTimer=0;strafe=0;age=0;
  home:{x:number;y:number;z:number}|null=null;
  role='';
  get hostile():boolean{return this.kind==='zombie'||this.kind==='skeleton';}
  dispose():void{this.mesh.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});}
  save():MobSave{return {kind:this.kind,x:this.x,y:this.y,z:this.z,health:this.health,baby:this.baby,love:this.love,breedCooldown:this.breedCooldown,home:this.home,role:this.role};}
  steer(x:number,z:number,moving=true):void{this.turnTo=Math.atan2(this.x-x,this.z-z);this.moving=moving;}
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
      this.turnTo = Math.atan2(playerX - this.x, playerZ - this.z) + Math.sin(this.panic * 5) * 0.5;
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
    this.age+=dt;this.love=Math.max(0,this.love-dt);this.breedCooldown=Math.max(0,this.breedCooldown-dt);this.attackTimer=Math.max(0,this.attackTimer-dt);
    this.baby=Math.max(0,this.baby-dt);const size=this.baby>0?.55:1;this.mesh.scale.setScalar(size);this.height=this.spec.height*size;this.width=this.spec.width*size;
    if(this.kind==='fish'||this.kind==='bird'){
      const fly=this.kind==='bird',speed=fly?2.7:1.4;
      const nx=this.x-Math.sin(this.yaw)*dt*speed,nz=this.z-Math.cos(this.yaw)*dt*speed;
      const ny=fly?(this.home?.y??this.y)+Math.sin(this.age*.8)*1.5:this.y+Math.sin(this.age*1.5)*dt*.3;
      const id=this.world.getBlock(Math.floor(nx),Math.floor(ny+.2),Math.floor(nz));
      if(this.world.isLoadedAt(Math.floor(nx),Math.floor(nz))&&(fly?!IS_SOLID[id]:isWater(id))){this.x=nx;this.y=ny;this.z=nz;}else{this.turnTo=this.yaw+Math.PI*.7;}
      if(this.home&&Math.hypot(this.x-this.home.x,this.z-this.home.z)>14)this.steer(this.home.x,this.home.z);
      this.horizontalSpeed=speed;return;
    }
    const ahead = this.moving && !this.dead;
    const wantJump = ahead && (this.blocked || this.inWater);
    this.update(dt, { forward: ahead ? 1 : 0, strafe: this.strafe, jump: wantJump, down: false, sprint: this.panic > 0 }, false);
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
      mat.emissive.setRGB(this.hurtFlash > 0 ? 0.6 : this.love>0?.15:0, this.love>0?.03:0, 0);
      if(this.kind==='bird'&&mesh.userData.leg){mesh.rotation.x=0;mesh.rotation.z=(mesh.position.x<0?-1:1)*Math.sin(this.age*12)*.65;}
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

const MAX_MOBS = 30;

/** Spawns, simulates and despawns passive animals around the player. */
export class MobManager {
  readonly group = new THREE.Group();
  mobs: Mob[] = [];
  private spawnTimer = 1;
  private seed = 1;
  private towns=new Set<string>();
  private dormant:MobSave[]=[];
  private lifeTimer=0;
  night=false;survival=true;playerY=64;
  onAttack:((damage:number,mob:Mob)=>void)|null=null;
  onShoot:((mob:Mob,x:number,y:number,z:number)=>void)|null=null;
  adventure:Adventure|null=null;
  spawn(kind:MobKind,x:number,y:number,z:number):Mob{const m=new Mob(this.world,kind,this.seed++*7919);Object.assign(m,{x,y,z});m.peakY=y;this.mobs.push(m);this.group.add(m.mesh);m.updateMesh(0);return m;}
  serialize():MobSave[]{return [...this.dormant,...this.mobs.filter(m=>!m.dead&&!m.hostile).map(m=>m.save())];}
  restore(raw:MobSave[]=[]):void{this.dormant=raw.filter(m=>SPECS[m.kind]&&[m.x,m.y,m.z,m.health].every(Number.isFinite));}
  feed(m:Mob,item:number):boolean{
    if(m.dead||m.baby>0||m.breedCooldown>0||m.love>0)return false;
    if((m.kind==='cow'||m.kind==='pig')&&item===I.WHEAT||m.kind==='chicken'&&item===I.SEEDS){m.love=25;return true;}return false;
  }
  startRescue(v:Village):void{
    if(!this.adventure||this.adventure.data.rescue)return;
    const x=v.x+24,z=v.z+24,col=this.world.getColumn(x>>4,z>>4);if(!col)return;
    const y=col.heightmap[((z&15)<<4)|(x&15)]+1;
    this.adventure.data.rescue={village:v,x:x+.5,y,z:z+.5,following:false,complete:false};
    const m=this.spawn('villager',x+.5,y,z+.5);m.role='scout';m.home={x:m.x,y,z:m.z};this.adventure.revision++;
  }
  private lineOfSight(m:Mob,x:number,y:number,z:number):boolean{const dx=x-m.x,dy=y-m.eyeY,dz=z-m.z,n=Math.hypot(dx,dy,dz);return !raycastVoxels((x,y,z)=>this.world.getBlock(x,y,z),m.x,m.eyeY,m.z,dx/n,dy/n,dz/n,n);}


  constructor(private world: World) {
    this.group.name = 'mobs';
  }

  clear(): void {
    for (const m of this.mobs){this.group.remove(m.mesh);m.dispose();}
    this.mobs = [];this.dormant=[];this.towns.clear();
    this.spawnTimer = 1;
  }

  /** Returns mobs that made a sound this frame (for audio). */
  update(dt: number, px: number, pz: number): Mob[] {
    const noisy: Mob[] = [];
    this.dormant=this.dormant.filter(s=>{if(Math.hypot(s.x-px,s.z-pz)>70||!this.world.isLoadedAt(Math.floor(s.x),Math.floor(s.z)))return true;const m=this.spawn(s.kind,s.x,s.y,s.z);Object.assign(m,s);return false;});
    this.lifeTimer-=dt;
    if(this.lifeTimer<=0){this.lifeTimer=2;
      for(const v of this.adventure?.villages.values()??[]){if(this.towns.has(v.key)||Math.hypot(v.x-px,v.z-pz)>65)continue;this.towns.add(v.key);if(this.mobs.some(m=>m.kind==='villager'&&m.home&&Math.hypot(m.home.x-v.x,m.home.z-v.z)<8))continue;
        for(let i=0;i<2;i++){const m=this.spawn('villager',v.x+2+i*2,v.y,v.z+2);m.home={x:v.x+2,y:v.y,z:v.z+2};m.resolveStuck();}}
      for(const a of this.mobs)if(a.love>0&&!a.dead&&a.baby<=0&&a.breedCooldown<=0){const b=this.mobs.find(b=>b!==a&&!b.dead&&b.kind===a.kind&&b.love>0&&b.baby<=0&&b.breedCooldown<=0&&Math.hypot(a.x-b.x,a.z-b.z)<6);if(b&&this.mobs.length<40){a.love=b.love=0;a.breedCooldown=b.breedCooldown=180;const baby=this.spawn(a.kind,(a.x+b.x)/2,Math.max(a.y,b.y),(a.z+b.z)/2);baby.baby=90;baby.home={x:a.x,y:a.y,z:a.z};this.adventure?.stat('bred');}}
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      if (this.mobs.length < MAX_MOBS || this.night&&this.mobs.filter(m=>m.hostile).length<6) this.trySpawn(px, pz);
    }
    for (const m of this.mobs) {
      // Only simulate when the ground under it is loaded.
      if (!this.world.isLoadedAt(Math.floor(m.x), Math.floor(m.z))) continue;
      if (m.dead) {
        m.deathTimer += dt;
      } else {
        if (m.think(dt, px, pz)) noisy.push(m);
        m.strafe=0;
        if(m.love>0){const partner=this.mobs.find(b=>b!==m&&b.kind===m.kind&&b.love>0&&!b.dead);if(partner)m.steer(partner.x,partner.z);}
        if(m.home&&m.kind==='villager'&&Math.hypot(m.x-m.home.x,m.z-m.home.z)>8)m.steer(m.home.x,m.home.z);
        if(m.role==='scout'&&this.adventure?.data.rescue){const r=this.adventure.data.rescue;r.x=m.x;r.y=m.y;r.z=m.z;
          if(r.following&&!r.complete){m.steer(px,pz,Math.hypot(m.x-px,m.z-pz)>2.4);if(Math.hypot(m.x-r.village.x,m.z-r.village.z)<6){r.complete=true;r.following=false;m.home={x:r.village.x,y:r.village.y,z:r.village.z};this.adventure.revision++;}}}
        if(m.hostile){
          const dist=Math.hypot(m.x-px,m.z-pz),see=dist<28&&this.lineOfSight(m,px,this.playerY+1,pz);
          if(!this.night){m.health-=dt*3;m.hurtFlash=.1;if(m.health<=0)m.dead=true;}
          if(see&&this.survival){m.steer(px,pz,m.kind==='zombie'?dist>1.3:dist>13);
            if(m.kind==='skeleton'){
              m.strafe=Math.sin(m.age*.8)>0?1:-1;
              if(m.health<8&&m.attackTimer>.8){const side=m.strafe;const cx=m.x+Math.cos(m.yaw)*side*3,cz=m.z-Math.sin(m.yaw)*side*3;const cover=raycastVoxels((x,y,z)=>this.world.getBlock(x,y,z),cx,m.eyeY,cz,(px-cx)/dist,(this.playerY+1-m.eyeY)/dist,(pz-cz)/dist,dist);if(cover)m.steer(cx,cz);}
              if(dist<7)m.steer(m.x+(m.x-px),m.z+(m.z-pz));
              if(m.attackTimer<=0){m.attackTimer=2.3;this.onShoot?.(m,px,this.playerY+1,pz);}
            }else if(dist<1.7&&Math.abs(m.y-this.playerY)<1.7&&m.attackTimer<=0){m.attackTimer=1.1;this.onAttack?.(3,m);}
          }
        }
        m.tick(dt);
      }
      m.updateMesh(dt);
    }
    const keep: Mob[] = [];
    for (const m of this.mobs) {
      const far = Math.hypot(m.x - px, m.z - pz) > 96;
      if ((m.dead && m.deathTimer > 0.7) || far || m.y < -10){if(far&&!m.dead&&!m.hostile&&(m.home||m.baby||m.breedCooldown))this.dormant.push(m.save());this.group.remove(m.mesh);m.dispose();}
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
      if((isWater(ground)||isWater(this.world.getBlock(x,h+1,z)))&&this.mobs.filter(m=>m.kind==='fish').length<6){let waterY=h+1;while(waterY<125&&isWater(this.world.getBlock(x,waterY+1,z)))waterY++;for(let i=0;i<3;i++){if(!isWater(this.world.getBlock(x,waterY-1,z)))break;const m=this.spawn('fish',x+.3+i*.2,waterY-1,z+.5);m.home={x:m.x,y:m.y,z:m.z};}return;}
      if (ground !== B.GRASS && ground !== B.SNOWY_GRASS) continue;
      if(this.mobs.filter(m=>m.kind==='bird').length<4){const m=this.spawn('bird',x+.5,h+5,z+.5);m.home={x:m.x,y:m.y,z:m.z};}
      if(this.night&&this.survival&&this.mobs.filter(m=>m.hostile&&!m.dead).length<6){this.spawn(r()>.45?'zombie':'skeleton',x+.5,h+1,z+.5);return;}
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

