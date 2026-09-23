import { h } from './dom';
import { Adventure, TRADES, QUESTS, MILESTONES, transfer, acceptsFurnace, furnaceRecipe, type Container, type EquipmentSlot, type Village } from '../game/Adventure';
import { Inventory, type Stack } from '../game/Inventory';
import { I, itemName, durabilityOf } from '../game/items';
export type AdventurePanel = 'chest'|'furnace'|'grave'|'backpack'|'equipment'|'journal'|'trade';
export class AdventureUI {
  readonly screen=h('div',{class:'adventure-screen hidden'});
  readonly status=h('div',{class:'adventure-status hidden','aria-live':'polite'});
  kind:AdventurePanel='journal'; container:Container|null=null; village:Village|undefined;
  private inv!:Inventory; private timer=0; private revision=-1; private fuelSlot=0; private lastFocus:Element|null=null;
  get open():boolean{return !this.screen.classList.contains('hidden');}
  constructor(root:HTMLElement,readonly adventure:Adventure,private icons:Map<number,string>,private close:()=>void,private notice:(s:string)=>void,private rescue:(v:Village)=>void){root.append(this.screen,this.status);this.screen.addEventListener('contextmenu',e=>e.preventDefault());this.screen.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const focus=[...this.screen.querySelectorAll<HTMLElement>('button:not(:disabled),input')];const i=focus.indexOf(document.activeElement as HTMLElement);e.preventDefault();focus[(i+(e.shiftKey?-1:1)+focus.length)%focus.length]?.focus();});}
  show(kind:AdventurePanel,inv:Inventory,c?:Container,v?:Village):void{this.kind=kind;this.inv=inv;this.container=c??null;this.village=v;this.lastFocus=document.activeElement;this.screen.classList.remove('hidden');this.render();this.screen.querySelector<HTMLElement>('button')?.focus();}
  hide():void{this.screen.classList.add('hidden');(this.lastFocus as HTMLElement)?.focus?.();}
  update(dt:number):void{if(!this.open)return;this.timer-=dt;if(this.timer<=0){this.timer=.15;this.refreshMeters();if(this.revision!==this.adventure.revision){const active=document.activeElement as HTMLElement;const key=active?.dataset.focus;this.render();if(key)this.screen.querySelector<HTMLElement>(`[data-focus="${key}"]`)?.focus();}}}
  private changed():void{this.adventure.revision++;this.inv.changed();this.render();}
  private slot(s:Stack|null,index:number,source:'inventory'|'storage'|'equipment',label?:string):HTMLElement{
    const click=(e:MouseEvent)=>{e.preventDefault();const n=e.button===2?1:Infinity;
      if(source==='equipment'){this.adventure.unequip(this.inv,label as EquipmentSlot);this.changed();return;}
      if(this.kind==='equipment'){if(!this.adventure.equip(this.inv,index))this.notice('Choose armour or a shield to equip.');this.changed();return;}
      const slots=this.kind==='backpack'?this.adventure.data.backpack:this.container?.slots;if(!slots)return;
      if(source==='storage'){transfer(slots,index,this.inv.slots,n);if(this.kind==='furnace'&&index<2)this.fuelSlot=index;}
      else if(this.kind==='furnace'){
        const item=this.inv.slots[index];if(!item)return;
        const target=acceptsFurnace(this.fuelSlot,item)?this.fuelSlot:acceptsFurnace(0,item)?0:acceptsFurnace(1,item)?1:-1;
        if(target<0){this.notice('Add ore or raw food as input; coal, wood or sticks as fuel.');return;}
        const one=[slots[target]];transfer(this.inv.slots,index,one,n);slots[target]=one[0];
      }else transfer(this.inv.slots,index,slots,n);
      this.changed();};
    const b=h('button',{class:'adventure-slot', 'data-focus':`${source}-${index}`,'data-slot':index,'data-source':source,'aria-label':`${label??`Slot ${index+1}`}: ${s?`${itemName(s.id)}, ${s.count}`:'empty'}`,title:s?itemName(s.id):label??'Empty slot',onclick:click,oncontextmenu:click},s?h('img',{src:this.icons.get(s.id),alt:'',draggable:false}):null,s&&s.count>1?h('span',{},String(s.count)):null);
    if(s&&durabilityOf(s.id))b.append(h('progress',{class:'gear-wear',max:durabilityOf(s.id),value:s.dur??durabilityOf(s.id),'aria-label':'Durability'}));return b;
  }
  private grid(slots:(Stack|null)[],source:'inventory'|'storage'):HTMLElement{return h('div',{class:'adventure-grid'},slots.map((s,i)=>this.slot(s,i,source)));}
  private refreshMeters():void{const c=this.container;if(this.kind!=='furnace'||!c)return;const recipe=furnaceRecipe(c);const p=this.screen.querySelector<HTMLProgressElement>('#smelt-progress');if(p)p.value=c.progress/(recipe?.seconds??5);const b=this.screen.querySelector<HTMLProgressElement>('#fuel-progress');if(b)b.value=c.burn/Math.max(1,c.burnTotal);const label=this.screen.querySelector('#furnace-status');if(label)label.textContent=c.burn>0?`Fire burning · ${Math.ceil(c.burn)}s fuel left`:recipe?'Add fuel to light the furnace':'Add raw food, ore or a log';}
  render():void{
    this.revision=this.adventure.revision;
    const titles={chest:'Chest',furnace:'Furnace',grave:'Recovery backpack',backpack:'Travel backpack',equipment:'Equipment',journal:'Adventure journal',trade:this.village?.name??'Village trader'};
    const body=h('div',{class:'adventure-body'});
    const title=h('header',{class:'inventory-header'},h('div',{},h('div',{class:'eyebrow'},`MINEMINE / DAY ${this.adventure.day} · ${this.adventure.phase.toUpperCase()}`),h('h2',{},titles[this.kind])),h('button',{'aria-label':'Close panel',class:'close-button','data-focus':'close',onclick:this.close},'×'));
    const nav=h('nav',{class:'adventure-nav'},(['backpack','equipment','journal'] as AdventurePanel[]).map(k=>h('button',{'data-focus':k,onclick:()=>{if(k==='backpack'&&this.inv.mode!=='creative'&&!this.inv.count(I.BACKPACK)){this.notice('Craft a backpack from 4 leather and 2 wheat.');return;}this.kind=k;this.render();}},k==='backpack'?'Backpack [B]':k==='equipment'?'Equipment [O]':'Journal [J]')));
    if(['chest','grave','backpack'].includes(this.kind)){
      const slots=this.kind==='backpack'?this.adventure.data.backpack:this.container!.slots;
      body.append(h('p',{class:'adventure-help'},'Click to transfer a stack · Right-click for one item. Contents save automatically.'),this.grid(slots,'storage'),h('button',{onclick:()=>{slots.forEach((_,i)=>transfer(slots,i,this.inv.slots));this.changed();}},'Take all'));
    }else if(this.kind==='furnace'){
      const c=this.container!;
      body.append(h('p',{class:'adventure-help'},'Choose Input or Fuel, then click an item below. Click Output to collect.'),h('div',{class:'furnace-station'},h('div',{},h('button',{onclick:()=>{this.fuelSlot=0;this.notice('Input selected');}},'Input'),this.slot(c.slots[0],0,'storage','Input')),h('div',{class:'furnace-heat'},h('span',{},'SMELTING'),h('progress',{id:'smelt-progress',max:1,value:0,'aria-label':'Smelting progress'}),h('span',{id:'furnace-status'}),h('progress',{id:'fuel-progress',max:1,value:0,'aria-label':'Fuel remaining'})),h('div',{},h('p',{},'Output'),this.slot(c.slots[2],2,'storage','Output')),h('div',{},h('button',{onclick:()=>{this.fuelSlot=1;this.notice('Fuel selected');}},'Fuel'),this.slot(c.slots[1],1,'storage','Fuel'))));
    }else if(this.kind==='equipment'){
      body.append(h('p',{},`Armour absorbs ${Math.round(this.adventure.protection*100)}% of combat damage. Hold R to raise your equipped shield; block just before impact to parry.`),h('div',{class:'equipment-row'},(Object.keys(this.adventure.data.equipment) as EquipmentSlot[]).map((k,i)=>h('div',{},h('span',{},k),this.slot(this.adventure.data.equipment[k],i,'equipment',k)))));
    }else if(this.kind==='trade'){
      body.append(h('h3',{},'Market'),h('div',{class:'trade-list'},TRADES.map((t,i)=>h('button',{'data-focus':`trade-${i}`,disabled:this.inv.count(t.take)<t.amount,onclick:()=>{if(!this.adventure.trade(this.inv,t.take,t.amount,t.give,t.count))this.notice('Make room in your inventory.');this.render();}},`${t.amount} ${itemName(t.take)} → ${t.count} ${itemName(t.give)}`))));this.quests(body,true);
    }else{
      const d=this.adventure.data;
      body.append(h('label',{class:'keep-items'},h('input',{type:'checkbox',checked:d.keepInventory,onchange:(e:Event)=>{d.keepInventory=(e.target as HTMLInputElement).checked;this.adventure.revision++;}}),' Keep inventory on death'),h('p',{},d.grave?`Recovery backpack: ${d.grave.x}, ${d.grave.y}, ${d.grave.z}`:'Dropped gear waits in a recovery backpack after death.'),h('h3',{},'Discoveries'),h('div',{class:'journal-discoveries'},d.discovered.length?d.discovered.map(v=>h('p',{},`${v.name} · ${v.x}, ${v.z}`)):h('p',{},'Explore to discover villages. Noticeboards mark their centres.')));
      if(d.rescue&&!d.rescue.complete)body.append(h('p',{},`Scout: ${Math.round(d.rescue.x)}, ${Math.round(d.rescue.z)} · ${d.rescue.following?'following you':'right-click to escort'}`));
      this.quests(body,false);body.append(h('h3',{},'Milestones'),h('div',{class:'milestone-list'},MILESTONES.map(([key,name,desc,goal])=>h('div',{},h('strong',{},name),h('span',{},`${desc} · ${Math.min(goal,d.stats[key]??0)}/${goal}`),h('progress',{max:goal,value:d.stats[key]??0,'aria-label':name})))));
    }
    if(this.kind!=='journal'){body.append(h('h3',{},'Your inventory'),this.grid(this.inv.slots,'inventory'));}
    this.screen.replaceChildren(h('section',{class:'adventure-panel',role:'dialog','aria-modal':'true','aria-label':titles[this.kind]},title,nav,body,h('footer',{},'E / Esc close · Q drop item · R shield · Hold right-click to eat or draw a bow')));this.refreshMeters();
  }
  private quests(body:HTMLElement,interactive:boolean):void{body.append(h('h3',{},'Village requests'),h('div',{class:'quest-list'},QUESTS.map(q=>h('article',{},h('strong',{},q.title),h('p',{},q.text),h('span',{},`${Math.min(q.goal,this.adventure.questProgress(q.id,this.inv))}/${q.goal} · ${q.reward} emeralds`),interactive?h('button',{disabled:this.adventure.data.claimed.includes(q.id),onclick:()=>{if(q.id==='rescue'&&!this.adventure.data.rescue&&this.village){this.rescue(this.village);this.render();return;}if(!this.adventure.claimQuest(q.id,this.inv))this.notice('Finish the request and leave room for your reward.');this.render();}},this.adventure.data.claimed.includes(q.id)?'Completed':q.id==='rescue'&&!this.adventure.data.rescue?'Locate scout':'Claim reward'):null))));}
}
