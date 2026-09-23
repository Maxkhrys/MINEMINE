import { B, blockDef, isCrop, isFurnace, isWater } from '../world/blocks';
import { columnIndex, columnKey } from '../world/constants';
import { mulberry32 } from '../world/noise';
import type { World } from '../world/World';
import { Inventory, type Stack } from './Inventory';
import { I, ITEMS, SMELTING, durabilityOf, equipmentOf, fuelTime, isValidItem, maxStackOf } from './items';

export type Slots = (Stack | null)[];
export type EquipmentSlot = 'head' | 'body' | 'legs' | 'feet' | 'shield';
export interface Container { kind: 'chest' | 'furnace' | 'grave'; slots: Slots; burn: number; burnTotal: number; progress: number; recipe: number; }
export interface Drop { uid: number; stack: Stack; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; }
export interface Village { key: string; name: string; x: number; y: number; z: number; }
export interface AdventureData {
  containers: Record<string, Container>;
  backpack: Slots;
  equipment: Record<EquipmentSlot, Stack | null>;
  crops: Record<string, number>;
  stats: Record<string, number>;
  discovered: Village[];
  claimed: string[];
  rescue: { village: Village; x: number; y: number; z: number; following: boolean; complete: boolean } | null;
  drops: Drop[];
  clock: number;
  keepInventory: boolean;
  bed: { x: number; y: number; z: number } | null;
  grave: { x: number; y: number; z: number } | null;
}
export const positionKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
export const keyPosition = (key: string): [number, number, number] => key.split(',').map(Number) as [number, number, number];
const cloneStack = (s: Stack): Stack => ({ ...s });

/** Lossless stack insertion, shared by chests, furnace, bags and ground pickups. */
export function insert(slots: Slots, stack: Stack, limit = stack.count): number {
  let left = Math.min(stack.count, limit);
  const max = maxStackOf(stack.id);
  for (const s of slots) if (s?.id === stack.id && max > 1 && left > 0) {
    const n = Math.min(max - s.count, left); s.count += n; left -= n;
  }
  for (let i = 0; i < slots.length && left > 0; i++) if (!slots[i]) {
    const n = Math.min(max, left); slots[i] = { ...stack, count: n }; left -= n;
  }
  return left;
}
export function transfer(from: Slots, index: number, to: Slots, count = Infinity): number {
  const stack = from[index]; if (!stack) return 0;
  const wanted = Math.min(count, stack.count);
  const moved = wanted - insert(to, stack, wanted);
  stack.count -= moved; if (stack.count <= 0) from[index] = null;
  return moved;
}
export function createContainer(kind: Container['kind']): Container {
  return { kind, slots: Array(kind === 'furnace' ? 3 : kind === 'grave' ? 63 : 27).fill(null), burn: 0, burnTotal: 0, progress: 0, recipe: 0 };
}
export function furnaceRecipe(c: Container) { return SMELTING.find(r => r.input === c.slots[0]?.id); }
export function acceptsFurnace(slot: number, stack: Stack): boolean {
  return slot === 0 ? SMELTING.some(r => r.input === stack.id) : slot === 1 && fuelTime(stack.id) > 0;
}
/** Fuel only ignites when a valid batch fits. Active fuel burns even if output is blocked. */
export function tickFurnace(c: Container, dt: number): boolean {
  let changed = false;
  for (let left = Math.min(dt, 120); left > .00001;) {
    const step = Math.min(left, .1); left -= step;
    const r = furnaceRecipe(c);
    if (c.recipe !== (r?.input ?? 0)) { c.recipe = r?.input ?? 0; c.progress = 0; changed = true; }
    const output = c.slots[2];
    const valid = !!r && c.slots[0]!.count >= r.amount && (!output || output.id === r.output && output.count + r.count <= maxStackOf(r.output));
    if (valid && c.burn <= 0 && c.slots[1] && fuelTime(c.slots[1].id)) {
      c.burn = c.burnTotal = fuelTime(c.slots[1].id);
      if (--c.slots[1].count <= 0) c.slots[1] = null;
      changed = true;
    }
    if (c.burn > 0) {
      const heat = Math.min(step, c.burn); c.burn = Math.max(0, c.burn - step); changed = true;
      if (valid && r) {
        c.progress += heat;
        if (c.progress + 1e-6 >= r.seconds) {
          c.progress = Math.max(0, c.progress - r.seconds);
          c.slots[0]!.count -= r.amount; if (c.slots[0]!.count <= 0) c.slots[0] = null;
          if (output) output.count += r.count; else c.slots[2] = { id: r.output, count: r.count };
        }
      }
    }
  }
  return changed;
}

export const TRADES = [
  { label: 'Sell wheat', take: I.WHEAT, amount: 4, give: I.EMERALD, count: 1 },
  { label: 'Sell coal', take: I.COAL, amount: 4, give: I.EMERALD, count: 1 },
  { label: 'Sell leather', take: I.LEATHER, amount: 2, give: I.EMERALD, count: 1 },
  { label: 'Iron supply', take: I.EMERALD, amount: 2, give: I.IRON_INGOT, count: 3 },
  { label: 'Fresh bread', take: I.EMERALD, amount: 1, give: I.BREAD, count: 3 },
  { label: 'Fletching supplies', take: I.EMERALD, amount: 1, give: I.FEATHER, count: 4 },
  { label: 'Starter seeds', take: I.EMERALD, amount: 1, give: I.SEEDS, count: 8 },
  { label: 'Travel pack', take: I.EMERALD, amount: 5, give: I.BACKPACK, count: 1 },
];
export const QUESTS = [
  { id: 'harvest', title: 'Stock the granary', text: 'Bring 6 wheat to a village trader.', goal: 6, reward: 3 },
  { id: 'build', title: 'Lend a hand', text: 'Place 12 oak planks within 32 blocks of a village noticeboard.', goal: 12, reward: 4 },
  { id: 'rescue', title: 'The missing scout', text: 'Find the scout, right-click to escort, then return to the noticeboard.', goal: 1, reward: 6 },
];
export const MILESTONES = [
  ['mined', 'First resources', 'Mine 20 blocks', 20], ['smelted', 'Working forge', 'Smelt 5 batches', 5],
  ['harvested', 'Green fingers', 'Harvest 6 ripe crops', 6], ['bred', 'A growing farm', 'Breed 2 baby animals', 2],
  ['kills', 'Night watch', 'Defeat 5 hostile creatures', 5], ['villages', 'Out beyond home', 'Discover 3 villages', 3],
] as const;

function cleanSlots(raw: unknown, length: number): Slots {
  const out: Slots = Array(length).fill(null);
  if (!Array.isArray(raw)) return out;
  raw.slice(0,length).forEach((s,i) => {
    if (!s || !isValidItem(s.id) || !Number.isFinite(s.count) || s.count <= 0) return;
    out[i] = { id: s.id, count: Math.min(maxStackOf(s.id), Math.floor(s.count)) };
    const d = durabilityOf(s.id); if (d) out[i]!.dur = Math.max(1, Math.min(d, s.dur ?? d));
  }); return out;
}
export class Adventure {
  data!: AdventureData;
  readonly villages = new Map<string, Village>();
  revision = 0;
  private nextDrop = 1;
  private cropTimer = 0;
  private scanTimer = 0;
  onSpill: ((stack: Stack, x: number, y: number, z: number) => void) | null = null;
  constructor(readonly world: World) {
    this.reset();
    world.onColumn(col => {
      for(let y=1;y<127;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++) {
        const id=col.blocks[columnIndex(x,y,z)];
        if (isCrop(id)) this.data.crops[positionKey(col.cx*16+x,y,col.cz*16+z)] ??= 0;
        if(id===B.VILLAGE_POST) this.registerVillage(col.cx*16+x,y,col.cz*16+z);
      }
    });
    world.onEdit((x,y,z,old,id) => {
      const key=positionKey(x,y,z);
      if(isCrop(id)) this.data.crops[key] ??= 0; else if(isCrop(old)) delete this.data.crops[key];
      if(old===B.VILLAGE_POST && id!==old) this.villages.delete(key);
      if(id===B.VILLAGE_POST)this.registerVillage(x,y,z);
      const c=this.data.containers[key];
      if(c && old!==id && !(isFurnace(old)&&isFurnace(id))) {
        for(const stack of c.slots) if(stack) this.onSpill?.(stack,x+.5,y+.6,z+.5);
        delete this.data.containers[key];
      }
      this.revision++;
    });
  }
  reset(raw?: Partial<AdventureData>, legacy = false): void {
    this.data = { containers: {}, backpack: cleanSlots(raw?.backpack,18), equipment: {head:null,body:null,legs:null,feet:null,shield:null}, crops: raw?.crops ?? {}, stats: raw?.stats ?? {}, discovered: raw?.discovered ?? [], claimed: raw?.claimed ?? [], rescue: raw?.rescue ?? null, drops: raw?.drops ?? [], clock: Number.isFinite(raw?.clock) ? raw!.clock! : 180, keepInventory: raw?.keepInventory ?? legacy, bed: raw?.bed ?? null, grave: raw?.grave ?? null };
    for(const [key,c] of Object.entries(raw?.containers ?? {})) {
      if (!/^[-\d]+,\d+,[-\d]+$/.test(key) || !['chest','furnace','grave'].includes(c.kind)) continue;
      const next=createContainer(c.kind); next.slots=cleanSlots(c.slots,next.slots.length);
      for(const k of ['burn','burnTotal','progress','recipe'] as const) next[k]=Number.isFinite(c[k]) ? Math.max(0,c[k]) : 0;
      this.data.containers[key]=next;
    }
    for(const slot of Object.keys(this.data.equipment) as EquipmentSlot[]) {
      const stack=cleanSlots([raw?.equipment?.[slot]],1)[0];
      if(stack && equipmentOf(stack.id)===slot)this.data.equipment[slot]=stack;
    }
    this.nextDrop=Math.max(0,...this.data.drops.map(d=>d.uid))+1;
    this.villages.clear(); this.cropTimer=0; this.scanTimer=0; this.revision++;
  }
  get night(): boolean { const t=this.data.clock%1200; return t>=780 || t<80; }
  get day(): number { return Math.floor(this.data.clock/1200)+1; }
  get phase(): string { return this.night ? 'Night' : this.data.clock%1200>650 ? 'Dusk' : 'Day'; }
  get protection(): number { return Object.values(this.data.equipment).reduce((n,s)=>n+(s ? ITEMS.get(s.id)?.protection ?? 0 : 0),0); }
  stat(key: string, n=1): void { this.data.stats[key]=(this.data.stats[key]??0)+n; this.revision++; }
  registerVillage(x: number,y: number,z: number): Village {
    const key=positionKey(x,y,z); const existing=this.villages.get(key); if(existing)return existing;
    const names=['Alder','Moss','Birch','Willow','Ember','Fern','Oak','River'];
    const suffix=['brook','wick','field','haven','ford','stead'];
    const seed=Math.abs(x*31+z*17); const name= Math.hypot(x,z)<12 ? 'Hearthvale' : names[seed%names.length]+suffix[Math.floor(seed/7)%suffix.length];
    const village={key,name,x,y,z}; this.villages.set(key,village); return village;
  }
  nearestVillage(x: number,z: number): Village | undefined {
    return [...this.villages.values()].filter(v=>this.world.isLoadedAt(v.x,v.z)).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
  }
  container(x:number,y:number,z:number): Container {
    const key=positionKey(x,y,z); if(this.data.containers[key])return this.data.containers[key];
    const id=this.world.getBlock(x,y,z); const c=createContainer(isFurnace(id)?'furnace':id===B.GRAVE?'grave':'chest');
    const edited=this.world.edits.get(columnKey(x>>4,z>>4))?.has(columnIndex(x&15,y,z&15));
    if(c.kind==='chest'&&!edited) {
      const r=mulberry32(Math.imul(x,7919)^Math.imul(z,437)^y);
      const loot: Stack[]=[{id:I.COAL,count:3+Math.floor(r()*5)},{id:I.SEEDS,count:4+Math.floor(r()*7)},{id:I.BREAD,count:2},{id:I.STICK,count:6}];
      if(r()>.5)loot.push({id:I.IRON_INGOT,count:2}); if(r()>.7)loot.push({id:I.LEATHER,count:2});
      loot.forEach(s=>insert(c.slots,s));
    }
    this.data.containers[key]=c; this.revision++; return c;
  }
  hasWater(x:number,y:number,z:number): boolean {
    for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)for(let dy=-1;dy<=0;dy++) if(isWater(this.world.getBlock(x+dx,y+dy,z+dz)))return true;
    return false;
  }
  update(dt:number, x:number,y:number,z:number, active:boolean,timerDt=dt): void {
    if(active)this.data.clock+=timerDt;
    for(const [key,c] of Object.entries(this.data.containers)) if(c.kind==='furnace') {
      const [fx,fy,fz]=keyPosition(key); if(!this.world.isLoadedAt(fx,fz)||!isFurnace(this.world.getBlock(fx,fy,fz)))continue;
      const before=c.slots[2]?.count??0;
      if(tickFurnace(c,timerDt))this.revision++;
      const produced=(c.slots[2]?.count??0)-before; if(produced>0)this.stat('smelted',produced);
      const block=c.burn>0?B.FURNACE_LIT:B.FURNACE; if(this.world.getBlock(fx,fy,fz)!==block)this.world.setBlock(fx,fy,fz,block);
    }
    this.cropTimer+=timerDt;
    if(this.cropTimer>=1) {
      const elapsed=this.cropTimer; this.cropTimer=0;
      for(const [key,time] of Object.entries(this.data.crops)) {
        const [cx,cy,cz]=keyPosition(key); if(!this.world.isLoadedAt(cx,cz))continue;
        const id=this.world.getBlock(cx,cy,cz);
        if(!isCrop(id)){delete this.data.crops[key];continue;}
        if(id===B.CROP_3||!this.hasWater(cx,cy-1,cz))continue;
        this.data.crops[key]=time+elapsed;
        if(this.data.crops[key]>=24){this.data.crops[key]=0;this.world.setBlock(cx,cy,cz,id+1);}
      }
    }
    this.scanTimer-=dt;
    if(active&&this.scanTimer<=0){this.scanTimer=2;for(const v of this.villages.values())if(Math.hypot(v.x-x,v.z-z)<30&&!this.data.discovered.some(d=>d.key===v.key)){this.data.discovered.push(v);this.stat('villages');}}
    if(!active)return;
    for(const drop of this.data.drops) {
      if(!this.world.isLoadedAt(Math.floor(drop.x),Math.floor(drop.z))||Math.hypot(drop.x-x,drop.z-z)>80)continue;
      drop.age+=dt;
      if(isWater(this.world.getBlock(Math.floor(drop.x),Math.floor(drop.y),Math.floor(drop.z)))) drop.vy=Math.min(1,drop.vy+dt*6);
      else drop.vy=Math.max(-15,drop.vy-dt*14);
      const ny=drop.y+drop.vy*dt;
      if(this.world.isSolidForCollision(Math.floor(drop.x),Math.floor(ny-.1),Math.floor(drop.z))&&drop.vy<0){drop.y=Math.floor(ny-.1)+1.13;drop.vy=Math.abs(drop.vy)>1?-drop.vy*.18:0;drop.vx*=.7;drop.vz*=.7;}
      else drop.y=ny;
      const nx=drop.x+drop.vx*dt, nz=drop.z+drop.vz*dt;
      if(!this.world.isSolidForCollision(Math.floor(nx),Math.floor(drop.y),Math.floor(nz))){drop.x=nx;drop.z=nz;}else{drop.vx=drop.vz=0;}
      drop.vx*=Math.max(0,1-dt*2);drop.vz*=Math.max(0,1-dt*2);
      if(drop.y<-5){drop.x=x;drop.y=y+1;drop.z=z;drop.vy=0;}
    }
  }
  drop(stack:Stack,x:number,y:number,z:number,vx=0,vz=0): void {
    const near=this.data.drops.find(d=>d.stack.id===stack.id&&!durabilityOf(stack.id)&&d.stack.count+stack.count<=maxStackOf(stack.id)&&Math.hypot(d.x-x,d.y-y,d.z-z)<1.5);
    if(near){near.stack.count+=stack.count;return;}
    this.data.drops.push({uid:this.nextDrop++,stack:cloneStack(stack),x,y,z,vx,vy:2,vz,age:0});this.revision++;
  }
  pickup(inv:Inventory,x:number,y:number,z:number): Stack[] {
    const collected:Stack[]=[];
    this.data.drops=this.data.drops.filter(d=>{
      if(d.age<.6||Math.hypot(d.x-x,d.y-(y+.65),d.z-z)>1.65)return true;
      const n=d.stack.count;const left=inv.add(d.stack.id,n,d.stack.dur);
      if(n>left){collected.push({...d.stack,count:n-left});this.revision++;}
      d.stack.count=left;return left>0;
    });return collected;
  }
  equip(inv:Inventory,index:number): boolean {
    const stack=inv.slots[index];const slot=stack&&equipmentOf(stack.id);if(!stack||!slot)return false;
    inv.slots[index]=this.data.equipment[slot];this.data.equipment[slot]=stack;inv.changed();this.revision++;return true;
  }
  unequip(inv:Inventory,slot:EquipmentSlot): boolean {
    const s=this.data.equipment[slot];if(!s)return false;
    if(insert(inv.slots,s)>0)return false;this.data.equipment[slot]=null;inv.changed();this.revision++;return true;
  }
  wearArmour(): void { for(const slot of ['head','body','legs','feet'] as EquipmentSlot[]){const s=this.data.equipment[slot];if(s){s.dur=(s.dur??durabilityOf(s.id))-1;if(s.dur<=0)this.data.equipment[slot]=null;}}this.revision++; }
  trade(inv:Inventory,take:number,amount:number,give:number,count:number): boolean {
    if(inv.count(take)<amount)return false;
    const next=Inventory.deserialize(inv.mode,inv.serialize());next.remove(take,amount);
    if(next.add(give,count)>0)return false;
    inv.slots=next.slots;inv.changed();this.stat('trades');return true;
  }
  questProgress(id:string,inv:Inventory):number { return id==='harvest'?inv.count(I.WHEAT):id==='rescue'?(this.data.rescue?.complete?1:0):this.data.stats.villageBuild??0; }
  claimQuest(id:string,inv:Inventory):boolean {
    const q=QUESTS.find(q=>q.id===id);if(!q||this.data.claimed.includes(id)||this.questProgress(id,inv)<q.goal)return false;
    const next=Inventory.deserialize(inv.mode,inv.serialize());if(id==='harvest')next.remove(I.WHEAT,q.goal);
    if(next.add(I.EMERALD,q.reward)>0)return false;
    inv.slots=next.slots;inv.changed();this.data.claimed.push(id);this.stat('quests');return true;
  }
  makeGrave(inv:Inventory,x:number,y:number,z:number): boolean {
    if(this.data.keepInventory)return false;
    const contents=[...inv.slots,...this.data.backpack,...Object.values(this.data.equipment)].filter((s):s is Stack=>!!s);
    if(!contents.length)return false;
    let spot:[number,number,number]|null=null;
    const cy=Math.min(123,Math.max(1,Math.floor(y)));
    for(let up=0;up<5&&!spot;up++)for(let dx=-2;dx<=2&&!spot;dx++)for(let dz=-2;dz<=2&&!spot;dz++){
      const bx=Math.floor(x)+dx,bz=Math.floor(z)+dz;
      if(this.world.isLoadedAt(bx,bz)&&blockDef(this.world.getBlock(bx,cy+up,bz)).replaceable)spot=[bx,cy+up,bz];
    }
    if(!spot)return false;
    this.world.setBlock(...spot,B.GRAVE);
    const c=createContainer('grave');contents.forEach(s=>insert(c.slots,s));this.data.containers[positionKey(...spot)]=c;
    inv.slots.fill(null);this.data.backpack.fill(null);for(const k of Object.keys(this.data.equipment) as EquipmentSlot[])this.data.equipment[k]=null;
    this.data.grave={x:spot[0],y:spot[1],z:spot[2]};inv.changed();this.revision++;return true;
  }
}
