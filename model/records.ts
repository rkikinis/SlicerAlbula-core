/**
 * Records: the whole data model, as four kinds of index card.
 *
 * The prose version is in `RECORDS.md`, including a plain-language explanation and the argument about
 * granularity. The short form: the archive is not rearranged to make a view. Records describe what is
 * in it, a view is a *selection* over records, and a change appends a record rather than overwriting
 * one — so history, provenance and editing are one mechanism instead of three.
 *
 * Four types, because the four things actually on the table need four: a **dataset** (a scan), a
 * **group** (things that belong together), a **derivation** (this came from that, by this means), and
 * a **note** (a comment). Not one flexible type with optional fields — then nothing is required and
 * every reader guesses, which is the failure this model exists to prevent.
 *
 * Deliberately absent: any display or appearance type (that belongs to the view, not the record, and
 * putting a colour on a record stops working the moment two layouts want different colours for one
 * structure); any version field (appending is the versioning); any deletion marker (see `Id`); and
 * any registry or plugin mechanism, because a `type` string and a `mediaType` string *are* the
 * extension mechanism.
 *
 * Also absent, and this is load-bearing: nothing for camera, window/level, current time, or a device
 * stream. Those are **bindings** — live values that never enter the store. A record may say that a
 * dataset is driven by a stream; the values flow past it. A store that admitted sixty values a second
 * would be destroyed within the hour.
 *
 * @module
 */
import type { Frame } from "./frame.ts";

// Re-exported so a consumer importing only this module can name the type of `Dataset.frame`. Without
// it, `frame` is a field whose type cannot be written down by anyone using the model, which
// `deno doc --lint` correctly calls a defect rather than a style question.
export type { Axis, AxisKind, Dimension, Frame, Origin } from "./frame.ts";

/**
 * A record's identity: `sha256:<64 hex>` for content that is fixed, or `rnd:<32 hex>` for content
 * that is not.
 *
 * **Never sequential.** A hole in a numbered sequence is itself evidence that something was removed,
 * which defeats deleting data that arrived by accident — the requirement is that after a delete
 * nothing implies a presence. Content addressing has a second payoff: the same bytes ingested twice
 * are one record rather than two, which is the identity problem NRRD and NIfTI cannot solve for
 * themselves because neither carries an instance UID.
 */
export type Id = string;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const RANDOM = /^rnd:[0-9a-f]{32}$/;

/** Is this a well-formed id? @see {@linkcode Id} */
export function isId(s: string): boolean {
  return SHA256.test(s) || RANDOM.test(s);
}

/** A fresh random id, for a record whose content is not fixed. */
export function randomId(): Id {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "rnd:" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The content id of some bytes: `sha256:<hex>`. Ingesting the same bytes twice yields one record. */
export async function contentId(bytes: BufferSource): Promise<Id> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "sha256:" + [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Where the bytes are and what they are.
 *
 * `mediaType` is the *entire* format story — nothing else in the model knows or cares whether
 * something is DICOM, Zarr, NRRD, NIfTI or a `.vtu` mesh. Adding support for a format adds a media
 * type, not a class. That is the whole claim against a storage-class hierarchy.
 */
export interface Payload {
  /** A URL, or a path relative to the store. Resolution is the caller's business, not the model's. */
  locator: string;
  /** For example `application/dicom`, `application/zarr`, `model/vtu`, `image/tiff`. */
  mediaType: string;
  /**
   * For a *derived* payload, the id of what it was derived from, stored **inside the derived thing**
   * so the two cannot drift apart. It is what lets staleness be detected without a ledger, and — an
   * unplanned benefit — what lets a delete find every derivative of a removed source by scanning.
   */
  sourceFingerprint?: Id;
}

/** A coded concept, reusing an existing vocabulary rather than inventing one. */
export interface Code {
  /** Coding scheme designator: `SCT`, `FMA`, `TA98`, `DCM`, or `99`-prefixed for a private scheme. */
  scheme: string;
  /** The code itself, e.g. `10200004` for liver in SNOMED CT. */
  value: string;
  /** The scheme's own text for that code. Carried so a reader need not resolve the scheme. */
  meaning: string;
}

/** What a record *means*, as distinct from what it is or where its bytes are. */
export interface Semantics {
  /** Human-readable name. Display only — never matched against. */
  label?: string;
  /** Coded concepts, which are what can actually be queried across a collection. */
  codes?: Code[];
}

/**
 * How something was produced, in enough detail to reproduce it.
 *
 * `op` plus `params` is the reproducibility contract: together they must fully determine the output.
 * That is also what sets the granularity of a record — one card per operation whose parameters
 * determine its result, which for an editor means one per effect application and one per brush
 * gesture, not one per sample.
 *
 * `reason` is the only field a person is ever asked for, and it is optional on purpose. A mandatory
 * reason field does not produce information, it produces compliance — and junk is worse than an
 * empty field, because empty is honestly empty while junk gets counted and shown to someone as
 * though it meant something.
 */
export interface Method {
  /** `applyMargin`, `nnInteractive`, `threshold`, `crop`. */
  op: string;
  /** Tool version, where the tool has one. Absent for a plain human action. */
  version?: string;
  /** Everything that, with `op`, determines the output. */
  params?: Record<string, unknown>;
  /** Why it mattered. Asked rarely, never required. */
  reason?: string;
}

/** A thing with bytes: a scan, a segmentation, a mesh, a simulation result. */
export interface Dataset {
  /** Discriminant. */
  type: "dataset";
  /** Content id of the payload where the bytes are fixed. @see {@linkcode Id} */
  id: Id;
  /** Where the bytes are and what they are. */
  payload: Payload;
  /** Declared coordinates. Absent only for data that is not an array on a grid. */
  frame?: Frame;
  /** Sample counts, in the same order as `frame.axes`. */
  dims?: number[];
  /** What it means. */
  semantics?: Semantics;
}

/**
 * Things that belong together.
 *
 * Membership is an **edge**, which is why a dataset can be in many groups at once and many
 * hierarchies can coexist over one set of data. A single tree — as in a subject hierarchy — cannot
 * express a well plate, a BIDS dataset and an anatomical grouping of the same images simultaneously.
 */
export interface Group {
  /** Discriminant. */
  type: "group";
  /** Random id: a grouping has no fixed content of its own. @see {@linkcode Id} */
  id: Id;
  /** Ids of the members. An edge list, so membership is many-to-many. */
  members: Id[];
  /** What the grouping means. */
  semantics?: Semantics;
}

/**
 * This came from that.
 *
 * A record rather than a field on the thing it produced, and that is the load-bearing choice in the
 * whole model. As a field, provenance and editing would be two mechanisms. As a record, **an edit is
 * an appended derivation** — so an edit chain, a colleague's validation branching from any point, an
 * algorithm run, and the lineage graph are all the same shape, and there is no second store to keep
 * in step.
 */
export interface Derivation {
  /** Discriminant. */
  type: "derivation";
  /** Random id: this record is an event, not content. @see {@linkcode Id} */
  id: Id;
  /** The immediate parent, which may itself be derived. Lineage is walked, not flattened. */
  parent: Id;
  /** The record this derivation created. */
  produced: Id;
  /** Enough to reproduce it. @see {@linkcode Method} */
  how: Method;
  /** Author. A local identity, so a colleague's work attributes correctly without re-typing. */
  by: string;
  /** ISO 8601. */
  at: string;
}

/** A comment on something — the semantics an archive has nowhere to put. */
export interface Note {
  /** Discriminant. */
  type: "note";
  /** Random id. @see {@linkcode Id} */
  id: Id;
  /** The record being commented on. */
  about: Id;
  /**
   * One of a short fixed list. Free text is only legal behind `other`, because a category you can
   * count is worth more than a sentence you cannot.
   */
  category: NoteCategory;
  /** Required when `category` is `other`, refused otherwise. */
  text?: string;
}

/** The fixed note vocabulary. Short on purpose; `other` is the escape hatch. */
export type NoteCategory =
  | "needs-review"
  | "good-quality"
  | "poor-quality"
  | "interesting-finding"
  | "candidate-for-segmentation"
  | "excluded"
  | "other";

const NOTE_CATEGORIES: readonly NoteCategory[] = [
  "needs-review", "good-quality", "poor-quality", "interesting-finding",
  "candidate-for-segmentation", "excluded", "other",
];

/** Any record. Discriminated on `type`, so the compiler enforces what each kind requires. */
export type Record_ = Dataset | Group | Derivation | Note;

/**
 * Check one record, throwing on anything that would otherwise pass silently.
 *
 * Every check here is a failure that looks like success: a sequential id that would leave a hole when
 * deleted, a derivation that claims to be its own parent, a frame whose axis count disagrees with the
 * data's shape, a free-text note filed under a countable category.
 *
 * @throws on any of the above.
 */
export function validate(r: Record_): void {
  if (!isId(r.id)) {
    throw new Error(`id "${r.id}" is not content-addressed or random — see Id, ids must not be sequential`);
  }
  switch (r.type) {
    case "dataset": {
      if (!r.payload?.locator) throw new Error(`dataset ${r.id}: payload.locator is required`);
      if (!r.payload.mediaType) throw new Error(`dataset ${r.id}: payload.mediaType is required`);
      if (r.payload.sourceFingerprint && !isId(r.payload.sourceFingerprint)) {
        throw new Error(`dataset ${r.id}: sourceFingerprint is not an id`);
      }
      // A frame describes axes; dims counts samples along them. Disagreement means one of the two is
      // about different data, which is silent, geometric, and very hard to find later.
      if (r.frame && r.dims && r.frame.axes.length !== r.dims.length) {
        throw new Error(
          `dataset ${r.id}: frame has ${r.frame.axes.length} axes but dims has ${r.dims.length}`,
        );
      }
      return;
    }
    case "group": {
      for (const m of r.members) {
        if (!isId(m)) throw new Error(`group ${r.id}: member "${m}" is not an id`);
      }
      if (new Set(r.members).size !== r.members.length) {
        throw new Error(`group ${r.id}: duplicate members`);
      }
      return;
    }
    case "derivation": {
      if (!isId(r.parent)) throw new Error(`derivation ${r.id}: parent "${r.parent}" is not an id`);
      if (!isId(r.produced)) throw new Error(`derivation ${r.id}: produced "${r.produced}" is not an id`);
      if (r.parent === r.produced) throw new Error(`derivation ${r.id}: parent and produced are the same record`);
      if (!r.how?.op) throw new Error(`derivation ${r.id}: how.op is required — an unnamed operation cannot be reproduced`);
      if (!r.by) throw new Error(`derivation ${r.id}: by is required`);
      if (!r.at || Number.isNaN(Date.parse(r.at))) throw new Error(`derivation ${r.id}: at must be an ISO timestamp`);
      return;
    }
    case "note": {
      if (!isId(r.about)) throw new Error(`note ${r.id}: about "${r.about}" is not an id`);
      if (!NOTE_CATEGORIES.includes(r.category)) throw new Error(`note ${r.id}: unknown category "${r.category}"`);
      if (r.category === "other" && !r.text) throw new Error(`note ${r.id}: category "other" requires text`);
      if (r.category !== "other" && r.text) {
        throw new Error(`note ${r.id}: text is only allowed with category "other" — "${r.category}" is meant to be counted`);
      }
      return;
    }
    default: {
      // Reached only if a type is added without extending this switch, which the compiler will also
      // flag through the `never` assignment.
      const bad: never = r;
      throw new Error(`unknown record type: ${JSON.stringify(bad)}`);
    }
  }
}

/**
 * Check a whole set of records, including that every reference resolves.
 *
 * Referential integrity cannot be checked one record at a time, and it is the same invariant the
 * DICOM audit tool enforces on the archive: nothing may point at what is not there. After a delete,
 * this must still pass — which is what makes "the delete was complete" a test rather than a hope.
 *
 * @throws on the first problem, naming it.
 */
export function validateAll(records: readonly Record_[]): void {
  const byId = new Map<Id, Record_>();
  for (const r of records) {
    validate(r);
    if (byId.has(r.id)) throw new Error(`duplicate record id ${r.id}`);
    byId.set(r.id, r);
  }
  const need = (from: Record_, ref: Id, field: string) => {
    if (!byId.has(ref)) throw new Error(`${from.type} ${from.id}: ${field} points at ${ref}, which is not here`);
  };
  for (const r of records) {
    if (r.type === "group") for (const m of r.members) need(r, m, "member");
    if (r.type === "derivation") { need(r, r.parent, "parent"); need(r, r.produced, "produced"); }
    if (r.type === "note") need(r, r.about, "about");
    if (r.type === "dataset" && r.payload.sourceFingerprint) {
      need(r, r.payload.sourceFingerprint, "payload.sourceFingerprint");
    }
  }
}

/**
 * Walk a record's ancestry, nearest parent first.
 *
 * Lineage is derived by following `Derivation.parent` rather than stored, so it cannot disagree with
 * the records it summarises. Cycles are refused rather than followed — a cycle means the store is
 * corrupt, and returning a truncated chain would hide that.
 *
 * @throws if the derivation graph contains a cycle.
 */
export function ancestry(records: readonly Record_[], of: Id): Id[] {
  const parentOf = new Map<Id, Id>();
  for (const r of records) if (r.type === "derivation") parentOf.set(r.produced, r.parent);
  const chain: Id[] = [];
  const seen = new Set<Id>([of]);
  let cur = parentOf.get(of);
  while (cur !== undefined) {
    if (seen.has(cur)) throw new Error(`derivation cycle at ${cur}`);
    seen.add(cur);
    chain.push(cur);
    cur = parentOf.get(cur);
  }
  return chain;
}
