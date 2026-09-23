import { B } from './blocks';
import { columnIndex, SEA_LEVEL } from './constants';
import { mulberry32 } from './noise';
import { SHOWCASE_SEED } from './showcase';
/** Seeded settlements use world-space writes, so buildings agree across chunk borders. */
export function buildVillages(blocks:Uint8Array,cx:number,cz:number,seed:number,height:(x:number,z:number)=>number):void{
 const ox=cx*16,oz=cz*16;
 for(let gz=Math.floor((oz-30)/192);gz<=Math.floor((oz+45)/192);gz++)for(let gx=Math.floor((ox-30)/192);gx<=Math.floor((ox+45)/192);gx++){
  const r=mulberry32(seed^Math.imul(gx,374761393)^Math.imul(gz,668265263));
  const x=gx*192+32+Math.floor(r()*100),z=gz*192+32+Math.floor(r()*100);
  if(r()<.18||seed===SHOWCASE_SEED&&Math.hypot(x,z)<125||x+30<ox||x-30>ox+15||z+30<oz||z-30>oz+15)continue;
  const y=height(x,z);if(y<SEA_LEVEL+2||y>95)continue;
  const samples=[height(x-22,z-22),height(x+22,z-22),height(x-22,z+22),height(x+22,z+22)];if(samples.some(h=>Math.abs(h-y)>8))continue;
  const set=(dx:number,dy:number,dz:number,id:number)=>{const wx=x+dx,wz=z+dz,wy=y+dy;if(wx>=ox&&wx<ox+16&&wz>=oz&&wz<oz+16&&wy>0&&wy<128)blocks[columnIndex(wx-ox,wy,wz-oz)]=id;};
  const box=(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,id:number)=>{for(let zz=Math.max(z0,oz-z);zz<=Math.min(z1,oz+15-z);zz++)for(let xx=Math.max(x0,ox-x);xx<=Math.min(x1,ox+15-x);xx++)for(let yy=y0;yy<=y1;yy++)set(xx,yy,zz,id);};
  // Retaining walls step into natural terrain instead of leaving floating floors.
  for(let dz=-24;dz<=24;dz++)for(let dx=-24;dx<=24;dx++)if(Math.abs(dx)<3||Math.abs(dz)<3){box(dx,-9,dz,dx,-1,dz,B.DIRT);set(dx,0,dz,B.COBBLESTONE);box(dx,1,dz,dx,13,dz,B.AIR);}
  set(0,1,0,B.VILLAGE_POST);set(-2,1,-2,B.GLOW_LAMP);set(2,1,2,B.GLOW_LAMP);
  const house=(hx:number,hz:number,variant:number)=>{
   box(hx-1,-9,hz-1,hx+8,-1,hz+8,B.DIRT);box(hx-1,0,hz-1,hx+8,0,hz+8,B.COBBLESTONE);box(hx-1,1,hz-1,hx+8,13,hz+8,B.AIR);
   box(hx,1,hz,hx+7,4,hz+7,variant?B.BRICKS:B.OAK_PLANKS);box(hx+1,1,hz+1,hx+6,4,hz+6,B.AIR);
   for(const dx of [0,7])for(const dz of [0,7])box(hx+dx,1,hz+dz,hx+dx,5,hz+dz,B.OAK_LOG);
   box(hx+1,2,hz,hx+2,3,hz,B.GLASS);box(hx+5,2,hz+7,hx+6,3,hz+7,B.GLASS);
   for(let roof=0;roof<5;roof++)box(hx-1+roof,5+roof,hz-1,hx+8-roof,5+roof,hz+8,variant?B.COBBLESTONE:B.OAK_PLANKS);
   set(hx+3,1,hz+7,B.DOOR);set(hx+3,2,hz+7,B.DOOR_TOP);
   box(hx+3,0,hz+8,hx+3,0,Math.max(hz+8,0),B.COBBLESTONE);
   set(hx+1,1,hz+1,B.CHEST);set(hx+2,1,hz+1,B.FURNACE);set(hx+3,1,hz+1,B.CRAFTING_TABLE);
   set(hx+5,1,hz+2,B.BED);set(hx+5,1,hz+3,B.BED_FOOT);set(hx+6,3,hz+1,B.GLOW_LAMP);
  };
  house(-14,-14,0);house(7,-14,1);house(-14,7,r()>.5?1:0);
  // Public irrigated wheat plot, gated entrance and a lookout ladder.
  box(7,-9,7,18,-1,18,B.DIRT);box(7,0,7,18,0,18,B.COBBLESTONE);box(7,1,7,18,12,18,B.AIR);
  for(let dz=9;dz<17;dz++)for(let dx=9;dx<17;dx++){set(dx,0,dz,dx===12?B.WATER:B.FARMLAND);if(dx!==12)set(dx,1,dz,B.CROP_0+Math.floor(r()*4));}
  for(let i=7;i<=18;i++){set(7,1,i,B.OAK_LOG);set(18,1,i,B.OAK_LOG);set(i,1,7,B.OAK_LOG);set(i,1,18,B.OAK_LOG);}set(12,1,7,B.GATE);
  box(-2,0,-24,2,7,-20,B.COBBLESTONE);box(-1,1,-23,1,6,-21,B.AIR);for(let h=1;h<=8;h++)set(0,h,-19,B.LADDER);box(-3,8,-25,3,8,-19,B.OAK_PLANKS);set(0,9,-22,B.GLOW_LAMP);
 }
}
