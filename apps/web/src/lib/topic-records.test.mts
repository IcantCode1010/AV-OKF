import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDocumentVault } from "./document-vault.ts";
import { generateTopicCandidates } from "./topic-records.ts";

test("generateTopicCandidates creates heading-based topics with categorical confidence", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "ATA 24 ELECTRICAL POWER\nGenerator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 55,
    },
    {
      pageNumber: 2,
      text: "More generator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 37,
    },
    {
      pageNumber: 3,
      text: "SECTION 2 FAULT ISOLATION\nFault isolation details.",
      tables: [],
      imageCount: 0,
      charCount: 49,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "ATA 24 ELECTRICAL POWER");
  assert.equal(topics[0]?.confidence, "high");
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
  assert.equal(topics[1]?.title, "SECTION 2 FAULT ISOLATION");
  assert.equal(topics[1]?.confidence, "high");
  assert.deepEqual(topics[1]?.sourcePageNumbers, [3]);
});

test("generateTopicCandidates falls back to coarse page ranges with low confidence", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "This page has body text only.",
      tables: [],
      imageCount: 0,
      charCount: 29,
    },
    {
      pageNumber: 2,
      text: "This page also has body text only.",
      tables: [],
      imageCount: 0,
      charCount: 34,
    },
  ]);

  assert.equal(topics.length, 1);
  assert.equal(topics[0]?.title, "Pages 1-2");
  assert.equal(topics[0]?.confidence, "low");
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
});

test("generateTopicCandidates ignores running headers without suppressing repeated section titles", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "B737\nTechOps Training\nENGINE FUEL AND CONTROL - DISTRIBUTION - GENERAL\nBody text.\nEffective On:B737 MAX 1 ATA 73-00",
      tables: [],
      imageCount: 0,
      charCount: 122,
    },
    {
      pageNumber: 2,
      text: "B737\nTechOps Training\nENGINE FUEL AND CONTROL - DISTRIBUTION - GENERAL\nMore body text.\nEffective On:B737 MAX 2 ATA 73-00",
      tables: [],
      imageCount: 0,
      charCount: 127,
    },
    {
      pageNumber: 3,
      text: "B737\nTechOps Training\nENGINE FUEL AND CONTROL - COMPONENT LOCATION\nLocation body text.\nEffective On:B737 MAX 3 ATA 73-00",
      tables: [],
      imageCount: 0,
      charCount: 126,
    },
  ]);

  assert.equal(topics[0]?.title, "ENGINE FUEL AND CONTROL - DISTRIBUTION - GENERAL");
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
  assert.equal(topics[1]?.title, "ENGINE FUEL AND CONTROL - COMPONENT LOCATION");
  assert.equal(
    topics.some((topic) => topic.title.startsWith("Effective On:")),
    false,
  );
});

test("generateTopicCandidates skips a bare page-index code and finds the real heading below it", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "0.1\nEmergency Descent < >\nCondition: One or more of these occur:",
      tables: [],
      imageCount: 0,
      charCount: 60,
    },
    {
      pageNumber: 2,
      text: "0.2\nRapid Depressurization <>\nCondition: Cabin altitude exceeds 10,000 feet.",
      tables: [],
      imageCount: 0,
      charCount: 70,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "Emergency Descent < >");
  assert.equal(topics[0]?.confidence, "medium");
  assert.equal(
    topics.some((topic) => topic.title === "0.1" || topic.title === "0.2"),
    false,
  );
});

test("generateTopicCandidates keeps a numbered heading with trailing title text as high confidence", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "1.1 Compressor Overhaul\nBody text about compressor overhaul.",
      tables: [],
      imageCount: 0,
      charCount: 60,
    },
    {
      pageNumber: 2,
      text: "1.2 Turbine Inspection\nBody text about turbine inspection.",
      tables: [],
      imageCount: 0,
      charCount: 58,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "1.1 Compressor Overhaul");
  assert.equal(topics[0]?.confidence, "high");
});

test("generateTopicCandidates absorbs a page-index-code-only page into the preceding topic instead of spawning a junk topic", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "ATA 24 ELECTRICAL POWER\nGenerator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 55,
    },
    {
      pageNumber: 2,
      text: "Lights.Index.5\nSome cross-reference body text about various lights and page numbers.",
      tables: [],
      imageCount: 0,
      charCount: 85,
    },
    {
      pageNumber: 3,
      text: "SECTION 2 FAULT ISOLATION\nFault isolation details.",
      tables: [],
      imageCount: 0,
      charCount: 49,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
  assert.deepEqual(topics[1]?.sourcePageNumbers, [3]);
  assert.equal(
    topics.some((topic) => topic.title === "Lights.Index.5"),
    false,
  );
});

test("generateTopicCandidates never titles a topic after a bare dotted page-index code", () => {
  for (const code of ["0.1", "0.12", "1.1", "1.10"]) {
    const topics = generateTopicCandidates("doc-1", [
      {
        pageNumber: 1,
        text: code,
        tables: [],
        imageCount: 0,
        charCount: code.length,
      },
    ]);

    assert.equal(
      topics.some((topic) => topic.title === code),
      false,
      `expected no topic titled "${code}"`,
    );
  }
});

test("generateTopicCandidates assigns medium confidence to shortTitle-only heading matches", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "Quick Action Index\nBody text about quick action items.",
      tables: [],
      imageCount: 0,
      charCount: 56,
    },
    {
      pageNumber: 2,
      text: "Alphabetical Index\nBody text listing items alphabetically.",
      tables: [],
      imageCount: 0,
      charCount: 60,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "Quick Action Index");
  assert.equal(topics[0]?.confidence, "medium");
});

test("generateTopicCandidates does not reject a hyphenated dotted heading like NNC.0-Miscellaneous", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "NNC.0-Miscellaneous\nBody text about miscellaneous items in this section.",
      tables: [],
      imageCount: 0,
      charCount: 74,
    },
    {
      pageNumber: 2,
      text: "NNC.1-Airplane General\nBody text about airplane general items in this section.",
      tables: [],
      imageCount: 0,
      charCount: 80,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "NNC.0-Miscellaneous");
  assert.equal(topics[0]?.confidence, "medium");
});

test("generateTopicCandidates absorbs a dot-leader index entry into the preceding topic", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "ATA 24 ELECTRICAL POWER\nGenerator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 55,
    },
    {
      pageNumber: 2,
      text: "LOW QUANTITY............................................ 13.13\nSome cross-reference body text about low quantity conditions.",
      tables: [],
      imageCount: 0,
      charCount: 110,
    },
    {
      pageNumber: 3,
      text: "SECTION 2 FAULT ISOLATION\nFault isolation details.",
      tables: [],
      imageCount: 0,
      charCount: 49,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
  assert.deepEqual(topics[1]?.sourcePageNumbers, [3]);
  assert.equal(
    topics.some((topic) =>
      topic.title.includes("LOW QUANTITY............"),
    ),
    false,
  );
});

test("generateTopicCandidates never titles a topic after a bare 1-3 letter line", () => {
  for (const letter of ["D", "B", "R"]) {
    const topics = generateTopicCandidates("doc-1", [
      {
        pageNumber: 1,
        text: letter,
        tables: [],
        imageCount: 0,
        charCount: letter.length,
      },
    ]);

    assert.equal(
      topics.some((topic) => topic.title === letter),
      false,
      `expected no topic titled "${letter}"`,
    );
  }
});

test("generateTopicCandidates resolves a bare 3-letter truncation artifact to the real heading on the next line", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "REV\nREVERSER UNLOCKED (IN FLIGHT)\nCondition: Reverser lever moved up.",
      tables: [],
      imageCount: 0,
      charCount: 70,
    },
    {
      pageNumber: 2,
      text: "GPS\nGPS GPS\nCondition: Satellite signal lost.",
      tables: [],
      imageCount: 0,
      charCount: 47,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "REVERSER UNLOCKED (IN FLIGHT)");
  assert.equal(topics[0]?.confidence, "high");
  assert.equal(topics[1]?.title, "GPS GPS");
  assert.equal(
    topics.some((topic) => topic.title === "REV" || topic.title === "GPS"),
    false,
  );
});

test("generateTopicCandidates keeps a real short multi-word heading like ICE ON", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "ICE ON\nBody text about ice protection status.",
      tables: [],
      imageCount: 0,
      charCount: 47,
    },
    {
      pageNumber: 2,
      text: "ICE OFF\nBody text about ice protection status ending.",
      tables: [],
      imageCount: 0,
      charCount: 55,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "ICE ON");
});

test("vault topic generation requires completed extraction", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-topics-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Topic generation requires extraction.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["topic"],
      title: "Topic Manual",
      type: "application/pdf",
    });

    await assert.rejects(
      () => vault.generateTopicRecords(uploaded.id),
      /document_extraction_not_completed/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("vault rerun replaces draft topics but preserves reviewed topic coverage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-topics-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Topic rerun behavior.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["topic"],
      title: "Topic Manual",
      type: "application/pdf",
    });

    await vault.completeExtraction(uploaded.id, {
      pageRecords: [
        {
          pageNumber: 1,
          text: "ATA 24 ELECTRICAL POWER\nGenerator bus detail.",
          tables: [],
          imageCount: 0,
          charCount: 45,
        },
        {
          pageNumber: 2,
          text: "SECTION 2 FAULT ISOLATION\nFault detail.",
          tables: [],
          imageCount: 0,
          charCount: 39,
        },
      ],
    });

    const firstRun = await vault.generateTopicRecords(uploaded.id);
    assert.equal(firstRun.length, 2);

    await vault.updateTopicReviewStatus(firstRun[0]!.id, "approved");

    const rerun = await vault.generateTopicRecords(uploaded.id);
    assert.equal(rerun.some((topic) => topic.id === firstRun[0]!.id), true);
    assert.equal(
      rerun.some(
        (topic) =>
          topic.id !== firstRun[0]!.id && topic.sourcePageNumbers.includes(1),
      ),
      false,
    );
    assert.equal(
      rerun.some(
        (topic) =>
          topic.id !== firstRun[1]!.id && topic.sourcePageNumbers.includes(2),
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
