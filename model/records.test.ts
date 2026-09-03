// The real case first — the chain that actually exists in Ron's database — then the refusals.
//
// As with frame.ts, most of these assert that something throws, because every failure this model
// prevents looks like success: an id that would leave a hole when deleted, a derivation that is its
// own parent, a frame describing three axes over four-dimensional data, a free-text note filed under
// a category somebody intended to count.
//
//   deno test -A --no-check model/records.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { dicomSeries } from "./frame.ts";
import {
  ancestry,
  contentId,
  type Derivation,
  type Dataset,
  type Group,
  isId,
  type Note,
  randomId,
  type Record_,
  validate,
  validateAll,
} from "./records.ts";

const hex = (seed: string, n: number) =>
  Array.from({ length: n }, (_, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) + i) % 16]).join("");
const sha = (seed: string) => `sha256:${hex(seed, 64)}`;
const rnd = (seed: string) => `rnd:${hex(seed, 32)}`;

const CT_FRAME = dicomSeries([0.5, 0, 0, -128, 0, 0.5, 0, -128, 0, 0, 0.5, -100, 0, 0, 0, 1]);

/** Series 3: the original acquisition. */
const SERIES_3: Dataset = {
  type: "dataset",
  id: sha("series3"),
  payload: { locator: "archive/2025-06-10/series-3", mediaType: "application/dicom" },
  frame: CT_FRAME,
  dims: [512, 512, 993],
  semantics: { label: "Soft AbdPel" },
};

/** Series 301: the cropped grayscale, derived from series 3. */
const SERIES_301: Dataset = {
  type: "dataset",
  id: sha("series301"),
  payload: {
    locator: "derived/2025-06-10-cropped",
    mediaType: "application/dicom",
    sourceFingerprint: SERIES_3.id,
  },
  frame: CT_FRAME,
  dims: [452, 332, 993],
  semantics: { label: "1x0.5 Soft AbdPel cropped" },
};

/** Series 302: the nnInteractive segmentation, derived from 301. */
const SERIES_302: Dataset = {
  type: "dataset",
  id: sha("series302"),
  payload: {
    locator: "derived/2025-07-16-seg",
    mediaType: "application/dicom",
    sourceFingerprint: SERIES_301.id,
  },
  semantics: { label: "nnInteractive segmentation", codes: [{ scheme: "SCT", value: "85756007", meaning: "Tissue" }] },
};

const CROP: Derivation = {
  type: "derivation",
  id: rnd("crop"),
  parent: SERIES_3.id,
  produced: SERIES_301.id,
  how: { op: "crop", params: { roi: [0, 0, 0, 452, 332, 993] } },
  by: "ron",
  at: "2025-06-10T14:02:00Z",
};

const SEGMENT: Derivation = {
  type: "derivation",
  id: rnd("segment"),
  parent: SERIES_301.id,
  produced: SERIES_302.id,
  how: { op: "nnInteractive", version: "1.0", reason: "abdominal organs for the tumour board" },
  by: "ron",
  at: "2025-07-16T09:41:00Z",
};

const ORGANS: Group = {
  type: "group",
  id: rnd("organs"),
  members: [SERIES_301.id, SERIES_302.id],
  semantics: { label: "abdomen/pelvis working set" },
};

const REVIEW: Note = { type: "note", id: rnd("review"), about: SERIES_302.id, category: "needs-review" };

const STORE: Record_[] = [SERIES_3, SERIES_301, SERIES_302, CROP, SEGMENT, ORGANS, REVIEW];

Deno.test("the real chain validates, references and all", () => {
  validateAll(STORE);
});

// Lineage is walked from the derivation records rather than stored on the datasets, so it cannot
// disagree with the records that describe it.
Deno.test("lineage: ancestry is derived, nearest parent first", () => {
  assertEquals(ancestry(STORE, SERIES_302.id), [SERIES_301.id, SERIES_3.id]);
  assertEquals(ancestry(STORE, SERIES_3.id), []);
});

Deno.test("ids: content-addressed and random forms are accepted, nothing else is", () => {
  assertEquals(isId(sha("x")), true);
  assertEquals(isId(rnd("x")), true);
  assertEquals(isId("4173"), false);
  assertEquals(isId("series-301"), false);
  assertEquals(isId("sha256:abc"), false);
});

// The reason ids are not numbered. A hole in a sequence is evidence that something was removed, which
// is exactly what must not survive a delete of data that arrived by accident.
Deno.test("ids: a sequential id is refused", () => {
  assertThrows(
    () => validate({ ...SERIES_3, id: "1" }),
    Error,
    "must not be sequential",
  );
});

Deno.test("ids: the same bytes twice give the same id", async () => {
  const a = await contentId(new TextEncoder().encode("identical"));
  const b = await contentId(new TextEncoder().encode("identical"));
  const c = await contentId(new TextEncoder().encode("different"));
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(isId(a), true);
  assertEquals(randomId() === randomId(), false);
});

// A frame describes axes; dims counts samples along them. If they disagree, one of the two is about
// different data — silent, geometric, and very hard to find later.
Deno.test("dataset: a frame that disagrees with dims is refused", () => {
  assertThrows(
    () => validate({ ...SERIES_3, dims: [512, 512, 993, 20] }),
    Error,
    "frame has 3 axes but dims has 4",
  );
});

Deno.test("dataset: a payload must say where and what", () => {
  assertThrows(() => validate({ ...SERIES_3, payload: { locator: "", mediaType: "application/dicom" } }), Error, "locator is required");
  assertThrows(() => validate({ ...SERIES_3, payload: { locator: "x", mediaType: "" } }), Error, "mediaType is required");
});

Deno.test("derivation: a record cannot be its own parent", () => {
  assertThrows(
    () => validate({ ...CROP, parent: SERIES_301.id, produced: SERIES_301.id }),
    Error,
    "parent and produced are the same record",
  );
});

// An operation without a name cannot be reproduced, which is the entire point of recording it.
Deno.test("derivation: an unnamed operation is refused", () => {
  assertThrows(() => validate({ ...CROP, how: { op: "" } }), Error, "how.op is required");
  assertThrows(() => validate({ ...CROP, by: "" }), Error, "by is required");
  assertThrows(() => validate({ ...CROP, at: "last tuesday" }), Error, "ISO timestamp");
});

Deno.test("derivation: a cycle is refused rather than truncated", () => {
  const a = sha("cyc-a"), b = sha("cyc-b");
  const store: Record_[] = [
    { ...CROP, id: rnd("c1"), parent: a, produced: b },
    { ...CROP, id: rnd("c2"), parent: b, produced: a },
  ];
  assertThrows(() => ancestry(store, a), Error, "derivation cycle");
});

// Free text is only legal behind "other", because a category you can count across a collection is
// worth more than a sentence you cannot.
Deno.test("note: text belongs only with the 'other' category", () => {
  assertThrows(() => validate({ ...REVIEW, category: "other" }), Error, 'requires text');
  assertThrows(() => validate({ ...REVIEW, text: "looks odd" }), Error, "meant to be counted");
  validate({ ...REVIEW, category: "other", text: "re-scan scheduled" });
});

Deno.test("group: duplicate members are refused", () => {
  assertThrows(
    () => validate({ ...ORGANS, members: [SERIES_301.id, SERIES_301.id] }),
    Error,
    "duplicate members",
  );
});

// Membership is an edge, so one dataset lives in as many groups as you like. A single tree cannot do
// this, which is why a subject hierarchy cannot hold a well plate and an anatomical grouping at once.
Deno.test("group: one dataset can belong to several groups", () => {
  const byModality: Group = { type: "group", id: rnd("ct"), members: [SERIES_3.id, SERIES_301.id] };
  validateAll([...STORE, byModality]);
  const groups = [...STORE, byModality].filter((r): r is Group => r.type === "group");
  assertEquals(groups.filter((g) => g.members.includes(SERIES_301.id)).length, 2);
});

// The same invariant the DICOM audit enforces on the archive: nothing may point at what is not there.
// After a delete this must still pass, which is what makes "the delete was complete" a test.
Deno.test("store: a dangling reference is refused", () => {
  assertThrows(
    () => validateAll([SERIES_3, { ...ORGANS, members: [SERIES_3.id, sha("never-existed")] }]),
    Error,
    "which is not here",
  );
  // 301 names 3 as its source, so 301 alone is a store with a dangling fingerprint.
  assertThrows(() => validateAll([SERIES_301]), Error, "sourceFingerprint points at");
});

Deno.test("store: duplicate ids are refused", () => {
  assertThrows(() => validateAll([SERIES_3, { ...SERIES_301, id: SERIES_3.id }]), Error, "duplicate record id");
});

// Deleting a record must leave nothing pointing at it. This is the delete-completeness check, as a
// test rather than a hope: remove the segmentation and its derivation must go too.
Deno.test("delete: removing a record and everything that references it keeps the store valid", () => {
  const after = STORE.filter((r) =>
    r.id !== SERIES_302.id && r.id !== SEGMENT.id && r.id !== REVIEW.id
  ).map((r) => r.type === "group" ? { ...r, members: r.members.filter((m) => m !== SERIES_302.id) } : r);
  validateAll(after);
  assertEquals(after.some((r) => r.id === SERIES_302.id), false);
});

// And the failure it guards: deleting the dataset while leaving the records that name it.
Deno.test("delete: an incomplete delete is caught", () => {
  const sloppy = STORE.filter((r) => r.id !== SERIES_302.id);
  assertThrows(() => validateAll(sloppy), Error, "which is not here");
});
