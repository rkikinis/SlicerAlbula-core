/**
 * A coordinate frame that says what its axes ARE.
 *
 * Today both 3D Slicer and SlicerLive assume the answer: axes are anatomical, the basis is RAS, and
 * lengths are millimetres. None of that is written down anywhere in the data — it is a convention
 * held in the reader, and the two places it is documented are a comment
 * (`vtkSlicerUnitsLogic.cxx`: "in Slicer, 'length' quantity values are always expressed in
 * millimeters") and a paragraph in the user guide explaining that RAS was adopted because several GE
 * researchers were early contributors. Every Slicer reader and writer has paid a sign flip ever
 * since, and a microscopist working in nanometres can display +/-10 um because the unit is a display
 * coefficient over stored millimetres.
 *
 * The fix is not a bigger unit system. It is to stop assuming: carry the affine, and carry a
 * declaration of what the axes mean. Then RAS is one value rather than an invisible default, and
 * nanometres and parsecs are as expressible as millimetres.
 *
 * Two formats already do this and are worth copying rather than improving on. NRRD names the frame
 * (`space: right-anterior-superior`, but also `3D-right-handed` and `scanner-xyz`) and gives axes
 * their own `space units`. FITS WCS gives every axis its own `CTYPE` and `CUNIT`. Slicer's own
 * coordinate documentation cites the NRRD specification and then discards this at import.
 *
 * Deliberately absent, until a real case asks: unit algebra (one table is enough), non-linear
 * axes (FITS projections), per-axis direction strings (the frame name carries the convention, as in
 * NRRD, and the directions are already the columns of the affine).
 */

/**
 * What a single axis is. Four kinds, because the four domains on the table need exactly four:
 * clinical and microscopy need space and time, microscopy needs channel, radio astronomy needs a
 * spectral axis that is neither space nor time.
 *
 * The distinction is not cosmetic — it decides behaviour. You interpolate `space` and `spectral`,
 * you step through `time`, and you must never interpolate `channel`, whose values are labels.
 */
export type AxisKind = "space" | "time" | "spectral" | "channel";

/** One axis of a frame: what it is called, what kind it is, and the unit its samples are spaced in. */
export interface Axis {
  /** Axis name as the data calls it — `x`, `RA`, `velocity`, `channel`. Display only. */
  name: string;
  /** How samples along this axis behave — see {@linkcode AxisKind}. */
  kind: AxisKind;
  /**
   * Unit of this axis, as a UCUM-style code (`mm`, `nm`, `s`, `Hz`, `km/s`, `pc`). A `channel` axis
   * has no unit and must use `""`.
   */
  unit: string;
}

/**
 * A frame: the axes, plus the affine that maps sample indices to world coordinates.
 *
 * `space` names the convention the spatial axes follow, which the axes themselves cannot express:
 * three spatial axes in millimetres could be RAS or LPS, and the difference is a sign flip on two of
 * them. Values follow NRRD's vocabulary so a NRRD can round-trip without translation.
 */
export interface Frame {
  /** NRRD's `space` vocabulary, extended only where NRRD has nothing. */
  space:
    | "right-anterior-superior"
    | "left-posterior-superior"
    | "3D-right-handed"
    | "scanner-xyz"
    /** Sky coordinates: axes are RA/Dec and are angular, not linear. */
    | "sky-equatorial";
  /** In sample order, so `axes[i]` describes index `i` of the data. */
  axes: Axis[];
  /**
   * Row-major 4x4, sample index -> world, in each axis's own `unit`. Held as `number` (f64) because
   * the affine is where precision is lost irrecoverably: NIfTI-1 stores it as f32, which is why a
   * dataset with fine spacing and a large extent is inaccurate in the mapping and not merely in the
   * rendering.
   */
  toWorld: number[];
}

/**
 * Physical dimension of a unit. Separate from `AxisKind` because they are genuinely different
 * questions: a metre is a length whether it measures a distance or a wavelength, and an axis kind
 * says how to *treat* samples, not what they measure.
 */
export type Dimension = "length" | "time" | "frequency" | "velocity" | "angle";

/**
 * Every unit we accept, with its dimension and its scale to that dimension's SI base (metre, second,
 * hertz, radian).
 *
 * One table rather than a unit algebra: the set of units that actually occur is small, and a parser
 * would be a larger thing to get wrong. One table rather than two, so a unit's dimension and its
 * scale cannot disagree. Unknown units throw — a silently assumed unit is the failure this module
 * exists to prevent.
 */
const UNITS: Record<string, { dim: Dimension; scale: number }> = {
  km: { dim: "length", scale: 1e3 },
  m: { dim: "length", scale: 1 },
  cm: { dim: "length", scale: 1e-2 },
  mm: { dim: "length", scale: 1e-3 },
  um: { dim: "length", scale: 1e-6 },
  "\u00b5m": { dim: "length", scale: 1e-6 },
  nm: { dim: "length", scale: 1e-9 },
  pm: { dim: "length", scale: 1e-12 },
  // Astronomical lengths. IAU definitions; the parsec follows from the astronomical unit.
  au: { dim: "length", scale: 1.495978707e11 },
  ly: { dim: "length", scale: 9.4607304725808e15 },
  pc: { dim: "length", scale: 3.0856775814913673e16 },
  kpc: { dim: "length", scale: 3.0856775814913673e19 },
  Mpc: { dim: "length", scale: 3.0856775814913673e22 },

  s: { dim: "time", scale: 1 },
  ms: { dim: "time", scale: 1e-3 },
  us: { dim: "time", scale: 1e-6 },
  "\u00b5s": { dim: "time", scale: 1e-6 },
  ns: { dim: "time", scale: 1e-9 },
  min: { dim: "time", scale: 60 },
  h: { dim: "time", scale: 3600 },
  d: { dim: "time", scale: 86400 },

  Hz: { dim: "frequency", scale: 1 },
  kHz: { dim: "frequency", scale: 1e3 },
  MHz: { dim: "frequency", scale: 1e6 },
  GHz: { dim: "frequency", scale: 1e9 },

  // Radio spectral axes are given as a frequency, a wavelength, or a velocity (FITS `VELO-LSR`).
  "m/s": { dim: "velocity", scale: 1 },
  "km/s": { dim: "velocity", scale: 1e3 },

  rad: { dim: "angle", scale: 1 },
  deg: { dim: "angle", scale: Math.PI / 180 },
  arcmin: { dim: "angle", scale: Math.PI / 10800 },
  arcsec: { dim: "angle", scale: Math.PI / 648000 },
};

/**
 * Which dimensions each axis kind may be measured in.
 *
 * `space` admits angle because a sky frame's axes are angular. `spectral` admits length and
 * velocity because a radio axis is given as a frequency, a wavelength, or a velocity. `channel`
 * admits nothing: its values are labels.
 */
const ALLOWED: Record<AxisKind, readonly Dimension[]> = {
  space: ["length", "angle"],
  time: ["time"],
  spectral: ["frequency", "length", "velocity"],
  channel: [],
};

/**
 * Multiplier taking a value in `unit` to the SI base of that unit's dimension.
 *
 * @throws if the unit is unknown, or if its dimension is not one the axis kind admits —
 * `scaleToBase("spectral", "mm")` is legal (a wavelength axis) but `scaleToBase("time", "mm")` is a
 * bug worth stopping for rather than a conversion worth guessing at.
 */
export function scaleToBase(kind: AxisKind, unit: string): number {
  if (kind === "channel") {
    if (unit !== "") throw new Error(`a channel axis cannot have a unit (got "${unit}")`);
    return 1;
  }
  const u = UNITS[unit];
  if (u === undefined) throw new Error(`unknown unit "${unit}" \u2014 add it to UNITS if it is real`);
  if (!ALLOWED[kind].includes(u.dim)) {
    throw new Error(`"${unit}" is a ${u.dim} unit, which a ${kind} axis cannot use`);
  }
  return u.scale;
}

/** Dimension of a unit, for callers that need to know before converting. @throws on unknown units. */
export function dimensionOf(unit: string): Dimension {
  const u = UNITS[unit];
  if (u === undefined) throw new Error(`unknown unit "${unit}"`);
  return u.dim;
}

/** The three spatial axes of a frame, in order, or `[]` if it has none. */
export function spatialAxes(f: Frame): Axis[] {
  return f.axes.filter((a) => a.kind === "space");
}

/**
 * Sign flips taking this frame's spatial axes to right-anterior-superior, or `null` if the frame is
 * not anatomical and therefore has no RAS interpretation.
 *
 * LPS and RAS differ only in the sign of the first two axes, which is the whole of the conversion
 * Slicer performs on every read and write. Returning `null` rather than an identity is the point:
 * a `3D-right-handed` microscopy volume has no anatomical orientation, and treating it as LPS — as a
 * reader that assumes LPS unless told otherwise will — silently mis-orients it.
 */
export function flipsToRAS(f: Frame): [number, number, number] | null {
  switch (f.space) {
    case "right-anterior-superior": return [1, 1, 1];
    case "left-posterior-superior": return [-1, -1, 1];
    default: return null;
  }
}

/**
 * A single scale that maps this frame's world extent to roughly unit size, given its sample counts.
 *
 * The renderer works in f32, where what matters is the ratio of the scene extent to the smallest
 * feature rather than the absolute magnitude. Normalizing per scene is therefore both the physically
 * honest choice and the numerically better one — it is also what a depth buffer wants. Physical
 * values are reconstructed from `toWorld` and the axis units in f64, never read off the render frame.
 */
export function normalizingScale(f: Frame, dims: number[]): number {
  const sp = f.axes.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === "space");
  let maxExtent = 0;
  for (const { a, i } of sp) {
    const col = [f.toWorld[i], f.toWorld[4 + i], f.toWorld[8 + i]];
    const step = Math.hypot(col[0], col[1], col[2]) * scaleToBase("space", a.unit);
    maxExtent = Math.max(maxExtent, step * (dims[i] ?? 1));
  }
  return maxExtent > 0 ? 1 / maxExtent : 1;
}

/**
 * The frame Slicer and SlicerLive assume today, made explicit.
 *
 * Every existing caller of `ijkToRAS` is describing this frame; naming it is what turns an assumption
 * into a declaration. `spacing` is in `unit`.
 */
export function ras(toWorld: number[], unit = "mm"): Frame {
  return {
    space: "right-anterior-superior",
    axes: [
      { name: "x", kind: "space", unit },
      { name: "y", kind: "space", unit },
      { name: "z", kind: "space", unit },
    ],
    toWorld,
  };
}

/**
 * A frame with three spatial axes and no anatomical meaning — microCT, light and electron
 * microscopy, phantoms, anything where "anterior" is a category error.
 */
export function rightHanded(toWorld: number[], unit: string): Frame {
  return {
    space: "3D-right-handed",
    axes: [
      { name: "x", kind: "space", unit },
      { name: "y", kind: "space", unit },
      { name: "z", kind: "space", unit },
    ],
    toWorld,
  };
}
