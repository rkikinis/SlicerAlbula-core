# Records — design sketch, before the code

**Draft for Ron to shred, 2026-09-03.** `frame.ts` is built. Records are next, because a frame hangs
off a dataset and is decorative until there is something to hang it on.

Derived from the four things actually on the table, not from imagination: a **dataset** (the cropped
CT, series 301), a **group** (the abdominal organs; a case's pre-op study), a **derivation** (this SEG
came from that CT, by nnInteractive, on a date, by a person), and a **note** (needs review).

## The shape

```ts
/** Content hash where the bytes are fixed, random otherwise. NEVER sequential — see below. */
type Id = string;

interface Dataset  { type: "dataset";    id: Id; payload: Payload; frame?: Frame; dims?: number[]; semantics?: Semantics }
interface Group    { type: "group";      id: Id; members: Id[];    semantics?: Semantics }
interface Derivation { type: "derivation"; id: Id; parent: Id; produced: Id; how: Method; by: string; at: string }
interface Note     { type: "note";       id: Id; about: Id; category: string; text?: string }

type Record = Dataset | Group | Derivation | Note;

interface Payload   { locator: string; mediaType: string; sourceFingerprint?: string }
interface Semantics { label?: string; codes?: Code[] }
```

Four types. Not three, because provenance needs its own (below); not five, because nothing on the
table needs a fifth yet.

## The seven decisions, and why

**1. Ids are never sequential.** A hole in a sequence is a trace, so an append-only log with monotonic
ids cannot expunge an entry without announcing that something was there. Content hash where content
is fixed, random where it is not. This constraint comes directly out of the deletion work, which is
the argument that the deletion work was not a detour.

**2. A discriminated union, not one record with optional fields.** With `type` discriminating, the
compiler enforces that a derivation has a parent and a group has members. One record type with
everything optional means *nothing* is required and every consumer guesses. "Refuse to guess" applies
to the schema before it applies to the code.

**3. Edges live on whichever record knows them at write time.** `Group.members` points down;
`Derivation.parent` points up. Deliberately not both directions — two directions is two sources of
truth about one relationship, and they drift. The writer of a derivation knows its parent; the writer
of a group knows its members. Nobody has to maintain a back-reference.

**4. `Derivation` is a record, not a field on the thing it produced.** This is the load-bearing
choice. As a field, provenance and editing would be two mechanisms. As a record, **an edit is an
appended derivation** — so edit #1 → edit #2, a colleague's validation branching from either, an
algorithm run, and the lineage graph are all the same shape, and `DICOMProvenance`'s edge table
becomes a query rather than a second store. Principle 6 and principle 4 collapse into one thing.

**5. Bindings are absent by construction.** There is no `camera`, no `window/level`, no `time`, no
`tracker` type, because those are **bindings** and never enter the store (principle 7). A record can
say *this dataset is driven by channel X* — a payload whose locator is a stream — while the 60 Hz
values flow outside it. A store that admitted them would be destroyed within the hour.

**6. No display type.** Presentation belongs to the view, not the record. Mike's atlas puts
`renderOption` on the record, which is right for an atlas with one canonical look and wrong the
moment two layouts want different colours for the same structure. So: a query's output, or its own
record type later, but not a field here.

**7. `sourceFingerprint` sits inside the payload of a derived thing** (principle 5). It is what lets
staleness be detected without a ledger, and — unplanned — what lets a deletion find every derivative
of a purged source by scanning rather than by bookkeeping.

## Deliberately absent

No version field (append-only means a new record, not a version number). No `deleted` flag (expunge
forbids tombstones in the primary store). No schema registry or plugin mechanism — a `type` string and
a `mediaType` string *are* the extension mechanism, which is the whole claim against MRML's
class-per-kind.

## What records force us to answer next

They do not settle the change-propagation question, but they are what it operates over. Once records
exist, the fork becomes unavoidable and concrete: **does a query return a value or a live view?** That
is the largest gap in the proposal and the next thing after this.

## The work

One module, `model/records.ts`, shaped like `frame.ts`: types, a validator that throws rather than
guesses, doc comments so `deno doc --lint` gates them. Tests on the four real cases — the
301 → 302 derivation chain, a group, a note, and the CT-plus-microscopy pair from `frame.test.ts` —
plus the refusals: an unknown `type`, a derivation with no parent, a `Group` member id that resolves
to nothing, a sequential-looking id.
