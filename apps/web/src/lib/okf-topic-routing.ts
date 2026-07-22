const CHAT_SESSION_RETURN_PATTERN = /^\/chat\/[A-Za-z0-9-]+$/;

export function normalizeOkfTopicReturnTo(value: string | null | undefined): string {
  return typeof value === "string" && CHAT_SESSION_RETURN_PATTERN.test(value)
    ? value
    : "/chat";
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
