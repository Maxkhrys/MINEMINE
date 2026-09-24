import * as THREE from 'three';
import { Sfx } from '../audio/Sfx';
import { GameRenderer } from '../render/Renderer';
import { WorldEffects } from '../render/WorldEffects';
import { UI } from '../ui/UI';
import { AdventureUI, type AdventurePanel } from '../ui/AdventureUI';
import { Adventure, type Village } from './Adventure';
import { AdventureEffects } from '../render/AdventureEffects';
import { B, isWater, IS_REPLACEABLE, IS_SOLID, IS_TARGETABLE, blockDef, canSupportPlant, isFurnace, isCrop, isDoor, doorBottom, isGate, isBed } from '../world/blocks';
import { ChunkManager } from '../world/ChunkManager';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../world/constants';
import { TerrainGenerator, type SpawnPoint } from '../world/generator';
import { seedFromString } from '../world/noise';
import { raycastVoxels, type RayHit } from '../world/raycast';
import { World } from '../world/World';
import { WorldPhysics } from '../world/Physics';
import { SHOWCASE_NAME, SHOWCASE_SEED } from '../world/showcase';
import { Input } from './Input';
import { I, ITEMS, TIER_SPEED, attackDamage, drawItemIcon, foodOf, isBlockItem, itemName, toolOf, durabilityOf, type Station } from './items';
import { MobManager, type Mob } from './Mobs';
import { Inventory, type GameMode } from './Inventory';
import { EYE_HEIGHT, Player } from './Player';
import { editsToRecord, loadSave, recordToEdits, writeSave, type SaveData } from './save';
import { loadSettings, saveSettings, type Settings } from './settings';

/** Survival reach, measured from the eye to the entry point of the targeted block. */
export const REACH = 4.5;

type State = 'loading' | 'menu' | 'playing' | 'inventory' | 'dead';

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
const MAX_AIR = 10;

export class Game {
  readonly renderer: GameRenderer;
  readonly world = new World();
  readonly adventure=new Adventure(this.world);
  readonly adventureUI:AdventureUI;
  readonly adventureEffects:AdventureEffects;
  private adventureRevision=0;
  private eating=0;private eatingId=0;private bowCharge=0;private blockTime=0;private blocking=false;
  private pendingRespawn=false;
  readonly chunks: ChunkManager;
  readonly player: Player;
  readonly input: Input;
  readonly ui: UI;
  readonly sfx = new Sfx();
  settings: Settings;
  inventory: Inventory = Inventory.starter('survival');
  state: State = 'loading';
  seed = 0;
  seedText = '';
  mode: GameMode = 'survival';
  spawn: SpawnPoint = { x: 0.5, y: 64, z: 0.5 };

  /** The single raycast result used by the outline, mining and placement this frame. */
  private hitStore: RayHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0, id: 0 };
  target: RayHit | null = null;
  private mining: { x: number; y: number; z: number; progress: number; sound: number } | null = null;
  private placeTimer = 0;
  private lastSpaceTap = -10;
  readonly physics = new WorldPhysics(this.world);
  readonly effects: WorldEffects;
  private cinematic = false;
  private cameraBobX = 0;
  private cameraBobY = 0;
  private lightPreset = 0;
  private viewpoint = 0;
  private createdAt = Date.now();
  private saveDirty = false;
  private lastSave = 0;
  private lastPosSave = 0;
  private saveWarned = false;
  private time = 0;
  private elapsed=0;
  private last = performance.now();
  private debug = false;
  private debugTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private titleSpin = 0;
  /** True from world creation until the player first enters it (menu shows "Play"). */
  private titleMode = true;
  private playTime = 0;
  private stepDist = 0;
  private wasInWater = false;
  private lastSelected = -1;
  private readonly camDir = new THREE.Vector3();
  private safeModeApplied = false;
  readonly mobs: MobManager;
  /** Survival stats, in half-hearts / half-drumsticks. */
  health = MAX_HEALTH;
  food = MAX_FOOD;
  private saturation = 5;
  private exhaustion = 0;
  private air = MAX_AIR;
  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private invulnerable = 0;
  private attackCooldown = 0;
  private lastWalked = 0;
  /** Animal under the crosshair when it is closer than the targeted block. */
  mobTarget: Mob | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.input = new Input(canvas);
    this.renderer = new GameRenderer(canvas, (x, y, z) => IS_SOLID[this.world.getBlock(x, y, z)] === 1);
    this.effects = new WorldEffects(this.world, this.renderer.scene, this.renderer.env);
    const caps = this.renderer.caps;
    const params = new URLSearchParams(location.search);
    const fallback = params.has('safe') || caps.softwareRenderer || /Mobi|Android/i.test(navigator.userAgent) ? 'low' : 'high';
    this.settings = loadSettings(fallback);
    if (params.has('safe')) Object.assign(this.settings, { postprocessing: false, shadows: 'off', ssao: false, bloom: false });
    if (!caps.postSupported) this.settings.postprocessing = false;
    this.renderer.applySettings(this.settings);
    this.sfx.setVolume(this.settings.volume);

    this.chunks = new ChunkManager(this.world, this.renderer.chunks);
    this.chunks.renderDistance = this.settings.renderDistance;
    this.player = new Player(this.world);

    this.mobs = new MobManager(this.world);
    this.renderer.scene.add(this.mobs.group);
    const icons = new Map(this.renderer.textures.icons);
    const sprites = new Map<number, HTMLCanvasElement>();
    for (const def of ITEMS.values()) {
      const icon = drawItemIcon(def);
      icons.set(def.id, icon.url);
      sprites.set(def.id, icon.canvas);
    }
    this.renderer.held.itemSprite = (id) => sprites.get(id) ?? null;

    this.ui = new UI(uiRoot, icons, this.settings, caps.postSupported, {
      onCloseInventory: () => this.closeInventory(),
      onAdventure:kind=>this.openAdventure(kind),
      onCraft: () => this.sfx.craft(),
      onRespawn: () => this.respawn(),
      onPlay: () => this.requestPlay(),
      onNewWorld: (seedText, mode) => this.newWorld(seedText, mode),
      onResetWorld: () => this.startWorld(this.seed, this.seedText, this.mode, null),
      onSettings: (s) => this.applySettings(s),
      onUiSound: () => {
        this.sfx.unlock();
        this.sfx.click();
      },
    });
    this.adventureUI=new AdventureUI(uiRoot,this.adventure,icons,()=>this.closeInventory(),text=>this.ui.toast(text),v=>{this.mobs.startRescue(v);this.ui.toast('Scout marked in your journal. Right-click them to begin the escort.');});
    this.adventureEffects=new AdventureEffects(this.world,this.adventure,icons,this.renderer.scene);
    this.adventure.onSpill=(stack,x,y,z)=>this.adventure.drop(stack,x,y,z);
    this.mobs.adventure=this.adventure;
    this.mobs.onAttack=(n,m)=>this.combatDamage(n,m.x,m.z);
    this.mobs.onShoot=(m,x,y,z)=>{const dx=x-m.x,dz=z-m.z,dist=Math.hypot(dx,dz),speed=19;this.adventureEffects.shoot(m.x,m.eyeY,m.z,dx,y-m.eyeY+4.5*(dist/speed)**2,dz,speed,4,true);this.sfx.dig('wood');};
    this.ui.setFps(this.settings.showFps ? '' : null);

    this.input.onLockChange((locked) => {
      if (locked && (this.state === 'menu' || this.state === 'inventory')) this.enterPlaying();
      else if (locked && this.state === 'dead') this.input.exitLock();
      else if (!locked && this.state === 'playing') this.pause();
    });
    this.input.onLockError(() => {
      if (this.state !== 'playing') this.ui.setLockNote('The browser did not capture the mouse. Click Play again.');
    });

    window.addEventListener('resize', () => this.renderer.resize());
    const flush = () => this.save();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'menu' && !this.ui.menuOpen) this.requestPlay();
    });

    const saved = loadSave();
    if (saved) this.startWorld(saved.seed, saved.seedText, saved.mode, saved);
    else this.newWorld(SHOWCASE_NAME, 'creative');
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ world lifecycle

  private newWorld(seedText: string, mode: GameMode): void {
    const text = seedText.trim();
    const seed = text ? seedFromString(text) : Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.startWorld(seed, text || String(seed), mode, null);
  }

  startWorld(seed: number, seedText: string, mode: GameMode, save: SaveData | null): void {
    this.state = 'loading';
    this.ui.hideMenu();
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.ui.setHudVisible(false);
    this.input.exitLock();
    this.chunks.unloadAll();
    this.world.clear();
    this.adventure.reset(save?.adventure,!!save&&!save.adventure);
    this.adventureUI.hide();this.adventureEffects.clear();this.eating=this.bowCharge=0;this.pendingRespawn=false;
    this.renderer.particles.clear();
    this.mobs.clear();this.mobs.restore(save?.animals);
    this.ui.hideDeath();
    this.physics.clear();
    this.effects.clear();
    this.cinematic = false;
    this.mining = null;
    this.target = null;

    this.seed = seed >>> 0;
    this.seedText = seedText;
    this.mode = mode;
    if (save) for (const [k, m] of recordToEdits(save.edits)) this.world.edits.set(k, m);
    this.spawn = save?.spawn ?? new TerrainGenerator(this.seed).spawn;
    this.createdAt = save?.createdAt ?? Date.now();
    this.chunks.start(this.seed, this.spawn);

    const p = save?.player;
    const valid = p && [p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite);
    this.player.x = valid ? p.x : this.spawn.x;
    this.player.y = valid ? p.y : this.spawn.y;
    this.player.z = valid ? p.z : this.spawn.z;
    this.player.yaw = valid ? p.yaw : this.seed === SHOWCASE_SEED ? 0 : Math.PI * 0.75;
    this.player.pitch = valid ? p.pitch : -0.12;
    this.player.flying = !!(valid && p.flying && mode === 'creative');
    this.player.vx = this.player.vy = this.player.vz = 0;
    this.player.peakY = this.player.y;
    this.health = valid && typeof p.health === 'number' && p.health > 0 ? Math.min(MAX_HEALTH, p.health) : MAX_HEALTH;
    this.food = valid && typeof p.food === 'number' ? Math.max(0, Math.min(MAX_FOOD, p.food)) : MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;

    this.inventory = save ? Inventory.deserialize(mode, save.inventory ?? undefined) : Inventory.starter(mode);
    this.inventory.onChange(() => this.onInventoryChange());
    this.onInventoryChange();
    this.lastSelected = -1;
    this.titleSpin = 0;
    this.titleMode = true;
    this.saveDirty = true;
    this.save();
  }

  private onInventoryChange(): void {
    this.ui.renderHotbar(this.inventory);
    const s = this.inventory.selectedStack;
    this.renderer.held.setItem(s ? s.id : 0);
    if (this.inventory.selected !== this.lastSelected || !s) {
      this.lastSelected = this.inventory.selected;
      this.ui.showItemName(s ? itemName(s.id) : '');
    }
    this.saveDirty = true;
  }

  save(): void {
    if (!this.seedText) return;
    const data: SaveData = {
      version: 1,
      seed: this.seed,
      seedText: this.seedText,
      mode: this.mode,
      spawn: this.spawn,
      createdAt: this.createdAt,
      player: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        flying: this.player.flying,
        health: this.health,
        food: this.food,
      },
      inventory: this.inventory.serialize(this.ui.carriedStack),
      adventure:this.adventure.data,animals:this.mobs.serialize(),
      edits: editsToRecord(this.world.edits),
    };
    const ok = writeSave(data);
    this.ui.setSaved(ok);
    this.saveDirty = false;
    this.lastSave = this.time;
    if (!ok && !this.saveWarned) {
      this.saveWarned = true;
      this.ui.toast('Could not save: browser storage is full or disabled.');
    }
  }

  // ------------------------------------------------------------------ states

  private worldInfo() {
    return { seedText: this.seedText, mode: this.mode };
  }

  requestPlay(): void {
    if (this.state !== 'menu') return;
    this.sfx.unlock();
    void this.input.requestLock().then((ok) => {
      if (ok && this.input.locked && this.state === 'menu') this.enterPlaying();
      else if (!ok) this.ui.setLockNote('The browser did not capture the mouse. Click Play again.');
    });
  }

  private enterPlaying(): void {
    if (this.ui.inventoryOpen && !this.ui.closeInventory()) { this.input.exitLock(); return; }
    if (this.titleSpin !== 0) {
      this.player.yaw += this.titleSpin;
      this.titleSpin = 0;
    }
    this.adventureUI.hide();
    this.state = 'playing';
    this.titleMode = false;
    this.ui.hideMenu();
    this.ui.setHudVisible(!this.cinematic);
    this.ui.setCrosshairVisible(true);
    this.mining = null;
  }

  private pause(): void {
    if (this.ui.inventoryOpen && !this.ui.closeInventory()) return;
    this.adventureUI.hide();this.eating=this.bowCharge=0;this.renderer.held.use='none';
    this.state = 'menu';
    this.mining = null;
    this.ui.showMenu('pause', this.worldInfo());
    this.save();
  }

  /** Crafting stations within reach of the player. */
  private nearbyStations(): Set<Station> {
    const st = new Set<Station>(['hand']);
    if (this.mode === 'creative') {
      st.add('table');
      st.add('furnace');
      return st;
    }
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);
    const pz = Math.floor(this.player.z);
    for (let y = py - 2; y <= py + 3; y++) {
      for (let z = pz - 4; z <= pz + 4; z++) {
        for (let x = px - 4; x <= px + 4; x++) {
          const b = this.world.getBlock(x, y, z);
          if (b === B.CRAFTING_TABLE) st.add('table');
          else if (isFurnace(b)) st.add('furnace');
        }
      }
    }
    return st;
  }

  private openInventory(): void {
    this.adventureUI.hide();
    this.state = 'inventory';
    this.mining = null;
    this.ui.setCrosshairVisible(false);
    this.ui.openInventory(this.inventory, this.nearbyStations());
    this.input.exitLock();
  }

  private closeInventory(): void {
    if (this.ui.inventoryOpen && !this.ui.closeInventory()) return;
    this.adventureUI.hide();this.saveDirty=true;
    for(const [key,c]of Object.entries(this.adventure.data.containers))if(c.kind==='grave'&&c.slots.every(s=>!s)){
      const [x,y,z]=key.split(',').map(Number);if(!this.world.isLoadedAt(x,z))continue;
      if(this.world.getBlock(x,y,z)===B.GRAVE)this.world.setBlock(x,y,z,B.AIR);
      delete this.adventure.data.containers[key];const marker=this.adventure.data.grave;
      if(marker&&marker.x===x&&marker.y===y&&marker.z===z)this.adventure.data.grave=null;this.chunks.flushUrgent();
    }
    this.ui.setCrosshairVisible(true);
    if (this.input.forceLocked) {
      this.enterPlaying();
      return;
    }
    void this.input.requestLock().then((ok) => {
      if (ok && this.input.locked) this.enterPlaying();
      else if (this.state === 'inventory') this.pause();
    });
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    this.renderer.applySettings(s);
    this.chunks.renderDistance = s.renderDistance;
    this.sfx.setVolume(s.volume);
    this.ui.setFps(s.showFps ? '' : null);
  }

  // ------------------------------------------------------------------ frame loop

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    this.elapsed=Math.min(1,Math.max(0,(now-this.last)/1000));
    const dt = Math.min(0.1, this.elapsed);
    this.last = now;
    this.time += dt;
    try {
      this.update(dt);
      this.draw(dt);
    } catch (err) {
      console.error(err);
    }
    this.input.endFrame();
  };

  private update(dt: number): void {
    this.handleKeys();

    if (this.state === 'playing') {
      this.playTime += dt;
      const sens = 0.0022 * this.settings.sensitivity;
      this.player.yaw -= this.input.mouseDX * sens;
      this.player.pitch -= this.input.mouseDY * sens * (this.settings.invertY ? -1 : 1);
      const lim = Math.PI / 2 - 0.001;
      this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
      const k = this.input.keys;
      const shift = k.has('ShiftLeft') || k.has('ShiftRight');
      const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      // Unloaded terrain acts as a wall; do not simulate until the player's column exists.
      if (this.world.isLoadedAt(Math.floor(this.player.x), Math.floor(this.player.z))) {
        this.player.update(dt, { forward, strafe, jump: k.has('Space'), down: shift, sneak: k.has('KeyC'), sprint: (shift || k.has('ControlLeft') || k.has('ControlRight')) && (this.mode === 'creative' || this.food > 6) }, this.mode === 'creative');
      }
      this.footsteps();
      this.survivalTick(dt);
    } else if (this.state === 'menu' && !this.ui.inventoryOpen && this.menuIsTitle()) {
      this.titleSpin += dt * 0.035;
    }

    this.updateCamera(dt);

    const cam = this.renderer.camera;
    cam.getWorldDirection(this.camDir);
    const budget = this.state === 'loading' ? 14 : 5;
    this.chunks.update(cam.position.x, cam.position.z, this.camDir.x, this.camDir.z, budget);
    if (this.state === 'playing' && this.physics.update(dt, (x, y, z) => this.player.intersectsBlock(x, y, z))) {
      this.saveDirty = true;
    }
    if (this.state === 'playing') {
      this.mobs.night=this.adventure.night;this.mobs.survival=this.mode==='survival';this.mobs.playerY=this.player.y;
      for (const m of this.mobs.update(dt, this.player.x, this.player.z)) {
        if (Math.hypot(m.x - this.player.x, m.z - this.player.z) < 16) this.sfx.mob(m.kind);
      }
    }

    if(this.state==='playing'||this.state==='inventory'){
      this.adventure.update(dt,this.player.x,this.player.y,this.player.z,this.state==='playing',this.elapsed);
      if(this.state==='playing')for(const stack of this.adventure.pickup(this.inventory,this.player.x,this.player.y,this.player.z))this.ui.showPickup(stack.id,stack.count);
      if(this.adventureRevision!==this.adventure.revision){this.saveDirty=true;this.adventureRevision=this.adventure.revision;}
      this.adventureUI.update(dt);
    }
    if(this.pendingRespawn&&this.world.isLoadedAt(Math.floor(this.player.x),Math.floor(this.player.z))){this.player.resolveStuck();this.player.peakY=this.player.y;this.pendingRespawn=false;}
    this.adventureEffects.update(this.state==='playing'?dt:0,this.player,this.mobs,(m,n)=>this.hurtMob(m,n),(n,x,z)=>this.combatDamage(n,x,z));
    if(this.mode==='survival')this.renderer.setDayTime(this.adventure.data.clock);
    if (this.state === 'loading') this.updateLoading();

    this.updateTarget();
    if (this.state === 'playing') this.handleActions(dt);
    const m = this.mining;
    const t = this.target;
    const progress = m && t && m.x === t.x && m.y === t.y && m.z === t.z ? m.progress : 0;
    let targetHint = '';
    if (t) {
      const def = blockDef(t.id), harvest = this.harvestInfo(t.id);
      targetHint = isFurnace(t.id)?'Right-click to smelt':t.id===B.CHEST||t.id===B.GRAVE?'Right-click for storage':isDoor(t.id)||isGate(t.id)?'Right-click to open / close':isBed(t.id)?'Right-click to sleep / set respawn':t.id===B.VILLAGE_POST?'Right-click for trades and requests':t.id===B.FARMLAND?'Plant seeds · water within 4 blocks':isCrop(t.id)?t.id===B.CROP_3?'Ripe wheat · right-click to harvest':'Growing · needs nearby water':t.id === B.CRAFTING_TABLE ? 'Right-click to open workshop' : !Number.isFinite(def.hardness) ? 'Unbreakable' : this.mode === 'creative' ? 'Left: break · Right: place' : !harvest.canDrop ? `${['', 'Wooden', 'Stone', 'Iron', 'Diamond'][def.minTier]} ${def.tool ?? 'tool'} required to collect` : def.tool ? `${def.tool[0].toUpperCase() + def.tool.slice(1)} ${harvest.correct ? 'equipped' : 'recommended'}` : 'Mine by hand';
    }
    this.ui.setTarget(this.state === 'playing' && !this.mobTarget ? t?.id ?? 0 : 0, targetHint, progress);
    this.ui.setNavigation(this.player.x, this.player.y, this.player.z, this.player.yaw);
    const showOutline = !this.cinematic && t && (this.state === 'playing' || this.state === 'inventory');
    this.renderer.selection.update(t?.x ?? 0, t?.y ?? 0, t?.z ?? 0, showOutline ? t.id : 0, t?.t ?? 0, progress);

    if (this.saveDirty && this.time - this.lastSave > 1.5) this.save();
    if (this.state === 'playing' && this.time - this.lastPosSave > 10) {
      this.lastPosSave = this.time;
      this.save();
    }

    if (this.renderer.shaderError && !this.safeModeApplied) {
      this.safeModeApplied = true;
      Object.assign(this.settings, { postprocessing: false, shadows: 'off', ssao: false, bloom: false, preset: 'custom' });
      this.applySettings(this.settings);
      this.ui.toast('Some graphics effects are not supported here, so they were turned off.', 5000);
    }
  }

  private menuIsTitle(): boolean {
    return this.titleMode;
  }

  private updateLoading(): void {
    const p = this.chunks.areaProgress(this.player.x, this.player.z, 2);
    const loaded = this.world.columns.size;
    this.ui.showLoading(p, p < 0.5 ? `Generating terrain… ${loaded} chunks` : `Building meshes… ${Math.round(p * 100)}%`);
    if (p >= 1) {
      this.player.resolveStuck();
      this.ui.hideLoading();
      this.state = 'menu';
      this.ui.showMenu(this.titleMode ? 'title' : 'pause', this.worldInfo());
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.renderer.camera;
    const p = this.player;
    let bobY = 0;
    let bobX = 0;
    const moving = this.state === 'playing' && p.onGround && p.horizontalSpeed > 0.5;
    const amount = moving && this.settings.viewBobbing ? Math.min(1, p.horizontalSpeed / 4.3) : 0;
    const phase = p.walked * 1.9;
    if (amount > 0) {
      bobY = Math.abs(Math.sin(phase)) * 0.045 * amount;
      bobX = Math.cos(phase) * 0.02 * amount;
    }
    const bobBlend = -Math.expm1(-14 * Math.max(0, dt));
    this.cameraBobX += (bobX - this.cameraBobX) * bobBlend;
    this.cameraBobY += (bobY - this.cameraBobY) * bobBlend;
    const yaw = p.yaw + this.titleSpin;
    cam.position.set(p.x + Math.cos(yaw) * this.cameraBobX, p.y + EYE_HEIGHT + this.cameraBobY, p.z - Math.sin(yaw) * this.cameraBobX);
    cam.rotation.set(p.pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();

    // Held item: dimmer in caves, bobbing with steps.
    const col = this.world.getColumn(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
    let bright = 1;
    if (col) {
      const hm = col.heightmap[((Math.floor(p.z) & 15) << 4) | (Math.floor(p.x) & 15)];
      if (p.eyeY < hm) bright = Math.max(0.25, 1 - (hm - p.eyeY) * 0.07);
    }
    this.renderer.held.update(dt, cam.aspect, phase, this.settings.viewBobbing ? amount : 0, bright);
  }

  /** One camera-centred DDA raycast per frame; outline, mining and placement all read it. */
  private updateTarget(): void {
    const cam = this.renderer.camera;
    if (this.state === 'loading') {
      this.target = null;
      return;
    }
    cam.getWorldDirection(this.camDir);
    this.target = raycastVoxels(
      (x, y, z) => this.world.getBlock(x, y, z),
      cam.position.x,
      cam.position.y,
      cam.position.z,
      this.camDir.x,
      this.camDir.y,
      this.camDir.z,
      REACH,
      this.hitStore,
    );
    // Animals in front of the targeted block take priority for left clicks.
    const mt = this.mobs.raycast(cam.position.x, cam.position.y, cam.position.z, this.camDir.x, this.camDir.y, this.camDir.z, REACH);
    this.mobTarget = mt && (!this.target || mt.t < this.target.t) ? mt.mob : null;
  }

  private handleKeys(): void {
    const pressed = this.input.pressed;
    if (pressed.size === 0 && this.input.wheel === 0) return;
    if (pressed.has('F3')) {
      this.debug = !this.debug;
      if (!this.debug) this.ui.setDebug(null);
    }
    if (this.state === 'playing') {
      if (pressed.has('F1')) {
        this.cinematic = !this.cinematic;
        this.ui.setHudVisible(!this.cinematic);
        this.renderer.selection.outline.visible = false;
      }
      if (pressed.has('KeyV') && this.mode === 'creative' && this.seed === SHOWCASE_SEED) {
        const shots = [
          { x: 37, y: 85, z: 57, yaw: 0.58, pitch: -0.38, name: 'Village panorama' },
          { x: 17, y: 64, z: 27, yaw: -0.75, pitch: -0.12, name: 'River bridge & windmill' },
          { x: 0.5, y: 62, z: -19, yaw: 0, pitch: 0.12, name: 'Keep entrance' },
          { x: -38, y: 33, z: -8, yaw: 0, pitch: -0.12, name: 'Diamond cavern' },
          { x: 0.5, y: 61, z: 28.5, yaw: 0, pitch: -0.12, name: 'Village square' },
        ];
        const shot = shots[this.viewpoint++ % shots.length];
        Object.assign(this.player, shot, { vx: 0, vy: 0, vz: 0, flying: true });
        this.ui.toast(shot.name, 1600);
      }
      if (pressed.has('KeyL') && this.mode === 'creative') {
        this.lightPreset = (this.lightPreset + 1) % 3;
        this.renderer.setLighting(this.lightPreset);
        this.ui.toast(['Daylight', 'Golden hour', 'Moonlight'][this.lightPreset], 1500);
      }
      for (let i = 1; i <= 9; i++) if (pressed.has(`Digit${i}`) || pressed.has(`Numpad${i}`)) this.inventory.select(i - 1);
      if (this.input.wheel !== 0) this.inventory.select(this.inventory.selected + this.input.wheel);
      if(pressed.has('KeyB')||pressed.has('KeyO')||pressed.has('KeyJ')){this.openAdventure(pressed.has('KeyB')?'backpack':pressed.has('KeyO')?'equipment':'journal');return;}
      if(pressed.has('KeyQ')){const stack=this.inventory.selectedStack;if(stack){this.adventure.drop({...stack,count:1},this.player.x-Math.sin(this.player.yaw),this.player.eyeY-.3,this.player.z-Math.cos(this.player.yaw),-Math.sin(this.player.yaw)*3,-Math.cos(this.player.yaw)*3);this.inventory.consumeSelected();}}
      if (pressed.has('KeyE')) {
        this.openInventory();
        return;
      }
      if (pressed.has('Escape')) {
        // Browsers normally release the pointer themselves on Esc; make sure it happens
        // even when the key reaches the page, then pause via the lock-change event.
        if (this.input.forceLocked) this.pause();
        else this.input.exitLock();
        return;
      }
      if (this.mode === 'creative') {
        if (pressed.has('KeyF')) this.toggleFly();
        if (pressed.has('Space')) {
          if (this.time - this.lastSpaceTap < 0.3) {
            this.toggleFly();
            this.lastSpaceTap = -10;
          } else this.lastSpaceTap = this.time;
        }
      }
    } else if (this.state === 'dead') {
      if (pressed.has('Enter') || pressed.has('Space')) this.respawn();
    } else if (this.state === 'inventory') {
      if (pressed.has('KeyE') || pressed.has('Escape') || pressed.has('KeyB') || pressed.has('KeyO') || pressed.has('KeyJ')) {
        this.closeInventory();
        return;
      }
      if(this.ui.inventoryOpen)for (let i = 1; i <= 9; i++) if (pressed.has(`Digit${i}`)) this.ui.inventoryHotkey(i - 1);
    }
  }

  private toggleFly(): void {
    this.player.flying = !this.player.flying;
    if (this.player.flying) this.player.vy = 0;
    this.ui.toast(this.player.flying ? 'Flying: Space up, Shift down' : 'Flying off', 1400);
  }

  // ------------------------------------------------------------------ mining & placing

  /** Whether the held tool is the right kind and tier to harvest a block. */
  private harvestInfo(id: number): { correct: boolean; canDrop: boolean; tier: number } {
    const def = blockDef(id);
    const tool = toolOf(this.inventory.selectedStack?.id);
    const correct = !!tool && !!def.tool && tool.kind === def.tool;
    const tier = correct ? tool.tier : 0;
    return { correct, canDrop: def.minTier === 0 || tier >= def.minTier, tier };
  }

  private breakTime(id: number): number {
    const h = blockDef(id).hardness;
    if (!Number.isFinite(h)) return Infinity;
    if (this.mode === 'creative') return 0.12;
    const { correct, canDrop, tier } = this.harvestInfo(id);
    let t = h;
    if (!canDrop) t *= 3.3;
    if (correct) t /= TIER_SPEED[tier];
    return Math.max(0.05, t);
  }

  private handleActions(dt: number): void {
    const input = this.input;

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (input.leftPressed || input.leftDown) this.renderer.held.triggerSwing();
    if ((input.leftPressed || input.leftDown) && this.mobTarget) {
      this.attack(this.mobTarget);
      this.mining = null;
    } else if (input.leftPressed && this.target && this.breakTime(this.target.id) <= 0.2) {
      // Soft blocks (and everything in Creative) break on a single click.
      this.breakTarget();
      this.mining = null;
    } else if (input.leftDown && this.target && !this.mobTarget) {
      // Harder blocks need the button held; the crack overlay shows progress.
      const t = this.target;
      const m = this.mining;
      if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z) {
        this.mining = { x: t.x, y: t.y, z: t.z, progress: 0, sound: 0 };
      }
      const cur = this.mining!;
      const bt = this.breakTime(t.id);
      if (Number.isFinite(bt)) {
        cur.progress += dt / bt;
        cur.sound -= dt;
        if (cur.sound <= 0) {
          cur.sound = 0.22;
          this.sfx.dig(blockDef(t.id).sound);
          this.renderer.held.triggerSwing();
        }
        if (cur.progress >= 1) {
          this.breakTarget();
          this.mining = null;
        }
      }
    } else {
      this.mining = null;
    }

    this.updateItemUse(dt);
    if (input.rightPressed) {
      this.useItem();
      this.placeTimer = 0.3;
    } else if (input.rightDown && isBlockItem(this.inventory.selectedStack?.id??0)) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) {
        this.placeOnTarget();
        this.placeTimer = 0.2;
      }
    }

    if (input.middlePressed && this.target) {
      if (!this.inventory.pick(this.target.id)) this.ui.toast(`No ${blockDef(this.target.id).name} in your inventory`, 1500);
    }
  }

  /** Right click: eat, open a station, or place a block. */
  private useItem(): void {
    const stack=this.inventory.selectedStack,t=this.target,shift=this.input.keys.has('ShiftLeft')||this.input.keys.has('ShiftRight'),m=this.mobTarget;
    if(m&&!shift){
      if(m.kind==='villager'){
        if(m.role==='scout'&&this.adventure.data.rescue&&!this.adventure.data.rescue.complete){this.adventure.data.rescue.following=true;this.ui.toast('Scout: Lead the way back to the village!');return;}
        const v=this.adventure.nearestVillage(m.x,m.z);this.openAdventure('trade',undefined,v);return;
      }
      if(stack&&this.mobs.feed(m,stack.id)){this.inventory.consumeSelected();this.sfx.mob(m.kind);this.ui.toast('Find and feed a second adult nearby to breed.');return;}
    }
    if(t&&!m&&!shift){
      if(isFurnace(t.id)){this.openAdventure('furnace',t);return;}
      if(t.id===B.CHEST||t.id===B.GRAVE){this.openAdventure(t.id===B.GRAVE?'grave':'chest',t);return;}
      if(t.id===B.CRAFTING_TABLE){this.openInventory();return;}
      if(t.id===B.VILLAGE_POST){this.openAdventure('trade',undefined,this.adventure.nearestVillage(t.x,t.z));return;}
      if(isDoor(t.id)||isGate(t.id)){this.toggleDoor(t);return;}
      if(isBed(t.id)){this.sleepAt(t);return;}
      if(t.id===B.CROP_3){this.harvestCrop(t.x,t.y,t.z);return;}
    }
    if(!stack)return;
    if(stack.id===I.BUCKET){
      const p=this.renderer.camera.position,d=this.camDir;const hit=raycastVoxels((x,y,z)=>isWater(this.world.getBlock(x,y,z))?B.DIRT:this.world.getBlock(x,y,z),p.x,p.y,p.z,d.x,d.y,d.z,REACH);
      if(hit&&isWater(this.world.getBlock(hit.x,hit.y,hit.z))){this.world.setBlock(hit.x,hit.y,hit.z,B.AIR);this.inventory.slots[this.inventory.selected]={id:I.WATER_BUCKET,count:1};this.inventory.changed();this.afterEdit();this.sfx.splash();}return;
    }
    if(stack.id===I.WATER_BUCKET&&t){const x=t.x+t.nx,y=t.y+t.ny,z=t.z+t.nz;if(IS_REPLACEABLE[this.world.getBlock(x,y,z)]&&this.world.setBlock(x,y,z,B.WATER)){this.inventory.slots[this.inventory.selected]={id:I.BUCKET,count:1};this.inventory.changed();this.afterEdit();this.sfx.splash();}return;}
    if(toolOf(stack.id)?.kind==='hoe'&&t&&(t.id===B.GRASS||t.id===B.DIRT)&&this.world.getBlock(t.x,t.y+1,t.z)===B.AIR){this.world.setBlock(t.x,t.y,t.z,B.FARMLAND);this.inventory.wearSelected();this.renderer.held.triggerSwing();this.afterEdit();return;}
    if(stack.id===I.SEEDS&&t&&t.id===B.FARMLAND&&this.world.getBlock(t.x,t.y+1,t.z)===B.AIR){this.world.setBlock(t.x,t.y+1,t.z,B.CROP_0);this.inventory.consumeSelected();this.afterEdit();return;}
    if(foodOf(stack.id)>0){if(this.food>=MAX_FOOD)this.ui.toast("You're not hungry",1000);else{this.eatingId=stack.id;this.eating=Math.max(.001,this.eating);}return;}
    if(stack.id===I.BOW)return;
    if(isBlockItem(stack.id))this.placeOnTarget();
  }

  private updateItemUse(dt:number):void{
    dt=this.elapsed||dt;
    const stack=this.inventory.selectedStack,input=this.input;
    const wasBlocking=this.blocking;
    this.blocking=!!this.adventure.data.equipment.shield&&input.keys.has('KeyR')&&!input.leftDown&&!input.rightDown;
    this.blockTime=this.blocking?(wasBlocking?this.blockTime+dt:0):0;
    this.renderer.held.use=this.blocking?'block':'none';
    if(this.eating>0){
      if(!input.rightDown||input.leftDown||stack?.id!==this.eatingId||this.food>=MAX_FOOD){this.eating=0;}
      else{this.eating+=dt;this.renderer.held.use='eat';this.renderer.held.useProgress=this.eating/1.25;
        if(Math.floor(this.eating/.32)!==Math.floor((this.eating-dt)/.32))this.sfx.eat();
        if(this.eating>=1.25){const food=foodOf(stack.id);this.food=Math.min(MAX_FOOD,this.food+food);this.saturation=Math.min(this.food,this.saturation+food*.6);this.inventory.consumeSelected();this.eating=0;this.saveDirty=true;}}
    }
    if(stack?.id===I.BOW&&!input.leftDown){
      if(input.rightDown&&(this.mode==='creative'||this.inventory.count(I.ARROW)>0)){this.bowCharge=Math.min(1.2,this.bowCharge+dt);this.renderer.held.use='bow';this.renderer.held.useProgress=this.bowCharge/1.2;}
      else if(this.bowCharge>.12){const p=this.renderer.camera.position,d=this.camDir;this.adventureEffects.shoot(p.x+d.x*.3,p.y+d.y*.3,p.z+d.z*.3,d.x,d.y,d.z,12+this.bowCharge*18,3+this.bowCharge*8);if(this.mode==='survival')this.inventory.remove(I.ARROW,1);this.inventory.wearSelected();this.inventory.changed();this.sfx.dig('wood');this.bowCharge=0;}
      else if(!input.rightDown)this.bowCharge=0;
      if(input.rightPressed&&this.mode==='survival'&&!this.inventory.count(I.ARROW))this.ui.toast('Craft arrows from a stone, stick and feather.');
    }else this.bowCharge=0;
  }

  openAdventure(kind:AdventurePanel,t?:{x:number;y:number;z:number},v?:Village):void{
    if(kind==='backpack'&&this.mode!=='creative'&&!this.inventory.count(I.BACKPACK)){this.ui.toast('Craft a backpack: 4 leather and 2 wheat at a table.');return;}
    if(kind==='furnace'&&!t){const p=this.player;let best=Infinity;for(let y=Math.floor(p.y)-2;y<=p.y+3;y++)for(let z=Math.floor(p.z)-4;z<=p.z+4;z++)for(let x=Math.floor(p.x)-4;x<=p.x+4;x++)if(isFurnace(this.world.getBlock(x,y,z))){const dist=Math.hypot(x+.5-p.x,y+.5-p.eyeY,z+.5-p.z);if(dist<best&&dist<=REACH+1){best=dist;t={x,y,z};}}if(!t){this.ui.toast('Place a furnace nearby, then right-click it.');return;}}
    if(this.ui.inventoryOpen&&!this.ui.closeInventory())return;
    this.state='inventory';this.mining=null;this.eating=this.bowCharge=0;this.renderer.held.use='none';this.ui.setCrosshairVisible(false);
    this.adventureUI.show(kind,this.inventory,t?this.adventure.container(t.x,t.y,t.z):undefined,v);this.input.exitLock();
  }

  private toggleDoor(t:RayHit):void{
    if(isGate(t.id)){const base=t.id>=B.GATE_X?B.GATE_X:B.GATE;if(t.id!==base&&this.player.intersectsBlock(t.x,t.y,t.z))return;this.world.setBlock(t.x,t.y,t.z,t.id===base?base+1:base);}
    else{const base=doorBottom(t.id),top=(t.id-base)%2===1,y=t.y-(top?1:0),open=t.id-base<2;
      if(!open&&(this.player.intersectsBlock(t.x,y,t.z)||this.player.intersectsBlock(t.x,y+1,t.z)))return;
      this.world.setBlock(t.x,y,t.z,base+(open?2:0));this.world.setBlock(t.x,y+1,t.z,base+(open?3:1));}
    this.sfx.place('wood');this.renderer.held.triggerSwing();this.afterEdit();
  }
  private sleepAt(t:RayHit):void{
    const y=t.y,z=t.z-(t.id===B.BED_FOOT?1:0);this.adventure.data.bed={x:t.x,y,z};this.saveDirty=true;
    if(!this.adventure.night){this.ui.toast('Respawn point set. Sleep here at night.');return;}
    if(this.mobs.mobs.some(m=>m.hostile&&!m.dead&&Math.hypot(m.x-t.x,m.z-t.z)<12)){this.ui.toast('Hostile creatures are too close to sleep.');return;}
    this.adventure.data.clock=(Math.floor(this.adventure.data.clock/1200)+(this.adventure.data.clock%1200>=780?1:0))*1200+180;
    this.ui.toast('A new day. Respawn point set.');this.sfx.craft();
  }
  private harvestCrop(x:number,y:number,z:number):void{
    const ripe=this.world.getBlock(x,y,z)===B.CROP_3;this.world.setBlock(x,y,z,B.AIR);
    if(this.mode==='survival'){this.adventure.drop({id:I.SEEDS,count:ripe?2:1},x+.5,y+.2,z+.5);if(ripe)this.adventure.drop({id:I.WHEAT,count:1},x+.5,y+.3,z+.5);}
    if(ripe)this.adventure.stat('harvested');this.sfx.breakBlock('grass');this.renderer.held.triggerSwing();this.afterEdit();
  }
  private combatDamage(amount:number,x:number,z:number):void{
    if(this.mode!=='survival'||this.state!=='playing'||this.invulnerable>0)return;
    const dx=x-this.player.x,dz=z-this.player.z,len=Math.hypot(dx,dz)||1;
    if(this.blocking&&(-Math.sin(this.player.yaw)*dx-Math.cos(this.player.yaw)*dz)/len>.15){
      const shield=this.adventure.data.equipment.shield;if(shield){shield.dur=(shield.dur??durabilityOf(shield.id))-2;if(shield.dur<=0){this.adventure.data.equipment.shield=null;this.ui.toast('Your shield broke');}}
      this.sfx.place('stone');this.adventure.revision++;
      if(this.blockTime<.24){this.ui.toast('Parry!',700);this.invulnerable=.25;for(const m of this.mobs.mobs)if(m.hostile&&Math.hypot(m.x-x,m.z-z)<2)m.knockback(dx,dz,7);return;}amount*=.3;
    }
    amount*=1-this.adventure.protection;this.adventure.wearArmour();this.damage(amount,'You fell in battle');
  }
  private hurtMob(mob:Mob,damage:number):void{
    if(mob.dead)return;mob.health-=damage;mob.hurtFlash=.25;mob.panic=mob.hostile?0:5;
    mob.knockback(mob.x-this.player.x,mob.z-this.player.z,4);this.sfx.mob(mob.kind,true);
    if(mob.health<=0){mob.dead=true;if(mob.hostile)this.adventure.stat('kills');if(this.mode==='survival')for(const [id,n]of mob.rollDrops())if(n>0)this.adventure.drop({id,count:n},mob.x,mob.y+.5,mob.z);}
  }

  private attack(mob: Mob): void {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 0.3;
    const held = this.inventory.selectedStack?.id;
    const dmg = this.mode === 'creative' ? 100 : attackDamage(held);
    this.hurtMob(mob,dmg);
    this.renderer.held.triggerSwing();this.exhaustion+=.1;
    if(toolOf(held)&&this.inventory.wearSelected())this.ui.toast('Your tool broke',1400);
  }

  /** Breaks exactly the block in `this.target` (the outlined one). */
  breakTarget(): boolean {
    const t = this.target;
    if (!t) return false;
    const { x, y, z } = t;
    const id = this.world.getBlock(x, y, z);
    const def = blockDef(id);
    if (!IS_TARGETABLE[id] || !Number.isFinite(def.hardness)) {
      if (id === B.BEDROCK) this.ui.toast('Bedrock cannot be broken', 1200);
      return false;
    }
    if(isCrop(id)){this.harvestCrop(x,y,z);return true;}
    if(id===B.CHEST||isFurnace(id))this.adventure.container(x,y,z);
    if(isDoor(id)){const base=doorBottom(id),otherY=y+((id-base)%2===1?-1:1);this.world.setBlock(x,otherY,z,B.AIR);}
    if(isBed(id)){const otherZ=z+(id===B.BED?1:-1);if(isBed(this.world.getBlock(x,y,otherZ)))this.world.setBlock(x,y,otherZ,B.AIR);}
    const harvest = this.harvestInfo(id);
    if (!this.world.setBlock(x, y, z, B.AIR)) return false;
    if (harvest.canDrop) this.collect(isDoor(id)?B.DOOR:isBed(id)?B.BED:def.drop);
    this.adventure.stat('mined');
    if(id===B.TALL_GRASS&&Math.random()<.4)this.collect(I.SEEDS);
    if (!harvest.canDrop && this.mode === 'survival') this.ui.toast(def.minTier > 1 ? `${def.name} needs ${def.minTier >= 3 ? "an iron" : "a stone"} pickaxe or better` : `${def.name} needs a pickaxe to collect`, 1600);
    if ((id === B.OAK_LEAVES || id === B.BIRCH_LEAVES) && Math.random() < 0.1) this.collect(I.APPLE);
    if (this.mode === 'survival') {
      this.exhaustion += 0.025;
      if (toolOf(this.inventory.selectedStack?.id) && this.inventory.wearSelected()) this.ui.toast('Your tool broke', 1400);
    }
    this.renderer.particles.burst(x, y, z, def.faces[0]);
    this.sfx.breakBlock(def.sound);
    this.renderer.held.triggerSwing();

    // Plants resting on the broken block pop off with it.
    const above = this.world.getBlock(x, y + 1, z);
    if (blockDef(above).needsSupport && this.world.setBlock(x, y + 1, z, B.AIR)) {
      this.collect(blockDef(above).drop);
      this.renderer.particles.burst(x, y + 1, z, blockDef(above).faces[0], 8);
    }
    this.queueWaterIfAdjacent(x, y, z);
    this.afterEdit();
    return true;
  }

  private collect(id: number): void {
    if (this.mode !== 'survival' || !id) return;
    const t=this.target;this.adventure.drop({id,count:1},t?t.x+.5:this.player.x,t?t.y+.5:this.player.y+.5,t?t.z+.5:this.player.z);
  }

  /** Places the selected block against the face of `this.target` hit by the ray. */
  placeOnTarget(): boolean {
    const t = this.target;
    const stack = this.inventory.selectedStack;
    if (!t || !stack || !isBlockItem(stack.id)) return false;
    const def = blockDef(stack.id);
    let tx: number;
    let ty: number;
    let tz: number;
    if (IS_REPLACEABLE[t.id]) {
      // Plants are replaced in place, like tall grass in most sandbox games.
      tx = t.x;
      ty = t.y;
      tz = t.z;
    } else {
      if (t.nx === 0 && t.ny === 0 && t.nz === 0) return false;
      tx = t.x + t.nx;
      ty = t.y + t.ny;
      tz = t.z + t.nz;
    }
    if (ty < 0 || ty >= WORLD_HEIGHT || !this.world.isLoadedAt(tx, tz)) return false;
    if (!IS_REPLACEABLE[this.world.getBlock(tx, ty, tz)]) return false;
    if (def.needsSupport && !canSupportPlant(this.world.getBlock(tx, ty - 1, tz))) {
      this.ui.toast(`${def.name} needs grass or dirt below it`, 1400);
      return false;
    }
    // Never place a block inside the player's collision volume.
    if (this.player.intersectsBlock(tx, ty, tz)) return false;
    let placeId=stack.id;
    if(stack.id===B.DOOR){if(!IS_REPLACEABLE[this.world.getBlock(tx,ty+1,tz)]||this.player.intersectsBlock(tx,ty+1,tz)||!IS_SOLID[this.world.getBlock(tx,ty-1,tz)])return false;placeId=Math.abs(Math.sin(this.player.yaw))>.7?B.DOOR_X:B.DOOR;this.world.setBlock(tx,ty+1,tz,placeId+1);}
    if(stack.id===B.BED){if(!IS_REPLACEABLE[this.world.getBlock(tx,ty,tz+1)]||this.player.intersectsBlock(tx,ty,tz+1)||!IS_SOLID[this.world.getBlock(tx,ty-1,tz)]||!IS_SOLID[this.world.getBlock(tx,ty-1,tz+1)])return false;this.world.setBlock(tx,ty,tz+1,B.BED_FOOT);}
    if(stack.id===B.GATE)placeId=Math.abs(Math.sin(this.player.yaw))>.7?B.GATE_X:B.GATE;
    if(stack.id===B.LADDER){if(!t.nx&&!t.nz){this.ui.toast('Place ladders against a wall.');return false;}placeId=t.nx?B.LADDER_X:B.LADDER;}
    if (!this.world.setBlock(tx, ty, tz, placeId)) return false;
    if(stack.id===B.OAK_PLANKS){const v=this.adventure.nearestVillage(tx,tz);if(v&&Math.hypot(tx-v.x,tz-v.z)<32)this.adventure.stat('villageBuild');}
    this.inventory.consumeSelected();
    this.sfx.place(def.sound);
    this.renderer.held.triggerSwing();
    this.afterEdit();
    return true;
  }

  private afterEdit(): void {
    this.chunks.flushUrgent();
    this.saveDirty = true;
    // Refresh the target so the outline reflects the change in this same frame.
    this.updateTarget();
  }

  // ------------------------------------------------------------------ survival

  /** Hunger, regeneration, starvation, drowning and fall damage (Survival only). */
  private survivalTick(dt: number): void {
    const p = this.player;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.mode !== 'survival') {
      p.lastFall = 0;
      this.air = MAX_AIR;
      return;
    }
    // Fall damage: one half-heart per block beyond three.
    if (p.lastFall > 0) {
      const dmg = Math.floor(p.lastFall - 3);
      p.lastFall = 0;
      if (dmg > 0 && !p.inWater) this.damage(dmg, 'You hit the ground too hard');
    }
    const underfoot = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z));
    if (underfoot === B.CAMPFIRE && !p.inWater) this.damage(1, 'You stood on a campfire');
    // Hunger drains with activity.
    const moved = p.walked - this.lastWalked;
    this.lastWalked = p.walked;
    const sprinting = p.horizontalSpeed > 5;
    this.exhaustion += dt * 0.012 + moved * (sprinting ? 0.1 : 0.02) + (p.inWater ? dt * 0.02 : 0);
    if (!p.onGround && p.vy > 8) this.exhaustion += 0.05;
    while (this.exhaustion >= 1) {
      this.exhaustion -= 1;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    // Natural regeneration when well fed, starvation when empty.
    this.regenTimer += dt;
    if (this.food >= 18 && this.health < MAX_HEALTH && this.regenTimer >= 3) {
      this.regenTimer = 0;
      this.health = Math.min(MAX_HEALTH, this.health + 1);
      this.exhaustion += 0.6;
    } else if (this.food > 0 || this.health >= MAX_HEALTH) {
      this.regenTimer = Math.min(this.regenTimer, 3);
    }
    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        this.damage(1, 'You starved');
      }
    } else this.starveTimer = 0;
    // Air runs out underwater.
    if (p.headInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.damage(2, 'You drowned');
        }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this.drownTimer = 0;
    }
  }

  damage(amount: number, cause: string): void {
    if (this.mode !== 'survival' || this.state === 'dead' || this.invulnerable > 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 0.5;
    this.ui.flashHurt();
    this.sfx.hurt();
    this.saveDirty = true;
    if (this.health <= 0) this.die(cause);
  }

  private die(cause: string): void {
    this.state = 'dead';
    this.mining = null;
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.ui.setCrosshairVisible(false);
    this.adventureUI.hide();const grave=this.adventure.makeGrave(this.inventory,this.player.x,this.player.y,this.player.z);
    this.ui.showDeath(cause,grave?'Your items are in a recovery backpack. Find its coordinates in the journal.':'Your inventory is safe. Return to your bed or world spawn.');
    this.input.exitLock();
    this.save();
  }

  respawn(): void {
    if (this.state !== 'dead') return;
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    const p = this.player;
    const bed=this.adventure.data.bed;const validBed=bed&&(!this.world.isLoadedAt(bed.x,bed.z)||isBed(this.world.getBlock(bed.x,bed.y,bed.z)));const spawn=validBed?{x:bed.x+.5,y:bed.y+.6,z:bed.z+.5}:this.spawn;
    p.x=spawn.x;p.y=spawn.y;p.z=spawn.z;
    p.vx = p.vy = p.vz = 0;
    p.lastFall = 0;
    if(this.world.isLoadedAt(Math.floor(p.x),Math.floor(p.z)))p.resolveStuck();else this.pendingRespawn=true;
    p.peakY = p.y;
    this.ui.hideDeath();
    this.state = 'menu';
    this.ui.showMenu('pause', this.worldInfo());
    this.save();
    this.requestPlay();
  }

  // ------------------------------------------------------------------ water

  private queueWaterIfAdjacent(x: number, y: number, z: number): void {
    this.physics.wake(x, y, z);
  }

  // ------------------------------------------------------------------ feedback

  private footsteps(): void {
    const p = this.player;
    if (p.inWater && !this.wasInWater) {
      this.sfx.splash();
      this.effects.ripple(p.x, p.z, this.time, 0.4);
    }
    this.wasInWater = p.inWater;
    if (!p.onGround) return;
    if (p.walked - this.stepDist > 1.7) {
      this.stepDist = p.walked;
      const below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z));
      if (below) this.sfx.step(blockDef(below).sound);
    }
    if (p.landedImpact > 8) this.sfx.step(blockDef(this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))).sound);
    p.landedImpact = 0;
  }

  private draw(dt: number): void {
    const cam = this.renderer.camera;
    const underwater = isWater(this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z)));
    this.renderer.particles.update(dt);
    const held = this.inventory.selectedStack?.id;
    this.effects.update(this.time, cam.position, held === B.GLOW_LAMP || held === B.CAMPFIRE);
    if (this.player.inWater && this.player.horizontalSpeed > 0.3)
      this.effects.ripple(this.player.x, this.player.z, this.time, 0.12);
    this.renderer.render(this.time, underwater, this.state === 'playing' && !this.cinematic);
    this.ui.setUnderwater(underwater && !this.renderer.postActive);
    this.ui.setBadge(this.mode, this.player.flying);
    this.ui.setVitals(this.mode === 'survival', this.health, this.food, this.air, MAX_AIR);
    const action=this.eating>0?`Eating · ${Math.round(this.eating/1.25*100)}%`:this.bowCharge>0?`Draw · ${Math.round(this.bowCharge/1.2*100)}%`:this.blocking?'Shield raised':this.mobTarget?this.mobTarget.kind==='villager'?(this.mobTarget.role==='scout'?'Scout · right-click to escort':'Trader · right-click to talk'):`${this.mobTarget.baby>0?'Baby ':''}${this.mobTarget.kind} · ${Math.ceil(this.mobTarget.health)} HP`:`Day ${this.adventure.day} · ${this.adventure.phase} · J journal`;
    this.adventureUI.status.textContent=action;this.adventureUI.status.classList.toggle('hidden',this.state!=='playing'||this.cinematic);
    this.ui.setHintVisible(this.state === 'playing' && this.playTime < 14);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.settings.showFps) this.ui.setFps(`${Math.round(this.fps)} FPS`);
    }
    this.debugTimer -= dt;
    if (this.debug && this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.ui.setDebug(this.debugText());
    }
  }

  private debugText(): string {
    const p = this.player;
    const info = this.renderer.renderer.info;
    const t = this.target;
    const deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360;
    const lines = [
      `MINEMINE  ${Math.round(this.fps)} fps`,
      `XYZ   ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Block ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}  chunk ${Math.floor(p.x / 16)} ${Math.floor(p.z / 16)}`,
      `Yaw ${deg(-p.yaw).toFixed(1)}°  pitch ${((p.pitch * 180) / Math.PI).toFixed(1)}°  ${p.onGround ? 'ground' : 'air'}${p.flying ? ' fly' : ''}${p.inWater ? ' water' : ''}`,
      t
        ? `Target ${blockDef(t.id).name} @ ${t.x} ${t.y} ${t.z}  face ${t.nx},${t.ny},${t.nz}  ${t.t.toFixed(2)}m`
        : `Target none (reach ${REACH})`,
      `Chunks ${this.world.columns.size} loaded, ${this.chunks.pendingRequests} pending, ${this.chunks.stats.workers} workers`,
      `Meshes ${this.renderer.chunks.meshCount}  tris ${(this.renderer.chunks.triangleCount / 1000).toFixed(0)}k  draws ${info.render.calls}`,
      `Seed ${this.seedText} (${this.seed})  ${this.mode}`,
      `GPU ${this.renderer.caps.gpu}`,
      `Post ${this.renderer.postActive ? 'on' : 'off'}  shadows ${this.settings.shadows}`,
    ];
    return lines.join('\n');
  }
}
