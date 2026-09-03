# SlicerGotthard

Ron Kikinis's line of work on what 3D Slicer's data model should be. Separate from
`pieper/SlicerLive` on purpose: a proposal, in code, that can be taken apart.

It builds on other people's ingenuity, credited below and at the point of use. The **route** is
mine.

## The name

The Gotthard is the only place you cross the Alps on a **single** pass — every other route makes you
climb two or more. That is the strategic prize, and it was worthless until someone got past the
**Schöllenen**, where the Reuss cuts a gorge with no bank to walk along. A bridge hung off the rock
face in the 1220s opened it, and only then did the route, and Uri, become worth anything.

The architecture is the Schöllenen. Narrow, unavoidable, and the whole value of the pass is behind
it.

## Not a demo

Foundational work, in this order:

1. **the architecture** — where we are
2. the UI and appearance
3. the modules

Improvements are welcome and something better will be taken. What this is not is a slide deck.

## Principles

`../docs/architecture-principles.md` — eleven of them, each naming the shipped example or the
documented failure it came from, each with its cost stated rather than discounted.
`../docs/data-model-design-2026-09-03.md` is the working-out, with the dead ends left in.

Two rules govern the code itself:

- **As simple as possible, as complex as needed.** Unused generality is its own kind of wrong. Four
  axis kinds because four domains need exactly four; one unit table because two tables can disagree.
- **Refuse to guess.** Every failure this layer prevents looks like success — a microscopy volume
  flipped as though it were anatomical, a nanometre read as a millimetre, a velocity converted as a
  length. So the tests mostly assert that something throws.

## `model/`

| | |
|---|---|
| `frame.ts` | A coordinate frame that says what its axes **are**: kind, unit, and the convention the spatial axes follow. RAS becomes one declared value instead of an invisible default, and nanometres and parsecs are as expressible as millimetres. |

```
deno test -A --no-check model/frame.test.ts
deno doc --lint model/frame.ts          # documentation is part of the code, per Slicer's convention
deno doc --html --name SlicerGotthard model/*.ts
```

## What this replaces, and why it is not a style preference

3D Slicer stores every length in millimetres. That is not written in the data — it is a convention
in the reader, documented in a comment (`vtkSlicerUnitsLogic.cxx`: *"in Slicer, 'length' quantity
values are always expressed in millimeters"*) and in a user-guide paragraph explaining that RAS was
adopted because several GE researchers were early contributors. The consequences are still being
paid: every reader and writer flips two axis signs, and the units system can only reformat, so a
microscopist working in nanometres can display ±10 µm.

Both decisions were locally reasonable when they were made, and neither was revisited. That is the
failure mode this repository exists to avoid, while the window is still open.

## Acknowledgements

**Acknowledgement is what separates leveraging from stealing.** So almost nothing here is invented,
and where a problem has already been solved well this copies the solution and says so — in the
source, at the line that copies it, not only in this section. That also makes the borrowing
*checkable*: a reader can go and see whether NRRD really says what is claimed of it.

**Steve Pieper** — [SlicerLive](https://github.com/pieper/SlicerLive) and
[live](https://github.com/pieper/live). The WebGPU imaging application this work is in dialogue
with, and the reason a browser can render clinical volumes at all. His **ReMINDer** is also, so far
as I know, the first *shipped* instance of a scene being a **query** rather than a construction: an
index plus a URL selection — `loadIndex(...)` and a case id — with no scene file anywhere.

**Michael Halle** — [duckn](https://github.com/mhalle/duckn) (Zarr-based imaging with real nested
semantics), [zmanifest](https://github.com/mhalle/zmanifest) and
[zarr-zmp](https://github.com/mhalle/zarr-zmp) / [zarr-zmp-ts](https://github.com/mhalle/zarr-zmp-ts)
(content-addressed manifests, queryable), [exfield](https://github.com/mhalle/exfield) (finite
element scaffolds you *evaluate*, with exact Bézier export and tessellation as a named lossy
fallback), and the **Open Anatomy Browser**, whose atlas is a flat set of addressable records with
membership as edges — the record model this one descends from. exfield's `declared_unit` and its
discretisation fingerprints are prior art for two of the principles here, and its stance that
"agreement with Zinc is not the same as correctness" is adopted outright.

**3D Slicer**, and twenty-five years of it. The specific debts: `vtkSegmentation`'s
source-and-derived representation model with automatic invalidation, which is the right answer,
generalized here; `vtkMRMLSequenceNode`, which makes 4D a container over any node type rather than
an imaging special case; and the **coordinate-system documentation**, whose candour about *why* RAS
was adopted — "several GE researchers were early contributors" — is what made the argument in
`frame.ts` possible to write at all. A project that documents its own accidents that plainly is a
project you can learn from.

**NRRD**, and Gordon Kindlmann's format specification. This is the debt that most needs naming:
`frame.ts` takes NRRD's `space` vocabulary — including `3D-right-handed` and `scanner-xyz`, the
values that make non-anatomical data expressible at all — and its per-axis `space units`, *directly*.
Not inspired by; copied. Slicer's own coordinate documentation cites this specification, and this
repository is largely an argument for not discarding it at import.

**FITS WCS**, for per-axis `CTYPE` and `CUNIT` — the astronomy community having solved axis
semantics decades before medical imaging noticed it needed to. **OME-NGFF**, for typed axes
(`name`, `type`, `unit`) on Zarr. **OpenCMISS-Zinc** and the **SPARC** scaffold ecosystem, whose
EX/EXF format is what exfield reads.

## Licence

To be decided before this goes anywhere. The intent is something permissive and compatible with
3D Slicer's own licence, so that anything worth taking can be taken.
