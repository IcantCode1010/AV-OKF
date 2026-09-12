Review complete. No blocking issues found — the change is sound. Findings below, ordered by severity.

## Findings

**No blockers.** The Markdown rendering, citation-marker injection, and sanitization are correctly implemented and match the test coverage.

### Low severity / informational

1. **Citation status conveyed only via `title` attribute** (`chat-answer-body.tsx:44`, pre-existing pattern also in `chat-evidence-card.tsx`) — When a citation is unknown or withdrawn, the only indication (`Source unavailable` / the `lifecycleNotice` text) is a `title` tooltip on a `<span>`. `title` isn't reliably exposed to screen readers or touch users. The valid-citation case now has a proper `aria-label` (`chat-answer-body.tsx:43`), but the fallback span doesn't. This is a pre-existing gap, not a new regression, but since this PR specifically touches citation rendering it'd be a low-cost accompanying fix (`aria-label` on the fallback span).

2. **`remark-gfm` widens Markdown syntax beyond what the prompt requests** (`chat-answer.ts:209`, `chat-answer-body.tsx:1-2`) — GFM adds footnotes (`[^1]`), autolinks, and strikethrough on top of tables/lists. The citation-marker regex (`\[(\d+)\]`) doesn't collide with footnote syntax (`[^1]` isn't matched, and `footnoteReference` nodes have no `children`, so they're untouched), so there's no injection/mis-render risk. Just worth confirming this is intentional surface area for LLM output, since none of these extra syntaxes are things the prompt asks the model to produce.

3. **Regular (non-citation) links always get `rel="noreferrer"`** (`chat-answer-body.tsx:39`) even when not opening in a new tab. Harmless, just slightly redundant/inconsistent with the citation-link logic which only sets `rel`/`target` together for `sourceType === "rag"`.

### Verified safe (called out since citations/Markdown were the focus)
- XSS: `skipHtml` is set, `img` is nulled out, and the custom `urlTransform` only allowlists the exact `citation:\d+` pattern, deferring everything else to `defaultUrlTransform`, which blocks non-`http(s)/mailto/xmpp/ircs` schemes (confirmed against the installed `react-markdown@10.1.0` source) — `javascript:`/raw `<script>` payloads in the test fixture are neutralized.
- The synthetic `link` nodes created in `remarkCitations` only ever get `url: "citation:${index}"`, which is a closed, non-injectable format (regex-anchored, digits only), so there's no way for model output to smuggle an arbitrary URL through the citation path.
- Citation markers inside existing links/code/inline-code/images are correctly left untouched (matches tests); GFM tables/lists are tokenized before the citation transform runs, so table-cell citations are correctly rewritten.
- `tsc --noEmit` reports no type errors in the touched files; the removed `chat-citation-markers`/`chat-citation-links` imports in `chat-message-bubble.tsx` have no other stale references in the chat component tree, and `chat-evidence-card.test.tsx` already reflects the new "Based on reviewed sources" copy (no stale-test regression).

I wasn't able to get shell approval to actually execute `chat-answer-body.test.tsx`, so the above is based on static trace of the test fixtures against the implementation, not an observed test run — worth running it yourself to confirm before merging if you want a second guarantee beyond the static trace.
