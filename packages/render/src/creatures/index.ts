/**
 * Creature models: procedural, instanced, animated.
 *
 * See `assets.ts` for the registry and cache, `geometry.ts` for how models are
 * assembled, `material.ts` for the animated toon shader, and `crowd.ts` for
 * drawing a whole population in a handful of draw calls.
 */
export {
  CREATURE_MODELS, buildCreature, hasBespokeModel, strideFor, type CreatureAsset,
} from './assets.ts';
export { ModelBuilder, hex, mix, bothSides, type Detail, type RGB } from './geometry.ts';
export { Bone, Motion, BONE_COUNT, emptyRig, packRig, type RigSpec, type BoneRig } from './rig.ts';
export { createCreatureMaterials, creatureGlobals, type CreatureMaterials } from './material.ts';
export type { CreatureModel } from './kit.ts';
export { CreatureCrowd, instancedCopy, type CrowdMember, type CrowdOptions } from './crowd.ts';
export { buildHumanoid, buildPlayerModel, humanoidHeight, SKIN_TONES, HAIR_COLORS, EYE_COLORS, CLOTH_COLORS, type HumanoidLook } from './humanoid.ts';
