// The claim under test: an edit appends a record instead of overwriting one, and a delete is one
// destructive operation with a temporary undo.
//
// The scenario is Ron's real workflow — a cropped CT, a segmentation, an edit to it, then a
// colleague branching from the same point to validate — because a model that only works on invented
// data has not been tested.
//
//   deno test -A --no-check model/session.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { dicomSeries } from "./frame.ts";
import { ancestry, type Dataset, type Group, type Note, randomId, validateAll } from "./records.ts";
import { closure, commit, derive, pendingCount, remove, session, undo } from "./session.ts";

const hex = (seed: string, n: number) =>
  Array.from({ length: n }, (_, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) + i) % 16]).join("");
const sha = (seed: string) => `sha256:${hex(seed, 64)}`;

const FRAME = dicomSeries([0.5, 0, 0, -128, 0, 0.5, 0, -128, 0, 0, 0.5, -100, 0, 0, 0, 1]);

const CT: Dataset = {
  type: "dataset",
  id: sha("ct"),
  payload: { locator: "derived/2025-06-10-cropped", mediaType: "application/dicom" },
  frame: FRAME,
  dims: [452, 332, 993],
  semantics: { label: "1x0.5 Soft AbdPel cropped" },
};

const seg = (seed: string, label: string): Omit<Dataset, "type"> => ({
  id: sha(seed),
  payload: { locator: `derived/${seed}`, mediaType: "application/dicom" },
  frame: FRAME,
  dims: [452, 332, 993],
  semantics: { label },
});

// --- deriving appends ----------------------------------------------------------------------------

Deno.test("derive: appends, and does not touch the parent", () => {
  const s0 = session([CT]);
  const { session: s1, produced, derivation } = derive(s0, {
    parent: CT.id,
    produced: seg("seg1", "nnInteractive segmentation"),
    how: { op: "nnInteractive", version: "1.0" },
    by: "ron",
    at: "2025-07-16T09:41:00Z",
  });

  // The parent record is byte-for-byte what it was.
  assertEquals(s1.store.find((r) => r.id === CT.id), CT);
  assertEquals(s0.store.length, 1);           // the original session is untouched too
  assertEquals(s1.store.length, 3);           // + the produced dataset, + the derivation
  assertEquals(derivation.parent, CT.id);
  assertEquals(derivation.produced, produced.id);
  // The derived thing carries its origin inside itself, so the two cannot drift apart.
  assertEquals(produced.payload.sourceFingerprint, CT.id);
  validateAll(s1.store);
});

// This is the claim. Three sequential edits leave the first two intact and readable, which is what
// makes editing and history the same mechanism rather than two.
Deno.test("derive: an edit chain keeps every intermediate", () => {
  let s = session([CT]);
  let parent = CT.id;
  for (const [i, op] of [["applyThreshold", { lower: 40, upper: 200 }], ["applyMargin", { marginMm: 2 }], ["applyIslands", { operation: "keepLargest" }]].entries()) {
    const r = derive(s, {
      parent,
      produced: seg(`edit${i}`, `edit #${i + 1}`),
      how: { op: op[0] as string, params: op[1] as Record<string, unknown> },
      by: "ron",
    });
    s = r.session;
    parent = r.produced.id;
  }
  assertEquals(s.store.filter((r) => r.type === "dataset").length, 4);   // CT + three edits
  assertEquals(s.store.filter((r) => r.type === "derivation").length, 3);
  // Lineage is walked from the derivations, so it cannot disagree with them.
  assertEquals(ancestry(s.store, parent), [sha("edit1"), sha("edit0"), CT.id]);
});

// A colleague validating your work branches from the same parent. Yours does not move, and neither
// branch has to know about the other — which is the property a mutate-in-place model cannot give.
Deno.test("derive: two people can branch from the same point", () => {
  const s0 = session([CT]);
  const mine = derive(s0, { parent: CT.id, produced: seg("mine", "ron's edit"), how: { op: "applyMargin", params: { marginMm: 2 } }, by: "ron" });
  const theirs = derive(mine.session, { parent: CT.id, produced: seg("theirs", "colleague's validation"), how: { op: "applyMargin", params: { marginMm: 3 }, reason: "validation" }, by: "colleague" });

  assertEquals(ancestry(theirs.session.store, sha("mine")), [CT.id]);
  assertEquals(ancestry(theirs.session.store, sha("theirs")), [CT.id]);
  assertEquals(theirs.session.store.find((r) => r.id === CT.id), CT);
  validateAll(theirs.session.store);
});

Deno.test("derive: a parent that is not there is refused", () => {
  assertThrows(
    () => derive(session([CT]), { parent: sha("nope"), produced: seg("x", "x"), how: { op: "crop" }, by: "ron" }),
    Error,
    "is not in the store",
  );
});

// --- deleting ------------------------------------------------------------------------------------

/** A store with a CT, a segmentation of it, a note on the segmentation, and a group holding both. */
function populated() {
  const s1 = derive(session([CT]), {
    parent: CT.id,
    produced: seg("seg", "segmentation"),
    how: { op: "nnInteractive" },
    by: "ron",
  });
  const note: Note = { type: "note", id: randomId(), about: sha("seg"), category: "needs-review" };
  const group: Group = { type: "group", id: randomId(), members: [CT.id, sha("seg")], semantics: { label: "working set" } };
  return { s: { ...s1.session, store: [...s1.session.store, note, group] }, note, group };
}

// Deleting the CT has to take the segmentation with it: a segmentation of a scan that is gone is not
// a thing that can stand on its own, and leaving it would leave a dangling reference.
Deno.test("closure: a delete reaches everything that depends on what is going", () => {
  const { s, note, group } = populated();
  const doomed = closure(s.store, [CT.id]);
  assertEquals(doomed.has(CT.id), true);
  assertEquals(doomed.has(sha("seg")), true, "the segmentation derived from it");
  assertEquals(doomed.has(note.id), true, "the note about the segmentation");
  assertEquals(doomed.has(group.id), false, "the group survives, with its membership rewritten");
});

// The whole point of exposing closure(): a caller can show what will go before it goes. Taking more
// than was asked for is correct here and surprising, and the answer to that is disclosure.
Deno.test("remove: the store still validates afterwards — delete-completeness as a test", () => {
  const { s } = populated();
  const after = remove(s, [CT.id]);
  validateAll(after.store);                                  // would throw on any dangling reference
  assertEquals(after.store.filter((r) => r.type === "dataset").length, 0);
  assertEquals(after.store.filter((r) => r.type === "group").length, 1);
  assertEquals((after.store.find((r) => r.type === "group") as Group).members, []);
});

Deno.test("remove: deleting a leaf leaves the parent alone", () => {
  const { s } = populated();
  const after = remove(s, [sha("seg")]);
  validateAll(after.store);
  assertEquals(after.store.some((r) => r.id === CT.id), true);
  assertEquals(after.store.some((r) => r.id === sha("seg")), false);
  assertEquals((after.store.find((r) => r.type === "group") as Group).members, [CT.id]);
});

// Ron's specification, verbatim: "You delete, with a temporary undo, as is in the segment editor."
Deno.test("undo: a staged delete comes back exactly, group membership included", () => {
  const { s, group } = populated();
  const before = s.store;
  const after = remove(s, [CT.id]);
  assertEquals(pendingCount(after), 1);

  const back = undo(after);
  assertEquals(pendingCount(back), 0);
  assertEquals(back.store.length, before.length);
  assertEquals(new Set(back.store.map((r) => r.id)), new Set(before.map((r) => r.id)));
  // The rewritten group is restored to its prior membership, not left emptied.
  assertEquals((back.store.find((r) => r.id === group.id) as Group).members, [CT.id, sha("seg")]);
  validateAll(back.store);
});

Deno.test("undo: it is a stack — the most recent delete comes back first", () => {
  const { s } = populated();
  const a = remove(s, [sha("seg")]);
  const b = remove(a, [CT.id]);
  assertEquals(pendingCount(b), 2);

  const back1 = undo(b);
  assertEquals(back1.store.some((r) => r.id === CT.id), true);
  assertEquals(back1.store.some((r) => r.id === sha("seg")), false, "the earlier delete is still staged");
  const back2 = undo(back1);
  assertEquals(back2.store.some((r) => r.id === sha("seg")), true);
});

// After the window closes there is nothing to undo. An operation that could always be reversed would
// not be a delete, and this is what makes the accidental-ingest case need no special mode.
Deno.test("commit: closes the window, and then the delete is not reversible", () => {
  const { s } = populated();
  const after = commit(remove(s, [CT.id]));
  assertEquals(pendingCount(after), 0);
  assertThrows(() => undo(after), Error, "nothing pending");
});

// And the store carries no evidence. No tombstone, no gap, nothing whose absence implies a presence —
// which is only possible because the undo buffer lives outside the store rather than as a flag in it.
Deno.test("commit: a committed delete leaves no trace in the store", () => {
  const { s } = populated();
  const after = commit(remove(s, [CT.id]));
  const serialized = JSON.stringify(after.store);
  assertEquals(serialized.includes(CT.id), false, "the id must not appear anywhere");
  assertEquals(serialized.includes("2025-06-10-cropped"), false, "nor its locator");
  assertEquals(serialized.toLowerCase().includes("delet"), false, "and no deletion marker");
});

Deno.test("remove: deleting something absent is a caller bug, not a no-op", () => {
  const { s } = populated();
  assertThrows(() => remove(s, [sha("never")]), Error, "is not in the store");
});
