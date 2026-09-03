# SlicerGotthard

Ron Kikinis's line of work on what 3D Slicer's data model should be. Separate from
`pieper/SlicerLive` on purpose: a proposal, in code, that can be taken apart.

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
