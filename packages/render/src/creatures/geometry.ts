/**
 * Creature geometry builder.
 *
 * Models are assembled from a handful of smooth primitives — ellipsoids,
 * tapered limbs, cones and extruded silhouettes — merged into one mesh with a
 * colour and a bone id per vertex. Merging is what makes a creature a single
 * draw; the bone id is what lets the vertex shader animate its parts.
 *
 * Model space: +Y up, +Z forward, feet on y = 0, and the creature roughly one
 * unit in its largest dimension. The renderer scales each instance to the
 * species' real height, so one Bewear mesh serves a cub-sized alpha and a
 * towering one alike.
 */
import { BufferGeometry, BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { Bone, type V3 } from './rig.ts';

export type Detail = 'high' | 'low';
export type RGB = readonly [number, number, number];

/**
 * An sRGB hex colour, converted to linear. Palettes are authored by eye as
 * ordinary hex values; vertex colours are linear in the lighting maths, and
 * skipping this conversion washes every creature out toward pastel.
 */
export function hex(value: number): RGB {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [channel((value >> 16) & 255), channel((value >> 8) & 255), channel(value & 255)];
}

/** Mix two linear colours. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ------------------------------------------------------------- vector maths

type M3 = [number, number, number, number, number, number, number, number, number];

function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function length(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: V3): V3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Rotation matrix from Euler angles, applied X then Y then Z. */
function eulerMatrix(r: V3): M3 {
  const [cx, sx] = [Math.cos(r[0]), Math.sin(r[0])];
  const [cy, sy] = [Math.cos(r[1]), Math.sin(r[1])];
  const [cz, sz] = [Math.cos(r[2]), Math.sin(r[2])];
  // R = Rz * Ry * Rx, row-major.
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function apply(m: M3, v: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Rotate `v` about unit axis `k` by `angle` (Rodrigues). */
export function rotateAbout(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + kv[0] * s + k[0] * d * (1 - c),
    v[1] * c + kv[1] * s + k[1] * d * (1 - c),
    v[2] * c + kv[2] * s + k[2] * d * (1 - c),
  ];
}

// ------------------------------------------------------------------ builder

export interface LimbOptions {
  /** Scale across the limb's depth axis — 0.3 makes a flat ear or fin. */
  readonly flatten?: number;
  /** Roll about the limb's own axis, radians; turns which way it is flat. */
  readonly roll?: number;
  /** Override the radial segment count. */
  readonly sides?: number;
}

export interface Placement {
  readonly at: V3;
  /** Euler rotation, radians. */
  readonly rotation?: V3;
  readonly scale?: number;
}

export class ModelBuilder {
  readonly detail: Detail;
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly bones: number[] = [];
  private readonly indices: number[] = [];
  private minY = Infinity;
  private maxY = -Infinity;

  constructor(detail: Detail) {
    this.detail = detail;
  }

  /**
   * Radial segments for a part of a given size.
   *
   * Segment count follows the part's size, not a constant: a body needs its
   * curvature and an eye's catch-light does not. A flat 18 segments on every
   * part put creatures at 5–11k triangles each, most of them in eyes, claws and
   * cheeks too small to show a facet — and the outline pass draws every one
   * of them again. The low LOD is for creatures more than ~45m away.
   */
  private segmentsFor(radius: number): number {
    // Toon shading quantises the normal into bands, and a band boundary
    // follows triangle edges exactly — so large parts need more curvature
    // than smooth shading would, or every body shows its facets.
    if (this.detail === 'high') return Math.max(6, Math.min(20, Math.round(radius * 80)));
    return Math.max(4, Math.min(9, Math.round(radius * 28)));
  }

  private ringsFor(radius: number): number {
    return Math.max(this.detail === 'high' ? 4 : 3, Math.round(this.segmentsFor(radius) * 0.66));
  }

  private vertex(p: V3, n: V3, c: RGB, bone: Bone): number {
    const index = this.positions.length / 3;
    this.positions.push(p[0], p[1], p[2]);
    const nn = normalize(n);
    this.normals.push(nn[0], nn[1], nn[2]);
    this.colors.push(c[0], c[1], c[2]);
    this.bones.push(bone);
    if (p[1] < this.minY) this.minY = p[1];
    if (p[1] > this.maxY) this.maxY = p[1];
    return index;
  }

  /**
   * Triangulate a (rows+1) x (cols+1) vertex grid, counter-clockwise when seen
   * from outside. For both parametrisations used here — rings running down an
   * ellipsoid, and profile rings running along a limb, with the column index
   * winding around the axis — `a, a+1, b` faces outward. (The other winding
   * renders the inside of every part, which is invisible until an outline
   * hull, drawn on back faces, covers the whole creature in black.)
   */
  private grid(start: number, rows: number, cols: number): void {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = start + i * (cols + 1) + j;
        const b = a + cols + 1;
        this.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }

  /** A smooth ellipsoid. The workhorse: bodies, heads, cheeks, eyes. */
  ellipsoid(center: V3, radii: V3, color: RGB, bone: Bone, rotation: V3 = [0, 0, 0]): this {
    const m = eulerMatrix(rotation);
    const largest = Math.max(radii[0], radii[1], radii[2]);
    const seg = this.segmentsFor(largest);
    const rings = this.ringsFor(largest);
    const start = this.positions.length / 3;
    for (let i = 0; i <= rings; i++) {
      const theta = (Math.PI * i) / rings;
      for (let j = 0; j <= seg; j++) {
        const phi = (2 * Math.PI * j) / seg;
        const unit: V3 = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
        const local: V3 = [unit[0] * radii[0], unit[1] * radii[1], unit[2] * radii[2]];
        // The normal of a scaled sphere is the unit normal divided by the scale.
        const normal: V3 = [unit[0] / radii[0], unit[1] / radii[1], unit[2] / radii[2]];
        this.vertex(add(center, apply(m, local)), apply(m, normal), color, bone);
      }
    }
    this.grid(start, rings, seg);
    return this;
  }

  /**
   * A tapered, capped limb from `a` to `b`. Legs, arms, necks, tails, horns.
   * With `rb` near zero it is a smooth cone — ears, claws, beaks.
   */
  limb(a: V3, b: V3, ra: number, rb: number, color: RGB, bone: Bone, opts: LimbOptions = {}): this {
    const axisVec = sub(b, a);
    const len = length(axisVec);
    if (len < 1e-6) return this.ellipsoid(a, [ra, ra, ra], color, bone);
    const w = normalize(axisVec);
    const ref: V3 = Math.abs(w[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    let u = normalize(cross(ref, w));
    let v = cross(w, u);
    if (opts.roll) {
      u = rotateAbout(u, w, opts.roll);
      v = rotateAbout(v, w, opts.roll);
    }
    const flatten = opts.flatten ?? 1;
    const sides = opts.sides ?? this.segmentsFor(Math.max(ra, rb) * 1.3);
    const capRings = this.detail === 'high' ? (Math.max(ra, rb) > 0.05 ? 4 : 2) : 1;

    // Profile: (axial position, radius, axial normal component, radial normal).
    const profile: [number, number, number, number][] = [];
    for (let k = 0; k <= capRings; k++) {
      const alpha = -Math.PI / 2 + (Math.PI / 2) * (k / capRings);
      profile.push([ra * Math.sin(alpha), ra * Math.cos(alpha), Math.sin(alpha), Math.cos(alpha)]);
    }
    for (let k = 0; k <= capRings; k++) {
      const alpha = (Math.PI / 2) * (k / capRings);
      profile.push([len + rb * Math.sin(alpha), rb * Math.cos(alpha), Math.sin(alpha), Math.cos(alpha)]);
    }

    const start = this.positions.length / 3;
    for (const [y, r, ny, nr] of profile) {
      for (let j = 0; j <= sides; j++) {
        const phi = (2 * Math.PI * j) / sides;
        const cu = Math.cos(phi);
        const cv = Math.sin(phi);
        const radial = add(scale(u, cu * r), scale(v, cv * r * flatten));
        const p = add(add(a, scale(w, y)), radial);
        // Flattening squashes positions along v, so it stretches normals along v.
        const nRadial = add(scale(u, cu * nr), scale(v, (cv * nr) / Math.max(flatten, 1e-3)));
        const n = add(nRadial, scale(w, ny));
        this.vertex(p, n, color, bone);
      }
    }
    this.grid(start, profile.length - 1, sides);
    return this;
  }

  /** A cone: a limb whose far end tapers to a point. */
  cone(base: V3, tip: V3, radius: number, color: RGB, bone: Bone, opts: LimbOptions = {}): this {
    return this.limb(base, tip, radius, radius * 0.06, color, bone, opts);
  }

  /**
   * An extruded flat silhouette — bolt tails, fins, leaves, wing membranes.
   * `points` are 2D in the shape's own plane; it is extruded `depth` along
   * its local Z, then rotated and placed.
   */
  shape(points: readonly (readonly [number, number])[], depth: number, place: Placement, color: RGB, bone: Bone): this {
    let contour = points.map(([x, y]) => new Vector2(x, y));
    if (ShapeUtils.isClockWise(contour)) contour = contour.reverse();
    const triangles = ShapeUtils.triangulateShape(contour, []);
    const m = eulerMatrix(place.rotation ?? [0, 0, 0]);
    const s = place.scale ?? 1;
    const half = depth / 2;
    const toWorld = (x: number, y: number, z: number): V3 => add(place.at, apply(m, [x * s, y * s, z * s]));

    // Front and back faces.
    for (const side of [1, -1] as const) {
      const start = this.positions.length / 3;
      const normal = apply(m, [0, 0, side]);
      for (const p of contour) this.vertex(toWorld(p.x, p.y, half * side), normal, color, bone);
      for (const [a, b, c] of triangles) {
        if (side === 1) this.indices.push(start + a, start + b, start + c);
        else this.indices.push(start + a, start + c, start + b);
      }
    }

    // Side walls, one quad per edge, with the edge's outward normal.
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i];
      const q = contour[(i + 1) % contour.length];
      // Counter-clockwise contour: outward is the edge direction rotated -90°.
      const outward = apply(m, normalize([q.y - p.y, -(q.x - p.x), 0]));
      const start = this.positions.length / 3;
      this.vertex(toWorld(p.x, p.y, half), outward, color, bone);
      this.vertex(toWorld(q.x, q.y, half), outward, color, bone);
      this.vertex(toWorld(p.x, p.y, -half), outward, color, bone);
      this.vertex(toWorld(q.x, q.y, -half), outward, color, bone);
      this.indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
    return this;
  }

  /**
   * A pair of eyes on the surface of a head.
   *
   * Eyes are what make a shape read as a character, so they get more care
   * than anything else: a dark iris set slightly into the head, and a bright
   * catch-light up and toward the centre line, which is what gives the
   * "looking at you" read even on a tiny, distant creature.
   */
  eyes(head: V3, headRadii: V3, opts: {
    /** Angle each eye sits off the centre line, radians. */
    spread: number;
    /** Angle above the head's equator, radians. */
    lift: number;
    size: number;
    iris?: RGB;
    /** Tall ovals (1.3+) for cute, round (1) for neutral, narrow (<0.8) for fierce. */
    tall?: number;
    /** Slant in radians — positive angles the eyes down toward the nose (angry). */
    slant?: number;
    whites?: boolean;
  }): this {
    const iris = opts.iris ?? hex(0x1c1a22);
    const tall = opts.tall ?? 1.25;
    for (const s of [1, -1] as const) {
      const yaw = opts.spread * s;
      const dir: V3 = [
        Math.sin(yaw) * Math.cos(opts.lift),
        Math.sin(opts.lift),
        Math.cos(yaw) * Math.cos(opts.lift),
      ];
      const surface: V3 = add(head, [dir[0] * headRadii[0], dir[1] * headRadii[1], dir[2] * headRadii[2]]);
      const rot: V3 = [-opts.lift, yaw, (opts.slant ?? 0) * s];
      if (opts.whites) {
        this.ellipsoid(add(surface, scale(dir, -opts.size * 0.2)), [opts.size * 1.2, opts.size * tall * 1.15, opts.size * 0.45], hex(0xf4f4f0), Bone.Head, rot);
      }
      this.ellipsoid(add(surface, scale(dir, -opts.size * 0.15)), [opts.size, opts.size * tall, opts.size * 0.5], iris, Bone.Head, rot);
      // Catch-light: up, and toward the centre line.
      const glint = add(surface, add(scale(dir, opts.size * 0.3), [-s * opts.size * 0.3, opts.size * tall * 0.45, 0]));
      this.ellipsoid(glint, [opts.size * 0.34, opts.size * 0.34, opts.size * 0.2], hex(0xffffff), Bone.Head, rot);
    }
    return this;
  }

  /** Lowest point of the model — used to sit it on the ground exactly. */
  get bottom(): number {
    return this.minY;
  }

  get top(): number {
    return this.maxY;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('aBone', new BufferAttribute(new Float32Array(this.bones), 1));
    const vertexCount = this.positions.length / 3;
    geometry.setIndex(new BufferAttribute(
      vertexCount > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
      1,
    ));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

/** Call `fn` once for each side: +1 is the creature's left (+X). */
export function bothSides(fn: (side: 1 | -1) => void): void {
  fn(1);
  fn(-1);
}

export { add, sub, scale, normalize, cross };
