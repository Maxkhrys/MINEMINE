import { B } from '../world/blocks';
import { I, isValidItem, maxStackOf, toolOf, type Recipe, type Station } from './items';

export interface Stack {
  id: number;
  count: number;
  /** Remaining durability for tools. */
  dur?: number;
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
  add(id: number, count: number, durability?: number): number {
    if (!id || count <= 0) return 0;
    let left = count;
    const max = maxStackOf(id);
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        const t = toolOf(id);
        this.slots[i] = t ? { id, count: n, dur: durability ?? t.durability } : { id, count: n };
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

  /** Wears the selected tool by one use. Returns true when it broke. */
  wearSelected(): boolean {
    if (this.mode === 'creative') return false;
    const s = this.slots[this.selected];
    const t = toolOf(s?.id);
    if (!s || !t) return false;
    s.dur = (s.dur ?? t.durability) - 1;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Removes up to n items of a kind; returns how many were removed. */
  remove(id: number, n: number): number {
    let left = n;
    for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const k = Math.min(left, s.count);
      s.count -= k;
      left -= k;
      if (s.count <= 0) this.slots[i] = null;
    }
    return n - left;
  }

  /** Which concrete ingredient ids a recipe would use, or null if it can't be made. */
  private resolve(r: Recipe): [number, number][] | null {
    const out: [number, number][] = [];
    for (const [ing, n] of r.in) {
      const options = Array.isArray(ing) ? ing : [ing];
      const pick = options.find((o) => this.count(o) >= n);
      if (pick === undefined) return null;
      out.push([pick, n]);
    }
    return out;
  }

  canCraft(r: Recipe, stations: Set<Station>): boolean {
    if (!stations.has(r.station)) return false;
    if (this.mode === 'creative') return true;
    return this.resolve(r) !== null;
  }

  /** Crafts once. Returns false when ingredients, station or space are missing. */
  craft(r: Recipe, stations: Set<Station>): boolean {
    if (!this.canCraft(r, stations)) return false;
    // Stage the entire transaction. Failed crafts never move stacks, reset
    // durability, or emit an intermediate inventory state to the renderer.
    const next = new Inventory(this.mode);
    next.slots = this.slots.map(s => s ? { ...s } : null);
    if (this.mode === 'survival') for (const [id, n] of this.resolve(r)!) next.remove(id, n);
    if (next.add(r.out, r.count) > 0) return false;
    this.slots = next.slots;
    this.changed();
    return true;
  }

  /** Middle-click "pick block": select or fetch a stack of the given block. */
  pick(id: number): boolean {
    if (!isValidItem(id)) return false;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.id === id) {
        this.select(i);
        return true;
      }
    }
    if (this.mode === 'creative') {
      this.slots[this.selected] = { id, count: maxStackOf(id) };
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
            [I.WOOD_PICKAXE, 1],
            [I.WOOD_AXE, 1],
            [B.OAK_PLANKS, 16],
            [I.APPLE, 5],
            [B.CRAFTING_TABLE, 1],
          ];
    kit.forEach(([id, n], i) => {
      const t = toolOf(id);
      inv.slots[i] = t ? { id, count: n, dur: t.durability } : { id, count: n };
    });
    return inv;
  }

  serialize(carried?: Stack | null): { slots: number[][]; selected: number } {
    // Cursor items are still owned by the player. Include them in autosaves
    // without changing the live inventory underneath an open workshop.
    if (carried) {
      const snapshot = new Inventory(this.mode);
      snapshot.slots = this.slots.map(s => s ? { ...s } : null);
      snapshot.selected = this.selected;
      snapshot.add(carried.id, carried.count, carried.dur);
      return snapshot.serialize();
    }
    return { slots: this.slots.map((s) => (s ? (s.dur !== undefined ? [s.id, s.count, s.dur] : [s.id, s.count]) : [])), selected: this.selected };
  }

  static deserialize(mode: GameMode, data: { slots?: unknown; selected?: unknown } | undefined): Inventory {
    if (!data || !Array.isArray(data.slots)) return Inventory.starter(mode);
    const inv = new Inventory(mode);
    data.slots.slice(0, INVENTORY_SIZE).forEach((s, i) => {
      if (Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'number' && isValidItem(s[0]) && s[1] > 0) {
        const t = toolOf(s[0]);
        inv.slots[i] = { id: s[0], count: Math.min(maxStackOf(s[0]), Math.floor(s[1])) };
        if (t) inv.slots[i]!.dur = typeof s[2] === 'number' && s[2] > 0 ? Math.min(t.durability, s[2]) : t.durability;
      }
    });
    inv.selected = typeof data.selected === 'number' ? Math.max(0, Math.min(8, Math.floor(data.selected))) : 0;
    return inv;
  }
}
