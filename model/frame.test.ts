// What a frame has to get right is not arithmetic, it is refusing to guess. So most of these tests
// assert that something throws or returns null, because the failures this module exists to prevent
// all look like success: a microscopy volume silently flipped as though it were LPS, a nanometre
// spacing quietly treated as millimetres, a velocity axis converted as a length.
//
//   deno test -A --no-check model/frame.test.ts
import { assertAlmostEquals, assertEquals, assertThrows } from "jsr:@std/assert";
import { type Frame, dimensionOf, flipsToRAS, normalizingScale, ras, rightHanded, scaleToBase, spatialAxes } from "./frame.ts";

/** 0.5 mm isotropic clinical CT, 512 x 512 x 400 — the case everything already handles. */
const CT = ras([0.5, 0, 0, -128, 0, 0.5, 0, -128, 0, 0, 0.5, -100, 0, 0, 0, 1]);

/** 4 nm isotropic electron microscopy, 2048 x 2048 x 512. No anatomical orientation exists. */
const EM = rightHanded([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1], "nm");

/** An HI data cube: two angular sky axes and a velocity axis. Not expressible in NIfTI at all. */
const CUBE: Frame = {
  space: "sky-equatorial",
  axes: [
    { name: "RA", kind: "space", unit: "deg" },
    { name: "Dec", kind: "space", unit: "deg" },
    { name: "velocity", kind: "spectral", unit: "km/s" },
  ],
  toWorld: [-0.0025, 0, 0, 187.7, 0, 0.0025, 0, 12.4, 0, 0, 10, -500, 0, 0, 0, 1],
};

Deno.test("units: scale to the SI base of the unit's own dimension", () => {
  assertEquals(scaleToBase("space", "mm"), 1e-3);
  assertEquals(scaleToBase("space", "nm"), 1e-9);
  assertEquals(scaleToBase("time", "ms"), 1e-3);
  assertEquals(scaleToBase("spectral", "MHz"), 1e6);
  assertEquals(scaleToBase("spectral", "km/s"), 1e3);
  assertAlmostEquals(scaleToBase("space", "pc"), 3.0857e16, 1e13);
});

// The whole point. A unit that is not in the table is not assumed to be millimetres.
Deno.test("units: an unknown unit throws rather than defaulting", () => {
  assertThrows(() => scaleToBase("space", "furlong"), Error, "unknown unit");
  assertThrows(() => scaleToBase("space", ""), Error, "unknown unit");
});

// Arithmetically "mm" converts fine on a time axis. Semantically it is a bug, and a frame that
// converts it has lost the ability to tell anyone.
Deno.test("units: a unit of the wrong dimension throws", () => {
  assertThrows(() => scaleToBase("time", "mm"), Error, "length unit, which a time axis cannot use");
  assertThrows(() => scaleToBase("space", "Hz"), Error, "frequency unit");
});

// A wavelength axis in metres is legal; the same metre on a time axis is not. One table, two answers.
Deno.test("units: spectral axes accept frequency, wavelength and velocity", () => {
  assertEquals(scaleToBase("spectral", "GHz"), 1e9);
  assertEquals(scaleToBase("spectral", "m"), 1);
  assertEquals(dimensionOf("m"), "length");
  assertEquals(dimensionOf("km/s"), "velocity");
});

Deno.test("units: a channel axis has no unit, and claiming one throws", () => {
  assertEquals(scaleToBase("channel", ""), 1);
  assertThrows(() => scaleToBase("channel", "mm"), Error, "cannot have a unit");
});

// This is the bug the module exists to prevent. Slicer assumes files are LPS unless they say RAS, so
// a frame that is neither must not be given a flip -- it must be refused one.
Deno.test("orientation: only anatomical frames have a RAS interpretation", () => {
  assertEquals(flipsToRAS(CT), [1, 1, 1]);
  assertEquals(flipsToRAS({ ...CT, space: "left-posterior-superior" }), [-1, -1, 1]);
  assertEquals(flipsToRAS(EM), null);
  assertEquals(flipsToRAS(CUBE), null);
});

Deno.test("axes: spatial axes are found by kind, not by position", () => {
  assertEquals(spatialAxes(CT).length, 3);
  assertEquals(spatialAxes(CUBE).map((a) => a.name), ["RA", "Dec"]);
  assertEquals(spatialAxes(CUBE).length, 2); // the third axis is spectral, not a third spatial axis
});

// Two datasets nine orders of magnitude apart both normalize to O(1), which is what makes them
// renderable in f32 in the same scene. Storing either in millimetres would put one at 8e-6 and the
// other at 2.6e2 -- both representable, neither safe to add to the other.
Deno.test("rendering: extents nine orders of magnitude apart both normalize to O(1)", () => {
  const ctScale = normalizingScale(CT, [512, 512, 400]);
  const emScale = normalizingScale(EM, [2048, 2048, 512]);

  const ctExtent = 512 * 0.5e-3;      // 0.256 m
  const emExtent = 2048 * 4e-9;       // 8.192e-6 m
  assertAlmostEquals(1 / ctScale, ctExtent, 1e-12);
  assertAlmostEquals(1 / emScale, emExtent, 1e-15);

  // Normalized, both are unit-sized: the ratio the f32 mantissa has to carry is the same.
  assertAlmostEquals(ctExtent * ctScale, 1, 1e-12);
  assertAlmostEquals(emExtent * emScale, 1, 1e-12);
});

// A frame with no spatial axes must not divide by zero.
Deno.test("rendering: a frame with no spatial axis normalizes to 1", () => {
  const timeOnly: Frame = {
    space: "3D-right-handed",
    axes: [{ name: "t", kind: "time", unit: "s" }],
    toWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
  assertEquals(normalizingScale(timeOnly, [100]), 1);
});

// What Slicer stores today is exactly ras(...) -- naming it is the whole change. This test records
// that the default is millimetres so that a future edit to the default is a visible test failure
// rather than a silent reinterpretation of every existing dataset.
Deno.test("interop: ras() is the frame Slicer assumes, and its unit is declared", () => {
  assertEquals(CT.space, "right-anterior-superior");
  assertEquals(CT.axes.map((a) => a.unit), ["mm", "mm", "mm"]);
  assertEquals(ras([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "um").axes[0].unit, "um");
});
