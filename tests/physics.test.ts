import { describe, it, expect } from 'vitest';
import { B, isWater } from '../src/world/blocks';
import { World } from '../src/world/World';
import { WorldPhysics } from '../src/world/Physics';
import { COLUMN_VOLUME, columnIndex } from '../src/world/constants';
import { Player } from '../src/game/Player';
import { TerrainGenerator } from '../src/world/generator';
import { SHOWCASE_SEED } from '../src/world/showcase';
import { I, toolOf, RECIPES } from '../src/game/items';

function setup() {
  const world = new World();
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
    const data = new Uint8Array(COLUMN_VOLUME);
    for (let zz = 0; zz < 16; zz++) for (let xx = 0; xx < 16; xx++) data[columnIndex(xx, 10, zz)] = B.STONE;
    world.addColumn(x, z, data);
  }
  const sim = new WorldPhysics(world);
  const tick = (n: number) => { for (let i = 0; i < n; i++) sim.update(0.11, () => false); };
  return { world, sim, tick };
}
describe('block simulation', () => {
  it('spreads seven cells from a source and drains after source removal', () => {
    const { world, tick } = setup();
    world.setBlock(0, 11, 0, B.WATER); tick(60);
    expect(world.getBlock(7, 11, 0)).toBe(B.FLOW_7);
    expect(world.getBlock(8, 11, 0)).toBe(B.AIR);
    world.setBlock(0, 11, 0, B.AIR); tick(150);
    for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) expect(isWater(world.getBlock(x, 11, z))).toBe(false);
  });
  it('water falls at any altitude, stops at a solid floor and spreads there', () => {
    const { world, tick } = setup();
    world.setBlock(0, 70, 0, B.WATER); tick(180);
    expect(world.getBlock(0, 30, 0)).toBe(B.FALLING_WATER);
    expect(isWater(world.getBlock(2, 11, 0))).toBe(true);
    expect(world.getBlock(0, 10, 0)).toBe(B.STONE);
  });
  it('sand settles through water without overwriting an occupied player cell', () => {
    const { world, sim, tick } = setup();
    world.setBlock(0, 12, 0, B.WATER);
    world.setBlock(0, 13, 0, B.SAND);
    sim.update(0.11, (x, y, z) => x === 0 && y === 12 && z === 0);
    expect(world.getBlock(0, 13, 0)).toBe(B.SAND);
    tick(20);
    expect(world.getBlock(0, 11, 0)).toBe(B.SAND);
  });
  it('flows across loaded chunk boundaries and preserves flow IDs in edit records', () => {
    const { world, tick } = setup();
    world.setBlock(15, 11, 0, B.WATER); tick(40);
    expect(world.getBlock(16, 11, 0)).toBe(B.FLOW_1);
    expect(world.edits.get(world.getColumn(1, 0)!.key)!.get(columnIndex(0, 11, 0))).toBe(B.FLOW_1);
  });
});
it('sneaking prevents walking off a one-block platform', () => {
  const { world } = setup();
  for (let x = -15; x <= 30; x++) for (let z = -15; z <= 30; z++) world.setBlock(x, 10, z, B.AIR);
  world.setBlock(0, 10, 0, B.STONE);
  const p = new Player(world); p.x = .5; p.y = 11; p.z = .5; p.onGround = true;
  for (let i = 0; i < 300; i++) p.update(1 / 60, { forward: 0, strafe: 1, jump: false, down: false, sprint: false, sneak: true }, false);
  expect(p.y).toBeCloseTo(11); expect(p.x).toBeLessThan(1.31);
});
it('Hearthvale has a safe spawn, interiors, river, mine and deterministic structures', () => {
  const gen = new TerrainGenerator(SHOWCASE_SEED);
  expect(gen.spawn).toEqual({ x: .5, y: 61, z: 28.5 });
  const block = (x: number, y: number, z: number) => gen.generateColumn(x >> 4, z >> 4)[columnIndex(x & 15, y, z & 15)];
  expect(block(0, 60, 28)).toBe(B.COBBLESTONE);
  expect(block(0, 61, 28)).toBe(B.AIR);
  expect(block(-20, 62, -14)).toBe(B.AIR);
  expect(block(27, 59, 0)).toBe(B.WATER);
  expect(block(-38, 61, 22)).toBe(B.AIR);
  expect(gen.generateColumn(-1, -3)).toEqual(new TerrainGenerator(SHOWCASE_SEED).generateColumn(-1, -3));
});
it('diamond tools have durable tier-four progression and craftable recipes', () => {
  expect(toolOf(I.DIAMOND_PICKAXE)).toMatchObject({ tier: 4, durability: 1561 });
  expect(RECIPES.find(r => r.out === I.DIAMOND_PICKAXE)?.in).toContainEqual([I.DIAMOND, 3]);
});
