# What is the data model? — a design note before writing more code

**Draft, 2026-09-03.** Prompted by Ron: IDC organizes everything around DICOM — input converts in,
output converts to whatever the user wants, and the payoff is one robust model that works across
every repository. Does SlicerLive inherit that? And: *"I am not opposed to something different, like
Zarr. I just say we need to think about a design before going further."*

This note argues that the DICOM-everything rule and the Zarr-everything rule fail for opposite
reasons, that the useful split is not by format but by **which question you are answering**, and
then works through the four cases Ron raised.

## 1. IDC's rule is right, for IDC's job

IDC is an archive with many contributors and many consumers, and the invariant it must hold is
**interoperability at rest**. One data model means a query written against one collection works
against all of them, and DICOM is the only imaging model with that reach. Nothing below disputes
this.

But SlicerLive is not an archive. It is an application, and its invariant is a **fast uniform
representation in motion** — ideally one the GPU can take without transformation. Those are different
jobs, and the mistake available to us is to let one format serve both because it served one well.

We already have the evidence in hand. DICOM SEG is a perfectly good archival encoding of a
segmentation and a hostile working one: 1-bit masks, one frame per slice per segment, in no
particular order. Decoding a 67-segment SEG cost **19.3 s**, and getting it to 3.6 s meant skipping
zero bytes eight at a time. Meanwhile the same segmentation as a plain labelmap array is a
`writeTexture` away from being on screen. Format was not the problem; *using an at-rest format in
motion* was.

## 2. DICOM-centrism bundles three separable things

Any imaging data model has to answer three questions, and DICOM answers them together:

| | question | how good is DICOM |
|---|---|---|
| **Identity & provenance** | what is this, whose is it, what was it derived from | **excellent** — the UID hierarchy and referenced-instance sequences are the reason IDC works across repositories |
| **Semantics** | what does it mean — anatomy, algorithm, units | **very good** — coded sequences with real vocabularies (SCT, DCM) |
| **Payload** | the actual bytes and their layout | **variable** — see the table in §3 |

The failure mode of "everything is DICOM" is that a payload gets dragged into a bad encoding because
its identity needs a home. The failure mode of "everything is Zarr" is that identity and semantics
get thrown away — and those are precisely what makes IDC's cross-repository property possible. So
neither extreme, and the split is not per-format but **per-question**.

Proposed rule:

> **Identity and semantics stay DICOM-shaped regardless of payload. Payload representation is chosen
> per data kind, for its consumer.**

"DICOM-shaped" is deliberate. Where DICOM has an IOD for a thing, DICOM *is* the record for it.
Where it does not, we still use its identity model and its vocabularies rather than inventing ours.

## 3. What DICOM actually covers, honestly

| data kind | DICOM support | verdict |
|---|---|---|
| CT / MR / PET / US images | native, mature | DICOM at rest, always |
| labelmap segmentations | SEG (binary + fractional) | fine at rest, bad in motion; no true overlap in a labelmap model |
| measurements, findings | SR | fine, underused |
| triangulated surfaces | **Surface Segmentation Storage** (`…1.1.66.5`), and encapsulated **STL / OBJ / MTL** (`…1.1.104.3/.4/.5`) | exists; the native one has almost no tooling, the encapsulated one is a blob in an envelope |
| **volumetric tet/hex meshes** | **nothing** | no IOD exists |
| **per-element material properties, boundary conditions, solver state** | **nothing** | no IOD exists |
| **time-varying simulation output** | nothing suitable | wrong shape entirely |

The bottom three rows are why "convert everything to DICOM" cannot be a universal rule for us: it is
not that DICOM does it badly, it is that there is nothing to convert *to*.

## 4. The four cases

### NRRD — convert in, and keep the header

Images convert to DICOM cleanly; NRRD's space directions and origin map onto
`ImageOrientationPatient` / `ImagePositionPatient` without loss. Two catches.

First, **identity has to be invented**. A NRRD has no `SOPInstanceUID`, so ingest assigns one — which
means the same file ingested twice becomes two different objects. That is acceptable in an archive
with a curation step and unacceptable in a working folder. **Content addressing fixes it**: hash the
bytes, and re-ingest is idempotent by construction. (This is what ZMP does, and it is the first place
where Mike's layer answers a question DICOM structurally cannot.)

Second, NRRD headers carry **arbitrary key/value fields** that Slicer genuinely uses — measurement
frame, custom keys written by modules. In DICOM these can only become private tags, which is exactly
the kind of thing that survives a round trip and nothing else. Worth deciding deliberately rather
than discovering later.

**Proposed:** NRRD in → DICOM as the record, Zarr as the working copy, original content hash and
surviving header fields recorded alongside. NRRD out on request.

### NIfTI + BIDS — this is the case that breaks the rule

A single NIfTI converts as easily as a NRRD. But Ron is right that they now arrive as a **directory
tree**, and BIDS is not a file format — it is *directory-as-metadata*. The path encodes
subject / session / task / run; sidecar JSONs carry acquisition parameters; `participants.tsv`,
`events.tsv` and the `derivatives/` tree carry the study design.

Convert BIDS file-by-file to DICOM and every pixel survives while the **experiment** does not. The
grouping that made it a study — which runs belong to which task, which subjects are controls — has no
DICOM expression. You would be converting a dataset into a pile of series.

This is the strongest argument in Ron's own list against DICOM-as-universal, and note *where* it
bites: not on the payload, but on structure above the series level, which is the one place DICOM's
hierarchy is fixed at patient → study → series → instance and cannot be extended.

**Proposed:** ingest BIDS as DICOM images **plus** a preserved dataset structure — the BIDS entities
kept as first-class fields, not flattened into `StudyDescription`. Export back to BIDS must be
possible, which means the structure has to be stored, not derived.

### Triangulated meshes — the baffles are not their triangles

DICOM can hold a baffle two ways: Surface Segmentation (semantically proper, almost no tooling) or
encapsulated OBJ/STL (well-tooled, but the DICOM part is only an envelope — you gain identity and
linkage, you gain no queryability of the geometry).

Either is workable. Neither addresses the actual problem, which is that a SlicerHeart baffle **is not
fundamentally a triangle soup**. It is control points, a fitted surface, and an association with an
annulus or valve. The triangulation is an *output*. Store only the triangles and the model is
viewable, measurable, archivable — and no longer editable, because the thing you would edit is gone.

**Proposed:** the same archive/workspace split, applied to geometry. The triangulation goes to DICOM
(so any DICOM consumer and IDC can see it), the authoring state — control points, fit parameters,
what it is attached to — lives with the workspace object. Say plainly that the DICOM object is a
**rendition, not the source**. Getting that backwards is how people lose a week of work to a
round trip.

### Tet/hex meshes for SOFA and Newton — do not try

There is no IOD, and the payload is not just a mesh: it is topology, per-element material
properties, boundary conditions, constraints, solver settings, and then a **time series of deformed
configurations** whose consumer is a GPU solver. NVIDIA Newton wants flat arrays it can hand to Warp;
SOFA wants topology plus materials. Neither wants DICOM, and encapsulating a `.vtu` blob would let
us claim DICOM coverage while contributing nothing but a wrapper.

**Proposed:** arrays in Zarr — this is the case the format was designed for — and DICOM contributes
exactly one thing: *this simulation was derived from that series*. That link is worth real effort;
pretending the mesh is a DICOM object is not.

## 5. The tension this creates, named rather than hidden

The design above implies something that holds identity for kinds DICOM cannot express. That is a
second place where identity lives — and a second source of truth about files is precisely what
produces the orphans and zombies Ron will not tolerate. It is the same reasoning that made the Zarr
cache deliberately have **no ledger**: the directory is the index and the fingerprint lives inside
the Zarr's own attributes, so it cannot drift from what it describes.

The resolution has to be a rule about authority, not about storage:

> **Where DICOM has an IOD, DICOM is authoritative and anything else is derived and regenerable.
> Where DICOM has no IOD, the workspace record is authoritative and DICOM carries only the link.**

So there is exactly one source of truth *per data kind*, and no kind has two. And there is a clean
graduation rule: **if DICOM gains an IOD for something, that kind moves** — which keeps the design
honest as the standard evolves rather than freezing today's gaps into architecture.

## 6. Why this is also the conversation with Mike

A record that carries identity and semantics and *points at* payloads in whatever form suits them is
a manifest. Content-addressed, queryable manifests are what `zmanifest` / ZMP already are, and
DuckDB-queryable Parquet is a better answer for "which of my data is what" than SQLite-plus-
convention. The question in `for-mike-2026-09-03.md` — is archive/workspace a stable split or a
waypoint — is this question. They should be asked together, not separately.

## 7. What this note does not settle

1. **Where the workspace record physically lives.** ZMP manifests, or Zarr attributes as we do
   today, or something else. The Zarr-attributes approach has the strong property of being
   undriftable, but it only holds per-series facts — it has nowhere to put a BIDS dataset or a
   baffle's parameterization.
2. **Whether SlicerLive should read DICOM at all in steady state**, or only ever read working copies
   with conversion as an ingest step. Today it reads both, which is two code paths.
3. **What "export to whatever the user wants" costs us.** IDC's promise is easy when everything is
   DICOM. If the record for a baffle is not DICOM, exporting it as DICOM means re-deriving. That is
   fine, but it is work, and it should be budgeted rather than assumed.
4. **Time.** Nothing above handles 4D well — not DICOM (multi-frame is a container, not a model),
   and not the Zarr cache as built (one array per series). Simulation output and cardiac imaging both
   need it. Probably the next thing to think about after this.

---

*Drafted by Claude (Anthropic) with Ron Kikinis, as input to a design discussion, not as a decision.*

---

# Addendum: how 3D Slicer actually does it

Ron asked. Checked against the Slicer checkout at `~/Slicer`, not from memory — and it substantially
revises §4 and §7 above. **Slicer's data model is not DICOM-centric.** MRML is the model; DICOM is
one importer among many. Three of the four cases in §4 already have answers, and two of my "open
questions" in §7 are answered too.

## The architecture, in six pieces

**1. Storable node / storage node are separate concerns.** `vtkMRMLStorableNode` is the data in
memory; `vtkMRMLStorageNode` is how it reaches a file. About twenty storage classes exist
(`vtkMRMLNRRDStorageNode`, `vtkMRMLModelStorageNode`, `vtkMRMLSegmentationStorageNode`,
`vtkMRMLTableSQLiteStorageNode`, …). **File format is a property of the storage node, not of the data
model** — so the model does not know or care that NRRD and NIfTI are different things.
`vtkMRMLVolumeArchetypeStorageNode` delegates to ITK's factories, which is why format coverage is
*inherited* rather than written.

**2. DICOM identity is an attribute, not an identity.** This is the piece that overturns my BIDS
argument. Subject hierarchy levels are **strings** — `GetDICOMLevelPatient()` = "Patient",
`GetDICOMLevelStudy()` = "Study", and a generic `GetSubjectHierarchyLevelFolder()` = "Folder" — held
in a `Level` *attribute*. DICOM UIDs likewise live as attributes (`GetDICOMUIDName()` = "DICOM",
`GetDICOMInstanceUIDName()`). So the hierarchy is **extensible**: patient → study → series is three
conventional values, not a fixed schema. §4 claimed DICOM's hierarchy "cannot be extended" and
concluded BIDS has no home. True of DICOM; **false of Slicer**. BIDS entities can be folder levels
with attributes, and the reason Slicer does not do it well today is that nobody wrote the plugin, not
that the model forbids it.

**3. DICOM support is a confidence-based, bidirectional plugin negotiation.**
`DICOMPlugin.examine(fileList)` returns loadables each carrying a `confidence` from 0 to 1, and the
highest confidence wins; `load(loadable)` produces MRML nodes; `examineForExport(...)` runs the other
way. Six plugins ship in core (scalar volume, volume sequence, image sequence, enhanced US, GE ABUS,
data bundle) and everything else — SEG, RT, PET — arrives as an extension. So "what is this DICOM
data?" is **arbitration, not a lookup**, and DICOM coverage grows without the model changing.

**4. Segmentations already have exactly the source/rendition model §4 proposed for baffles.**
`vtkSegmentation` has a `SourceRepresentationName` (recently renamed from *Master*), derived
representations built on demand by `CreateRepresentation()` along declared conversion paths, and
`InvalidateNonSourceRepresentations()` when the source changes. Representations available: binary
labelmap, fractional labelmap, planar contour, closed surface. So the thing I proposed as a design
principle for geometry is a **general, implemented mechanism** — with automatic reconversion and
invalidation, which my version did not have.

**5. Unstructured grids are first class.** `vtkMRMLModelNode` holds a `vtkPointSet` with a
`MeshTypeHint` of `PolyDataMeshType` or `UnstructuredGridMeshType`, and `vtkMRMLModelStorageNode`
reads *and writes* `.vtu` and `.ucd`. §4 said tet/hex meshes have no home — true of DICOM,
**false of Slicer**. They have had one for years. What is genuinely missing is the simulation
apparatus around the mesh: per-element materials, boundary conditions, solver state.

**6. Time is generic, not an imaging special case.** `vtkMRMLSequenceNode` indexes **any** node type
by a value, with `IndexName` and `IndexUnit` (defaulting to time / seconds) — a sequence of models or
transforms as readily as of volumes. §7 asked what to do about 4D; Slicer's answer is that 4D is not
a data type but a *container over any data type*.

Worth noting the escape hatch Slicer chose for things DICOM cannot express:
`DICOMSlicerDataBundlePlugin` embeds an entire MRB scene inside a DICOM object. That is precisely the
encapsulation move §4 was sniffy about, adopted deliberately — DICOM as an envelope for a workspace,
so a scene can travel through DICOM infrastructure intact.

## What this means for the design

The split argued in §2 is not a new idea. It is **Slicer's existing architecture**, and Slicer draws
the line in a better place than I did: not "identity DICOM-shaped, payload per kind", but

> **one in-memory model with typed nodes; file formats are pluggable behind storage nodes; DICOM is
> an importer that negotiates; and where one thing has several forms, one form is designated the
> source and the rest are derived and invalidated.**

That is stronger than my version because it makes conversion explicit and *revocable*, and because
it never has two authorities for the same fact.

Which reframes the real question. SlicerLive is not missing a data model — **it is missing MRML.** So
the question for Steve is not "DICOM or Zarr" at all:

**Does SlicerLive reimplement MRML's concepts — the storable/storage split, a designated source
representation, sequences over arbitrary types, an extensible attributed hierarchy — or does it do
something genuinely different, and if so, what does it give up?** Those four concepts are not
incidental; each one is load-bearing, and we have already tripped over the absence of two of them
(no source-representation discipline, hence the decoded-labelmap cache question; no
storable/storage split, hence DICOM reading and Zarr reading being two code paths rather than two
storage backends).

## Databases, one per project

Ron's later requirement — one database per project — is a gap **in Slicer too**, not just here. The
location is a single Qt setting (`slicer.dicomDatabaseDirectorySettingsKey`), and switching means
mutating that one global value; `DICOMLib/DICOMUtils.py` does exactly that (save it, point it at
another directory, work, restore). There is no registry and no notion of two open at once. So
supporting it properly would be a place SlicerLive *improves on* Slicer rather than catching up —
which is worth knowing when the point of the exercise is a migration decision.

---

# Addendum 2: MRML is the legacy, not the target — and what OABrowser does instead

Ron, 2026-09-03:

> MRML is historically grown and a lot of the developers complain about it that it is too much ad
> hoc. People talked about rearchitecting it. Mike experimented with a database approach where a
> sceneview is a database query. See the openanatomybrowser.

This corrects Addendum 1's conclusion. "SlicerLive is missing MRML" was the wrong lesson to draw
from a model nobody wants to reproduce. What follows is the OABrowser scene model read from the data
itself — `mhalle/spl-brain-atlas/slicer/atlasStructure.json`, 743 records — not from description.

Two accuracy notes first: `mhalle/oabrowser` shows a recent repository timestamp but its **commits
stop at 2018-10-04**, so this is a 2017–18 experiment, not current code. And the atlas ships a 14 MB
`brain-atlas.mrml` beside a 377 KB `atlasStructure.json` — the JSON is what the browser reads.

## The model: five record types, flat, JSON-LD

| `@type` | count | carries |
|---|---|---|
| `Header` | 1 | root pointer, title, background image |
| `BaseURL` | 1 | the base every data URL resolves against |
| `Group` | 80 | `annotation`, `renderOption`, and **`member: [@id, …]`** |
| `Structure` | 329 | `annotation`, `renderOption`, `sourceSelector` |
| `DataSource` | 332 | `baseURL`, **`mimeType`**, `source` |

```json
{ "@id": "#right_cingulate_gyrus", "@type": "Group",
  "annotation": { "name": "right cingulate gyrus" },
  "member": ["#right_anterior_cingulate_gyrus", "#right_posterior_cingulate_gyrus",
             "#isthmus_of_right_cingulate_gyrus"],
  "renderOption": { "color": "rgb(49,10,89)" } }

{ "@id": "#right_subthalamic_nucleus_ModelDS", "@type": "DataSource",
  "baseURL": "#_urlBase", "mimeType": "application/octet-stream",
  "source": "models/Model_390_right_subthalamic_nucleus.vtk" }
```

Four properties, each of which answers something this note struggled with:

**Hierarchy is edges, not nesting.** A `Group` lists members by `@id`. So a `Structure` can belong to
several groups at once — many overlapping hierarchies over one set of data. MRML's subject hierarchy
is one tree; this is a graph. §4's BIDS problem evaporates: BIDS entities are more groups and more
annotations. Nothing needs extending because nothing was fixed.

**Payload is a URL and a MIME type, and nothing else knows.** `DataSource` is the entire format
story. This is Slicer's storable/storage split — but expressed as *data* rather than as a C++ class
hierarchy, so adding a format adds a MIME type, not a subclass. NRRD, NIfTI, `.vtk`, `.vtu`, DICOM
and Zarr are all the same kind of thing here.

**Semantics and presentation are separate fields on the record.** `annotation` is what it means,
`renderOption` is how it looks, and both hang off identity rather than being tangled into it.

**Everything is globally addressable.** JSON-LD `@id`s mean two atlases can be merged without
collision, and the whole thing is a relation — which is what makes "a scene view is a database query"
literal rather than metaphorical: a view is a selection over typed records plus a traversal of
`member` edges. **The scene is derived, not authored.** You do not mutate a scene; you write a query.

## Why this is the stronger design

It answers, uniformly, every case §4 handled ad hoc:

- **NRRD / NIfTI** — a `mimeType`. BIDS structure — groups and annotations.
- **Baffles** — the triangulation is one `DataSource`, the parameterization is another on the same
  `Structure`. Multiple representations of one thing is the *default shape*, not a mechanism.
  Contrast Slicer, which has exactly this idea implemented well but welded inside `vtkSegmentation`.
- **Tet/hex meshes** — a `DataSource` with a `.vtu` MIME type. Unremarkable.
- **Several databases, one per project** — a project is a set of records and a query scope. Databases
  stop being *places* and become *selections*, which dissolves the problem rather than solving it.

And it matches Mike's whole recent trajectory rather than being an isolated experiment:
`ta98-sqlite`, `fma-sqlite`, `ncitevs` (vocabularies as queryable databases), `zmanifest` /
`zarr-zmp` (content-addressed manifests in Parquet, DuckDB-queryable), and `sqlite-cage` — "run
untrusted SQL against SQLite safely and honestly… most often an LLM agent or an MCP tool". The 2018
atlas JSON-LD and the 2026 ZMP work are one idea at two scales.

## The part that matters most for why SlicerLive exists

If a scene is a query, then **an agent composing a scene is an agent writing a query** — inspectable,
reproducible, diffable, and safe to hand to a machine. Compare the alternative: a scene assembled by
a sequence of imperative API calls, where the result is a mutated in-memory graph nobody can audit.

For the actual purpose here — can 3D Slicer move into the vibe-programming world — this may be the
single most important architectural idea available. And Mike built the enforcement primitive for
agent-composed SQL a month ago, apparently for unrelated reasons.

## Honest limits, before anyone gets excited

1. **The atlas is read-only and static. A working scene is edited.** You paint a segmentation, you
   drag an ROI. Scene-as-query must say where an edit goes. The natural answer is append-only —
   an edit adds records and the view is a query over them, which is exactly the lineage model already
   built in `DICOMProvenance` — but it is **unproven for interactive editing**, and that is the whole
   difference between an atlas browser and Slicer.
2. **743 records is small.** Views over millions of records with per-frame payloads is a different
   regime, and a query-derived scene must not re-derive per frame. The caching discipline we just
   built for Zarr would have to apply to query results too.
3. **Transforms are missing here.** Registration and transform hierarchies are load-bearing in MRML
   and the atlas model as read has no equivalent. That is a real gap, not an omission for brevity.
4. **`renderOption` on the record conflates data with view state.** Fine for an atlas with one
   canonical look; wrong when two view layouts want different colors for the same structure. View
   state probably has to be its own record type, or the query's output rather than its input.

## Revised question for Steve

Not "DICOM or Zarr", and not "reimplement MRML". Rather:

> **Should a SlicerLive scene be a query over typed records rather than a constructed graph — and if
> so, what does interactive editing look like in that model?** Item 1 above is the crux: everything
> else is engineering.

Also worth telling Ron: `mhalle/exfield` (August 2026) reads, evaluates and writes OpenCMISS-Zinc
EX/EXF **finite element scaffolds** with NumPy as its only dependency. The simulation-mesh case in §4
is not hypothetical to Mike; he is working on it now.

---

# Addendum 3: Steve has already built scene-as-query — and all three designs converge

Ron pointed at `https://pieper.github.io/live/webgpu/reminder.html`. Read from the page, its index and
the bundled viewer in `src/live/webgpu/`, not from description.

## ReMINDer: a precomputed index, and a view that is a selection over it

The page fetches exactly one thing, `remind-index.json` — 370 KB describing the whole ReMIND
collection:

```
collection: "remind"        idc_version: "24.0"
generated:  2026-08-14T14:42:40Z
generated_by: examples/remind/worker/build_index.py
source: { doi, portal, bucket: "https://idc-open-data.s3…", subject_count: 114, … }
timeline: [ {key:"preop", rank:0, label:"pre-op MRI"}, … ]     stats: { cases, series, studies,
cases:    [ 114 × { pid, studies:{preop,intraop}, bytes,        bytes, modalities, timeline,
                    series:[ {u,si,m,d,sn,n,b,tp,st,bk,segs} ] } ]   sequences, structures } ]
```

And the companion viewer, `remind-compare.js` — a SlicerLive bundle carrying the same `render/`
modules we work in — opens a case like this:

```js
const index = await loadIndex(PARAMS.get("index") ?? "remind-index.json");
const pid   = PARAMS.get("case")  ?? index.cases[0].pid;
// plus maxdim, maxvox, prefetch, rows
```

**The scene is an index plus a selection, expressed in a URL.** No scene file, no MRB, no imperative
construction; `rebuildScene(row)` re-derives when the selection changes. This is scene-as-query,
shipped and running, in the same codebase we are editing.

Five specific moves worth stealing outright:

1. **The index is versioned against its source.** `idc_version: "24.0"`, `generated`,
   `generated_by`. Staleness is *detectable* — the same discipline as the fingerprint inside our Zarr
   attributes, applied at collection level instead of per series.
2. **It is generated, never hand-maintained.** `build_index.py` regenerates it from IDC, so IDC stays
   authoritative and the index is derived. No second source of truth.
3. **Aggregates are precomputed.** `stats` and `timeline` are baked at build time, so the dashboard
   opens instantly — exactly the argument the provenance-lineage design makes for its own index.
4. **Semantics DICOM has nowhere to put go in the index, not back into the data.** The `tp` field on
   each series — `preop` / `intraop`, the surgical stage — is the whole point of the page, and DICOM
   has no tag for it. Additive, never mutating the original.
5. **Payload is a pointer.** `bk: "idc-open-data"` plus the UIDs; bytes come from S3 on demand. Keys
   are abbreviated to single letters, which is how 114 cases with ten series each fit in 370 KB.

## The convergence

| | Mike, OABrowser (2018) | Steve, ReMINDer (2026) | us, Zarr cache (yesterday) |
|---|---|---|---|
| authoritative source | atlas files | DICOM in IDC | the DICOM database |
| derived record | `atlasStructure.json`, JSON-LD | `remind-index.json` | the cache directory |
| staleness | — | `idc_version`, `generated` | fingerprint inside the Zarr attrs |
| payload | `DataSource`: URL + `mimeType` | UIDs + bucket | one dir per SeriesInstanceUID |
| a view is | a traversal of `member` edges | a URL selection over the index | `openSeries` |
| added semantics | `annotation` | `tp`, the surgical stage | provenance edges |

Three people arrived at the same architecture from three directions: **leave the archive untouched;
derive a small regenerable index that carries the semantics the archive cannot express; address
payload by pointer; make a view a selection rather than a construction.** That is a strong signal,
and it means the design question in this note is much narrower than it looked this morning.

It also retires the framing of §1 and §2. "DICOM or Zarr" was never the axis. DICOM is the archive in
Steve's design *and* the payload is fetched as DICOM from S3 — while the thing that makes the
collection legible is a 370 KB JSON file that is not DICOM at all and does not try to be.

## What none of the three has: editing

Mike's atlas is read-only. ReMINDer and remind-compare are read-only. Our Zarr cache is read-only.
And **Slicer exists to edit.** That is the entire gap.

So the design question is now singular, and it is the one Addendum 2 already identified as the crux:

> **In a model where a view is a query over derived records, where does an edit go?**

There is a candidate answer already in this tree, built for a narrower purpose: the
provenance/lineage design in `Slicer/DICOMProvenance` — append-only edges, each derived object naming
its immediate parent, `edit#1 → edit#2 → a colleague's validation`, with a precomputed index so
lineage renders instantly and nothing ever mutates an original. Generalize that from "SEG lineage" to
"any change to any record" and it *is* the editing story for scene-as-query: **an edit appends; a
view queries; nothing is overwritten.** Ron's "no orphans, no zombies" then holds by construction
rather than by discipline, because there is nothing to drift.

That is one question rather than four — but it has to be asked **separately**. Ron talks to Steve and
to Mike one at a time, so this note is background for him, not a document to send to either, and the
two eventual write-ups must each stand alone rather than reference the other conversation.

## Corrections to this note, for the record

Three of my own claims died in the course of writing it, all from looking at what exists:

- "DICOM's hierarchy cannot be extended, so BIDS has no home" — true of DICOM, false of Slicer
  (levels are strings in an attribute) and irrelevant in a record model.
- "Tet/hex meshes have no home" — true of DICOM, false of Slicer since `vtkMRMLModelNode` took a
  `vtkPointSet`, and a non-issue where payload is a MIME type.
- "SlicerLive is missing MRML" — wrong target. MRML is the thing developers want rearchitected.

---

# Addendum 4: exfield, and what IGT does to all of this

Ron asked about `mhalle/exfield` and added a domain the note had ignored: IGT, where OpenIGTLink
drives the scene from devices in real time.

## exfield: geometry as a field you evaluate, not a mesh you store

`mhalle/exfield` (alpha 0.5.3, August 2026) reads, evaluates and writes **OpenCMISS-Zinc EX/EXF
finite element scaffolds** with NumPy as its only runtime dependency. Its stated purpose: "Zinc
*makes* scaffolds; exfield lets downstream NumPy/VTK code consume them without inheriting a 63 MB
OpenGL-linked binary." Deliberately out of scope: fitting (`scaffoldfitter`), mesh generation
(`scaffoldmaker`), rendering, solvers, and time-varying fields.

The central verb is **evaluate**:

```python
ev = mesh.evaluator("coordinates", dimension=1)
x  = ev.evaluate(element_id=1155, xi=[0.37])     # world coordinates
dx = ev.evaluate_derivatives(1155, [0.37])       # d/dxi
```

A scaffold is not a triangle soup. It is a piecewise-polynomial field — tricubic Hermite serendipity
surfaces, `c.Hermite*l.Lagrange*l.Lagrange` volumes — that you sample wherever you want. Six
consequences matter to us.

**1. `(element, xi)` is an *anatomical* address, not a spatial one.** `EmbeddedPoints` and
`HostedPath` hold points and ordered paths anchored in a host scaffold's material coordinates —
"proxy structures (lymph chains) whose world geometry is **derived** by evaluating the host, never
fitted." Deform the scaffold and the annotation follows, because the annotation was never a
position. This is the geometric form of the same idea as scene-as-query: **store the address,
derive the coordinates.**

**2. The source/rendition split, engineered.** `export_vtu` writes **exact Bezier cells** by default
— `vtkBezierCurve` / `Quadrilateral` / `Hexahedron` carrying the exact Bernstein coefficients of the
geometry, verified to <1e-9 against VTK re-reading them. "No resolution parameter, no cracks."
`tessellate=N` drops to linear cells only "for consumers without higher-order support (some Slicer
filters, vtk.js)". So the triangulation is a **named, lossy fallback** and the exact form is the
default. This is the baffle argument from §4, already built, and better than my version: fields
sharing the geometry's basis ride along as their own Bernstein control values, so probing downstream
is exact rather than sampled.

**3. Correspondence identity is a fingerprint, and it is the same problem we hit.**
`make_fingerprint` records scaffold type, version and a hash of the discretisation options, because
`(element, xi)` "names the same anatomy only across models built with identical options — two option
changes on `3D Heart 1` silently destroyed correspondence for 64% of elements." Mismatch raises. And
the stated gap: **EX files carry no fingerprint**, so a loaded mesh has `fingerprint = None` and two
`None`s pass unchecked. That is exactly the staleness problem we solved by putting the fingerprint
*inside* the Zarr attributes so it cannot drift from what it describes — Mike hit the identical
problem in a different domain and lists the identical solution as unfinished.

**4. Metadata the format cannot hold is carried alongside.** `mesh.declared_unit` exists because "EX
files state units nowhere (dataset 426 is in µm; its template `sub-M000` is in mm — iterating the
folder naively yields a 0.6 mm nerve)". Structurally the same move as Steve's `tp` field: the
semantics the archive cannot express go in the record, not into the data.

**5. The API is deliberately shaped around silent-wrong-geometry.** "This is code where everything
runs and the geometry is quietly wrong." So: `mesh.coordinates` *raises* when ambiguous, because real
scaffolds carry `coordinates`, `straight coordinates` and `vagus coordinates`, all coordinate-type
and 3-component, and evaluating the material one yields dimensionless nonsense. `ArclengthTable.build`
refuses a branching mesh without explicit `element_ids`, because integrating the `left vagus nerve`
group "works" and returns thousands of mm by including circumferential rings — the trunk is 491.9 mm.
`find_location` returns a `boundary` flag and a `runner_up_residual`. `EmbeddedPoints.from_world`
*requires* `max_residual`, and `arclength()` hands back the NaN count beside the values because
`nanmean` drops off-chain points silently. And `order="zinc"` is documented as "a named
bug-compatibility mode", with the line **"agreement with Zinc is not the same as correctness."**

That last principle is worth adopting verbatim. It is precisely the discipline that would have caught
our own `check-vr.py` reporting a clean bill of health on an implicit-VR file.

**6. The validation bar, and the honesty about performance.** Golden-tested against Zinc 4.2.1 on a
real fitted human vagus scaffold: field values agree to <1e-15 relative at 1,476 sampled locations,
157 per-group integrals to <1e-13, and **a file written by exfield and re-read by Zinc evaluates
bit-identically at all 29,520 golden samples**. All 42 scaffolds of SPARC dataset 426 sweep. The
performance table publishes the losses as readily as the wins — parse 63 ms vs Zinc's 17,
`find_location` 244 ms vs 35 — while batched evaluation beats Zinc (4.2 ms vs 8.5 for 20,000
evaluations, since Zinc has no batch API at all). The module layout mirrors Zinc's C++ file by file,
"one method per production, names matching, so the two read side by side", which makes the port
auditable rather than merely tested.

### The concrete opportunity for SlicerLive

`export_vtu` names **vtk.js** among the consumers that need `tessellate=N` because they lack
higher-order support. SlicerLive is not vtk.js — it is our own WebGPU renderer, and evaluating a
tensor-product Bernstein basis is a handful of multiply-adds, entirely at home in a shader. **We
could render exact higher-order scaffold geometry directly, with no tessellation at all.** That is a
capability neither Slicer nor the browser ecosystem has, it is a small amount of shader work, and it
would be a sharp demonstration of what the WebGPU rewrite buys.

Also worth noting the ecosystem shape: `scaffoldmaker` generates, `scaffoldfitter` fits, `exfield`
reads/evaluates/writes. A baffle in that world is a fitted scaffold, and the "authoring state" §4
said had no home is `scaffoldfitter`'s output plus a fingerprint.

## IGT: the case that breaks read-only

Every instance of scene-as-query tabulated in Addendum 3 is **read-only**. IGT is not just
read-write; it is *continuous*. A tracked instrument, a robot, an OpenIGTLink stream at device rates,
bidirectional. If "a view is a query over records" cannot survive that, it is an atlas-browser
architecture and not a Slicer architecture.

I think it survives, on one distinction:

> **A stream is not an edit.**

A record says *"this model is driven by tracker channel X"* — appended once, static, queryable. The
60 Hz transforms are a **subscription**: ephemeral values flowing into a binding, never appended.
You append only when a human commits a state — *record this position*, *this is the target*, *this is
the registration I accepted*. That keeps the append-only story intact (a 60 Hz append rate would
destroy it in an hour) and it draws the line where clinical meaning actually is: the committed
states are the ones anybody will ever want to audit.

Two hard requirements this imposes, both real:

1. **The derived scene must be incrementally updatable.** Steve's `rebuildScene(row)` is a full
   re-derivation — correct for a click, fatal at device rates. A binding update has to touch one
   transform, not rebuild a scene. This is a genuine constraint on the architecture, not a detail.
2. **Latency becomes a correctness property, not a performance one.** In IGT a late transform is a
   wrong transform. Nothing in the read-only designs has any notion of this.

And one striking connection: **material coordinates are the right frame for IGT.** A tracked tip
expressed as `(element, xi)` in a patient scaffold answers *"where am I anatomically"* rather than
*"where am I in space"* — and stays meaningful under deformation, which is exactly the situation
during an operation. exfield's `find_location` is the inverse map that would do it, `EmbeddedPoints`
the container, and its `boundary` flag and `runner_up_residual` are precisely the ambiguity signals a
navigation system must not hide. It is slower than Zinc per query today (244 ms for 200 points), so
per-frame inverse mapping is not free — but `element_ids` restriction and batching are the stated
remedies.

Relevant and easy to miss: **`mhalle/openigtlink-ng` has a TypeScript codebase**, wire-compatible
with upstream and pitched as a drop-in replacement for libOpenIGTLink. So the IGT transport could run
*inside* SlicerLive rather than beside it.

## What Addendum 4 changes

The design has one open question, and it is now sharper than "where does an edit go":

> **Which changes are records and which are bindings?** Segmentation edits, registrations a human
> accepted, and derived results are records — append-only, queryable, auditable. Device streams,
> camera, window/level and the current time in a sequence are bindings — live, ephemeral, never
> appended. Getting an item on the wrong side of that line is what would sink this: bindings as
> records floods the store, records as bindings loses the clinical history.

That question can be put to either architect on its own, which matters, because it has to be asked
of each of them separately.

---

# Addendum 5: dimensions — the strongest argument in the whole note

Ron: *"dimensions are extremely important. People use slicer from microscopy to astrophysics."*

This is the point the note most underweighted. §3 rated DICOM "native, mature" for images, and
Addendum 4 mentioned units only as an exfield footnote. Both were too generous, and the reason is
that **units and axes are properties of the coordinate model itself**, not features layered on top —
so getting them wrong is not a gap to fill later, it is a thing to rebuild.

## What Slicer actually does: units for display, millimetres for storage

Slicer has a real units system. `vtkMRMLUnitNode` carries `Quantity`, `Prefix`, `Suffix`,
`Precision`, `DisplayCoefficient` and `DisplayOffset`, with `GetDisplayValueFromValue()` and its
inverse. Seven quantities are registered by default — length (mm), area (cm²), volume (cm³), time
(s), frequency (Hz), velocity (m/s), intensity (W/m²) — and length units run from Nanometer through
Meter.

But `vtkSlicerUnitsLogic.cxx:224` states the actual model in one line:

```cpp
// in Slicer, "length" quantity values are always expressed in millimeters.
```

Nanometer's `DisplayCoefficient` is `GetDisplayCoefficient("nano", "milli")` = 10⁶ — a **display**
conversion from stored millimetres. So the units system formats numbers; it does not carry them. The
data model is millimetres, hardcoded by convention.

Two tells that this leaks:

- **Every unit clamps its display range to ±10000.** A microscopist working in nanometres can
  therefore express ±10 µm. That is not a units system reaching microscopy; it is a millimetre
  system with a nanometre printf.
- **`velocity` in km/s and `intensity` in W/m² are in the default set.** Those are radio-astronomy
  conventions, not clinical ones — evidence that other domains did push on this, and that they got
  as far as the *display* layer and no further.

So "microscopy to astrophysics" works today in the sense that the numbers can be printed in the
right units, and does not work in the sense that the stored geometry is physically meaningless
outside a clinical scale.

## Why this matters more for SlicerLive than for Slicer

Slicer keeps geometry in `double`. **SlicerLive renders in WebGPU, which is `float32`** — a 24-bit
mantissa, about 7 decimal digits. And precision is governed by the *ratio* of the scene extent to
the smallest feature, not by absolute magnitude. A canonical unit is therefore exactly the wrong
instrument:

| domain | native scale | as millimetres |
|---|---|---|
| electron microscopy | 1 nm voxels | 0.000001 |
| light microscopy | 250 nm voxels | 0.00025 |
| clinical CT | 0.5 mm voxels | 0.5 |
| astrophysical cube | 1 parsec | 3.086 × 10¹⁹ |

None of these overflows `float32`. The damage is subtler: the moment a scene mixes scales — or a
mm-scale offset is added to a parsec-scale coordinate — the smaller term is annihilated in the
mantissa, silently, with plausible-looking geometry as the result. Which is precisely the failure
class exfield's API is designed to make unreachable.

We have also **already inherited the assumption**. About eighteen sites in `src/SlicerLive` bake it
in: `barHalfMm`, `marginMm`, `units: "mm"` returned literally from
`logic/markups/measurements.ts`, `volume mm^3` in `segmentation-editor.ts`, slice offsets in mm in
`slice-interactor.ts`. Faithful reproduction of the original. It is cheap to fix now because it is
mostly labels plus one or two conversions rather than a coordinate model; it stops being cheap the
moment anything depends on those numbers being millimetres.

## The design: store the quantity, render in a normalized frame

The conflation to break is between two different things a "canonical unit" provides:

- a canonical **representation**, so code need not convert at every site — genuinely valuable;
- a canonical **physical scale**, which bakes one domain into the model — the mistake.

Keep the first, drop the second:

1. **Every dataset declares its unit** — a scale to metres, held in `double`. This is not novel and
   costs nothing: NRRD has `space units`, NIfTI has `xyzt_units`, OME-NGFF has `axes[].unit`, and
   exfield had to add `declared_unit` precisely because EX files state units nowhere. **The formats
   already carry this; Slicer discards it on import.** Reading it is the whole of step 1.
2. **The renderer works in a scene-normalized frame**, chosen so the visible extent is O(1) in
   `float32`. Note this is not a tax — it is what a WebGPU renderer wants anyway for depth
   precision, so the physically correct design is also the numerically better one.
3. **Measurements and display are reconstructed in `double` on the CPU** from unit × transform
   chain, and carry their unit rather than assuming it. `measurements.ts` returning
   `units: "mm"` as a literal is the exact line to change.
4. **Cross-dataset alignment converts through metres in `double`**, never by assuming both sides are
   already millimetres.

This is the correct model, not an economical one: a physical quantity is a number *and* a unit, and
storing only the number is simply wrong. That it happens to cost a field on a dataset, a scale in
the camera and a variable where a literal sits today means there is no excuse for not doing it —
the small price is not the argument.

## The second reading: how many axes, and of what kind

"Dimensions" also means the *number and kind* of axes, and here the medical model is narrower still:

- **Microscopy**: x, y, z, channel, time, tile, well, scene — and channel is not a number line.
- **Astrophysics**: RA, Dec, frequency or velocity, Stokes parameter.

Both exceed three axes with **heterogeneous semantics**: an axis has a type (space, time, channel,
spectral, polarization) and a unit, not merely a length. DICOM's coordinate model is three spatial
axes plus frames-as-a-container, which is why multi-frame gets used as a bag — and note this is a
fair place to test Ron's own counter-point that multi-frame functional groups are a real model: for
*time* and for dMRI they plausibly are; for a well-plate or a Stokes axis there is nothing.

OME-NGFF solved this in the open, on Zarr: `axes: [{name, type, unit}]`. And duckn is Zarr-based
with imaging semantics in Zarr v3 attributes. So the axis-semantics problem has a standing answer in
exactly the direction we were already heading, which is worth knowing before designing our own.

## What this does to the rest of the note

It changes which argument is strongest. §4 reached for meshes and simulation to show where
DICOM-as-universal fails, and those are *missing IODs* — gaps that could in principle be filled.
**Dimensions are not a gap; they are the coordinate model.** `PixelSpacing` is defined in
millimetres. Microscopy DICOM (VL Whole Slide) therefore expresses a 250 nm pixel as 0.00025 mm,
which is legal and awkward; astrophysics has no DICOM representation at all and uses FITS with WCS,
a different and older standard that solved world coordinates properly decades ago.

So the honest summary is narrower than §1's and stronger:

> DICOM is the right archive **for clinical imaging at human scale**, which is what it was designed
> for and what IDC serves. The moment the domain moves — in scale or in the number and kind of axes
> — DICOM stops being a universal model and becomes one importer among several. That is not a
> criticism of DICOM; it is an argument against making it the coordinate model of an application
> intended to span microscopy to astrophysics.

---

# Addendum 6: RAS — where the coordinate convention came from, and what it costs

Ron pointed at Slicer's coordinate-system documentation. `Docs/user_guide/coordinate_systems.md`,
270 lines, and it is unusually candid.

## What the doc says

Three spaces: **world**, **anatomical** (patient), **image** (IJK). The transform between the last
two is a plain affine — a 3×3 carrying "all information about space directions and axis scaling",
plus a translation that is the position of voxel (0,0,0). **That math is entirely domain-neutral.**
Nothing in it is medical.

Two anatomical bases are in use, differing only in the sign of the first two axes: **LPS**
(Left-Posterior-Superior), used by DICOM and by ITK, and **RAS** (Right-Anterior-Superior). The doc
notes "both bases are equally useful and logical. It is just necessary to know to which basis an
image is referenced."

Then the part worth quoting in full:

> Both LPS and RAS were in wide use in the early 2000s when development of Slicer was started and
> Slicer developers chose to use the RAS coordinate system. Historically scans by GE equipment used
> RAS while Siemens and others used LPS. **Since several GE researchers were early contributors to
> Slicer, RAS was adopted for the internal representation.**

So Slicer's internal coordinate convention was set by **which vendor's researchers were in the
room**. This is documented honestly in Slicer's own user guide, and it is the purest available
example of Ron's "historically grown and too much ad hoc".

And the standing cost is stated just as plainly:

> Slicer still uses RAS coordinate system for storing coordinate values internally for all data
> types, but for compatibility with other software, it assumes that all data in files are stored in
> LPS coordinate system… **whenever Slicer reads or writes a file, it may need to flip the sign of
> the first two coordinate axes.**

DICOM is LPS. ITK is LPS. Slicer is the outlier, and pays a sign flip on **every reader and every
writer, permanently**, for a reason that expired around the time the scanners did.

## Two problems, one of which is much worse

**The flip is a tax.** Annoying, well-understood, cheap per call, and a permanent source of
orientation bugs — the flipped-SEG trap the colorize example documents is exactly this.

**The naming is a boundary.** R-A-S means *Right, Anterior, Superior*. There is no anterior in a cell
culture and no superior in a galaxy. So Slicer's internal frame is named for human anatomy, oriented
by a vendor accident, and measured in millimetres (Addendum 5). Each of those three is defensible for
clinical imaging; together they are a coordinate model that cannot describe the domains Slicer is
actually used in.

Slicer's own code shows the seam. `vtkMRMLVolumeArchetypeStorageNode.cxx` warns when saving VTK
because "VTK file format can only store LPS axis oriented images", and warns again for **TIFF** with
"non-LPS axes or non-zero origin" — TIFF being the microscopy format. The mismatch is not
theoretical; it is already producing warnings in the reader.

## The general case is already solved — twice, and one is in Slicer's own references

**NRRD** has a `space` field whose legal values include the anatomical ones
(`right-anterior-superior`, `left-posterior-superior`) *and* non-anatomical ones such as
`3D-right-handed` and `scanner-xyz`, alongside `space units` per axis. A NRRD can therefore say "these
axes are spatial, right-handed, in micrometres, and mean nothing anatomically" — exactly what
microscopy needs.

**FITS WCS** gives each axis its own type and unit: `CTYPE1 = 'RA---SIN'`, `CTYPE2 = 'DEC--SIN'`,
`CTYPE3 = 'VELO-LSR'`, with `CUNIT`. Astronomy solved per-axis semantics decades ago.

Slicer's coordinate doc cites the NRRD specification and `nrrd-iomf.pdf` in its own reference list —
and then normalizes everything it reads into RAS and millimetres. The information needed to do
better arrives in the file and is discarded at the door.

An open question I have *not* verified, worth checking before relying on it: Slicer "assumes that
all data in files are stored in LPS coordinate system (unless the coordinate system in the file is
explicitly stated to be RAS)". A NRRD declaring `3D-right-handed` is neither LPS nor RAS. Does it
get flipped as though it were LPS? If so, non-anatomical NRRDs are silently mis-oriented, which
would be a real bug rather than a design limitation.

## Our exposure, honestly

Unlike units, **this one is not cheap.** `RAS` appears in **162 files** in `src/SlicerLive` —
`slice-renderer.ts` alone 46 times, `live-views.ts` 37, `mat4.ts` 18 — and we inherited the import
flip too (`lps2ras` in both `dicom-series.ts` and `dicom-seg.ts`). Compare the millimetre assumption
at roughly eighteen label sites. Anyone claiming this is a small change has not counted.

That count is the honest cost, and it is not a reason to skip the work. Almost all of the 162 is
*naming*, and the naming sits on top of maths that is already general.
`ijkToRAS` is an ordinary affine IJK→world matrix; it does nothing anatomical. The anatomy actually
lives in four places:

1. the **name** — cosmetic, but it teaches every reader the wrong thing;
2. the **two import flip sites** — real, and the only places a convention is actually applied;
3. the **axis labels in the view** (the `R A S L P I` orientation marker) — presentation;
4. any code that **assumes handedness or axis order** rather than reading it from the matrix — the
   one category that needs auditing rather than renaming.

So the correct fix is well-bounded, though not small:

> Keep the matrix and call it `ijkToWorld`. Add a per-dataset **frame declaration** — for each axis a
> name, a type (spatial / temporal / spectral / channel), a unit, and a direction meaning — and let
> **RAS be one declared value rather than an invisible default.** Anatomical data declares RAS;
> microscopy declares right-handed micrometres; a cube declares RA/Dec/velocity.

That is one record per dataset, honest labels, and an audit of category 4 — against 162 files whose
names change. The renderer does not change. **The cost is real and should be stated as work rather
than discounted**; what makes it worth doing is that a coordinate frame you cannot name is a
coordinate frame you cannot verify. And the reason to keep RAS as the *default* becomes a stated one
— interoperability with 3D Slicer — rather than an accident inherited from a scanner vendor that
stopped mattering twenty years ago.

Which is the right way round for a project whose entire purpose is to find out what Slicer should
become.

---

# Addendum 7: NIfTI is the worst of the four at coordinates

Ron: *"Nifty is lame, when you talk coordinates."* Checked against the actual header,
`nifti1.h` in the ITK tree, not from memory. He is right, and it is worse than "lame" — NIfTI is
**ambiguous by design**, which is a different and more serious fault than being narrow.

## Three methods, in the spec's own words

| | when | how |
|---|---|---|
| **Method 1** | `qform_code = 0` | ANALYZE 7.5: `x = pixdim[1] * i`. **No orientation at all.** |
| **Method 2** | `qform_code > 0` | a unit **quaternion** plus `pixdim[]` scales plus a shift |
| **Method 3** | `sform_code > 0` | a general affine, `srow_x/y/z` |

Both `qform_code` and `sform_code` can be nonzero **at the same time**, carrying two different
transforms, with no normative rule for which wins. Convention says prefer the sform. Convention is
not a specification. **This is two sources of truth inside a single file header** — the exact fault
the rest of this note has been trying to design out of a whole architecture, shipped inside one
format.

## Method 2 cannot represent the transforms that occur

The quaternion is required to be a unit quaternion with `a = sqrt(1 - (b²+c²+d²))` **nonnegative**.
So it is a pure rotation, determinant +1. Therefore:

- **no shear** — so an affine with shear cannot be written as a qform at all;
- **no reflection** — and since left-handed data exists, the format needs an escape hatch, which is
  `pixdim[0]` used as `qfac`, an out-of-band ±1. A field whose documented meaning is *grid spacing*
  carries **handedness**. `nifti1.h` says so directly: "cf. ORIENTATION section below for use of
  pixdim[0]". And a great many real files leave `pixdim[0]` at 0, where the reader must guess 1.

## The affine is float32

Straight from the header:

```c
float quatern_b, quatern_c, quatern_d;
float qoffset_x, qoffset_y, qoffset_z;
float srow_x[4], srow_y[4], srow_z[4];
```

**The world transform itself has ~7 significant digits.** This is Addendum 5's precision problem
frozen into a file format: a dataset with fine spacing and a large extent loses accuracy in the
mapping, not merely in the rendering, and no amount of care downstream recovers it. NIfTI-2 widened
these to `double` — which is an admission that it was wrong, and NIfTI-1 is what everything writes.

## Units: one byte, six values, shared across all axes

```c
char xyzt_units;   /* Units of pixdim[1..4] */
```

```
NIFTI_UNITS_METER 1   NIFTI_UNITS_MM 2   NIFTI_UNITS_MICRON 3
NIFTI_UNITS_SEC   8   NIFTI_UNITS_MSEC 16  NIFTI_UNITS_USEC 24
```

That is the entire vocabulary. So:

- **no nanometres.** Electron microscopy at 1 nm must be written as `0.001` microns — into a
  `float32` spacing, in a format whose affine is also `float32`.
- **no parsecs, no arcseconds, no Hertz-as-an-axis.** Astronomy is not expressible.
- **one spatial unit for all three spatial axes**, since a single byte covers `pixdim[1..4]`. Per-axis
  units are impossible.

## The frame vocabulary is five values, four of them brain atlases

```
NIFTI_XFORM_UNKNOWN 0   SCANNER_ANAT 1   ALIGNED_ANAT 2   TALAIRACH 3   MNI_152 4
```

Not extensible. And **NIfTI mandates RAS+** — `+x` = Right, `+y` = Anterior, `+z` = Superior. There is
no way to declare that the axes are not anatomical. So for anything outside neuroimaging NIfTI is
strictly worse than NRRD: NRRD *defaults* to anatomy and lets you say otherwise; NIfTI *requires*
anatomy.

Axis semantics are likewise fixed by position — `dim[1..3]` spatial, `dim[4]` time, `dim[5..7]`
overloaded through `intent_code`. Axes cannot be named or typed.

## The ranking, for coordinates specifically

| | frames | per-axis units | axis semantics | precision | ambiguity |
|---|---|---|---|---|---|
| **FITS WCS** | arbitrary, with projections | `CUNIT` per axis | `CTYPE` per axis | double | one method |
| **NRRD** | `space`, incl. `3D-right-handed`, `scanner-xyz` | `space units` per axis | per-axis `kinds` | decimal text | one method |
| **DICOM** | LPS only | mm only | 3 spatial + frames | decimal string | one method |
| **NIfTI-1** | 5 codes, RAS+ mandated | one byte, 6 values, shared | fixed by position | **float32** | **three methods, two can disagree** |

**DICOM comes out ahead of NIfTI here**, which is worth stating plainly because it is the opposite
of the usual folklore. DICOM's coordinate model is *narrow* — millimetres, LPS, three spatial axes —
but it is unambiguous, single-method, and stored as arbitrary-precision decimal strings. NIfTI is
broader in ambition and ambiguous in practice, and ambiguity is the worse failure: a narrow model
tells you honestly that your data does not fit, while an ambiguous one loads and is quietly wrong.

Note also where NRRD lands: **best of the general-purpose formats**, from the teem/Slicer world, and
`vtkMRMLVolumeArchetypeStorageNode.cxx:66` sets `DefaultWriteFileExtension = "nrrd"` — so **Slicer
already writes, by default, the format with the best coordinate model available to it**, and then
discards on import most of what that format can express.

## What we do, and what we should do

Our writer, `logic/writers/nifti.ts`, already makes the one correct choice available: it sets
`qform_code = 0` and `sform_code = 1` and writes the `srow` rows from `ijkToRAS`. Emitting **only**
the sform means we never produce a file with two disagreeing transforms. That should be stated as a
deliberate invariant in the file, not left as an implementation detail — a future edit that "adds
qform support for compatibility" would be a regression.

What we inherit and cannot fix from inside NIfTI is the `float32` affine and the six-unit vocabulary.
The conclusion is not to improve our NIfTI support. It is that **NIfTI is an interchange format and
must never be a representation** — which is the same conclusion Addendum 3 reached about DICOM SEG,
arrived at from the opposite direction. Where a coordinate model has to be *right*, the candidates
are NRRD, FITS WCS, and OME-NGFF-style typed axes on Zarr. NIfTI is something we read because people
send it and write because people ask for it.
