import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeldItem } from '../src/render/HeldItem';

const make = () => {
  const material = new THREE.MeshBasicMaterial();
  const held = new HeldItem({ solid: material, cutout: material });
  held.setItem(0);
  held.update(1 / 60, 16 / 9, 0, 0, 1);
  const holder = held.scene.children.find(o => o instanceof THREE.Group)!;
  for (let i = 0; i < 60; i++) held.update(1 / 60, 16 / 9, 0, 0, 1);
  return { held, holder };
};

describe('held item motion', () => {
  it('attenuates alternating ground contact and settles at rest', () => {
    const { held, holder } = make();
    let previous = holder.position.clone();
    let largestStep = 0;
    for (let i = 0; i < 120; i++) {
      held.update(1 / 60, 16 / 9, 0, i % 2, 1);
      largestStep = Math.max(largestStep, previous.distanceTo(holder.position));
      previous.copy(holder.position);
    }
    expect(largestStep).toBeLessThan(.003);
    for (let i = 0; i < 120; i++) held.update(1 / 60, 16 / 9, 0, 0, 1);
    expect(holder.position.x).toBeCloseTo(.43, 6);
  });

  it('converges consistently at 30, 60 and 144 fps', () => {
    const positions = [30, 60, 144].map(fps => {
      const { held, holder } = make();
      for (let i = 0; i < fps; i++) held.update(1 / fps, 16 / 9, .7, 1, 1);
      return holder.position.clone();
    });
    expect(positions[0].distanceTo(positions[2])).toBeLessThan(1e-8);
    expect(positions[1].distanceTo(positions[2])).toBeLessThan(1e-8);
  });

  it('does not restart a swing before it returns to rest', () => {
    const { held, holder } = make();
    held.triggerSwing();
    for (let i = 0; i < 31; i++) held.update(.01, 16 / 9, 0, 0, 1);
    held.triggerSwing();
    held.update(.01, 16 / 9, 0, 0, 1);
    held.update(.001, 16 / 9, 0, 0, 1);
    expect(holder.rotation.x).toBeCloseTo(0, 8);
    expect(holder.position.x).toBeCloseTo(.43, 8);
  });
});
