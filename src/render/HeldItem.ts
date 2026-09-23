import * as THREE from 'three';
import { blockDef } from '../world/blocks';
import { buildItemGeometry } from './itemGeometry';

/** First-person view of the selected block, rendered in its own small scene on top of the world. */
export class HeldItem {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private holder = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private currentId = -1;
  private swing = 0;
  private equip = 1;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private geometries = new Map<number, THREE.BufferGeometry>();

  constructor(private materials: { solid: THREE.Material; cutout: THREE.Material }) {
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b5a48, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.sun.position.set(0.6, 1, 0.4);
    this.scene.add(this.hemi, this.sun, this.holder);
  }

  setItem(id: number): void {
    if (id === this.currentId) return;
    this.currentId = id;
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh = null;
    }
    this.equip = 0;
    if (!id) return;
    let geo = this.geometries.get(id);
    if (!geo) {
      geo = buildItemGeometry(id);
      this.geometries.set(id, geo);
    }
    const plant = blockDef(id).render === 'plant';
    const cut = blockDef(id).render === 'cutout';
    this.mesh = new THREE.Mesh(geo, plant || cut ? this.materials.cutout : this.materials.solid);
    this.mesh.frustumCulled = false;
    if (plant) {
      this.mesh.scale.setScalar(0.62);
      this.mesh.rotation.set(0, -0.35, 0.1);
    } else {
      this.mesh.scale.setScalar(0.27);
      this.mesh.rotation.set(0.08, Math.PI / 4 + 0.05, 0);
    }
    this.holder.add(this.mesh);
  }

  triggerSwing(): void {
    this.swing = 1;
  }

  update(dt: number, aspect: number, bobPhase: number, bobAmount: number, brightness: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.swing = Math.max(0, this.swing - dt * 4.5);
    this.equip = Math.min(1, this.equip + dt * 5);
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const bx = Math.cos(bobPhase) * 0.018 * bobAmount;
    const by = -Math.abs(Math.sin(bobPhase)) * 0.022 * bobAmount;
    const drop = (1 - this.equip) * 0.35;
    this.holder.position.set(0.56 + bx - s * 0.12, -0.46 + by - drop + s * 0.08, -0.9 - s * 0.14);
    this.holder.rotation.set(-s * 0.7, -s * 0.3, s * 0.25);
    const b = Math.max(0.15, Math.min(1, brightness));
    this.hemi.intensity = 1.6 * b;
    this.sun.intensity = 2.6 * b * b;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.mesh) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
