/**
 * Creature materials.
 *
 * A toon-shaded material with three things injected into Three's own shader:
 *
 * 1. **Bone animation.** Each vertex's rigid group rotates about its pivot, by
 *    an angle from the walk cycle, idle sway or wing flap. Done in the vertex
 *    shader so it costs nothing on the CPU and survives instancing.
 * 2. **Rim light.** A soft back-light edge. It separates a creature from the
 *    ground behind it, which on a hillside of similar greens is the difference
 *    between seeing a Rowlet and not.
 * 3. **The same animation in the shadow pass** (`customDepthMaterial`), or the
 *    shadow would stand still while the creature walks.
 *
 * Extending MeshToonMaterial rather than writing a ShaderMaterial keeps fog,
 * every light type, shadow receiving and colour management — all things a
 * hand-written shader would have to re-implement and would get subtly wrong.
 */
import {
  MeshToonMaterial, MeshDepthMaterial, MeshBasicMaterial, DataTexture, RedFormat,
  NearestFilter, BackSide, RGBADepthPacking, type Material, type WebGLProgramParametersWithUniforms,
} from 'three';
import { BONE_COUNT, packRig, type RigSpec } from './rig.ts';

/** Four flat bands of light. Three reads as posterised; five as smooth. */
function toonGradient(): DataTexture {
  const data = new Uint8Array([70, 140, 205, 255]);
  const texture = new DataTexture(data, data.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

let sharedGradient: DataTexture | null = null;

/** Uniforms shared by every creature: one clock, one rim light. */
export const creatureGlobals = {
  uTime: { value: 0 },
  uRimColor: { value: [1.0, 0.95, 0.85] as number[] },
  uRimStrength: { value: 0.35 },
};

const HEADER = /* glsl */ `
  attribute float aBone;
  // x: walk cycle (radians), y: gait (0 still, 1 walk, 2 run), z: idle phase, w: spare
  attribute vec4 aAnim;
  uniform vec3 uBonePivot[${BONE_COUNT}];
  uniform vec3 uBoneAxis[${BONE_COUNT}];
  uniform vec4 uBoneParams[${BONE_COUNT}];
  uniform vec3 uMotion;   // walk bob, hover bob, breath
  uniform float uTime;

  vec3 alolaRotate(vec3 v, vec3 k, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }

  float alolaAngle(int bone) {
    vec4 p = uBoneParams[bone];
    float gait = clamp(aAnim.y, 0.0, 1.6);
    if (p.w < 0.5) {
      // Walk: swings with the cycle, still at rest.
      return p.x * sin(aAnim.x * p.y + p.z) * min(gait, 1.2);
    } else if (p.w < 1.5) {
      // Sway: always a little, more when moving.
      return p.x * sin(uTime * p.y + p.z + aAnim.z) * (0.45 + 0.55 * min(gait, 1.0));
    } else if (p.w < 2.5) {
      // Flap: its own rate, always.
      return p.x * sin(uTime * p.y + p.z + aAnim.z);
    }
    return 0.0;
  }

  // Rotates a point (w = 1) or a direction (w = 0) by its bone. Ears (bone 11)
  // twitch on their own and then follow the head (bone 1): the one parented
  // bone, because an ear that does not move with its head looks broken.
  vec3 alolaBone(vec3 v, float isPoint) {
    int bone = int(aBone + 0.5);
    vec3 pivot = uBonePivot[bone];
    vec3 r = alolaRotate(v - pivot * isPoint, uBoneAxis[bone], alolaAngle(bone)) + pivot * isPoint;
    if (bone == 11) {
      vec3 hp = uBonePivot[1];
      r = alolaRotate(r - hp * isPoint, uBoneAxis[1], alolaAngle(1)) + hp * isPoint;
    }
    return r;
  }

  vec3 alolaBody(vec3 p) {
    float gait = clamp(aAnim.y, 0.0, 1.6);
    float breath = 1.0 + uMotion.z * sin(uTime * 2.1 + aAnim.z) * (1.0 - min(gait, 1.0) * 0.6);
    p.xz *= breath;
    p.y *= 1.0 + (breath - 1.0) * 0.4;
    p.y += uMotion.x * abs(sin(aAnim.x)) * min(gait, 1.3);
    p.y += uMotion.y * sin(uTime * 1.7 + aAnim.z);
    return p;
  }
`;

const NORMAL_CHUNK = /* glsl */ `
  #include <beginnormal_vertex>
  objectNormal = alolaBone(objectNormal, 0.0);
`;

const POSITION_CHUNK = /* glsl */ `
  #include <begin_vertex>
  transformed = alolaBody(alolaBone(transformed, 1.0));
`;

type ShaderLike = WebGLProgramParametersWithUniforms;

function installAnimation(shader: ShaderLike, uniforms: Record<string, { value: unknown }>, withNormals: boolean): void {
  Object.assign(shader.uniforms, uniforms, { uTime: creatureGlobals.uTime });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${HEADER}`)
    .replace('#include <begin_vertex>', POSITION_CHUNK);
  if (withNormals) {
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', NORMAL_CHUNK);
  }
}

export interface CreatureMaterials {
  readonly body: MeshToonMaterial;
  readonly depth: MeshDepthMaterial;
  readonly outline: MeshBasicMaterial;
  /** Per-species rig uniforms, shared by all three materials. */
  readonly rigUniforms: Record<string, { value: unknown }>;
  dispose(): void;
}

/**
 * Materials for one species' rig.
 *
 * Every species' material compiles to the same program — the rig lives in
 * uniform values, not in the shader source — so fifty species cost one shader
 * compile, not fifty. `customProgramCacheKey` is what tells Three that.
 */
export function createCreatureMaterials(rig: RigSpec, opts: { outlineWidth?: number; outlineColor?: number } = {}): CreatureMaterials {
  const packed = packRig(rig);
  const rigUniforms: Record<string, { value: unknown }> = {
    uBonePivot: { value: packed.pivots },
    uBoneAxis: { value: packed.axes },
    uBoneParams: { value: packed.params },
    uMotion: { value: packed.motion },
  };

  sharedGradient ??= toonGradient();

  const body = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedGradient });
  body.onBeforeCompile = (shader) => {
    installAnimation(shader, rigUniforms, true);
    Object.assign(shader.uniforms, {
      uRimColor: creatureGlobals.uRimColor,
      uRimStrength: creatureGlobals.uRimStrength,
    });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimStrength;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          vec3 viewDir = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
          gl_FragColor.rgb += uRimColor * rim * uRimStrength;
        }`);
  };
  body.customProgramCacheKey = () => 'alola-creature-body';

  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => installAnimation(shader, rigUniforms, false);
  depth.customProgramCacheKey = () => 'alola-creature-depth';

  // Inverted hull: the back faces, pushed out along the normal and drawn in a
  // flat dark colour, leave an ink line around the silhouette.
  const outlineWidth = opts.outlineWidth ?? 0.014;
  const outline = new MeshBasicMaterial({ color: opts.outlineColor ?? 0x1e1712, side: BackSide });
  outline.onBeforeCompile = (shader) => {
    installAnimation(shader, rigUniforms, false);
    shader.uniforms.uOutlineWidth = { value: outlineWidth };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;')
      .replace(POSITION_CHUNK, `${POSITION_CHUNK}
        transformed += normalize(alolaBone(normal, 0.0)) * uOutlineWidth;`);
  };
  outline.customProgramCacheKey = () => 'alola-creature-outline';

  return {
    body, depth, outline, rigUniforms,
    dispose(): void {
      body.dispose();
      depth.dispose();
      outline.dispose();
    },
  };
}

export type { Material };
