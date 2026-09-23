import { blockDef, PALETTE } from '../world/blocks';
import { HOTBAR_SIZE, INVENTORY_SIZE, MAX_STACK, type GameMode, type Inventory, type Stack } from '../game/Inventory';
import { PRESETS, type Preset, type Settings } from '../game/settings';
import { clear, h } from './dom';

export interface UICallbacks {
  onPlay(): void;
  onNewWorld(seedText: string, mode: GameMode): void;
  onResetWorld(): void;
  onSettings(s: Settings): void;
  onUiSound(): void;
}

export interface WorldInfo {
  seedText: string;
  mode: GameMode;
}

type MenuView = 'main' | 'settings' | 'controls' | 'newworld' | 'reset';

const CONTROLS: [string, string][] = [
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Move'],
  ['<kbd>Space</kbd>', 'Jump / swim up (hold to fly up in Creative)'],
  ['<kbd>Shift</kbd>', 'Sprint (fly down in Creative)'],
  ['Mouse', 'Look around'],
  ['Left click / hold', 'Mine the outlined block (reach 4.5 blocks)'],
  ['Right click', 'Place the selected block on the outlined face'],
  ['Middle click', 'Pick the targeted block'],
  ['<kbd>1</kbd>–<kbd>9</kbd> / wheel', 'Select hotbar slot'],
  ['<kbd>E</kbd>', 'Open / close inventory'],
  ['<kbd>F</kbd> or double <kbd>Space</kbd>', 'Toggle flying (Creative)'],
  ['<kbd>F3</kbd>', 'Debug overlay'],
  ['<kbd>Esc</kbd>', 'Release the mouse / pause'],
];

/** All HTML UI: HUD, menus, settings, inventory and messages. */
export class UI {
  private hud: HTMLDivElement;
  private hotbarEl: HTMLDivElement;
  private hotbarSlots: HTMLDivElement[] = [];
  private itemName: HTMLDivElement;
  private badge: HTMLDivElement;
  private hint: HTMLDivElement;
  private debugEl: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private waterEl: HTMLDivElement;
  private loading: HTMLDivElement;
  private loadingBar: HTMLDivElement;
  private loadingStatus: HTMLDivElement;
  private menu: HTMLDivElement;
  private menuPanel: HTMLDivElement;
  private invScreen: HTMLDivElement;
  private invPanel: HTMLDivElement;
  private cursorEl: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private fatal: HTMLDivElement;
  private itemNameTimer = 0;
  private toastTimer = 0;
  private menuKind: 'title' | 'pause' = 'title';
  private menuView: MenuView = 'main';
  private world: WorldInfo = { seedText: '', mode: 'survival' };
  private lockNote = '';
  private inv: Inventory | null = null;
  private cursor: Stack | null = null;
  private hovered = -1;

  constructor(
    root: HTMLElement,
    private icons: Map<number, string>,
    private settings: Settings,
    private postSupported: boolean,
    private cb: UICallbacks,
  ) {
    this.crosshairEl = h('div', { class: 'crosshair' });
    this.hotbarEl = h('div', { class: 'hotbar' });
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = h('div', { class: 'slot' }, h('span', { class: 'key' }, String(i + 1)));
      this.hotbarSlots.push(s);
      this.hotbarEl.append(s);
    }
    this.itemName = h('div', { class: 'item-name' });
    this.badge = h('div', { class: 'badge' });
    this.hint = h('div', {
      class: 'hint',
      html:
        '<kbd>WASD</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>E</kbd> inventory<br>' +
        '<b>Left</b> mine &nbsp; <b>Right</b> place &nbsp; <kbd>1-9</kbd>/wheel select &nbsp; <kbd>Esc</kbd> menu',
    });
    this.debugEl = h('div', { class: 'debug hidden' });
    this.fpsEl = h('div', { class: 'fps hidden' });
    this.waterEl = h('div', { class: 'vignette-water hidden' });
    this.hud = h('div', { class: 'hud hidden' }, this.waterEl, this.crosshairEl, this.hotbarEl, this.itemName, this.badge, this.hint, this.debugEl, this.fpsEl);
    this.toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });

    this.loadingBar = h('div');
    this.loadingStatus = h('div', { class: 'status' }, 'Starting…');
    this.loading = h(
      'div',
      { class: 'screen loading-screen' },
      h('div', { class: 'panel' }, h('h1', { class: 'logo' }, 'MINEMINE'), h('p', { class: 'tagline' }, 'Generating world'), h('div', { class: 'progress' }, this.loadingBar), this.loadingStatus),
    );

    this.menuPanel = h('div', { class: 'panel' });
    this.menu = h('div', { class: 'screen dim hidden' }, this.menuPanel);

    this.invPanel = h('div', { class: 'panel inventory-panel' });
    this.invScreen = h('div', { class: 'screen dim hidden', oncontextmenu: (e: Event) => e.preventDefault() }, this.invPanel);
    this.cursorEl = h('div', { class: 'cursor-stack hidden' });
    this.tooltip = h('div', { class: 'tooltip hidden' });
    this.fatal = h('div', { class: 'screen fatal hidden' });

    root.append(this.hud, this.menu, this.invScreen, this.loading, this.toastEl, this.cursorEl, this.tooltip, this.fatal);

    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
      this.tooltip.style.left = `${e.clientX + 16}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
    });
  }

  private crosshairEl: HTMLDivElement;

  // ---------------------------------------------------------------- HUD

  setHudVisible(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  setCrosshairVisible(v: boolean): void {
    this.crosshairEl.classList.toggle('hidden', !v);
  }

  setUnderwater(v: boolean): void {
    this.waterEl.classList.toggle('hidden', !v);
  }

  renderHotbar(inv: Inventory): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.hotbarSlots[i];
      this.fillSlot(el, inv.slots[i], inv.mode === 'creative');
      el.classList.toggle('selected', i === inv.selected);
      el.prepend(h('span', { class: 'key' }, String(i + 1)));
    }
  }

  private fillSlot(el: HTMLElement, stack: Stack | null, hideCount: boolean): void {
    clear(el);
    if (!stack) return;
    const icon = this.icons.get(stack.id);
    if (icon) el.append(h('img', { src: icon, alt: blockDef(stack.id).name, draggable: 'false' }));
    if (!hideCount && stack.count > 1) el.append(h('span', { class: 'count' }, String(stack.count)));
  }

  showItemName(name: string): void {
    this.itemName.textContent = name;
    this.itemName.classList.toggle('show', !!name);
    window.clearTimeout(this.itemNameTimer);
    if (name) this.itemNameTimer = window.setTimeout(() => this.itemName.classList.remove('show'), 1800);
  }

  setBadge(mode: GameMode, flying: boolean): void {
    const text = `${mode === 'creative' ? 'Creative' : 'Survival'}${flying ? ' · Flying' : ''}`;
    if (this.badge.dataset.text === text) return;
    this.badge.dataset.text = text;
    clear(this.badge);
    this.badge.append(h('b', {}, text), h('span', {}, 'Reach 4.5'));
  }

  setHintVisible(v: boolean): void {
    this.hint.style.opacity = v ? '1' : '0';
  }

  setDebug(text: string | null): void {
    this.debugEl.classList.toggle('hidden', text === null);
    if (text !== null) this.debugEl.textContent = text;
    this.fpsEl.style.top = text === null ? '10px' : '-100px';
  }

  setFps(text: string | null): void {
    this.fpsEl.classList.toggle('hidden', text === null);
    if (text !== null) this.fpsEl.textContent = text;
  }

  toast(msg: string, ms = 2600): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- loading / fatal

  showLoading(progress: number, status: string): void {
    this.loading.classList.remove('hidden');
    this.loadingBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    this.loadingStatus.textContent = status;
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  showFatal(title: string, message: string): void {
    clear(this.fatal);
    this.fatal.append(
      h(
        'div',
        { class: 'panel' },
        h('h1', { class: 'logo' }, 'MINEMINE'),
        h('h2', {}, title),
        h('p', {}, message),
        h('div', { class: 'footer' }, h('button', { onclick: () => location.reload() }, 'Reload')),
      ),
    );
    this.fatal.classList.remove('hidden');
    this.loading.classList.add('hidden');
    this.menu.classList.add('hidden');
  }

  // ---------------------------------------------------------------- menu

  get menuOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  showMenu(kind: 'title' | 'pause', world: WorldInfo, view: MenuView = 'main'): void {
    this.menuKind = kind;
    this.world = world;
    this.menuView = view;
    this.lockNote = '';
    this.menu.classList.remove('hidden');
    this.renderMenu();
  }

  hideMenu(): void {
    this.menu.classList.add('hidden');
  }

  setLockNote(note: string): void {
    this.lockNote = note;
    if (this.menuOpen && this.menuView === 'main') this.renderMenu();
  }

  private go(view: MenuView): void {
    this.cb.onUiSound();
    this.menuView = view;
    this.renderMenu();
  }

  private renderMenu(): void {
    clear(this.menuPanel);
    this.menuPanel.className = this.menuView === 'settings' || this.menuView === 'controls' ? 'panel wide' : 'panel';
    switch (this.menuView) {
      case 'main':
        return this.renderMain();
      case 'settings':
        return this.renderSettings();
      case 'controls':
        return this.renderControls();
      case 'newworld':
        return this.renderNewWorld();
      case 'reset':
        return this.renderReset();
    }
  }

  private renderMain(): void {
    const isTitle = this.menuKind === 'title';
    this.menuPanel.append(
      h('h1', { class: 'logo' }, 'MINEMINE'),
      h('p', { class: 'tagline' }, isTitle ? 'A voxel sandbox. Dig, build, explore.' : 'Game paused'),
      h(
        'div',
        { class: 'world-info' },
        h('span', {}, 'Seed ', h('b', {}, this.world.seedText)),
        h('span', {}, 'Mode ', h('b', {}, this.world.mode === 'creative' ? 'Creative' : 'Survival')),
      ),
      h(
        'div',
        { class: 'stack' },
        h('button', { class: 'primary', id: 'play-btn', onclick: () => this.cb.onPlay() }, isTitle ? 'Play' : 'Resume'),
        h('div', { class: 'row' }, h('button', { onclick: () => this.go('settings') }, 'Settings'), h('button', { onclick: () => this.go('controls') }, 'Controls')),
        h('div', { class: 'row' }, h('button', { onclick: () => this.go('newworld') }, 'New world'), h('button', { class: 'danger', onclick: () => this.go('reset') }, 'Reset world')),
      ),
      h('div', { class: this.lockNote ? 'lock-note' : 'hidden' }, this.lockNote),
      h('p', { class: 'status' }, 'Your world saves automatically in this browser.'),
    );
  }

  private renderControls(): void {
    const grid = h('div', { class: 'controls' });
    for (const [k, v] of CONTROLS) grid.append(h('div', { html: k }), h('div', {}, v));
    this.menuPanel.append(
      h('h2', {}, 'Controls'),
      grid,
      h('p', { class: 'status' }, 'Mining and placing always use the block shown by the outline under the crosshair. You cannot place a block inside yourself.'),
      h('div', { class: 'footer' }, h('button', { onclick: () => this.go('main') }, 'Back')),
    );
  }

  private renderNewWorld(): void {
    let mode: GameMode = this.world.mode;
    const input = h('input', { type: 'text', placeholder: 'Leave empty for a random seed', maxlength: '32', spellcheck: 'false', autocomplete: 'off' });
    const seg = h('div', { class: 'seg' });
    const desc = h('p', { class: 'status' });
    const renderSeg = () => {
      clear(seg);
      for (const m of ['survival', 'creative'] as GameMode[]) {
        seg.append(
          h(
            'button',
            {
              class: m === mode ? 'on' : '',
              onclick: () => {
                mode = m;
                renderSeg();
              },
            },
            m === 'survival' ? 'Survival' : 'Creative',
          ),
        );
      }
      desc.textContent =
        mode === 'survival'
          ? 'Collect what you mine, build with a limited inventory. Harder blocks take longer to break.'
          : 'Unlimited blocks, instant mining and flying.';
    };
    renderSeg();
    const create = () => {
      this.cb.onUiSound();
      this.cb.onNewWorld(input.value, mode);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') create();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    this.menuPanel.append(
      h('h2', {}, 'Create a new world'),
      h('div', { class: 'stack' }, h('label', { class: 'field' }, 'World seed', input), h('div', { class: 'field label-like', role: 'group', 'aria-labelledby': 'mode-label' }, h('span', { id: 'mode-label' }, 'Game mode'), seg), desc),
      h('p', { class: 'note' }, 'This replaces the current world and its saved changes.'),
      h('div', { class: 'footer' }, h('button', { onclick: () => this.go('main') }, 'Cancel'), h('button', { class: 'primary', onclick: create }, 'Create world')),
    );
    setTimeout(() => input.focus(), 0);
  }

  private renderReset(): void {
    this.menuPanel.append(
      h('h2', {}, 'Reset this world?'),
      h('p', { class: 'status', style: 'text-align:left' }, `All blocks you placed or mined in seed "${this.world.seedText}" will be restored to the original terrain, and you return to spawn with a fresh inventory.`),
      h(
        'div',
        { class: 'footer' },
        h('button', { onclick: () => this.go('main') }, 'Cancel'),
        h(
          'button',
          {
            class: 'danger',
            onclick: () => {
              this.cb.onUiSound();
              this.cb.onResetWorld();
            },
          },
          'Reset world',
        ),
      ),
    );
  }

  private renderSettings(): void {
    const s = this.settings;
    const apply = (graphics: boolean) => {
      if (graphics) s.preset = 'custom';
      this.cb.onSettings(s);
      this.renderMenu();
    };
    const seg = <T extends string | boolean>(label: string, sub: string | null, options: [T, string][], get: () => T, set: (v: T) => void, graphics: boolean, disabled = false) => {
      const wrap = h('div', { class: 'seg' });
      for (const [v, text] of options) {
        wrap.append(
          h(
            'button',
            {
              class: get() === v ? 'on' : '',
              disabled,
              onclick: () => {
                set(v);
                this.cb.onUiSound();
                apply(graphics);
              },
            },
            text,
          ),
        );
      }
      return h('div', { class: 'setting' }, h('div', { class: 'label' }, label, sub ? h('small', {}, sub) : null), h('div', { class: 'ctrl' }, wrap));
    };
    const slider = (label: string, sub: string | null, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, graphics: boolean) => {
      const val = h('span', { class: 'val' }, fmt(get()));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = fmt(Number(input.value));
      });
      input.addEventListener('change', () => apply(graphics));
      return h('div', { class: 'setting' }, h('div', { class: 'label' }, label, sub ? h('small', {}, sub) : null), h('div', { class: 'ctrl' }, input, val));
    };
    const onOff: [boolean, string][] = [
      [false, 'Off'],
      [true, 'On'],
    ];
    const needsPost = !s.postprocessing || !this.postSupported;

    const presetWrap = h('div', { class: 'seg' });
    for (const p of ['low', 'medium', 'high', 'ultra'] as Exclude<Preset, 'custom'>[]) {
      presetWrap.append(
        h(
          'button',
          {
            class: s.preset === p ? 'on' : '',
            onclick: () => {
              Object.assign(s, PRESETS[p]);
              s.preset = p;
              if (!this.postSupported) s.postprocessing = false;
              this.cb.onUiSound();
              this.cb.onSettings(s);
              this.renderMenu();
            },
          },
          p[0].toUpperCase() + p.slice(1),
        ),
      );
    }

    this.menuPanel.append(
      h('h2', {}, 'Settings'),
      h('div', { class: 'section-title' }, 'Graphics'),
      h(
        'div',
        { class: 'settings' },
        h('div', { class: 'setting' }, h('div', { class: 'label' }, 'Quality preset', h('small', {}, s.preset === 'custom' ? 'Custom' : 'Low is best for slower devices')), h('div', { class: 'ctrl' }, presetWrap)),
        slider('Render distance', null, 2, 16, 1, () => s.renderDistance, (v) => (s.renderDistance = v), (v) => `${v} ch`, true),
        slider('Resolution', 'Render scale', 40, 100, 5, () => Math.round(s.resolutionScale * 100), (v) => (s.resolutionScale = v / 100), (v) => `${v}%`, true),
        seg('Shadows', 'Soft sun shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], () => s.shadows, (v) => (s.shadows = v), true),
        seg('Post-processing', this.postSupported ? 'Tone mapping, grading' : 'Not supported by this GPU', onOff, () => s.postprocessing && this.postSupported, (v) => (s.postprocessing = v), true, !this.postSupported),
        seg('Ambient occlusion', needsPost ? 'Needs post-processing' : 'Screen-space (SSAO)', onOff, () => s.ssao, (v) => (s.ssao = v), true, needsPost),
        seg('Bloom', needsPost ? 'Needs post-processing' : 'Glow around bright light', onOff, () => s.bloom, (v) => (s.bloom = v), true, needsPost),
        seg('Anti-aliasing', needsPost ? 'Needs post-processing' : 'MSAA 4x', onOff, () => s.antialias, (v) => (s.antialias = v), true, needsPost),
        seg('Wind & water motion', null, onOff, () => s.animation, (v) => (s.animation = v), true),
        seg('Clouds', null, onOff, () => s.clouds, (v) => (s.clouds = v), true),
      ),
      h('p', { class: 'status', style: 'text-align:left' }, 'Blocks always keep baked corner shading, so the world still reads clearly with every effect switched off.'),
      h('div', { class: 'section-title' }, 'Controls & display'),
      h(
        'div',
        { class: 'settings' },
        slider('Field of view', null, 50, 110, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v}°`, false),
        slider('Mouse sensitivity', null, 10, 300, 5, () => Math.round(s.sensitivity * 100), (v) => (s.sensitivity = v / 100), (v) => `${v}%`, false),
        seg('Invert mouse Y', null, onOff, () => s.invertY, (v) => (s.invertY = v), false),
        seg('View bobbing', null, onOff, () => s.viewBobbing, (v) => (s.viewBobbing = v), false),
        slider('Volume', null, 0, 100, 5, () => Math.round(s.volume * 100), (v) => (s.volume = v / 100), (v) => `${v}%`, false),
        seg('FPS counter', null, onOff, () => s.showFps, (v) => (s.showFps = v), false),
      ),
      h('div', { class: 'footer' }, h('button', { class: 'primary', onclick: () => this.go('main') }, 'Done')),
    );
  }

  // ---------------------------------------------------------------- inventory

  get inventoryOpen(): boolean {
    return !this.invScreen.classList.contains('hidden');
  }

  openInventory(inv: Inventory): void {
    this.inv = inv;
    this.cursor = null;
    this.hovered = -1;
    this.invScreen.classList.remove('hidden');
    this.renderInventory();
  }

  /** Closes the inventory, returning anything held on the cursor. */
  closeInventory(): void {
    if (this.inv && this.cursor) {
      if (this.inv.mode === 'survival') this.inv.add(this.cursor.id, this.cursor.count);
      this.cursor = null;
    }
    this.invScreen.classList.add('hidden');
    this.cursorEl.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.inv?.changed();
  }

  /** Number key while hovering a slot: swap that slot with the hotbar slot. */
  inventoryHotkey(n: number): void {
    const inv = this.inv;
    if (!inv || this.hovered < 0) return;
    if (this.hovered >= 1000) {
      const id = PALETTE[this.hovered - 1000];
      inv.slots[n] = { id, count: MAX_STACK };
    } else if (this.hovered !== n) {
      const tmp = inv.slots[n];
      inv.slots[n] = inv.slots[this.hovered];
      inv.slots[this.hovered] = tmp;
    }
    inv.changed();
    this.renderInventory();
  }

  private slotEl(index: number, stack: Stack | null, hideCount: boolean, onDown: (e: MouseEvent) => void, name: () => string | null): HTMLDivElement {
    const el = h('div', { class: 'slot' });
    this.fillSlot(el, stack, hideCount);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDown(e);
      this.cb.onUiSound();
    });
    el.addEventListener('mouseenter', () => {
      this.hovered = index;
      const n = name();
      this.tooltip.textContent = n ?? '';
      this.tooltip.classList.toggle('hidden', !n || !!this.cursor);
    });
    el.addEventListener('mouseleave', () => {
      if (this.hovered === index) this.hovered = -1;
      this.tooltip.classList.add('hidden');
    });
    return el;
  }

  private clickSlot(i: number, e: MouseEvent): void {
    const inv = this.inv!;
    const slot = inv.slots[i];
    const creative = inv.mode === 'creative';
    if (e.shiftKey && e.button === 0) {
      if (!slot) return;
      const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      if (creative && i < HOTBAR_SIZE) {
        inv.slots[i] = null;
      } else {
        let left = slot.count;
        for (let k = range[0]; k < range[1] && left > 0; k++) {
          const t = inv.slots[k];
          if (t && t.id === slot.id && t.count < MAX_STACK) {
            const n = Math.min(left, MAX_STACK - t.count);
            t.count += n;
            left -= n;
          }
        }
        for (let k = range[0]; k < range[1] && left > 0; k++) {
          if (!inv.slots[k]) {
            inv.slots[k] = { id: slot.id, count: left };
            left = 0;
          }
        }
        inv.slots[i] = left > 0 ? { id: slot.id, count: left } : null;
      }
    } else if (e.button === 0) {
      if (!this.cursor) {
        this.cursor = slot;
        inv.slots[i] = null;
      } else if (!slot) {
        inv.slots[i] = this.cursor;
        this.cursor = null;
      } else if (slot.id === this.cursor.id) {
        const n = Math.min(this.cursor.count, MAX_STACK - slot.count);
        slot.count += n;
        this.cursor.count -= n;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        inv.slots[i] = this.cursor;
        this.cursor = slot;
      }
    } else if (e.button === 2) {
      if (!this.cursor) {
        if (slot) {
          const half = Math.ceil(slot.count / 2);
          this.cursor = { id: slot.id, count: half };
          slot.count -= half;
          if (slot.count <= 0) inv.slots[i] = null;
        }
      } else if (!slot) {
        inv.slots[i] = { id: this.cursor.id, count: 1 };
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (slot.id === this.cursor.id && slot.count < MAX_STACK) {
        slot.count++;
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        inv.slots[i] = this.cursor;
        this.cursor = slot;
      }
    }
    inv.changed();
    this.renderInventory();
  }

  private clickPalette(id: number, e: MouseEvent): void {
    const inv = this.inv!;
    if (this.cursor) {
      // Clicking the palette with an item deletes it (creative only).
      this.cursor = null;
    } else if (e.shiftKey) {
      let target = inv.slots.findIndex((s, k) => k < HOTBAR_SIZE && !s);
      if (target < 0) target = inv.selected;
      inv.slots[target] = { id, count: MAX_STACK };
      inv.changed();
    } else {
      this.cursor = { id, count: e.button === 2 ? 1 : MAX_STACK };
    }
    this.renderInventory();
  }

  private renderInventory(): void {
    const inv = this.inv;
    if (!inv) return;
    const creative = inv.mode === 'creative';
    clear(this.invPanel);
    const name = (i: number) => () => (inv.slots[i] ? blockDef(inv.slots[i]!.id).name : null);
    const main = h('div', { class: 'inv-grid' });
    if (creative) {
      PALETTE.forEach((id, k) => {
        main.append(this.slotEl(1000 + k, { id, count: 1 }, true, (e) => this.clickPalette(id, e), () => blockDef(id).name));
      });
    } else {
      for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
        main.append(this.slotEl(i, inv.slots[i], false, (e) => this.clickSlot(i, e), name(i)));
      }
    }
    const bar = h('div', { class: 'inv-grid' });
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.slotEl(i, inv.slots[i], creative, (e) => this.clickSlot(i, e), name(i));
      if (i === inv.selected) el.classList.add('active');
      bar.append(el);
    }
    this.invPanel.append(
      h('h2', {}, creative ? 'Creative inventory' : 'Inventory'),
      main,
      h('div', { class: 'inv-sep' }),
      bar,
      h(
        'div',
        { class: 'inv-help' },
        creative
          ? 'Click a block to pick it up, then click a hotbar slot. Shift-click adds it to the hotbar. Hover + 1–9 assigns a slot.'
          : 'Click to pick up / place a stack. Right-click splits or places one. Shift-click moves between hotbar and backpack. Hover + 1–9 swaps with the hotbar.',
        h('br'),
        'Press E or Esc to close.',
      ),
    );
    this.renderCursor();
  }

  private renderCursor(): void {
    const c = this.cursor;
    this.cursorEl.classList.toggle('hidden', !c);
    clear(this.cursorEl);
    if (!c) return;
    this.tooltip.classList.add('hidden');
    this.cursorEl.append(h('img', { src: this.icons.get(c.id) ?? '', alt: '' }));
    if (this.inv?.mode !== 'creative' && c.count > 1) this.cursorEl.append(h('span', { class: 'count' }, String(c.count)));
  }
}
