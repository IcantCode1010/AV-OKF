import path from "node:path";

export function getDefaultKnowledgeRoot(cwd = process.cwd()): string {
  if (process.env.AV_OKF_KNOWLEDGE_ROOT) {
    return path.resolve(process.env.AV_OKF_KNOWLEDGE_ROOT);
  }

  if (path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "apps") {
    return path.resolve(cwd, "..", "..", "knowledge");
  }

  return path.resolve(cwd, "knowledge");
}
