/**
 * The session: appending a change, and removing one.
 *
 * This is where the model's central claim gets tested rather than asserted. Everything else in the
 * architecture is defensible on paper; **"an edit appends a record instead of overwriting one" is the
 * part nobody has shipped.** Mike Halle's Open Anatomy atlas, Steve Pieper's ReMINDer and our own
 * Zarr working copies are all read-only, and 3D Slicer exists to edit.
 *
 * Two operations, and they are not symmetric.
 *
 * **Deriving appends.** Applying an operation to a parent produces a new dataset and a derivation
 * record naming both. The parent is never touched, so an edit chain, a colleague's validation
 * branching from any point, and an algorithm run are one shape — and lineage, undo-of-an-edit and
 * provenance stop being three mechanisms.
 *
 * **Removing is destructive, and is the one operation that is.** Append-only governs *derivation*,
 * not deletion: a delete that appended a marker would leave a tombstone, and a tombstone is a trace.
 * So the model has exactly one delete, with a temporary undo, which is how Slicer's Segment Editor
 * already behaves. During the window it comes back; once committed it is gone, and nothing in the
 * store implies it was ever there.
 *
 * The undo buffer therefore lives **outside** the store rather than as a flag inside it. That is not
 * an implementation detail — it is the whole reason a committed delete leaves no hole.
 *
 * Note what is *not* here: nothing decides how long an undo window lasts. `commit` is called by
 * whoever owns the session — on close, on save, on a timer, after N operations. A data model that
 * legislated undo duration would be answering a question that belongs to the application.
 *
 * @module
 */
import {
  type Dataset,
  type Derivation,
  type Group,
  type Id,
  type Method,
  randomId,
  type Record_,
  validateAll,
} from "./records.ts";

// Re-exported so a consumer importing only this module can name the types in these signatures.
// `deno doc --lint` treats a public signature referencing an unexported type as a defect, which it
// is: a field whose type nobody using the module can write down.
export type {
  Code, Dataset, Derivation, Group, Id, Method, Note, NoteCategory, Payload, Record_, Semantics,
} from "./records.ts";
export type { Axis, AxisKind, Dimension, Frame, Origin } from "./frame.ts";

/** A store plus whatever a recent delete is still holding for undo. */
export interface Session {
  /** The live records. A removed record is simply absent — there is no deleted flag. */
  store: readonly Record_[];
  /** Undo entries, most recent last. Empty once `commit` has run. */
  pending: readonly Undoable[];
}

/**
 * Enough to put a delete back: the records taken out, and the prior version of any record the delete
 * had to rewrite.
 *
 * Only groups get rewritten. A group is a set, and a set naming a record that is gone is simply
 * wrong — so removing a member edits the group rather than deleting it.
 */
export interface Undoable {
  /** Records taken out of the store entirely. */
  removed: readonly Record_[];
  /** Prior versions of records the delete had to rewrite — in practice, groups. */
  replaced: readonly Record_[];
}

/** Start a session over an existing store. Validates it, so a bad store fails here and not later. */
export function session(store: readonly Record_[] = []): Session {
  validateAll(store);
  return { store, pending: [] };
}

/** What `derive` needs to know about the thing being produced. */
export interface DeriveSpec {
  /** The record the operation was applied to. */
  parent: Id;
  /**
   * The produced dataset, minus the fields this function fills in. Its `id` is the caller's because
   * only the caller has the bytes: a content id where the content is fixed, `randomId()` otherwise.
   */
  produced: Omit<Dataset, "type"> & { type?: "dataset" };
  /** What was done, in enough detail to reproduce it. @see {@linkcode Method} */
  how: Method;
  /** Author. A local identity, so a colleague's work attributes correctly. */
  by: string;
  /** ISO 8601. Defaults to now. */
  at?: string;
}

/**
 * Apply an operation: append the produced dataset and the derivation that explains it.
 *
 * The parent is not modified and not consulted beyond having to exist. `sourceFingerprint` is set on
 * the produced payload so the derived thing carries its origin *inside itself* and the two cannot
 * drift — the property that lets staleness be detected without a ledger, and lets a delete find
 * every derivative of a removed source by scanning.
 *
 * @throws if the parent is not in the store, or if the result would not validate.
 */
export function derive(
  s: Session,
  spec: DeriveSpec,
): { session: Session; produced: Dataset; derivation: Derivation } {
  if (!s.store.some((r) => r.id === spec.parent)) {
    throw new Error(`derive: parent ${spec.parent} is not in the store`);
  }
  const produced: Dataset = {
    ...spec.produced,
    type: "dataset",
    payload: { ...spec.produced.payload, sourceFingerprint: spec.parent },
  };
  const derivation: Derivation = {
    type: "derivation",
    id: randomId(),
    parent: spec.parent,
    produced: produced.id,
    how: spec.how,
    by: spec.by,
    at: spec.at ?? new Date().toISOString(),
  };
  const store = [...s.store, produced, derivation];
  validateAll(store);
  return { session: { store, pending: s.pending }, produced, derivation };
}

/**
 * Everything a delete of `ids` would have to take with it, `ids` included.
 *
 * A delete must leave nothing pointing at what is gone — the same invariant the DICOM audit enforces
 * on the archive, where a row without a file is a zombie and a file without a row is an orphan. So
 * removing a dataset also removes the derivations naming it, the notes about it, and — transitively —
 * anything derived *from* it, because a segmentation of a deleted scan is not a thing that can stand
 * on its own.
 *
 * Exposed separately, and deliberately, so a caller can **show what will go before it goes**. Taking
 * more than was asked for is correct here and surprising to a user, and the resolution to that is
 * disclosure rather than silence.
 */
export function closure(store: readonly Record_[], ids: readonly Id[]): Set<Id> {
  const doomed = new Set<Id>(ids);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of store) {
      if (doomed.has(r.id)) continue;
      const dies = r.type === "derivation"
        ? doomed.has(r.parent) || doomed.has(r.produced)
        : r.type === "note"
        ? doomed.has(r.about)
        : r.type === "dataset"
        ? r.payload.sourceFingerprint !== undefined && doomed.has(r.payload.sourceFingerprint)
        : false; // a group survives its members; see `remove`
      if (dies) { doomed.add(r.id); changed = true; }
    }
  }
  return doomed;
}

/**
 * Stage a delete: take the records out of the store and hold them for undo.
 *
 * Thorough by construction — it removes the whole {@linkcode closure}, so the store still validates
 * afterwards, which is what turns "the delete was complete" into a test rather than a hope. Groups
 * are rewritten rather than removed, since a group naming a record that is gone is wrong but the
 * grouping itself may still be wanted.
 *
 * Nothing is marked. A record being gone from `store` is the only representation of its removal, so a
 * committed delete leaves no hole for anyone to notice.
 *
 * @throws if any id is not in the store — a delete of something absent is a caller bug, not a no-op.
 */
export function remove(s: Session, ids: readonly Id[]): Session {
  for (const id of ids) {
    if (!s.store.some((r) => r.id === id)) throw new Error(`remove: ${id} is not in the store`);
  }
  const doomed = closure(s.store, ids);

  const removed: Record_[] = [];
  const replaced: Record_[] = [];
  const store: Record_[] = [];
  for (const r of s.store) {
    if (doomed.has(r.id)) { removed.push(r); continue; }
    if (r.type === "group" && r.members.some((m) => doomed.has(m))) {
      replaced.push(r);
      store.push({ ...r, members: r.members.filter((m) => !doomed.has(m)) } satisfies Group);
      continue;
    }
    store.push(r);
  }
  validateAll(store);
  return { store, pending: [...s.pending, { removed, replaced }] };
}

/**
 * Undo the most recent staged delete.
 *
 * Only works while the delete is still pending. After {@linkcode commit} there is nothing to undo,
 * which is the point — an operation that could always be reversed would not be a delete.
 *
 * @throws if nothing is pending.
 */
export function undo(s: Session): Session {
  const last = s.pending.at(-1);
  if (!last) throw new Error("undo: nothing pending");
  const restored = new Map(last.replaced.map((r) => [r.id, r]));
  const store = [...s.store.map((r) => restored.get(r.id) ?? r), ...last.removed];
  validateAll(store);
  return { store, pending: s.pending.slice(0, -1) };
}

/**
 * Close the undo window: the staged deletes become permanent.
 *
 * There is no policy here on purpose — no duration, no depth. Whoever owns the session decides when,
 * because how long an undo lasts is an application's question and not a data model's.
 *
 * After this the removed records are unreachable from the session. Making them unreachable from the
 * *disk* is the caller's other half of the job, and it is the half that is easy to get wrong: a
 * delete is only as complete as the least-considered derived artifact — caches, thumbnails, tag
 * stores, index backups and version history are each a place a deletion does not reach by default.
 */
export function commit(s: Session): Session {
  return { store: s.store, pending: [] };
}

/** How many staged deletes are still undoable. */
export function pendingCount(s: Session): number {
  return s.pending.length;
}
