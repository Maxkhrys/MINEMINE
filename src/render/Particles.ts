import * as THREE from 'three';
import { mulberry32 } from '../world/noise';
import { sampleTileColor } from './textures';

const MAX = 256;

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  color: THREE.Color;
}

/** Small textured-colour cubes that burst out of broken blocks. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private parts: P[] = [];
  private rand = mulberry32(1234);
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(
    private tiles: Uint8ClampedArray[],
    private isSolid: (x: number, y: number, z: number) => boolean,
  ) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
  }

  burst(x: number, y: number, z: number, layer: number, count = 18): void {
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const p: P = {
        x: x + 0.15 + this.rand() * 0.7,
        y: y + 0.15 + this.rand() * 0.7,
        z: z + 0.15 + this.rand() * 0.7,
        vx: (this.rand() - 0.5) * 3,
        vy: this.rand() * 3.5 + 1,
        vz: (this.rand() - 0.5) * 3,
        life: 0.5 + this.rand() * 0.6,
        size: 0.06 + this.rand() * 0.07,
        color: new THREE.Color(),
      };
      const c = sampleTileColor(this.tiles, layer, this.rand);
      p.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
      this.parts.push(p);
    }
  }

  update(dt: number): void {
    const alive: P[] = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      if (this.isSolid(Math.floor(p.x), Math.floor(ny - p.size / 2), Math.floor(p.z))) {
        p.vy = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      } else p.y = ny;
      if (!this.isSolid(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) p.x = nx;
      else p.vx = 0;
      if (!this.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))) p.z = nz;
      else p.vz = 0;
      alive.push(p);
    }
    this.parts = alive;
    for (let i = 0; i < alive.length; i++) {
      const p = alive[i];
      const s = p.size * Math.min(1, p.life * 3);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = alive.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.parts = [];
    this.mesh.count = 0;
  }
}
