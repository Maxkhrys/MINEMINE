import { B, blockDef } from '../world/blocks';

/**
 * Non-block items (ids >= 256): materials, tools and food. Blocks keep their block id
 * as their item id, so a stack can hold either.
 */
export const I = {
  STICK: 256,
  COAL: 257,
  IRON_INGOT: 258,
  WOOD_PICKAXE: 260,
  STONE_PICKAXE: 261,
  IRON_PICKAXE: 262,
  WOOD_AXE: 263,
  STONE_AXE: 264,
  IRON_AXE: 265,
  WOOD_SHOVEL: 266,
  STONE_SHOVEL: 267,
  IRON_SHOVEL: 268,
  WOOD_SWORD: 269,
  STONE_SWORD: 270,
  IRON_SWORD: 271,
  APPLE: 280,
  RAW_PORK: 281,
  COOKED_PORK: 282,
  RAW_BEEF: 283,
  STEAK: 284,
  RAW_CHICKEN: 285,
  COOKED_CHICKEN: 286,
  BREAD: 287,
} as const;

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

export interface ToolInfo {
  kind: ToolKind;
  /** 1 wood, 2 stone, 3 iron. */
  tier: number;
  durability: number;
}

export interface ItemDef {
  id: number;
  name: string;
  maxStack: number;
  tool?: ToolInfo;
  /** Hunger points restored when eaten. */
  food?: number;
  /** Icon drawing, see drawItemIcon. */
  art: ItemArt;
}

type ItemArt =
  | { kind: 'tool'; tool: ToolKind; head: string; headDark: string }
  | { kind: 'stick' }
  | { kind: 'lump'; colors: string[] }
  | { kind: 'ingot'; colors: string[] }
  | { kind: 'food'; colors: string[]; shape: 'apple' | 'meat' | 'leg' | 'bread' };

export const ITEMS = new Map<number, ItemDef>();

const TIER_NAME = ['', 'Wooden', 'Stone', 'Iron'];
const TIER_DURABILITY = [0, 60, 132, 250];
const TIER_HEAD: [string, string][] = [
  ['', ''],
  ['#b08954', '#7a5c37'],
  ['#8e9094', '#5d5f62'],
  ['#e6e6e6', '#a7a9ad'],
];

function tool(id: number, kind: ToolKind, tier: number): void {
  const label = { pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', sword: 'Sword' }[kind];
  ITEMS.set(id, {
    id,
    name: `${TIER_NAME[tier]} ${label}`,
    maxStack: 1,
    tool: { kind, tier, durability: TIER_DURABILITY[tier] },
    art: { kind: 'tool', tool: kind, head: TIER_HEAD[tier][0], headDark: TIER_HEAD[tier][1] },
  });
}

ITEMS.set(I.STICK, { id: I.STICK, name: 'Stick', maxStack: 64, art: { kind: 'stick' } });
ITEMS.set(I.COAL, { id: I.COAL, name: 'Coal', maxStack: 64, art: { kind: 'lump', colors: ['#1e1e20', '#2f2f33', '#46464b'] } });
ITEMS.set(I.IRON_INGOT, { id: I.IRON_INGOT, name: 'Iron Ingot', maxStack: 64, art: { kind: 'ingot', colors: ['#f0f0f0', '#c9cbce', '#8f9296'] } });
tool(I.WOOD_PICKAXE, 'pickaxe', 1);
tool(I.STONE_PICKAXE, 'pickaxe', 2);
tool(I.IRON_PICKAXE, 'pickaxe', 3);
tool(I.WOOD_AXE, 'axe', 1);
tool(I.STONE_AXE, 'axe', 2);
tool(I.IRON_AXE, 'axe', 3);
tool(I.WOOD_SHOVEL, 'shovel', 1);
tool(I.STONE_SHOVEL, 'shovel', 2);
tool(I.IRON_SHOVEL, 'shovel', 3);
tool(I.WOOD_SWORD, 'sword', 1);
tool(I.STONE_SWORD, 'sword', 2);
tool(I.IRON_SWORD, 'sword', 3);
const food = (id: number, name: string, value: number, colors: string[], shape: 'apple' | 'meat' | 'leg' | 'bread') =>
  ITEMS.set(id, { id, name, maxStack: 64, food: value, art: { kind: 'food', colors, shape } });
food(I.APPLE, 'Apple', 4, ['#d8322c', '#a82320', '#6a3e1d', '#5aa33c'], 'apple');
food(I.RAW_PORK, 'Raw Porkchop', 3, ['#f2a3a3', '#d97b7b', '#fbe3dc'], 'meat');
food(I.COOKED_PORK, 'Cooked Porkchop', 8, ['#c98a52', '#9c6433', '#f0d3a8'], 'meat');
food(I.RAW_BEEF, 'Raw Beef', 3, ['#d6453f', '#a52f2b', '#f3c9c0'], 'meat');
food(I.STEAK, 'Steak', 8, ['#8a5530', '#5f3a1f', '#c38c5c'], 'meat');
food(I.RAW_CHICKEN, 'Raw Chicken', 2, ['#f6d7c3', '#e3b59a', '#fff3e8'], 'leg');
food(I.COOKED_CHICKEN, 'Cooked Chicken', 6, ['#d99a5b', '#b0713a', '#f3d2a3'], 'leg');
food(I.BREAD, 'Bread', 5, ['#d6a55a', '#b07b36', '#f0cf8e'], 'bread');

export function isBlockItem(id: number): boolean {
  return id > 0 && id < 256;
}

export function itemName(id: number): string {
  return isBlockItem(id) ? blockDef(id).name : (ITEMS.get(id)?.name ?? 'Unknown');
}

export function maxStackOf(id: number): number {
  return isBlockItem(id) ? 64 : (ITEMS.get(id)?.maxStack ?? 64);
}

/** Items that may exist in an inventory. */
export function isValidItem(id: number): boolean {
  return isBlockItem(id) ? blockDef(id).placeable : ITEMS.has(id);
}

export function toolOf(id: number | undefined): ToolInfo | null {
  return id === undefined ? null : (ITEMS.get(id)?.tool ?? null);
}

export function foodOf(id: number | undefined): number {
  return id === undefined ? 0 : (ITEMS.get(id)?.food ?? 0);
}

/** Mining speed multiplier per tool tier when the tool matches the block. */
export const TIER_SPEED = [1, 2.2, 4, 6];

/** Melee damage (half-hearts) by held item. */
export function attackDamage(id: number | undefined): number {
  const t = toolOf(id);
  if (!t) return 1;
  if (t.kind === 'sword') return 3 + t.tier;
  if (t.kind === 'axe') return 2 + t.tier;
  return 1 + t.tier * 0.5;
}

// ---------------------------------------------------------------- recipes

export type Station = 'hand' | 'table' | 'furnace';

export interface Recipe {
  out: number;
  count: number;
  /** Ingredients: item id and count (shapeless). A list of ids means "any of these". */
  in: [number | number[], number][];
  station: Station;
}

const LOGS = [B.OAK_LOG, B.BIRCH_LOG];

export const RECIPES: Recipe[] = [
  { out: B.OAK_PLANKS, count: 4, in: [[LOGS, 1]], station: 'hand' },
  { out: I.STICK, count: 4, in: [[B.OAK_PLANKS, 2]], station: 'hand' },
  { out: B.CRAFTING_TABLE, count: 1, in: [[B.OAK_PLANKS, 4]], station: 'hand' },
  { out: I.WOOD_PICKAXE, count: 1, in: [[B.OAK_PLANKS, 3], [I.STICK, 2]], station: 'table' },
  { out: I.WOOD_AXE, count: 1, in: [[B.OAK_PLANKS, 3], [I.STICK, 2]], station: 'table' },
  { out: I.WOOD_SHOVEL, count: 1, in: [[B.OAK_PLANKS, 1], [I.STICK, 2]], station: 'table' },
  { out: I.WOOD_SWORD, count: 1, in: [[B.OAK_PLANKS, 2], [I.STICK, 1]], station: 'table' },
  { out: B.FURNACE, count: 1, in: [[B.COBBLESTONE, 8]], station: 'table' },
  { out: I.STONE_PICKAXE, count: 1, in: [[B.COBBLESTONE, 3], [I.STICK, 2]], station: 'table' },
  { out: I.STONE_AXE, count: 1, in: [[B.COBBLESTONE, 3], [I.STICK, 2]], station: 'table' },
  { out: I.STONE_SHOVEL, count: 1, in: [[B.COBBLESTONE, 1], [I.STICK, 2]], station: 'table' },
  { out: I.STONE_SWORD, count: 1, in: [[B.COBBLESTONE, 2], [I.STICK, 1]], station: 'table' },
  { out: I.IRON_PICKAXE, count: 1, in: [[I.IRON_INGOT, 3], [I.STICK, 2]], station: 'table' },
  { out: I.IRON_AXE, count: 1, in: [[I.IRON_INGOT, 3], [I.STICK, 2]], station: 'table' },
  { out: I.IRON_SHOVEL, count: 1, in: [[I.IRON_INGOT, 1], [I.STICK, 2]], station: 'table' },
  { out: I.IRON_SWORD, count: 1, in: [[I.IRON_INGOT, 2], [I.STICK, 1]], station: 'table' },
  { out: B.SANDSTONE, count: 1, in: [[B.SAND, 4]], station: 'table' },
  { out: B.GLOW_LAMP, count: 2, in: [[B.GLASS, 1], [I.COAL, 2]], station: 'table' },
  { out: I.IRON_INGOT, count: 1, in: [[B.IRON_ORE, 1], [I.COAL, 1]], station: 'furnace' },
  { out: B.GLASS, count: 2, in: [[B.SAND, 2], [I.COAL, 1]], station: 'furnace' },
  { out: B.BRICKS, count: 2, in: [[B.CLAY, 2], [I.COAL, 1]], station: 'furnace' },
  { out: B.STONE, count: 2, in: [[B.COBBLESTONE, 2], [I.COAL, 1]], station: 'furnace' },
  { out: I.COOKED_PORK, count: 1, in: [[I.RAW_PORK, 1], [I.COAL, 1]], station: 'furnace' },
  { out: I.STEAK, count: 1, in: [[I.RAW_BEEF, 1], [I.COAL, 1]], station: 'furnace' },
  { out: I.COOKED_CHICKEN, count: 1, in: [[I.RAW_CHICKEN, 1], [I.COAL, 1]], station: 'furnace' },
  { out: I.BREAD, count: 1, in: [[B.TALL_GRASS, 6]], station: 'furnace' },
];

// ---------------------------------------------------------------- icons

/** Draws an original 16x16 pixel-art icon for an item and returns it as a data URL (64x64). */
export function drawItemIcon(def: ItemDef): { url: string; canvas: HTMLCanvasElement } {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const handle = (len: number) => {
    // Diagonal stick from bottom-left towards the centre.
    for (let i = 0; i < len; i++) {
      px(2 + i, 13 - i, i % 3 === 0 ? '#5b4127' : '#7b5b3a');
      px(3 + i, 13 - i, '#4a3420');
    }
  };
  const a = def.art;
  if (a.kind === 'stick') {
    handle(10);
  } else if (a.kind === 'tool') {
    handle(a.tool === 'sword' ? 5 : 9);
    const H = a.head;
    const D = a.headDark;
    if (a.tool === 'pickaxe') {
      for (let i = 0; i < 9; i++) {
        px(4 + i, 2 + Math.round(Math.abs(i - 4) * 0.35), H);
        px(4 + i, 3 + Math.round(Math.abs(i - 4) * 0.35), D);
      }
    } else if (a.tool === 'axe') {
      for (let y = 1; y < 7; y++) for (let x = 8; x < 13 - (y > 4 ? y - 4 : 0); x++) px(x, y, x === 8 || y === 6 ? D : H);
    } else if (a.tool === 'shovel') {
      for (let y = 1; y < 6; y++) for (let x = 9; x < 14; x++) if (Math.abs(x - 11) + Math.abs(y - 3) < 4) px(x, y, x > 11 || y > 4 ? D : H);
    } else {
      for (let i = 0; i < 9; i++) {
        px(6 + i, 9 - i, H);
        px(6 + i, 10 - i, D);
      }
      for (let i = -2; i <= 2; i++) px(5 + i, 9 + i, '#3a2a1a');
    }
  } else if (a.kind === 'lump') {
    const pts = [[6,4],[7,4],[8,4],[5,5],[6,5],[7,5],[8,5],[9,5],[4,6],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[4,7],[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[11,8],[5,9],[6,9],[7,9],[8,9],[9,9],[10,9],[6,10],[7,10],[8,10],[9,10],[7,11],[8,11]];
    for (const [x, y] of pts) px(x, y, a.colors[(x * 7 + y * 3) % a.colors.length]);
    px(6, 5, '#6a6a70');
    px(9, 7, '#6a6a70');
  } else if (a.kind === 'ingot') {
    for (let y = 6; y < 11; y++) for (let x = 3 + (10 - y); x < 13 - (y - 6); x++) px(x, y, y === 6 ? a.colors[0] : y > 9 ? a.colors[2] : a.colors[1]);
  } else {
    const [c0, c1, c2, c3] = a.colors;
    if (a.shape === 'apple') {
      for (let y = 5; y < 14; y++) for (let x = 3; x < 13; x++) {
        const dx = x - 7.5;
        const dy = (y - 9) * 1.1;
        if (dx * dx + dy * dy < 22) px(x, y, dx > 1.5 || dy > 2 ? c1 : c0);
      }
      px(6, 7, '#f08a80');
      px(8, 3, c2);
      px(8, 4, c2);
      px(9, 3, c3);
      px(10, 2, c3);
    } else if (a.shape === 'meat') {
      for (let y = 4; y < 13; y++) for (let x = 3; x < 14; x++) {
        const dx = (x - 8) / 5;
        const dy = (y - 8) / 4;
        if (dx * dx + dy * dy < 1) px(x, y, dx * dx + dy * dy > 0.6 ? c1 : (x + y) % 4 === 0 ? c2 : c0);
      }
    } else if (a.shape === 'leg') {
      for (let y = 3; y < 11; y++) for (let x = 5; x < 13; x++) {
        const dx = (x - 9) / 3.6;
        const dy = (y - 6.5) / 3.6;
        if (dx * dx + dy * dy < 1) px(x, y, dx * dx + dy * dy > 0.6 ? c1 : c0);
      }
      for (let i = 0; i < 4; i++) px(6 - i, 10 + i, c2);
      px(2, 13, '#fafafa');
      px(3, 14, '#fafafa');
    } else {
      for (let y = 6; y < 12; y++) for (let x = 2; x < 14; x++) if (!((x === 2 || x === 13) && (y === 6 || y === 11))) px(x, y, y < 8 ? c0 : y > 10 ? c1 : c2);
      for (let x = 4; x < 13; x += 3) px(x, 7, c1);
    }
  }
  const big = document.createElement('canvas');
  big.width = 64;
  big.height = 64;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(c, 0, 0, 64, 64);
  return { url: big.toDataURL(), canvas: c };
}
