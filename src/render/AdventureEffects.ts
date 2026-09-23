import * as THREE from 'three';
import type { Adventure } from '../game/Adventure';
import type { Mob, MobManager } from '../game/Mobs';
import type { World } from '../world/World';
import type { Player } from '../game/Player';
import { raycastVoxels } from '../world/raycast';
interface Arrow {p:THREE.Vector3;v:THREE.Vector3;mesh:THREE.Mesh;life:number;damage:number;enemy:boolean;source:THREE.Vector3;}
/** Lightweight item sprites and swept, gravity-driven arrows. No post effects. */
export class AdventureEffects {
 readonly group=new THREE.Group();
 readonly arrows:Arrow[]=[];
 private drops=new Map<number,THREE.Sprite>();
 private materials=new Map<number,THREE.SpriteMaterial>();
 private arrowGeo=new THREE.CylinderGeometry(.018,.018,.7,4);
 private arrowMat=new THREE.MeshLambertMaterial({color:0xbca67a});
 private up=new THREE.Vector3(0,1,0);private direction=new THREE.Vector3();
 constructor(private world:World,private adventure:Adventure,private icons:Map<number,string>,scene:THREE.Scene){scene.add(this.group);this.group.name='survival-effects';}
 clear():void{for(const a of this.arrows)this.group.remove(a.mesh);this.arrows.length=0;for(const s of this.drops.values())this.group.remove(s);this.drops.clear();}
 shoot(x:number,y:number,z:number,dx:number,dy:number,dz:number,speed:number,damage:number,enemy=false):void{
   if(this.arrows.length>=40)return;const p=new THREE.Vector3(x,y,z),v=new THREE.Vector3(dx,dy,dz).normalize().multiplyScalar(speed);const mesh=new THREE.Mesh(this.arrowGeo,this.arrowMat);this.group.add(mesh);mesh.position.copy(p);mesh.quaternion.setFromUnitVectors(this.up,v.clone().normalize());this.arrows.push({p,v,mesh,damage,enemy,life:7,source:p.clone()});
 }
 update(dt:number,player:Player,mobs:MobManager,onMob:(m:Mob,n:number)=>void,onPlayer:(n:number,x:number,z:number)=>void):void{
   for(let i=this.arrows.length-1;i>=0;i--){const a=this.arrows[i];let hit=false;
     for(let left=dt;left>0&&!hit;){const step=Math.min(left,1/60);left-=step;a.v.y-=9*step;const distance=a.v.length()*step;this.direction.copy(a.v).normalize();const d=this.direction;
       const wall=raycastVoxels((x,y,z)=>this.world.getBlock(x,y,z),a.p.x,a.p.y,a.p.z,d.x,d.y,d.z,distance);
       const mob=!a.enemy?mobs.raycast(a.p.x,a.p.y,a.p.z,d.x,d.y,d.z,distance):null;
       if(mob&&(!wall||mob.t<wall.t)){onMob(mob.mob,a.damage);hit=true;}
       else if(a.enemy){const b=player.bounds();let low=0,high=distance;for(let k=0;k<3;k++){const o=a.p.getComponent(k),v=d.getComponent(k);if(Math.abs(v)<1e-8){if(o<b[k]||o>b[k+3])high=-1;}else{const t1=(b[k]-o)/v,t2=(b[k+3]-o)/v;low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));}}if(low<=high&&(!wall||low<wall.t)){onPlayer(a.damage,a.source.x,a.source.z);hit=true;}}
       hit ||=!!wall;if(!hit)a.p.addScaledVector(a.v,step);
     }
     a.life-=dt;if(hit||a.life<=0||a.p.y<-5){this.group.remove(a.mesh);this.arrows.splice(i,1);}else{a.mesh.position.copy(a.p);a.mesh.quaternion.setFromUnitVectors(this.up,this.direction.copy(a.v).normalize());}
   }
   const live=new Set<number>();for(const drop of this.adventure.data.drops){if(Math.hypot(drop.x-player.x,drop.z-player.z)>70||!this.world.isLoadedAt(Math.floor(drop.x),Math.floor(drop.z)))continue;live.add(drop.uid);let sprite=this.drops.get(drop.uid);if(!sprite){let mat=this.materials.get(drop.stack.id);if(!mat){const tex=new THREE.TextureLoader().load(this.icons.get(drop.stack.id)??'');tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;tex.colorSpace=THREE.SRGBColorSpace;mat=new THREE.SpriteMaterial({map:tex,alphaTest:.1,depthWrite:false});this.materials.set(drop.stack.id,mat);}sprite=new THREE.Sprite(mat);sprite.scale.set(.34,.34,.34);this.drops.set(drop.uid,sprite);this.group.add(sprite);}sprite.position.set(drop.x,drop.y+.06+Math.sin(drop.age*3)*.04,drop.z);}
   for(const [id,sprite]of this.drops)if(!live.has(id)){this.group.remove(sprite);this.drops.delete(id);}
 }
}
