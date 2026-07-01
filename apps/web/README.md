# AV-OKF Web

Stage 1 product shell and local document vault for the AV-OKF document intelligence platform.

## Commands

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

## Current Scope

- Mock auth and workspace context
- Seeded demo documents
- Dashboard shell
- PDF upload through Server Actions
- Local file storage abstraction
- Document library
- Editable document metadata, tags, custom properties, and processing status
- Local in-process PDF extraction with page records and extraction logs
- Settings shell

## Local Storage

Stage 1 persists local development data under `apps/web/.data/`:

- `document-vault.json` stores document metadata and activity.
- `uploads/` stores uploaded PDFs using opaque UUID-based storage keys.

This directory is ignored by git. The JSON file store is a temporary Stage 1 stand-in, not a long-term backend. A later stage should deliberately replace it with a real database and object storage service.

## Extraction Jobs

Stage 2 starts PDF extraction as a detached in-process task after upload or manual extraction. The document detail page polls while extraction is queued or running.

This local background approach assumes a long-lived Node process. It is not safe as-is for serverless deployment because the process may stop before detached extraction finishes. Replace it with a durable queue or worker before production-style deployment.
