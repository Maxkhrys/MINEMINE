import { B, PALETTE } from '../world/blocks';
import { I, ITEMS, RECIPES, foodOf, itemName, maxStackOf, toolOf, type Recipe, type Station } from '../game/items';
import { HOTBAR_SIZE, INVENTORY_SIZE, type GameMode, type Inventory, type Stack } from '../game/Inventory';
import { PRESETS, type Preset, type Settings } from '../game/settings';
import { clear, h } from './dom';

export interface UICallbacks {
  onAdventure?(kind:'backpack'|'equipment'|'journal'|'furnace'):void;
  onPlay(): void;
  onCloseInventory(): void;
  onNewWorld(seedText: string, mode: GameMode): void;
  onResetWorld(): void;
  onSettings(s: Settings): void;
  onUiSound(): void;
  onCraft?(): void;
  onRespawn?(): void;
}

/** Everything the creative palette offers: blocks, then tools, materials and food. */
const CREATIVE_PALETTE = [...PALETTE, ...ITEMS.keys()];

export interface WorldInfo {
  seedText: string;
  mode: GameMode;
}

type MenuView = 'main' | 'settings' | 'controls' | 'newworld' | 'reset';

const CONTROLS: [string, string][] = [
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Move'],
  ['<kbd>Space</kbd>', 'Jump / swim up (hold to fly up in Creative)'],
  ['<kbd>Shift</kbd>', 'Sprint (fly down in Creative)'],
  ['<kbd>C</kbd>', 'Sneak safely along edges'],
  ['<kbd>F1</kbd>', 'Clean video view: hide HUD and hand'],
  ['<kbd>L</kbd>', 'Day / golden hour / moonlight (Creative)'],
  ['<kbd>V</kbd>', 'Cycle five showcase viewpoints (Hearthvale Creative)'],
  ['Mouse', 'Look around'],
  ['Left click / hold', 'Mine the outlined block (reach 4.5 blocks)'],
  ['Right click', 'Place the selected block on the outlined face, eat food, or use a crafting table / furnace'],
  ['Left click an animal', 'Attack (swords hit harder); animals drop food'],
  ['Middle click', 'Pick the targeted block'],
  ['<kbd>1</kbd>–<kbd>9</kbd> / wheel', 'Select hotbar slot'],
  ['<kbd>E</kbd>', 'Open / close inventory'],
  ['<kbd>B</kbd> / <kbd>O</kbd> / <kbd>J</kbd>', 'Backpack / equipment / adventure journal'],
  ['<kbd>R</kbd> / <kbd>Q</kbd>', 'Hold shield / drop one item'],
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
  private vitals: HTMLDivElement;
  private heartsEl: HTMLDivElement;
  private foodEl: HTMLDivElement;
  private airEl: HTMLDivElement;
  private hurtEl: HTMLDivElement;
  private deathEl: HTMLDivElement;
  private vitalsKey = '';
  private stations = new Set<Station>(['hand']);
  private itemNameTimer = 0;
  private toastTimer = 0;
  private menuKind: 'title' | 'pause' = 'title';
  private menuView: MenuView = 'main';
  private world: WorldInfo = { seedText: '', mode: 'survival' };
  private lockNote = '';
  private inv: Inventory | null = null;
  private cursor: Stack | null = null;
  private hovered = -1;
  private search = '';
  private category = 'All';
  private recipeSearch = '';
  private recipeStation: Station = 'hand';
  private craftableOnly = false;
  private selectedRecipe = RECIPES[0];
  private targetEl = h('div', { class: 'target-info hidden' });
  private targetKey = '';
  private navigationEl = h('div', { class: 'navigation' });
  private navigationKey = '';
  private pickupsEl = h('div', { class: 'pickups', 'aria-live': 'polite' });
  private pickups = new Map<number, { count: number; timer: number; el: HTMLElement }>();
  private saved = true;
  private lastFocus: HTMLElement | null = null;


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
    this.heartsEl = h('div', { class: 'bar hearts' });
    this.foodEl = h('div', { class: 'bar food' });
    this.airEl = h('div', { class: 'bar air' });
    this.vitals = h('div', { class: 'vitals' }, h('div', { class: 'vitals-row' }, this.heartsEl, this.foodEl), this.airEl);
    this.hurtEl = h('div', { class: 'hurt-flash' });
    this.hud = h('div', { class: 'hud hidden' }, this.hurtEl, this.vitals, this.waterEl, this.crosshairEl, this.hotbarEl, this.itemName, this.badge, this.hint, this.debugEl, this.fpsEl, this.targetEl, this.navigationEl, this.pickupsEl);
    this.toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });

    this.loadingBar = h('div');
    this.loadingStatus = h('div', { class: 'status' }, 'Starting…');
    this.loading = h(
      'div',
      { class: 'screen loading-screen' },
      h('div', { class: 'panel loading-panel' }, h('div', { class: 'eyebrow' }, 'A WORLD OF YOUR OWN'), h('h1', { class: 'logo' }, 'MINEMINE'), h('p', { class: 'tagline' }, 'Preparing your adventure'), h('div', { class: 'loading-block', 'aria-hidden': 'true' }, '▦'), h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'World loading', 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.loadingBar), this.loadingStatus, h('p', { class: 'loading-tip' }, 'BUILD SOMETHING GREAT', h('small', {}, 'Right-click a crafting table to unlock tools, building blocks and more.'))),
    );

    this.menuPanel = h('div', { class: 'panel' });
    this.menu = h('div', { class: 'screen dim menu-screen hidden', role: 'dialog', 'aria-label': 'Game menu', 'aria-modal': 'true' }, this.menuPanel);

    this.invPanel = h('div', { class: 'panel inventory-panel' });
    this.invScreen = h('div', { class: 'screen dim inventory-screen hidden', role: 'dialog', 'aria-label': 'Inventory and crafting', 'aria-modal': 'true', oncontextmenu: (e: Event) => e.preventDefault() }, this.invPanel);
    this.cursorEl = h('div', { class: 'cursor-stack hidden' });
    this.tooltip = h('div', { class: 'tooltip hidden' });
    this.fatal = h('div', { class: 'screen fatal hidden' });
    this.deathEl = h(
      'div',
      { class: 'screen death hidden' },
      h(
        'div',
        { class: 'panel' },
        h('h1', { class: 'death-title' }, 'You died'),
        h('p', { class: 'status death-cause' }, ''),
        h('div', { class: 'stack' }, h('button', { class: 'primary', id: 'respawn-btn', onclick: () => this.cb.onRespawn?.() }, 'Respawn')),
        h('p', { class: 'status' }, 'You keep your inventory and return to the world spawn.'),
      ),
    );

    root.append(this.hud, this.menu, this.invScreen, this.deathEl, this.loading, this.toastEl, this.cursorEl, this.tooltip, this.fatal);

    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
      this.tooltip.style.left = `${Math.max(8, Math.min(e.clientX + 16, innerWidth - this.tooltip.offsetWidth - 12))}px`;
      this.tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 14, innerHeight - this.tooltip.offsetHeight - 12))}px`;
    });
    // Keep keyboard navigation inside whichever dialog is open.
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const dialog = [this.fatal, this.loading, this.deathEl, this.invScreen, this.menu].find(el => !el.classList.contains('hidden'));
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || (!e.shiftKey && at === focusable.length - 1) || (e.shiftKey && at === 0)) {
        e.preventDefault(); focusable[e.shiftKey ? focusable.length - 1 : 0].focus();
      }
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

  setTarget(id: number, hint: string, progress: number): void {
    this.targetEl.classList.toggle('hidden', !id);
    const key = `${id}|${hint}`;
    if (key !== this.targetKey) {
      this.targetKey = key;
      clear(this.targetEl);
      if (id) this.targetEl.append(h('img', { src: this.icons.get(id) ?? '', alt: '' }), h('div', {}, h('b', {}, itemName(id)), h('small', {}, hint)), h('div', { class: 'target-progress' }, h('span')));
    }
    const bar = this.targetEl.querySelector<HTMLElement>('.target-progress span');
    if (bar) bar.style.transform = `scaleX(${Math.min(1, progress)})`;
    this.crosshairEl.classList.toggle('mining', progress > 0);
  }

  setNavigation(x: number, y: number, z: number, yaw: number): void {
    const dirs = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
    const direction = dirs[((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8];
    const key = `${direction} / ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`;
    if (key === this.navigationKey) return;
    this.navigationKey = key;
    clear(this.navigationEl);
    this.navigationEl.append(h('b', {}, direction), h('span', {}, `${Math.floor(x)} / ${Math.floor(y)} / ${Math.floor(z)}`));
  }

  showPickup(id: number, count: number): void {
    const previous = this.pickups.get(id);
    if (previous) { clearTimeout(previous.timer); count += previous.count; previous.el.remove(); }
    const el = h('div', { class: 'pickup' }, h('img', { src: this.icons.get(id) ?? '', alt: '' }), h('span', {}, itemName(id)), h('b', {}, `+${count}`));
    this.pickupsEl.append(el);
    const timer = window.setTimeout(() => { el.remove(); this.pickups.delete(id); }, 2600);
    this.pickups.set(id, { count, timer, el });
    if (this.pickups.size > 4) {
      const [oldId, old] = this.pickups.entries().next().value!;
      clearTimeout(old.timer); old.el.remove(); this.pickups.delete(oldId);
    }
  }

  setSaved(ok: boolean): void {
    this.saved = ok;
    const el = this.menuPanel.querySelector('.save-status');
    if (el) el.textContent = ok ? '● Saved on this device' : 'Saving unavailable';
  }

  private fillSlot(el: HTMLElement, stack: Stack | null, hideCount: boolean): void {
    clear(el);
    if (!stack) return;
    const icon = this.icons.get(stack.id);
    if (icon) el.append(h('img', { src: icon, alt: itemName(stack.id), draggable: 'false' }));
    if (!hideCount && stack.count > 1) el.append(h('span', { class: 'count' }, String(stack.count)));
    const t = toolOf(stack.id);
    if (t && stack.dur !== undefined && stack.dur < t.durability) {
      const f = Math.max(0, stack.dur / t.durability);
      const bar = h('span', { class: 'dur' }, h('span', { style: `width:${Math.round(f * 100)}%;background:hsl(${Math.round(f * 120)},80%,50%)` }));
      el.append(bar);
    }
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

  /** Hearts, hunger and air bubbles. Pass show=false in creative mode. */
  setVitals(show: boolean, health: number, food: number, air: number, maxAir: number): void {
    const key = show ? `${Math.ceil(health)}|${Math.ceil(food)}|${Math.ceil(air)}` : 'off';
    if (key === this.vitalsKey) return;
    this.vitalsKey = key;
    this.vitals.classList.toggle('hidden', !show);
    if (!show) return;
    const icons = (el: HTMLElement, value: number, kind: string) => {
      clear(el);
      for (let i = 0; i < 10; i++) {
        const v = value - i * 2;
        el.append(h('i', { class: `${kind} ${v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty'}` }));
      }
    };
    icons(this.heartsEl, Math.ceil(health), 'heart');
    icons(this.foodEl, Math.ceil(food), 'drum');
    this.foodEl.classList.toggle('starving', food <= 0);
    this.heartsEl.classList.toggle('low', health <= 4);
    clear(this.airEl);
    if (air < maxAir) {
      const bubbles = Math.ceil((air / maxAir) * 10);
      for (let i = 0; i < 10; i++) this.airEl.append(h('i', { class: `bubble ${i < bubbles ? 'full' : 'empty'}` }));
    }
  }

  flashHurt(): void {
    this.hurtEl.classList.remove('on');
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('on');
  }

  showDeath(cause: string,info='Your inventory is safe.'): void {
    (this.deathEl.querySelector('.status') as HTMLElement).textContent=info;
    (this.deathEl.querySelector('.death-cause') as HTMLElement).textContent = cause;
    this.deathEl.classList.remove('hidden');
  }

  hideDeath(): void {
    this.deathEl.classList.add('hidden');
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
    const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    this.loadingBar.parentElement?.setAttribute('aria-valuenow', String(percent));
    this.loadingStatus.textContent = `${status} · ${percent}%`;
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
    this.menuPanel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
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
    this.menuPanel.scrollTop = 0;
    this.menuPanel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private renderMenu(): void {
    clear(this.menuPanel);
    this.menuPanel.className = this.menuView === 'main' ? 'main-menu' : this.menuView === 'settings' || this.menuView === 'controls' ? 'panel wide' : 'panel';
    this.menu.classList.toggle('main-view', this.menuView === 'main');
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
    const title = this.menuKind === 'title';
    this.menuPanel.append(
      h('header', { class: 'brand' }, h('div', { class: 'eyebrow' }, title ? 'MAKE YOURSELF AT HOME' : 'TAKE A BREATHER'), h('h1', { class: 'logo' }, 'MINEMINE'), h('p', { class: 'tagline' }, title ? 'A little world. Endless possibilities.' : 'Your adventure can wait.')),
      h('div', { class: 'menu-body' },
        h('nav', { class: 'menu-actions', 'aria-label': 'Main menu' },
          h('button', { class: 'primary play-button', id: 'play-btn', onclick: () => this.cb.onPlay() }, h('span', {}, title ? 'Play world' : 'Back to game'), h('span', { 'aria-hidden': 'true' }, '↗')),
          h('button', { onclick: () => this.go('newworld') }, 'Create a world', h('span', { 'aria-hidden': 'true' }, '+')),
          h('div', { class: 'row' }, h('button', { onclick: () => this.go('settings') }, 'Settings'), h('button', { onclick: () => this.go('controls') }, 'Controls')),
          h('button', { class: 'text-button danger', onclick: () => this.go('reset') }, 'Reset this world'),
        ),
        h('section', { class: 'world-card' },
          h('div', { class: 'world-emblem', 'aria-hidden': 'true' }, h('img', { src: this.icons.get(B.GRASS) ?? '', alt: '' })),
          h('div', { class: 'eyebrow' }, 'YOUR CURRENT WORLD'),
          h('h2', {}, this.world.seedText),
          h('p', {}, this.world.mode === 'creative' ? 'Creative · Build, fly, explore' : 'Survival · Gather, craft, thrive'),
          h('div', { class: 'save-status' }, this.saved ? '● Saved on this device' : 'Saving unavailable'),
        ),
      ),
      h('div', { class: this.lockNote ? 'lock-note' : 'hidden' }, this.lockNote),
      h('footer', { class: 'menu-footer' }, h('span', {}, 'HEARTHVALE / THE WORKSHOP UPDATE'), h('span', {}, 'Your world saves automatically in this browser.')),
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
      h('button', { class: 'showcase-choice', onclick: () => { input.value = 'Hearthvale'; mode = 'creative'; renderSeg(); } }, 'HEARTHVALE  ·  Tutorial village', h('small', {}, 'Stone keep, riverside cottages, windmill and diamond mine. Select, then create below.')),
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
      const focusLabel = document.activeElement?.getAttribute('aria-label');
      const scroll = this.menuPanel.scrollTop;
      if (graphics) s.preset = 'custom';
      this.cb.onSettings(s);
      this.renderMenu();
      this.menuPanel.scrollTop = scroll;
      if (focusLabel) [...this.menuPanel.querySelectorAll<HTMLElement>('[aria-label]')].find(el => el.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
    };
    const seg = <T extends string | boolean>(label: string, sub: string | null, options: [T, string][], get: () => T, set: (v: T) => void, graphics: boolean, disabled = false) => {
      const wrap = h('div', { class: 'seg' });
      for (const [v, text] of options) {
        wrap.append(
          h(
            'button',
            {
              class: get() === v ? 'on' : '',
              'aria-label': `${label}: ${text}`,
              'aria-pressed': get() === v ? 'true' : 'false',
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
      const input = h('input', { type: 'range', 'aria-label': label, min: String(min), max: String(max), step: String(step), value: String(get()) });
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

  get carriedStack(): Stack | null {
    return this.inventoryOpen && this.inv?.mode === 'survival' ? this.cursor : null;
  }

  openInventory(inv: Inventory, stations: Set<Station> = new Set(['hand'])): void {
    this.lastFocus = document.activeElement as HTMLElement;
    this.inv = inv;
    this.stations = stations;
    this.recipeStation = stations.has('table') ? 'table' : stations.has('furnace') ? 'furnace' : 'hand';
    this.selectedRecipe = RECIPES.find(r => r.station === this.recipeStation && inv.canCraft(r, stations)) ?? RECIPES.find(r => r.station === this.recipeStation)!;
    this.cursor = null;
    this.hovered = -1;
    this.invScreen.classList.remove('hidden');
    this.renderInventory();
    this.invPanel.querySelector<HTMLElement>('.close-button')?.focus({ preventScroll: true });
  }

  /** Closes the inventory, returning anything held on the cursor. */
  closeInventory(): boolean {
    if (this.inv && this.cursor) {
      if (this.inv.mode === 'survival') {
        const left = this.inv.add(this.cursor.id, this.cursor.count, this.cursor.dur);
        if (left) { this.cursor.count = left; this.renderCursor(); this.toast('Place the held stack in a slot first.'); return false; }
      }
      this.cursor = null;
    }
    this.invScreen.classList.add('hidden');
    this.cursorEl.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.inv?.changed();
    this.lastFocus?.focus({ preventScroll: true });
    return true;
  }

  /** Number key while hovering a slot: swap that slot with the hotbar slot. */
  inventoryHotkey(n: number): void {
    const inv = this.inv;
    if (!inv || this.hovered < 0) return;
    if (this.hovered >= 1000) {
      const id = CREATIVE_PALETTE[this.hovered - 1000];
      const t = toolOf(id);
      inv.slots[n] = t ? { id, count: 1, dur: t.durability } : { id, count: maxStackOf(id) };
    } else if (this.hovered !== n) {
      const tmp = inv.slots[n];
      inv.slots[n] = inv.slots[this.hovered];
      inv.slots[this.hovered] = tmp;
    }
    inv.changed();
    this.renderInventory();
  }

  private slotEl(index: number, stack: Stack | null, hideCount: boolean, onDown: (e: MouseEvent) => void, name: () => string | null): HTMLDivElement {
    const el = h('div', { class: 'slot', role: 'button', tabindex: '0', 'data-slot': index, 'aria-label': name() ?? `Empty slot ${index + 1}` });
    this.fillSlot(el, stack, hideCount);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onDown(e);
      this.cb.onUiSound();
    });
    el.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault(); onDown(new MouseEvent('mousedown', { button: 0, shiftKey: e.shiftKey })); this.cb.onUiSound();
    });
    el.addEventListener('focus', () => { this.hovered = index; });
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
          if (t && t.id === slot.id && t.count < maxStackOf(slot.id)) {
            const n = Math.min(left, maxStackOf(slot.id) - t.count);
            t.count += n;
            left -= n;
          }
        }
        for (let k = range[0]; k < range[1] && left > 0; k++) {
          if (!inv.slots[k]) {
            inv.slots[k] = { ...slot, count: left };
            left = 0;
          }
        }
        inv.slots[i] = left > 0 ? { ...slot, count: left } : null;
      }
    } else if (e.button === 0) {
      if (!this.cursor) {
        this.cursor = slot;
        inv.slots[i] = null;
      } else if (!slot) {
        inv.slots[i] = this.cursor;
        this.cursor = null;
      } else if (slot.id === this.cursor.id) {
        const n = Math.min(this.cursor.count, maxStackOf(slot.id) - slot.count);
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
          this.cursor = { ...slot, count: half };
          slot.count -= half;
          if (slot.count <= 0) inv.slots[i] = null;
        }
      } else if (!slot) {
        inv.slots[i] = { ...this.cursor, count: 1 };
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (slot.id === this.cursor.id && slot.count < maxStackOf(slot.id)) {
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
      const t = toolOf(id);
      inv.slots[target] = t ? { id, count: 1, dur: t.durability } : { id, count: maxStackOf(id) };
      inv.changed();
    } else {
      const t = toolOf(id);
      this.cursor = t ? { id, count: 1, dur: t.durability } : { id, count: e.button === 2 ? 1 : maxStackOf(id) };
    }
    this.renderInventory();
  }

  private searchField(value: string, placeholder: string, id: string, change: (value: string) => void): HTMLInputElement {
    return h('input', { type: 'search', value, placeholder, id, 'aria-label': placeholder, autocomplete: 'off', oninput: (e: Event) => { change((e.target as HTMLInputElement).value); this.renderInventory(); } });
  }

  private renderInventory(): void {
    const inv = this.inv;
    if (!inv) return;
    const creative = inv.mode === 'creative';
    const focus = document.activeElement as HTMLInputElement;
    const searchId = focus?.matches('input[type="search"]') ? focus.id : '';
    const caret = searchId ? focus.selectionStart : null;
    const slotFocus = focus?.dataset?.slot;
    const catalogScroll = this.invPanel.querySelector('.catalog-grid')?.scrollTop ?? 0;
    const recipeScroll = this.invPanel.querySelector('.recipe-grid')?.scrollTop ?? 0;
    clear(this.invPanel);
    this.tooltip.classList.add('hidden');
    const name = (i: number) => () => {
      const st = inv.slots[i]; if (!st) return null;
      const t = toolOf(st.id);
      return t && st.dur !== undefined ? `${itemName(st.id)} · ${st.dur}/${t.durability} durability` : itemName(st.id);
    };
    const main = h('div', { class: `inv-grid ${creative ? 'catalog-grid' : 'backpack-grid'}`, 'aria-label': creative ? 'Item catalog' : 'Backpack' });
    if (creative) {
      CREATIVE_PALETTE.forEach((id, k) => {
        const category = toolOf(id) ? 'Tools' : foodOf(id) ? 'Food' : id < 256 ? 'Blocks' : 'Materials';
        if (this.category !== 'All' && this.category !== category || !itemName(id).toLowerCase().includes(this.search.toLowerCase())) return;
        main.append(this.slotEl(1000 + k, { id, count: 1 }, true, e => this.clickPalette(id, e), () => itemName(id)));
      });
      if (!main.childElementCount) main.append(h('p', { class: 'empty-state' }, 'No items found. Try a different name.'));
    } else {
      for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) main.append(this.slotEl(i, inv.slots[i], false, e => this.clickSlot(i, e), name(i)));
    }
    const bar = h('div', { class: 'inv-grid inventory-hotbar', 'aria-label': 'Hotbar' });
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.slotEl(i, inv.slots[i], creative, e => this.clickSlot(i, e), name(i));
      if (i === inv.selected) el.classList.add('active');
      el.prepend(h('span', { class: 'key' }, String(i + 1))); bar.append(el);
    }
    const left = h('section', { class: 'inv-left' },
      h('div', { class: 'section-heading' }, h('h3', {}, creative ? 'Item collection' : 'Your backpack'), h('span', {}, creative ? `${CREATIVE_PALETTE.length} items` : `${inv.slots.filter(Boolean).length} / 36 slots`)),
      creative ? this.searchField(this.search, 'Find blocks, tools, food…', 'item-search', value => this.search = value) : h('div', { class: 'player-summary' },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, h('i', { class: 'avatar-head' }), h('i', { class: 'avatar-body' }), h('i', { class: 'avatar-arm left' }), h('i', { class: 'avatar-arm right' }), h('i', { class: 'avatar-leg left' }), h('i', { class: 'avatar-leg right' })),
        h('div', {}, h('div', { class: 'eyebrow' }, 'READY FOR ADVENTURE'), h('h3', {}, 'Keep the essentials close.'), h('p', {}, 'Tools in your hotbar. Everything else in your pack.'))),
      creative ? h('div', { class: 'catalog-tabs', 'aria-label': 'Item categories' }, ...['All', 'Blocks', 'Tools', 'Food', 'Materials'].map(cat => h('button', { class: cat === this.category ? 'on' : '', 'aria-pressed': cat === this.category ? 'true' : 'false', onclick: () => { this.category = cat; this.renderInventory(); } }, cat))) : null,
      main, h('div', { class: 'section-heading hotbar-heading' }, h('h3', {}, 'Quick access'), h('span', {}, '1–9 / scroll')), bar,
      h('p', { class: 'inv-help' }, creative ? 'Click to pick up · Shift-click to add to hotbar' : 'Click to move · Right-click to split · Shift-click to transfer', h('br'), 'Hover + 1–9 to swap · E / Esc to return'),
    );
    this.invPanel.append(
      h('nav',{class:'adventure-nav'},...(['backpack','equipment','journal'] as const).map(k=>h('button',{onclick:()=>this.cb.onAdventure?.(k)},k[0].toUpperCase()+k.slice(1)))),
      h('header', { class: 'inventory-header' }, h('div', {}, h('div', { class: 'eyebrow' }, 'MINEMINE / YOUR WORKSHOP'), h('h2', {}, creative ? 'Creative workshop' : 'Inventory & crafting')), h('button', { class: 'close-button', 'aria-label': 'Close inventory', onclick: () => this.cb.onCloseInventory() }, '×')),
      h('div', { class: 'inventory-body' }, left, this.renderCrafting(inv)),
    );
    const catalog = this.invPanel.querySelector('.catalog-grid'); if (catalog) catalog.scrollTop = catalogScroll;
    const recipes = this.invPanel.querySelector('.recipe-grid'); if (recipes) recipes.scrollTop = recipeScroll;
    this.renderCursor();
    if (searchId) { const input = document.getElementById(searchId) as HTMLInputElement; input?.focus(); if (caret !== null) input?.setSelectionRange(caret, caret); }
    else if (slotFocus) this.invPanel.querySelector<HTMLElement>(`[data-slot="${slotFocus}"]`)?.focus({ preventScroll: true });
  }

  private renderCrafting(inv: Inventory): HTMLElement {
    const stations: [Station, string][] = [['hand', 'By hand'], ['table', 'Crafting table'], ['furnace', 'Furnace']];
    const matching = RECIPES.filter(r => r.station === this.recipeStation && itemName(r.out).toLowerCase().includes(this.recipeSearch.toLowerCase()) && (!this.craftableOnly || inv.canCraft(r, this.stations)));
    if (!matching.includes(this.selectedRecipe) && matching.length) this.selectedRecipe = matching[0];
    const list = h('div', { class: 'recipe-grid', 'aria-label': 'Recipes' });
    for (const r of matching) {
      const available = inv.canCraft(r, this.stations);
      const el = h('button', { class: `slot recipe-tile ${r === this.selectedRecipe ? 'active' : ''} ${available ? 'available' : 'unavailable'}`, 'data-recipe': r.out, 'aria-label': `${itemName(r.out)}${available ? ', craftable' : ', requirements missing'}`, 'aria-pressed': r === this.selectedRecipe ? 'true' : 'false', title: itemName(r.out), onclick: () => { this.selectedRecipe = r; this.cb.onUiSound(); this.renderInventory(); } });
      this.fillSlot(el, { id: r.out, count: r.count }, false); list.append(el);
    }
    if (!matching.length) list.append(h('p', { class: 'empty-state' }, this.craftableOnly ? 'No craftable recipes. Gather ingredients or turn off Ready to craft.' : 'No recipes found. Try another search or station.'));
    const panel = h('section', { class: 'crafting' },
      h('div', { class: 'section-heading' }, h('h3', {}, 'Recipe book'), h('span', {}, `${matching.length} recipes`)),
      this.searchField(this.recipeSearch, 'Search recipes…', 'recipe-search', value => this.recipeSearch = value),
      h('div', { class: 'station-tabs', 'aria-label': 'Crafting stations' }, ...stations.map(([station, label]) => h('button', { class: station === this.recipeStation ? 'on' : '', 'aria-pressed': station === this.recipeStation ? 'true' : 'false', onclick: () => { this.recipeStation = station; this.renderInventory(); } }, label, !this.stations.has(station) ? h('small', {}, 'Requires station') : null))),
      h('label', { class: 'craft-filter' }, h('input', { type: 'checkbox', checked: this.craftableOnly, onchange: (e: Event) => { this.craftableOnly = (e.target as HTMLInputElement).checked; this.renderInventory(); } }), 'Ready to craft'),
      list,
    );
    if (matching.length) panel.append(this.recipeDetail(inv, this.selectedRecipe));
    return panel;
  }

  private recipeDetail(inv: Inventory, r: Recipe): HTMLElement {
    const needStation = !this.stations.has(r.station);
    const ok = inv.canCraft(r, this.stations) && !this.cursor;
    const ingredients = r.in.map(([options, count]) => {
      const ids = Array.isArray(options) ? options : [options];
      const id = ids.find(id => inv.count(id) >= count) ?? ids[0];
      return { id, count, have: inv.count(id) };
    });
    const grid = h('div', { class: `craft-grid ${r.station === 'hand' ? 'hand-grid' : ''} ${r.station === 'furnace' ? 'furnace-grid' : ''}`, 'aria-label': 'Recipe ingredient preview' });
    const size = r.station === 'hand' ? 4 : r.station === 'furnace' ? 2 : 9;
    const cells: (Stack | null)[] = Array(size).fill(null);
    const tool = toolOf(r.out);
    if (tool) {
      const material = ingredients[0].id, stick = I.STICK;
      const shape: Record<string, number[]> = { pickaxe: [0,1,2], axe: [0,1,3], shovel: [1], sword: [1,4], hoe:[0,1] };
      for (const at of shape[tool.kind]) cells[at] = { id: material, count: 1 };
      cells[7] = { id: stick, count: 1 }; if (tool.kind !== 'sword') cells[4] = { id: stick, count: 1 };
    } else if (r.station === 'furnace') {
      ingredients.forEach((ing, i) => cells[i] = { id: ing.id, count: ing.count });
    } else {
      const units = ingredients.flatMap(ing => Array.from({ length: ing.count }, () => ({ id: ing.id, count: 1 })));
      if (r.out === I.STICK) { cells[0] = units[0]; cells[2] = units[1]; }
      else if (r.out === B.FURNACE) { [0,1,2,3,5,6,7,8].forEach((at, i) => cells[at] = units[i]); }
      else units.slice(0, size).forEach((unit, i) => cells[i] = unit);
    }
    for (const stack of cells) { const el = h('div', { class: 'slot', title: stack ? itemName(stack.id) : '' }); this.fillSlot(el, stack, false); grid.append(el); }
    const output = h('div', { class: 'slot craft-output' }); this.fillSlot(output, { id: r.out, count: r.count }, false);
    const craft = (batch: boolean) => {
      if(r.station==='furnace'){this.cb.onAdventure?.('furnace');return;}
      if (this.cursor) return;
      let n = 0; while (n < (batch ? 64 : 1) && inv.craft(r, this.stations)) n++;
      if (n) { this.cb.onCraft?.(); this.showPickup(r.out, n * r.count); this.toast(`Crafted ${n * r.count} × ${itemName(r.out)}`, 1800); }
      else this.toast('No room. Free a slot before crafting.', 1800);
      this.renderInventory();
    };
    return h('div', { class: 'recipe-detail', 'data-output': r.out },
      h('div', { class: 'section-heading' }, h('h3', {}, itemName(r.out)), h('span', {}, `Makes ${r.count}`)),
      h('div', { class: 'craft-preview' }, grid, h('span', { class: 'craft-arrow', 'aria-hidden': 'true' }, '→'), output),
      h('div', { class: 'ingredient-list' }, ...ingredients.map(ing => h('div', { class: `ingredient ${inv.mode === 'survival' && ing.have < ing.count ? 'missing' : ''}` }, h('img', { src: this.icons.get(ing.id) ?? '', alt: '' }), h('span', {}, itemName(ing.id)), h('b', {}, inv.mode === 'creative' ? `∞ / ${ing.count}` : `${ing.have} / ${ing.count}`)))),
      h('p', { class: `craft-status ${needStation ? 'missing' : ''}` }, r.station==='furnace' ? 'Use a placed furnace: add input and fuel, wait for smelting, then collect the output.' : this.cursor ? 'Place your held stack before crafting.' : needStation ? `Place a ${r.station === 'table' ? 'crafting table' : 'furnace'} nearby to use this recipe.` : !ok ? 'Gather the missing ingredients shown above.' : 'Ingredients come from your backpack and hotbar.'),
      h('div', { class: 'row craft-actions' }, h('button', { class: 'primary', id: 'craft-one', disabled: r.station==='furnace' ? needStation : !ok, onclick: (e: MouseEvent) => craft(e.shiftKey) }, r.station === 'furnace' ? 'Open furnace' : 'Craft'), h('button', { id: 'craft-max', disabled: !ok, title: 'Up to 64 crafts, limited by ingredients and space', onclick: () => craft(true) }, 'Craft max')),
    );
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
