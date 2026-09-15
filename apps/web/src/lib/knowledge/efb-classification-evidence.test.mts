import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateClassificationEvidence } from "./efb-classification-evidence.ts";

const source = [
  {
    id: "page-155",
    documentId: "airbus-qrh",
    page: 155,
    quote: "NORMAL CHECKLIST C3\nA318/A319/A320/A321 23 NOV 21\nQUICK REFERENCE HANDBOOK",
  },
];

test("keeps exact placement evidence and audits an invalid extra citation", () => {
  const result = evaluateClassificationEvidence(source, [
    { field: "qrh", id: "page-155", quote: "NORMAL CHECKLIST C3" },
    { field: "audience", id: "page-155", quote: "invented pilot quotation" },
  ]);
  assert.deepEqual(result.valid, [
    { field: "qrh", id: "page-155", quote: "NORMAL CHECKLIST C3" },
  ]);
  assert.equal(result.byField("qrh").length, 1);
  assert.equal(result.discarded[0].reason, "quote_not_exact");
  assert.deepEqual(result.warnings, ["discarded_invalid_evidence"]);
});

test("rejects unknown evidence ids and whitespace-normalized paraphrases", () => {
  const result = evaluateClassificationEvidence(source, [
    { field: "qrh", id: "missing", quote: "NORMAL CHECKLIST C3" },
    { field: "qrh", id: "page-155", quote: "normal operations checklist" },
  ]);
  assert.equal(result.valid.length, 0);
  assert.deepEqual(result.discarded.map((item) => item.reason), [
    "evidence_id_missing",
    "quote_not_exact",
  ]);
});
