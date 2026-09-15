"use client";
import { useState } from "react";
import { KnowledgeActionForm } from "./knowledge-action-form";
type Row = {
  id: string;
  title: string;
  version: number;
  aircraft: string;
  audience: string;
  placement: string;
  eligible: boolean;
};
export function EfbBulkControls({
  rows,
  action,
  label,
}: {
  rows: Row[];
  action: string;
  label: string;
}) {
  const [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const visible = rows.filter((r) =>
    `${r.title} ${r.aircraft} ${r.audience} ${r.placement}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">{label}</h2>
      <label className="block">
        Filter by title, aircraft, audience or category
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="block w-full rounded border p-2"
        />
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() =>
            setSelected(visible.filter((r) => r.eligible).map((r) => r.id))
          }
        >
          Select all eligible results
        </button>
        <button type="button" onClick={() => setSelected([])}>
          Clear selection
        </button>
      </div>
      <KnowledgeActionForm>
        <input type="hidden" name="action" value={action} />
        {rows
          .filter((r) => selected.includes(r.id))
          .map((r) => (
            <input
              key={r.id}
              type="hidden"
              name={action === "export" ? "selectionId" : "revisionId"}
              value={r.id}
            />
          ))}
        <ul>
          {visible.map((r) => (
            <li key={r.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  disabled={!r.eligible}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, r.id]
                        : selected.filter((id) => id !== r.id),
                    )
                  }
                />{" "}
                {r.title} · v{r.version} · {r.aircraft} · {r.audience} ·{" "}
                {r.placement}
                {!r.eligible ? " · Requires review" : ""}
              </label>
            </li>
          ))}
        </ul>
        <p>{selected.length} revisions selected. Each must pass preflight.</p>
        <button disabled={!selected.length} className="rounded border p-2">
          {label}
        </button>
      </KnowledgeActionForm>
    </section>
  );
}
