import { Queue, Worker } from "bullmq";
import { getPrisma } from "../prisma.ts";
import { processClassification } from "./efb-classification.ts";
export function startClassificationWorker(
  redisUrl: string,
  classify: (id: string) => Promise<void> = processClassification,
) {
  const connection = { url: redisUrl },
    name = "efb-article-classification";
  const queue = new Queue<{ id: string }>(name, { connection });
  const worker = new Worker<{ id: string }>(
    name,
    async (job) => {
      if (job.name === "export") {
        const db = getPrisma(),
          release = await db.knowledgeExportRelease.findUniqueOrThrow({
            where: { id: job.data.id },
          });
        const { exportSelectedArticles } = await import("./export.ts");
        try {
          await exportSelectedArticles(
            {
              workspaceId: release.workspaceId,
              userId: release.createdBy,
              role: "member",
            },
            undefined,
            release.id,
          );
        } catch (error) {
          await db.knowledgeExportRelease.updateMany({
            where: { id: release.id, status: { in: ["queued", "validating"] } },
            data: {
              status: "failed",
              error: "export_failed_check_configuration_or_sources",
            },
          });
          throw error;
        }
      } else await classify(job.data.id);
    },
    { connection, concurrency: 1 },
  );
  worker.on("error", () =>
    console.error("EFB classification worker unavailable"),
  );
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      if (process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED === "true")
        for (const row of await getPrisma().knowledgeEfbClassification.findMany(
          {
            where: { status: "queued" },
            take: 100,
            orderBy: { createdAt: "asc" },
          },
        )) {
          await queue.add(
            "classify",
            { id: row.id },
            {
              jobId: row.id,
              attempts: 3,
              backoff: { type: "exponential", delay: 2000 },
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        }
      if (process.env.AV_OKF_EFB_BULK_EXPORT_ENABLED === "true")
        for (const row of await getPrisma().knowledgeExportRelease.findMany({
          where: { status: { in: ["queued", "validating"] } },
          take: 20,
          orderBy: { createdAt: "asc" },
        })) {
          await queue.add(
            "export",
            { id: row.id },
            {
              jobId: `export-${row.id}`,
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        }
    } catch {
      console.error("EFB classification reconciliation unavailable");
    } finally {
      reconciling = false;
    }
  };
  const timer = setInterval(() => void reconcile(), 15000);
  timer.unref();
  void reconcile();
  return {
    close: async () => {
      clearInterval(timer);
      await worker.close();
      await queue.close();
    },
  };
}
