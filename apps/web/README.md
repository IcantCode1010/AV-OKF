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
- Settings shell

## Local Storage

Stage 1 persists local development data under `apps/web/.data/`:

- `document-vault.json` stores document metadata and activity.
- `uploads/` stores uploaded PDFs using opaque UUID-based storage keys.

This directory is ignored by git. The JSON file store is a temporary Stage 1 stand-in, not a long-term backend. A later stage should deliberately replace it with a real database and object storage service.
