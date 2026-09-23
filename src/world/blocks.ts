/**
 * Block registry. Every block type is described once here; the mesher, physics,
 * raycaster, inventory and texture generator all read from this table.
 */

/** Texture layers in the block texture array. Order defines the layer index. */
export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobblestone',
  'sand',
  'gravel',
  'oak_log_side',
  'oak_log_top',
  'oak_leaves',
  'oak_planks',
  'glass',
  'bricks',
  'snow',
  'coal_ore',
  'iron_ore',
  'birch_log_side',
  'birch_log_top',
  'birch_leaves',
  'sandstone_side',
  'sandstone_top',
  'tall_grass',
  'red_flower',
  'yellow_flower',
  'water',
  'bedrock',
  'glow_lamp',
  'clay',
  'snow_side',
  'crafting_table_top',
  'crafting_table_side',
  'furnace_front',
  'furnace_side',
  'furnace_top',
  'stone_bricks',
  'diamond_ore',
  'campfire',
  'chest_front', 'chest_top', 'furnace_lit', 'bed_top', 'bed_side', 'door', 'gate', 'ladder', 'farmland', 'crop_young', 'crop_mid', 'crop_tall', 'crop_ripe', 'grave', 'village_post',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export function tile(name: TileName): number {
  return TILE_NAMES.indexOf(name);
}

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  GRAVEL: 6,
  OAK_LOG: 7,
  OAK_LEAVES: 8,
  OAK_PLANKS: 9,
  GLASS: 10,
  BRICKS: 11,
  SNOW: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  BIRCH_LOG: 15,
  BIRCH_LEAVES: 16,
  SANDSTONE: 17,
  TALL_GRASS: 18,
  RED_FLOWER: 19,
  YELLOW_FLOWER: 20,
  WATER: 21,
  BEDROCK: 22,
  GLOW_LAMP: 23,
  CLAY: 24,
  SNOWY_GRASS: 25,
  CRAFTING_TABLE: 26,
  FURNACE: 27,
  STONE_BRICKS: 28,
  DIAMOND_ORE: 29,
  CAMPFIRE: 30,
  FLOW_1: 31,
  FLOW_7: 37,
  FALLING_WATER: 38,
  CHEST: 39, FURNACE_LIT: 40, BED: 41,
  DOOR: 42, DOOR_TOP: 43, DOOR_OPEN: 44, DOOR_TOP_OPEN: 45,
  GATE: 46, GATE_OPEN: 47, LADDER: 48, FARMLAND: 49,
  CROP_0: 50, CROP_1: 51, CROP_2: 52, CROP_3: 53,
  GRAVE: 54, VILLAGE_POST: 55,
  DOOR_X: 56, DOOR_TOP_X: 57, DOOR_OPEN_X: 58, DOOR_TOP_OPEN_X: 59,
  GATE_X: 60, GATE_OPEN_X: 61, LADDER_X: 62, BED_FOOT: 63,

} as const;

export type RenderKind = 'none' | 'solid' | 'cutout' | 'plant' | 'water';

export interface BlockDef {
  id: number;
  name: string;
  render: RenderKind;
  /** Blocks player movement. */
  solid: boolean;
  /** Fully hides neighbouring faces and contributes ambient occlusion. */
  opaque: boolean;
  /** Can be selected by the crosshair raycast (and therefore mined). */
  targetable: boolean;
  /** Placement may overwrite this block (air, water, plants). */
  replaceable: boolean;
  /** Blocks sky light for the ambient sky-visibility term. */
  skyBlocking: boolean;
  /** Seconds of held mining in survival. Infinity = unbreakable. */
  hardness: number;
  /** Item added to the inventory when mined in survival (0 = nothing). */
  drop: number;
  /** Tile per face: +X, -X, +Y, -Y, +Z, -Z. */
  faces: [number, number, number, number, number, number];
  /** Shown in the creative palette / valid as a held item. */
  placeable: boolean;
  /** Leaves sway in the wind. */
  wind: boolean;
  /** Gets the gentle biome colour variation. */
  tint: boolean;
  /** Self-illuminated (glows, feeds bloom). */
  emissive: boolean;
  /** Plants need grass or dirt beneath them. */
  needsSupport: boolean;
  /** Selection / hit box inside the cell (min xyz, max xyz). */
  box: [number, number, number, number, number, number];
  /** Tool that mines this block faster (and, with minTier > 0, is required for a drop). */
  tool: 'pickaxe' | 'axe' | 'shovel' | null;
  /** Minimum tool tier (1 wood, 2 stone, 3 iron) needed for the block to drop anything. */
  minTier: number;
  /** Sound family for dig/place/step effects. */
  sound: 'grass' | 'dirt' | 'stone' | 'wood' | 'sand' | 'glass' | 'snow' | 'leaves';
}

const FULL_BOX: BlockDef['box'] = [0, 0, 0, 1, 1, 1];
const PLANT_BOX: BlockDef['box'] = [0.2, 0, 0.2, 0.8, 0.8, 0.8];

function all(t: TileName): BlockDef['faces'] {
  const i = tile(t);
  return [i, i, i, i, i, i];
}

function pillar(side: TileName, top: TileName, bottom: TileName = top): BlockDef['faces'] {
  const s = tile(side);
  return [s, s, tile(top), tile(bottom), s, s];
}

type Partial2 = Partial<BlockDef> & Pick<BlockDef, 'name' | 'faces'>;

function solid(id: number, d: Partial2): BlockDef {
  return {
    id,
    render: 'solid',
    solid: true,
    opaque: true,
    targetable: true,
    replaceable: false,
    skyBlocking: true,
    hardness: 0.5,
    drop: id,
    placeable: true,
    wind: false,
    tint: false,
    emissive: false,
    needsSupport: false,
    box: FULL_BOX,
    sound: 'stone',
    tool: null,
    minTier: 0,
    ...d,
  };
}

function plant(id: number, name: string, t: TileName): BlockDef {
  return {
    id,
    name,
    render: 'plant',
    solid: false,
    opaque: false,
    targetable: true,
    replaceable: true,
    skyBlocking: false,
    hardness: 0.05,
    drop: id,
    faces: all(t),
    placeable: true,
    wind: true,
    tint: id === B.TALL_GRASS,
    emissive: false,
    needsSupport: true,
    box: PLANT_BOX,
    sound: 'grass',
    tool: null,
    minTier: 0,
  };
}

export const BLOCKS: BlockDef[] = [];

function reg(def: BlockDef): void {
  BLOCKS[def.id] = def;
}

reg({
  id: B.AIR,
  name: 'Air',
  render: 'none',
  solid: false,
  opaque: false,
  targetable: false,
  replaceable: true,
  skyBlocking: false,
  hardness: 0,
  drop: 0,
  faces: [0, 0, 0, 0, 0, 0],
  placeable: false,
  wind: false,
  tint: false,
  emissive: false,
  needsSupport: false,
  box: FULL_BOX,
  sound: 'stone',
  tool: null,
  minTier: 0,
});
reg(
  solid(B.GRASS, {
    name: 'Grass Block',
    faces: [tile('grass_side'), tile('grass_side'), tile('grass_top'), tile('dirt'), tile('grass_side'), tile('grass_side')],
    hardness: 0.6,
    drop: B.DIRT,
    tint: true,
    sound: 'grass',
    tool: 'shovel',
  }),
);
reg(solid(B.DIRT, { name: 'Dirt', faces: all('dirt'), hardness: 0.5, sound: 'dirt', tool: 'shovel' }));
reg(solid(B.STONE, { name: 'Stone', faces: all('stone'), hardness: 1.5, drop: B.COBBLESTONE, tool: 'pickaxe', minTier: 1 }));
reg(solid(B.COBBLESTONE, { name: 'Cobblestone', faces: all('cobblestone'), hardness: 1.8, tool: 'pickaxe', minTier: 1 }));
reg(solid(B.SAND, { name: 'Sand', faces: all('sand'), hardness: 0.5, sound: 'sand', tool: 'shovel' }));
reg(solid(B.GRAVEL, { name: 'Gravel', faces: all('gravel'), hardness: 0.6, sound: 'sand', tool: 'shovel' }));
reg(solid(B.OAK_LOG, { name: 'Oak Log', faces: pillar('oak_log_side', 'oak_log_top'), hardness: 1.6, sound: 'wood', tool: 'axe' }));
reg(
  solid(B.OAK_LEAVES, {
    name: 'Oak Leaves',
    faces: all('oak_leaves'),
    render: 'cutout',
    opaque: false,
    skyBlocking: false,
    hardness: 0.15,
    drop: 0,
    wind: true,
    tint: true,
    sound: 'leaves',
  }),
);
reg(solid(B.OAK_PLANKS, { name: 'Oak Planks', faces: all('oak_planks'), hardness: 1.4, sound: 'wood', tool: 'axe' }));
reg(
  solid(B.GLASS, {
    name: 'Glass',
    faces: all('glass'),
    render: 'cutout',
    opaque: false,
    skyBlocking: false,
    hardness: 0.2,
    sound: 'glass',
  }),
);
reg(solid(B.BRICKS, { name: 'Bricks', faces: all('bricks'), hardness: 1.8, tool: 'pickaxe', minTier: 1 }));
reg(solid(B.SNOW, { name: 'Snow', faces: all('snow'), hardness: 0.3, sound: 'snow', tool: 'shovel' }));
reg(solid(B.COAL_ORE, { name: 'Coal Ore', faces: all('coal_ore'), hardness: 2.2, drop: 257, tool: 'pickaxe', minTier: 1 }));
reg(solid(B.IRON_ORE, { name: 'Iron Ore', faces: all('iron_ore'), hardness: 2.6, tool: 'pickaxe', minTier: 2 }));
reg(solid(B.BIRCH_LOG, { name: 'Birch Log', faces: pillar('birch_log_side', 'birch_log_top'), hardness: 1.6, sound: 'wood', tool: 'axe' }));
reg(
  solid(B.BIRCH_LEAVES, {
    name: 'Birch Leaves',
    faces: all('birch_leaves'),
    render: 'cutout',
    opaque: false,
    skyBlocking: false,
    hardness: 0.15,
    drop: 0,
    wind: true,
    sound: 'leaves',
  }),
);
reg(solid(B.SANDSTONE, { name: 'Sandstone', faces: pillar('sandstone_side', 'sandstone_top'), hardness: 1.2, tool: 'pickaxe', minTier: 1 }));
reg(plant(B.TALL_GRASS, 'Tall Grass', 'tall_grass'));
reg(plant(B.RED_FLOWER, 'Poppy', 'red_flower'));
reg(plant(B.YELLOW_FLOWER, 'Buttercup', 'yellow_flower'));
reg({
  id: B.WATER,
  name: 'Water',
  render: 'water',
  solid: false,
  opaque: false,
  targetable: false,
  replaceable: true,
  skyBlocking: true,
  hardness: Infinity,
  drop: 0,
  faces: all('water'),
  placeable: false,
  wind: false,
  tint: false,
  emissive: false,
  needsSupport: false,
  box: FULL_BOX,
  sound: 'sand',
  tool: null,
  minTier: 0,
});
reg(solid(B.BEDROCK, { name: 'Bedrock', faces: all('bedrock'), hardness: Infinity, drop: 0, placeable: false }));
reg(solid(B.GLOW_LAMP, { name: 'Glow Lamp', faces: all('glow_lamp'), hardness: 0.3, emissive: true, sound: 'glass' }));
reg(solid(B.CLAY, { name: 'Clay', faces: all('clay'), hardness: 0.6, sound: 'dirt', tool: 'shovel' }));
reg(
  solid(B.SNOWY_GRASS, {
    name: 'Snowy Grass',
    faces: [tile('snow_side'), tile('snow_side'), tile('snow'), tile('dirt'), tile('snow_side'), tile('snow_side')],
    hardness: 0.6,
    drop: B.DIRT,
    sound: 'snow',
    tool: 'shovel',
    placeable: false,
  }),
);
reg(
  solid(B.CRAFTING_TABLE, {
    name: 'Crafting Table',
    faces: [tile('crafting_table_side'), tile('crafting_table_side'), tile('crafting_table_top'), tile('oak_planks'), tile('crafting_table_side'), tile('crafting_table_side')],
    hardness: 1.5,
    sound: 'wood',
    tool: 'axe',
  }),
);
reg(
  solid(B.FURNACE, {
    name: 'Furnace',
    faces: [tile('furnace_side'), tile('furnace_side'), tile('furnace_top'), tile('furnace_top'), tile('furnace_front'), tile('furnace_side')],
    hardness: 2.2,
    tool: 'pickaxe',
    minTier: 1,
  }),
);

reg(solid(B.STONE_BRICKS, { name: 'Stone Bricks', faces: all('stone_bricks'), hardness: 1.6, tool: 'pickaxe', minTier: 1 }));
reg(solid(B.DIAMOND_ORE, { name: 'Diamond Ore', faces: all('diamond_ore'), hardness: 3, tool: 'pickaxe', minTier: 3, drop: 259 }));
reg(solid(B.CAMPFIRE, { name: 'Campfire', faces: all('campfire'), hardness: 0.5, tool: 'axe', emissive: true, sound: 'wood' }));
// Source and flow states are block IDs, so saves preserve fluid state exactly.
BLOCKS[B.WATER].placeable = true;
for (let id = B.FLOW_1; id <= B.FALLING_WATER; id++) reg({ ...BLOCKS[B.WATER], id, placeable: false });
export function isWater(id: number): boolean { return id === B.WATER || (id >= B.FLOW_1 && id <= B.FALLING_WATER); }
export function waterLevel(id: number): number { return id === B.WATER || id === B.FALLING_WATER ? 0 : id - B.FLOW_1 + 1; }
reg(solid(B.CHEST, { name: 'Chest', faces: pillar('chest_front', 'chest_top'), hardness: 1.4, sound: 'wood', tool: 'axe', opaque: false, box: [.05,0,.05,.95,.88,.95] }));
reg({ ...BLOCKS[B.FURNACE], id: B.FURNACE_LIT, name: 'Burning Furnace', drop: B.FURNACE, placeable: false, emissive: true, faces: [tile('furnace_side'),tile('furnace_side'),tile('furnace_top'),tile('furnace_top'),tile('furnace_lit'),tile('furnace_side')] });
reg(solid(B.BED, { name: 'Bed', faces: pillar('bed_side', 'bed_top'), hardness: .4, tool: 'axe', sound: 'wood', opaque: false, box: [0,0,0,1,.55,1] }));
reg({ ...BLOCKS[B.BED], id: B.BED_FOOT, placeable: false, drop: B.BED, faces: pillar('bed_side', 'bed_side') });
for (const [base, top, opened, topOpen, axis] of [[B.DOOR,B.DOOR_TOP,B.DOOR_OPEN,B.DOOR_TOP_OPEN,0],[B.DOOR_X,B.DOOR_TOP_X,B.DOOR_OPEN_X,B.DOOR_TOP_OPEN_X,1]]) {
  const box: BlockDef['box'] = axis ? [.0,0,0,.16,1,1] : [0,0,.0,1,1,.16];
  const openBox: BlockDef['box'] = axis ? [0,0,0,1,1,.16] : [0,0,0,.16,1,1];
  reg(solid(base, { name: 'Oak Door', faces: all('door'), opaque: false, skyBlocking: false, sound: 'wood', tool: 'axe', hardness: .8, drop: B.DOOR, placeable: base === B.DOOR, box }));
  reg({ ...BLOCKS[base], id: top, placeable: false, drop: 0 });
  reg({ ...BLOCKS[base], id: opened, solid: false, placeable: false, box: openBox });
  reg({ ...BLOCKS[top], id: topOpen, solid: false, box: openBox });
}
for (const [id, opened, axis] of [[B.GATE,B.GATE_OPEN,0],[B.GATE_X,B.GATE_OPEN_X,1]]) {
  reg(solid(id, { name: 'Fence Gate', faces: all('gate'), render: 'cutout', opaque: false, skyBlocking: false, sound: 'wood', tool: 'axe', hardness: .6, drop: B.GATE, placeable: id === B.GATE, box: axis ? [.38,0,0,.62,1,1] : [0,0,.38,1,1,.62] }));
  reg({ ...BLOCKS[id], id: opened, solid: false, placeable: false, box: axis ? [0,0,0,1,1,.18] : [0,0,0,.18,1,1] });
}
reg(solid(B.LADDER, { name: 'Ladder', faces: all('ladder'), render: 'cutout', solid: false, opaque: false, skyBlocking: false, sound: 'wood', tool: 'axe', hardness: .3, box: [0,0,.42,1,1,.58] }));
reg({ ...BLOCKS[B.LADDER], id: B.LADDER_X, placeable: false, drop: B.LADDER, box: [.42,0,0,.58,1,1] });
reg(solid(B.FARMLAND, { name: 'Tilled Soil', faces: pillar('dirt','farmland'), tool: 'shovel', sound: 'dirt', hardness: .5, drop: B.DIRT, placeable: false }));
for (let stage = 0; stage < 4; stage++) reg({ ...plant(B.CROP_0 + stage, stage === 3 ? 'Ripe Wheat' : 'Growing Wheat', (['crop_young','crop_mid','crop_tall','crop_ripe'] as TileName[])[stage]), placeable: false, replaceable: false, drop: stage === 3 ? 291 : 290, tint: false, box: [.15,0,.15,.85,.3+stage*.22,.85] });
reg(solid(B.GRAVE, { name: 'Recovery Backpack', faces: all('grave'), hardness: Infinity, drop: 0, placeable: false, opaque: false, box: [.15,0,.15,.85,.75,.85], sound: 'wood' }));
reg(solid(B.VILLAGE_POST, { name: 'Village Noticeboard', faces: all('village_post'), hardness: 1, tool: 'axe', sound: 'wood', placeable: false, drop: B.OAK_PLANKS }));
export const isFurnace = (id: number): boolean => id === B.FURNACE || id === B.FURNACE_LIT;
export const isCrop = (id: number): boolean => id >= B.CROP_0 && id <= B.CROP_3;
export const isDoor = (id: number): boolean => (id >= B.DOOR && id <= B.DOOR_TOP_OPEN) || (id >= B.DOOR_X && id <= B.DOOR_TOP_OPEN_X);
export const doorBottom = (id: number): number => id >= B.DOOR_X ? B.DOOR_X : B.DOOR;
export const isGate = (id: number): boolean => [B.GATE,B.GATE_OPEN,B.GATE_X,B.GATE_OPEN_X].includes(id as never);
export const isLadder = (id: number): boolean => id === B.LADDER || id === B.LADDER_X;
export const isBed = (id: number): boolean => id === B.BED || id === B.BED_FOOT;
export const BLOCK_COUNT = BLOCKS.length;

// Fast lookup tables used in hot loops (meshing, physics, raycasting).
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const IS_TARGETABLE = new Uint8Array(256);
export const IS_SKY_BLOCKING = new Uint8Array(256);
export const IS_REPLACEABLE = new Uint8Array(256);
/** 0 none, 1 solid, 2 cutout, 3 plant, 4 water */
export const RENDER_KIND = new Uint8Array(256);
/** Whether a block darkens the corners of adjacent faces (ambient occlusion). */
export const IS_OCCLUDER = new Uint8Array(256);

for (const b of BLOCKS) {
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_TARGETABLE[b.id] = b.targetable ? 1 : 0;
  IS_SKY_BLOCKING[b.id] = b.skyBlocking ? 1 : 0;
  IS_REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
  RENDER_KIND[b.id] = { none: 0, solid: 1, cutout: 2, plant: 3, water: 4 }[b.render];
  IS_OCCLUDER[b.id] = b.opaque || b.id === B.OAK_LEAVES || b.id === B.BIRCH_LEAVES ? 1 : 0;
}

/** Blocks shown in the creative palette, in display order. */
export const PALETTE: number[] = [
  B.GRASS,
  B.DIRT,
  B.STONE,
  B.COBBLESTONE,
  B.OAK_PLANKS,
  B.OAK_LOG,
  B.BIRCH_LOG,
  B.BRICKS,
  B.GLASS,
  B.SAND,
  B.SANDSTONE,
  B.GRAVEL,
  B.CLAY,
  B.SNOW,
  B.OAK_LEAVES,
  B.BIRCH_LEAVES,
  B.COAL_ORE,
  B.IRON_ORE,
  B.GLOW_LAMP,
  B.CRAFTING_TABLE,
  B.FURNACE, B.CHEST, B.BED, B.DOOR, B.GATE, B.LADDER,
  B.STONE_BRICKS,
  B.DIAMOND_ORE,
  B.CAMPFIRE,
  B.WATER,
  B.TALL_GRASS,
  B.RED_FLOWER,
  B.YELLOW_FLOWER,
];

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0];
}

export function canSupportPlant(id: number): boolean {
  return id === B.GRASS || id === B.DIRT || id === B.SNOWY_GRASS || id === B.FARMLAND;
}

