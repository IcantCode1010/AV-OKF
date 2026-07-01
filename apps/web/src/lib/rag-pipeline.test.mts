import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicEmbeddingProvider } from "./embedding-provider.ts";
import { extractPdfPages } from "./pdf-text-extractor.ts";
import { chunkExtractedPages } from "./rag-chunker.ts";

test("real PDF extraction can be chunked and embedded without API calls", async () => {
  const pdfBytes = Buffer.from(
    "%PDF-1.3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 72 >>\nstream\nBT /F1 14 Tf 40 240 Td (Generator Control Unit) Tj 0 -24 Td (Fault isolation procedure) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000363 00000 n \ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n433\n%%EOF",
  );
  const pages = await extractPdfPages(pdfBytes);
  const chunks = chunkExtractedPages({
    documentId: "doc_real",
    indexJobId: "job_real",
    indexVersion: 1,
    pages,
    workspaceId: "wrk_1",
  });
  const provider = createDeterministicEmbeddingProvider();
  const embeddings = await provider.embedTexts(
    chunks.map((chunk) => chunk.text),
  );

  assert.equal(chunks.length > 0, true);
  assert.equal(embeddings.length, chunks.length);
  assert.equal(embeddings[0]?.length, 1536);
  assert.equal(chunks[0]?.sourcePageNumbers.includes(1), true);
});
