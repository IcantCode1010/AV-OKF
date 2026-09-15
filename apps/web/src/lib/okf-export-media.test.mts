import assert from "node:assert/strict";
import test from "node:test";

import { buildOkfSystemTopic } from "./okf-export.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";

test("OKF topic export preserves portable figure metadata and Markdown", () => {
  const exported = buildOkfSystemTopic({
    document: {
      classificationCode: "32",
      contentSha256: "a".repeat(64),
      documentType: "AMM",
      effectivity: null,
      mimeType: "application/pdf",
      originalFilename: "amm.pdf",
      revision: null,
      sizeBytes: 100,
      sourceAuthority: null,
      subjectFamily: "Landing gear",
      title: "Landing Gear Manual",
    },
    exportedAt: new Date("2026-08-26T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
    topicFilePath: "concepts/system-topic/32-wheel-inspection.md",
    topic: {
      id: "topic-wheel",
      media: [{
        altText: "Exploded wheel assembly",
        kind: "diagram",
        pageNumber: 41,
        resourcePath: "resources/media/asset-hash.png",
        sourceCaption: "Figure 32-1 Wheel assembly",
        visualContext: "Shows inspection points on the wheel assembly.",
      }],
      pageEnd: 41,
      pageStart: 41,
      reviewStatus: "approved",
      sourcePageNumbers: [41],
      summary: "Inspection requirements for the wheel assembly.",
      title: "Wheel inspection",
    },
  });
  const parsed = parseOkfMarkdown(exported.content);
  const media = (parsed.frontmatter as Record<string, unknown>).av_okf_media;
  assert.deepEqual(media, [{
    alt: "Exploded wheel assembly",
    av_okf_kind: "diagram",
    caption: "Figure 32-1 Wheel assembly",
    context: "Shows inspection points on the wheel assembly.",
    page: 41,
    resource: "/resources/media/asset-hash.png",
  }]);
  assert.match(parsed.body, /## Figures/);
  assert.match(parsed.body, /\.\.\/\.\.\/resources\/media\/asset-hash\.png/);
});
