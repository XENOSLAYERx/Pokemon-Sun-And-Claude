/**
 * The everyday wildlife of the islands: what a player walks past on a route.
 */
import { Bone, type V3 } from '../rig.ts';
import { hex, bothSides, mix } from '../geometry.ts';
import {
  quadLegs, bipedLegs, arms, headLook, sway, flap, spot, swing, chain, type CreatureModel,
} from '../kit.ts';

const INK = hex(0x221c1a);
const WHITE = hex(0xf5f3ee);

export const YUNGOOS: CreatureModel = (b, rig) => {
  const brown = hex(0x8d5b3a);
  const tan = hex(0xe8c690);
  const dark = hex(0x3f2a1f);

  b.ellipsoid([0, 0.22, -0.08], [0.12, 0.12, 0.3], brown, Bone.Root);
  b.ellipsoid([0, 0.17, -0.05], [0.1, 0.08, 0.26], tan, Bone.Root);
  // A big head for the size of it — Yungoos is mostly mouth.
  const head: V3 = [0, 0.29, 0.3];
  const headR: V3 = [0.15, 0.14, 0.17];
  b.ellipsoid(head, headR, brown, Bone.Head);
  b.ellipsoid([0, 0.23, 0.4], [0.12, 0.08, 0.1], tan, Bone.Head);
  b.ellipsoid([0, 0.19, 0.43], [0.09, 0.03, 0.06], dark, Bone.Head);
  bothSides((s) => b.ellipsoid([0.03 * s, 0.215, 0.49], [0.02, 0.025, 0.012], WHITE, Bone.Head));
  spot(b, [0, 0.29, 0.5], 0.02, INK, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.3, size: 0.026, tall: 0.9, slant: 0.2 });
  // The dark brow it is known for.
  b.ellipsoid([0, 0.38, 0.38], [0.11, 0.025, 0.05], dark, Bone.Head, [0.3, 0, 0]);
  bothSides((s) => b.ellipsoid([0.1 * s, 0.41, 0.26], [0.04, 0.035, 0.025], brown, Bone.Ear));
  headLook(rig, [0, 0.25, 0.18], 0.18, 1.2);

  chain(b, [[0, 0.24, -0.34], [0, 0.26, -0.52], [0, 0.22, -0.68]], [0.05, 0.045, 0.035], brown, Bone.Tail, tan);
  sway(rig, Bone.Tail, [0, 0.24, -0.34], 0.35, 2.2);
  quadLegs(b, rig, { x: 0.08, hipY: 0.16, frontZ: 0.12, backZ: -0.26, thickness: 0.04, color: brown, paw: dark });
  rig.strideRate = 3;
};

export const GUMSHOOS: CreatureModel = (b, rig) => {
  const brown = hex(0x8a5a3a);
  const cream = hex(0xf0d49a);
  const dark = hex(0x3a281d);

  b.ellipsoid([0, 0.38, 0], [0.19, 0.25, 0.17], brown, Bone.Root);
  b.ellipsoid([0, 0.36, 0.08], [0.14, 0.2, 0.1], cream, Bone.Root);
  const head: V3 = [0, 0.76, 0.04];
  const headR: V3 = [0.2, 0.18, 0.19];
  b.ellipsoid(head, headR, brown, Bone.Head);
  // The mane that reads as a trench-coat collar.
  bothSides((s) => b.ellipsoid([0.17 * s, 0.68, 0.08], [0.1, 0.13, 0.1], cream, Bone.Head, [0, 0, 0.4 * s]));
  b.ellipsoid([0, 0.7, 0.2], [0.11, 0.08, 0.08], cream, Bone.Head);
  spot(b, [0, 0.73, 0.28], 0.024, INK, Bone.Head);
  b.eyes(head, headR, { spread: 0.36, lift: 0.14, size: 0.03, tall: 0.9, slant: 0.28 });
  b.ellipsoid([0, 0.86, 0.17], [0.14, 0.03, 0.05], dark, Bone.Head, [0.2, 0, 0]);
  bothSides((s) => b.ellipsoid([0.13 * s, 0.93, 0.0], [0.05, 0.045, 0.03], brown, Bone.Ear));
  headLook(rig, [0, 0.6, 0.02], 0.12);

  chain(b, [[0, 0.24, -0.14], [0, 0.2, -0.32], [0, 0.26, -0.46]], [0.07, 0.065, 0.045], brown, Bone.Tail, cream);
  sway(rig, Bone.Tail, [0, 0.24, -0.14], 0.3, 1.8);
  arms(b, rig, { x: 0.18, shoulderY: 0.5, z: 0.04, length: 0.18, thickness: 0.05, color: brown, hand: cream, spread: 0.3 });
  bipedLegs(b, rig, { x: 0.1, hipY: 0.16, thickness: 0.065, color: brown, foot: dark });
  rig.strideRate = 2.2;
};

export const RATTATA_ALOLA: CreatureModel = (b, rig) => {
  const black = hex(0x2d2b32);
  const cream = hex(0xf2e2bf);
  const pink = hex(0xe5a0a8);
  const red = hex(0xc8323a);

  b.ellipsoid([0, 0.2, -0.06], [0.15, 0.14, 0.22], black, Bone.Root);
  b.ellipsoid([0, 0.15, -0.02], [0.12, 0.08, 0.18], cream, Bone.Root);
  const head: V3 = [0, 0.27, 0.18];
  const headR: V3 = [0.14, 0.13, 0.13];
  b.ellipsoid(head, headR, black, Bone.Head);
  // Puffed cream cheeks, and the teeth.
  bothSides((s) => b.ellipsoid([0.11 * s, 0.22, 0.24], [0.08, 0.07, 0.07], cream, Bone.Head));
  bothSides((s) => b.ellipsoid([0.018 * s, 0.17, 0.32], [0.016, 0.03, 0.01], WHITE, Bone.Head));
  spot(b, [0, 0.25, 0.32], 0.02, pink, Bone.Head);
  b.eyes(head, headR, { spread: 0.46, lift: 0.28, size: 0.028, tall: 1.1, iris: red });
  bothSides((s) => {
    b.ellipsoid([0.11 * s, 0.39, 0.12], [0.07, 0.07, 0.025], black, Bone.Ear, [0, 0.3 * s, 0.4 * s]);
    b.ellipsoid([0.11 * s, 0.39, 0.13], [0.045, 0.045, 0.02], pink, Bone.Ear, [0, 0.3 * s, 0.4 * s]);
  });
  headLook(rig, [0, 0.22, 0.1], 0.2, 1.6);
  sway(rig, Bone.Ear, [0, 0.36, 0.12], 0.1, 3.2, [0, 0, 1]);

  chain(b, [[0, 0.2, -0.26], [0, 0.18, -0.42], [0, 0.26, -0.54], [0, 0.4, -0.52]], [0.022, 0.02, 0.018, 0.012], black, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.2, -0.26], 0.4, 2.4);
  quadLegs(b, rig, { x: 0.08, hipY: 0.14, frontZ: 0.1, backZ: -0.18, thickness: 0.035, color: black, paw: pink });
  rig.strideRate = 3.4;
};

export const RATICATE_ALOLA: CreatureModel = (b, rig) => {
  const black = hex(0x2d2b32);
  const cream = hex(0xf2e2bf);
  const red = hex(0xc8323a);

  // Round, and proud of it.
  b.ellipsoid([0, 0.42, 0], [0.34, 0.36, 0.31], black, Bone.Root);
  b.ellipsoid([0, 0.38, 0.12], [0.27, 0.28, 0.2], cream, Bone.Root);
  const head: V3 = [0, 0.74, 0.12];
  const headR: V3 = [0.22, 0.19, 0.19];
  b.ellipsoid(head, headR, black, Bone.Head);
  bothSides((s) => b.ellipsoid([0.2 * s, 0.66, 0.2], [0.14, 0.1, 0.1], cream, Bone.Head, [0, 0, -0.3 * s]));
  bothSides((s) => b.ellipsoid([0.03 * s, 0.6, 0.3], [0.028, 0.05, 0.016], WHITE, Bone.Head));
  spot(b, [0, 0.7, 0.31], 0.028, hex(0xe5a0a8), Bone.Head);
  b.eyes(head, headR, { spread: 0.42, lift: 0.18, size: 0.03, tall: 0.85, slant: 0.25, iris: red });
  bothSides((s) => b.ellipsoid([0.14 * s, 0.9, 0.06], [0.06, 0.06, 0.02], black, Bone.Ear));
  headLook(rig, [0, 0.62, 0.1], 0.12);

  chain(b, [[0, 0.2, -0.28], [0, 0.14, -0.46], [0, 0.22, -0.6]], [0.03, 0.025, 0.018], black, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.2, -0.28], 0.35, 1.8);
  arms(b, rig, { x: 0.3, shoulderY: 0.5, z: 0.08, length: 0.12, thickness: 0.05, color: black, hand: cream, spread: 0.6, forward: 0.4 });
  bipedLegs(b, rig, { x: 0.16, hipY: 0.12, thickness: 0.07, color: black, foot: cream });
  rig.walkBob = 0.045;
  rig.strideRate = 2.4;
};

export const CATERPIE: CreatureModel = (b, rig) => {
  const green = hex(0x7dc34f);
  const belly = hex(0xf2e3a0);
  const yellow = hex(0xf5d24a);
  const red = hex(0xe0443a);

  // Segments rise toward the head, the way Caterpie rears up.
  const segs: [V3, number][] = [[[0, 0.1, -0.36], 0.1], [[0, 0.12, -0.2], 0.12], [[0, 0.14, -0.04], 0.13], [[0, 0.2, 0.1], 0.13]];
  segs.forEach(([c, r], i) => {
    const bone = i === 0 ? Bone.Tail : Bone.Root;
    b.ellipsoid(c, [r, r, r * 0.9], green, bone);
    b.ellipsoid([c[0], c[1] - r * 0.35, c[2]], [r * 0.85, r * 0.6, r * 0.8], belly, bone);
    bothSides((s) => spot(b, [r * 0.82 * s, c[1] + r * 0.2, c[2]], r * 0.28, yellow, bone, [0, 1.3 * s, 0]));
  });

  const head: V3 = [0, 0.32, 0.22];
  const headR: V3 = [0.14, 0.14, 0.13];
  b.ellipsoid(head, headR, green, Bone.Head);
  b.eyes(head, headR, { spread: 0.66, lift: 0.18, size: 0.045, tall: 1.2, whites: true });
  // The forked antenna.
  b.limb([0, 0.44, 0.2], [0, 0.54, 0.16], 0.025, 0.02, red, Bone.Head);
  bothSides((s) => b.cone([0, 0.54, 0.16], [0.05 * s, 0.6, 0.13], 0.018, red, Bone.Head));
  sway(rig, Bone.Head, [0, 0.2, 0.1], 0.16, 2, [1, 0.4, 0]);
  sway(rig, Bone.Tail, [0, 0.1, -0.28], 0.2, 2, [0, 1, 0], Math.PI);
  rig.walkBob = 0.02;
  rig.strideRate = 2.6;
};

export const MEOWTH_ALOLA: CreatureModel = (b, rig) => {
  const grey = hex(0x8e93ab);
  const light = hex(0xd6d8e4);
  const gold = hex(0xd9a62c);
  const dark = hex(0x3c3a4a);

  b.ellipsoid([0, 0.24, 0], [0.11, 0.15, 0.1], grey, Bone.Root);
  const head: V3 = [0, 0.5, 0.03];
  const headR: V3 = [0.2, 0.17, 0.16];
  b.ellipsoid(head, headR, grey, Bone.Head);
  b.ellipsoid([0, 0.45, 0.14], [0.1, 0.06, 0.05], light, Bone.Head);
  // The Alolan charm is its pride.
  b.ellipsoid([0, 0.61, 0.16], [0.045, 0.045, 0.015], gold, Bone.Head, [-0.5, 0, 0]);
  spot(b, [0, 0.48, 0.19], 0.014, hex(0xd67a8a), Bone.Head);
  b.eyes(head, headR, { spread: 0.44, lift: 0.1, size: 0.03, tall: 0.75, slant: 0.35, iris: hex(0x3a6a4a) });
  bothSides((s) => {
    b.cone([0.12 * s, 0.6, 0.0], [0.19 * s, 0.76, -0.02], 0.06, grey, Bone.Ear, { flatten: 0.4 });
    b.cone([0.12 * s, 0.61, 0.01], [0.17 * s, 0.72, 0.0], 0.035, dark, Bone.Ear, { flatten: 0.3 });
    // Whiskers.
    b.limb([0.06 * s, 0.46, 0.17], [0.28 * s, 0.5, 0.14], 0.005, 0.003, dark, Bone.Head);
  });
  headLook(rig, [0, 0.36, 0.02], 0.14);

  chain(b, [[0, 0.16, -0.08], [0, 0.26, -0.22], [0, 0.44, -0.24], [0.04, 0.52, -0.16]], [0.025, 0.022, 0.02, 0.016], grey, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.16, -0.08], 0.3, 1.6);
  arms(b, rig, { x: 0.1, shoulderY: 0.32, z: 0.02, length: 0.12, thickness: 0.03, color: grey, hand: light, spread: 0.3 });
  bipedLegs(b, rig, { x: 0.07, hipY: 0.12, thickness: 0.035, color: grey, foot: light });
  rig.strideRate = 2.8;
};

export const GROWLITHE: CreatureModel = (b, rig) => {
  const orange = hex(0xf08c3c);
  const cream = hex(0xf6e2b4);
  const black = hex(0x2c2420);

  b.ellipsoid([0, 0.34, -0.05], [0.16, 0.16, 0.28], orange, Bone.Root);
  for (const z of [0.05, -0.08, -0.2]) {
    bothSides((s) => b.ellipsoid([0.13 * s, 0.38, z], [0.03, 0.08, 0.02], black, Bone.Root, [0, 0, 0.5 * s]));
  }
  b.ellipsoid([0, 0.38, 0.2], [0.15, 0.16, 0.1], cream, Bone.Root);
  const head: V3 = [0, 0.56, 0.27];
  const headR: V3 = [0.15, 0.14, 0.14];
  b.ellipsoid(head, headR, orange, Bone.Head);
  b.ellipsoid([0, 0.51, 0.37], [0.08, 0.06, 0.06], cream, Bone.Head);
  spot(b, [0, 0.53, 0.43], 0.025, black, Bone.Head);
  b.ellipsoid([0, 0.69, 0.24], [0.08, 0.05, 0.07], cream, Bone.Head);
  b.eyes(head, headR, { spread: 0.46, lift: 0.18, size: 0.032, tall: 1.1 });
  bothSides((s) => b.cone([0.11 * s, 0.64, 0.22], [0.19 * s, 0.58, 0.2], 0.05, orange, Bone.Ear, { flatten: 0.4 }));
  headLook(rig, [0, 0.46, 0.2], 0.16, 1.2);

  b.ellipsoid([0, 0.45, -0.36], [0.1, 0.1, 0.12], cream, Bone.Tail, [0.6, 0, 0]);
  sway(rig, Bone.Tail, [0, 0.4, -0.28], 0.4, 3.2);
  quadLegs(b, rig, { x: 0.09, hipY: 0.26, frontZ: 0.14, backZ: -0.2, thickness: 0.05, color: orange, paw: cream });
  rig.strideRate = 2.6;
};

export const MUDBRAY: CreatureModel = (b, rig) => {
  const brown = hex(0x8b5a3a);
  const cream = hex(0xe8cfa2);
  const mane = hex(0x3a2820);
  const mud = hex(0x5a3d2c);

  b.ellipsoid([0, 0.44, -0.05], [0.2, 0.19, 0.32], brown, Bone.Root);
  b.limb([0, 0.52, 0.2], [0, 0.68, 0.32], 0.11, 0.09, brown, Bone.Head);
  const head: V3 = [0, 0.74, 0.38];
  const headR: V3 = [0.11, 0.11, 0.15];
  b.ellipsoid(head, headR, brown, Bone.Head);
  b.ellipsoid([0, 0.69, 0.5], [0.08, 0.07, 0.07], cream, Bone.Head);
  b.eyes(head, headR, { spread: 0.62, lift: 0.3, size: 0.024, tall: 1.0 });
  // Dark mane from forelock down the neck.
  b.ellipsoid([0, 0.76, 0.28], [0.035, 0.1, 0.16], mane, Bone.Head, [0.5, 0, 0]);
  bothSides((s) => b.cone([0.07 * s, 0.82, 0.36], [0.14 * s, 0.96, 0.32], 0.035, brown, Bone.Ear, { flatten: 0.5 }));
  headLook(rig, [0, 0.56, 0.22], 0.1);

  b.limb([0, 0.46, -0.35], [0, 0.34, -0.44], 0.03, 0.05, mane, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.46, -0.35], 0.4, 2.2);
  // Mudbray's legs end in great clods of mud: that is its silhouette.
  quadLegs(b, rig, { x: 0.11, hipY: 0.32, frontZ: 0.15, backZ: -0.22, thickness: 0.055, color: brown, taper: 1 });
  for (const [x, z, bone] of [[0.11, 0.15, Bone.LegFrontLeft], [-0.11, 0.15, Bone.LegFrontRight], [0.11, -0.22, Bone.LegBackLeft], [-0.11, -0.22, Bone.LegBackRight]] as const) {
    b.ellipsoid([x, 0.08, z + 0.01], [0.09, 0.095, 0.095], mud, bone);
  }
  rig.strideRate = 1.8;
};

export const MUDSDALE: CreatureModel = (b, rig) => {
  const brown = hex(0x7a4a33);
  const mane = hex(0x2e2220);
  const mud = hex(0x6a4a34);
  const clay = hex(0xa36a45);

  b.ellipsoid([0, 0.5, -0.05], [0.27, 0.25, 0.4], brown, Bone.Root);
  b.limb([0, 0.6, 0.26], [0, 0.76, 0.38], 0.16, 0.11, brown, Bone.Head);
  const head: V3 = [0, 0.8, 0.46];
  const headR: V3 = [0.11, 0.13, 0.17];
  b.ellipsoid(head, headR, brown, Bone.Head);
  b.eyes(head, headR, { spread: 0.66, lift: 0.3, size: 0.022, tall: 0.8, slant: 0.2 });
  // Heavy braided mane.
  for (let i = 0; i < 5; i++) {
    b.ellipsoid([0, 0.94 - i * 0.07, 0.36 - i * 0.06], [0.06, 0.08, 0.08], mane, Bone.Head);
  }
  bothSides((s) => b.cone([0.07 * s, 0.9, 0.42], [0.12 * s, 1.0, 0.38], 0.03, brown, Bone.Ear, { flatten: 0.5 }));
  headLook(rig, [0, 0.64, 0.28], 0.08, 0.7);

  chain(b, [[0, 0.58, -0.44], [0, 0.42, -0.54], [0, 0.26, -0.54]], [0.05, 0.055, 0.04], mane, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.58, -0.44], 0.3, 1.6);
  quadLegs(b, rig, { x: 0.15, hipY: 0.36, frontZ: 0.2, backZ: -0.27, thickness: 0.09, color: brown, taper: 1, amplitude: 0.4 });
  // The mud boots, and the clay fringe at their tops.
  for (const [x, z, bone] of [[0.15, 0.2, Bone.LegFrontLeft], [-0.15, 0.2, Bone.LegFrontRight], [0.15, -0.27, Bone.LegBackLeft], [-0.15, -0.27, Bone.LegBackRight]] as const) {
    b.ellipsoid([x, 0.11, z + 0.01], [0.13, 0.12, 0.13], mud, bone);
    b.ellipsoid([x, 0.22, z], [0.12, 0.04, 0.12], clay, bone);
  }
  rig.strideRate = 1.3;
  rig.walkBob = 0.02;
};

export const TAUROS: CreatureModel = (b, rig) => {
  const tan = hex(0xb0773f);
  const mane = hex(0x4a3224);
  const horn = hex(0xc9c3b4);
  const hoof = hex(0x3a2b22);

  b.ellipsoid([0, 0.46, -0.06], [0.2, 0.2, 0.34], tan, Bone.Root);
  b.ellipsoid([0, 0.54, 0.18], [0.23, 0.22, 0.16], mane, Bone.Root);
  const head: V3 = [0, 0.5, 0.38];
  const headR: V3 = [0.12, 0.12, 0.14];
  b.ellipsoid(head, headR, tan, Bone.Head);
  b.ellipsoid([0, 0.46, 0.48], [0.08, 0.06, 0.06], hex(0x8a5a36), Bone.Head);
  b.eyes(head, headR, { spread: 0.6, lift: 0.25, size: 0.024, tall: 0.75, slant: 0.35 });
  b.ellipsoid([0, 0.6, 0.36], [0.1, 0.05, 0.09], mane, Bone.Head);
  bothSides((s) => {
    b.limb([0.1 * s, 0.58, 0.36], [0.22 * s, 0.62, 0.34], 0.03, 0.026, horn, Bone.Head);
    b.cone([0.22 * s, 0.62, 0.34], [0.24 * s, 0.76, 0.3], 0.026, horn, Bone.Head);
  });
  headLook(rig, [0, 0.48, 0.24], 0.1, 0.9);

  // Three tails with dark tufts.
  for (const x of [-0.05, 0, 0.05]) {
    b.limb([x, 0.5, -0.38], [x * 2.2, 0.28, -0.5], 0.012, 0.01, tan, Bone.Tail);
    b.ellipsoid([x * 2.2, 0.26, -0.5], [0.03, 0.045, 0.03], mane, Bone.Tail);
  }
  sway(rig, Bone.Tail, [0, 0.5, -0.38], 0.35, 2.6);
  quadLegs(b, rig, { x: 0.12, hipY: 0.36, frontZ: 0.16, backZ: -0.24, thickness: 0.055, color: tan, paw: hoof });
  rig.strideRate = 1.7;
};

export const STOUTLAND: CreatureModel = (b, rig) => {
  const cream = hex(0xdcc49c);
  const cape = hex(0x4c5a78);
  const tan = hex(0xb58e5e);

  b.ellipsoid([0, 0.42, -0.06], [0.2, 0.2, 0.32], cream, Bone.Root);
  b.ellipsoid([0, 0.5, -0.1], [0.22, 0.14, 0.32], cape, Bone.Root);
  const head: V3 = [0, 0.58, 0.3];
  const headR: V3 = [0.15, 0.14, 0.14];
  b.ellipsoid(head, headR, tan, Bone.Head);
  // The famous mustache: two long drapes from the muzzle, parted in the middle,
  // hanging to the chest. Too far out to the sides and they read as ears.
  b.ellipsoid([0, 0.54, 0.4], [0.1, 0.07, 0.08], cream, Bone.Head);
  bothSides((s) => b.limb([0.045 * s, 0.5, 0.44], [0.07 * s, 0.3, 0.42], 0.055, 0.035, cream, Bone.Head, { flatten: 0.6 }));
  spot(b, [0, 0.58, 0.47], 0.03, INK, Bone.Head);
  b.eyes(head, headR, { spread: 0.44, lift: 0.3, size: 0.024, tall: 0.8 });
  bothSides((s) => {
    b.ellipsoid([0.07 * s, 0.68, 0.4], [0.06, 0.02, 0.03], cream, Bone.Head, [0, 0, -0.3 * s]);
    b.ellipsoid([0.14 * s, 0.6, 0.24], [0.05, 0.11, 0.04], cape, Bone.Ear, [0, 0, 0.3 * s]);
  });
  headLook(rig, [0, 0.5, 0.2], 0.1);

  b.ellipsoid([0, 0.5, -0.4], [0.05, 0.05, 0.09], cream, Bone.Tail, [0.6, 0, 0]);
  sway(rig, Bone.Tail, [0, 0.5, -0.34], 0.5, 3);
  quadLegs(b, rig, { x: 0.12, hipY: 0.32, frontZ: 0.16, backZ: -0.24, thickness: 0.06, color: cream, paw: tan });
  rig.strideRate = 1.8;
};

export const STUFFUL: CreatureModel = (b, rig) => {
  const pink = hex(0xf2a3b8);
  const dark = hex(0x4c3a3e);
  const light = hex(0xfbe6ec);

  b.ellipsoid([0, 0.3, 0], [0.22, 0.25, 0.2], pink, Bone.Root);
  b.ellipsoid([0, 0.27, 0.08], [0.15, 0.17, 0.12], light, Bone.Root);
  const head: V3 = [0, 0.64, 0.03];
  const headR: V3 = [0.22, 0.2, 0.19];
  b.ellipsoid(head, headR, pink, Bone.Head);
  // The dark hood over its head.
  b.ellipsoid([0, 0.72, -0.02], [0.215, 0.14, 0.18], dark, Bone.Head);
  b.ellipsoid([0, 0.58, 0.17], [0.09, 0.06, 0.05], light, Bone.Head);
  spot(b, [0, 0.61, 0.22], 0.02, dark, Bone.Head);
  b.eyes(head, headR, { spread: 0.36, lift: 0.08, size: 0.028, tall: 1.2 });
  bothSides((s) => b.ellipsoid([0.15 * s, 0.84, -0.02], [0.06, 0.06, 0.03], dark, Bone.Ear));
  headLook(rig, [0, 0.5, 0.02], 0.14, 1.3);

  arms(b, rig, { x: 0.2, shoulderY: 0.4, z: 0.05, length: 0.16, thickness: 0.06, color: dark, spread: 0.55, forward: 0.4 });
  bipedLegs(b, rig, { x: 0.12, hipY: 0.14, thickness: 0.07, color: pink, foot: dark });
  rig.walkBob = 0.045;
  rig.strideRate = 2.6;
};

export const BEWEAR: CreatureModel = (b, rig) => {
  const pink = hex(0xf09cb2);
  const white = hex(0xfbeef1);
  const black = hex(0x2a2327);

  b.ellipsoid([0, 0.46, 0], [0.24, 0.3, 0.2], pink, Bone.Root);
  b.ellipsoid([0, 0.42, 0.1], [0.17, 0.22, 0.12], white, Bone.Root);
  // Black hood over the head and down the back.
  b.ellipsoid([0, 0.66, -0.08], [0.2, 0.18, 0.14], black, Bone.Root);
  const head: V3 = [0, 0.86, 0.02];
  const headR: V3 = [0.16, 0.15, 0.15];
  b.ellipsoid(head, headR, black, Bone.Head);
  b.ellipsoid([0, 0.82, 0.12], [0.11, 0.09, 0.07], pink, Bone.Head);
  spot(b, [0, 0.83, 0.19], 0.018, black, Bone.Head);
  b.eyes([0, 0.86, 0.1], [0.11, 0.09, 0.07], { spread: 0.5, lift: 0.3, size: 0.018, tall: 1.1 });
  bothSides((s) => b.ellipsoid([0.12 * s, 1.0, -0.01], [0.055, 0.055, 0.03], black, Bone.Ear));
  headLook(rig, [0, 0.72, 0.0], 0.1, 0.8);

  // Long black arms, held out: Bewear's hug is the thing to be afraid of.
  arms(b, rig, { x: 0.23, shoulderY: 0.64, z: 0.04, length: 0.38, thickness: 0.075, color: black, hand: black, spread: 0.55, forward: 0.3, amplitude: 0.3 });
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    for (const k of [-1, 0, 1]) b.cone([(0.23 + 0.2) * s + k * 0.02, 0.33, 0.15], [(0.23 + 0.22) * s + k * 0.03, 0.29, 0.2], 0.012, white, bone);
  });
  bipedLegs(b, rig, { x: 0.13, hipY: 0.2, thickness: 0.09, color: pink, foot: black, amplitude: 0.45 });
  rig.strideRate = 1.5;
};

export const SALANDIT: CreatureModel = (b, rig) => {
  const black = hex(0x2c2833);
  const pink = hex(0xd9468a);
  const purple = hex(0x8a4fb0);

  b.ellipsoid([0, 0.14, -0.06], [0.1, 0.08, 0.24], black, Bone.Root);
  for (const z of [0.06, -0.08, -0.2]) b.ellipsoid([0, 0.2, z], [0.05, 0.025, 0.045], pink, Bone.Root);
  const head: V3 = [0, 0.18, 0.24];
  const headR: V3 = [0.1, 0.08, 0.12];
  b.ellipsoid(head, headR, black, Bone.Head);
  bothSides((s) => spot(b, [0.08 * s, 0.18, 0.28], 0.03, pink, Bone.Head, [0, 0.8 * s, 0]));
  b.eyes(head, headR, { spread: 0.5, lift: 0.4, size: 0.026, tall: 0.9, slant: 0.3, iris: purple });
  headLook(rig, [0, 0.15, 0.14], 0.22, 1.8);

  chain(b, [[0, 0.14, -0.28], [0, 0.12, -0.46], [0.04, 0.1, -0.62], [0.08, 0.1, -0.72]], [0.06, 0.045, 0.03, 0.014], black, Bone.Tail, pink);
  sway(rig, Bone.Tail, [0, 0.14, -0.28], 0.45, 2.8);
  // Legs splayed out sideways, as a lizard's are.
  const legs: [Bone, number, number, number][] = [
    [Bone.LegFrontLeft, 1, 0.12, 0], [Bone.LegFrontRight, -1, 0.12, Math.PI],
    [Bone.LegBackLeft, 1, -0.18, Math.PI], [Bone.LegBackRight, -1, -0.18, 0],
  ];
  for (const [bone, s, z, phase] of legs) {
    b.limb([0.07 * s, 0.12, z], [0.16 * s, 0.04, z + 0.02], 0.03, 0.025, black, bone);
    b.ellipsoid([0.17 * s, 0.02, z + 0.04], [0.035, 0.015, 0.04], pink, bone);
    swing(rig, bone, [0.07 * s, 0.12, z], phase, 0.6, [0, 1, 0]);
  }
  rig.strideRate = 3.2;
  rig.walkBob = 0.01;
};

export const CRABRAWLER: CreatureModel = (b, rig) => {
  const purple = hex(0x7d62ab);
  const light = hex(0xb9a8d8);
  const tan = hex(0xe0b27a);
  const blue = hex(0x3f7fc8);

  b.ellipsoid([0, 0.26, 0], [0.24, 0.16, 0.2], purple, Bone.Root);
  b.ellipsoid([0, 0.22, 0.06], [0.2, 0.11, 0.16], light, Bone.Root);
  const face: V3 = [0, 0.3, 0.16];
  b.ellipsoid(face, [0.12, 0.08, 0.06], tan, Bone.Head);
  b.eyes([0, 0.38, 0.1], [0.12, 0.08, 0.1], { spread: 0.4, lift: 0.5, size: 0.028, tall: 0.9, slant: 0.35, iris: blue });
  sway(rig, Bone.Head, [0, 0.3, 0.1], 0.08, 1.4, [0, 1, 0]);

  // The boxing claws are most of Crabrawler.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.2 * s, 0.3, 0.06];
    b.limb(shoulder, [0.3 * s, 0.34, 0.22], 0.045, 0.05, purple, bone);
    b.ellipsoid([0.31 * s, 0.36, 0.3], [0.1, 0.1, 0.11], purple, bone);
    b.ellipsoid([0.31 * s, 0.4, 0.38], [0.07, 0.05, 0.06], tan, bone);
    b.cone([0.31 * s, 0.3, 0.34], [0.3 * s, 0.26, 0.44], 0.045, tan, bone);
    swing(rig, bone, shoulder, s > 0 ? 0 : Math.PI, 0.35, [1, 0, 0]);
  });
  // Walking legs, three a side on the two back-leg bones.
  for (const [bone, s, phase] of [[Bone.LegBackLeft, 1, 0], [Bone.LegBackRight, -1, Math.PI]] as const) {
    for (const z of [-0.12, 0, 0.1]) {
      b.limb([0.18 * s, 0.2, z], [0.3 * s, 0.03, z + 0.02], 0.022, 0.016, purple, bone);
    }
    swing(rig, bone, [0.18 * s, 0.2, 0], phase, 0.3, [0, 0, 1]);
  }
  rig.strideRate = 3;
};

export const LURANTIS: CreatureModel = (b, rig) => {
  const pink = hex(0xec6b9e);
  const light = hex(0xf7c2d6);
  const green = hex(0x5dab55);
  const dark = hex(0x2f6b3a);

  // Slender and upright; the petals at the waist read as a skirt.
  b.ellipsoid([0, 0.5, 0], [0.08, 0.14, 0.07], pink, Bone.Root);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.shape([[0, 0], [0.06, -0.08], [0, -0.2], [-0.06, -0.08]], 0.015,
      { at: [Math.sin(a) * 0.06, 0.4, Math.cos(a) * 0.06], rotation: [0.4 * Math.cos(a), a, -0.4 * Math.sin(a)] }, pink, Bone.Root);
  }
  b.limb([0, 0.62, 0.0], [0, 0.72, 0.04], 0.035, 0.03, green, Bone.Head);
  const head: V3 = [0, 0.8, 0.06];
  const headR: V3 = [0.09, 0.08, 0.08];
  b.ellipsoid(head, headR, pink, Bone.Head);
  b.eyes(head, headR, { spread: 0.55, lift: 0.1, size: 0.03, tall: 0.9, slant: 0.25, iris: hex(0x6b2a8a) });
  // The leaf crest that sweeps back from its head.
  b.shape([[0, 0], [0.08, 0.1], [0.04, 0.3], [-0.02, 0.36], [-0.06, 0.2]], 0.02,
    { at: [0, 0.86, 0.02], rotation: [-0.9, 0, 0] }, light, Bone.Head);
  bothSides((s) => b.cone([0.04 * s, 0.86, 0.04], [0.1 * s, 0.98, -0.02], 0.02, green, Bone.Ear));
  headLook(rig, [0, 0.66, 0.02], 0.14, 0.8);

  // Scythe-leaves on the forearms.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.07 * s, 0.6, 0.02];
    b.limb(shoulder, [0.14 * s, 0.5, 0.12], 0.022, 0.018, green, bone);
    b.shape([[0, 0], [0.05, 0.1], [0.02, 0.32], [-0.03, 0.12]], 0.015,
      { at: [0.14 * s, 0.5, 0.12], rotation: [0.9, 0, -0.4 * s] }, pink, bone);
    swing(rig, bone, shoulder, s > 0 ? Math.PI : 0, 0.3);
  });
  bipedLegs(b, rig, { x: 0.05, hipY: 0.38, thickness: 0.024, color: dark, footLength: 0.05 });
  rig.strideRate = 2;
};

export const ORICORIO: CreatureModel = (b, rig) => {
  const red = hex(0xd8343c);
  const dark = hex(0x2c2226);
  const yellow = hex(0xf3c24a);
  const grey = hex(0x8a8490);

  b.ellipsoid([0, 0.46, 0], [0.16, 0.17, 0.15], red, Bone.Root);
  // The flamenco skirt.
  b.ellipsoid([0, 0.34, -0.02], [0.2, 0.1, 0.19], red, Bone.Root);
  b.ellipsoid([0, 0.3, -0.02], [0.17, 0.06, 0.16], dark, Bone.Root);
  const head: V3 = [0, 0.68, 0.04];
  const headR: V3 = [0.12, 0.11, 0.11];
  b.ellipsoid(head, headR, dark, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.1, size: 0.026, tall: 1.1 });
  b.cone([0, 0.66, 0.13], [0, 0.63, 0.24], 0.03, yellow, Bone.Head);
  b.shape([[0, 0], [0.04, 0.12], [0, 0.2], [-0.04, 0.12]], 0.02, { at: [0, 0.78, 0.0], rotation: [-0.5, 0, 0] }, red, Bone.Head);
  headLook(rig, [0, 0.56, 0.02], 0.2, 1.6);

  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.ellipsoid([0.2 * s, 0.5, 0.0], [0.13, 0.05, 0.1], red, bone, [0, 0, -0.5 * s]);
    b.ellipsoid([0.28 * s, 0.44, 0.0], [0.06, 0.04, 0.07], dark, bone, [0, 0, -0.5 * s]);
    flap(rig, bone, [0.13 * s, 0.52, 0], 0.45, 5, [0, 0, s]);
  });
  for (const [bone, s, phase] of [[Bone.LegBackLeft, 1, 0], [Bone.LegBackRight, -1, Math.PI]] as const) {
    b.limb([0.05 * s, 0.28, 0], [0.05 * s, 0.03, 0.02], 0.016, 0.012, grey, bone);
    b.ellipsoid([0.05 * s, 0.02, 0.04], [0.03, 0.015, 0.035], grey, bone);
    swing(rig, bone, [0.05 * s, 0.28, 0], phase, 0.6);
  }
  rig.flies = true;
  rig.hoverBob = 0.03;
  rig.strideRate = 3;
};

export const MIMIKYU: CreatureModel = (b, rig) => {
  const cloth = hex(0xe9cf74);
  const shadow = hex(0x1d1a22);
  const stick = hex(0x6d4a2a);
  const draw = hex(0x2a2320);
  const cheek = hex(0xd9584a);

  // The disguise: a sagging bell of cloth.
  b.ellipsoid([0, 0.28, 0], [0.3, 0.26, 0.28], cloth, Bone.Root);
  b.ellipsoid([0, 0.12, 0], [0.34, 0.1, 0.32], cloth, Bone.Root);
  const head: V3 = [0, 0.56, 0.04];
  const headR: V3 = [0.22, 0.2, 0.2];
  b.ellipsoid(head, headR, cloth, Bone.Head);
  // A crude, hand-drawn Pikachu face.
  bothSides((s) => {
    b.ellipsoid([0.08 * s, 0.6, 0.22], [0.03, 0.035, 0.01], draw, Bone.Head, [0, 0.35 * s, 0]);
    spot(b, [0.14 * s, 0.52, 0.19], 0.035, cheek, Bone.Head, [0, 0.6 * s, 0]);
  });
  b.ellipsoid([0, 0.53, 0.235], [0.05, 0.008, 0.008], draw, Bone.Head);
  // One ear up; the other broken, flopped over.
  b.cone([0.09, 0.72, 0.0], [0.16, 1.0, -0.04], 0.06, cloth, Bone.Ear, { flatten: 0.5 });
  b.limb([-0.09, 0.72, 0.0], [-0.15, 0.86, -0.02], 0.06, 0.05, cloth, Bone.Head, { flatten: 0.5 });
  b.cone([-0.15, 0.86, -0.02], [-0.3, 0.8, -0.04], 0.05, cloth, Bone.Head, { flatten: 0.5 });
  sway(rig, Bone.Head, [0, 0.4, 0.02], 0.12, 1.1, [0, 0, 1]);
  sway(rig, Bone.Ear, [0.09, 0.72, 0], 0.1, 2, [0, 0, 1]);

  // Its real eyes, peering out from under the hem.
  b.ellipsoid([0, 0.05, 0.18], [0.14, 0.05, 0.12], shadow, Bone.Root);
  bothSides((s) => b.ellipsoid([0.05 * s, 0.06, 0.29], [0.012, 0.015, 0.006], hex(0xf0e4a0), Bone.Root));
  // The stick tail.
  b.shape([[0, 0], [0.05, 0.12], [0.0, 0.2], [0.06, 0.34], [0.02, 0.34], [-0.03, 0.2], [0.01, 0.12], [-0.03, 0.0]], 0.025,
    { at: [0, 0.2, -0.28], rotation: [0, Math.PI / 2, 0.2] }, stick, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.2, -0.26], 0.35, 1.6);
  rig.hoverBob = 0.012;
  rig.walkBob = 0.03;
  rig.strideRate = 2.4;
};

export const VIKAVOLT: CreatureModel = (b, rig) => {
  const body = hex(0x2d5f7a);
  const blue = hex(0x3a86c8);
  const yellow = hex(0xf2d34a);
  const wing = hex(0x9fd6e8);

  b.ellipsoid([0, 0.46, -0.1], [0.16, 0.13, 0.34], body, Bone.Root);
  for (const z of [0.02, -0.14, -0.28]) b.ellipsoid([0, 0.55, z], [0.13, 0.04, 0.06], blue, Bone.Root);
  const head: V3 = [0, 0.46, 0.26];
  const headR: V3 = [0.13, 0.11, 0.12];
  b.ellipsoid(head, headR, body, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.25, size: 0.03, tall: 0.8, slant: 0.35, iris: yellow });
  // The great mandibles — its generator, and its cannon.
  bothSides((s) => {
    b.limb([0.08 * s, 0.44, 0.34], [0.14 * s, 0.44, 0.6], 0.05, 0.04, blue, Bone.Head);
    b.cone([0.14 * s, 0.44, 0.6], [0.05 * s, 0.44, 0.78], 0.04, yellow, Bone.Head);
  });
  sway(rig, Bone.Head, [0, 0.46, 0.18], 0.06, 1.2, [0, 1, 0]);

  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    for (const tilt of [0.2, -0.25]) {
      b.shape([[0, 0], [0.34, 0.06], [0.4, 0.0], [0.3, -0.08], [0, -0.04]], 0.012,
        { at: [0.1 * s, 0.56, -0.02 + tilt * 0.3], rotation: [0, tilt, s > 0 ? 0.3 : Math.PI - 0.3] }, wing, bone);
    }
    flap(rig, bone, [0.1 * s, 0.56, 0], 0.5, 9, [0, 0, s]);
  });
  rig.flies = true;
  rig.hoverBob = 0.04;
  rig.strideRate = 1;
};

export const SANDSHREW_ALOLA: CreatureModel = (b, rig) => {
  const ice = hex(0x8fbad8);
  const pale = hex(0xcfe5f2);
  const white = hex(0xf4f8fb);
  const steel = hex(0x5d7d9e);

  // Plated back: a stack of overlapping steel-ice shells.
  b.ellipsoid([0, 0.34, -0.06], [0.24, 0.26, 0.22], ice, Bone.Root);
  for (const [y, z] of [[0.5, -0.02], [0.4, -0.18], [0.24, -0.2]]) {
    b.ellipsoid([0, y, z], [0.2, 0.08, 0.1], pale, Bone.Root);
  }
  b.ellipsoid([0, 0.3, 0.1], [0.17, 0.2, 0.12], white, Bone.Root);
  const head: V3 = [0, 0.56, 0.14];
  const headR: V3 = [0.15, 0.13, 0.13];
  b.ellipsoid(head, headR, white, Bone.Head);
  b.ellipsoid([0, 0.62, 0.08], [0.15, 0.08, 0.12], ice, Bone.Head);
  spot(b, [0, 0.54, 0.27], 0.02, steel, Bone.Head);
  b.eyes(head, headR, { spread: 0.45, lift: 0.12, size: 0.028, tall: 1.2, iris: hex(0x274a78) });
  bothSides((s) => b.cone([0.09 * s, 0.68, 0.08], [0.13 * s, 0.76, 0.04], 0.035, ice, Bone.Ear));
  headLook(rig, [0, 0.48, 0.1], 0.14, 1.2);

  arms(b, rig, { x: 0.18, shoulderY: 0.36, z: 0.1, length: 0.12, thickness: 0.04, color: white, spread: 0.5, forward: 0.5 });
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    for (const k of [-1, 1]) b.cone([(0.18 + 0.06) * s + k * 0.015, 0.27, 0.16], [(0.18 + 0.07) * s + k * 0.02, 0.22, 0.22], 0.012, steel, bone);
  });
  bipedLegs(b, rig, { x: 0.12, hipY: 0.14, thickness: 0.06, color: white, foot: pale });
  rig.walkBob = 0.04;
  rig.strideRate = 2.6;
};

export const VULPIX_ALOLA: CreatureModel = (b, rig) => {
  const white = hex(0xf5f7fb);
  const ice = hex(0xc8e0f2);
  const blue = hex(0x7fb4dc);

  b.ellipsoid([0, 0.3, -0.04], [0.12, 0.13, 0.22], white, Bone.Root);
  const head: V3 = [0, 0.47, 0.2];
  const headR: V3 = [0.15, 0.14, 0.14];
  b.ellipsoid(head, headR, white, Bone.Head);
  b.ellipsoid([0, 0.43, 0.3], [0.07, 0.05, 0.06], white, Bone.Head);
  spot(b, [0, 0.45, 0.36], 0.018, hex(0x44506a), Bone.Head);
  b.eyes(head, headR, { spread: 0.44, lift: 0.12, size: 0.03, tall: 1.2, iris: hex(0x3a5a9a) });
  // Icy curls on the head.
  for (const [x, y, z] of [[0, 0.62, 0.2], [0.06, 0.6, 0.16], [-0.06, 0.6, 0.16], [0, 0.6, 0.28]] as const) {
    b.ellipsoid([x, y, z], [0.045, 0.04, 0.04], ice, Bone.Head);
  }
  bothSides((s) => {
    b.cone([0.09 * s, 0.56, 0.16], [0.16 * s, 0.72, 0.12], 0.05, white, Bone.Ear, { flatten: 0.4 });
    b.cone([0.095 * s, 0.57, 0.17], [0.15 * s, 0.68, 0.14], 0.03, blue, Bone.Ear, { flatten: 0.3 });
  });
  headLook(rig, [0, 0.38, 0.14], 0.16);
  sway(rig, Bone.Ear, [0, 0.56, 0.16], 0.08, 3, [0, 0, 1]);

  // Six curling tails, fanned.
  for (let i = 0; i < 6; i++) {
    const a = ((i - 2.5) / 2.5) * 0.9;
    const base: V3 = [0, 0.32, -0.24];
    const mid: V3 = [Math.sin(a) * 0.14, 0.44, -0.36];
    const tip: V3 = [Math.sin(a) * 0.22, 0.58, -0.36];
    chain(b, [base, mid, tip], [0.035, 0.04, 0.03], white, Bone.Tail);
    b.ellipsoid(tip, [0.055, 0.05, 0.05], ice, Bone.Tail);
  }
  sway(rig, Bone.Tail, [0, 0.32, -0.24], 0.22, 2.2);
  quadLegs(b, rig, { x: 0.07, hipY: 0.24, frontZ: 0.13, backZ: -0.16, thickness: 0.035, color: white, paw: ice });
  rig.strideRate = 2.8;
};

export const GEODUDE_ALOLA: CreatureModel = (b, rig) => {
  const rock = hex(0x8e8b84);
  const light = hex(0xb4b0a6);
  const iron = hex(0x26252b);

  // A lumpy boulder.
  b.ellipsoid([0, 0.5, 0], [0.3, 0.28, 0.28], rock, Bone.Root);
  for (const [x, y, z, r] of [[0.14, 0.64, 0.08, 0.12], [-0.16, 0.42, 0.1, 0.13], [0.08, 0.36, -0.16, 0.14], [-0.1, 0.66, -0.12, 0.12]] as const) {
    b.ellipsoid([x, y, z], [r, r * 0.9, r], light, Bone.Root);
  }
  b.eyes([0, 0.54, 0.02], [0.3, 0.28, 0.28], { spread: 0.3, lift: 0.1, size: 0.035, tall: 0.75, slant: 0.4 });
  // Magnetised iron sand bristling where brows would be.
  bothSides((s) => {
    for (let k = 0; k < 3; k++) {
      b.cone([0.07 * s + k * 0.03 * s, 0.66, 0.24], [0.1 * s + k * 0.06 * s, 0.76 + k * 0.02, 0.26], 0.03, iron, Bone.Head);
    }
  });
  sway(rig, Bone.Head, [0, 0.5, 0], 0.04, 1.2, [0, 1, 0]);

  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.26 * s, 0.5, 0.02];
    b.limb(shoulder, [0.44 * s, 0.4, 0.14], 0.07, 0.06, rock, bone);
    b.ellipsoid([0.47 * s, 0.38, 0.18], [0.09, 0.09, 0.09], light, bone);
    flap(rig, bone, shoulder, 0.25, 2, [0, 0, 1], s > 0 ? 0 : Math.PI);
  });
  rig.flies = true;
  rig.hoverBob = 0.04;
  rig.breath = 0.01;
};

export const MAROWAK_ALOLA: CreatureModel = (b, rig) => {
  const body = hex(0x3b2d36);
  const belly = hex(0x6a5563);
  const bone = hex(0xeee4cf);
  const flameA = hex(0x6fe0a0);
  const flameB = hex(0x8b52d6);

  b.ellipsoid([0, 0.4, 0], [0.17, 0.22, 0.15], body, Bone.Root);
  b.ellipsoid([0, 0.38, 0.08], [0.12, 0.17, 0.09], belly, Bone.Root);
  const head: V3 = [0, 0.72, 0.06];
  const headR: V3 = [0.16, 0.15, 0.16];
  // The skull it wears, with eye sockets and a horn ridge.
  b.ellipsoid(head, headR, bone, Bone.Head);
  b.ellipsoid([0, 0.66, 0.2], [0.09, 0.06, 0.07], bone, Bone.Head);
  b.eyes(head, headR, { spread: 0.4, lift: 0.1, size: 0.04, tall: 0.8, slant: 0.2, iris: hex(0x1a1216), whites: false });
  b.cone([0, 0.84, 0.0], [0, 0.94, -0.12], 0.05, bone, Bone.Head);
  headLook(rig, [0, 0.56, 0.04], 0.12);

  // The flaming bone, twirled in its right hand.
  arms(b, rig, { x: 0.16, shoulderY: 0.52, z: 0.04, length: 0.18, thickness: 0.04, color: body, spread: 0.4, forward: 0.4 });
  const hand: V3 = [-0.24, 0.36, 0.13];
  b.limb([hand[0], hand[1] - 0.2, hand[2]], [hand[0], hand[1] + 0.28, hand[2]], 0.022, 0.022, bone, Bone.ArmRight);
  for (const [y, dir] of [[hand[1] - 0.2, -1], [hand[1] + 0.28, 1]] as const) {
    b.ellipsoid([hand[0], y, hand[2]], [0.045, 0.035, 0.035], bone, Bone.ArmRight);
    b.cone([hand[0], y, hand[2]], [hand[0], y + dir * 0.14, hand[2]], 0.05, flameA, Bone.ArmRight);
    b.cone([hand[0], y + dir * 0.02, hand[2]], [hand[0], y + dir * 0.1, hand[2]], 0.035, flameB, Bone.ArmRight);
  }
  chain(b, [[0, 0.26, -0.12], [0, 0.18, -0.28], [0, 0.12, -0.4]], [0.06, 0.045, 0.02], body, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.26, -0.12], 0.3, 1.8);
  bipedLegs(b, rig, { x: 0.1, hipY: 0.2, thickness: 0.06, color: body });
  rig.strideRate = 2;
};

export const EXEGGUTOR_ALOLA: CreatureModel = (b, rig) => {
  const trunk = hex(0xd8b278);
  const bark = hex(0x9a6a3e);
  const nut = hex(0xefb445);
  const leaf = hex(0x4f9b41);

  // Absurdly tall: legs and body at the bottom, a neck like a palm trunk, and
  // the coconut heads up in the leaves.
  b.ellipsoid([0, 0.1, 0], [0.09, 0.06, 0.08], trunk, Bone.Root);
  for (let i = 0; i < 9; i++) {
    const y0 = 0.14 + i * 0.085;
    b.limb([0, y0, 0], [0, y0 + 0.085, 0], 0.034, 0.032, i % 2 === 0 ? trunk : bark, Bone.Head);
  }
  const crown: V3 = [0, 0.93, 0];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.shape([[0, 0], [0.05, 0.02], [0.2, -0.01], [0.26, -0.06], [0.1, -0.02]], 0.01,
      { at: crown, rotation: [0, a, -0.3] }, leaf, Bone.Head);
  }
  // Three heads among the leaves.
  for (const [x, y, z] of [[0.06, 0.95, 0.05], [-0.06, 0.97, 0.03], [0, 0.9, 0.08]] as const) {
    b.ellipsoid([x, y, z], [0.045, 0.045, 0.045], nut, Bone.Head);
    b.eyes([x, y, z], [0.045, 0.045, 0.045], { spread: 0.45, lift: 0.1, size: 0.008, tall: 0.9, slant: 0.2 });
  }
  sway(rig, Bone.Head, [0, 0.14, 0], 0.07, 0.6, [0, 0, 1]);

  // The tail has a head too.
  chain(b, [[0, 0.1, -0.06], [0, 0.07, -0.16], [0, 0.1, -0.24]], [0.03, 0.025, 0.02], trunk, Bone.Tail);
  b.ellipsoid([0, 0.12, -0.27], [0.035, 0.035, 0.035], nut, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.1, -0.06], 0.3, 1.2);
  quadLegs(b, rig, { x: 0.06, hipY: 0.08, frontZ: 0.02, backZ: 0.02, thickness: 0.035, color: trunk, paw: bark, amplitude: 0.35 });
  rig.strideRate = 1;
  rig.walkBob = 0.004;
};

export const GRIMER_ALOLA: CreatureModel = (b, rig) => {
  const green = hex(0x58bb72);
  const lime = hex(0x9fdc6a);
  const mouth = hex(0x2b1d2e);
  const teeth = hex(0xf2d24a);
  const crystals = [hex(0xf2d24a), hex(0xe96aa6), hex(0x5ab0e6), hex(0xf5f5f0)];

  // A heap of sludge that has not quite settled.
  b.ellipsoid([0, 0.26, 0], [0.34, 0.24, 0.3], green, Bone.Root);
  b.ellipsoid([0, 0.5, 0.02], [0.24, 0.2, 0.22], green, Bone.Root);
  for (const [x, z] of [[0.28, 0.1], [-0.3, 0.02], [0.18, -0.24], [-0.14, 0.24]] as const) {
    b.ellipsoid([x, 0.06, z], [0.12, 0.06, 0.12], lime, Bone.Root);
  }
  b.ellipsoid([0, 0.48, 0.2], [0.13, 0.08, 0.06], mouth, Bone.Head);
  b.ellipsoid([0, 0.5, 0.24], [0.12, 0.02, 0.03], teeth, Bone.Head);
  b.eyes([0, 0.62, 0.06], [0.22, 0.14, 0.18], { spread: 0.4, lift: 0.2, size: 0.035, tall: 1.1, whites: true });
  // Toxic crystals: its teeth, pushed out through its skin.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const base: V3 = [Math.sin(a) * 0.26, 0.34 + (i % 2) * 0.12, Math.cos(a) * 0.22];
    b.cone(base, [base[0] * 1.45, base[1] + 0.08, base[2] * 1.45], 0.04, crystals[i % crystals.length], Bone.Root);
  }
  sway(rig, Bone.Head, [0, 0.4, 0.1], 0.06, 1.4, [0, 0, 1]);
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.28 * s, 0.4, 0.06];
    b.limb(shoulder, [0.42 * s, 0.3, 0.18], 0.08, 0.07, green, bone);
    flap(rig, bone, shoulder, 0.3, 1.6, [0, 0, 1], s > 0 ? 0 : Math.PI);
  });
  rig.breath = 0.04;
  rig.walkBob = 0.03;
  rig.strideRate = 1.4;
};

export const CHARIZARD: CreatureModel = (b, rig) => {
  const orange = hex(0xf08a3a);
  const cream = hex(0xf5d9a0);
  const teal = hex(0x2f8f9e);
  const flameA = hex(0xffb03a);
  const flameB = hex(0xffe36a);

  b.ellipsoid([0, 0.46, 0], [0.18, 0.24, 0.17], orange, Bone.Root);
  b.ellipsoid([0, 0.44, 0.09], [0.13, 0.2, 0.1], cream, Bone.Root);
  b.limb([0, 0.64, 0.04], [0, 0.78, 0.1], 0.08, 0.065, orange, Bone.Head);
  const head: V3 = [0, 0.84, 0.14];
  const headR: V3 = [0.1, 0.09, 0.12];
  b.ellipsoid(head, headR, orange, Bone.Head);
  b.ellipsoid([0, 0.8, 0.24], [0.07, 0.05, 0.06], orange, Bone.Head);
  b.eyes(head, headR, { spread: 0.55, lift: 0.3, size: 0.022, tall: 0.8, slant: 0.3, iris: hex(0x2a5a8a), whites: true });
  bothSides((s) => b.cone([0.05 * s, 0.9, 0.08], [0.08 * s, 0.94, -0.06], 0.03, orange, Bone.Head));
  headLook(rig, [0, 0.66, 0.06], 0.12);

  // Wings: orange outside, teal membrane within.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    const root: V3 = [0.08 * s, 0.62, -0.1];
    const wing = [[0, 0], [0.18, 0.2], [0.42, 0.34], [0.38, 0.14], [0.3, 0.02], [0.2, -0.02]] as const;
    b.shape(wing, 0.018, { at: root, rotation: [0.3, s > 0 ? -0.5 : Math.PI + 0.5, 0] }, orange, bone);
    b.shape(wing.map(([x, y]) => [x * 0.86 + 0.02, y * 0.8 + 0.02] as const), 0.03,
      { at: root, rotation: [0.3, s > 0 ? -0.5 : Math.PI + 0.5, 0] }, teal, bone);
    flap(rig, bone, root, 0.25, 1.4, [0, 0, s]);
  });

  chain(b, [[0, 0.3, -0.12], [0, 0.22, -0.3], [0, 0.26, -0.46]], [0.08, 0.06, 0.04], orange, Bone.Tail);
  b.cone([0, 0.26, -0.46], [0, 0.44, -0.5], 0.06, flameA, Bone.Tail);
  b.cone([0, 0.27, -0.46], [0, 0.38, -0.49], 0.035, flameB, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.3, -0.12], 0.25, 1.5);
  arms(b, rig, { x: 0.16, shoulderY: 0.56, z: 0.06, length: 0.16, thickness: 0.035, color: orange, spread: 0.4, forward: 0.5 });
  bipedLegs(b, rig, { x: 0.11, hipY: 0.26, thickness: 0.07, color: orange, foot: cream });
  rig.strideRate = 1.6;
};

export const KOMMO_O: CreatureModel = (b, rig) => {
  const grey = hex(0x8d8e99);
  const gold = hex(0xe8b43c);
  const red = hex(0xc9403a);

  b.ellipsoid([0, 0.46, 0], [0.18, 0.24, 0.16], grey, Bone.Root);
  // Golden scales overlap down its chest and back.
  for (let i = 0; i < 4; i++) {
    b.ellipsoid([0, 0.62 - i * 0.09, 0.12], [0.1 - i * 0.01, 0.045, 0.04], gold, Bone.Root);
    b.ellipsoid([0, 0.62 - i * 0.09, -0.12], [0.12, 0.05, 0.05], gold, Bone.Root);
  }
  const head: V3 = [0, 0.82, 0.06];
  const headR: V3 = [0.11, 0.1, 0.11];
  b.ellipsoid(head, headR, grey, Bone.Head);
  b.eyes(head, headR, { spread: 0.45, lift: 0.1, size: 0.022, tall: 0.8, slant: 0.35, iris: hex(0x2a3a7a) });
  // Crest of scale plates, red at the tips.
  for (const [x, len] of [[0, 0.2], [0.07, 0.15], [-0.07, 0.15]] as const) {
    b.cone([x, 0.9, 0.0], [x * 1.8, 0.9 + len, -0.08], 0.04, gold, Bone.Head, { flatten: 0.4 });
    b.cone([x * 1.6, 0.9 + len * 0.7, -0.06], [x * 1.8, 0.9 + len, -0.08], 0.018, red, Bone.Head);
  }
  headLook(rig, [0, 0.66, 0.04], 0.1);

  // Scale shields on the forearms.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.17 * s, 0.62, 0.02];
    b.limb(shoulder, [0.26 * s, 0.42, 0.12], 0.05, 0.045, grey, bone);
    b.ellipsoid([0.27 * s, 0.44, 0.13], [0.03, 0.1, 0.07], gold, bone, [0, 0, 0.2 * s]);
    swing(rig, bone, shoulder, s > 0 ? Math.PI : 0, 0.35);
  });
  chain(b, [[0, 0.3, -0.12], [0, 0.18, -0.28], [0, 0.14, -0.44]], [0.07, 0.055, 0.03], grey, Bone.Tail);
  for (let i = 0; i < 3; i++) b.ellipsoid([0, 0.28 - i * 0.05, -0.2 - i * 0.1], [0.05, 0.03, 0.04], gold, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.3, -0.12], 0.25, 1.4);
  bipedLegs(b, rig, { x: 0.1, hipY: 0.24, thickness: 0.07, color: grey, foot: gold });
  rig.strideRate = 1.7;
};

// Silences an unused-import lint in environments that enforce it.
void mix;
