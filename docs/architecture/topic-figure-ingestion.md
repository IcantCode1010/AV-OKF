# Topic Figure Ingestion

AV-OKF can associate technical figures and diagrams with topics during guided document authoring. The feature is disabled by default per knowledge bundle.

## Pipeline

1. PDF extraction marks pages containing raster images or figure/diagram caption text as visual candidates.
2. Topic discovery creates the normal text-grounded topic records.
3. The `media_discovery` authoring stage renders candidate pages temporarily at 300 DPI and limits the longest edge to 4096 pixels.
4. The configured multimodal provider receives only the candidate page image, page text, caption hints, and exact-page topic IDs. Kimi K3 is available through Moonshot AI's OpenAI-compatible endpoint.
5. Structured output identifies up to 10 figures or diagrams per page, normalized bounding boxes, labels, descriptions, and topic associations.
6. AV-OKF crops each figure, runs local OCR, stores the PNG crop in object storage, and deletes the temporary page render.
7. Reviewers can approve, reject, edit, or reassign each topic association. Approved crops can be supplied to topic enrichment.
8. Topic export copies approved crops to `resources/media`, writes `av_okf_media` extension metadata, and adds a Markdown `Figures` section.

Media failures are audited per page and do not block text ingestion or topic authoring. Existing documents are not backfilled automatically.

## Approval Gate

Automatic approval is limited to the primary association and requires all of the following:

- Bundle auto-approval is enabled.
- Confidence meets the configured threshold, which cannot be lower than `0.95`.
- Confidence exceeds the next association by at least `0.15`.
- The topic cites the exact source page.
- At least one deterministic anchor term appears in source evidence.
- Visible labels are supported by page text or local crop OCR.
- The source document hash is current and the analysis has no warnings.

All additional associations remain `pending_review`. A source hash mismatch changes an approved reference to `stale` before enrichment or export.

## Bundle Settings

- `media.topicFiguresEnabled`: enables candidate-page visual analysis.
- `media.autoApproveHighConfidenceEnabled`: enables the strict primary-association gate.
- `media.autoApproveThreshold`: approval confidence threshold in the range `0.95` to `1.0`.

## Runtime Dependencies

The worker requires Poppler (`pdftoppm`), ImageMagick (`convert` and `identify`), and Tesseract. Only PNG figure crops are durable; full-page renders remain temporary scratch files.
