/**
 * SlicerGotthard — a data model for imaging, where nothing is assumed.
 *
 * ```ts
 * import { dicomSeries, type Dataset, validateAll } from "./mod.ts";
 * ```
 *
 * Two modules, and the second depends on the first:
 *
 * - `model/frame.ts` — what a set of numbers *means*: what each axis is, in what unit, under which
 *   convention, and how that geometry came to be known.
 * - `model/records.ts` — what exists and where it came from: datasets, groups, derivations, notes.
 *
 * `ARCHITECTURE.md` states what is built and what is missing; `model/RECORDS.md` explains the record
 * model in plain language before the code.
 */
export * from "./model/frame.ts";
export * from "./model/records.ts";
