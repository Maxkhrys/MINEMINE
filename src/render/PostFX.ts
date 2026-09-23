import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface PostOptions {
  ssao: boolean;
  bloom: boolean;
  msaa: boolean;
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function kernel(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.85 + 0.15).normalize();
    let s = i / n;
    s = 0.15 + 0.85 * s * s;
    out.push(v.multiplyScalar(s * (0.5 + rnd() * 0.5)));
  }
  return out;
}

const SSAO_SAMPLES = 12;

/**
 * Deferred-style effects on top of the forward render: screen-space ambient occlusion
 * reconstructed from the depth buffer, a dual-filter bloom chain and a final pass
 * that does exposure, filmic tone mapping, colour grading, vignette and dithering.
 */
export class PostFX {
  readonly sceneRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  private aoBlurRT: THREE.WebGLRenderTarget;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];
  private quad = new FullScreenQuad();
  private ssaoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private prefilterMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  options: PostOptions = { ssao: true, bloom: true, msaa: true };
  exposure = 1.04;

  constructor() {
    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthTexture,
      samples: 4,
    });
    this.sceneRT.texture.name = 'scene-hdr';
    const ldr = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false } as const;
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, ldr);
    this.aoBlurRT = new THREE.WebGLRenderTarget(1, 1, ldr);
    for (let i = 0; i < 5; i++) {
      this.bloomRTs.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }

    this.ssaoMat = new THREE.ShaderMaterial({
      defines: { SAMPLES: SSAO_SAMPLES },
      uniforms: {
        tDepth: { value: depthTexture },
        uProj: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uKernel: { value: kernel(SSAO_SAMPLES) },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 0.85 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D tDepth;
        uniform mat4 uProj;
        uniform mat4 uInvProj;
        uniform vec3 uKernel[SAMPLES];
        uniform vec2 uTexel;
        uniform float uRadius;
        varying vec2 vUv;
        vec3 viewPos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
          vec3 p = viewPos(vUv);
          // Beyond the AO range, skip reconstruction entirely: mixing a broken
          // normal with white later cannot remove NaNs on some GPU drivers.
          if (-p.z >= 90.0) { gl_FragColor = vec4(1.0); return; }
          vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0));
          vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0));
          vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y));
          vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y));
          vec3 ddx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
          vec3 ddy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
          vec3 rawN = cross(ddx, ddy);
          float normalLength2 = dot(rawN, rawN);
          if (!(normalLength2 > 1e-12)) { gl_FragColor = vec4(1.0); return; }
          vec3 n = rawN * inversesqrt(normalLength2);
          float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
          vec3 rv = vec3(cos(ang), sin(ang), 0.0);
          vec3 tangent = rv - n * dot(rv, n);
          if (dot(tangent, tangent) < 1e-6) {
            vec3 axis = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
            tangent = cross(axis, n);
          }
          vec3 t = normalize(tangent);
          vec3 b = cross(n, t);
          mat3 tbn = mat3(t, b, n);
          float radius = uRadius;
          float occ = 0.0;
          for (int i = 0; i < SAMPLES; i++) {
            vec3 sp = p + tbn * uKernel[i] * radius;
            vec4 clip = uProj * vec4(sp, 1.0);
            if (clip.w <= 0.0) continue;
            vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
            if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
            if (texture2D(tDepth, suv).x >= 0.99999) continue;
            float sz = viewPos(suv).z;
            float range = smoothstep(0.0, 1.0, radius / max(abs(p.z - sz), 1e-4));
            occ += (sz >= sp.z + 0.025 ? 1.0 : 0.0) * range;
          }
          float ao = 1.0 - occ / float(SAMPLES);
          ao = pow(clamp(ao, 0.0, 1.0), 1.4);
          ao = mix(ao, 1.0, smoothstep(45.0, 90.0, -p.z));
          gl_FragColor = vec4(ao, ao, ao, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tAO: { value: null },
        tDepth: { value: depthTexture },
        uDir: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 500 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tAO;
        uniform highp sampler2D tDepth;
        uniform vec2 uDir;
        uniform float uNear;
        uniform float uFar;
        varying vec2 vUv;
        float lin(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        void main() {
          float z0 = lin(vUv);
          float sum = 0.0;
          float wsum = 0.0;
          for (int i = -3; i <= 3; i++) {
            vec2 uv = vUv + uDir * float(i);
            float z = lin(uv);
            float w = exp(-abs(z - z0) * 4.0 / max(z0 * 0.05, 0.05)) * (1.0 - abs(float(i)) / 4.5);
            sum += texture2D(tAO, uv).r * w;
            wsum += w;
          }
          float ao = sum / max(wsum, 1e-4);
          gl_FragColor = vec4(ao, ao, ao, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.prefilterMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.6 }, uKnee: { value: 0.6 } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        uniform float uThreshold;
        uniform float uKnee;
        varying vec2 vUv;
        vec3 pre(vec2 uv) {
          vec3 c = texture2D(tSrc, uv).rgb;
          c = min(c, vec3(40.0));
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
          c *= contrib;
          // Karis average: tame single bright pixels (fireflies).
          return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25);
        }
        void main() {
          vec3 c = pre(vUv + uTexel * vec2(-1.0, -1.0)) + pre(vUv + uTexel * vec2(1.0, -1.0))
                 + pre(vUv + uTexel * vec2(-1.0, 1.0)) + pre(vUv + uTexel * vec2(1.0, 1.0));
          gl_FragColor = vec4(c * 0.25, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec3 c = vec3(0.0);
          c += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
          gl_FragColor = vec4(c / 12.0, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tAO: { value: this.aoBlurRT.texture },
        tBloom: { value: this.bloomRTs[0].texture },
        uUseAO: { value: 1 },
        uUseBloom: { value: 1 },
        uAOStrength: { value: 0.5 },
        uBloomStrength: { value: 0.1 },
        uExposure: { value: 1 },
        uUnderwater: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tAO;
        uniform sampler2D tBloom;
        uniform float uUseAO;
        uniform float uUseBloom;
        uniform float uAOStrength;
        uniform float uBloomStrength;
        uniform float uExposure;
        uniform float uUnderwater;
        uniform float uTime;
        varying vec2 vUv;

        // ACES fitted (Stephen Hill), keeps a gentle toe and a long shoulder.
        vec3 mmRRTAndODTFit(vec3 v) {
          vec3 a = v * (v + 0.0245786) - 0.000090537;
          vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
          return a / b;
        }
        vec3 mmAcesFitted(vec3 c) {
          const mat3 ACESInputMat = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
          const mat3 ACESOutputMat = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
          c = ACESInputMat * c;
          c = mmRRTAndODTFit(c);
          c = ACESOutputMat * c;
          return clamp(c, 0.0, 1.0);
        }
        vec3 mmToSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          vec2 uv = vUv;
          if (uUnderwater > 0.5) {
            uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.0022;
          }
          vec3 c = texture2D(tScene, uv).rgb;
          if (uUseAO > 0.5) {
            float ao = texture2D(tAO, uv).r;
            c *= mix(1.0, ao, uAOStrength);
          }
          if (uUseBloom > 0.5) c += texture2D(tBloom, uv).rgb * uBloomStrength;
          c *= uExposure;
          // Subtle split-tone before tone mapping: cooler shadows, warmer highlights.
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.9, l));
          c = mmAcesFitted(c);
          // Mild saturation boost in display space.
          float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(g), c, 1.03);
          c = clamp(c, 0.0, 1.0);
          vec3 s = mmToSRGB(c);
          // Soft vignette.
          vec2 q = vUv - 0.5;
          s *= 1.0 - dot(q, q) * 0.16;
          if (uUnderwater > 0.5) s = mix(s, s * vec3(0.55, 0.85, 1.0), 0.5);
          s += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
          gl_FragColor = vec4(s, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.sceneRT.setSize(this.width, this.height);
    const hw = Math.max(1, Math.floor(this.width / 2));
    const hh = Math.max(1, Math.floor(this.height / 2));
    this.aoRT.setSize(hw, hh);
    this.aoBlurRT.setSize(hw, hh);
    let bw = hw;
    let bh = hh;
    for (const rt of this.bloomRTs) {
      rt.setSize(bw, bh);
      bw = Math.max(1, Math.floor(bw / 2));
      bh = Math.max(1, Math.floor(bh / 2));
    }
  }

  setMSAA(enabled: boolean): void {
    const samples = enabled ? 4 : 0;
    if (this.sceneRT.samples !== samples) {
      this.sceneRT.samples = samples;
      this.sceneRT.dispose();
    }
  }

  private pass(renderer: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget | null, clear = true): void {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    this.quad.material = mat;
    this.quad.render(renderer);
  }

  /** Renders the scene through the effect chain to the screen. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, underwater: boolean): void {
    this.setMSAA(this.options.msaa);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.sceneRT);
    renderer.render(scene, camera);
    renderer.autoClear = false;

    const hw = this.aoRT.width;
    const hh = this.aoRT.height;
    if (this.options.ssao) {
      const u = this.ssaoMat.uniforms;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(renderer, this.ssaoMat, this.aoRT);
      const b = this.blurMat.uniforms;
      b.uNear.value = camera.near;
      b.uFar.value = camera.far;
      b.tAO.value = this.aoRT.texture;
      b.uDir.value.set(1 / hw, 0);
      this.pass(renderer, this.blurMat, this.aoBlurRT);
      b.tAO.value = this.aoBlurRT.texture;
      b.uDir.value.set(0, 1 / hh);
      this.pass(renderer, this.blurMat, this.aoRT);
    }

    if (this.options.bloom) {
      const pre = this.prefilterMat.uniforms;
      pre.tSrc.value = this.sceneRT.texture;
      pre.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(renderer, this.prefilterMat, this.bloomRTs[0]);
      for (let i = 1; i < this.bloomRTs.length; i++) {
        const src = this.bloomRTs[i - 1];
        this.downMat.uniforms.tSrc.value = src.texture;
        this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.downMat, this.bloomRTs[i]);
      }
      for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
        const src = this.bloomRTs[i + 1];
        this.upMat.uniforms.tSrc.value = src.texture;
        this.upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(renderer, this.upMat, this.bloomRTs[i], false);
      }
    }

    const c = this.compositeMat.uniforms;
    c.tAO.value = this.aoRT.texture;
    c.uUseAO.value = this.options.ssao ? 1 : 0;
    c.uUseBloom.value = this.options.bloom ? 1 : 0;
    c.uExposure.value = this.exposure;
    c.uUnderwater.value = underwater ? 1 : 0;
    c.uTime.value = time;
    this.pass(renderer, this.compositeMat, null);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.aoRT.dispose();
    this.aoBlurRT.dispose();
    for (const rt of this.bloomRTs) rt.dispose();
    for (const m of [this.ssaoMat, this.blurMat, this.prefilterMat, this.downMat, this.upMat, this.compositeMat]) m.dispose();
    this.quad.dispose();
  }
}

