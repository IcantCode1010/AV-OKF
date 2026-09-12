import assert from "node:assert/strict";
import test from "node:test";

import { findFigureCaptionHints } from "./large-pdf-extraction.ts";
import {
  buildFigureMediaPrompt,
  pageFigureAnalysisSchema,
  selectMediaCandidatePages,
  shouldAutoApproveTopicMedia,
} from "./topic-media-discovery.ts";

test("figure candidates include raster pages and captioned vector diagrams", () => {
  const pages = [
    { figureCaptionHints: [], id: "1", imageCount: 0, pageNumber: 1, text: "Text", visualCandidate: false },
    { figureCaptionHints: [], id: "2", imageCount: 1, pageNumber: 2, text: "Raster", visualCandidate: true },
    { figureCaptionHints: ["Figure 3 Wheel assembly"], id: "3", imageCount: 0, pageNumber: 3, text: "Vector", visualCandidate: true },
  ];
  assert.deepEqual(selectMediaCandidatePages(pages).map((page) => page.pageNumber), [2, 3]);
  assert.deepEqual(findFigureCaptionHints("Procedure\nFigure 3-2  Wheel assembly\nNotes"), ["Figure 3-2 Wheel assembly"]);
});

test("figure prompt constrains associations to supplied exact-page topic ids", () => {
  const prompt = buildFigureMediaPrompt({
    captionHints: ["Figure 32-1 Wheel assembly"],
    pageNumber: 41,
    pageText: "Inspect the wheel assembly for cracks.",
    topics: [{ id: "topic-wheel-inspection", sourcePageNumbers: [41], summary: "Wheel inspection", title: "Wheel inspection" }],
  });
  assert.match(prompt, /Use only the supplied topic IDs/);
  assert.match(prompt, /topic-wheel-inspection/);
  assert.match(prompt, /source page 41/i);
});

test("auto approval requires confidence, margin, exact page, OCR support, anchors, and no warnings", () => {
  const baseline = {
    anchorTerms: ["wheel assembly"],
    confidence: 0.97,
    enabled: true,
    figureWarnings: [],
    labelsSupported: true,
    nextConfidence: 0.8,
    sourcePageMatches: true,
    sourceText: "Inspect the wheel assembly before installation.",
    threshold: 0.95,
  };
  assert.equal(shouldAutoApproveTopicMedia(baseline), true);
  assert.equal(shouldAutoApproveTopicMedia({ ...baseline, confidence: 0.94 }), false);
  assert.equal(shouldAutoApproveTopicMedia({ ...baseline, nextConfidence: 0.9 }), false);
  assert.equal(shouldAutoApproveTopicMedia({ ...baseline, labelsSupported: false }), false);
  assert.equal(shouldAutoApproveTopicMedia({ ...baseline, figureWarnings: ["ambiguous_crop"] }), false);
});

test("structured page analysis is bounded to figures and diagrams", () => {
  const parsed = pageFigureAnalysisSchema.parse({
    figures: [{
      altText: "Exploded wheel assembly",
      boundingBox: { height: 0.4, width: 0.5, x: 0.2, y: 0.1 },
      kind: "diagram",
      sourceCaption: "Figure 32-1",
      topicLinks: [{ anchorTerms: ["wheel assembly"], confidence: 0.97, rationale: "Directly depicts the inspected assembly.", role: "primary_evidence", topicId: "topic-wheel" }],
      visibleLabels: ["BEARING", "HUB"],
      visualContext: "Shows the components inspected for damage.",
    }],
    warnings: [],
  });
  assert.equal(parsed.figures[0]?.kind, "diagram");
});
