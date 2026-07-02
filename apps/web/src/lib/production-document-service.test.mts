import assert from "node:assert/strict";
import test from "node:test";

import { createProductionDocumentService } from "./production-document-service.ts";

test("production getDocumentById returns undefined for missing documents", async () => {
  const service = createProductionDocumentService(
    {
      getDocumentById: async () => {
        throw new Error("document_not_found");
      },
    },
    {},
    {},
  );

  assert.equal(await service.getDocumentById("missing_doc"), undefined);
});
