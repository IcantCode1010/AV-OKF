import { z } from "zod";
const refs = z.array(z.string().min(1)).min(1).max(20);
export const diagramSchema = z.object({
  title: z.string().min(1).max(150),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        label: z.string().min(1).max(80),
        x: z.number().min(10).max(750),
        y: z.number().min(30).max(550),
        evidenceIds: refs,
      }),
    )
    .min(1)
    .max(20),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: z
          .enum(["flow", "control", "mechanical", "electrical", "conceptual"])
          .default("conceptual"),
        label: z.string().max(60),
        evidenceIds: refs,
      }),
    )
    .max(40),
});
// Generation requires every property; editor input retains its legacy default.
export const generatedDiagramSchema = diagramSchema.extend({
  edges: z
    .array(
      diagramSchema.shape.edges.element.extend({
        kind: diagramSchema.shape.edges.element.shape.kind.removeDefault(),
      }),
    )
    .max(40),
});
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const annotationSchema = z
  .array(
    z
      .object({
        label: z.string().min(1).max(80),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
        evidenceIds: refs,
      })
      .refine((a) => a.x + a.width <= 1 && a.y + a.height <= 1),
  )
  .max(20);
export function renderAnnotations(
  raw: unknown,
  knownEvidence: string[],
  width: number,
  height: number,
) {
  const annotations = annotationSchema.parse(raw),
    known = new Set(knownEvidence);
  if (annotations.some((a) => a.evidenceIds.some((id) => !known.has(id))))
    throw Error("annotation_unknown_evidence");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${annotations.map((a) => `<rect x="${a.x * width}" y="${a.y * height}" width="${a.width * width}" height="${a.height * height}" fill="none" stroke="#e77600" stroke-width="4"/><text x="${a.x * width + 5}" y="${a.y * height + 22}" font-family="sans-serif" font-size="18" fill="#943900" stroke="white" stroke-width="0.5">${escape(a.label)}</text>`).join("")}</svg>`;
}
function wrapLabel(label: string) {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    if ((line + " " + word).trim().length > 18 && line) {
      lines.push(line);
      line = "";
    }
    if (word.length > 18) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const parts = word.match(/.{1,18}/g) ?? [];
      lines.push(...parts.slice(0, -1));
      line = parts.at(-1) ?? "";
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}
export function renderDiagram(raw: unknown, knownEvidence: string[]) {
  const spec = diagramSchema.parse(raw),
    nodes = new Map(spec.nodes.map((n) => [n.id, n])),
    known = new Set(knownEvidence);
  if (nodes.size !== spec.nodes.length) throw Error("diagram_duplicate_nodes");
  for (const item of [...spec.nodes, ...spec.edges])
    if (item.evidenceIds.some((id) => !known.has(id)))
      throw Error("diagram_unknown_evidence");
  const edges = spec.edges
    .map((e) => {
      const a = nodes.get(e.from),
        b = nodes.get(e.to);
      if (!a || !b || a.id === b.id) throw Error("diagram_invalid_edge");
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.min(
          70 / Math.max(Math.abs(dx), 0.000001),
          38 / Math.max(Math.abs(dy), 0.000001),
        );
      return `<path d="M ${a.x + 70 + dx * t} ${a.y + 38 + dy * t} L ${b.x + 70 - dx * t} ${b.y + 38 - dy * t}" stroke="#345" stroke-width="2" marker-end="url(#arrow)"/><text x="${(a.x + b.x) / 2 + 70}" y="${(a.y + b.y) / 2 + 12}" font-size="13">${escape(e.label)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 640" role="img"><title>${escape(spec.title)} — conceptual diagram</title><rect width="920" height="640" fill="white"/><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#345"/></marker></defs><g font-family="sans-serif" fill="#123"><text x="20" y="22" font-size="16">${escape(spec.title.length > 85 ? spec.title.slice(0, 82) + "…" : spec.title)} (conceptual)</text>${edges}${spec.nodes
    .map(
      (n) =>
        `<rect x="${n.x}" y="${n.y}" width="140" height="76" rx="8" fill="#eef4fa" stroke="#345"/><text x="${n.x + 8}" y="${n.y + 28}" font-size="13">${wrapLabel(
          n.label,
        )
          .map(
            (line, i) =>
              `<tspan x="${n.x + 8}" y="${n.y + 16 + i * 13}">${escape(line)}</tspan>`,
          )
          .join("")}</text>`,
    )
    .join("")}</g></svg>`;
}
