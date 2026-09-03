# Records — design sketch, before the code

**Draft for Ron to shred, 2026-09-03.** `frame.ts` is built. Records are next, because a frame hangs
off a dataset and is decorative until there is something to hang it on.

Derived from the four things actually on the table, not from imagination: a **dataset** (the cropped
CT, series 301), a **group** (the abdominal organs; a case's pre-op study), a **derivation** (this SEG
came from that CT, by nnInteractive, on a date, by a person), and a **note** (needs review).

## In plain language, before the code

Think of a **library card catalogue**. The books are on the shelves — that is the DICOM data, sitting
where it sits, untouched. The cards describe the books. **You never rearrange the library to make a
reading list; you pull cards.**

A "scene" here is a reading list. It is not a thing you build and then have to save. It is *whatever
cards you pulled*.

There are four kinds of card:

1. **"Here is a thing."** A scan. The card says what it is, where the bytes live, what units and
   orientation it uses, and what it means. Series 301, the cropped CT, gets one of these.
2. **"These belong together."** A card holding a list of other cards. The abdominal organs. A case's
   pre-op study.
3. **"This came from that."** A card saying: *I made B out of A, using nnInteractive, on 16 July, and
   it was me.* The chain 3 → 301 → 302 is two of these.
4. **"A comment about this."** Needs review. Good quality. Excluded from the study.

**The one idea that matters is card 3.** Today, when you edit a segmentation, the segmentation
changes and the old one is gone. Here, editing *writes a new card* — the original is untouched and
the new card points back at it. Which means:

- **Editing and history become the same thing.** There is no separate undo machinery to build and get
  wrong. The history *is* the cards.
- **A colleague reviewing your work adds a card pointing at yours.** Yours does not move. Two people
  can branch from the same point without fighting.
- **How you got somewhere is readable**, because it is just the pile of cards, in order.

Three smaller points, plainly:

- **Cards are not numbered 1, 2, 3.** If they were, and you destroyed card 4173, the gap would tell
  anyone that a card had been there. For data that arrived by accident, the gap *is* the trace. So
  cards get labels that imply no order — a fingerprint of their own contents, or a random label.
  Then removing one leaves nothing behind. That requirement came out of the deletion work, not out
  of theory.
- **Four specific kinds of card, not one card with lots of blank lines.** If there were one flexible
  card, nothing would ever be *required*, and every program reading one would have to guess what was
  filled in. With four kinds, a "this came from that" card cannot be completed without saying what it
  came from. The form will not let you.
- **Some things never get a card.** Where the camera is pointing, the brightness slider, where the
  surgical tracker is at this instant. Those change constantly and filing them would produce sixty
  cards a second. So a card may say *this model follows the tracker*, and the tracker's position
  simply streams past, never filed.

## Granularity — how big is one card

Ron's challenge, and it is the right one: *too many cards and the user is overwhelmed; too few and we
miss important information. It should be automated as much as possible.*

**The tension dissolves once you notice it is two questions, not one:**

| | question | what it costs |
|---|---|---|
| **fidelity** | what gets *recorded* | storage, and deletion surface |
| **legibility** | what gets *shown* | attention |

Treated as one decision, every answer is wrong for one half. Treated separately: **record at the
granularity of the smallest reproducible action; display at the granularity of intent.** Storage is
cheap and attention is not, and a wrong display choice is recoverable while unrecorded information is
gone — that asymmetry argues for recording finer than you show.

### The recording boundary is already defined, by the editor

The natural unit is not invented, it is sitting in `logic/segment-effects.ts`: `applyThreshold`,
`applyAutoThreshold`, `applyIslands`, `applySmoothing`, `applyMargin`, `applyLogical`. Each is a
named operation whose parameters **fully determine its output**, which is exactly the property that
makes a card worth having: it is describable ("grow 2 mm"), reproducible, and replayable.

Finer than that is worse, not better. One card per brush sample is not a record of a decision, it is
a **behavioural log of a person working** — and note that this is data about the *clinician*, not the
patient, which is a privacy question almost nobody asks. So a continuous paint gesture is one card,
from mouse-down to mouse-up: the unit of intent, not of sampling.

Coarser than that is also worse: one card per save loses which effects were applied, and with it the
ability to branch from the middle.

### What automates, and what cannot

- **Fully automatic: everything about *how*.** Tool, version, parameters, timestamp, author, parent.
  Zero prompts, ever. An algorithm run should need no manual input at all.
- **Cannot be automated: *why it mattered*.** "This is the one for the tumour board." "The model
  over-segmented the adrenal." That is judgment, and it is precisely the information lost if nobody
  is ever asked.

So the division of labour is: **the machine records what happened; the person occasionally says why
it mattered** — and that contribution must be *rare and optional*.

A mandatory field does not produce information, it produces compliance. Demand a reason on every edit
and you get "correction", "fix", "test", "." and whatever the fingers land on — which is **worse than
an empty field**, because empty is honestly empty while junk looks like data and will be counted,
searched and shown to someone as though it meant something. A note somebody chose to write is worth
reading; a note somebody was forced to write is noise in the costume of a record.

### Significance can be inferred, so nobody has to tag it

Display collapses by default and expands on request — `git log` against `git log -p`. The question is
which cards are milestones, and the answer is that **importance shows up as a fact about the graph**,
not as a label somebody had to remember to apply:

- a card that was **exported** (something left the system)
- a card **someone else branched from**
- a card the user **named**
- a card where the **tool or author changed**
- the **last** card of a session

None of those needs a prompt. All of them are structural.

### Compaction, which bounds the growth

Fine cards during a session, and then — once a session closes and a result is accepted — **collapse
the intermediate cards into one derivation carrying the accepted result.** Squashing a branch on
merge, in effect.

This is the part that answers the cost side rather than the legibility side. It bounds store growth,
it removes the stroke-by-stroke record of a person working, and it shrinks the surface a future
expunge has to reach — while keeping the lineage that has meaning. What it gives up is mid-session
archaeology, permanently, which is a real loss and should be a **choice with a stated default**
rather than something that silently happens.

### The honest residue

There is no way to know at write time what will matter later. Recording at the reproducible-action
level and inferring significance afterwards is the best available answer, not a complete one, and the
display heuristics above will sometimes be wrong. They are also cheap to change, which is the reason
to put the guessing there rather than in the schema.

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
