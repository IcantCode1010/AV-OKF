import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActionDocumentWorkspace,
  normalizeClassificationCode,
} from "./document-action-guards.ts";

test("assertActionDocumentWorkspace rejects metadata updates for another workspace", () => {
  assert.throws(
    () =>
      assertActionDocumentWorkspace({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        document: { workspaceId: "wrk_2" },
        mismatchError: "document_workspace_mismatch",
      }),
    /document_workspace_mismatch/,
  );
});

test("assertActionDocumentWorkspace rejects missing workspace ids by default", () => {
  for (const document of [{ workspaceId: null }, { workspaceId: undefined }, {}]) {
    assert.throws(
      () =>
        assertActionDocumentWorkspace({
          context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
          document,
          mismatchError: "document_workspace_mismatch",
        }),
      /document_workspace_mismatch/,
    );
  }
});

test("assertActionDocumentWorkspace allows missing workspace only with explicit opt-out", () => {
  assert.doesNotThrow(() =>
    assertActionDocumentWorkspace({
      allowMissingWorkspace: true,
      context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
      document: { workspaceId: null },
      mismatchError: "document_workspace_mismatch",
    }),
  );

  assert.throws(
    () =>
      assertActionDocumentWorkspace({
        allowMissingWorkspace: true,
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        document: { workspaceId: "wrk_2" },
        mismatchError: "document_workspace_mismatch",
      }),
    /document_workspace_mismatch/,
  );
});

test("assertActionDocumentWorkspace allows matching workspace ids", () => {
  assert.doesNotThrow(() =>
    assertActionDocumentWorkspace({
      context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
      document: { workspaceId: "wrk_1" },
      mismatchError: "document_workspace_mismatch",
    }),
  );
});

test("assertActionDocumentWorkspace rejects OKF exports for another workspace", () => {
  assert.throws(
    () =>
      assertActionDocumentWorkspace({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        document: { workspaceId: "wrk_2" },
        mismatchError: "okf_export_workspace_mismatch",
      }),
    /okf_export_workspace_mismatch/,
  );
});

test("assertActionDocumentWorkspace rejects typed relation updates for another workspace", () => {
  assert.throws(
    () =>
      assertActionDocumentWorkspace({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        document: { workspaceId: "wrk_2" },
        mismatchError: "okf_export_workspace_mismatch",
      }),
    /okf_export_workspace_mismatch/,
  );
});

test("normalizeClassificationCode accepts ATA-style and free-form codes", () => {
  assert.equal(normalizeClassificationCode("32"), "32");
  assert.equal(normalizeClassificationCode("32-41-11"), "32-41-11");
  assert.equal(normalizeClassificationCode("Section 4.2"), "Section 4.2");
  assert.equal(normalizeClassificationCode("N/A"), "N/A");
});

test("normalizeClassificationCode rejects overly long values", () => {
  assert.throws(
    () => normalizeClassificationCode("x".repeat(65)),
    /classification_code_too_long/,
  );
});

test("normalizeClassificationCode keeps empty classification code nullable", () => {
  assert.equal(normalizeClassificationCode(""), null);
  assert.equal(normalizeClassificationCode(null), null);
});
