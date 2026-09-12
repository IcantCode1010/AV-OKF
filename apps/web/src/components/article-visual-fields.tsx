"use client";
import { useState } from "react";
type Evidence = {
  id: string;
  documentId: string;
  documentTitle?: string;
  page?: number;
  quote?: string;
};
type InitialVisual = {
  kind: string;
  spec: Record<string, unknown>;
  caption: string;
  altText: string;
};
export function ArticleVisualFields({
  evidence,
  initial,
}: {
  evidence: Evidence[];
  initial?: InitialVisual;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "source"),
    [documentId, setDoc] = useState(
      String(initial?.spec.documentId ?? evidence[0]?.documentId ?? ""),
    ),
    [page, setPage] = useState(
      Number(initial?.spec.page ?? evidence[0]?.page ?? 1),
    );
  const [crop, setCrop] = useState({
    x: Number(initial?.spec.x ?? 0) * 100,
    y: Number(initial?.spec.y ?? 0) * 100,
    width: Number(initial?.spec.width ?? 1) * 100,
    height: Number(initial?.spec.height ?? 1) * 100,
  });
  const [nodes, setNodes] = useState(
    (initial?.spec.nodes as
      | Array<{
          id: string;
          label: string;
          x: number;
          y: number;
          evidenceIds: string[];
        }>
      | undefined) ?? [
      { id: "node-1", label: "", x: 40, y: 100, evidenceIds: [] as string[] },
    ],
  );
  const [edges, setEdges] = useState<
    Array<{ from: string; to: string; label: string; evidenceIds: string[] }>
  >(
    (initial?.spec.edges as
      | Array<{
          from: string;
          to: string;
          label: string;
          evidenceIds: string[];
        }>
      | undefined) ?? [],
  );
  const [annotation, setAnnotation] = useState(
    ((initial?.spec.annotations as
      | Array<{
          label: string;
          x: number;
          y: number;
          width: number;
          height: number;
          evidenceIds: string[];
        }>
      | undefined) ?? [])[0] ?? {
      label: "",
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.2,
      evidenceIds: [],
    },
  );
  const [title, setTitle] = useState(String(initial?.spec.title ?? ""));
  const selectEvidence = (value: string, onChange: (id: string) => void) => (
    <label className="block text-sm">
      Supporting passage
      <select
        className="block w-full rounded border bg-background p-2"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select evidence</option>
        {evidence
          .filter((e) => e.id)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.documentTitle ?? e.documentId}, p. {e.page}:{" "}
              {e.quote?.slice(0, 90)}
            </option>
          ))}
      </select>
    </label>
  );
  const spec =
    kind === "source"
      ? {
          documentId,
          page,
          x: crop.x / 100,
          y: crop.y / 100,
          width: crop.width / 100,
          height: crop.height / 100,
          annotations: annotation.label ? [annotation] : [],
        }
      : { title, nodes, edges };
  return (
    <>
      <label>
        Visual treatment
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="block rounded border bg-background p-2"
        >
          <option value="source">Source figure / crop</option>
          <option value="diagram">Editable conceptual diagram</option>
        </select>
      </label>
      <input type="hidden" name="spec" value={JSON.stringify(spec)} />
      {kind === "source" ? (
        <>
          <label className="block">
            Source document
            <select
              value={documentId}
              onChange={(e) => setDoc(e.target.value)}
              className="block w-full rounded border bg-background p-2"
            >
              {[
                ...new Map(evidence.map((e) => [e.documentId, e])).values(),
              ].map((e) => (
                <option key={e.documentId} value={e.documentId}>
                  {e.documentTitle ?? e.documentId}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source page
            <input
              type="number"
              min={1}
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="block rounded border bg-background p-2"
            />
          </label>
          <p className="text-sm">
            Start with the full page. Use percentages to crop while retaining
            legends and conditions.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(crop).map(([key, value]) => (
              <label key={key}>
                {key} (%)
                <input
                  type="number"
                  min={key === "x" || key === "y" ? 0 : 1}
                  max={100}
                  value={value}
                  onChange={(e) =>
                    setCrop({ ...crop, [key]: Number(e.target.value) })
                  }
                  className="block w-full rounded border bg-background p-2"
                />
              </label>
            ))}
          </div>
          <a
            className="underline"
            href={`/documents/${documentId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open original source for comparison
          </a>
          <details>
            <summary>Add a source annotation</summary>
            <label>
              Label
              <input
                maxLength={80}
                value={annotation.label}
                onChange={(e) =>
                  setAnnotation({ ...annotation, label: e.target.value })
                }
                className="block w-full rounded border bg-background p-2"
              />
            </label>
            {annotation.label && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {key} within crop (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={annotation[key] * 100}
                        onChange={(e) =>
                          setAnnotation({
                            ...annotation,
                            [key]: Number(e.target.value) / 100,
                          })
                        }
                        className="block w-full rounded border bg-background p-2"
                      />
                    </label>
                  ))}
                </div>
                {selectEvidence(annotation.evidenceIds[0] ?? "", (id) =>
                  setAnnotation({ ...annotation, evidenceIds: [id] }),
                )}
              </>
            )}
          </details>
        </>
      ) : (
        <>
          <label>
            Diagram title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="block w-full rounded border bg-background p-2"
            />
          </label>
          {nodes.map((n, i) => (
            <fieldset key={n.id} className="space-y-2 rounded border p-3">
              <legend>Component {i + 1}</legend>
              <label>
                Label
                <input
                  required
                  maxLength={80}
                  value={n.label}
                  onChange={(e) =>
                    setNodes(
                      nodes.map((old, j) =>
                        j === i ? { ...old, label: e.target.value } : old,
                      ),
                    )
                  }
                  className="block w-full rounded border bg-background p-2"
                />
              </label>
              <div className="flex gap-2">
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    {axis} position
                    <input
                      type="number"
                      min={axis === "x" ? 10 : 30}
                      max={axis === "x" ? 750 : 550}
                      value={n[axis]}
                      onChange={(e) =>
                        setNodes(
                          nodes.map((old, j) =>
                            j === i
                              ? { ...old, [axis]: Number(e.target.value) }
                              : old,
                          ),
                        )
                      }
                      className="block w-full rounded border bg-background p-2"
                    />
                  </label>
                ))}
              </div>
              {selectEvidence(n.evidenceIds[0] ?? "", (id) =>
                setNodes(
                  nodes.map((old, j) =>
                    j === i ? { ...old, evidenceIds: [id] } : old,
                  ),
                ),
              )}
            </fieldset>
          ))}
          <button
            type="button"
            className="rounded border p-2"
            disabled={nodes.length >= 20}
            onClick={() =>
              setNodes([
                ...nodes,
                {
                  id: `node-${nodes.length + 1}`,
                  label: "",
                  x: 40 + (nodes.length % 3) * 250,
                  y: 100 + Math.floor(nodes.length / 3) * 80,
                  evidenceIds: [],
                },
              ])
            }
          >
            Add component
          </button>
          {edges.map((e, i) => (
            <fieldset key={i} className="space-y-2 rounded border p-3">
              <legend>Connection {i + 1}</legend>
              {(["from", "to"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <select
                    value={e[key]}
                    onChange={(event) =>
                      setEdges(
                        edges.map((old, j) =>
                          j === i ? { ...old, [key]: event.target.value } : old,
                        ),
                      )
                    }
                    className="block w-full rounded border bg-background p-2"
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label || n.id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                Relationship
                <input
                  value={e.label}
                  onChange={(event) =>
                    setEdges(
                      edges.map((old, j) =>
                        j === i ? { ...old, label: event.target.value } : old,
                      ),
                    )
                  }
                  className="block w-full rounded border bg-background p-2"
                />
              </label>
              {selectEvidence(e.evidenceIds[0] ?? "", (id) =>
                setEdges(
                  edges.map((old, j) =>
                    j === i ? { ...old, evidenceIds: [id] } : old,
                  ),
                ),
              )}
            </fieldset>
          ))}
          <button
            type="button"
            disabled={nodes.length < 2 || edges.length >= 40}
            className="rounded border p-2"
            onClick={() =>
              setEdges([
                ...edges,
                {
                  from: nodes[0].id,
                  to: nodes[1].id,
                  label: "",
                  evidenceIds: [],
                },
              ])
            }
          >
            Add connection
          </button>
          <p className="text-sm">
            The diagram is conceptual. Review all connections and labels against
            their evidence.
          </p>
        </>
      )}
      <label className="block">
        Caption
        <input
          name="caption"
          defaultValue={initial?.caption}
          required
          maxLength={500}
          className="block w-full rounded border bg-background p-2"
        />
      </label>
      <label className="block">
        Accessible description
        <textarea
          name="altText"
          defaultValue={initial?.altText}
          required
          maxLength={1500}
          className="block w-full rounded border bg-background p-2"
        />
      </label>
    </>
  );
}
