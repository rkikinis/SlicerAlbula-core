# SlicerLive architecture — eleven principles

**Draft for Ron to shred, 2026-09-03.** `data-model-design-2026-09-03.md` is the working-out, with
the dead ends left in. This is only the conclusion: what the architecture should be, why we believe
it, and what it costs. Every principle below came either from something already shipped or from a
documented failure — none of it is invention.

The premise, in Ron's words: *"This is the best time to learn from a quarter century of experience
and get to the best possible architectures."* The window is open because SlicerLive is still small.
Every mistake catalogued here was locally reasonable when it was made and is now permanent.

---

## The data model

**1. A scene is a query over records, not a graph you construct.**
Records are typed, flat and addressable; a view selects and traverses. Mike prototyped it in 2018
(`atlasStructure.json`, 743 JSON-LD records); Steve ships it now (`remind-compare.js` opens a case as
`loadIndex(...)` + `PARAMS.get("case")`). *Cost:* everything that currently builds scenes imperatively
is rewritten. *Payoff:* scenes become reproducible, diffable, and generable — including by an agent,
which is the whole premise of the project.

**2. Identity, semantics and payload are three fields, not one thing.**
Identity says what this is and what it came from; semantics says what it means; payload is a pointer
plus a type. DICOM is excellent at the first two and variable at the third, which is why bundling
them drags payloads into bad encodings. Mike's `DataSource` is a `mimeType` and a URL, and nothing
else in the model knows about formats.

**3. Relations are edges, so hierarchy is a graph.**
One structure belongs to many groups; many hierarchies coexist over one set of data. This is what
makes BIDS, well-plates and multiple overlapping anatomical hierarchies expressible without
extending a schema. MRML's single subject-hierarchy tree is the thing to *not* reproduce.

**4. Semantics the archive cannot hold go in the record, never back into the data.**
Steve's `tp` field (`preop`/`intraop`) is the entire point of ReMINDer and DICOM has no tag for it.
exfield needed `declared_unit` because EX files state units nowhere. Additive always; originals
untouched.

**5. One authority per data kind, and derived things carry their source's fingerprint inside
themselves.**
Where a format is authoritative, everything else is derived and regenerable. A derived artifact
stores the fingerprint of what it came from *within itself*, so the two cannot drift — our Zarr
cache does this and it is why it has no ledger. Mike hit the same problem in exfield and lists the
unserialized fingerprint as an open gap. Ron's "no orphans, no zombies" then holds by construction.

**6. Edits append. Nothing is overwritten.**
A view queries the accumulated records. This makes editing and provenance *the same mechanism* — the
`DICOMProvenance` lineage model (`edit#1 → edit#2 → a colleague's validation`) generalized from SEG
lineage to any change. It is also the one thing no existing scene-as-query system does, because
atlases and dashboards are read-only and Slicer exists to edit.

**7. Records versus bindings is the line that must not blur.**
Segmentation edits, accepted registrations, derived results: **records** — appended, queryable,
auditable. Device streams, camera, window/level, current time in a sequence: **bindings** — live,
ephemeral, never appended. A 60 Hz OpenIGTLink stream as records destroys the store within the hour;
a committed registration as a binding loses the clinical history. This also forces the derived scene
to be **incrementally updatable**, since a full re-derivation per frame is fatal at device rates.

## Geometry and coordinates

**8. Store the address; derive the coordinates.**
`(element, xi)` in a host scaffold survives deformation because it was never a position — exfield's
`EmbeddedPoints` and `HostedPath`, whose world geometry is "derived by evaluating the host, never
fitted." The same idea as principle 1, applied to geometry. For IGT this is the difference between
*where am I in space* and *where am I anatomically*, and the second is the clinical question.

**9. A frame is declared, never assumed.**
Keep the affine IJK→world matrix; add a per-dataset frame declaration giving each axis a name, a type
(spatial / temporal / spectral / channel / polarization), a unit, and a direction meaning. **RAS
becomes one declared value, not an invisible default.** NRRD already does this (`space:
3D-right-handed`, per-axis `space units`); FITS WCS already does this (`CTYPE`, `CUNIT`); Slicer
cites the NRRD spec in its own references and discards the information at import. Slicer's RAS was
adopted because "several GE researchers were early contributors" — documented in its own user guide —
and every reader and writer has paid a sign flip since. *Cost: `RAS` appears in 162 files in
`src/SlicerLive`. That is work, not a reason to skip it.*

**10. A physical quantity is a number and a unit. Store both.**
Slicer's units system can only reformat: `vtkSlicerUnitsLogic.cxx:224` — "in Slicer, 'length'
quantity values are always expressed in millimeters" — so nanometer support is a display coefficient
and every unit clamps display to ±10000, giving a microscopist ±10 µm. We render in **float32**,
where the governing quantity is the ratio of extent to smallest feature, so a canonical physical
scale is precisely the wrong instrument. Datasets declare a scale to meters in `double`; the renderer
works in a scene-normalized frame (which is what WebGPU wants anyway for depth precision);
measurements reconstruct in `double` and carry their unit. *We have already inherited the assumption
at ~18 sites, including `units: "mm"` returned as a literal from `measurements.ts`.*

**11. One representation is the source; the rest are renditions, and they invalidate.**
Slicer's `vtkSegmentation` has exactly this — `SourceRepresentationName`, conversion paths,
`InvalidateNonSourceRepresentations()` — welded inside one class. exfield has it for geometry, with
exact Bezier cells as the default and `tessellate=N` as a *named lossy fallback*. Generalize it: a
baffle's parameterization is the source and its triangulation is a rendition; a decoded labelmap is
a rendition of a SEG. Getting this backwards is how someone loses a week's work to a round trip.

## The corollary that keeps recurring

**An interchange format is never a representation.** DICOM SEG is a fine archival encoding and cost
19.3 s to decode because we used it in motion. NIfTI-1 has three orientation methods of which two can
disagree, a `float32` affine, six unit values and RAS+ mandated — read it because people send it,
write it because people ask, never build on it. The same conclusion from opposite directions.

## What is genuinely unsettled

1. **Principle 6 is unproven for interactive editing.** Every shipped scene-as-query system is
   read-only. This is the crux, and it is where the project either works or does not.
2. **Where the record store physically lives.** Zarr attributes cannot hold a BIDS dataset or a
   baffle's parameterization; ZMP manifests (Parquet, DuckDB-queryable) can. Undecided.
3. **Query results must not be re-derived per frame.** The caching discipline built for Zarr has to
   extend to derived scenes, and principle 7 makes that a hard requirement rather than an
   optimization.
4. **Several databases, one per project** (Ron's requirement). A project becomes a query scope, which
   dissolves the problem — but Slicer cannot do this at all today, so there is no prior art to copy.

## How to read the cost column

Nothing above is proposed because it is cheap. Principles 9 and 10 are the two we have already got
wrong by inheritance, and 9 in particular is a large mechanical change. The argument for doing them
now is that they are *coordinate model*, not features: a frame you cannot name is a frame you cannot
verify, and a number without a unit is not a measurement. Both were cheap to get right in 2000 and
have been impossible to fix since.
