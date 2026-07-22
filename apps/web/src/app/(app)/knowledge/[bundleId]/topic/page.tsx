import Link from "next/link";
import { ArrowLeft, BookOpenCheck, ExternalLink, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  loadApprovedOkfTopicView,
  resolveApprovedOkfTopicLink,
} from "@/lib/okf-topic-view";
import {
  buildOkfTopicViewHref,
  normalizeOkfTopicReturnTo,
} from "@/lib/okf-topic-routing";

export const dynamic = "force-dynamic";

export default async function ApprovedOkfTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ file?: string; returnTo?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([
    params,
    searchParams,
    requireAuthWorkspaceContext(),
  ]);
  if (!query.file) notFound();

  const topic = await loadApprovedOkfTopicView({
    bundleId,
    context,
    filePath: query.file,
  });
  if (!topic) notFound();

  const returnTo = normalizeOkfTopicReturnTo(query.returnTo);
  const provenance = getProvenanceCopy(topic.approvalProvenance);

  return (
    <div className="mx-auto w-full max-w-4xl pb-12">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href={returnTo}><ArrowLeft className="size-4" />Back to conversation</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/knowledge/${encodeURIComponent(topic.bundleId)}?file=${encodeURIComponent(topic.filePath)}`}>
            <ExternalLink className="size-4" />Open in Knowledge Explorer
          </Link>
        </Button>
      </div>

      <article className="overflow-hidden rounded-lg border border-border bg-card/30">
        <header className="border-b border-border px-6 py-7 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={provenance.badgeClassName} variant="outline">
              <ShieldCheck className="size-3.5" />{provenance.label}
            </Badge>
            <Badge variant="secondary">{formatLabel(topic.type)}</Badge>
            <Badge variant="outline"><BookOpenCheck className="size-3.5" />{topic.bundleName}</Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">{topic.title}</h1>
          {topic.description && !topic.descriptionRepeatedExactly ? (
            <p className="mt-3 text-base leading-7 text-muted-foreground">{topic.description}</p>
          ) : null}
          <dl className="mt-6 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
            <Metadata label="Source document" value={topic.sourceFile} />
            <Metadata label="Source pages" value={formatPages(topic.sourcePages)} />
            <Metadata label="Approval" value={provenance.description} />
            <Metadata label="Approved" value={topic.approvedAt ?? "Date not recorded"} />
            {topic.updated ? <Metadata label="Updated" value={topic.updated} /> : null}
          </dl>
        </header>

        <div className="px-6 py-7 sm:px-8 sm:py-9">
          <div className="okf-reader prose prose-invert max-w-none text-sm leading-7 text-foreground/90 [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h2]:mt-8 [&_h2]:text-xl [&_h3]:text-lg [&_table]:text-xs">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => {
                  const target = resolveApprovedOkfTopicLink({
                    approvedFilePaths: topic.approvedFilePaths,
                    href,
                    sourceFile: topic.filePath,
                  });
                  if (target.kind === "internal") {
                    return (
                      <Link href={buildOkfTopicViewHref({
                        bundleId: topic.bundleId,
                        filePath: target.filePath,
                        returnTo,
                      })}>{children}</Link>
                    );
                  }
                  if (target.kind === "external") {
                    return <a {...props} href={href} rel="noreferrer" target="_blank">{children}</a>;
                  }
                  return (
                    <span className="cursor-not-allowed text-destructive line-through" title="Unavailable or unsafe topic link">
                      {children}
                    </span>
                  );
                },
              }}
            >
              {topic.body}
            </ReactMarkdown>
          </div>
        </div>
      </article>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function getProvenanceCopy(value: "automated" | "human" | "legacy") {
  if (value === "automated") {
    return {
      badgeClassName: "border-cyan-500/40 text-cyan-300",
      description: "Approved through bundle automation; not individually human-reviewed",
      label: "Automation-approved OKF",
    };
  }
  if (value === "human") {
    return {
      badgeClassName: "border-emerald-500/40 text-emerald-300",
      description: "Human-reviewed and approved",
      label: "Human-approved OKF",
    };
  }
  return {
    badgeClassName: "border-slate-400/40 text-slate-300",
    description: "Approved before approval provenance was recorded",
    label: "Legacy approved OKF",
  };
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPages(pages: number[]) {
  if (pages.length === 0) return "Not specified";
  const first = pages[0]!;
  const last = pages.at(-1)!;
  return first === last ? `Page ${first}` : `Pages ${first}-${last}`;
}
