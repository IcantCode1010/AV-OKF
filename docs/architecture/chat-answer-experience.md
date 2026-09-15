# Chat Answer Experience

## Layout

The chat uses a centered question-and-answer column inspired by the
Perplexica/Vane research interface. It extends existing AV-OKF components;
there is no replacement agent or search engine.

- Questions are section headings, not right-aligned message bubbles.
- Each cited answer begins with three source cards. Remaining sources expand
  in place, preserving citation numbering and source order.
- Cards distinguish human-approved, automation-approved, legacy-approved,
  and unreviewed document evidence. Unavailable sources have no link.
- Answers retain existing Markdown and inline citation rendering.
- Each answer offers Copy and Answer details. Details refer to that answer,
  including older answers, rather than always showing the latest trace.
- The header Sources & trace drawer shows the latest answer on demand.
- Graph evidence and suggested topics retain their existing disclosure controls.
- The composer stays outside the conversation scroll container.

## Unchanged Contracts

Only the selected chat bundles are searched. A new chat starts with the active
bundle; additional sources remain explicit user choices. The redesign does not
change models, prompts, retrieval limits, evidence validation, approval, or data.

Pending replies show safe backend stages: searching, answering, validating,
and saving. The expanded list identifies the current stage, not an estimated
percentage or private reasoning. Text reveals only after validation and saving.
First-message creation still uses the existing Server Action; it has not gained
the existing-chat streamed stage transport in this slice.

OKF sources retain topic-page drilldown and the exact chat return path. Raw
document links still open the PDF at the cited page. No new preview service or
public web search is introduced.

## Verification

Source-card render tests cover citation destinations, trust labels, unavailable
sources, the initial three-card limit, and expandable remaining sources. The
existing Markdown and delivery tests cover citation parsing and stream errors.
Browser smoke checks cover desktop/mobile, light/dark themes, source expansion,
per-answer drawers, clipboard feedback, and an actual in-app reply.

September 13, 2026 verification: full Node suite 921 passed, five skipped;
lint and Docker production build passed. An isolated Airbus chat returned four
raw-document citations after live searching/writing stages, without a reload.
An older nine-citation answer expanded all sources and opened its own details
despite newer messages. Copy feedback and light/dark layouts were checked.
No workspace sources or existing conversation scopes were changed by the test.

Future work: bring first-message delivery onto the same reliable transport;
evaluate retrieval quality independently of this presentation change.
