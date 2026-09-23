import * as THREE from 'three';

/**
 * Uniforms shared by every world material (terrain, water, sky). Updating a value here
 * updates all materials at once.
 */
export interface EnvUniforms {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  uSkyGround: THREE.IUniform<THREE.Color>;
  uFogNear: THREE.IUniform<number>;
  uFogFar: THREE.IUniform<number>;
  uFogDensity: THREE.IUniform<number>;
  uUnderwater: THREE.IUniform<number>;
  uWaterFog: THREE.IUniform<THREE.Color>;
  uCaveAmbient: THREE.IUniform<number>;
  uEmissive: THREE.IUniform<number>;
  uBlockTex: THREE.IUniform<THREE.Texture | null>;
  uClouds: THREE.IUniform<number>;
}

export function createEnvUniforms(): EnvUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.38).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
    uSkyZenith: { value: new THREE.Color(0.2, 0.42, 0.85) },
    uSkyHorizon: { value: new THREE.Color(0.66, 0.8, 0.97) },
    uSkyGround: { value: new THREE.Color(0.36, 0.42, 0.5) },
    uFogNear: { value: 60 },
    uFogFar: { value: 110 },
    uFogDensity: { value: 0.004 },
    uUnderwater: { value: 0 },
    uWaterFog: { value: new THREE.Color(0.03, 0.14, 0.22) },
    uCaveAmbient: { value: 0.12 },
    uEmissive: { value: 2.2 },
    uBlockTex: { value: null },
    uClouds: { value: 1 },
  };
}

/** Sky gradient and fog shared between the sky dome, terrain fog and water reflections. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogDensity;
uniform float uUnderwater;
uniform vec3 uWaterFog;

vec3 skyGradient(vec3 dir) {
  float y = dir.y;
  float up = max(y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(up, 0.6));
  // Brighter, slightly warmer band hugging the horizon.
  col += vec3(0.10, 0.08, 0.05) * pow(1.0 - abs(y), 12.0);
  col = mix(col, uSkyGround, smoothstep(0.0, -0.35, y));
  float s = max(dot(dir, uSunDir), 0.0);
  // Mie-like forward scattering: a broad glow and a tighter halo around the sun.
  col += uSunColor * (0.16 * pow(s, 5.0) + 0.45 * pow(s, 60.0));
  return col;
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-dist * 0.085);
    return mix(col, uWaterFog, clamp(f, 0.0, 1.0));
  }
  float haze = 1.0 - exp(-dist * uFogDensity);
  float edge = smoothstep(uFogNear, uFogFar, dist);
  float f = clamp(max(edge, haze), 0.0, 1.0);
  vec3 fogDir = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.6 + 0.01, dir.z));
  vec3 fogCol = skyGradient(fogDir);
  return mix(col, fogCol, f);
}
`;

const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
vec3 windOffset(vec3 wp, float amp) {
  float t = uTime;
  float a = sin(t * 1.35 + wp.x * 0.37 + wp.z * 0.21) * 0.6 + sin(t * 2.2 + wp.x * 0.9 - wp.z * 0.71) * 0.3
          + sin(t * 3.9 + wp.y * 1.3 + wp.z * 1.1) * 0.1;
  float b = cos(t * 1.1 + wp.z * 0.41 - wp.x * 0.26) * 0.6 + cos(t * 2.7 + wp.z * 0.83 + wp.x * 0.5) * 0.3;
  return vec3(a, a * 0.2 + b * 0.1, b) * amp * uWind;
}
`;

const TERRAIN_VERTEX_PARS = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aData;
varying vec2 vTileUv;
varying float vLayer;
varying float vAo;
varying float vSky;
varying float vFlags;
varying vec3 vWorldPos;
${WIND_GLSL}
`;

const TERRAIN_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3(position);
vTileUv = aUv;
vLayer = aData.x;
vAo = aData.y / 255.0;
vSky = aData.z / 255.0;
vFlags = aData.w;
{
  int wflags = int(aData.w + 0.5);
  if ((wflags & 3) != 0 && uWind > 0.0) {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    if ((wflags & 1) != 0) transformed += windOffset(wp, 0.035);
    if ((wflags & 2) != 0) transformed += windOffset(wp, 0.1);
  }
}
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uBlockTex;
uniform float uCaveAmbient;
uniform float uEmissive;
varying vec2 vTileUv;
varying float vLayer;
varying float vAo;
varying float vSky;
varying float vFlags;
varying vec3 vWorldPos;
${SKY_GLSL}
vec3 foliageTint(vec3 wp) {
  float n = sin(wp.x * 0.043 + sin(wp.z * 0.031) * 2.0) * 0.5 + sin(wp.z * 0.051 + wp.x * 0.017) * 0.5;
  return mix(vec3(0.9, 1.02, 0.88), vec3(1.08, 1.0, 0.78), n * 0.5 + 0.5);
}
`;

const TERRAIN_MAP_FRAGMENT = /* glsl */ `
vec4 texel = texture(uBlockTex, vec3(vTileUv, floor(vLayer + 0.5)));
#ifdef VOXEL_CUTOUT
  if (texel.a < 0.5) discard;
#endif
int fflags = int(vFlags + 0.5);
if ((fflags & 4) != 0) texel.rgb *= foliageTint(vWorldPos);
diffuseColor.rgb *= texel.rgb;
`;

const TERRAIN_LIGHT_MODULATION = /* glsl */ `
{
  float aoLin = vAo;
  float ao = 0.5 + 0.5 * pow(aoLin, 0.9);
  float skyAmb = mix(uCaveAmbient, 1.0, vSky * vSky);
  reflectedLight.indirectDiffuse *= ao * skyAmb;
  #ifdef USE_SHADOWMAP
    float directSky = mix(0.3, 1.0, smoothstep(0.04, 0.5, vSky));
  #else
    float directSky = smoothstep(0.3, 0.95, vSky);
  #endif
  reflectedLight.directDiffuse *= directSky * mix(0.75, 1.0, aoLin);
  if ((fflags & 8) != 0) totalEmissiveRadiance += texel.rgb * uEmissive;
}
`;

function patchTerrainVertex(src: string): string {
  return src
    .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', TERRAIN_BEGIN_VERTEX);
}

export type TerrainKind = 'solid' | 'cutout';

/** Lambert material with voxel texture array, baked AO + sky light, wind and custom fog. */
export function createTerrainMaterial(env: EnvUniforms, kind: TerrainKind): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: kind === 'cutout' ? THREE.DoubleSide : THREE.FrontSide,
    fog: false,
  });
  if (kind === 'cutout') mat.defines = { VOXEL_CUTOUT: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    shader.vertexShader = patchTerrainVertex(shader.vertexShader).replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', TERRAIN_MAP_FRAGMENT)
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifndef FLAT_SHADED
          if ((fflags & 16) != 0) normal = normalize(vNormal);
        #endif`,
      )
      .replace('#include <aomap_fragment>', TERRAIN_LIGHT_MODULATION)
      .replace('#include <opaque_fragment>', 'outgoingLight = applyFog(outgoingLight, vWorldPos);\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', '');
  };
  mat.customProgramCacheKey = () => `voxel-terrain-${kind}`;
  return mat;
}

/** Shadow-map material for cut-out geometry: alpha tested and wind animated like the colour pass. */
export function createCutoutDepthMaterial(env: EnvUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    shader.vertexShader = patchTerrainVertex(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform highp sampler2DArray uBlockTex;
        varying vec2 vTileUv;
        varying float vLayer;`,
      )
      .replace(
        '#include <map_fragment>',
        `if (texture(uBlockTex, vec3(vTileUv, floor(vLayer + 0.5))).a < 0.5) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'voxel-cutout-depth';
  return mat;
}

/** Depth material for solid terrain: identical to the default, but keeps the custom attributes bound cheaply. */
export function createSolidDepthMaterial(): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
}

const WATER_VERTEX_PARS = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aData;
uniform float uTime;
uniform float uWind;
varying vec3 vWorldPos;
varying vec3 vFaceN;
varying float vDepth;
varying float vSky;
varying float vTop;
`;

const WATER_FRAGMENT_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
varying vec3 vWorldPos;
varying vec3 vFaceN;
varying float vDepth;
varying float vSky;
varying float vTop;
${SKY_GLSL}

vec3 waterNormal(vec2 p, float t, float fade) {
  vec2 d = vec2(0.0);
  vec2 k1 = vec2(0.8, 0.6);
  vec2 k2 = vec2(-0.5, 0.86);
  vec2 k3 = vec2(0.95, -0.31);
  vec2 k4 = vec2(-0.2, -0.98);
  vec2 k5 = vec2(0.6, -0.8);
  d += k1 * cos(dot(p, k1) * 1.1 + t * 1.3) * 0.07;
  d += k2 * cos(dot(p, k2) * 2.3 + t * 1.9) * 0.045;
  d += k3 * cos(dot(p, k3) * 3.9 + t * 2.5) * 0.03;
  d += k4 * cos(dot(p, k4) * 6.1 + t * 3.2) * 0.02;
  d += k5 * cos(dot(p, k5) * 9.7 + t * 4.1) * 0.012;
  d *= fade;
  return normalize(vec3(-d.x, 1.0, -d.y));
}
`;

/** Water: depth-tinted body, fresnel sky reflection, sun glints, shore foam and soft block edges. */
export function createWaterMaterial(env: EnvUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_VERTEX_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        vFaceN = normal;
        vDepth = aData.y / 20.0;
        vSky = aData.z / 255.0;
        vTop = aData.w;
        if (aData.w > 0.5) {
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y += (sin(uTime * 1.2 + wp0.x * 0.7 + wp0.z * 0.4) * 0.5
                          + sin(uTime * 1.7 - wp0.x * 0.3 + wp0.z * 0.9) * 0.5) * 0.025 * uWind - 0.02;
        }`,
      )
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_FRAGMENT_PARS}`)
      .replace(
        '#include <map_fragment>',
        `float depthT = smoothstep(0.0, 4.0, vDepth);
        diffuseColor.rgb = mix(vec3(0.09, 0.30, 0.33), vec3(0.018, 0.085, 0.15), depthT);`,
      )
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= mix(0.25, 1.0, vSky);')
      .replace(
        '#include <opaque_fragment>',
        `{
          float sunVis = smoothstep(0.3, 0.9, vSky);
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            sunVis = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize,
              directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias,
              directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #endif
          vec3 toCam = cameraPosition - vWorldPos;
          float dist = length(toCam);
          vec3 V = toCam / max(dist, 1e-4);
          bool top = vTop > 0.5;
          float fade = 1.0 / (1.0 + dist * 0.03);
          vec3 N = top ? waterNormal(vWorldPos.xz, uTime * max(uWind, 0.0), fade) : normalize(vFaceN);
          if (!gl_FrontFacing) N = -N;
          float NdotV = clamp(dot(N, V), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 refl = skyGradient(normalize(R)) * mix(0.3, 1.0, vSky);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 260.0) * 5.0 + pow(max(dot(N, H), 0.0), 40.0) * 0.08;
          vec3 col = mix(outgoingLight, refl, fres) + uSunColor * spec * sunVis;
          float shallow = 1.0 - smoothstep(0.0, 1.6, vDepth);
          if (top) {
            // Shore foam where the averaged depth approaches zero.
            float foamN = sin(vWorldPos.x * 3.1 + uTime * 0.8) * sin(vWorldPos.z * 2.7 - uTime * 0.6);
            float foam = (1.0 - smoothstep(0.1, 0.55, vDepth)) * (0.55 + 0.45 * foamN);
            col = mix(col, vec3(0.85, 0.92, 0.95) * mix(0.35, 1.0, sunVis * 0.8 + 0.2), clamp(foam, 0.0, 1.0) * 0.55);
            // Faint voxel grid close to the camera keeps block edges readable.
            vec2 f = fract(vWorldPos.xz);
            float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
            float line = 1.0 - smoothstep(0.0, 0.03 + fwidth(e) * 1.5, e);
            col *= 1.0 - line * 0.07 * (1.0 - smoothstep(6.0, 18.0, dist));
          }
          float alpha = mix(0.9, 0.5, shallow);
          alpha = clamp(max(alpha, fres * 1.05), 0.0, 0.97);
          if (!gl_FrontFacing) alpha = 0.6;
          col = applyFog(col, vWorldPos);
          gl_FragColor = vec4(col, alpha);
        }`,
      )
      .replace('#include <fog_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'voxel-water';
  return mat;
}

/** Sky dome: gradient, sun disc with glow and soft procedural clouds. */
export function createSkyMaterial(env: EnvUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: env as unknown as Record<string, THREE.IUniform>,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uClouds;
      varying vec3 vDir;
      ${SKY_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * vnoise(p);
          p = p * 2.03 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return s;
      }
      void main() {
        vec3 dir = normalize(vDir);
        if (uUnderwater > 0.5) {
          gl_FragColor = vec4(uWaterFog, 1.0);
        } else {
          vec3 col = skyGradient(dir);
          float s = dot(dir, uSunDir);
          col += uSunColor * smoothstep(0.99935, 0.9997, s) * 22.0;
          if (uClouds > 0.5 && dir.y > 0.0) {
            vec2 uv = dir.xz / (dir.y + 0.12) * 1.1 + vec2(uTime * 0.006, uTime * 0.0025);
            float n = fbm(uv * 1.3);
            float c = smoothstep(0.5, 0.78, n);
            float fade = smoothstep(0.02, 0.3, dir.y);
            float thick = smoothstep(0.5, 0.95, n);
            vec3 lit = vec3(1.0, 0.98, 0.95) * 1.25 + uSunColor * pow(max(s, 0.0), 6.0) * 0.6;
            vec3 dark = mix(uSkyHorizon, vec3(0.62, 0.66, 0.74), 0.6);
            vec3 cloud = mix(lit, dark, thick * 0.7);
            col = mix(col, cloud, c * fade * 0.88);
          }
          gl_FragColor = vec4(col, 1.0);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
