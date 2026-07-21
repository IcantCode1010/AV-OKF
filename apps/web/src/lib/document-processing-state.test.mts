import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocumentProcessingFingerprint,
  buildDocumentProcessingState,
  resolveDocumentPanel,
  serializeDocumentProcessingFingerprint,
  shouldPollDocumentProcessing,
  type ProcessingAuthoringRun,
} from "./document-processing-state.ts";

test("queued extraction is visible as active processing", () => {
  const state = buildDocumentProcessingState({
    authoringRun: null,
    bundleName: "General Knowledge",
    document: documentFixture("queued"),
    topicCount: 0,
  });
  assert.equal(state.active, true);
  assert.equal(state.currentLabel, "Text extraction");
  assert.equal(state.showHeader, true);
});

test("completed extraction without authoring requires an explicit next action", () => {
  const state = buildDocumentProcessingState({
    authoringRun: null,
    bundleName: "General Knowledge",
    document: documentFixture("completed"),
    topicCount: 0,
  });
  assert.equal(stageStatus(state, "metadata_discovery"), "action_required");
  assert.equal(state.active, false);
});

test("authoring stages and real discovery window progress are derived from records", () => {
  const state = buildDocumentProcessingState({
    authoringRun: authoringFixture({ currentStage: "concept_discovery", completedStages: ["metadata_discovery"] }),
    bundleName: "General Knowledge",
    document: {
      ...documentFixture("completed"),
      topicDiscovery: {
        completedWindows: 3,
        errorMessage: null,
        estimatedInputTokens: 1200,
        status: "analyzing",
        totalWindows: 7,
      },
    },
    topicCount: 0,
  });
  assert.equal(stageStatus(state, "metadata_discovery"), "completed");
  assert.equal(stageStatus(state, "concept_discovery"), "running");
  assert.match(stageDetail(state, "concept_discovery"), /3 of 7/);
});

test("provider, cost, and failure states require attention and stop active polling", () => {
  for (const [status, expected] of [
    ["awaiting_provider", "action_required"],
    ["awaiting_cost_confirmation", "action_required"],
    ["failed", "failed"],
  ] as const) {
    const state = buildDocumentProcessingState({
      authoringRun: authoringFixture({ currentStage: "enrichment", status }),
      bundleName: "General Knowledge",
      document: documentFixture("completed"),
      topicCount: 2,
    });
    assert.equal(stageStatus(state, "enrichment"), expected);
    assert.equal(state.active, false);
    assert.equal(state.showHeader, true);
  }
});

test("manual review remains an action-required terminal state", () => {
  const state = buildDocumentProcessingState({
    authoringRun: authoringFixture({
      completedStages: ["metadata_discovery", "concept_discovery", "enrichment", "relation_classification", "validation"],
      currentStage: "review",
      status: "ready_for_review",
    }),
    bundleName: "General Knowledge",
    document: documentFixture("completed"),
    topicCount: 3,
  });
  assert.equal(stageStatus(state, "review_export"), "action_required");
  assert.equal(state.showHeader, true);
});

test("automatic approval exposes queued, running, partial, and clean completion", () => {
  for (const [status, expected] of [
    ["queued", "queued"],
    ["running", "running"],
    ["completed_with_failures", "action_required"],
    ["completed", "completed"],
  ] as const) {
    const state = buildDocumentProcessingState({
      authoringRun: authoringFixture({
        automaticApprovalRun: {
          id: "bulk-1",
          items: [{ status: status === "completed" ? "succeeded" : "failed" }],
          knowledgeBundleId: "bundle-1",
          status,
        },
        automaticTopicApprovalEnabled: true,
        completedStages: ["metadata_discovery", "concept_discovery", "enrichment", "relation_classification", "validation"],
        currentStage: "review",
        status: "ready_for_review",
      }),
      bundleName: "General Knowledge",
      document: documentFixture("completed"),
      topicCount: 1,
    });
    assert.equal(stageStatus(state, "review_export"), expected);
    assert.equal(state.showHeader, status !== "completed");
  }
});

test("clean completion hides the strip but preserves an explicit Processing deep link", () => {
  const state = buildDocumentProcessingState({
    authoringRun: authoringFixture({
      automaticApprovalRun: {
        id: "bulk-complete",
        items: [{ status: "succeeded" }],
        knowledgeBundleId: "bundle-1",
        status: "completed",
      },
      automaticTopicApprovalEnabled: true,
      completedStages: ["metadata_discovery", "concept_discovery", "enrichment", "relation_classification", "validation"],
      currentStage: "review",
      status: "ready_for_review",
    }),
    bundleName: "General Knowledge",
    document: documentFixture("completed"),
    topicCount: 1,
  });
  assert.equal(state.showHeader, false);
  assert.equal(resolveDocumentPanel({ extractionStatus: "completed", processingState: state, requestedPanel: "processing", topicCount: 1 }), "processing");
});

test("non-aviation bundles use domain-neutral processing language", () => {
  const state = buildDocumentProcessingState({
    authoringRun: authoringFixture({ currentStage: "metadata_discovery" }),
    bundleName: "Employment Policies",
    document: documentFixture("completed"),
    topicCount: 0,
  });
  const copy = state.stages.map((stage) => `${stage.label} ${stage.detail}`).join(" ").toLowerCase();
  assert.doesNotMatch(copy, /\b(?:aircraft|aviation|ata)\b|maintenance manual/);
  assert.match(copy, /document|concept|topic/);
  assert.equal(state.bundleName, "Employment Policies");
});

test("active processing is the default panel while explicit deep links remain stable", () => {
  const processingState = buildDocumentProcessingState({
    authoringRun: null,
    bundleName: "General Knowledge",
    document: documentFixture("running"),
    topicCount: 0,
  });
  assert.equal(resolveDocumentPanel({ extractionStatus: "running", processingState, topicCount: 0 }), "processing");
  assert.equal(resolveDocumentPanel({ extractionStatus: "running", processingState, requestedPanel: "metadata", topicCount: 0 }), "metadata");
});

test("polling includes automatic approval and stops for attention states", () => {
  assert.equal(shouldPollDocumentProcessing({ automaticApprovalStatus: "running", extractionStatus: "completed" }), true);
  assert.equal(shouldPollDocumentProcessing({ derivedProcessingActive: true, extractionStatus: "completed" }), true);
  assert.equal(shouldPollDocumentProcessing({ authoringStatus: "awaiting_cost_confirmation", extractionStatus: "completed" }), false);
  assert.equal(shouldPollDocumentProcessing({ automaticApprovalStatus: "completed_with_failures", extractionStatus: "completed" }), false);
});

test("processing fingerprint changes for backend progress but stays stable for equal records", () => {
  const base = {
    authoringRun: authoringFixture(),
    document: documentFixture("completed"),
  };
  const fingerprint = buildDocumentProcessingFingerprint(base);
  assert.equal(buildDocumentProcessingFingerprint(base), fingerprint);
  assert.notEqual(
    buildDocumentProcessingFingerprint({
      ...base,
      document: {
        ...base.document,
        topicDiscovery: {
          ...base.document.topicDiscovery,
          completedWindows: 1,
          status: "analyzing",
          totalWindows: 3,
        },
      },
    }),
    fingerprint,
  );
  assert.notEqual(
    buildDocumentProcessingFingerprint({
      ...base,
      authoringRun: authoringFixture({ currentStage: "enrichment" }),
    }),
    fingerprint,
  );
});

test("page and lightweight API snapshots produce the same processing fingerprint", () => {
  const document = documentFixture("completed");
  const authoringRun = authoringFixture({
    automaticApprovalRun: {
      id: "bulk-1",
      items: [{ status: "exporting" }, { status: "succeeded" }],
      knowledgeBundleId: "bundle-1",
      status: "running",
    },
    completedStages: ["metadata_discovery", "concept_discovery"],
    currentStage: "enrichment",
  });
  assert.equal(
    buildDocumentProcessingFingerprint({ authoringRun, document }),
    serializeDocumentProcessingFingerprint({
      authoring: {
        completedStages: authoringRun.completedStages,
        currentStage: authoringRun.currentStage,
        errorMessage: authoringRun.errorMessage,
        id: authoringRun.id,
        status: authoringRun.status,
      },
      automaticApproval: {
        id: "bulk-1",
        itemStatuses: ["succeeded", "exporting"],
        status: "running",
      },
      extraction: {
        errorCode: null,
        pageCount: 0,
        status: "completed",
      },
      topicDiscovery: {
        completedWindows: 0,
        errorMessage: null,
        status: "not_started",
        totalWindows: 0,
      },
    }),
  );
});

function documentFixture(status: "completed" | "failed" | "queued" | "running") {
  return {
    extraction: {
      completedAt: status === "completed" ? "Now" : null,
      error: status === "failed" ? { code: "malformed_pdf", message: "Malformed" } : null,
      logs: [],
      pageRecords: [],
      startedAt: status === "queued" ? null : "Now",
      status,
    },
    storageKey: "workspaces/ws/documents/doc/original/file.pdf",
    topicDiscovery: {
      completedWindows: 0,
      errorMessage: null,
      estimatedInputTokens: 0,
      status: "not_started" as const,
      totalWindows: 0,
    },
  };
}

function authoringFixture(overrides: Partial<ProcessingAuthoringRun> = {}): ProcessingAuthoringRun {
  return {
    automaticApprovalRun: null,
    automaticTopicApprovalEnabled: false,
    completedStages: [],
    currentStage: "metadata_discovery",
    errorMessage: null,
    id: "run-1",
    status: "running",
    ...overrides,
  };
}

function stageStatus(state: ReturnType<typeof buildDocumentProcessingState>, id: string) {
  return state.stages.find((stage) => stage.id === id)?.status;
}

function stageDetail(state: ReturnType<typeof buildDocumentProcessingState>, id: string) {
  return state.stages.find((stage) => stage.id === id)?.detail ?? "";
}
