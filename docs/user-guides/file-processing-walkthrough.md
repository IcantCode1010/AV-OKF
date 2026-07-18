# AV-OKF File Processing Walkthrough

This walkthrough explains how to take one PDF from upload through extraction, topic review, OKF export, and search.

## Before You Start

You need a PDF file ready to upload. For the best results, use a real document with selectable text, clear headings, and page structure.

Some features depend on the production backend:

- Upload, extraction, topic generation, metadata editing, and OKF export work in the current app flow.
- RAG indexing, admin reindex, and production queue behavior depend on the Postgres, Redis, worker, and object storage setup.

## Step 1: Open The Document Library

Go to:

```text
/documents
```

The document library is where uploaded files are listed. It also contains the PDF upload form.

## Step 2: Upload The PDF

In the **Upload PDF** form, enter the document details:

- Title
- Owner
- Source type
- Tags
- Description
- PDF file

Click **Upload PDF**.

The system validates the file, stores it, creates a document record, and sends you to the document detail page.

## Step 3: Wait For Extraction

On the document detail page, find the **Extraction** panel.

The normal extraction status flow is:

```text
queued -> running -> completed
```

The page refreshes while extraction is running. When extraction completes, the document should show page records, extracted text, logs, and document readiness details.

If extraction fails, the document shows a blocked or failed state with an error message. You can retry extraction from the document detail page.

## Step 4: Generate Topic Records

After extraction is completed, go to the **Topic records** section.

Click **Generate topics**.

The system reviews the extracted page text and creates draft topic records. These topics are based on document structure, headings, page ranges, and fallback grouping when headings are unclear.

New topics usually start with this review status:

```text
needs_review
```

## Step 5: Review The Topics

Review each topic and decide what should happen to it.

Possible review states:

```text
needs_review
needs_cleanup
approved
rejected
```

Only approved topics can be exported to OKF.

Use **approved** for topics that are accurate enough to become structured knowledge. Use **rejected** for topics that should not be exported. Use **needs_cleanup** when the topic is close but still needs human correction later.

## Step 6: Complete Export Metadata

Before exporting an approved topic, make sure the document has the required OKF metadata.

Fill in:

- Aircraft family
- Manual type
- ATA
- Effectivity
- Source authority
- Revision

ATA must use one of these formats:

```text
32
32-41
32-41-11
```

If required metadata is missing, the OKF export will stop and tell you which fields need to be completed. The system does not guess these values.

## Step 7: Export An Approved Topic To OKF

For an approved topic, click **Export to OKF**.

The system creates a Markdown OKF file in the knowledge bundle. It also updates the bundle index, source manifest, and log.

The exported OKF file includes:

- Topic title
- Topic summary
- Source document name
- Source page numbers
- Document metadata
- Review status
- Last verified date

The exported topic should validate against the OKF profile and relation linter.

## Step 8: Add Typed Relations Optional

After a topic is approved, you can add typed relations to other exported OKF files.

A relation explains how one exported knowledge file connects to another.

Examples:

```text
routes_to
references
supports
covered_by
supersedes
conflicts_with
depends_on
```

Each relation needs:

- Relation type
- Target OKF file
- Target type
- Reason

After adding a relation, export the topic again so the relation is written into the OKF file.

## Step 9: Search The Document

Go to:

```text
/search
```

Search for a phrase, keyword, ATA reference, procedure term, or equipment name from the document.

Search results should show:

- Matching excerpt
- Document title
- Page citation
- Retrieval mode
- Review status

This confirms the document is available through the retrieval path.

## Step 10: Reindex If Needed

If the document needs a fresh RAG index, go to:

```text
/admin/reindex
```

This page is for rebuilding chunks and embeddings for one document at a time.

For the document:

1. Review the file size, current strategy, chunk count, last indexed date, and status.
2. Pick the chunking strategy.
3. Click **Reindex**.

Only one reindex job can run at a time in the workspace.

The current default chunking strategy is:

```text
paragraph-context-v2
```

If a document was indexed before strategy tracking existed, the strategy may show as:

```text
unknown
```

## Complete Happy Path

The full file processing flow is:

```text
Upload PDF
-> Wait for extraction
-> Generate topic records
-> Review and approve a topic
-> Complete export metadata
-> Export approved topic to OKF
-> Add typed relations if needed
-> Search the document
-> Reindex if needed
```

## Finished Result

After the process is complete, the user has:

- A stored PDF document
- Extracted page text
- Reviewed topic records
- At least one exported OKF Markdown file
- A searchable RAG index when production indexing is enabled
- Optional typed relations between OKF files
- A knowledge bundle that can be validated
