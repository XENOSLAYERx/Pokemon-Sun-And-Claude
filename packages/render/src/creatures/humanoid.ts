/**
 * The player character.
 *
 * Built from the same primitives and animated by the same shader as the
 * creatures, so the player sits in the world in the same style — and built
 * from what the player chose in the creator. Skin tone, hair colour and style,
 * eye colour, build, height and every clothing slot change the model; before
 * this, the creator's choices were saved and never seen.
 *
 * The creator stores indices, not colours, so the palettes live here.
 */
import { ModelBuilder, hex, mix, bothSides, type RGB } from './geometry.ts';
import { Bone, emptyRig, type RigSpec, type V3 } from './rig.ts';
import { swing, headLook, sway } from './kit.ts';

/** The fields of the creator's appearance and outfit that the model reads. */
export interface HumanoidLook {
  readonly appearance: {
    bodyType: number; height: number; skinTone: number; eyeColor: number;
    hairStyle: number; hairColor: number; freckles: number;
  };
  readonly outfit: {
    hat: string; hatColor: number; eyewear: string; eyewearColor: number;
    top: string; topColor: number; outerwear: string; outerwearColor: number;
    bottom: string; bottomColor: number; socks: string; socksColor: number;
    shoes: string; shoesColor: number; bag: string; bagColor: number;
    accessory: string; accessoryColor: number;
  };
}

export const SKIN_TONES: readonly number[] = [
  0xfbe3d2, 0xf6d5bd, 0xf1c8a6, 0xe9b98e, 0xe1a97c, 0xd4966a, 0xc6855a, 0xb4744c,
  0xa3653f, 0x8f5535, 0x7c472c, 0x6a3b25, 0x5a311f, 0x4b291b, 0x3f2317, 0x331d13,
];

export const HAIR_COLORS: readonly number[] = [
  0x1f1a17, 0x3a2a20, 0x5a3a24, 0x7a5232, 0x9c6b3e, 0xc48b4a, 0xe0b46a, 0xf0d58e,
  0xb2402a, 0xd8662e, 0x8c8c94, 0xe6e6ea, 0x2a3a8a, 0x3a86c8, 0x3aa37a, 0x6aa84a,
  0x9a4fc0, 0xe06aa0, 0xd83a4a, 0xf2f2f2,
];

export const EYE_COLORS: readonly number[] = [
  0x3b2a20, 0x5a3a24, 0x2a4a7a, 0x3a86c8, 0x3a7a4a, 0x6a8a3a, 0x7a7a8a,
  0x9a5a2a, 0xa83a3a, 0x7a4ab0, 0xd8a83a, 0x2a2a2a, 0x3ab0b0, 0xe06aa0,
];

/** A general clothing palette, indexed by an item's colour choice. */
export const CLOTH_COLORS: readonly number[] = [
  0xf5f3ee, 0x2a2a30, 0xd83a3a, 0xf08a3a, 0xf2c63a, 0x5aab4a, 0x2f8f6a, 0x3a86c8,
  0x2a4a8a, 0x7a4ab0, 0xe06aa0, 0x8a5a3a, 0xc8b28a, 0x6a6a74, 0xa8c8e8, 0xf2a8a8,
  0x9ad8a8, 0x4a3a2a, 0x1a3a5a, 0xe8d8b8,
];

const pick = (palette: readonly number[], index: number): RGB => hex(palette[((index % palette.length) + palette.length) % palette.length]);

/** Build a player model from the creator's choices. Faces +Z, feet on y = 0. */
export function buildHumanoid(b: ModelBuilder, rig: RigSpec, look: HumanoidLook): void {
  const a = look.appearance;
  const o = look.outfit;
  const skin = pick(SKIN_TONES, a.skinTone);
  const hair = pick(HAIR_COLORS, a.hairColor);
  const eye = pick(EYE_COLORS, a.eyeColor);
  const top = pick(CLOTH_COLORS, o.topColor);
  const bottom = pick(CLOTH_COLORS, o.bottomColor);
  const shoe = pick(CLOTH_COLORS, o.shoesColor);
  const outer = pick(CLOTH_COLORS, o.outerwearColor);
  const bagColor = pick(CLOTH_COLORS, o.bagColor);
  const sock = pick(CLOTH_COLORS, o.socksColor);

  // Build: shoulders and hips widen across the six body types.
  const build = 1 + (((a.bodyType % 6) + 6) % 6 - 2.5) * 0.045;
  const shoulder = 0.13 * build;
  const hipX = 0.055 * build;

  // ---- legs and feet
  const hipY = 0.46;
  const legColorTop = o.bottom === 'skirt' || o.bottom === 'shorts' || o.bottom === 'swim-trunks' ? skin : bottom;
  const shortLeg = o.bottom === 'shorts' || o.bottom === 'swim-trunks';
  for (const [bone, s, phase] of [[Bone.LegBackLeft, 1, 0], [Bone.LegBackRight, -1, Math.PI]] as const) {
    const hip: V3 = [hipX * s, hipY, 0];
    const knee: V3 = [hipX * s, 0.25, 0.01];
    const ankle: V3 = [hipX * s, 0.05, 0];
    b.limb(hip, knee, 0.05 * build, 0.043, shortLeg ? bottom : legColorTop, bone);
    if (shortLeg) b.limb([hipX * s, 0.36, 0.005], knee, 0.046, 0.043, skin, bone);
    b.limb(knee, ankle, 0.042, 0.034, o.bottom === 'jeans' || o.bottom === 'cargo-pants' ? bottom : skin, bone);
    if (o.socks === 'knee-socks') b.limb([hipX * s, 0.22, 0.01], ankle, 0.045, 0.037, sock, bone);
    else if (o.socks === 'ankle-socks') b.limb([hipX * s, 0.1, 0], ankle, 0.038, 0.036, sock, bone);
    // Shoes: sandals are low and open; boots are tall.
    if (o.shoes === 'hiking-boots') b.limb([hipX * s, 0.11, 0], [hipX * s, 0.04, 0.01], 0.045, 0.045, shoe, bone);
    b.ellipsoid([hipX * s, 0.03, 0.03], [0.045, o.shoes === 'sandals' ? 0.018 : 0.032, 0.08], shoe, bone);
    swing(rig, bone, hip, phase, 0.6);
  }

  // ---- hips and torso
  if (o.bottom === 'skirt') {
    // Knee-length and gently flared — not a bell.
    b.limb([0, 0.53, 0], [0, 0.38, 0], 0.1 * build, 0.125 * build, bottom, Bone.Root, { sides: 16, flatten: 0.85 });
  } else {
    b.ellipsoid([0, 0.49, 0], [0.105 * build, 0.07, 0.075], bottom, Bone.Root);
  }
  const chestY = 0.64;
  b.ellipsoid([0, chestY, 0], [0.13 * build, 0.15, 0.09], top, Bone.Root);
  b.ellipsoid([0, 0.54, 0], [0.11 * build, 0.08, 0.08], top, Bone.Root);
  if (o.top === 'floral-shirt') {
    // A few printed flowers.
    for (const [x, y] of [[0.05, 0.7], [-0.06, 0.62], [0.03, 0.56], [-0.02, 0.74]] as const) {
      b.ellipsoid([x * build, y, 0.085], [0.02, 0.02, 0.008], mix(top, hex(0xffffff), 0.6), Bone.Root);
    }
  }
  if (o.top === 'hoodie') b.ellipsoid([0, 0.77, -0.08], [0.1, 0.06, 0.05], top, Bone.Root);
  if (o.top === 'poncho') b.limb([0, 0.8, 0], [0, 0.52, 0], 0.06, 0.2 * build, top, Bone.Root, { sides: 14 });
  if (o.top === 'lab-coat') {
    // A coat worn open: two front panels and a back, hanging to the knee,
    // close to the body. One cylinder round the whole figure read as a sack.
    const coat = hex(0xf6f6f2);
    b.ellipsoid([0, 0.56, -0.035], [0.12 * build, 0.23, 0.065], coat, Bone.Root);
    bothSides((s) => b.ellipsoid([0.07 * s * build, 0.56, 0.035], [0.055 * build, 0.23, 0.06], coat, Bone.Root));
  }
  if (o.outerwear !== 'none-outer') {
    // An open jacket: panels either side of the chest, a back, a collar.
    bothSides((s) => b.ellipsoid([0.075 * s * build, chestY - 0.02, 0.02], [0.065 * build, 0.16, 0.085], outer, Bone.Root));
    b.ellipsoid([0, chestY, -0.03], [0.13 * build, 0.16, 0.07], outer, Bone.Root);
    b.ellipsoid([0, 0.78, -0.02], [0.08, 0.025, 0.06], outer, Bone.Root);
  }

  // ---- arms
  const longSleeve = o.top === 'hoodie' || o.top === 'rash-guard' || o.top === 'lab-coat' || o.outerwear !== 'none-outer';
  const sleeve = o.outerwear !== 'none-outer' ? outer : o.top === 'lab-coat' ? hex(0xf6f6f2) : top;
  for (const [bone, s, phase] of [[Bone.ArmLeft, 1, Math.PI], [Bone.ArmRight, -1, 0]] as const) {
    const sh: V3 = [shoulder * s, 0.76, 0];
    const elbow: V3 = [(shoulder + 0.02) * s, 0.6, 0.0];
    const wrist: V3 = [(shoulder + 0.03) * s, 0.46, 0.02];
    b.limb(sh, elbow, 0.036, 0.032, o.top === 'tank-top' && o.outerwear === 'none-outer' ? skin : sleeve, bone);
    b.limb(elbow, wrist, 0.031, 0.027, longSleeve ? sleeve : skin, bone);
    b.ellipsoid([(shoulder + 0.03) * s, 0.43, 0.025], [0.028, 0.035, 0.028], skin, bone);
    swing(rig, bone, sh, phase, 0.5);
  }

  // ---- bag: cross-body for satchels and slings, on the back for a backpack
  if (o.bag === 'satchel' || o.bag === 'sling-bag') {
    b.limb([0.1, 0.78, 0.07], [-0.12, 0.5, 0.07], 0.012, 0.012, bagColor, Bone.Root);
    b.ellipsoid([-0.13, 0.48, 0.02], [0.03, 0.065, 0.08], bagColor, Bone.Root);
  } else if (o.bag === 'backpack') {
    b.ellipsoid([0, 0.64, -0.13], [0.1, 0.12, 0.05], bagColor, Bone.Root);
    bothSides((s) => b.limb([0.07 * s, 0.77, 0.02], [0.08 * s, 0.56, 0.03], 0.012, 0.012, bagColor, Bone.Root));
  }

  // ---- accessory
  const accessory = pick(CLOTH_COLORS, o.accessoryColor);
  if (o.accessory === 'lei') {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      b.ellipsoid([Math.sin(ang) * 0.085, 0.76 - Math.max(0, Math.cos(ang)) * 0.05, Math.cos(ang) * 0.07], [0.02, 0.02, 0.02], i % 2 ? accessory : hex(0xf6f2c8), Bone.Root);
    }
  } else if (o.accessory === 'scarf') {
    b.ellipsoid([0, 0.78, 0.0], [0.07, 0.03, 0.07], accessory, Bone.Root);
    b.limb([0.03, 0.77, 0.06], [0.04, 0.64, 0.09], 0.02, 0.018, accessory, Bone.Root, { flatten: 0.4 });
  } else if (o.accessory === 'wristbands' || o.accessory === 'z-ring-strap') {
    bothSides((s) => b.limb([(shoulder + 0.03) * s, 0.47, 0.02], [(shoulder + 0.03) * s, 0.49, 0.02], 0.03, 0.03, accessory, s > 0 ? Bone.ArmLeft : Bone.ArmRight));
  }

  // ---- head
  b.limb([0, 0.77, 0], [0, 0.82, 0.005], 0.035, 0.035, skin, Bone.Head);
  const head: V3 = [0, 0.9, 0.01];
  const headR: V3 = [0.085, 0.095, 0.088];
  b.ellipsoid(head, headR, skin, Bone.Head);
  bothSides((s) => b.ellipsoid([0.085 * s, 0.89, 0.0], [0.014, 0.022, 0.012], skin, Bone.Head));
  b.eyes(head, headR, { spread: 0.36, lift: 0.02, size: 0.013, tall: 1.35, iris: eye, whites: true });
  b.ellipsoid([0, 0.855, 0.083], [0.012, 0.004, 0.004], mix(skin, hex(0x6a2a2a), 0.5), Bone.Head);
  if (a.freckles > 0) {
    bothSides((s) => {
      for (const [dx, dy] of [[0.028, 0.875], [0.04, 0.868], [0.034, 0.884]] as const) {
        b.ellipsoid([dx * s, dy, 0.083], [0.003, 0.003, 0.002], mix(skin, hex(0x5a2a1a), 0.45), Bone.Head);
      }
    });
  }
  // Brows, in the hair colour.
  bothSides((s) => b.ellipsoid([0.03 * s, 0.925, 0.078], [0.017, 0.004, 0.006], hair, Bone.Head, [0, 0, -0.1 * s]));

  // ---- hair: eight families, spread across the creator's 32 styles
  const style = ((a.hairStyle % 8) + 8) % 8;
  const cap = (): void => { b.ellipsoid([0, 0.93, -0.005], [0.091, 0.075, 0.093], hair, Bone.Head); };
  switch (style) {
    case 0: // short
      cap();
      b.ellipsoid([0, 0.955, 0.05], [0.075, 0.03, 0.045], hair, Bone.Head, [0.4, 0, 0]);
      break;
    case 1: // spiky
      cap();
      for (let i = 0; i < 6; i++) {
        const ang = ((i - 2.5) / 2.5) * 1.1;
        b.cone([Math.sin(ang) * 0.05, 0.97, Math.cos(ang) * 0.02 - 0.01], [Math.sin(ang) * 0.1, 1.05, -0.03], 0.03, hair, Bone.Head);
      }
      break;
    case 2: // long
      cap();
      b.limb([0, 0.93, -0.05], [0, 0.72, -0.07], 0.085, 0.075, hair, Bone.Head, { flatten: 0.6, roll: Math.PI / 2 });
      bothSides((s) => b.limb([0.07 * s, 0.9, 0.02], [0.075 * s, 0.76, 0.0], 0.03, 0.022, hair, Bone.Head));
      break;
    case 3: // ponytail
      cap();
      b.ellipsoid([0, 0.94, -0.085], [0.025, 0.025, 0.025], hair, Bone.Head);
      b.limb([0, 0.93, -0.1], [0, 0.78, -0.13], 0.03, 0.018, hair, Bone.Head);
      break;
    case 4: // bob
      cap();
      b.ellipsoid([0, 0.88, -0.01], [0.1, 0.07, 0.1], hair, Bone.Head);
      b.ellipsoid([0, 0.95, 0.06], [0.08, 0.025, 0.04], hair, Bone.Head, [0.3, 0, 0]);
      break;
    case 5: // buzz
      b.ellipsoid([0, 0.925, -0.01], [0.088, 0.08, 0.09], mix(hair, skin, 0.35), Bone.Head);
      break;
    case 6: // curly volume
      for (const [x, y, z] of [[0, 0.98, 0], [0.06, 0.95, 0.01], [-0.06, 0.95, 0.01], [0, 0.95, -0.07], [0.05, 0.93, -0.05], [-0.05, 0.93, -0.05], [0.03, 0.97, 0.05], [-0.03, 0.97, 0.05]] as const) {
        b.ellipsoid([x, y, z], [0.05, 0.05, 0.05], hair, Bone.Head);
      }
      break;
    case 7: // bun
      cap();
      b.ellipsoid([0, 1.02, -0.03], [0.042, 0.04, 0.042], hair, Bone.Head);
      break;
  }

  // ---- hat
  const hatColor = pick(CLOTH_COLORS, o.hatColor);
  switch (o.hat) {
    case 'straw-hat':
      b.ellipsoid([0, 0.975, 0], [0.19, 0.012, 0.19], hex(0xe6c77a), Bone.Head);
      b.ellipsoid([0, 1.0, 0], [0.09, 0.05, 0.09], hex(0xe6c77a), Bone.Head);
      b.ellipsoid([0, 0.985, 0], [0.093, 0.012, 0.093], hatColor, Bone.Head);
      break;
    case 'snapback':
      b.ellipsoid([0, 0.965, -0.005], [0.094, 0.06, 0.096], hatColor, Bone.Head);
      b.ellipsoid([0, 0.955, 0.11], [0.07, 0.008, 0.06], hatColor, Bone.Head, [-0.12, 0, 0]);
      break;
    case 'beanie':
      b.ellipsoid([0, 0.975, -0.005], [0.095, 0.075, 0.097], hatColor, Bone.Head);
      b.ellipsoid([0, 0.935, 0], [0.097, 0.018, 0.099], mix(hatColor, hex(0xffffff), 0.3), Bone.Head);
      break;
    case 'sun-visor':
      b.ellipsoid([0, 0.955, 0.1], [0.075, 0.008, 0.065], hatColor, Bone.Head, [-0.1, 0, 0]);
      b.limb([-0.09, 0.95, 0.02], [0.09, 0.95, 0.02], 0.012, 0.012, hatColor, Bone.Head);
      break;
    case 'flower-crown':
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2;
        b.ellipsoid([Math.sin(ang) * 0.085, 0.975, Math.cos(ang) * 0.085], [0.02, 0.018, 0.02], i % 2 ? hatColor : hex(0xf6f2c8), Bone.Head);
      }
      break;
    case 'trial-headband':
      b.limb([-0.092, 0.95, 0.0], [0.092, 0.95, 0.0], 0.014, 0.014, hatColor, Bone.Head);
      b.ellipsoid([0, 0.95, 0.088], [0.03, 0.016, 0.01], hatColor, Bone.Head);
      break;
  }

  // ---- eyewear
  const lens = pick(CLOTH_COLORS, o.eyewearColor);
  if (o.eyewear === 'sunglasses' || o.eyewear === 'goggles' || o.eyewear === 'round-glasses') {
    bothSides((s) => {
      const r = o.eyewear === 'round-glasses' ? 0.022 : 0.025;
      const color = o.eyewear === 'round-glasses' ? mix(lens, hex(0xffffff), 0.5) : hex(0x1a1a22);
      b.ellipsoid([0.03 * s, 0.9, 0.088], [r, r * 0.8, 0.006], color, Bone.Head);
    });
    b.limb([-0.012, 0.905, 0.092], [0.012, 0.905, 0.092], 0.004, 0.004, lens, Bone.Head);
    if (o.eyewear === 'goggles') b.limb([-0.09, 0.9, 0.02], [0.09, 0.9, 0.02], 0.01, 0.01, lens, Bone.Head);
  }

  headLook(rig, [0, 0.8, 0], 0.06, 0.8);
  rig.walkBob = 0.02;
  rig.breath = 0.01;
  rig.strideRate = 1.5;
}

/** Real height in metres for the creator's five height steps. */
export function humanoidHeight(heightIndex: number): number {
  return 1.5 + (Math.min(4, Math.max(0, heightIndex)) / 4) * 0.3;
}

/** Build a player model, ready to draw. */
export function buildPlayerModel(look: HumanoidLook, detail: 'high' | 'low' = 'high'): { builder: ModelBuilder; rig: RigSpec } {
  const builder = new ModelBuilder(detail);
  const rig = emptyRig();
  buildHumanoid(builder, rig, look);
  return { builder, rig };
}
