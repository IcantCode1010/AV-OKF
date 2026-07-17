import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const args = process.argv.slice(2);
const workspaceId = readArg("--workspace");
const apply = args.includes("--apply");
if (!workspaceId) throw new Error("migration_requires_explicit_workspace_id");

const vaultRoot = path.resolve(process.env.AV_OKF_KNOWLEDGE_ROOT ?? path.join(process.cwd(), "../../knowledge"));
const workspaceRoot = path.join(vaultRoot, "workspaces", workspaceId);
const journalPath = path.join(workspaceRoot, "migration-journal.json");

try {
  const bundle = await db.knowledgeBundle.findFirst({
    where: { slug: "general", workspaceId },
  });
  if (!bundle) throw new Error("general_knowledge_bundle_not_found");
  const bundleRoot = path.join(workspaceRoot, "bundles", bundle.id);
  const entries = await readdir(vaultRoot, { withFileTypes: true });
  const legacyFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
  const conceptFiles = legacyFiles.filter((file) => !["index.md", "log.md", "source_manifest.md"].includes(file));
  const mapping = new Map(conceptFiles.map((file) => [file, `concepts/system-topic/${file}`]));
  const plan = {
    apply,
    bundleId: bundle.id,
    files: [...mapping.entries()].map(([from, to]) => ({ from, to })),
    workspaceId,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!apply) process.exit(0);

  await mkdir(bundleRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const backupRoot = `${vaultRoot}-pre-vault-${Date.now()}`;
  await cp(vaultRoot, backupRoot, { recursive: true });
  await writeFile(journalPath, `${JSON.stringify({ ...plan, backupRoot, status: "running" }, null, 2)}\n`);

  for (const file of legacyFiles) {
    const source = path.join(vaultRoot, file);
    const relativeTarget = mapping.get(file) ?? file;
    const target = path.join(bundleRoot, relativeTarget);
    await mkdir(path.dirname(target), { recursive: true });
    let content = await readFile(source, "utf8");
    content = content.replace(/^last_verified:/m, "updated:");
    for (const [oldPath, newPath] of mapping) {
      content = content
        .replaceAll(`target: ${JSON.stringify(oldPath)}`, `target: ${JSON.stringify(newPath)}`)
        .replaceAll(`](${oldPath})`, `](${newPath})`);
    }
    await writeFile(target, content, "utf8");
  }

  await db.$transaction(async (tx) => {
    for (const [oldPath, newPath] of mapping) {
      await tx.topicRecord.updateMany({ data: { exportedFilePath: newPath }, where: { exportedFilePath: oldPath, knowledgeBundleId: bundle.id } });
      await tx.okfConceptLifecycle.updateMany({ data: { filePath: newPath }, where: { filePath: oldPath, knowledgeBundleId: bundle.id } });
      await tx.okfRelationCandidate.updateMany({ data: { sourceFile: newPath }, where: { sourceFile: oldPath, knowledgeBundleId: bundle.id } });
      await tx.okfRelationCandidate.updateMany({ data: { targetFile: newPath }, where: { targetFile: oldPath, knowledgeBundleId: bundle.id } });
    }
    const messages = await tx.chatMessage.findMany({ where: { workspaceId }, select: { citations: true, id: true } });
    for (const message of messages) {
      if (!Array.isArray(message.citations)) continue;
      const citations = message.citations.map((citation) => {
        if (!citation || typeof citation !== "object" || Array.isArray(citation)) return citation;
        const record = citation as Record<string, unknown>;
        const mapped = typeof record.okfFilePath === "string" ? mapping.get(record.okfFilePath) : undefined;
        return mapped ? { ...record, okfFilePath: mapped } : record;
      });
      await tx.chatMessage.update({ data: { citations: citations as Prisma.InputJsonValue }, where: { id: message.id } });
    }
  });

  const logPath = path.join(bundleRoot, "log.md");
  const log = await readFile(logPath, "utf8").catch(() => "# Change Log\n");
  await writeFile(logPath, `${log.trimEnd()}\n\n- ${new Date().toISOString().slice(0, 10)} - migrated - legacy single bundle to General Knowledge\n`);
  await writeFile(journalPath, `${JSON.stringify({ ...plan, backupRoot, status: "completed" }, null, 2)}\n`);
} finally {
  await db.$disconnect();
}

function readArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
