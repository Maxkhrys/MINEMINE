import * as THREE from 'three';
import type { Settings } from '../game/settings';
import { ChunkRenderer } from './ChunkRenderer';
import { HeldItem } from './HeldItem';
import {
  createCutoutDepthMaterial,
  createEnvUniforms,
  createSkyMaterial,
  createTerrainMaterial,
  createWaterMaterial,
  type EnvUniforms,
} from './materials';
import { Particles } from './Particles';
import { PostFX } from './PostFX';
import { Selection } from './Selection';
import { createBlockTextures, type BlockTextures } from './textures';

export interface RenderCaps {
  /** Half-float colour buffers are renderable (needed for HDR post-processing). */
  postSupported: boolean;
  maxAnisotropy: number;
  softwareRenderer: boolean;
  gpu: string;
}

const SHADOW_CONFIG = {
  low: { size: 1024, range: 34, radius: 2.5 },
  high: { size: 2048, range: 52, radius: 3 },
  ultra: { size: 4096, range: 76, radius: 3.5 },
} as const;

/** Owns the WebGL renderer, scene graph, lights, sky, effects and graphics settings. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly env: EnvUniforms;
  readonly textures: BlockTextures;
  readonly chunks: ChunkRenderer;
  readonly selection: Selection;
  readonly particles: Particles;
  readonly held: HeldItem;
  readonly caps: RenderCaps;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private post: PostFX | null = null;
  private materials: THREE.Material[] = [];
  private usePost = false;
  private shadowRange = 50;
  private shadowTexel = 0.05;
  /** Set when a shader failed to compile; the game then drops to the safe preset. */
  shaderError = false;
  postFailed = false;
  contextLost = false;

  constructor(canvas: HTMLCanvasElement, isSolid: (x: number, y: number, z: number) => boolean) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderError = true;
      const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n').trim();
      console.warn(`Shader compilation failed; switching to safe graphics.\n${log.slice(0, 600)}`);
    };

    const gl = r.getContext();
    let gpu = 'unknown';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      /* not available */
    }
    this.caps = {
      postSupported: r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float'),
      maxAnisotropy: r.capabilities.getMaxAnisotropy(),
      softwareRenderer: /swiftshader|llvmpipe|software|basic render/i.test(gpu),
      gpu,
    };

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';

    this.env = createEnvUniforms();
    this.textures = createBlockTextures(this.caps.maxAnisotropy);
    this.env.uBlockTex.value = this.textures.array;

    const solid = createTerrainMaterial(this.env, 'solid');
    const cutout = createTerrainMaterial(this.env, 'cutout');
    const water = createWaterMaterial(this.env);
    const cutoutDepth = createCutoutDepthMaterial(this.env);
    this.materials.push(solid, cutout, water, cutoutDepth);
    this.chunks = new ChunkRenderer({ solid, cutout, water, cutoutDepth });
    this.scene.add(this.chunks.group);

    // Lighting: warm sun with soft shadows, sky/ground hemisphere for ambient light.
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xb4cfff, 0x8f8270, 2.35);
    this.scene.add(this.hemi);

    const skyMat = createSkyMaterial(this.env);
    this.materials.push(skyMat);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.scene.add(this.sky);

    this.selection = new Selection(this.textures.crack);
    this.scene.add(this.selection.outline, this.selection.crack);
    this.particles = new Particles(this.textures.tiles, isSolid);
    this.scene.add(this.particles.mesh);
    this.held = new HeldItem({ solid, cutout });

    this.setSunDirection(new THREE.Vector3(0.52, 0.64, 0.56));

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.textures.array.needsUpdate = true;
      for (const m of this.materials) m.needsUpdate = true;
    });
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.env.uSunDir.value.copy(dir).normalize();
  }

  get postActive(): boolean {
    return this.usePost;
  }

  /** Applies graphics settings. Safe to call at any time; falls back when a feature is unsupported. */
  applySettings(s: Settings): void {
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(Math.max(0.35, dpr * s.resolutionScale));

    const shadowsOn = s.shadows !== 'off';
    const shadowStateChanged = r.shadowMap.enabled !== shadowsOn;
    r.shadowMap.enabled = shadowsOn;
    this.sun.castShadow = shadowsOn;
    if (shadowsOn) {
      const cfg = SHADOW_CONFIG[s.shadows as keyof typeof SHADOW_CONFIG];
      const sh = this.sun.shadow;
      if (sh.mapSize.x !== cfg.size) {
        sh.mapSize.set(cfg.size, cfg.size);
        sh.map?.dispose();
        sh.map = null;
      }
      sh.radius = cfg.radius;
      const cam = sh.camera as THREE.OrthographicCamera;
      cam.left = -cfg.range;
      cam.right = cfg.range;
      cam.top = cfg.range;
      cam.bottom = -cfg.range;
      cam.near = 1;
      cam.far = 420;
      cam.updateProjectionMatrix();
      this.shadowRange = cfg.range;
      this.shadowTexel = (cfg.range * 2) / cfg.size;
      sh.normalBias = Math.max(0.025, this.shadowTexel * 0.8);
    }
    if (shadowStateChanged) for (const m of this.materials) m.needsUpdate = true;

    this.usePost = s.postprocessing && this.caps.postSupported && !this.postFailed;
    if (this.usePost && !this.post) this.post = new PostFX();
    if (this.post) {
      this.post.options = { ssao: s.ssao, bloom: s.bloom, msaa: s.antialias };
    }

    this.env.uWind.value = s.animation ? 1 : 0;
    this.env.uClouds.value = s.clouds ? 1 : 0;

    const viewDist = s.renderDistance * 16;
    this.env.uFogFar.value = viewDist - 6;
    this.env.uFogNear.value = viewDist * 0.45;
    this.env.uFogDensity.value = 0.0022;
    this.camera.far = viewDist + 96;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.post.setSize(size.x, size.y);
    }
  }

  /** Keeps the shadow frustum centred on the player, snapped to texels to avoid shimmering. */
  private updateShadowCamera(focus: THREE.Vector3): void {
    const sunDir = this.env.uSunDir.value;
    const f = new THREE.Vector3().copy(sunDir).negate();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f);
    const t = this.shadowTexel;
    const pr = Math.round(focus.dot(right) / t) * t;
    const pu = Math.round(focus.dot(up) / t) * t;
    const pf = focus.dot(f);
    const center = new THREE.Vector3().addScaledVector(right, pr).addScaledVector(up, pu).addScaledVector(f, pf);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(sunDir, 200);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  render(time: number, underwater: boolean): void {
    if (this.contextLost) return;
    this.env.uTime.value = time;
    this.env.uUnderwater.value = underwater ? 1 : 0;
    this.sky.position.copy(this.camera.position);
    if (this.sun.castShadow) this.updateShadowCamera(this.camera.position);

    if (this.usePost && this.post) {
      try {
        this.post.render(this.renderer, this.scene, this.camera, time, underwater);
      } catch (err) {
        // Anything going wrong in the effect chain falls back to direct rendering.
        console.warn('Post-processing failed, disabling it.', err);
        this.postFailed = true;
        this.usePost = false;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    this.held.render(this.renderer);
  }

  get shadowDistance(): number {
    return this.shadowRange;
  }
}
