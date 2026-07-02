import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActionDocumentWorkspace,
  normalizeAtaMetadata,
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

test("normalizeAtaMetadata accepts ATA chapter, section, and subject formats", () => {
  assert.equal(normalizeAtaMetadata("32"), "32");
  assert.equal(normalizeAtaMetadata("32-41"), "32-41");
  assert.equal(normalizeAtaMetadata("32-41-11"), "32-41-11");
});

test("normalizeAtaMetadata rejects malformed ATA values", () => {
  for (const value of ["3", "32-411", "abc"]) {
    assert.throws(() => normalizeAtaMetadata(value), /invalid_ata_format/);
  }
});

test("normalizeAtaMetadata keeps empty ATA metadata nullable", () => {
  assert.equal(normalizeAtaMetadata(""), null);
  assert.equal(normalizeAtaMetadata(null), null);
});
