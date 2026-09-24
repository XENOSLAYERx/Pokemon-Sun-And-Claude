/**
 * The guardians, the legends, and the Ultra Beasts.
 *
 * These are the silhouettes a player should recognise from across a valley,
 * so each is built around one or two unmistakable shapes: the Tapus' shells,
 * Solgaleo's mane, Lunala's wings, Nihilego's bell.
 */
import { Bone, type V3 } from '../rig.ts';
import { hex, bothSides, type ModelBuilder, type RGB } from '../geometry.ts';
import { bipedLegs, quadLegs, arms, headLook, sway, flap, spot, swing, chain, type CreatureModel } from '../kit.ts';
import type { RigSpec } from '../rig.ts';

/**
 * A Tapu: a small body inside two great shell halves that can close around it,
 * hovering. The shell halves ride the wing bones so they open and close.
 */
function tapu(b: ModelBuilder, rig: RigSpec, c: {
  body: RGB; shell: RGB; trim: RGB; crest: RGB; eye: RGB;
}, crest: (b: ModelBuilder) => void): void {
  b.ellipsoid([0, 0.52, 0], [0.13, 0.2, 0.12], c.body, Bone.Root);
  const head: V3 = [0, 0.8, 0.02];
  const headR: V3 = [0.12, 0.11, 0.11];
  b.ellipsoid(head, headR, c.body, Bone.Head);
  b.eyes(head, headR, { spread: 0.4, lift: 0.1, size: 0.026, tall: 0.7, slant: 0.35, iris: c.eye });
  crest(b);
  headLook(rig, [0, 0.7, 0], 0.12, 0.7);

  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    const hinge: V3 = [0.14 * s, 0.6, 0.02];
    // The shell half: a large curved plate, trimmed at the edge.
    b.ellipsoid([0.28 * s, 0.56, 0.04], [0.1, 0.34, 0.22], c.shell, bone, [0, -0.4 * s, 0.15 * s]);
    b.ellipsoid([0.34 * s, 0.56, 0.08], [0.05, 0.3, 0.17], c.trim, bone, [0, -0.4 * s, 0.15 * s]);
    flap(rig, bone, hinge, 0.14, 1.1, [0, 1, 0], s > 0 ? 0 : Math.PI);
  });
  // Tapering lower body — no legs; they float.
  b.cone([0, 0.38, 0], [0, 0.1, 0.02], 0.1, c.body, Bone.Root);
  rig.flies = true;
  rig.hoverBob = 0.04;
  rig.breath = 0.01;
}

export const TAPU_KOKO: CreatureModel = (b, rig) => tapu(b, rig, {
  body: hex(0x2c2a30), shell: hex(0xf09a2e), trim: hex(0xf6d23a), crest: hex(0xf6d23a), eye: hex(0x3a8ad6),
}, (b) => {
  // The rooster crest.
  for (let i = 0; i < 3; i++) {
    b.cone([0, 0.88, -0.02 - i * 0.05], [0, 1.02 - i * 0.03, -0.08 - i * 0.07], 0.04, hex(0xf6d23a), Bone.Head, { flatten: 0.4 });
  }
});

export const TAPU_LELE: CreatureModel = (b, rig) => tapu(b, rig, {
  body: hex(0x3a3246), shell: hex(0xf28cc0), trim: hex(0xfbe0ee), crest: hex(0xf28cc0), eye: hex(0x9a5ad6),
}, (b) => {
  bothSides((s) => chain(b, [[0.05 * s, 0.88, 0], [0.1 * s, 0.98, -0.04], [0.08 * s, 1.06, -0.1]], [0.015, 0.012, 0.01], hex(0xf28cc0), Bone.Head));
});

export const TAPU_BULU: CreatureModel = (b, rig) => tapu(b, rig, {
  body: hex(0x2c2a30), shell: hex(0xc8342f), trim: hex(0x5a2a2a), crest: hex(0xf2c63a), eye: hex(0xf2c63a),
}, (b) => {
  // Great yellow horns.
  bothSides((s) => {
    b.limb([0.06 * s, 0.86, 0], [0.18 * s, 0.94, -0.02], 0.035, 0.03, hex(0xf2c63a), Bone.Head);
    b.cone([0.18 * s, 0.94, -0.02], [0.24 * s, 1.1, -0.06], 0.03, hex(0xf2c63a), Bone.Head);
  });
});

export const TAPU_FINI: CreatureModel = (b, rig) => tapu(b, rig, {
  body: hex(0x2c3446), shell: hex(0x9a86d6), trim: hex(0xd2eef6), crest: hex(0x9a86d6), eye: hex(0x3ac6d6),
}, (b) => {
  b.ellipsoid([0, 0.94, -0.04], [0.1, 0.06, 0.1], hex(0xd2eef6), Bone.Head);
  bothSides((s) => b.cone([0.06 * s, 0.94, -0.06], [0.14 * s, 1.02, -0.14], 0.03, hex(0x9a86d6), Bone.Head, { flatten: 0.4 }));
});

export const COSMOG: CreatureModel = (b, rig) => {
  const nebula = hex(0x2d2f7a);
  const glow = hex(0x6fb0f0);
  const gold = hex(0xf2d24a);

  b.ellipsoid([0, 0.4, 0], [0.24, 0.24, 0.22], nebula, Bone.Root);
  b.ellipsoid([0, 0.46, 0.08], [0.16, 0.14, 0.14], hex(0x3a4aa8), Bone.Root);
  b.eyes([0, 0.44, 0.04], [0.24, 0.24, 0.22], { spread: 0.35, lift: 0.0, size: 0.05, tall: 1.3, whites: true, iris: hex(0x2a3a8a) });
  spot(b, [0, 0.62, 0.14], 0.05, gold, Bone.Head, [-0.8, 0, 0]);
  // Gaseous clouds at its sides.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.ellipsoid([0.3 * s, 0.34, 0], [0.12, 0.1, 0.1], glow, bone);
    b.ellipsoid([0.38 * s, 0.28, -0.04], [0.07, 0.06, 0.06], nebula, bone);
    flap(rig, bone, [0.2 * s, 0.38, 0], 0.3, 1.6, [0, 0, s]);
  });
  sway(rig, Bone.Head, [0, 0.4, 0], 0.06, 1.2, [0, 1, 0]);
  rig.flies = true;
  rig.hoverBob = 0.05;
};

export const SOLGALEO: CreatureModel = (b, rig) => {
  const white = hex(0xf2f0e8);
  const gold = hex(0xf0a832);
  const flare = hex(0xf6d86a);
  const mask = hex(0x1f2a4a);

  b.ellipsoid([0, 0.46, -0.05], [0.16, 0.16, 0.32], white, Bone.Root);
  b.limb([0, 0.54, 0.2], [0, 0.66, 0.3], 0.1, 0.085, white, Bone.Head);
  const head: V3 = [0, 0.7, 0.36];
  const headR: V3 = [0.11, 0.1, 0.12];
  b.ellipsoid(head, headR, white, Bone.Head);
  b.ellipsoid([0, 0.72, 0.44], [0.07, 0.04, 0.05], mask, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.1, size: 0.022, tall: 0.7, slant: 0.3, iris: hex(0x3aa6d6) });
  // The sun mane: flares radiating from behind the head.
  for (let i = 0; i < 9; i++) {
    const a = ((i - 4) / 4) * 1.4;
    const root: V3 = [Math.sin(a) * 0.05, 0.72 + Math.cos(a) * 0.05, 0.26];
    const tip: V3 = [Math.sin(a) * 0.3, 0.72 + Math.cos(a) * 0.3, 0.14];
    b.cone(root, tip, 0.05, i % 2 === 0 ? gold : flare, Bone.Head, { flatten: 0.35 });
  }
  headLook(rig, [0, 0.56, 0.24], 0.08, 0.6);

  b.ellipsoid([0, 0.58, -0.06], [0.1, 0.03, 0.24], gold, Bone.Root);
  chain(b, [[0, 0.5, -0.36], [0, 0.44, -0.52], [0, 0.5, -0.64]], [0.04, 0.035, 0.03], white, Bone.Tail, gold);
  sway(rig, Bone.Tail, [0, 0.5, -0.36], 0.25, 1.4);
  quadLegs(b, rig, { x: 0.1, hipY: 0.38, frontZ: 0.16, backZ: -0.24, thickness: 0.055, color: white, paw: gold });
  rig.strideRate = 1.3;
};

export const LUNALA: CreatureModel = (b, rig) => {
  const dark = hex(0x2e2150);
  const purple = hex(0x5a3a9a);
  const moon = hex(0xf2e6a8);
  const face = hex(0xe8ecf6);

  b.ellipsoid([0, 0.5, 0], [0.12, 0.2, 0.12], dark, Bone.Root);
  const head: V3 = [0, 0.74, 0.04];
  const headR: V3 = [0.1, 0.09, 0.1];
  b.ellipsoid(head, headR, face, Bone.Head);
  b.eyes(head, headR, { spread: 0.45, lift: 0.0, size: 0.02, tall: 0.7, iris: hex(0x3a8ad6) });
  // The third eye on its brow.
  spot(b, [0, 0.8, 0.13], 0.022, hex(0xd65a8a), Bone.Head);
  bothSides((s) => b.cone([0.06 * s, 0.8, 0.0], [0.12 * s, 0.94, -0.06], 0.035, dark, Bone.Head, { flatten: 0.5 }));
  headLook(rig, [0, 0.64, 0.02], 0.1, 0.6);

  // Vast wings, each carrying a crescent moon.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    const root: V3 = [0.08 * s, 0.62, -0.02];
    const rotation: V3 = [0, 0.15 * s, s > 0 ? 0.2 : Math.PI - 0.2];
    b.shape([[0, 0.06], [0.3, 0.3], [0.62, 0.36], [0.7, 0.12], [0.6, -0.12], [0.44, -0.04], [0.3, -0.24], [0.16, -0.08], [0, -0.1]], 0.02,
      { at: root, rotation }, dark, bone);
    const crescent: (readonly [number, number])[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = -1.2 + (2.4 * i) / 10;
      crescent.push([0.42 + Math.cos(t) * 0.14, 0.1 + Math.sin(t) * 0.14]);
    }
    for (let i = 10; i >= 0; i--) {
      const t = -1.0 + (2.0 * i) / 10;
      crescent.push([0.46 + Math.cos(t) * 0.1, 0.1 + Math.sin(t) * 0.11]);
    }
    b.shape(crescent, 0.03, { at: root, rotation }, moon, bone);
    b.shape([[0.1, 0.04], [0.3, 0.22], [0.5, 0.26], [0.3, 0.06]], 0.028, { at: root, rotation }, purple, bone);
    flap(rig, bone, root, 0.28, 1.2, [0, 0, s]);
  });
  rig.flies = true;
  rig.hoverBob = 0.05;
};

export const NECROZMA: CreatureModel = (b, rig) => {
  const black = hex(0x1c1c26);
  const prism = hex(0x7fd0f0);
  const gold = hex(0xf2c850);

  // All angles: prisms and blades, no curves.
  b.cone([0, 0.3, 0], [0, 0.72, 0], 0.16, black, Bone.Root, { sides: 5 });
  b.cone([0, 0.3, 0], [0, 0.1, 0], 0.16, black, Bone.Root, { sides: 5 });
  const head: V3 = [0, 0.78, 0.04];
  b.cone(head, [0, 0.98, -0.02], 0.08, black, Bone.Head, { sides: 4 });
  b.eyes(head, [0.08, 0.06, 0.08], { spread: 0.4, lift: 0.0, size: 0.02, tall: 0.5, slant: 0.4, iris: prism });
  headLook(rig, [0, 0.72, 0.02], 0.08, 0.5);
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.12 * s, 0.6, 0];
    b.cone(shoulder, [0.46 * s, 0.72, 0.1], 0.07, black, bone, { sides: 4, flatten: 0.4 });
    b.cone([0.3 * s, 0.66, 0.05], [0.52 * s, 0.9, 0.1], 0.03, prism, bone, { sides: 4 });
    b.cone([0.2 * s, 0.44, 0.02], [0.4 * s, 0.24, 0.08], 0.03, gold, bone, { sides: 4 });
    flap(rig, bone, shoulder, 0.12, 0.9, [0, 0, s]);
  });
  rig.flies = true;
  rig.hoverBob = 0.035;
  rig.breath = 0.005;
};

export const NIHILEGO: CreatureModel = (b, rig) => {
  const glass = hex(0xe6eef8);
  const inner = hex(0xd6a6d8);
  const white = hex(0xfafafc);

  // A glassy bell, with something like a hat.
  b.ellipsoid([0, 0.72, 0], [0.2, 0.18, 0.2], glass, Bone.Root);
  b.ellipsoid([0, 0.7, 0], [0.13, 0.12, 0.13], inner, Bone.Root);
  b.ellipsoid([0, 0.86, 0], [0.12, 0.06, 0.12], white, Bone.Head);
  sway(rig, Bone.Head, [0, 0.8, 0], 0.06, 1.1, [0, 0, 1]);
  // Tentacles, trailing and drifting.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const bone = i % 2 === 0 ? Bone.Tail : Bone.ArmLeft;
    chain(b, [
      [Math.sin(a) * 0.12, 0.56, Math.cos(a) * 0.12],
      [Math.sin(a) * 0.18, 0.38, Math.cos(a) * 0.18],
      [Math.sin(a) * 0.14, 0.18, Math.cos(a) * 0.14],
      [Math.sin(a) * 0.08, 0.02, Math.cos(a) * 0.08],
    ], [0.03, 0.026, 0.02, 0.012], glass, bone);
  }
  sway(rig, Bone.Tail, [0, 0.56, 0], 0.18, 1.1, [1, 0, 0]);
  sway(rig, Bone.ArmLeft, [0, 0.56, 0], 0.18, 1.3, [0, 0, 1], 1);
  rig.flies = true;
  rig.hoverBob = 0.06;
};

export const BUZZWOLE: CreatureModel = (b, rig) => {
  const red = hex(0xd23a30);
  const dark = hex(0x6a1c1a);
  const wing = hex(0xf0e0a0);

  b.ellipsoid([0, 0.54, 0], [0.18, 0.2, 0.15], red, Bone.Root);
  b.ellipsoid([0, 0.34, -0.06], [0.12, 0.14, 0.12], dark, Bone.Root);
  const head: V3 = [0, 0.78, 0.06];
  const headR: V3 = [0.07, 0.07, 0.07];
  b.ellipsoid(head, headR, red, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.1, size: 0.02, tall: 0.7, slant: 0.35, iris: hex(0xf2c63a) });
  // The proboscis.
  b.cone([0, 0.76, 0.12], [0, 0.66, 0.36], 0.02, dark, Bone.Head);
  headLook(rig, [0, 0.72, 0.04], 0.1);

  // Absurd arms: the whole point of Buzzwole.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.2 * s, 0.62, 0.02];
    b.ellipsoid([0.34 * s, 0.6, 0.06], [0.16, 0.14, 0.14], red, bone);
    b.limb([0.4 * s, 0.52, 0.1], [0.42 * s, 0.34, 0.16], 0.1, 0.09, red, bone);
    b.ellipsoid([0.42 * s, 0.3, 0.18], [0.11, 0.1, 0.11], dark, bone);
    swing(rig, bone, shoulder, s > 0 ? Math.PI : 0, 0.3);
  });
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.shape([[0, 0], [0.12, 0.22], [0.2, 0.18], [0.1, 0]], 0.01, { at: [0.06 * s, 0.66, -0.12], rotation: [-0.5, s > 0 ? 0.3 : Math.PI - 0.3, 0] }, wing, bone);
    flap(rig, bone, [0.06 * s, 0.66, -0.12], 0.6, 14, [0, 1, 0]);
  });
  bipedLegs(b, rig, { x: 0.08, hipY: 0.24, thickness: 0.04, color: dark });
  rig.strideRate = 1.6;
};

export const PHEROMOSA: CreatureModel = (b, rig) => {
  const white = hex(0xf6f4f0);
  const cream = hex(0xeadfc6);
  const dark = hex(0x3a3440);

  // Almost all leg.
  b.ellipsoid([0, 0.72, 0], [0.06, 0.1, 0.05], white, Bone.Root);
  b.ellipsoid([0, 0.6, -0.02], [0.07, 0.06, 0.06], cream, Bone.Root);
  const head: V3 = [0, 0.86, 0.02];
  const headR: V3 = [0.05, 0.055, 0.05];
  b.ellipsoid(head, headR, white, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.1, size: 0.014, tall: 0.8, slant: 0.2, iris: hex(0x3a8ad6) });
  bothSides((s) => chain(b, [[0.02 * s, 0.9, 0.02], [0.08 * s, 1.0, 0.0], [0.14 * s, 1.04, -0.06]], [0.006, 0.005, 0.003], dark, Bone.Head));
  headLook(rig, [0, 0.8, 0.02], 0.12, 1.1);
  // The cape-like wings, folded down the back.
  b.shape([[0, 0], [0.1, -0.1], [0.06, -0.34], [-0.06, -0.34], [-0.1, -0.1]], 0.015, { at: [0, 0.8, -0.06], rotation: [0.15, 0, 0] }, cream, Bone.Root);
  arms(b, rig, { x: 0.05, shoulderY: 0.78, z: 0.02, length: 0.2, thickness: 0.012, color: white, spread: 0.3, forward: 0.3 });
  bipedLegs(b, rig, { x: 0.04, hipY: 0.6, thickness: 0.018, color: white, foot: dark, footLength: 0.03 });
  rig.strideRate = 1.8;
};

export const XURKITREE: CreatureModel = (b, rig) => {
  const cable = hex(0x1f1f28);
  const shine = hex(0x4a5a8a);
  const star = hex(0xf6f2c8);

  // A star for a head, on a body of twisted cables.
  const star5: (readonly [number, number])[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.12 : 0.05;
    star5.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  b.shape(star5, 0.04, { at: [0, 0.9, 0], rotation: [0, 0, 0] }, star, Bone.Head);
  sway(rig, Bone.Head, [0, 0.8, 0], 0.1, 0.9, [0, 0, 1]);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.03;
    chain(b, [[x, 0.8, 0], [x * 2, 0.6, 0.02], [x, 0.44, 0]], [0.02, 0.022, 0.02], i % 2 ? cable : shine, Bone.Root);
  }
  // Cable arms and legs, splayed.
  bothSides((s) => {
    const arm = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    chain(b, [[0.03 * s, 0.7, 0], [0.2 * s, 0.66, 0.02], [0.32 * s, 0.5, 0.04], [0.36 * s, 0.34, 0.06]], [0.018, 0.016, 0.014, 0.01], cable, arm);
    swing(rig, arm, [0.03 * s, 0.7, 0], s > 0 ? 0 : Math.PI, 0.2, [0, 0, 1]);
    const leg = s > 0 ? Bone.LegBackLeft : Bone.LegBackRight;
    chain(b, [[0.03 * s, 0.44, 0], [0.12 * s, 0.24, 0.02], [0.14 * s, 0.02, 0.04]], [0.02, 0.018, 0.014], cable, leg);
    swing(rig, leg, [0.03 * s, 0.44, 0], s > 0 ? 0 : Math.PI, 0.35);
  });
  rig.strideRate = 1.2;
};

export const GUZZLORD: CreatureModel = (b, rig) => {
  const black = hex(0x26242c);
  const pink = hex(0xd65a8a);
  const teeth = hex(0xf2eee0);
  const gold = hex(0xd9a83a);

  // Most of it is mouth.
  b.ellipsoid([0, 0.42, 0], [0.34, 0.32, 0.28], black, Bone.Root);
  b.ellipsoid([0, 0.4, 0.22], [0.26, 0.14, 0.08], pink, Bone.Root);
  for (let i = -4; i <= 4; i++) {
    b.cone([i * 0.05, 0.52, 0.26], [i * 0.05, 0.44, 0.28], 0.02, teeth, Bone.Root);
    b.cone([i * 0.05, 0.28, 0.26], [i * 0.05, 0.36, 0.28], 0.02, teeth, Bone.Root);
  }
  // A small head perched on top.
  const head: V3 = [0, 0.78, 0.04];
  const headR: V3 = [0.09, 0.08, 0.08];
  b.ellipsoid(head, headR, black, Bone.Head);
  b.eyes(head, headR, { spread: 0.5, lift: 0.1, size: 0.02, tall: 0.6, slant: 0.4, iris: gold });
  headLook(rig, [0, 0.72, 0.02], 0.1, 0.6);
  // Arms that are also jaws.
  bothSides((s) => {
    const bone = s > 0 ? Bone.ArmLeft : Bone.ArmRight;
    const shoulder: V3 = [0.3 * s, 0.5, 0.04];
    b.limb(shoulder, [0.48 * s, 0.34, 0.14], 0.08, 0.07, black, bone);
    b.ellipsoid([0.52 * s, 0.3, 0.2], [0.1, 0.08, 0.1], black, bone);
    b.ellipsoid([0.52 * s, 0.3, 0.26], [0.06, 0.02, 0.04], pink, bone);
    swing(rig, bone, shoulder, s > 0 ? Math.PI : 0, 0.3);
  });
  bipedLegs(b, rig, { x: 0.18, hipY: 0.14, thickness: 0.09, color: black, foot: gold });
  rig.walkBob = 0.02;
  rig.strideRate = 1.1;
};
