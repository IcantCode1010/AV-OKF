import type { AuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  currentClassification,
  type ClassificationResult,
} from "@/lib/knowledge/efb-classification";
import { KnowledgeActionForm } from "./knowledge-action-form";
import { EfbSelectionFields } from "./efb-selection-fields";
import { loadProjectEfbContractRegistry } from "@/lib/project-efb-contract-registry";
import { presentEfbClassification } from "@/lib/knowledge/efb-classification-presentation";
export async function ArticleEfbClassification({
  context,
  revisionId,
  approved,
}: {
  context: AuthWorkspaceContext;
  revisionId: string;
  approved: boolean;
}) {
  let record: Awaited<ReturnType<typeof currentClassification>> = null;
  let problem = "";
  try {
    record = await currentClassification(context, revisionId);
  } catch {
    problem =
      "Source or registry unavailable. Refresh classification when resolved.";
  }
  const result = record?.result as unknown as ClassificationResult | undefined;
  const presentation = presentEfbClassification(record?.status, result?.issues);
  const registry = await loadProjectEfbContractRegistry().catch(() => null);
  return (
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">
        EFB classification ·{" "}
        {presentation.label}
      </h3>
      {problem && <p role="alert">{problem}</p>}
      {result?.metadata && (
        <p>
          {result.metadata.aircraftFamily}{" "}
          {result.metadata.aircraftTypeIds.length
            ? result.metadata.aircraftTypeIds.join(", ")
            : "· any type in family"}{" "}
          · {result.metadata.audiences.join(" / ")} ·{" "}
          {result.metadata.ataChapter
            ? `ATA ${result.metadata.ataChapter}`
            : ""}{" "}
          {result.metadata.qrhTargetId?.replaceAll("-", " ")}
        </p>
      )}
      <p>{result?.rationale}</p>
      {record?.status === "queued" && (
        <KnowledgeActionForm>
          <input type="hidden" name="action" value="cancel-classification" />
          <input type="hidden" name="revisionId" value={revisionId} />
          <button className="rounded border p-2">Cancel classification</button>
        </KnowledgeActionForm>
      )}
      {presentation.actionable && <p role="alert">{presentation.label}. Review or retry only the unresolved metadata field.</p>}
      {result?.warnings?.length ? (
        <details><summary>Classification diagnostics</summary><p>{result.warnings.length} unused or invalid evidence item(s) were discarded.</p></details>
      ) : null}
      {result?.evidence?.length ? (
        <details>
          <summary>Classification evidence</summary>
          {result.evidence.map((e, i) => (
            <blockquote key={i}>
              {e.field}: {e.quote}
              {result.sourceEvidence
                ?.filter((source) => source.id === e.id)
                .map((source) => (
                  <a
                    key={source.id}
                    className="ml-2 underline"
                    href={`/documents/${source.documentId}?page=${source.page}`}
                  >
                    Source page {source.page}
                  </a>
                ))}
            </blockquote>
          ))}
        </details>
      ) : null}
      <KnowledgeActionForm>
        <input type="hidden" name="action" value="classify" />
        <input type="hidden" name="revisionId" value={revisionId} />
        <button
          disabled={record?.status === "queued"}
          className="rounded border px-3 py-2"
        >
          {record?.status === "queued"
            ? "Classification queued — refresh for progress"
            : "Classify or retry"}
        </button>
      </KnowledgeActionForm>
      {approved && registry && (
        <details>
          <summary>Review EFB placement</summary>
          <KnowledgeActionForm>
            <input type="hidden" name="action" value="select" />
            <input type="hidden" name="revisionId" value={revisionId} />
            <EfbSelectionFields
              registry={registry}
              initial={result?.metadata}
            />
            <label className="block">
              Review reason
              <input
                name="classificationReason"
                required
                className="block w-full rounded border p-2"
              />
            </label>
            <button className="rounded border p-2">
              Confirm placement and select for EFB
            </button>
          </KnowledgeActionForm>
        </details>
      )}
    </section>
  );
}
