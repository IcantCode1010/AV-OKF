const CHAT_SESSION_RETURN_PATTERN = /^\/chat\/[A-Za-z0-9-]+$/;

export function normalizeOkfTopicReturnTo(value: string | null | undefined): string {
  return typeof value === "string" && CHAT_SESSION_RETURN_PATTERN.test(value)
    ? value
    : "/chat";
}

export function normalizeOkfTopicFilePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  let candidate = value.trim();
  if (!candidate) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      return null;
    }
  }

  candidate = candidate.replaceAll("\\", "/");
  if (
    !candidate ||
    candidate.includes("\0") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.startsWith("//") ||
    candidate.startsWith("/") ||
    /(^|\/)\.\.(\/|$)/.test(candidate)
  ) {
    return null;
  }

  const normalized = candidate
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

  if (
    !normalized ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..") ||
    normalized.startsWith("/") ||
    !normalized.endsWith(".md")
  ) {
    return null;
  }

  return normalized;
}

export function buildOkfTopicViewHref(input: {
  bundleId: string;
  filePath: string;
  returnTo?: string | null;
}): string {
  const params = new URLSearchParams({
    file: input.filePath,
    returnTo: normalizeOkfTopicReturnTo(input.returnTo),
  });
  return `/knowledge/${encodeURIComponent(input.bundleId)}/topic?${params.toString()}`;
}
