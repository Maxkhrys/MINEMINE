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
});
reg(
  solid(B.GRASS, {
    name: 'Grass Block',
    faces: [tile('grass_side'), tile('grass_side'), tile('grass_top'), tile('dirt'), tile('grass_side'), tile('grass_side')],
    hardness: 0.45,
    drop: B.DIRT,
    tint: true,
    sound: 'grass',
  }),
);
reg(solid(B.DIRT, { name: 'Dirt', faces: all('dirt'), hardness: 0.4, sound: 'dirt' }));
reg(solid(B.STONE, { name: 'Stone', faces: all('stone'), hardness: 0.9, drop: B.COBBLESTONE }));
reg(solid(B.COBBLESTONE, { name: 'Cobblestone', faces: all('cobblestone'), hardness: 1.0 }));
reg(solid(B.SAND, { name: 'Sand', faces: all('sand'), hardness: 0.4, sound: 'sand' }));
reg(solid(B.GRAVEL, { name: 'Gravel', faces: all('gravel'), hardness: 0.45, sound: 'sand' }));
reg(solid(B.OAK_LOG, { name: 'Oak Log', faces: pillar('oak_log_side', 'oak_log_top'), hardness: 0.8, sound: 'wood' }));
reg(
  solid(B.OAK_LEAVES, {
    name: 'Oak Leaves',
    faces: all('oak_leaves'),
    render: 'cutout',
    opaque: false,
    skyBlocking: false,
    hardness: 0.15,
    wind: true,
    tint: true,
    sound: 'leaves',
  }),
);
reg(solid(B.OAK_PLANKS, { name: 'Oak Planks', faces: all('oak_planks'), hardness: 0.7, sound: 'wood' }));
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
reg(solid(B.BRICKS, { name: 'Bricks', faces: all('bricks'), hardness: 1.0 }));
reg(solid(B.SNOW, { name: 'Snow', faces: all('snow'), hardness: 0.25, sound: 'snow' }));
reg(solid(B.COAL_ORE, { name: 'Coal Ore', faces: all('coal_ore'), hardness: 1.2 }));
reg(solid(B.IRON_ORE, { name: 'Iron Ore', faces: all('iron_ore'), hardness: 1.4 }));
reg(solid(B.BIRCH_LOG, { name: 'Birch Log', faces: pillar('birch_log_side', 'birch_log_top'), hardness: 0.8, sound: 'wood' }));
reg(
  solid(B.BIRCH_LEAVES, {
    name: 'Birch Leaves',
    faces: all('birch_leaves'),
    render: 'cutout',
    opaque: false,
    skyBlocking: false,
    hardness: 0.15,
    wind: true,
    sound: 'leaves',
  }),
);
reg(solid(B.SANDSTONE, { name: 'Sandstone', faces: pillar('sandstone_side', 'sandstone_top'), hardness: 0.7 }));
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
});
reg(solid(B.BEDROCK, { name: 'Bedrock', faces: all('bedrock'), hardness: Infinity, drop: 0, placeable: false }));
reg(solid(B.GLOW_LAMP, { name: 'Glow Lamp', faces: all('glow_lamp'), hardness: 0.3, emissive: true, sound: 'glass' }));
reg(solid(B.CLAY, { name: 'Clay', faces: all('clay'), hardness: 0.45, sound: 'dirt' }));
reg(
  solid(B.SNOWY_GRASS, {
    name: 'Snowy Grass',
    faces: [tile('snow_side'), tile('snow_side'), tile('snow'), tile('dirt'), tile('snow_side'), tile('snow_side')],
    hardness: 0.45,
    drop: B.DIRT,
    sound: 'snow',
    placeable: false,
  }),
);

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
  B.TALL_GRASS,
  B.RED_FLOWER,
  B.YELLOW_FLOWER,
];

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0];
}

export function canSupportPlant(id: number): boolean {
  return id === B.GRASS || id === B.DIRT || id === B.SNOWY_GRASS;
}
