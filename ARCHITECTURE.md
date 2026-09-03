# Where we are, how this improves on MRML, and what is missing

**2026-09-03.** `README.md` says what this is; `../docs/architecture-principles.md` states the eleven
principles and where each came from. This document is the status and the honest gap list.

## Where we are

Built: `model/frame.ts` — a coordinate frame that declares what its axes are. 10 tests, documentation
extracted from the source, licence in place.

Established, by reading rather than assuming: 3D Slicer's data model is **not** DICOM-centric; MRML
is; MRML is also the layer its own developers want rearchitected.

**Scene-as-query is Michael Halle's idea, and Ron learned it from him.** An earlier draft of this
document called it a convergence of three independent designs. That was wrong, and the correction
matters under this project's own rule about acknowledgement: it is transmission, not coincidence.
Mike's Open Anatomy atlas is the origin; Ron carried it here; Steve's ReMINDer is the same idea
shipped. What the Zarr working copies add is a fourth application of it, not a fourth discovery.

The idea itself: leave the archive untouched, derive a small regenerable index carrying the semantics
the archive cannot express, address payload by pointer, and make a view a **selection** rather than a
construction.

Not built: records, query, payload resolution, semantics, provenance, editing. That is the work.

## What MRML actually is, stated fairly

MRML is a **scene of typed C++ node classes**. `vtkMRMLScalarVolumeNode` holds a volume;
`vtkMRMLStorageNode` subclasses move it to and from files; `vtkMRMLDisplayNode` subclasses say how it
looks; `vtkMRMLSubjectHierarchyNode` arranges it; an observer/event mechanism keeps a hundred modules
and every view in sync when any of it changes.

It is not sloppy, and "accreted" was the wrong emphasis. **Ron's framing is the right one: twenty-five
years of MRML was the empirical phase, and we are now in a position to generalize from it.** Building
a class per data kind is how you find out what the categories actually are. You cannot write the
general model first; you earn it by having built the specific ones for a quarter century. MRML is the
evidence, not the error.

What generalizing means concretely is that the extension mechanism stops being code — because code
diverges, and twenty-five years of different people writing classes for different needs is exactly
where the divergence came from.

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

## Deletion, which append-only has to answer first

Ron's question: *how do you deal with data that got deleted from Slicer?* It is the sharpest
objection to principle 6, and it has to be answered before anything is built on append-only.

**Append-only does not mean immutable.** It means no *silent overwrite*. Deletion is therefore a
first-class operation that must be designed, not an absence to be explained away with a tombstone.

**There are three deletes, and conflating them is the bug.**

| | means | what survives | reversible |
|---|---|---|---|
| **retract** | not in my scene; I am done with this result | everything; it is a view change | yes |
| **purge** | remove data that was legitimately here — consent withdrawn, retention expired | a receipt: *N objects, fingerprint H, at T, by A, reason R* | no |
| **expunge** | this arrived **by accident** and should never have existed here | **nothing. no receipt, no fingerprint, no gap** | no |

The third one is Ron's actual case, and it defeated the design that had only the first two. A study
entered this database by mistake; there should be **no trace of it**. A receipt is a trace.

And a fingerprint is a *worse* trace than it looks. A content hash is only anonymous against
unguessable inputs — for medical images the input is guessable, because anyone holding a copy of the
study can hash it and match the receipt. So "keep the fingerprint, not the content" is a **membership
oracle**: it confirms to a questioner that this data passed through here. For a purge that is exactly
the accountability you want. For an expunge it is the thing you were trying to prevent.

Expunge is therefore stricter than purge in a way that constrains the whole store:

- no content, no metadata, **no fingerprint**;
- **no structural evidence** — no gap in an id sequence, no deletion marker, nothing whose absence
  implies a presence. An append-only log with monotonic ids cannot expunge entry 4173 without
  leaving a hole that says *something was here*. So **records must be addressed by content or random
  id, never by sequence**, and the primary store must carry no tombstones.
- **no safety net.** Any backup taken before an expunge preserves precisely what the expunge exists
  to remove. This is the one operation that cannot be made reversible, and a design that offers an
  undo for it is lying.

### What we actually found, doing this to the real database

Checking rather than assuming, which is the only way this kind of claim means anything:

**The index, the index backups, the provenance store, the Zarr cache, the filesystem and the
DICOM files were all clean.** The database itself had been properly cleaned.

**`ctkDICOMTagCache.sql` was not.** `SELECT count(*) … WHERE Value LIKE …` returned **0**; `strings`
on the same file returned **156** hits. The rows had been deleted and the *bytes had not* — SQLite
leaves deleted content in free pages until `VACUUM`. Proved by copying the file, vacuuming the copy,
and re-counting: 156 before, 0 after. The file was a 1 GB regenerable cache and is now deleted.

So the lesson is not "remember to clean the cache". It is:

> **A delete is only as complete as the least-considered derived artifact.** Caches, thumbnails, tag
> stores, index backups, search indexes and version history are all places a deletion does not
> reach by default, and every one of them is created by something other than the code doing the
> deleting.

**Our own version history was the second trace.** Thirteen commits carried a patient surname in a
notes file, put there by the very sentence stating that the study must not be propagated. `HEAD` had
been scrubbed; history is not scrubbed by scrubbing `HEAD`. It required a full `filter-branch`, a
reflog expiry and a `gc --prune`, verified by scanning every reachable blob in the object store.
Which promotes the earlier design rule from advice to a constraint:

> **Provenance and notes must be written so that they never need expunging.** Fingerprints and UIDs,
> never names, never dates of birth. Not because names are hard to remove, but because *history* is,
> and provenance is history by construction.

**And the first scan I ran reported clean when it was not.** A plain `grep -ril` skipped the 1 GB
binary; only `strings` and `grep --binary-files=text` found it. That is the second checker in this
project to return a false negative on a file whose format it mishandled — the first being a VR
validator that passed an implicit-VR file it could not parse. Hence exfield's rule, adopted here
verbatim: **agreement with a tool is not the same as correctness.** An expunge must be verified by a
method that cannot skip its target, and the verification is part of the operation, not a follow-up.

### The invariant

Purge and expunge must both be **closed under references**: nothing may point at what is gone. This
is already testable — `Slicer/database/audit-database.py` defines a **zombie** as an index row whose
file is missing and an **orphan** as a file with no row, so the post-deletion condition is *zero
zombies, zero orphans*, which we run rather than hope for.

And **deletion can find its own derivatives without a ledger**, because a derived artifact stores the
fingerprint of its source *inside itself* (principle 5). "Remove everything derived from X" is a
scan. That was not the reason for the principle; it is a payoff of it — and it is the mechanism that
would have caught the tag cache, had the tag cache been ours.

**Honest limits.** Deletion cannot reach exported data, someone else's copy, a system backup, or a
filesystem block that has been freed but not overwritten. Export and backup are the boundaries where
deletion stops being a technical guarantee and becomes a policy one, and the design should say so
plainly instead of implying a completeness it cannot deliver.

### The boundary, hit for real within the hour

Having written that, we walked straight into it. `tmutil` reports that Time Machine includes both
`/Applications` and the working folder, with a local snapshot predating the work. If the expunged
study was present when that snapshot was taken, the snapshot holds it — index, files, and the tag
cache — and the expunge is therefore incomplete outside the live filesystem.

**This was raised and decided rather than discovered later.** Ron's answer: leave it alone, on stated
grounds — the backup destination is **offline by default** and only mounted when actively in use, the
disk is **encrypted**, and he is the **sole person with access**. Air-gapped by default, encrypted at
rest, single authorized user. That is a defensible acceptance of a residual risk, and it is exactly
the shape the boundary should have: a technical guarantee up to the filesystem, a **policy** decision
beyond it, recorded with its reasoning.

The generalisable form, which any system handling clinical data owes its users:

> **An expunge must state its reach.** "Removed everywhere I can see, and here is what I cannot see"
> is an honest and useful guarantee. "Deleted" on its own is not, and a system that says only
> "deleted" is making a promise it cannot keep.

A corollary for retention, adopted here and now enforced by `audit-database.py` rather than merely
written down: **a pre-operation backup lives until the operation is verified, then it goes** —
verification as the trigger, not a calendar. Three index backups guarding a path rewrite that had
been verified 1357/1357 were still present a day later, each strictly behind the live index, such
that restoring any of them would silently have dropped two derived series. The audit now reports a
backup older than the index it came from as **STALE**, because a rule that is only in a document is a
rule that decays.

**Purge must be closed under references.** You cannot purge X while a derived record still points at
it, unless the derivative is purged too or explicitly marked as orphaned. The useful part is that
this is already *testable*: `Slicer/database/audit-database.py` defines a **zombie** as an index row
whose file is gone and an **orphan** as a file with no row, so the post-purge invariant is "zero
zombies, zero orphans" — a test we run today rather than a property we hope for.

**Purge can find its own derivatives without a ledger.** Because a derived artifact stores the
fingerprint of its source *inside itself* (principle 5), "purge everything derived from X" is a scan,
not a bookkeeping exercise. This was not the reason for that principle; it is a payoff of it.

**The receipt problem, and its resolution.** Ron wants that study gone *and* would want to know it was
removed deliberately rather than lost. Those look contradictory. They are not, if the receipt keeps a
**content fingerprint rather than the content**: *N objects, source fingerprint H, purged at T by A,
for reason R*. That is enough to prove a deletion happened and to verify nothing dangling remains,
while retaining no identifying information. **You can audit a deletion without retaining what was
deleted.**

Which yields a design rule with teeth:

> **Provenance records must be written so that they never need purging.** Fingerprints and UIDs, never
> names, never dates of birth.

That rule comes from getting it wrong today. This workspace's git history recorded a birth date in two
code comments and a patient surname in a note. `HEAD` is scrubbed, but *history is not purgeable
without a rewrite* — which is precisely the situation the rule exists to prevent, discovered in our
own repository within a day of writing the principle.

**Honest limits.** Purge cannot reach exported data — a DICOM export, a shared file, a published page
— and it cannot reach someone else's copy. It follows that export is the boundary where deletion
stops being a technical guarantee and becomes a policy one, and the design should say so rather than
imply otherwise.

**For comparison, what happens today.** MRML has no answer at all: `RemoveNode()` and the node is
gone from the scene, with nothing recording that it existed and no relationship to any MRB you saved
earlier. ctkDICOMDatabase deletes rows and files, and the skew between those two is exactly why the
audit script had to be written — and, as above, it does not touch its own tag cache. So "deleted from
Slicer" currently means *gone from this session, and possibly still present in three MRBs, a tag
cache, and a database*.

None of the three operations above exists in Slicer today. That is the gap this section describes,
and it is not a small one: a research platform that ingests clinical data cannot treat "this should
never have been here" as an unsupported case.

## The gaps

### Checked against Steve's gallery first

`pieper.github.io/live/` is 25 scenes, and several items that were on this list are already
prototyped there — which is the difference between a gap and an unread bibliography:

- **`deform.html`** — a nonlinear thin-plate-spline landmark deform. **Transforms** were gap 4.
- **`algorithms.html`** and **`nnlive.html`** (both work-in-progress) — a WebGPU-native segment
  editor with brush strokes, and interactive segmentation where each click runs a model. **Editing**
  was gap 1, and it is being built.
- **`cardiac.html`** — 4D volume rendering of a beating heart. 4D is not hypothetical.
- **`segroulette.html`** — a random segmentation out of **190,000+ IDC DICOM SEGs across 36
  collections**. **Scale** was gap 13; there is prior art at three times this database's size.
- **`islands.html`** — a stress test for nested segmentations, tumours inside a liver. Directly
  relevant to overlap, which a labelmap cannot represent.
- **`remote.html`** — volume rendering on a transient cloud NVIDIA L4. The discrete-GPU case that was
  deferred as "only matters for discrete cards" is live.
- **`real.html`** — a chunked **OME-Zarr** volume streamed in, which is the typed-axes format
  recommended above already in use.
- The gallery itself fetches `scenes/index.json` and filters on `legacy` and `wip` flags. A fourth
  independent instance of index-plus-selection, and it is the site's own front page.

What that leaves is a sharper point rather than a softer one. Twenty-five focused pages each own
their state, so none of them has had to answer how a hundred modules share one scene coherently —
which makes change propagation the central gap rather than one of many.

### These threaten the thesis

1. **Editing in a query-derived model is unproven** — and much narrower than it first looked.
   Editing itself is not missing at all: **SlicerLive Native already ships a Segment Editor**, with
   threshold and auto-threshold, paint and erase, islands (keep-largest, remove-small), smoothing
   (median, open, close), margin grow/shrink, logical operations, and per-segment statistics —
   `logic/segment-effects.ts` and `logic/segmentation-editor.ts`. Steve's `algorithms.html` and
   `nnlive.html` push further, into brush strokes and a model in the loop.

   So the open question is not *can we edit*; it is **does an edit land as an appended record that a
   query re-derives, rather than as mutated state**. That is a much smaller and much more testable
   question, and it is the whole of the remaining risk in principle 6. The candidate answer is the
   lineage model in `Slicer/DICOMProvenance`, generalized, plus the deletion design above.

   Note also where the unit debt actually sits: `applyMargin` takes `marginMm` and `spacingMm`. The
   millimetre assumption is not buried in a reader — it is in the editor, in a number the user
   types.

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

4. **Transforms.** `deform.html` proves nonlinear TPS deformation runs; what is missing is the
   *record form* — chains, hardening, composition to world — and how a deformation relates to the
   frame declaration it is transforming between.
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
    select the wrong thing. Related to the deletion design above, and the harder half of it.
13. **Scale** — partly answered elsewhere. `segroulette.html` selects from 190,000+ SEGs across 36
    collections, so an index at that size is demonstrably queryable; what is untested is a *scene*
    derived by query at that scale with editing on top.

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
