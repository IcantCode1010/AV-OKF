import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPrisma } from "../prisma.ts";
import {
  requestClassification,
  processClassification,
  currentClassification,
  selectClassifiedRevision,
} from "./efb-classification.ts";
import { exportSelectedArticles } from "./export.ts";
import { executeEditorialAction } from "./workflow.ts";
import { startClassificationWorker } from "./efb-classification-queue.ts";
import { getObjectStorage } from "../production-storage.ts";
import { fingerprint } from "../topic-builder-core.ts";
import { evaluateClassification } from "./efb-classification-policy.ts";
import { loadProjectEfbContractRegistry } from "../project-efb-contract-registry.ts";
import type { Prisma } from "@prisma/client";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
test(
  "classification binds to a revision, approval and source metadata; batch snapshot rejects drift",
  { skip: !process.env.EFB_WORKFLOW_TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.EFB_WORKFLOW_TEST_DATABASE_URL;
    const db = getPrisma(),
      suffix = randomUUID();
    const user = await db.user.create({
      data: { email: `efb-${suffix}@example.invalid` },
    });
    const workspace = await db.workspace.create({
      data: { name: `EFB integration fixture ${suffix}` },
    });
    const context = {
      workspaceId: workspace.id,
      userId: user.id,
      role: "admin" as const,
    };
    await db.workspaceMember.create({ data: { ...context } });
    const quote =
      "737-800 ATA 29 hydraulic system description for maintenance personnel. This fictional fixture explains the supply and return paths for a training actuator. The supply path delivers fluid to the actuator, and the return path carries fluid back to the reservoir. This article is an educational example only, with no operational instructions or dispatch authority.";
    const d = await db.document.create({
      data: {
        workspaceId: workspace.id,
        title: "Test source",
        fileType: "txt",
        mimeType: "text/plain",
        size: "1 KB",
        sizeBytes: quote.length,
        status: "ready",
        tags: [],
        updatedLabel: "now",
        owner: "Test",
        sourceType: "aviation",
        revision: "1",
        aircraftFamilyIds: ["737-ng"],
        aircraftTypeIds: ["b738"],
        applicabilityStatus: "manual_override",
      },
    });
    await db.extractedPage.create({
      data: {
        workspaceId: workspace.id,
        documentId: d.id,
        pageNumber: 1,
        text: quote,
        tables: [],
        imageCount: 0,
        charCount: quote.length,
      },
    });
    const a = await db.knowledgeArticle.create({
      data: {
        id: `a-${suffix}`,
        workspaceId: workspace.id,
        originKind: "test",
        originId: suffix,
      },
    });
    const evidence = [
      {
        id: "e",
        documentId: d.id,
        documentTitle: d.title,
        page: 1,
        quote,
        revision: "1",
      },
    ];
    const r = await db.knowledgeArticleRevision.create({
      data: {
        id: `r-${suffix}`,
        articleId: a.id,
        workspaceId: workspace.id,
        body: {
          id: a.id,
          title: "Hydraulics",
          answer: quote,
          keyPoints: [],
          details: [],
        },
        evidence: json(evidence),
        sourceFingerprint: "test",
        policyVersion: "test",
      },
    });
    const scratch = await mkdtemp(path.join(tmpdir(), "efb-integration-"));
    process.env.S3_ACCESS_KEY_ID = "fixture";
    process.env.S3_SECRET_ACCESS_KEY = "fixture";
    process.env.S3_BUCKET = "fixture";
    process.env.S3_ENDPOINT = "http://127.0.0.1:1";
    const storage = getObjectStorage(),
      originalGet = storage.getObject;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZr0AAAAASUVORK5CYII=",
      "base64",
    );
    storage.getObject = async () => png;
    try {
      assert.equal(r.version, 1);
      const job = await requestClassification(context, r.id);
      assert.equal((await requestClassification(context, r.id)).id, job.id);
      const evaluated = evaluateClassification(
        await loadProjectEfbContractRegistry(),
        evidence,
        [d],
        {
          audiences: ["maintenance"],
          ataChapter: "29",
          qrhTargetId: null,
          rationale: "Hydraulic system",
          ambiguous: false,
          evidence: [
            { field: "audience", id: "e", quote },
            { field: "ata", id: "e", quote },
          ],
        },
      );
      assert.equal(evaluated.status, "ready");
      let calls = 0;
      const predict = async () => {
        calls++;
        return {
          provider: "fixture",
          model: "fixture",
          output: {
            audiences: ["maintenance" as const],
            ataChapter: "29",
            qrhTargetId: null,
            rationale: "Hydraulic system",
            ambiguous: false,
            evidence: [
              { field: "audience" as const, id: "e", quote },
              { field: "ata" as const, id: "e", quote },
            ],
          },
        };
      };
      await processClassification(job.id, predict);
      await processClassification(job.id, predict);
      assert.equal(calls, 1);
      assert.equal(
        (await currentClassification(context, r.id))?.status,
        "ready",
      );
      assert.equal(await selectClassifiedRevision(context, r.id), false);
      await db.knowledgeVisual.create({
        data: {
          workspaceId: workspace.id,
          articleRevisionId: r.id,
          kind: "source",
          spec: {},
          provenance: {
            objectKey: `workspaces/${workspace.id}/article-visuals/fixture.png`,
            hash: fingerprint([...png]),
          },
          caption: "Fictional source figure",
          altText: "Fixture pixel",
          reviewedAt: new Date(),
          reviewedBy: user.id,
        },
      });
      process.env.AV_OKF_SHARED_ENABLED = "true";
      process.env.AV_OKF_EXPORT_ENABLED = "true";
      process.env.AV_OKF_EFB_AUTO_SELECT_ENABLED = "true";
      const approve = new FormData();
      approve.set("action", "approve");
      approve.set("revisionId", r.id);
      await executeEditorialAction(context, approve);
      assert.equal(await selectClassifiedRevision(context, r.id), true);
      const selection = await db.knowledgeEfbSelection.findFirstOrThrow({
        where: { workspaceId: workspace.id },
      });
      process.env.AV_OKF_EFB_BULK_EXPORT_ENABLED = "true";
      const keys = generateKeyPairSync("ed25519");
      const keyPath = path.join(scratch, "key.pem");
      await writeFile(
        keyPath,
        keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      );
      process.env.AV_OKF_EFB_SIGNING_KEY_PATH = keyPath;
      process.env.AV_OKF_EFB_RELEASE_ROOT = path.join(scratch, "exports");
      process.env.AV_OKF_EFB_SIGNING_KEY_ID = "test";
      const releaseId = await exportSelectedArticles(context, [selection.id]);
      assert.equal(
        await exportSelectedArticles(context, undefined, releaseId),
        releaseId,
      );
      const exported = await db.knowledgeExportRelease.findUniqueOrThrow({
        where: { id: releaseId },
      });
      assert.equal(exported.status, "exported");
      const edit = new FormData();
      edit.set("action", "edit");
      edit.set("revisionId", r.id);
      edit.set("title", "Hydraulics updated");
      edit.set("answer", quote);
      edit.set("changeReason", "Clarify the training description");
      await executeEditorialAction(context, edit);
      const edited = await db.knowledgeArticleRevision.findFirstOrThrow({
        where: { articleId: a.id },
        orderBy: { version: "desc" },
      });
      assert.equal(edited.version, 2);
      assert.equal(edited.parentRevisionId, r.id);
      assert.equal(edited.approval, null);
      assert.equal(
        await exportSelectedArticles(context, undefined, releaseId),
        releaseId,
      );
      const staleReleaseId = await exportSelectedArticles(context, [
        selection.id,
      ]);
      await db.document.update({
        where: { id: d.id },
        data: { aircraftTypeIds: [] },
      });
      assert.equal(await currentClassification(context, r.id), null);
      await assert.rejects(
        exportSelectedArticles(context, undefined, staleReleaseId),
        /article_preflight_failed/,
      );
      const failed = await db.knowledgeExportRelease.findUniqueOrThrow({
        where: { id: staleReleaseId },
      });
      assert.equal(failed.status, "validation_failed");
      assert.match(JSON.stringify(failed.result), /classification_changed/);
      if (process.env.EFB_WORKFLOW_TEST_REDIS_URL) {
        process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED = "true";
        const nextJob = await requestClassification(context, r.id);
        let attempts = 0;
        const worker = startClassificationWorker(
          process.env.EFB_WORKFLOW_TEST_REDIS_URL,
          async (id) =>
            processClassification(id, async () => {
              attempts++;
              if (attempts < 3)
                throw Error("fixture_transient_provider_failure");
              return predict();
            }),
        );
        try {
          const deadline = Date.now() + 20000;
          let state = "queued";
          while (state === "queued" && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            state = (
              await db.knowledgeEfbClassification.findUniqueOrThrow({
                where: { id: nextJob.id },
              })
            ).status;
          }
          assert.equal(attempts, 3);
          assert.equal(state, "needs_review");
        } finally {
          await worker.close();
        }
      }
      await assert.rejects(
        requestClassification({ ...context, workspaceId: "other" }, r.id),
        /article_unavailable/,
      );
    } finally {
      storage.getObject = originalGet;
      await db.knowledgeVisual.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.knowledgeExportRelease.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.knowledgeEfbSelection.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.knowledgeEfbClassification.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.knowledgeArticleRevision.deleteMany({
        where: { articleId: a.id },
      });
      await db.knowledgeArticle.delete({ where: { id: a.id } });
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
