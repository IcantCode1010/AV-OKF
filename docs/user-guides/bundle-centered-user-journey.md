# Bundle-Centered User Journey

## Aviation metadata and enrichment

1. Upload the aviation document with its aircraft and audience metadata. Set
   Maintenance ATA chapters and Pilot QRH categories separately when known.
2. Document metadata discovery may fill missing scope from source headings.
   Check uncertain aircraft applicability in Document > Metadata; entered values
   are not silently replaced.
3. In bundle Review, choose **1. Bulk enrichment**, select topics, and use
   **Enrich selected topics**. Work runs in the background with Activity progress.
   Failed topics remain retryable; other topics can finish independently.
4. Use **2. Review and approve** for completed drafts. For a multi-section manual,
   set the topic's Maintenance ATA chapter or Pilot QRH target if source headings
   do not resolve one uniquely. Keep it within the document scope.
5. EFB selection uses the saved metadata and the EFB-owned registry. Correct
   missing, conflicting or unsupported metadata before export. Approval, signing
   and release validation still follow the existing export mode.

Existing documents do not need re-uploading. Save corrected metadata before
enrichment; unapproved topics inherit edits. Existing approved topics and packages
are not silently rewritten.

1. Select an active knowledge bundle in the persistent sidebar.
2. Open **Workflow** to see the bundle's current stage and its single
   recommended next action, from adding documents through retrieval testing.
3. Use **Chat** to resume the bundle's latest conversation or start a new one.
4. Use **Browse** to filter the physical OKF tree and read a concept with its
   trust, provenance, sources, relations, and backlinks.
5. Use **Graph** to explore approved typed relations. The selected concept is
   preserved when moving between Browse and Graph.
6. Use **Documents** to upload into the active bundle or switch between This
   bundle, Unassigned, and All workspace documents.
7. Follow each document's Processing panel through extraction, discovery,
   enrichment, validation, and its review or automatic-publication handoff.
8. Use **Review** for actionable topics and captured knowledge gaps.
9. After publishing, optionally use **Topic expansion** to research every
   approved topic with bounded hybrid RAG, inspect up to 10 grounded missing-
   topic proposals, and send selected proposals through normal enrichment and
   Review.
10. Use **Relations** for deterministic discovery, LLM verification, and the
   required human approval step.
11. Use **Activity** to monitor current processing and attention-required work
   across the bundle.
12. Use **Bundle settings** for profile versions, automation, lifecycle file
    management, and permanent bundle deletion.

Changing the active bundle updates future navigation and new chats. It does not
rewrite an open conversation or its selected knowledge sources.
