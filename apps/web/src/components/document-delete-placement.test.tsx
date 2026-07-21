import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentHeaderDeleteRow } from "./document-header-delete-row.tsx";
import { DocumentMetadataPanel } from "./document-detail/document-detail-panels.tsx";
import type { Document } from "../lib/document-backend.ts";

const documentFixture: Document = {
  classificationCode: null,
  customProperties: [],
  description: "Placement test document",
  documentType: null,
  effectivity: null,
  extraction: {
    completedAt: null,
    error: null,
    logs: [],
    pageRecords: [],
    startedAt: null,
    status: "queued",
  },
  fileType: "PDF",
  id: "document-placement-test",
  knowledgeBundleId: "bundle-placement-test",
  mimeType: "application/pdf",
  originalFilename: "placement.pdf",
  owner: "Test owner",
  pages: 0,
  revision: null,
  size: "1 KB",
  sizeBytes: 1024,
  sourceAuthority: null,
  sourceType: "general",
  status: "processing",
  storageKey: "opaque.pdf",
  subjectFamily: null,
  tags: [],
  title: "Placement test",
  updatedAt: "Just now",
  workspaceId: "workspace-placement-test",
};

test("admin delete control renders in the shared header and not metadata content", () => {
  const header = renderToStaticMarkup(
    createElement(DocumentHeaderDeleteRow, {
      deleteError: null,
      documentId: documentFixture.id,
      isAdmin: true,
    }),
  );
  const metadata = renderToStaticMarkup(
    createElement(DocumentMetadataPanel, {
      document: documentFixture,
      metadataError: null,
    }),
  );

  assert.match(header, /data-document-delete-location="header"/);
  assert.match(header, /Permanently delete document/);
  assert.doesNotMatch(metadata, /Permanently delete document/);
});

test("non-admin delete control renders in neither document surface", () => {
  const header = renderToStaticMarkup(
    createElement(DocumentHeaderDeleteRow, {
      deleteError: null,
      documentId: documentFixture.id,
      isAdmin: false,
    }),
  );
  const metadata = renderToStaticMarkup(
    createElement(DocumentMetadataPanel, {
      document: documentFixture,
      metadataError: null,
    }),
  );

  assert.equal(header, "");
  assert.doesNotMatch(metadata, /Permanently delete document/);
});
