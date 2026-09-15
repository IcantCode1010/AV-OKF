# Topic builder false recipe-change failure

## Final verified outcome

Run `cmtq03h5e00001cqtb0q50jw4` completed ready with one article, “Trailing edge flap disagree,” at 145 words against the unchanged 180-word limit. Production browser showed its review/approval control. Refreshing the unchanged recipe returned this exact ready run, confirming JSONB-order-safe reuse. No approval or export was performed. Cached validated research was reused (zero new research calls on the final attempt).

Both services now run `av-okf-web:recipe-bounded-drafts` through the `production-data-plane` tag. Production build, TypeScript, targeted lint, ten topic-builder tests and diff checks passed. The final synthesis instruction adds per-field word budgets; repair is bounded to four correction passes, preserves previous output and measured counts, and retains all existing evidence/relationship validation. A diagnostic attempt showed the old three-generation limit ending at 190 words; its temporary diagnostic module/file lived only in the replaced web container. Earlier failed runs remain in history. The cancelled flight-control-theory recipe was not resumed.

## Follow-up: mixed web/worker versions

The subsequent `737 flaps disagree` recipe (`cmtpzqtck002e01mxqi759xa9`) exposed an additional deployment problem. Its three failed snapshots used `graph-research-v6`; the narrow production worker retained `graph-research-v1`. Canonical comparison correctly rejected different policies but reported the misleading recipe-change error. The first retry had been created directly through the older production service, which masked this mismatch. It was subsequently cancelled and must not be restarted.

Resolution requires aligning web and worker research implementations, not ignoring policy differences. A full current-source image `av-okf-web:graph-recipe-aligned` is being built for both services. A successful retry must be created from the same recipe with the current policy and verified through completion, rather than checking only that it leaves the queue. Deployment and retry results will be recorded below.

Deployed image `4f1e13ff36c2` to both web and worker and confirmed both report `graph-research-v6`. Retry `cmtpzton600001jp4787cl0tj` passed recipe validation and agentic research, but ultimately failed `article_word_budget_exceeded`. Its 180-word setting was preserved. The browser confirmed current progress; repeated refresh returned the same active run.

The synthesis repair prompt previously received only a generic failure string and regenerated without seeing its failed draft. Updated it to include the previous draft, measured per-article word counts, exact limit, shorter target, and instructions preserving evidence and conditions. Existing validation remains mandatory; no text is blindly truncated and the user's limit is not raised. Ten topic-builder tests and targeted lint passed. A replacement production image is building; final run outcome remains pending.

Retry `cmtpzx5iz00001cqhg4rqw02k` then failed `invalid_relationship`. The schema validator requires links to other articles in the generated collection, but synthesis instructions did not clearly distinguish those article IDs from retrieved graph topics. Added explicit output-local target rules and self-link exclusion to synthesis; repair feedback now enumerates available article IDs and invalid source/target pairs. Existing relationship validation remains unchanged. Rebuilt and reran ten tests successfully; subsequent outcome recorded below.

The two failed runs for recipe `cmtpzhvkp002b01mxp0039jtq` had identical recipe content before and after persistence. PostgreSQL JSONB reordered the object fields; the original SHA-256 comparison used ordinary JSON serialization, so it treated field order as a recipe change.

Recipe comparison now canonicalizes object keys while retaining values and array order. The fix applies both to worker validation and reuse of unchanged ready/approved runs. Corpus and evidence fingerprints remain unchanged. Ten topic-builder tests and targeted ESLint passed, including rejection of actual topic, source, word-limit and research-policy changes.

Deployed a narrow image derived from the existing production image, changing only the recipe comparison and rebuilding the existing app. Production build and TypeScript checking passed. Web and worker use the corrected image; `av-okf-web:production-data-plane` now points to the fix. The previous image is retained as `av-okf-web:before-recipe-order-fix`. Worktree graph changes were not included. Build recipe is in `work/recipe-order-hotfix/`.

Retried the user's existing recipe through `refreshTopicRecipe`, creating run `cmtpzm3mi00001jmqe4q1u3k2`. Confirmed running, no error, source section 4 of 586. This verifies the worker passed the formerly failing guard; final article generation is still in progress. The saved exhaustive mode and both selected documents were preserved. Health endpoint returned OK after deployment.
