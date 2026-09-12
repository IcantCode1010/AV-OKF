import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseCitationMarkers } from "../../lib/chat-citation-markers";
import { getChatMessageCitationHref } from "../../lib/chat-citation-links";
import type { ChatMessage } from "../../lib/chat-types";

type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };

// Work on parsed text only: markers in existing links and code stay literal.
function remarkCitations() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (["link", "linkReference", "code", "inlineCode", "image", "imageReference"].includes(node.type)) return;
      if (!node.children) return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== "text") { visit(child); return [child]; }
        return parseCitationMarkers(child.value ?? "").map((segment) => segment.type === "text"
          ? { type: "text", value: segment.value }
          : { type: "link", url: `citation:${segment.index}`, children: [{ type: "text", value: String(segment.index) }] });
      });
    }
    visit(tree);
  };
}

export function ChatAnswerBody({ message }: { message: Pick<ChatMessage, "content" | "citations" | "sessionId"> }) {
  return <div className="min-w-0 text-sm leading-7 break-words [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold">
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkCitations]}
      urlTransform={(url) => /^citation:\d+$/.test(url) ? url : defaultUrlTransform(url)}
      components={{
        img: () => null,
        h1: ({ children }) => <h2>{children}</h2>,
        h4: ({ children }) => <h3>{children}</h3>,
        h5: ({ children }) => <h3>{children}</h3>,
        h6: ({ children }) => <h3>{children}</h3>,
        table: ({ children }) => <div className="my-3 max-w-full overflow-x-auto"><table className="w-full border-collapse text-left [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2">{children}</table></div>,
        a: ({ href, children }) => {
          const match = /^citation:(\d+)$/.exec(href ?? "");
          if (!match) return href ? <a href={href} className="underline underline-offset-2" rel="noreferrer">{children}</a> : <span>{children}</span>;
          const citation = message.citations.find((item) => item.index === Number(match[1]));
          const destination = citation ? getChatMessageCitationHref(citation, message.sessionId) : null;
          const className = "mx-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[0.65rem] font-bold text-accent-foreground align-super focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
          return destination ? <a className={className} href={destination} title={`Open ${citation!.documentTitle}`} aria-label={`Source ${match[1]}: ${citation!.documentTitle}`} target={citation!.sourceType === "rag" ? "_blank" : undefined} rel={citation!.sourceType === "rag" ? "noreferrer" : undefined}>{children}</a>
            : <span className={className} role="img" aria-label={`Source ${match[1]}: ${citation?.lifecycleNotice ?? "Source unavailable"}`} title={citation?.lifecycleNotice ?? "Source unavailable"}>{children}</span>;
        },
      }}>{message.content}</ReactMarkdown>
  </div>;
}
