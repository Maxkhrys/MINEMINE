import * as THREE from 'three';
import { Sfx } from '../audio/Sfx';
import { GameRenderer } from '../render/Renderer';
import { UI } from '../ui/UI';
import { B, IS_REPLACEABLE, IS_SOLID, IS_TARGETABLE, blockDef, canSupportPlant } from '../world/blocks';
import { ChunkManager } from '../world/ChunkManager';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../world/constants';
import { TerrainGenerator, type SpawnPoint } from '../world/generator';
import { seedFromString } from '../world/noise';
import { raycastVoxels, type RayHit } from '../world/raycast';
import { World } from '../world/World';
import { Input } from './Input';
import { Inventory, type GameMode } from './Inventory';
import { EYE_HEIGHT, Player } from './Player';
import { editsToRecord, loadSave, recordToEdits, writeSave, type SaveData } from './save';
import { loadSettings, saveSettings, type Settings } from './settings';

/** Survival reach, measured from the eye to the entry point of the targeted block. */
export const REACH = 4.5;

type State = 'loading' | 'menu' | 'playing' | 'inventory';

interface WaterTask {
  x: number;
  y: number;
  z: number;
  ox: number;
  oz: number;
  budget: number;
  at: number;
}

export class Game {
  readonly renderer: GameRenderer;
  readonly world = new World();
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
  private waterQueue: WaterTask[] = [];
  private createdAt = Date.now();
  private saveDirty = false;
  private lastSave = 0;
  private lastPosSave = 0;
  private saveWarned = false;
  private time = 0;
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

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.input = new Input(canvas);
    this.renderer = new GameRenderer(canvas, (x, y, z) => IS_SOLID[this.world.getBlock(x, y, z)] === 1);
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

    this.ui = new UI(uiRoot, this.renderer.textures.icons, this.settings, caps.postSupported, {
      onPlay: () => this.requestPlay(),
      onNewWorld: (seedText, mode) => this.newWorld(seedText, mode),
      onResetWorld: () => this.startWorld(this.seed, this.seedText, this.mode, null),
      onSettings: (s) => this.applySettings(s),
      onUiSound: () => {
        this.sfx.unlock();
        this.sfx.click();
      },
    });
    this.ui.setFps(this.settings.showFps ? '' : null);

    this.input.onLockChange((locked) => {
      if (locked && (this.state === 'menu' || this.state === 'inventory')) this.enterPlaying();
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
    else this.newWorld('', 'survival');
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
    this.renderer.particles.clear();
    this.waterQueue = [];
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
    this.player.yaw = valid ? p.yaw : Math.PI * 0.75;
    this.player.pitch = valid ? p.pitch : -0.12;
    this.player.flying = !!(valid && p.flying && mode === 'creative');
    this.player.vx = this.player.vy = this.player.vz = 0;

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
      this.ui.showItemName(s ? blockDef(s.id).name : '');
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
      },
      inventory: this.inventory.serialize(),
      edits: editsToRecord(this.world.edits),
    };
    const ok = writeSave(data);
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
    if (this.titleSpin !== 0) {
      this.player.yaw += this.titleSpin;
      this.titleSpin = 0;
    }
    this.state = 'playing';
    this.titleMode = false;
    this.ui.hideMenu();
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.ui.setHudVisible(true);
    this.ui.setCrosshairVisible(true);
    this.mining = null;
  }

  private pause(): void {
    this.state = 'menu';
    this.mining = null;
    this.ui.showMenu('pause', this.worldInfo());
    this.save();
  }

  private openInventory(): void {
    this.state = 'inventory';
    this.mining = null;
    this.ui.setCrosshairVisible(false);
    this.ui.openInventory(this.inventory);
    this.input.exitLock();
  }

  private closeInventory(): void {
    this.ui.closeInventory();
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
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
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
        this.player.update(dt, { forward, strafe, jump: k.has('Space'), down: shift, sprint: shift && !this.player.flying }, this.mode === 'creative');
      }
      this.footsteps();
    } else if (this.state === 'menu' && !this.ui.inventoryOpen && this.menuIsTitle()) {
      this.titleSpin += dt * 0.035;
    }

    this.updateCamera(dt);

    const cam = this.renderer.camera;
    cam.getWorldDirection(this.camDir);
    const budget = this.state === 'loading' ? 14 : 5;
    this.chunks.update(cam.position.x, cam.position.z, this.camDir.x, this.camDir.z, budget);
    this.processWater();

    if (this.state === 'loading') this.updateLoading();

    this.updateTarget();
    if (this.state === 'playing') this.handleActions(dt);
    const m = this.mining;
    const t = this.target;
    const progress = m && t && m.x === t.x && m.y === t.y && m.z === t.z ? m.progress : 0;
    const showOutline = t && (this.state === 'playing' || this.state === 'inventory');
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
    const yaw = p.yaw + this.titleSpin;
    cam.position.set(p.x + Math.cos(yaw) * bobX, p.y + EYE_HEIGHT + bobY, p.z - Math.sin(yaw) * bobX);
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
  }

  private handleKeys(): void {
    const pressed = this.input.pressed;
    if (pressed.size === 0 && this.input.wheel === 0) return;
    if (pressed.has('F3')) {
      this.debug = !this.debug;
      if (!this.debug) this.ui.setDebug(null);
    }
    if (this.state === 'playing') {
      for (let i = 1; i <= 9; i++) if (pressed.has(`Digit${i}`) || pressed.has(`Numpad${i}`)) this.inventory.select(i - 1);
      if (this.input.wheel !== 0) this.inventory.select(this.inventory.selected + this.input.wheel);
      if (pressed.has('KeyE')) {
        this.openInventory();
        return;
      }
      if (pressed.has('Escape') && this.input.forceLocked) {
        this.pause();
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
    } else if (this.state === 'inventory') {
      if (pressed.has('KeyE') || pressed.has('Escape')) {
        this.closeInventory();
        return;
      }
      for (let i = 1; i <= 9; i++) if (pressed.has(`Digit${i}`)) this.ui.inventoryHotkey(i - 1);
    }
  }

  private toggleFly(): void {
    this.player.flying = !this.player.flying;
    if (this.player.flying) this.player.vy = 0;
    this.ui.toast(this.player.flying ? 'Flying: Space up, Shift down' : 'Flying off', 1400);
  }

  // ------------------------------------------------------------------ mining & placing

  private breakTime(id: number): number {
    const h = blockDef(id).hardness;
    if (!Number.isFinite(h)) return Infinity;
    return this.mode === 'creative' ? 0.18 : Math.max(0.05, h);
  }

  private handleActions(dt: number): void {
    const input = this.input;

    // Mining: a click breaks the targeted block immediately; holding keeps digging,
    // each further block taking its break time (shown by the crack overlay).
    if (input.leftPressed) {
      if (this.target) this.breakTarget();
      this.mining = null;
    } else if (input.leftDown && this.target) {
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

    if (input.rightPressed) {
      this.placeOnTarget();
      this.placeTimer = 0.3;
    } else if (input.rightDown) {
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
    if (!this.world.setBlock(x, y, z, B.AIR)) return false;
    this.collect(def.drop);
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
    if (this.inventory.add(id, 1) > 0) this.ui.toast('Inventory full', 1200);
  }

  /** Places the selected block against the face of `this.target` hit by the ray. */
  placeOnTarget(): boolean {
    const t = this.target;
    const stack = this.inventory.selectedStack;
    if (!t || !stack) return false;
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
    if (!this.world.setBlock(tx, ty, tz, stack.id)) return false;
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

  // ------------------------------------------------------------------ water

  private queueWaterIfAdjacent(x: number, y: number, z: number): void {
    const w = this.world;
    const wet =
      w.getBlock(x, y + 1, z) === B.WATER ||
      w.getBlock(x + 1, y, z) === B.WATER ||
      w.getBlock(x - 1, y, z) === B.WATER ||
      w.getBlock(x, y, z + 1) === B.WATER ||
      w.getBlock(x, y, z - 1) === B.WATER;
    if (wet) this.waterQueue.push({ x, y, z, ox: x, oz: z, budget: 40, at: this.time + 0.3 });
  }

  /** Simple bounded water flow: fills opened cells, falls first, then spreads a few blocks. */
  private processWater(): void {
    if (this.waterQueue.length === 0) return;
    const w = this.world;
    const next: WaterTask[] = [];
    let changed = false;
    let processed = 0;
    for (const task of this.waterQueue) {
      if (task.at > this.time || processed > 48) {
        next.push(task);
        continue;
      }
      processed++;
      const cur = w.getBlock(task.x, task.y, task.z);
      if (cur !== B.AIR && !(IS_REPLACEABLE[cur] && cur !== B.WATER)) continue;
      if (!w.setBlock(task.x, task.y, task.z, B.WATER)) continue;
      changed = true;
      if (task.budget <= 0) continue;
      const below = w.getBlock(task.x, task.y - 1, task.z);
      const push = (x: number, y: number, z: number) => {
        const b = w.getBlock(x, y, z);
        if (b === B.AIR || (IS_REPLACEABLE[b] && b !== B.WATER)) {
          next.push({ x, y, z, ox: task.ox, oz: task.oz, budget: task.budget - 1, at: this.time + 0.25 });
        }
      };
      if (below === B.AIR || (IS_REPLACEABLE[below] && below !== B.WATER)) {
        push(task.x, task.y - 1, task.z);
      } else if (task.y <= SEA_LEVEL + 8) {
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = task.x + dx;
          const nz = task.z + dz;
          if (Math.abs(nx - task.ox) + Math.abs(nz - task.oz) > 5) continue;
          push(nx, task.y, nz);
        }
      }
    }
    this.waterQueue = next;
    if (changed) {
      this.chunks.flushUrgent();
      this.saveDirty = true;
    }
  }

  // ------------------------------------------------------------------ feedback

  private footsteps(): void {
    const p = this.player;
    if (p.inWater && !this.wasInWater && p.vy < -3) this.sfx.splash();
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
    const underwater = this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z)) === B.WATER;
    this.renderer.particles.update(dt);
    this.renderer.render(this.time, underwater, this.state === 'playing');
    this.ui.setUnderwater(underwater && !this.renderer.postActive);
    this.ui.setBadge(this.mode, this.player.flying);
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
