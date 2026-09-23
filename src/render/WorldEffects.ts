import * as THREE from 'three';
import { B } from '../world/blocks';
import type { World, Column } from '../world/World';
import type { EnvUniforms } from './materials';

/** Fixed-size effects pools: cost does not grow with the total number of lamps. */
export class WorldEffects {
  private scanned = new Map<number, Column>();
  private sources = new Map<number, Map<string, { x: number; y: number; z: number; fire: boolean }>>();
  private flames: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private rippleSlot = 0;
  private lastRipple = -1;
  constructor(private world: World, scene: THREE.Scene, private env: EnvUniforms) {
    this.flames = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xffad32, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), 96);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.23, 1), new THREE.MeshBasicMaterial({ color: 0x8d8882, transparent: true, opacity: 0.17, depthWrite: false }), 64);
    this.flames.frustumCulled = this.smoke.frustumCulled = false;
    this.flames.count = this.smoke.count = 0;
    scene.add(this.flames, this.smoke);
    world.onEdit((x, y, z, _old, id) => {
      const col = world.getColumn(x >> 4, z >> 4);
      if (!col) return;
      const map = this.sources.get(col.key);
      if (!map) return;
      const key = `${x},${y},${z}`;
      map.delete(key);
      if (id === B.GLOW_LAMP || id === B.CAMPFIRE) map.set(key, { x: x + 0.5, y: y + 0.7, z: z + 0.5, fire: id === B.CAMPFIRE });
    });
  }
  clear(): void { this.scanned.clear(); this.sources.clear(); this.flames.count = this.smoke.count = 0; }
  ripple(x: number, z: number, time: number, strength: number): void {
    if (time - this.lastRipple < 0.22) return;
    this.lastRipple = time;
    this.env.uRipples.value[this.rippleSlot].set(x, z, time, strength);
    this.rippleSlot = (this.rippleSlot + 1) % 8;
  }
  update(time: number, camera: THREE.Vector3, heldLamp: boolean): void {
    for (const [key, col] of this.scanned) if (this.world.columns.get(key) !== col) { this.scanned.delete(key); this.sources.delete(key); }
    let budget = 2;
    for (const [key, col] of this.world.columns) {
      if (this.scanned.has(key)) continue;
      if (budget-- <= 0) break;
      this.scanned.set(key, col);
      const map = new Map<string, { x: number; y: number; z: number; fire: boolean }>();
      for (let i = 0; i < col.blocks.length; i++) {
        const id = col.blocks[i];
        if (id !== B.GLOW_LAMP && id !== B.CAMPFIRE) continue;
        const x = col.cx * 16 + (i & 15), z = col.cz * 16 + ((i >> 4) & 15), y = i >> 8;
        map.set(`${x},${y},${z}`, { x: x + 0.5, y: y + 0.7, z: z + 0.5, fire: id === B.CAMPFIRE });
      }
      this.sources.set(key, map);
    }
    const near = [...this.sources.values()].flatMap(m => [...m.values()])
      .filter(p => (p.x - camera.x) ** 2 + (p.y - camera.y) ** 2 + (p.z - camera.z) ** 2 < 70 ** 2)
      .sort((a, b) => ((a.x - camera.x) ** 2 + (a.y - camera.y) ** 2 + (a.z - camera.z) ** 2) - ((b.x - camera.x) ** 2 + (b.y - camera.y) ** 2 + (b.z - camera.z) ** 2));
    const lights = this.env.uLocalLights.value;
    for (const l of lights) l.set(0, 0, 0, 0);
    let li = 0;
    if (heldLamp) lights[li++].set(camera.x, camera.y, camera.z, 1.2);
    for (const p of near) {
      if (li >= lights.length) break;
      lights[li++].set(p.x, p.y, p.z, p.fire ? 1.4 + Math.sin(time * 13 + p.x) * 0.15 : 1.1);
    }
    let f = 0, s = 0;
    for (const p of near.filter(p => p.fire).slice(0, 8)) {
      for (let i = 0; i < 12; i++) {
        const age = (time * 0.85 + i / 12) % 1;
        this.dummy.position.set(p.x + Math.sin(i * 12 + time * 2) * (0.3 - age * 0.2), p.y + 0.25 + age * 1.7, p.z + Math.cos(i * 9 + time) * 0.24);
        this.dummy.scale.setScalar((1 - age) * 1.5);
        this.dummy.updateMatrix(); this.flames.setMatrixAt(f++, this.dummy.matrix);
      }
      for (let i = 0; i < 8; i++) {
        const age = (time * 0.15 + i / 8) % 1;
        this.dummy.position.set(p.x + age * 1.8, p.y + 1.3 + age * 5, p.z + Math.sin(i + time * 0.3) * age);
        this.dummy.scale.setScalar(Math.sin(age * Math.PI) * 2.4);
        this.dummy.updateMatrix(); this.smoke.setMatrixAt(s++, this.dummy.matrix);
      }
    }
    this.flames.count = f; this.smoke.count = s;
    this.flames.instanceMatrix.needsUpdate = this.smoke.instanceMatrix.needsUpdate = true;
  }
}
