import { B, blockDef } from '../world/blocks';

/**
 * Non-block items (ids >= 256): materials, tools and food. Blocks keep their block id
 * as their item id, so a stack can hold either.
 */
export const I = {
  STICK: 256,
  COAL: 257,
  IRON_INGOT: 258,
  DIAMOND: 259,
  DIAMOND_PICKAXE: 272,
  DIAMOND_AXE: 273,
  DIAMOND_SHOVEL: 274,
  DIAMOND_SWORD: 275,
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

const TIER_NAME = ['', 'Wooden', 'Stone', 'Iron', 'Diamond'];
const TIER_DURABILITY = [0, 60, 132, 250, 1561];
const TIER_HEAD: [string, string][] = [
  ['', ''],
  ['#b08954', '#7a5c37'],
  ['#8e9094', '#5d5f62'],
  ['#e6e6e6', '#a7a9ad'],
  ['#65e1db', '#26898c'],
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
tool(I.DIAMOND_PICKAXE, 'pickaxe', 4);
tool(I.DIAMOND_AXE, 'axe', 4);
tool(I.DIAMOND_SHOVEL, 'shovel', 4);
tool(I.DIAMOND_SWORD, 'sword', 4);
ITEMS.set(I.DIAMOND, { id: I.DIAMOND, name: 'Diamond', maxStack: 64, art: { kind: 'lump', colors: ['#65e1db', '#26898c', '#c8ffef'] } });
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
export const TIER_SPEED = [1, 2.2, 4, 6, 8];

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
  { out: I.DIAMOND_PICKAXE, count: 1, in: [[I.DIAMOND, 3], [I.STICK, 2]], station: 'table' },
  { out: I.DIAMOND_AXE, count: 1, in: [[I.DIAMOND, 3], [I.STICK, 2]], station: 'table' },
  { out: I.DIAMOND_SHOVEL, count: 1, in: [[I.DIAMOND, 1], [I.STICK, 2]], station: 'table' },
  { out: I.DIAMOND_SWORD, count: 1, in: [[I.DIAMOND, 2], [I.STICK, 1]], station: 'table' },
  { out: B.STONE_BRICKS, count: 4, in: [[B.STONE, 4]], station: 'table' },
  { out: B.CAMPFIRE, count: 1, in: [[LOGS, 3], [I.STICK, 3], [I.COAL, 1]], station: 'table' },
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

/** Original 32px sprites shared by the inventory and extruded first-person model. */
export function drawItemIcon(def: ItemDef): { url: string; canvas: HTMLCanvasElement } {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  };
  // Rasterize integer polygons so silhouettes stay clean at every icon size.
  const poly = (points: number[][], color: string) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if ((yi > y + .5) !== (yj > y + .5) && x + .5 < (xj - xi) * (y + .5 - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) rect(x, y, 1, 1, color);
    }
  };
  const handle = (end = 22) => {
    poly([[3,26],[end,29-end],[end+3,32-end],[7,30],[3,30]], '#34281d');
    for (let i = 0; i < end - 3; i++) {
      rect(5+i,26-i,2,2, i % 5 < 2 ? '#896035' : '#b58a4e');
      rect(5+i,28-i,1,1,'#624328');
    }
    rect(5,27,2,2,'#dbc084');
  };
  const a = def.art;
  if (a.kind === 'tool') {
    const H = a.head, D = a.headDark;
    const outline = def.tool!.tier === 4 ? '#163f48' : '#34322e';
    const shine = ['', '#dec18b', '#c4c8c5', '#fafff0', '#dcfff5'][def.tool!.tier];
    handle(a.tool === 'sword' ? 12 : 22);
    if (a.tool === 'pickaxe') {
      poly([[9,3],[22,3],[26,6],[29,12],[29,19],[26,17],[23,11],[19,8],[11,8],[6,10],[5,7]],outline);
      poly([[10,4],[21,4],[25,7],[27,12],[27,15],[23,9],[19,7],[10,7],[7,8]],H);
      poly([[11,7],[20,7],[24,10],[27,16],[27,12],[24,8],[20,5]],D);
      rect(11,4,9,1,shine); rect(23,7,2,1,shine);
      rect(18,8,3,3,'#a58a53'); rect(19,8,1,2,shine);
    } else if (a.tool === 'axe') {
      // A broad, squared cutting blade sits to the left of the haft.
      // Its asymmetric silhouette stays distinct from the pointed shovel.
      poly([[12,2],[22,2],[26,6],[26,9],[22,11],[20,11],[17,16],[13,16],[8,11],[8,5]],outline);
      poly([[12,4],[21,4],[24,7],[23,9],[19,9],[16,14],[13,14],[10,10],[10,6]],H);
      poly([[20,4],[24,7],[23,9],[19,9],[16,14],[15,11],[19,7]],D);
      poly([[10,6],[12,4],[15,4],[12,7],[12,10],[15,14],[13,14],[10,10]],shine);
      rect(20,7,3,3,'#b38c4b'); rect(21,7,1,1,'#f0cd85');
    } else if (a.tool === 'shovel') {
      poly([[22,2],[29,3],[30,9],[26,16],[22,17],[16,11],[16,7]],outline);
      poly([[22,4],[27,4],[28,8],[24,14],[21,14],[18,11],[18,8]],H);
      poly([[27,5],[28,8],[24,14],[22,14],[24,10]],D);
      poly([[22,4],[26,4],[22,6],[19,9],[18,8]],shine);
    } else {
      poly([[25,2],[30,2],[30,7],[15,22],[11,18]],outline);
      poly([[26,4],[28,4],[28,7],[14,20],[13,18]],H);
      poly([[28,5],[28,7],[15,20],[14,19]],D);
      poly([[25,5],[27,4],[15,16],[14,16]],shine);
      poly([[8,13],[19,24],[17,26],[6,15]],outline);
      poly([[8,14],[18,24],[17,24],[7,15]],'#bc9a58');
      rect(4,27,3,3, D); rect(4,27,2,1,shine);
    }
  } else if (a.kind === 'stick') handle(26);
  else if (def.id === I.DIAMOND) {
    poly([[9,5],[23,5],[29,12],[16,28],[3,12]],'#174953');
    poly([[10,7],[22,7],[26,12],[16,25],[6,12]],'#46d6d4');
    poly([[10,7],[16,7],[12,12],[6,12]],'#c6fff2');
    poly([[16,7],[22,7],[26,12],[20,12]],'#8df3e8');
    poly([[12,12],[20,12],[16,25]],'#8df3e8');
    poly([[20,12],[26,12],[16,25]],'#228b9e');
  } else if (a.kind === 'lump') {
    poly([[9,6],[20,4],[27,11],[28,20],[20,27],[9,26],[4,19],[5,11]],'#171d20');
    poly([[10,7],[19,6],[24,12],[21,18],[10,20],[6,16]],'#424a4b');
    poly([[10,7],[19,6],[16,10],[8,13]],'#66716c');
    poly([[21,18],[26,13],[26,20],[20,25],[11,24]],'#293335');
  } else if (a.kind === 'ingot') {
    poly([[10,8],[26,8],[30,17],[23,24],[3,24],[2,17]],'#435357');
    poly([[10,10],[25,10],[27,16],[21,20],[5,20],[4,17]],'#e7eae0');
    poly([[5,20],[21,20],[27,16],[27,18],[22,22],[5,22]],'#819694');
    poly([[10,10],[24,10],[23,12],[8,15],[6,17]],'#ffffff');
  } else {
    const [base, shade, light, leaf] = a.colors;
    if (a.shape === 'apple') {
      poly([[7,9],[12,8],[17,10],[22,8],[27,12],[28,20],[24,27],[18,29],[13,28],[8,28],[4,22],[3,15]],'#612c23');
      poly([[7,11],[12,10],[17,12],[22,10],[25,13],[26,20],[23,25],[17,27],[10,26],[6,21],[5,15]],base);
      poly([[23,12],[25,15],[25,21],[22,25],[17,27],[10,25],[18,24],[22,20]],shade);
      rect(7,14,3,6,'#faaca0'); rect(9,12,3,2,'#faaca0');
      rect(15,4,3,7,light); poly([[18,4],[25,3],[23,7],[18,8]],leaf);
    } else if (a.shape === 'bread') {
      poly([[4,12],[8,8],[20,5],[26,8],[29,14],[27,22],[21,25],[6,27],[2,22],[2,17]],'#6a4026');
      poly([[5,13],[9,10],[20,7],[25,10],[27,15],[25,21],[20,23],[6,25],[4,21]],base);
      poly([[4,21],[20,20],[27,15],[25,21],[20,23],[6,25]],shade);
      for (let x=8;x<24;x+=6) poly([[x,11],[x+2,10],[x+4,16],[x+2,18]],light);
    } else if (a.shape === 'leg') {
      poly([[15,5],[23,5],[28,10],[28,18],[23,23],[16,22],[10,16],[10,10]],shade);
      poly([[16,7],[22,7],[26,11],[25,17],[21,20],[16,19],[12,15],[12,11]],base);
      rect(15,9,5,2,'#f0bc8a');
      poly([[12,18],[15,21],[8,28],[5,27]],'#cdc6ab');
      rect(3,26,4,4,'#f5edcf'); rect(7,28,3,3,'#f5edcf');
    } else {
      poly([[11,6],[21,5],[28,11],[29,19],[23,26],[13,27],[5,23],[3,16],[6,10]],shade);
      poly([[11,8],[21,7],[26,12],[27,18],[22,23],[13,25],[7,21],[5,16],[8,11]],base);
      poly([[8,12],[13,10],[17,11],[18,17],[23,19],[21,21],[16,18],[14,13],[9,14]],light);
      rect(9,19,3,2,light);
    }
  }
  const big = document.createElement('canvas'); big.width = big.height = 64;
  const bctx = big.getContext('2d')!; bctx.imageSmoothingEnabled = false;
  bctx.drawImage(c, 0, 0, 64, 64);
  return { url: big.toDataURL(), canvas: c };
}
