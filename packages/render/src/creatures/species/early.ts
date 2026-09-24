/**
 * Melemele's opening cast: the three partners, Pikachu, and the first things
 * that live on Route 1.
 *
 * Each model is built in model units — roughly one unit in the dimension the
 * Pokédex height describes — with the feet on y = 0 and the face toward +Z.
 */
import { Bone, type V3 } from '../rig.ts';
import { hex, bothSides } from '../geometry.ts';
import { quadLegs, bipedLegs, arms, headLook, sway, flap, spot, swing, type CreatureModel } from '../kit.ts';

const INK = hex(0x221c1a);

export const PIKACHU: CreatureModel = (b, rig) => {
  const yellow = hex(0xf6cf3a);
  const black = hex(0x2a2220);
  const brown = hex(0x93612d);
  const red = hex(0xe5483a);

  // Pear-shaped body, heavier at the bottom.
  b.ellipsoid([0, 0.33, 0], [0.23, 0.26, 0.2], yellow, Bone.Root);
  b.ellipsoid([0, 0.25, 0.02], [0.24, 0.18, 0.2], yellow, Bone.Root);
  // Two brown stripes across the back.
  for (const y of [0.38, 0.29]) {
    b.ellipsoid([0, y, -0.15], [0.17, 0.03, 0.07], brown, Bone.Root, [0.35, 0, 0]);
  }

  // Head, slightly wider than tall.
  const head: V3 = [0, 0.7, 0.03];
  const headR: V3 = [0.26, 0.23, 0.22];
  b.ellipsoid(head, headR, yellow, Bone.Head);
  b.eyes(head, headR, { spread: 0.42, lift: 0.12, size: 0.042, tall: 1.2 });
  spot(b, [0, 0.68, 0.245], 0.016, INK, Bone.Head);
  bothSides((s) => {
    // Red cheeks — the electric sacs.
    spot(b, [0.17 * s, 0.62, 0.17], 0.058, red, Bone.Head, [0, 0.62 * s, 0]);
    // Long ears, black-tipped, flattened front to back.
    const base: V3 = [0.12 * s, 0.86, 0.0];
    const mid: V3 = [0.24 * s, 1.1, -0.03];
    const tip: V3 = [0.31 * s, 1.26, -0.05];
    b.limb(base, mid, 0.075, 0.06, yellow, Bone.Ear, { flatten: 0.45 });
    b.limb(mid, tip, 0.062, 0.006, black, Bone.Ear, { flatten: 0.45 });
  });
  headLook(rig, [0, 0.5, 0.02], 0.14);
  sway(rig, Bone.Ear, [0, 0.86, 0], 0.08, 2.6, [0, 0, 1]);

  // Lightning-bolt tail, brown at the root.
  b.limb([0, 0.18, -0.16], [0, 0.26, -0.28], 0.04, 0.035, brown, Bone.Tail);
  b.shape(
    [[0, 0], [0.1, 0.02], [0.08, 0.16], [0.2, 0.18], [0.16, 0.34], [0.34, 0.37], [0.3, 0.6],
      [0.14, 0.55], [0.18, 0.4], [0.02, 0.37], [0.05, 0.22], [-0.06, 0.2]],
    0.035,
    { at: [0, 0.24, -0.3], rotation: [0.25, Math.PI / 2, 0] },
    yellow, Bone.Tail,
  );
  sway(rig, Bone.Tail, [0, 0.22, -0.2], 0.3, 2.2);

  arms(b, rig, { x: 0.17, shoulderY: 0.44, z: 0.08, length: 0.13, thickness: 0.05, color: yellow, spread: 0.45, forward: 0.6 });
  bipedLegs(b, rig, { x: 0.12, hipY: 0.16, z: 0.02, thickness: 0.07, color: yellow, footLength: 0.1 });
  rig.strideRate = 2.8;
};

export const ROWLET: CreatureModel = (b, rig) => {
  const brown = hex(0xa8794c);
  const cream = hex(0xf2e6c8);
  const leaf = hex(0x5fae4e);
  const beak = hex(0xd8b06a);
  const feet = hex(0xe39a45);

  // One round body that is also the head.
  b.ellipsoid([0, 0.45, 0], [0.36, 0.38, 0.33], brown, Bone.Root);
  b.ellipsoid([0, 0.36, 0.08], [0.3, 0.3, 0.27], cream, Bone.Root);
  // Face disc.
  const face: V3 = [0, 0.56, 0.2];
  const faceR: V3 = [0.27, 0.19, 0.15];
  b.ellipsoid(face, faceR, cream, Bone.Head);
  b.eyes(face, faceR, { spread: 0.52, lift: 0.18, size: 0.055, tall: 1.2 });
  b.cone([0, 0.52, 0.33], [0, 0.44, 0.37], 0.035, beak, Bone.Head);
  // The little sprout on top.
  b.shape([[0, 0], [0.05, 0.06], [0.03, 0.16], [0, 0.2], [-0.03, 0.16], [-0.05, 0.06]], 0.02,
    { at: [0, 0.8, 0.02], rotation: [-0.3, 0, 0] }, leaf, Bone.Head);
  headLook(rig, [0, 0.45, 0.05], 0.18, 0.8);

  // Leaf bow tie.
  bothSides((s) => {
    b.shape([[0, 0], [0.08, 0.05], [0.13, 0.0], [0.08, -0.05]], 0.02,
      { at: [0.01 * s, 0.3, 0.33], rotation: [0, s > 0 ? 0 : Math.PI, 0] }, leaf, Bone.Root);
  });

  // Wings folded at the sides.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.ellipsoid([0.33 * s, 0.4, -0.04], [0.07, 0.21, 0.17], brown, bone, [0, 0, 0.18 * s]);
    flap(rig, bone, [0.3 * s, 0.52, -0.02], 0.25, 3.2, [0, 0, s]);
  });

  // Feet: a waddle, not a stride.
  for (const [bone, s, phase] of [[Bone.LegBackLeft, 1, 0], [Bone.LegBackRight, -1, Math.PI]] as const) {
    b.ellipsoid([0.11 * s, 0.03, 0.12], [0.06, 0.03, 0.07], feet, bone);
    swing(rig, bone, [0.11 * s, 0.1, 0.08], phase, 0.5);
  }
  rig.walkBob = 0.05;
  rig.strideRate = 3.2;
};

export const LITTEN: CreatureModel = (b, rig) => {
  const black = hex(0x2c2b31);
  const grey = hex(0x4e4d56);
  const red = hex(0xd64034);
  const eye = hex(0xf2c33a);

  b.ellipsoid([0, 0.33, -0.04], [0.14, 0.14, 0.27], black, Bone.Root);
  // Red stripes over the back.
  for (const z of [0.05, -0.08, -0.2]) {
    b.ellipsoid([0, 0.43, z], [0.11, 0.035, 0.03], red, Bone.Root, [0, 0, 0]);
  }

  const head: V3 = [0, 0.49, 0.27];
  const headR: V3 = [0.17, 0.15, 0.15];
  b.ellipsoid(head, headR, black, Bone.Head);
  b.ellipsoid([0, 0.45, 0.37], [0.08, 0.055, 0.06], grey, Bone.Head);
  spot(b, [0, 0.47, 0.43], 0.018, hex(0xd26b86), Bone.Head);
  b.eyes(head, headR, { spread: 0.46, lift: 0.1, size: 0.034, tall: 0.95, slant: 0.22, iris: eye });
  bothSides((s) => {
    // Red cheek markings and a flash over each eye.
    spot(b, [0.13 * s, 0.44, 0.33], 0.035, red, Bone.Head, [0, 0.7 * s, 0]);
    b.cone([0.08 * s, 0.6, 0.25], [0.15 * s, 0.77, 0.2], 0.055, black, Bone.Ear, { flatten: 0.4 });
    b.cone([0.085 * s, 0.61, 0.265], [0.14 * s, 0.73, 0.23], 0.03, red, Bone.Ear, { flatten: 0.3 });
  });
  headLook(rig, [0, 0.42, 0.2], 0.16);
  sway(rig, Bone.Ear, [0, 0.6, 0.24], 0.1, 3.4, [0, 0, 1]);

  // Tail held up.
  b.limb([0, 0.38, -0.28], [0, 0.62, -0.42], 0.035, 0.03, black, Bone.Tail);
  b.limb([0, 0.62, -0.42], [0, 0.78, -0.4], 0.03, 0.02, black, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.38, -0.28], 0.28, 1.8, [0, 0.3, 1]);

  quadLegs(b, rig, { x: 0.075, hipY: 0.27, frontZ: 0.15, backZ: -0.19, thickness: 0.045, color: black, paw: grey });
  rig.strideRate = 2.6;
};

export const POPPLIO: CreatureModel = (b, rig) => {
  const blue = hex(0x3c86c8);
  const pale = hex(0x9fd2f2);
  const white = hex(0xf5f5f0);
  const pink = hex(0xf07ba0);

  b.ellipsoid([0, 0.27, -0.06], [0.22, 0.22, 0.3], blue, Bone.Root);
  b.ellipsoid([0, 0.22, 0.02], [0.18, 0.16, 0.24], white, Bone.Root);
  // The frilled collar.
  b.ellipsoid([0, 0.4, 0.12], [0.21, 0.075, 0.17], pale, Bone.Root);

  const head: V3 = [0, 0.56, 0.17];
  const headR: V3 = [0.2, 0.19, 0.18];
  b.ellipsoid(head, headR, blue, Bone.Head);
  b.ellipsoid([0, 0.5, 0.31], [0.12, 0.08, 0.08], white, Bone.Head);
  b.ellipsoid([0, 0.55, 0.39], [0.048, 0.042, 0.042], pink, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.26, size: 0.042, tall: 1.25 });
  bothSides((s) => b.ellipsoid([0.15 * s, 0.7, 0.12], [0.04, 0.035, 0.03], blue, Bone.Head));
  headLook(rig, [0, 0.42, 0.14], 0.2, 1.1);

  // Front flippers: short broad paddles, splayed. They do the walking.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.16 * s, 0.2, 0.14];
    b.ellipsoid([0.25 * s, 0.05, 0.2], [0.11, 0.035, 0.08], blue, bone, [0, -0.5 * s, -0.25 * s]);
    b.limb(shoulder, [0.22 * s, 0.07, 0.19], 0.06, 0.045, blue, bone);
    swing(rig, bone, shoulder, s > 0 ? 0 : Math.PI, 0.35, [0, 0, 1]);
  });
  b.shape([[0, 0], [0.16, -0.06], [0.2, 0.06], [0, 0.03], [-0.2, 0.06], [-0.16, -0.06]], 0.04,
    { at: [0, 0.06, -0.36], rotation: [Math.PI / 2, 0, 0] }, blue, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.1, -0.3], 0.3, 2.4);
  rig.walkBob = 0.06;
  rig.strideRate = 2.2;
};

export const PIKIPEK: CreatureModel = (b, rig) => {
  const black = hex(0x2a2a30);
  const white = hex(0xf1efe8);
  const red = hex(0xe3542f);
  const orange = hex(0xf0a13a);

  b.ellipsoid([0, 0.36, -0.02], [0.18, 0.22, 0.21], black, Bone.Root);
  b.ellipsoid([0, 0.33, 0.07], [0.15, 0.18, 0.15], white, Bone.Root);

  const head: V3 = [0, 0.6, 0.05];
  const headR: V3 = [0.17, 0.16, 0.16];
  b.ellipsoid(head, headR, black, Bone.Head);
  b.ellipsoid([0, 0.57, 0.12], [0.13, 0.11, 0.09], white, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.08, size: 0.034, tall: 1.2 });
  // The long beak it drums with.
  b.cone([0, 0.6, 0.18], [0, 0.57, 0.42], 0.05, red, Bone.Head);
  b.cone([0, 0.74, 0.02], [0, 0.86, -0.08], 0.04, black, Bone.Head);
  headLook(rig, [0, 0.48, 0.03], 0.22, 1.6);

  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.ellipsoid([0.18 * s, 0.36, -0.04], [0.05, 0.16, 0.16], black, bone, [0.3, 0, 0.15 * s]);
    spot(b, [0.225 * s, 0.4, 0.0], 0.025, white, bone, [0, 1.4 * s, 0]);
    flap(rig, bone, [0.16 * s, 0.46, -0.02], 0.3, 4, [0, 0, s]);
  });
  b.shape([[0, 0], [0.09, -0.02], [0.06, -0.18], [0, -0.14], [-0.06, -0.18], [-0.09, -0.02]], 0.02,
    { at: [0, 0.24, -0.2], rotation: [-0.5, 0, 0] }, black, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.24, -0.18], 0.2, 3, [1, 0, 0]);

  for (const [bone, s, phase] of [[Bone.LegBackLeft, 1, 0], [Bone.LegBackRight, -1, Math.PI]] as const) {
    b.limb([0.07 * s, 0.16, 0.02], [0.07 * s, 0.03, 0.04], 0.025, 0.02, orange, bone);
    b.ellipsoid([0.07 * s, 0.02, 0.07], [0.04, 0.02, 0.05], orange, bone);
    swing(rig, bone, [0.07 * s, 0.16, 0.02], phase, 0.6);
  }
  rig.strideRate = 3.4;
};

export const GRUBBIN: CreatureModel = (b, rig) => {
  const cream = hex(0xeee7d5);
  const shade = hex(0x9e968a);
  const orange = hex(0xe27a33);
  const jaw = hex(0x6d3f22);

  // Segmented body, back to front, getting slightly larger.
  const segments: [number, number][] = [[-0.38, 0.11], [-0.22, 0.13], [-0.05, 0.145]];
  segments.forEach(([z, r], i) => {
    const bone = i === 0 ? Bone.Tail : Bone.Root;
    b.ellipsoid([0, r, z], [r * 1.05, r, r * 0.95], cream, bone);
    b.ellipsoid([0, r * 0.45, z], [r * 0.95, r * 0.5, r * 0.9], shade, bone);
    // Stubby legs.
    bothSides((s) => b.ellipsoid([r * 0.8 * s, 0.03, z], [0.03, 0.03, 0.035], shade, bone));
  });

  const head: V3 = [0, 0.19, 0.16];
  const headR: V3 = [0.17, 0.15, 0.15];
  b.ellipsoid(head, headR, orange, Bone.Head);
  b.eyes(head, headR, { spread: 0.62, lift: 0.3, size: 0.03, tall: 1.1 });
  bothSides((s) => {
    // The mandibles, which do a great deal of the character work.
    b.limb([0.08 * s, 0.13, 0.26], [0.1 * s, 0.12, 0.36], 0.035, 0.03, jaw, Bone.Head);
    b.cone([0.1 * s, 0.12, 0.36], [0.03 * s, 0.11, 0.45], 0.03, jaw, Bone.Head);
  });
  sway(rig, Bone.Head, [0, 0.16, 0.05], 0.14, 2.4, [0, 1, 0]);
  sway(rig, Bone.Tail, [0, 0.12, -0.3], 0.22, 2.4, [0, 1, 0], Math.PI);
  rig.walkBob = 0.02;
  rig.strideRate = 3;
};
