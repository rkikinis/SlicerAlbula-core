# Where we are, how this improves on MRML, and what is missing

**2026-09-03.** `README.md` says what this is; `../docs/architecture-principles.md` states the eleven
principles and where each came from. This document is the status and the honest gap list.

## Where we are

Built: `model/frame.ts` — a coordinate frame that declares what its axes are. 10 tests, documentation
extracted from the source, licence in place.

Established, by reading rather than assuming: 3D Slicer's data model is **not** DICOM-centric; MRML
is; MRML is also the layer its own developers want rearchitected. And three independent designs —
Michael Halle's Open Anatomy atlas (2018), Steve Pieper's ReMINDer (2026), and this project's Zarr
working copies — converged on the same architecture without coordinating: leave the archive
untouched, derive a small regenerable index carrying the semantics the archive cannot express,
address payload by pointer, and make a view a **selection** rather than a construction.

Not built: records, query, payload resolution, semantics, provenance, editing. That is the work.

## What MRML actually is, stated fairly

MRML is a **scene of typed C++ node classes**. `vtkMRMLScalarVolumeNode` holds a volume;
`vtkMRMLStorageNode` subclasses move it to and from files; `vtkMRMLDisplayNode` subclasses say how it
looks; `vtkMRMLSubjectHierarchyNode` arranges it; an observer/event mechanism keeps a hundred modules
and every view in sync when any of it changes.

It is not sloppy. It is *accreted*: adding a data kind means writing classes, and twenty-five years of
different people writing classes for different needs produces divergence — not through carelessness,
but because **the extension mechanism is code, and code diverges.**

That is the one structural claim this project rests on:

> **MRML models data kinds as classes. SlicerGotthard models them as records with declared
> properties.** When the extension mechanism is data — a type value, a MIME type, an axis declaration
> — divergence becomes something you can *validate* rather than something you discover.

Everything below follows from that.

## The improvements, itemized

| | MRML | SlicerGotthard |
|---|---|---|
| **adding a data kind** | a node class + a storage node + a display node + scene registration + a hierarchy plugin | a `type` value and a payload MIME type |
| **a scene** | mutable in-memory node graph, serialized to MRB | a query over records; the query *is* the scene |
| **hierarchy** | one subject-hierarchy tree | edges, so many hierarchies coexist over one set of data |
| **file formats** | ~20 `vtkMRMLStorageNode` subclasses | a `mimeType` on a payload pointer |
| **coordinates** | RAS assumed, undeclared | declared: per-axis kind, unit, and the spatial convention |
| **units** | display-only — a `DisplayCoefficient` over stored millimetres | carried with the quantity, converted in f64 |
| **representations** | source-and-derived with invalidation — correct, but welded inside `vtkSegmentation` | one general mechanism for any record |
| **edits** | mutate nodes; undo is a separate stack | append; the history *is* the record set |
| **provenance** | none, beyond what a module writes for itself | the same mechanism as editing |
| **real-time (IGT)** | transform nodes mutated by a module | bindings, distinct from records by construction |
| **several databases** | one global Qt setting, switched by mutating it | a query scope |

Three of these matter more than the rest.

**Declaration over assumption.** RAS and millimetres are the concrete instances, but the general rule
is that *anything a reader must know which is not in the data is a latent bug*. Slicer documents both
assumptions honestly — in a source comment and a user-guide paragraph — and pays for them in every
reader and writer. `frame.ts` is the first application of the rule, not the whole of it.

**One mechanism instead of three.** Making a scene a function of records collapses MRML's undo stack,
its absent provenance, and its MRB save/load into a single thing: the record set plus a query. That is
a reduction in concepts, which is the only kind of simplification that survives contact with a
codebase.

**Records versus bindings.** Segmentation edits and accepted registrations are records; device
streams, camera and window/level are bindings. MRML makes no distinction, which is why a 60 Hz
tracker and a segmentation edit both arrive as `Modified()` on a node and provenance is impossible to
reconstruct afterwards.

## What MRML does better, and what we would be giving up

This list is longer than the one above, and pretending otherwise would waste everyone's time.

1. **Coverage.** Twenty-five years, every modality, every module, hundreds of extensions. We have one
   file.
2. **Compile-time typing.** `vtkMRMLScalarVolumeNode` is discoverable and type-checked. `type:
   "dataset"` is neither. Runtime validation has to buy back what C++ gave away free.
3. **The event system.** MRML's observer mechanism — `Modified()` propagation, node references,
   scene events — is how everything stays in sync. See the gaps below; this is the largest hole in
   the proposal.
4. **Transform hierarchies.** `vtkMRMLTransformNode` chains, harden and unharden, composition to
   world. Load-bearing for registration and for IGT, and the record models we studied have no
   equivalent.
5. **Storage-node accumulated wisdom.** Decades of real-world file misbehaviour handled, including
   the warnings for formats that cannot carry orientation.
6. **MRB works.** Save a scene, mail it, open it. We have nothing, and "the query plus the store" is
   not yet an answer you can email.
7. **Undo semantics.** Append-only gives you history; it does not automatically give you what a user
   means by ⌘Z, which usually includes restoring view state — and view state is a *binding*.

## The gaps

### These threaten the thesis

1. **Editing in a query-derived model is unproven.** Every shipped instance of scene-as-query is
   read-only: the atlas, ReMINDer, our Zarr cache. Slicer exists to edit. The candidate answer is
   append-only with the lineage model already prototyped in `Slicer/DICOMProvenance`, generalized —
   but candidate is the operative word.

2. **There is no change-propagation design at all.** If a view is a query result, what tells it the
   result changed, and how does a hundred-module GUI stay coherent? MRML answers this with events;
   we answer it with nothing. This is reactive-dataflow territory, it is the first question a
   serious reviewer will ask, and **it has to be settled before the query layer is written**, because
   it decides whether a query returns a *value* or a *live view*. That is a fork in the design, not
   an implementation detail.

3. **Incremental re-derivation.** Principle 7 makes it mandatory rather than an optimization: a
   binding update must touch one transform, not rebuild a scene. Steve's `rebuildScene(row)` is a
   full re-derivation, which is right for a click and fatal at device rates. Nothing designed.

### Large but tractable

4. **Transforms.** Needs a record form for chains, hardening, and composition to world.
5. **Where records live.** Zarr attributes cannot hold a BIDS dataset or a baffle's
   parameterization; ZMP manifests (Parquet, DuckDB-queryable) can. Undecided.
6. **Undo, as distinct from history.**
7. **An MRML interop path.** For migration to be a real option there must be a bridge — read MRB,
   write MRB, or a documented mapping. Without it this is a parallel universe, and parallel universes
   get ignored.

### Known debt, already incurred

8. **`RAS` appears in 162 files** in `src/SlicerLive`, and the millimetre assumption at ~18 sites
   including `units: "mm"` returned as a literal. Inherited by copying, not yet paid down.
9. **Coverage.** Records, query, payload, semantics and provenance are all unwritten.
10. **The validation bar.** exfield's standard is golden-testing against the reference
    implementation with bit-identical re-read across 29,520 samples. We have ten unit tests.

### Not yet thought about

11. **Concurrency and more than one author.** Append-only should be a natural fit; untested.
12. **PHI and access control in a query model.** A query that can select anything is a query that can
    select the wrong thing.
13. **Scale.** The atlas is 743 records. This database is 67,000 series.

## Order of work

1. **Records** — id, type, semantics, payload pointer, edges. Frames hang off datasets, so this is
   what makes `frame.ts` load-bearing rather than decorative.
2. **Change propagation** — gap 2, moved ahead of the query layer because it constrains it.
3. **Query.**
4. **Append-only editing, and the records/bindings split.**

Then, per Ron's roadmap: UI and appearance, then modules.

## The honest summary

The architecture is better than MRML on the axis that matters for the next twenty-five years —
extension by declaration rather than by writing classes — and it is nowhere near MRML on coverage,
on change propagation, and on being a thing you can actually use today. The first is an argument;
the second is a warning. Both should be read.
