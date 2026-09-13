# Implementation report: Reliable chat delivery and progressive answers

## Follow-up: active-bundle-only new chats

Removed the shared-knowledge flag's automatic expansion from the requested
bundle to every active workspace bundle. The new-chat UI now names only the
active bundle. Explicit source selection remains available; existing sessions
and historical per-turn scope snapshots are unchanged.

Regression tested session creation with shared knowledge both enabled and
disabled. Full tests (916 passed, five skipped), lint and configured Docker
build pass. Browser-created chat `cmtzuno4j000001pjuoy1rcbj` displays Airbus
319/320 and exactly one selected source after its initial greeting, with no
737 selection or manual source removal required.

## Outcome

The existing-conversation send path no longer reloads after ten seconds or
depends on a redirect and RSC refresh. Authenticated NDJSON carries safe stage
updates and keepalives, followed by the saved, evidence-validated message pair.
Client state updates both the conversation and desktop/mobile Sources & Trace.

## Acceptance criteria

- [x] Remove the forced ten-second reload and artificial 900ms delay.
- [x] Deliver long responses in place; distinguish searching, writing,
  checking evidence and saving without exposing prompts or raw model tokens.
- [x] Reveal validated text progressively, with reduced-motion handling and
  Show full answer. Previously loaded messages do not replay their animation.
- [x] Keep citations, Markdown and source-panel updates intact.
- [x] Guard double submission, including Enter while the send button is disabled.
- [x] Check saved history after interrupted delivery without resending.

## Changes

- `chat-delivery.ts`: validated transport/request contract, streamed keepalives,
  incremental UTF-8 decoding and recovery boundary matching.
- `/api/chat/[id]/messages`: workspace-authenticated POST delivery and GET
  recovery, private/no-store responses, same-origin mutation protection.
- Chat service/backend: optional stage callback; retrieval, validation and
  persistence authority are unchanged.
- Conversation/provider/thread/bubble: local result delivery, shared source
  state, bounded progressive reveal and reader-controlled scroll following.
- Composer: pending-state check guards keyboard as well as button submissions.

## Findings

`chat-conversation-panel.tsx` explicitly reloaded any pending turn after ten
seconds, regardless of whether the backend was still doing useful work. The
send action also redirected to the same route. This could discard the result
delivery before persistence completed. The reported engine-bleed conversation
was inspected read-only: its final answer and six raw citations were saved.

## Verification

| Check | Result |
|---|---|
| Full Node/component suite | PASS: 915 passed, five skipped |
| Delivery/service focused tests | Covered delayed completion, keepalives, 240KB answer, split UTF-8, malformed events, EOF, cancellation and recovery boundaries |
| Service evidence-fallback test | Safe stage order asserted before persistence; validation behavior retained |
| ESLint | PASS |
| Docker production build | PASS, including TypeScript |
| Unauthenticated GET | 401, no history exposed |
| Foreign-origin POST | 403, no question submitted |
| Real configured-provider browser check | Long Airbus bleed/air-conditioning question completed beyond ten seconds without refresh; nine citations and source panel delivered |
| Progressive reveal | Show full answer observed during a new conversational reply |
| Desktop/mobile | Rendered at normal desktop and 390x844; no horizontal document overflow; original viewport restored |
| Browser console | No captured errors |

Test chat: `cmtzu7f7w000001ryb26uiwif`. It contains a greeting, one research
question and a thanks reply. The user's reported conversation was not altered.

## Deviations and limitations

- This is progressive display of a fully validated answer, not raw token
  streaming before validation. Generation latency still exists, now visible.
- A lost connection can be checked against saved history. There is no durable
  request ledger or automatic resubscription across server restarts; ambiguous
  transport failures intentionally do not automatically resend.
- New-chat first-message creation retains its existing Server Action. The new
  transport applies once a conversation exists.
- The POST accepts at most 16,000 question characters and 30 clarification
  selections. Serialized response events are bounded to eight million chars.
- No schema migration, provider/model change, knowledge reprocessing, approval
  change or source deletion was performed. Web was rebuilt/restarted; the
  processing worker was left running.

## Manual review

1. Open an existing conversation and send a question requiring research.
2. Leave the page open beyond ten seconds; observe safe stage updates.
3. Watch the saved answer reveal and its sources update without navigation.
4. Scroll upward while text reveals; the reader's position is retained.
5. Use Show full answer to skip animation; refresh later to confirm persistence.
