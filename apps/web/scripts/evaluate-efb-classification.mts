import { readFile } from "node:fs/promises";
import { z } from "zod";
const fields = [
  "audiences",
  "aircraftFamily",
  "aircraftTypeIds",
  "ataChapter",
  "qrhTargetId",
] as const;
const metadata = z.object({
  audiences: z.array(z.string()),
  aircraftFamily: z.string(),
  aircraftTypeIds: z.array(z.string()),
  ataChapter: z.string().nullable(),
  qrhTargetId: z.string().nullable(),
});
const corpus = z
  .array(
    z.object({
      id: z.string(),
      reviewedBy: z.string().min(1),
      expected: metadata,
      predicted: metadata,
      status: z.enum(["ready", "needs_review", "blocked"]),
    }),
  )
  .min(1);
const file = process.argv[2];
if (!file)
  throw Error(
    "Usage: tsx scripts/evaluate-efb-classification.mts reviewed-corpus.json",
  );
const rows = corpus.parse(JSON.parse(await readFile(file, "utf8")));
const ready = rows.filter((r) => r.status === "ready");
const normalize = (v: unknown) =>
  JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
const metrics = Object.fromEntries(
  fields.map((field) => [
    field,
    {
      correct: ready.filter(
        (r) => normalize(r.expected[field]) === normalize(r.predicted[field]),
      ).length,
      total: ready.length,
    },
  ]),
);
const falseReady = ready.filter((r) =>
  fields.some((f) => normalize(r.expected[f]) !== normalize(r.predicted[f])),
).length;
const meetsPrecision =
  ready.length > 0 &&
  fields.every(
    (f) =>
      metrics[f].correct / metrics[f].total >=
      (f === "aircraftFamily" || f === "aircraftTypeIds" ? 0.98 : 0.95),
  );
console.log(
  JSON.stringify(
    {
      samples: rows.length,
      ready: ready.length,
      falseReady,
      metrics,
      meetsPrecision,
      rolloutNote:
        "Precision is necessary but not sufficient. Confirm representative aircraft/category coverage, source validity, and device acceptance before enabling automatic selection.",
    },
    null,
    2,
  ),
);
if (!meetsPrecision) process.exitCode = 1;
