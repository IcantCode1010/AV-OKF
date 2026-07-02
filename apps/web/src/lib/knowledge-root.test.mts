import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getDefaultKnowledgeRoot as getBundleKnowledgeRoot } from "./okf-bundle.ts";
import { getDefaultKnowledgeRoot as getServiceKnowledgeRoot } from "./okf-export-service.ts";
import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";

test("knowledge root helper is shared by bundle preview and OKF export service", () => {
  const previous = process.env.AV_OKF_KNOWLEDGE_ROOT;
  const cwd = path.join("C:", "projects", "AV-OKF", "apps", "web");

  try {
    delete process.env.AV_OKF_KNOWLEDGE_ROOT;
    assert.equal(getBundleKnowledgeRoot(cwd), getDefaultKnowledgeRoot(cwd));
    assert.equal(getServiceKnowledgeRoot(cwd), getDefaultKnowledgeRoot(cwd));

    process.env.AV_OKF_KNOWLEDGE_ROOT = path.join("C:", "av-okf", "knowledge");
    assert.equal(getBundleKnowledgeRoot(cwd), getDefaultKnowledgeRoot(cwd));
    assert.equal(getServiceKnowledgeRoot(cwd), getDefaultKnowledgeRoot(cwd));
  } finally {
    if (previous === undefined) {
      delete process.env.AV_OKF_KNOWLEDGE_ROOT;
    } else {
      process.env.AV_OKF_KNOWLEDGE_ROOT = previous;
    }
  }
});
