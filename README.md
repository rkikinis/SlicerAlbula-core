# SlicerGotthard

**A data model for imaging, where nothing is assumed.**

Every value that a reader would otherwise have to guess is written down instead: what an axis *is*,
what unit it is in, which convention its geometry follows, and **how that geometry came to be known**.
Every change is a new record rather than an overwrite, so history, provenance and editing are one
mechanism instead of three. A view is a *selection* over records, not a structure you build and have
to save.

Ron Kikinis's playground, and independent by design — it depends on no other codebase, and it is
meant to be taken apart. It builds on other people's ingenuity, credited below and at the point of
use. The **route** is mine.

It exists because medical imaging software is used from microscopy to astrophysics while its data
models were built for clinical scale, and because twenty-five years of building one class per data
kind has taught the field enough to generalize. 3D Slicer is the evidence base for that and the
subject of the comparison in `ARCHITECTURE.md` — it is not a dependency.

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

`docs/architecture-principles.md` — eleven of them, each naming the shipped example or the
documented failure it came from, each with its cost stated rather than discounted.
`docs/data-model-design-2026-09-03.md` is the working-out, with the dead ends left in.

Two rules govern the code itself:

- **As simple as possible, as complex as needed.** Unused generality is its own kind of wrong. Four
  axis kinds because four domains need exactly four; one unit table because two tables can disagree.
- **Refuse to guess.** Every failure this layer prevents looks like success — a microscopy volume
  flipped as though it were anatomical, a nanometre read as a millimetre, a velocity converted as a
  length. So the tests mostly assert that something throws.

## `model/`

| | |
|---|---|
| `frame.ts` | A coordinate frame that says what its axes **are** — kind, unit, the convention the spatial axes follow, and **where each axis's geometry came from** (`acquired` / `derived` / `asserted` / `assumed`). RAS becomes one declared value instead of an invisible default; nanometres and parsecs are as expressible as millimetres; and a spacing somebody fixed by hand is distinguishable from one the scanner stated. |
| `records.ts` | The record model: **dataset**, **group**, **derivation**, **note**. Ids are content hashes or random, never sequential. Validators refuse what would otherwise pass silently — a self-derivation, a frame whose axis count disagrees with the data's shape, a dangling reference, a free-text note filed under a countable category. |
| `RECORDS.md` | The reasoning behind `records.ts` — plain-language explanation first, then the granularity argument. |

```
deno test -A --no-check model/         # 30 tests
deno doc --lint mod.ts                # documentation lives in the code and is gated
deno doc --html --name SlicerGotthard mod.ts
```

`mod.ts` is the entry point.

## A worked example of "nothing is assumed"

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

[`License.txt`](License.txt) — the **3D Slicer Contribution and Software License Agreement**,
Version 1.0 (December 20, 2005). A BSD-style licence with extensions covering contributions.

It is 3D Slicer's own licence, **verbatim**. Copied byte-for-byte from 3D Slicer's own `License.txt` rather
than retyped, and verified identical:

```
03fc5cd907e5c2004ce199d66318d32a08fa2de2b5b28bee184edda6307d0b86  License.txt
```

**Do not edit this file, reword it, or substitute another licence.** That text took a year to
negotiate. Using it unchanged is deliberate, and it is not a decision to be revisited casually or
by someone who was not there.

(Slicer also ships `COPYRIGHT.txt`, which carries the same agreement behind a stale header and a
corrupted apostrophe. `License.txt` is the clean copy and the one to track.)
