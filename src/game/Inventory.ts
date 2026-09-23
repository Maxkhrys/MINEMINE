import { B, blockDef } from '../world/blocks';

export interface Stack {
  id: number;
  count: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 9 hotbar + 27 main
export const MAX_STACK = 64;

export type GameMode = 'survival' | 'creative';

/** Slots 0–8 are the hotbar, 9–35 the main inventory. */
export class Inventory {
  slots: (Stack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  selected = 0;
  private listeners: (() => void)[] = [];

  constructor(public mode: GameMode) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  get selectedStack(): Stack | null {
    return this.slots[this.selected];
  }

  select(i: number): void {
    const n = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (n !== this.selected) {
      this.selected = n;
      this.changed();
    }
  }

  /** Adds items, filling existing stacks first (hotbar before main). Returns the leftover count. */
  add(id: number, count: number): number {
    if (!id || count <= 0) return 0;
    if (this.mode === 'creative') {
      if (this.slots.some((s) => s?.id === id)) return 0;
    }
    let left = count;
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < MAX_STACK) {
        const n = Math.min(left, MAX_STACK - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, MAX_STACK);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    if (left !== count) this.changed();
    return left;
  }

  /** Uses one item from the selected slot. Creative mode never runs out. */
  consumeSelected(): void {
    if (this.mode === 'creative') return;
    const s = this.slots[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /** Middle-click "pick block": select or fetch a stack of the given block. */
  pick(id: number): boolean {
    if (!blockDef(id).placeable) return false;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.id === id) {
        this.select(i);
        return true;
      }
    }
    if (this.mode === 'creative') {
      this.slots[this.selected] = { id, count: MAX_STACK };
      this.changed();
      return true;
    }
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
      if (this.slots[i]?.id === id) {
        const tmp = this.slots[this.selected];
        this.slots[this.selected] = this.slots[i];
        this.slots[i] = tmp;
        this.changed();
        return true;
      }
    }
    return false;
  }

  static starter(mode: GameMode): Inventory {
    const inv = new Inventory(mode);
    const kit: [number, number][] =
      mode === 'creative'
        ? [
            [B.GRASS, 64],
            [B.STONE, 64],
            [B.OAK_PLANKS, 64],
            [B.COBBLESTONE, 64],
            [B.GLASS, 64],
            [B.BRICKS, 64],
            [B.OAK_LOG, 64],
            [B.GLOW_LAMP, 64],
            [B.RED_FLOWER, 64],
          ]
        : [
            [B.OAK_PLANKS, 48],
            [B.COBBLESTONE, 48],
            [B.GLASS, 24],
            [B.BRICKS, 32],
            [B.OAK_LOG, 16],
            [B.GLOW_LAMP, 12],
            [B.SAND, 16],
            [B.OAK_LEAVES, 16],
            [B.YELLOW_FLOWER, 8],
          ];
    kit.forEach(([id, n], i) => (inv.slots[i] = { id, count: n }));
    return inv;
  }

  serialize(): { slots: ([number, number] | null)[]; selected: number } {
    return { slots: this.slots.map((s) => (s ? [s.id, s.count] : null)), selected: this.selected };
  }

  static deserialize(mode: GameMode, data: { slots?: unknown; selected?: unknown } | undefined): Inventory {
    if (!data || !Array.isArray(data.slots)) return Inventory.starter(mode);
    const inv = new Inventory(mode);
    data.slots.slice(0, INVENTORY_SIZE).forEach((s, i) => {
      if (Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'number' && blockDef(s[0]).placeable && s[1] > 0) {
        inv.slots[i] = { id: s[0], count: Math.min(MAX_STACK, Math.floor(s[1])) };
      }
    });
    inv.selected = typeof data.selected === 'number' ? Math.max(0, Math.min(8, Math.floor(data.selected))) : 0;
    return inv;
  }
}
