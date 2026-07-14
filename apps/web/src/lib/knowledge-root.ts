import { realpath } from "node:fs/promises";
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

export async function resolveKnowledgePath(input: {
  basePath?: string;
  knowledgeRoot: string;
  relativePath: string;
}): Promise<string | null> {
  const boundaryRoot = path.resolve(input.knowledgeRoot);
  const basePath = path.resolve(input.basePath ?? boundaryRoot);
  const candidate = path.resolve(basePath, input.relativePath);

  if (!isWithinPath(candidate, boundaryRoot)) {
    return null;
  }

  const realBoundaryRoot = await realpath(boundaryRoot).catch(() => null);
  if (!realBoundaryRoot) {
    return candidate;
  }

  const realCandidate = await realpath(candidate).catch(async (error: unknown) => {
    if (!isMissingPathError(error)) {
      return null;
    }

    const realParent = await realpath(path.dirname(candidate)).catch(() => null);
    return realParent && isWithinPath(realParent, realBoundaryRoot)
      ? candidate
      : null;
  });

  return realCandidate && isWithinPath(realCandidate, realBoundaryRoot)
    ? realCandidate
    : null;
}

function isWithinPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
