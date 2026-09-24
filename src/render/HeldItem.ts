import * as THREE from 'three';
import { pixelItemGeometry } from './pixelItem';
import { blockDef } from '../world/blocks';
import { buildItemGeometry } from './itemGeometry';
import { toolOf } from '../game/items';

/** First-person view of the selected block, rendered in its own small scene on top of the world. */
export class HeldItem {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private holder = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private currentId = -1;
  private swing = 0;
  private bobX = 0;
  private bobY = 0;
  use:'none'|'eat'|'bow'|'block'='none';
  useProgress=0;
  private offhand=new THREE.Group();
  private equip = 1;
  private arm = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private geometries = new Map<number, THREE.BufferGeometry>();

  /** Supplies the pixel-art canvas for non-block items (tools, food). */
  itemSprite: ((id: number) => HTMLCanvasElement | null) | null = null;
  private spriteMats = new Map<number, THREE.Material>();


  constructor(private materials: { solid: THREE.Material; cutout: THREE.Material }) {
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b5a48, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.sun.position.set(0.6, 1, 0.4);
    this.scene.add(this.hemi, this.sun, this.holder);
    const skin = new THREE.MeshLambertMaterial({ color: 0xdca77f });
    const cuff = new THREE.MeshLambertMaterial({ color: 0xa9b4a0 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x425d4c });
    const part = (w: number, h: number, d: number, y: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.y = y;
      mesh.frustumCulled = false;
      this.arm.add(mesh);
    };
    part(.16, .18, .18, .055, skin);
    part(.17, .05, .19, -.06, cuff);
    part(.175, .32, .195, -.245, sleeve);
    this.holder.add(this.arm);
    const shield=new THREE.Mesh(new THREE.BoxGeometry(.4,.52,.065),new THREE.MeshLambertMaterial({color:0x826643}));
    const rim=new THREE.Mesh(new THREE.BoxGeometry(.46,.58,.045),new THREE.MeshLambertMaterial({color:0xb5bdb5}));rim.position.z=.035;this.offhand.add(rim,shield);this.offhand.position.set(-.5,-.36,-.82);this.offhand.rotation.y=.25;this.scene.add(this.offhand);this.offhand.visible=false;
  }

  setItem(id: number): void {
    if (id === this.currentId) return;
    this.currentId = id;
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh = null;
    }
    this.equip = 0;
    this.swing = 0;
    this.arm.visible = true;
    this.arm.position.set(id ? 0 : -.025, id ? -.06 : .08, .05);
    this.arm.rotation.set(-.42, -.12, -.17);
    if (!id) return;
    if (id >= 256) {
      let mat = this.spriteMats.get(id);
      const canvas = this.itemSprite?.(id);
      if (!mat && canvas) {
        mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.geometries.set(id, pixelItemGeometry(canvas));
        this.spriteMats.set(id, mat);
      }
      if (!mat) return;
      this.mesh = new THREE.Mesh(this.geometries.get(id), mat);
      this.mesh.frustumCulled = false;
      const tool = !!toolOf(id);
      this.mesh.scale.setScalar(tool ? .64 : .40);
      // Sprite handle runs bottom-left to top-right. Rotate it upright and
      // place its lower grip (pixel 9,24) inside the fist, not at mesh centre.
      this.mesh.rotation.set(-.12, -.30, tool ? .30 : .08);
      if (tool) {
        const grip = new THREE.Vector3(9 / 32 - .5, .5 - 24 / 32, 0);
        grip.multiply(this.mesh.scale).applyEuler(this.mesh.rotation);
        this.mesh.position.set(-grip.x, .025 - grip.y, -grip.z);
      } else {
        this.mesh.position.set(-.015, .10, -.04);
      }
      this.holder.add(this.mesh);
      return;
    }
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
    this.mesh.position.set(0, .10, -.07);
    this.holder.add(this.mesh);
  }

  triggerSwing(): void {
    // Do not restart mid-stroke when dig sounds or break events arrive.
    if (this.swing === 0) this.swing = 1;
  }

  update(dt: number, aspect: number, bobPhase: number, bobAmount: number, brightness: number): void {
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    dt = Math.max(0, Math.min(dt, .1));
    this.swing = Math.max(0, this.swing - dt / .32);
    this.equip = Math.min(1, this.equip + dt * 5);
    const t = 1 - this.swing;
    const active = this.swing > 0 ? 1 : 0;
    const arc = Math.sin(t * Math.PI) ** 2 * active;
    const strike = Math.sin(t * Math.PI) * active;
    const windup = Math.sin(t * Math.PI * 2) * active;
    // Ground contact and speed can change within a physics substep. Filter
    // only locomotion offsets: aiming stays camera-locked and swings stay crisp.
    const blend = -Math.expm1(-14 * dt);
    this.bobX += (Math.cos(bobPhase) * .012 * bobAmount - this.bobX) * blend;
    this.bobY += (-Math.abs(Math.sin(bobPhase)) * .016 * bobAmount - this.bobY) * blend;
    const drop = (1 - this.equip) * 0.35;
    this.holder.position.set(.43 + this.bobX - arc * .25, -.40 + this.bobY - drop + windup * .055, -.85 - strike * .12);
    this.holder.rotation.set(-strike * .65, -arc * .32, windup * .15 + strike * .25);
    this.offhand.visible=this.use==='block';
    if(this.use==='eat'){const chew=Math.sin(this.useProgress*32);this.holder.position.set(.08+chew*.018,-.25+Math.abs(chew)*.06,-.57);this.holder.rotation.set(.15,0,-.55+chew*.1);}
    if(this.use==='bow'){this.holder.position.set(.1,-.28,-.82+this.useProgress*.13);this.holder.rotation.set(0,-.15,-.28);}
    const b = Math.max(0.15, Math.min(1, brightness));
    this.hemi.intensity = 1.6 * b;
    this.sun.intensity = 2.6 * b * b;
  }

  render(renderer: THREE.WebGLRenderer): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
