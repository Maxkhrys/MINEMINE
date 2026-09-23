import { B } from './blocks';
import { columnIndex, WORLD_HEIGHT } from './constants';
import { seedFromString } from './noise';

export const SHOWCASE_NAME = 'Hearthvale';
export const SHOWCASE_SEED = seedFromString(SHOWCASE_NAME);
export const VILLAGE_Y = 60;

/** Chunk-local writes make structures deterministic, including across chunk borders. */
export function buildShowcase(blocks: Uint8Array, cx: number, cz: number): void {
  const ox = cx * 16, oz = cz * 16;
  if (ox > 90 || ox < -100 || oz > 90 || oz < -100) return;
  const set = (x: number, y: number, z: number, id: number) => {
    if (x >= ox && x < ox + 16 && z >= oz && z < oz + 16 && y > 0 && y < WORLD_HEIGHT)
      blocks[columnIndex(x - ox, y, z - oz)] = id;
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) => {
    for (let z = Math.max(z0, oz); z <= Math.min(z1, oz + 15); z++)
      for (let x = Math.max(x0, ox); x <= Math.min(x1, ox + 15); x++)
        for (let y = y0; y <= y1; y++) set(x, y, z, id);
  };
  // Graded village terrace, with a river cut through its eastern edge.
  for (let z = oz; z < oz + 16; z++) for (let x = ox; x < ox + 16; x++) {
    if (Math.hypot(x, z) > 69) continue;
    box(x, 55, z, x, 59, z, B.DIRT);
    box(x, 60, z, x, 100, z, B.AIR);
    set(x, 60, z, B.GRASS);
    const river = 27 + Math.sin(z * 0.045) * 3;
    if (Math.abs(x - river) < 5) {
      box(x, 55, z, x, 57, z, B.CLAY);
      box(x, 58, z, x, 59, z, B.WATER);
      set(x, 60, z, B.AIR);
    }
    if ((Math.abs(x) <= 2 && z >= -46 && z <= 42) || (Math.abs(z - 12) <= 2 && x >= -42 && x <= 52))
      if (Math.abs(x - river) >= 5) set(x, 60, z, B.COBBLESTONE);
  }
  const lamp = (x: number, z: number) => {
    box(x, 61, z, x, 63, z, B.OAK_LOG);
    set(x, 64, z, B.GLOW_LAMP);
    box(x - 1, 65, z - 1, x + 1, 65, z + 1, B.OAK_PLANKS);
  };
  for (let z = -28; z <= 36; z += 16) { lamp(-4, z); lamp(4, z); }
  const house = (x: number, z: number, w: number, d: number, roof: number) => {
    box(x - 1, 60, z - 1, x + w, 60, z + d, B.COBBLESTONE);
    box(x, 61, z, x + w - 1, 65, z + d - 1, B.OAK_PLANKS);
    box(x + 1, 61, z + 1, x + w - 2, 65, z + d - 2, B.AIR);
    for (const dx of [0, w - 1]) for (const dz of [0, d - 1]) box(x + dx, 61, z + dz, x + dx, 66, z + dz, B.OAK_LOG);
    for (const dz of [0, d - 1]) {
      box(x + 2, 63, z + dz, x + 3, 64, z + dz, B.GLASS);
      box(x + w - 4, 63, z + dz, x + w - 3, 64, z + dz, B.GLASS);
    }
    for (const dx of [0, w - 1]) box(x + dx, 63, z + 3, x + dx, 64, z + d - 4, B.GLASS);
    const door = x + Math.floor(w / 2);
    box(door, 61, z + d - 1, door + 1, 63, z + d, B.AIR);
    for (let r = 0; r <= Math.floor(w / 2); r++) {
      box(x - 1 + r, 66 + r, z - 1, x - 1 + r, 66 + r, z + d, roof);
      box(x + w - r, 66 + r, z - 1, x + w - r, 66 + r, z + d, roof);
      if (r < w / 2) for (const dz of [0, d - 1]) box(x + r, 66 + r, z + dz, x + w - 1 - r, 66 + r, z + dz, B.OAK_PLANKS);
    }
    box(x + 2, 66, z + 2, x + 3, 74, z + 3, B.BRICKS);
    set(x + 2, 75, z + 2, B.CAMPFIRE);
    set(x + 1, 61, z + 1, B.CRAFTING_TABLE);
    set(x + 2, 61, z + 1, B.FURNACE);
    set(x+3,61,z+1,B.CHEST);
    set(x+1,61,z+3,B.BED);set(x+1,61,z+4,B.BED_FOOT);
    set(door,61,z+d-1,B.DOOR);set(door,62,z+d-1,B.DOOR_TOP);
    set(x + w - 2, 64, z + 1, B.GLOW_LAMP);
    box(x + w - 3, 61, z + 2, x + w - 2, 61, z + 4, B.OAK_PLANKS);
    for (let zz = z + d; zz <= z + d + 3; zz++) box(door, 60, zz, door + 1, 60, zz, B.COBBLESTONE);
    for (const dx of [2, w - 3]) { set(x + dx, 61, z + d, B.OAK_LEAVES); set(x + dx, 62, z + d, B.RED_FLOWER); }
  };
  house(-23, -17, 11, 10, B.BRICKS);
  house(8, -16, 10, 9, B.COBBLESTONE);
  house(-24, 20, 12, 11, B.COBBLESTONE);
  house(40, -9, 10, 12, B.BRICKS);
  // Town fountain and campfire court.
  box(-10, 60, 1, -4, 60, 7, B.BRICKS);
  box(-9, 61, 2, -5, 61, 6, B.COBBLESTONE);
  box(-8, 61, 3, -6, 61, 5, B.WATER);
  box(-7, 61, 4, -7, 64, 4, B.COBBLESTONE);
  set(-7, 65, 4, B.GLOW_LAMP);
  set(10, 61, 23, B.CAMPFIRE);
  box(7, 61, 26, 13, 61, 26, B.OAK_LOG);
  // Broad timber bridge with pier supports and protective parapets.
  box(20, 60, 9, 37, 60, 15, B.OAK_PLANKS);
  for (const z of [9, 15]) {
    box(20, 61, z, 37, 61, z, B.OAK_LOG);
    for (const x of [21, 28, 36]) { box(x, 56, z, x, 62, z, B.OAK_LOG); set(x, 63, z, B.GLOW_LAMP); }
  }
  // Keep: walkable gateway, courtyard, corner towers and battlements.
  box(-16, 60, -56, 16, 60, -32, B.COBBLESTONE);
  for (const x of [-16, 16]) box(x, 61, -56, x, 68, -32, B.STONE_BRICKS);
  for (const z of [-56, -32]) box(-16, 61, z, 16, 68, z, B.STONE_BRICKS);
  box(-2, 61, -33, 2, 65, -31, B.AIR);
  for (let x = -16; x <= 16; x += 2) for (const z of [-56, -32]) set(x, 69, z, B.STONE_BRICKS);
  for (const tx of [-16, 12]) for (const tz of [-56, -36]) {
    box(tx, 61, tz, tx + 4, 74, tz + 4, B.STONE_BRICKS);
    box(tx + 1, 61, tz + 1, tx + 3, 73, tz + 3, B.AIR);
    box(tx - 1, 74, tz - 1, tx + 5, 74, tz + 5, B.COBBLESTONE);
    for (let a = -1; a <= 5; a += 2) for (const b of [-1, 5]) { set(tx + a, 75, tz + b, B.STONE_BRICKS); set(tx + b, 75, tz + a, B.STONE_BRICKS); }
    set(tx + 2, 75, tz + 2, B.GLOW_LAMP);
  }
  house(-6, -53, 13, 12, B.BRICKS);
  // Windmill across the river, with a clear silhouette from the village.
  box(44, 61, 28, 50, 74, 34, B.SANDSTONE);
  box(45, 61, 29, 49, 73, 33, B.AIR);
  box(46, 61, 28, 48, 63, 29, B.AIR);
  for (let r = 0; r <= 4; r++) box(43 + r, 75 + r, 27 + r, 51 - r, 75 + r, 35 - r, B.BRICKS);
  for (let i = -9; i <= 9; i++) {
    set(47 + i, 72, 26, B.OAK_LOG); set(47, 72 + i, 26, B.OAK_LOG);
    if (Math.abs(i) >= 3) { set(47 + i, 73, 26, B.SNOW); set(48, 72 + i, 26, B.SNOW); }
  }
  set(47, 72, 25, B.GLOW_LAMP);
  // Orchard, kitchen garden and a lane leading to the mine entrance.
  for (const [tx, tz] of [[-32,-27],[-31,1],[-32,39],[14,42],[52,18],[-49,29]]) {
    box(tx, 61, tz, tx, 65, tz, B.OAK_LOG);
    for (let yy = 64; yy <= 67; yy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      if (Math.abs(dx) + Math.abs(dz) < (yy === 67 ? 3 : 5)) set(tx + dx, yy, tz + dz, B.OAK_LEAVES);
  }
  for (let x = 7; x <= 18; x++) for (let z = 32; z <= 40; z++) {
    set(x, 60, z, x % 5 === 0 ? B.WATER : B.GRASS);
    if (x % 5 !== 0) set(x, 61, z, (x + z) % 7 === 0 ? B.YELLOW_FLOWER : B.TALL_GRASS);
  }
  box(-39, 60, 12, -37, 60, 21, B.COBBLESTONE);
  // Spring-fed waterfall, with a plunge pool that drains into the river.
  for (let x = 38; x <= 55; x++) for (let z = -53; z <= -38; z++) {
    const peak = 69 + Math.floor(5 * Math.max(0, 1 - Math.hypot(x - 47, z + 46) / 12));
    box(x, 60, z, x, peak, z, B.STONE);
    set(x, peak, z, B.GRASS);
  }
  box(42, 59, -40, 49, 60, -32, B.WATER);
  box(44, 61, -38, 46, 71, -38, B.FALLING_WATER);
  box(44, 72, -40, 46, 72, -38, B.WATER);
  // Mine: a 3-wide staircase down into an ore cavern, with timber supports.
  for (let i = 0; i < 30; i++) {
    const z = 22 - i, floor = 60 - i;
    box(-40, floor, z, -36, floor + 5, z, B.AIR);
    box(-40, floor, z, -36, floor, z, B.COBBLESTONE);
    if (i % 5 === 0) {
      for (const x of [-40, -36]) box(x, floor + 1, z, x, floor + 4, z, B.OAK_LOG);
      box(-40, floor + 5, z, -36, floor + 5, z, B.OAK_LOG);
      set(-39, floor + 4, z, B.GLOW_LAMP);
    }
  }
  for (let z = -28; z <= -7; z++) for (let x = -51; x <= -25; x++) for (let y = 23; y <= 43; y++) {
    const d = ((x + 38) / 13) ** 2 + ((z + 17) / 11) ** 2 + ((y - 33) / 10) ** 2;
    if (d < 1) set(x, y, z, y <= 25 ? B.WATER : B.AIR);
    else if (d < 1.12 && (x * 7 + y * 13 + z * 3) % 11 === 0) set(x, y, z, y < 31 ? B.DIAMOND_ORE : B.IRON_ORE);
  }
  box(-40, 30, -21, -36, 30, -6, B.OAK_PLANKS);
  for (const z of [-9, -15, -21]) { set(-40, 31, z, B.GLOW_LAMP); set(-36, 31, z, B.GLOW_LAMP); }
  set(0,61,4,B.VILLAGE_POST);
  for(let z=30;z<=36;z++)for(let x=-17;x<=-11;x++){
    set(x,60,z,x===-14?B.WATER:B.FARMLAND);set(x,61,z,x===-14?B.AIR:B.CROP_3);
  }
  set(-14,61,29,B.GATE);
  for(let y=61;y<=67;y++)set(-6,y,-24,B.LADDER);

}
