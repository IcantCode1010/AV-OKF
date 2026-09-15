import path from "node:path";

export function markdownLink(fromPath: string, toPath: string, title: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromPath), toPath);
  const href = relative.startsWith(".") ? relative : `./${relative}`;
  return `[${title.replace(/[\[\]\r\n]/g, " ")}](${href})`;
}
