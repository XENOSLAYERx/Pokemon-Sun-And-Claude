/**
 * The sea: fish, a shark, a gull, and the gentlest thing in the ocean.
 *
 * Swimmers are modelled along Z at about one unit long, waterline near their
 * middle — the renderer floats them at the surface.
 */
import { Bone, type V3 } from '../rig.ts';
import { hex, bothSides } from '../geometry.ts';
import { headLook, sway, flap, spot, swing, chain, type CreatureModel } from '../kit.ts';

const WHITE = hex(0xf5f3ee);

/** A tail fin on the tail bone, and the sway that swims it. */
function tailFin(b: Parameters<CreatureModel>[0], rig: Parameters<CreatureModel>[1], at: V3, size: number, color: readonly [number, number, number], rate = 3.2): void {
  b.shape([[0, 0], [size * 0.9, size * 0.8], [size * 0.6, 0], [size * 0.9, -size * 0.8]], size * 0.12,
    { at, rotation: [0, Math.PI / 2, 0] }, color, Bone.Tail);
  sway(rig, Bone.Tail, [at[0], at[1], at[2] + size * 0.3], 0.35, rate);
}

export const SHARPEDO: CreatureModel = (b, rig) => {
  const blue = hex(0x2d4f8e);
  const red = hex(0xc8323a);
  const yellow = hex(0xf2c63a);

  b.ellipsoid([0, 0.3, 0], [0.2, 0.2, 0.46], blue, Bone.Root);
  b.ellipsoid([0, 0.2, 0.08], [0.17, 0.12, 0.34], red, Bone.Root);
  // The jaw, lined with teeth.
  b.ellipsoid([0, 0.22, 0.38], [0.14, 0.05, 0.1], hex(0x5a1a22), Bone.Head);
  for (let i = -3; i <= 3; i++) b.cone([i * 0.028, 0.25, 0.44], [i * 0.028, 0.21, 0.45], 0.012, WHITE, Bone.Head);
  b.eyes([0, 0.34, 0.26], [0.18, 0.14, 0.2], { spread: 0.8, lift: 0.1, size: 0.035, tall: 0.6, slant: 0.5, iris: yellow });
  // The yellow star on its snout.
  b.shape([[0, 0.05], [0.015, 0.015], [0.05, 0.01], [0.02, -0.01], [0.03, -0.05], [0, -0.025], [-0.03, -0.05], [-0.02, -0.01], [-0.05, 0.01], [-0.015, 0.015]],
    0.01, { at: [0, 0.36, 0.45], rotation: [-0.3, 0, 0] }, yellow, Bone.Head);
  sway(rig, Bone.Head, [0, 0.3, 0.2], 0.05, 3, [0, 1, 0]);

  b.shape([[0, 0], [0.14, 0.02], [0.06, 0.22]], 0.03, { at: [0, 0.48, -0.02], rotation: [0, -Math.PI / 2, 0] }, blue, Bone.Root);
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.shape([[0, 0], [0.18, -0.02], [0.12, -0.12]], 0.02, { at: [0.16 * s, 0.22, 0.14], rotation: [0, s > 0 ? 0 : Math.PI, -0.3 * s] }, blue, bone);
    flap(rig, bone, [0.16 * s, 0.22, 0.14], 0.2, 3, [0, 0, s]);
  });
  tailFin(b, rig, [0, 0.3, -0.46], 0.24, blue, 3.6);
  rig.walkBob = 0;
  rig.strideRate = 2.4;
};

export const LAPRAS: CreatureModel = (b, rig) => {
  const blue = hex(0x5aa3da);
  const cream = hex(0xf2e8cc);
  const shell = hex(0x8c87aa);
  const knob = hex(0x6c6890);

  b.ellipsoid([0, 0.3, -0.05], [0.28, 0.2, 0.38], blue, Bone.Root);
  b.ellipsoid([0, 0.22, 0.02], [0.24, 0.12, 0.32], cream, Bone.Root);
  // The shell: a low dome studded with knobs. Carries people across Alola.
  b.ellipsoid([0, 0.42, -0.1], [0.26, 0.14, 0.3], shell, Bone.Root);
  for (const [x, z] of [[0, 0.02], [0.12, -0.08], [-0.12, -0.08], [0.08, -0.24], [-0.08, -0.24], [0, -0.16]] as const) {
    b.cone([x, 0.5, z], [x, 0.6, z], 0.035, knob, Bone.Root);
  }

  // Neck: a long curve up and forward.
  chain(b, [[0, 0.36, 0.26], [0, 0.56, 0.38], [0, 0.76, 0.4]], [0.085, 0.07, 0.065], blue, Bone.Head);
  b.ellipsoid([0, 0.42, 0.36], [0.07, 0.1, 0.06], cream, Bone.Head);
  const head: V3 = [0, 0.84, 0.46];
  const headR: V3 = [0.1, 0.09, 0.12];
  b.ellipsoid(head, headR, blue, Bone.Head);
  b.eyes(head, headR, { spread: 0.6, lift: 0.2, size: 0.026, tall: 1.2 });
  b.cone([0, 0.92, 0.46], [0, 1.0, 0.42], 0.022, cream, Bone.Head);
  bothSides((s) => {
    b.limb([0.08 * s, 0.88, 0.42], [0.13 * s, 0.94, 0.4], 0.025, 0.02, blue, Bone.Head);
    b.ellipsoid([0.14 * s, 0.95, 0.4], [0.025, 0.025, 0.025], blue, Bone.Head);
  });
  sway(rig, Bone.Head, [0, 0.36, 0.24], 0.1, 0.7, [0.2, 1, 0]);

  // Four flippers, paddling.
  const flippers: [Bone, number, number, number][] = [
    [Bone.LegFrontLeft, 1, 0.14, 0], [Bone.LegFrontRight, -1, 0.14, Math.PI],
    [Bone.LegBackLeft, 1, -0.26, Math.PI], [Bone.LegBackRight, -1, -0.26, 0],
  ];
  for (const [bone, s, z, phase] of flippers) {
    b.ellipsoid([0.3 * s, 0.18, z], [0.14, 0.03, 0.08], blue, bone, [0, -0.4 * s, -0.2 * s]);
    swing(rig, bone, [0.22 * s, 0.2, z], phase, 0.4, [0, 1, 0]);
  }
  rig.walkBob = 0;
  rig.breath = 0.012;
  rig.strideRate = 1;
};

export const WISHIWASHI: CreatureModel = (b, rig) => {
  const blue = hex(0x4c8fd6);
  const pale = hex(0xcfe6f8);
  b.ellipsoid([0, 0.3, 0], [0.18, 0.22, 0.3], blue, Bone.Root);
  b.ellipsoid([0, 0.22, 0.06], [0.14, 0.13, 0.22], pale, Bone.Root);
  // Enormous, anxious eyes.
  b.eyes([0, 0.34, 0.1], [0.18, 0.2, 0.24], { spread: 0.7, lift: 0.1, size: 0.07, tall: 1.2, whites: true });
  bothSides((s) => spot(b, [0.1 * s, 0.24, 0.26], 0.03, hex(0x9fd2f2), Bone.Head));
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.shape([[0, 0], [0.12, 0.04], [0.1, -0.08]], 0.02, { at: [0.16 * s, 0.26, 0.02], rotation: [0, s > 0 ? 0 : Math.PI, 0] }, blue, bone);
    flap(rig, bone, [0.16 * s, 0.26, 0.02], 0.4, 6, [0, 1, 0]);
  });
  tailFin(b, rig, [0, 0.3, -0.3], 0.2, blue, 5);
  rig.walkBob = 0;
};

export const MAGIKARP: CreatureModel = (b, rig) => {
  const orange = hex(0xef6a3a);
  const cream = hex(0xf6e7c8);
  const yellow = hex(0xf6d86a);

  b.ellipsoid([0, 0.34, 0], [0.12, 0.28, 0.38], orange, Bone.Root);
  b.ellipsoid([0, 0.22, 0.06], [0.1, 0.14, 0.28], cream, Bone.Root);
  // Scales: overlapping discs along the flanks.
  bothSides((s) => {
    for (const [y, z] of [[0.4, 0.1], [0.4, -0.06], [0.3, 0.02], [0.3, -0.14], [0.42, -0.2]] as const) {
      b.ellipsoid([0.1 * s, y, z], [0.02, 0.07, 0.07], hex(0xd9502a), Bone.Root);
    }
  });
  // Big lips, gaping.
  b.ellipsoid([0, 0.34, 0.37], [0.07, 0.06, 0.04], hex(0xf2d2b0), Bone.Head);
  b.eyes([0, 0.4, 0.22], [0.12, 0.16, 0.18], { spread: 0.9, lift: 0.1, size: 0.05, tall: 1.0, whites: true });
  // Whiskers and a crown fin.
  bothSides((s) => chain(b, [[0.05 * s, 0.36, 0.36], [0.14 * s, 0.3, 0.38], [0.2 * s, 0.2, 0.34]], [0.012, 0.01, 0.008], yellow, Bone.Head));
  b.shape([[0, 0], [0.2, 0.06], [0.12, 0.1], [0.16, 0.18], [0.04, 0.14], [0, 0.22], [-0.06, 0.1]], 0.02,
    { at: [0, 0.56, 0.02], rotation: [0, -Math.PI / 2, 0] }, yellow, Bone.Root);
  sway(rig, Bone.Head, [0, 0.34, 0.2], 0.08, 4, [0, 1, 0]);
  tailFin(b, rig, [0, 0.34, -0.38], 0.26, yellow, 4.4);
  rig.walkBob = 0;
};

export const FINNEON: CreatureModel = (b, rig) => {
  const navy = hex(0x2c3f6e);
  const pale = hex(0x9fd0ee);
  const pink = hex(0xf07ab0);

  b.ellipsoid([0, 0.3, 0], [0.12, 0.13, 0.28], navy, Bone.Root);
  b.ellipsoid([0, 0.25, 0.02], [0.1, 0.08, 0.24], pale, Bone.Root);
  b.eyes([0, 0.33, 0.14], [0.12, 0.12, 0.16], { spread: 0.8, lift: 0.1, size: 0.035, tall: 1.2, whites: true });
  // Butterfly fins: its whole silhouette.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    b.shape([[0, 0], [0.24, 0.14], [0.3, 0.02], [0.2, -0.1]], 0.015, { at: [0.08 * s, 0.34, -0.02], rotation: [0.3, s > 0 ? 0 : Math.PI, 0] }, pink, bone);
    spot(b, [0.22 * s, 0.38, -0.02], 0.03, navy, bone);
    flap(rig, bone, [0.08 * s, 0.34, 0], 0.35, 4, [0, 0, s]);
  });
  b.shape([[0, 0], [0.24, 0.2], [0.16, 0], [0.24, -0.2]], 0.015, { at: [0, 0.3, -0.26], rotation: [0, Math.PI / 2, 0] }, pink, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.3, -0.22], 0.35, 3.4);
  rig.walkBob = 0;
};

export const LUVDISC: CreatureModel = (b, rig) => {
  const pink = hex(0xf28fb2);
  const light = hex(0xfbd2e0);
  // A heart, swimming.
  const heart: (readonly [number, number])[] = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    heart.push([16 * Math.pow(Math.sin(t), 3) * 0.02, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.02]);
  }
  // The heart is the body, seen side-on as it swims; its face is on the
  // flanks. (Eyes placed on a smaller inner body end up inside the heart's
  // thickness, and Luvdisc has no face at all.)
  const depth = 0.12;
  b.shape(heart, depth, { at: [0, 0.38, 0.02], rotation: [0, Math.PI / 2, 0] }, pink, Bone.Root);
  bothSides((s) => {
    const x = (depth / 2 + 0.004) * s;
    b.ellipsoid([x, 0.36, 0.1], [0.012, 0.09, 0.1], light, Bone.Root);
    b.ellipsoid([x * 1.08, 0.42, 0.14], [0.012, 0.034, 0.03], hex(0x1c1a22), Bone.Head);
    b.ellipsoid([x * 1.2, 0.435, 0.15], [0.008, 0.012, 0.011], hex(0xffffff), Bone.Head);
  });
  b.ellipsoid([0, 0.32, 0.27], [0.035, 0.03, 0.025], hex(0xe0567a), Bone.Head);
  tailFin(b, rig, [0, 0.36, -0.24], 0.14, pink, 3);
  rig.walkBob = 0;
};

export const WINGULL: CreatureModel = (b, rig) => {
  const white = hex(0xf6f6f2);
  const blue = hex(0x4d80b8);
  const yellow = hex(0xf2c643);

  b.ellipsoid([0, 0.36, 0], [0.1, 0.1, 0.22], white, Bone.Root);
  const head: V3 = [0, 0.42, 0.18];
  const headR: V3 = [0.08, 0.07, 0.08];
  b.ellipsoid(head, headR, white, Bone.Head);
  b.eyes(head, headR, { spread: 0.7, lift: 0.3, size: 0.018, tall: 0.6, slant: 0.2 });
  // The long yellow beak.
  b.cone([0, 0.4, 0.24], [0, 0.38, 0.44], 0.035, yellow, Bone.Head, { flatten: 0.6 });
  sway(rig, Bone.Head, [0, 0.38, 0.14], 0.12, 1.4, [0, 1, 0]);

  // Long, narrow wings, blue-edged: a glider.
  bothSides((s) => {
    const bone = s > 0 ? Bone.WingLeft : Bone.WingRight;
    const root: V3 = [0.06 * s, 0.4, 0.02];
    b.shape([[0, 0.04], [0.5, 0.02], [0.56, -0.04], [0.5, -0.06], [0, -0.08]], 0.015,
      { at: root, rotation: [Math.PI / 2, 0, s > 0 ? 0.12 : Math.PI - 0.12] }, white, bone);
    b.shape([[0.3, 0.02], [0.56, 0.0], [0.56, -0.04], [0.5, -0.06], [0.3, -0.07]], 0.02,
      { at: root, rotation: [Math.PI / 2, 0, s > 0 ? 0.12 : Math.PI - 0.12] }, blue, bone);
    flap(rig, bone, root, 0.4, 3.2, [0, 0, s]);
  });
  b.shape([[0, 0], [0.08, -0.12], [0, -0.1], [-0.08, -0.12]], 0.015, { at: [0, 0.36, -0.2], rotation: [-1.2, 0, 0] }, white, Bone.Tail);
  sway(rig, Bone.Tail, [0, 0.36, -0.18], 0.15, 2, [1, 0, 0]);
  rig.flies = true;
  rig.hoverBob = 0.05;
};
