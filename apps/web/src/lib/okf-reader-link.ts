export type OkfReaderLink =
  | { filename: string; kind: "internal" }
  | { kind: "broken" | "external" };

export function resolveOkfReaderLink(
  sourceFile: string,
  href: string | undefined,
  files: string[],
): OkfReaderLink {
  if (!href) return { kind: "broken" };
  if (/^https?:\/\//i.test(href)) return { kind: "external" };
  if (href.includes("\\") || href.includes("?")) return { kind: "broken" };
  const [rawPath] = href.split("#");
  if (!rawPath) return { kind: "broken" };

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { kind: "broken" };
  }
  if (
    !decoded.endsWith(".md") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)
  ) {
    return { kind: "broken" };
  }

  const parts = decoded.startsWith("/")
    ? decoded.replace(/^\/+/, "").split("/")
    : [...sourceFile.split("/").slice(0, -1), ...decoded.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return { kind: "broken" };
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }

  const filename = normalized.join("/");
  return files.includes(filename)
    ? { filename, kind: "internal" }
    : { kind: "broken" };
}
