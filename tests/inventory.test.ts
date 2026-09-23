import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/game/Inventory';
import { I, RECIPES, toolOf } from '../src/game/items';
import { B } from '../src/world/blocks';

const hand = new Set(['hand'] as const);
const planks = RECIPES.find(r => r.out === B.OAK_PLANKS)!;
describe('inventory crafting transactions', () => {
  it('does not lose items or reorder slots when only part of the output fits', () => {
    const inv = new Inventory('survival');
    inv.slots = Array.from({ length: 36 }, () => ({ id: B.STONE, count: 64 }));
    inv.slots[0] = { id: B.OAK_PLANKS, count: 63 };
    inv.slots[1] = { id: B.OAK_LOG, count: 2 };
    inv.slots[2] = { id: I.IRON_PICKAXE, count: 1, dur: 19 };
    const before = inv.serialize(); let changes = 0; inv.onChange(() => changes++);
    expect(inv.craft(planks, hand)).toBe(false);
    expect(inv.serialize()).toEqual(before);
    expect(changes).toBe(0);
  });
  it('uses the slot freed by consuming the final ingredient and emits one complete state', () => {
    const inv = new Inventory('survival');
    inv.slots = Array.from({ length: 36 }, () => ({ id: B.STONE, count: 64 }));
    inv.slots[7] = { id: B.BIRCH_LOG, count: 1 };
    const states: unknown[] = []; inv.onChange(() => states.push(inv.serialize()));
    expect(inv.craft(planks, hand)).toBe(true);
    expect(inv.slots[7]).toEqual({ id: B.OAK_PLANKS, count: 4 });
    expect(states).toHaveLength(1);
  });
  it('stops crafting in Creative when there is no output space', () => {
    const inv = new Inventory('creative');
    inv.slots = Array.from({ length: 36 }, () => ({ id: B.STONE, count: 64 }));
    expect(inv.craft(planks, hand)).toBe(false);
  });
  it('keeps durability when returning a held tool and requires stations for crafting', () => {
    const inv = new Inventory('survival');
    expect(inv.add(I.IRON_PICKAXE, 1, 23)).toBe(0);
    expect(inv.slots[0]?.dur).toBe(23);
    inv.add(I.DIAMOND, 3); inv.add(I.STICK, 2);
    const recipe = RECIPES.find(r => r.out === I.DIAMOND_PICKAXE)!;
    expect(inv.craft(recipe, hand)).toBe(false);
    expect(inv.craft(recipe, new Set(['hand', 'table']))).toBe(true);
    expect(inv.count(I.DIAMOND)).toBe(0);
    expect(inv.slots.find(s => s?.id === I.DIAMOND_PICKAXE)?.dur).toBe(toolOf(I.DIAMOND_PICKAXE)!.durability);
  });
});
