import * as THREE from 'three';
import { blockDef } from '../world/blocks';

/**
 * Selection outline (drawn from the exact same raycast hit that mining and placement
 * use) and the crack overlay that shows mining progress.
 */
export class Selection {
  readonly outline: THREE.Mesh;
  readonly crack: THREE.Mesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private crackMat: THREE.MeshBasicMaterial;
  private key = '';
  private thickness = 0;

  constructor(private crackStages: THREE.Texture[]) {
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c, toneMapped: false, fog: false });
    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), this.outlineMat);
    this.outline.visible = false;
    this.outline.frustumCulled = false;
    this.outline.renderOrder = 1;

    this.crackMat = new THREE.MeshBasicMaterial({
      map: crackStages[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
      fog: false,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 1;
  }

  private buildFrame(sx: number, sy: number, sz: number, t: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const e = 0.002 + t / 2;
    const hx = sx / 2 + e;
    const hy = sy / 2 + e;
    const hz = sz / 2 + e;
    const edge = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      parts.push(g);
    };
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        edge(sx + 2 * e + t, t, t, 0, a * hy, b * hz);
        edge(t, sy + 2 * e + t, t, a * hx, 0, b * hz);
        edge(t, t, sz + 2 * e + t, a * hx, b * hy, 0);
      }
    }
    // Merge by hand to keep the dependency surface small.
    let count = 0;
    for (const p of parts) count += p.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const idx: number[] = [];
    let off = 0;
    for (const p of parts) {
      const a = p.getAttribute('position') as THREE.BufferAttribute;
      pos.set(a.array as Float32Array, off * 3);
      const pi = p.getIndex()!;
      for (let i = 0; i < pi.count; i++) idx.push(pi.getX(i) + off);
      off += a.count;
      p.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Shows the outline on block (x, y, z) or hides it when `id` is 0. */
  update(x: number, y: number, z: number, id: number, distance: number, progress: number): void {
    if (!id) {
      this.outline.visible = false;
      this.crack.visible = false;
      return;
    }
    const box = blockDef(id).box;
    const sx = box[3] - box[0];
    const sy = box[4] - box[1];
    const sz = box[5] - box[2];
    // Keep lines around two pixels wide regardless of distance.
    const t = Math.min(0.03, Math.max(0.006, distance * 0.0042));
    const key = `${sx},${sy},${sz}`;
    if (key !== this.key || Math.abs(t - this.thickness) > this.thickness * 0.15) {
      this.outline.geometry.dispose();
      this.outline.geometry = this.buildFrame(sx, sy, sz, t);
      this.key = key;
      this.thickness = t;
    }
    const cx = x + (box[0] + box[3]) / 2;
    const cy = y + (box[1] + box[4]) / 2;
    const cz = z + (box[2] + box[5]) / 2;
    this.outline.position.set(cx, cy, cz);
    this.outline.visible = true;

    if (progress > 0) {
      const stage = Math.min(this.crackStages.length - 1, Math.floor(progress * this.crackStages.length));
      this.crackMat.map = this.crackStages[stage];
      this.crack.position.set(cx, cy, cz);
      this.crack.scale.set(sx + 0.004, sy + 0.004, sz + 0.004);
      this.crack.visible = true;
    } else {
      this.crack.visible = false;
    }
  }
}
