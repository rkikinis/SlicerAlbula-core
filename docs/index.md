# SlicerGotthard documentation

Following 3D Slicer's convention: **the documentation lives in the code**, in human-readable form,
and the published site is extracted from it. Slicer does this with Sphinx `autodoc` — its
`Docs/developer_guide/mrml.md` is one line of prose and an `automodule` directive, and everything a
reader sees comes from the docstrings. Nothing is written twice, so nothing can drift.

The analogue here is `deno doc`, which reads the same JSDoc comments the editor shows on hover.

```
deno task doc        build the API site into docs/api/ (generated; not committed)
deno task doc:lint   fail if anything exported is undocumented
deno task test       42 tests over model/
deno task check      type-check
```

`doc:lint` is the part that matters. It is the enforcement Sphinx's `:undoc-members:` only makes
embarrassing: an exported symbol without a doc comment is an error, so the documentation cannot fall
behind the code without the build saying so.

## What is documented where

| | |
|---|---|
| `mod.ts` | the entry point, and the shortest statement of what this is |
| `model/frame.ts` | what a set of numbers *means*: what each axis is, in what unit, under which convention, and how the geometry came to be known |
| `model/records.ts` | what exists and where it came from: datasets, groups, derivations, notes |
| `model/session.ts` | the two operations over a store: deriving appends; removing is destructive and undoable until committed |

Longer-form prose that is about the design rather than about a symbol stays in markdown, because it
has no symbol to hang on:

| | |
|---|---|
| `ARCHITECTURE.md` | what is built, what is missing, and why the gaps are where they are |
| `model/RECORDS.md` | the record model in plain language, before the code |
| `docs/architecture-principles.md` | the principles the model is answerable to |
| `docs/data-model-design-2026-09-03.md` | the design session that produced the four record types |

## Why the comments read the way they do

They record the evidence, not just the interface. `model/frame.ts` says why NIfTI's three
orientation methods cannot be collapsed into one; `logic/segment-groups.ts` in the application says
which tissue distinctions its thresholds actually separate — bone yes, gas yes, organ versus muscle
no — and names the measurement that settled it.

A comment that says what the code does is redundant with the code. A comment that says what was
tried, measured, or ruled out is the only place that information exists.
