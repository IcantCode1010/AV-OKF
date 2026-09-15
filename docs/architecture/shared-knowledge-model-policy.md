# Shared knowledge model policy

Chat research, article research and proposed explanatory diagrams use the existing workspace provider credentials and server-selected model. No fallback provider or silent model switch is introduced. The retained local workspace uses OpenAI gpt-5.6-terra; deployment configuration remains authoritative. Credentials remain server-side.

Research runs record model, provider, policy version, frozen source scope, inspected evidence, progress, tool events and measured usage. The research policy is graph-research-v6; the editorial policy is instructor-v2. Research cache reuse requires matching source/evidence, scope, model, provider and research policy. A writing-only change can reuse validated research. Existing approved content is not rewritten automatically.

Graph research v3 permits incoming and outgoing candidate-relation discovery with original endpoint direction, optional relationship filters, evidence-page pointers, and pagination. Both endpoints must be in the authorized document scope. Failed, filtered, rejected, unresolved and stale candidates are excluded. Returned quotations remain discovery context until original source pages are inspected. The separate `follow_published_links` tool traverses active published concepts in either direction with an explicit file allowlist derived from approved topics in the authorized source scope. It returns original endpoint direction, topic identifiers, and source-page pointers. Its request-local index has file, entry, edge and cooperative elapsed-time limits; truncation warnings must not be interpreted as exhaustive discovery. Full source evidence still comes from `read_source`.

Chat research permits 12 steps, 24 tool calls and 90 seconds. Article research permits 24 steps, 80 tool calls and ten minutes. Both permit two concurrent tools. The configured token limit can tighten the consumer limit; usage is accounted after each model step, so a final step can exceed that accounting threshold. These are research-stage budgets; legacy routing and final answer generation have separate existing limits. Do not report these values as verified end-to-end latency guarantees.

Tools only read authorized collection snapshots. Native links and candidate graph edges aid discovery; only inspected source passages support citations. Document instructions are untrusted content. Figure metadata is discovery text and does not establish visual interpretation. Source text and access are checked again before a response is persisted.

Plain greetings and thanks use a small conversational response path without retrieval. Technical questions retain cited retrieval. Scope changes cancel shared research and prevent prior-scope messages from being reused. Explicit approved-OKF-only routing retains the deterministic path for compatibility.

Topic writing targets an instructor's explanation, includes applicability/conditions, preserves conflicts and gaps, and follows the selected 80–500-word limit. Human prose edits create a new revision and require review; preserving an evidence ID does not prove that an edited claim is supported.

Diagram proposals use structured nodes and typed connections with evidence references. A controlled renderer produces SVG and PNG; arbitrary model-authored markup is never executed. Proposed diagrams are unreviewed until a person checks their labels, connections and applicability.

Development evaluation currently uses 20 fictional complementary-source questions and five article briefs. It tests designated passages, citation identities and scope isolation. Real-source technical review, provider failure/load exercises and physical-device checks remain release gates. Do not claim measured quality or speed improvements from the synthetic set alone.
