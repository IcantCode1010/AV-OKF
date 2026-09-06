import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectEfbArticleSource,
  getProjectEfbArticleClassification,
  normalizeProjectEfbArticleClassification,
  normalizeProjectEfbAtaChapter,
  setProjectEfbArticleClassification,
} from "./project-efb-article-classification.ts";

const documentDefaults = {
  aircraftFamilyIds: ["737-ng"],
  aircraftTypeIds: [],
  applicabilityStatus: "accepted",
  classificationCode: "737SAR",
  intendedAudiences: ["maintenance"],
  title: "11 Hydraulic Power",
};

test("accepts grounded hydraulic metadata while rejecting source identifiers as ATA", () => {
  const sourceText = "Article title: Hydraulic pumps. Source page 2 Hydraulic power is provided by system A and system B.";
  const result = normalizeProjectEfbArticleClassification({
    documentDefaults,
    model: "gpt-test",
    output: {
      aircraftFamilyIds: ["737-ng"],
      aircraftTypeIds: [],
      ataChapter: "29",
      audiences: ["maintenance"],
      confidence: 0.97,
      evidence: ["Hydraulic power is provided by system A and system B."],
    },
    provider: "openai",
    sourceText,
  });

  assert.equal(normalizeProjectEfbAtaChapter("737SAR"), null);
  assert.equal(result.status, "accepted");
  assert.equal(result.ataChapter, "29");
  assert.deepEqual(result.aircraftFamilyIds, ["737-ng"]);
  assert.deepEqual(result.aircraftTypeIds, []);
  assert.deepEqual(result.audiences, ["maintenance"]);
});

test("fails closed on unsupported ATA, family IDs used as types, or fabricated evidence", () => {
  const result = normalizeProjectEfbArticleClassification({
    documentDefaults,
    model: "gpt-test",
    output: {
      aircraftFamilyIds: ["737-ng"],
      aircraftTypeIds: ["737-ng"],
      ataChapter: "737SAR",
      audiences: ["maintenance"],
      confidence: 0.99,
      evidence: ["This quote was not in the article."],
    },
    provider: "openai",
    sourceText: "Hydraulic source evidence.",
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.ataChapter, null);
});

test("round-trips classification in the optional Project EFB extension", () => {
  const classification = normalizeProjectEfbArticleClassification({
    documentDefaults: { ...documentDefaults, classificationCode: "29" },
    model: "gpt-test",
    output: {
      aircraftFamilyIds: ["737-ng"],
      aircraftTypeIds: [],
      ataChapter: "29",
      audiences: ["maintenance"],
      confidence: 0.95,
      evidence: ["Hydraulic power"],
    },
    provider: "openai",
    sourceText: "Hydraulic power",
  });
  const metadata = setProjectEfbArticleClassification({ producerField: true }, classification);
  assert.equal((metadata as Record<string, unknown>).producerField, true);
  assert.deepEqual(getProjectEfbArticleClassification(metadata), classification);
});

test("article classification source includes hierarchy defaults and raw source pages", () => {
  const source = buildProjectEfbArticleSource({
    document: { ...documentDefaults, classificationCode: "29" },
    enrichedBody: "Hydraulic reservoir and pump overview.",
    enrichedSummary: "Hydraulic power overview.",
    enrichedTitle: "Hydraulic Power",
    sourcePages: [{ pageNumber: 4, text: "ATA 29 HYDRAULIC POWER" }],
    sourcePageNumbers: [4],
    summary: "Hydraulic power.",
    title: "Hydraulic Power",
  });
  assert.match(source, /Document ATA default: 29/);
  assert.match(source, /Source page 4 ATA 29 HYDRAULIC POWER/);
});
