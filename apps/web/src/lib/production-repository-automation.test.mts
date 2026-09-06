import assert from "node:assert/strict";
import test from "node:test";

import { resolveKnowledgeAuthoringAutomationSettings } from "./production-repository.ts";

test("extraction-created authoring runs snapshot both bundle automation flags", () => {
  assert.deepEqual(
    resolveKnowledgeAuthoringAutomationSettings({
      automation: {
        autoApproveEnrichedTopics: true,
        autoApproveVerifiedRelations: true,
      },
    }),
    {
      automaticRelationApprovalEnabled: true,
      automaticTopicApprovalEnabled: true,
    },
  );
});

test("missing or non-boolean automation settings fail closed", () => {
  assert.deepEqual(resolveKnowledgeAuthoringAutomationSettings({}), {
    automaticRelationApprovalEnabled: false,
    automaticTopicApprovalEnabled: false,
  });
  assert.deepEqual(
    resolveKnowledgeAuthoringAutomationSettings({
      automation: {
        autoApproveEnrichedTopics: "true",
        autoApproveVerifiedRelations: 1,
      },
    }),
    {
      automaticRelationApprovalEnabled: false,
      automaticTopicApprovalEnabled: false,
    },
  );
});
