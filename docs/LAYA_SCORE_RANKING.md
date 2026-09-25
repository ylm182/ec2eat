# Independent restaurant scoring — 25 September 2026

## Status

HF handler deployed and remotely verified at wrapper commit
`8ba5b2a0e62e0d7c83599a7eeddf087203c7cb14`. The owner uploaded handler.py manually;
its bytes match the tested local file. Existing requirements and hardware remain
unchanged. The endpoint was updated through the owner's signed-in browser because
the inference token cannot manage endpoints. Firebase app rollout follows verification.

## Decision flow

Google retrieval still produces at most 20 unique restaurants within the user's
3 km / 10 km radius. Every eligible candidate is independently evaluated by Laya
with the same explicit user preferences and the same fixed five-level rubric:
strong conflict, mostly conflict, mixed/insufficient evidence, mostly match,
strong match. Missing evidence is not treated as a mismatch. Neutral preferences
stay neutral; prior preferences remain weak hints.

The SDK's ordinal `score` ranges from 0 to 4. The handler divides it by four and
returns a raw 0–1 suitability score. This is **not a calibrated probability of
liking the restaurant**, nor a Google star rating. All scores are compared across
the entire pool and the app selects the highest ten, with stable ID tie-breaking.

For transport efficiency, up to ten restaurants travel in each request, but each
model prediction sees only one restaurant. Twenty restaurants therefore require
two HTTP requests and twenty individual model evaluations, with no tournament,
per-group advancement quota, or final comparison round. The app ignores batch
weights when merging scores. Weights retained for compatibility are normalized
only after merging; displayed top-ten weights are then renormalized.

Question/archetype selection continues using the existing `choice` contract.
The handler defaults to choice for backwards compatibility; restaurant requests
explicitly send `mode: score` and require `ec2eat-laya-score-v1` responses. An old
choice response cannot silently be accepted as an independent score.

## Failure handling and budgets

Any failed batch discards partial model scores and runs the existing deterministic
scorer over the entire pool. It does not mix model and heuristic scales.
Failures now record the batch and root reason, for example
`laya_score_fallback:batch_2:laya_http_503`, instead of the opaque tournament reason.
Parent cancellation stops further work.

Initial limits: 30 seconds per restaurant batch, 120 seconds for the pool,
125 seconds for retrieval plus ranking, and a 150-second search lease. Question
inference remains 1.75 seconds. These are upper bounds, not expected latency or an
SLA. Remote developer-Mac scoring measured about 33.4 seconds for fifty restaurants.
This is one warm run, not Taiwan p95. The hardware,
replica settings, Firebase Taiwan hosting and Hong Kong database are unchanged.
Each per-restaurant state must fit 700 tokens; transport remains capped at ten
candidates and 16,000 bytes. Oversized states fail instead of being truncated.

## Data and scope

Inputs remain the existing known distance, price, mapped category/cuisine and
other available structured features. No invented restaurant facts are added.
Gemini restaurant summaries, review bodies/star-rating input, answer-duration
weighting and calendar selection are **not** part of this change. Richer evidence
can be added separately once its retrieval, summary and storage rules are defined.
No Google content is written to the synthetic fixtures.

## Verification

- 139 unit/component tests, 42 Firebase emulator tests, eight Python handler tests,
  type checking and production build passed.
- Tests cover all candidates, global top-ten ranking without group quotas, zeros,
  malformed IDs/scores, failed batches, deadline and cancellation behavior.
- Real local pinned Laya model: five synthetic cases cover Traditional Chinese,
  reversed order, scoring alone, ten candidates, and legacy choice compatibility.
  The same restaurant's score was identical across order/batch changes. The obvious
  matching example ranked higher. This is contract evidence, not a quality benchmark.
- `tests/fixtures/laya/local-score-smoke.json` is **local macOS evidence**; the old
  `hf-smoke.json` verifies only the deployed choice contract. Do not call the score
  contract HF-verified until a remote fixture is captured.
- Remote fixture `hf-score-smoke.json` now verifies five cases (same score across
  batch/order, Chinese input, ten candidates and legacy choice). Ten simple
  candidates took 4.54s; the more verbose app payload took 7.13s.
- Real Google-to-Laya run: 50 unique candidates, five batches, every candidate
  scored, ten results, no fallback. Batch times 6.19–7.38s, full ranking 33.38s.
  Only counts/timings were printed; no Google payloads persisted.

## Deployment procedure and provenance

Handler upload, pinned endpoint update, remote score fixture and live Google pool
smoke are complete. The wrapper commit above is recorded in `lib/laya/recipe.ts`.
The remote score fixture SHA-256 is
`983be4b846083671e4d51720b944db6ec4c06938a5f7c2c9ad843b5782e34992`.
The old choice fixture remains valid and unchanged.

Repeat the paid real-pool smoke with:
`node --conditions=react-server --import tsx scripts/smoke-restaurant-ranking.ts --live`.
Credentials are read into memory from Secret Manager. Never paste or commit them.
After tests, push the app changes and roll out Firebase. Production deployment
status is recorded below once verified.

## Owner frontend checks after rollout

1. Start fresh 3 km and 10 km decisions. Swipe questions behave as before; loading
   remains visible until results arrive, then up to ten restaurants appear.
2. List order and numbered map pins agree; selecting any result records the same
   restaurant and question trail in history.
3. A history visit can still be confirmed immediately, and confirmed visits are
   not prompted again after four hours.
4. Fewer than ten eligible restaurants shows only actual results. Existing saved
   history remains readable. Ranking quality is subjective and should be assessed
   over multiple real decisions; frontend appearance alone cannot prove Laya ran.

## Rollout checkpoint

HF endpoint update and remote verification completed. App tests/build/client scan
passed. Git staging/commit was denied by the execution approval system, so no app
commit, push or Firebase rollout was performed. The production app remains on its
previous choice ranking and the new HF handler supports that contract unchanged.
Resume with committing/pushing the prepared app changes, then Firebase rollout.

## Twenty-candidate verification

Owner requested reducing the cap to twenty before app rollout. Real Google-to-Laya
smoke returned exactly 20 unique candidates, two batches of ten, ten final results,
provider=laya and no fallback. Batch times: 5.92s and 6.81s; full ranking: **12.74s**,
versus 33.38s in the earlier fifty-candidate run (~62% shorter). These are individual
warm developer-Mac measurements, not an end-to-end UI SLA or controlled benchmark.
The preliminary synthetic ten-candidate contract call took 6.68s and is a test-only
preflight, not an additional normal app scoring round. All 139 unit/component tests
and type checking passed; the twenty-candidate case verifies all top ten may come
from one transport batch. Google search query count remains unchanged. The app
changes remain local; the previously denied Git/push/Firebase rollout is not retried
as part of this requested measurement.

## Waiting screen

Restaurant search now shows an animated bowl/ring and an explicitly estimated
20-second countdown, based on the observed ~12.7-second ranking plus retrieval,
network and detail-loading allowance. This is a client estimate, not server
progress or an SLA. Existing-result detail loading starts with a 5-second estimate.
Transitioning from search to details keeps the current clock while the overlay
stays mounted. At the estimate's end, the UI switches to an overdue message and
elapsed seconds rather than negative time, a frozen zero, or invented completion.
Results render as soon as ready. Retry remounts the timer; unmount clears it.
Reduced-motion preference disables animation, and screen readers announce stage
changes without announcing each countdown tick. Saving a chosen restaurant retains
its separate saving indicator.

Owner frontend checks: start a fresh decision and observe 20 → 19 → 18 seconds;
results should replace the overlay immediately. With a slow connection, crossing
20 seconds should show 「比預期耐少少，仍在處理」 and increasing elapsed seconds.
Retry should reset the estimate. Opening existing results should use the shorter
5-second details estimate. On a small phone, the overlay stays within the app shell.

## Whole-page scrolling (owner follow-up)

The page shell now has a minimum viewport height, not a fixed height. Main content,
restaurant results and history cards no longer have independent scrolling or content
height caps. The entire document scrolls, with its header/footer in normal flow.
Swipe cards keep a comfortable minimum illustration area and can grow; history
pagination and flip behavior remain. The map has an explicit canvas height so it
does not collapse when the page height is unconstrained. Loading stays centered
in the viewport while a request runs. Settings content also has no inner scroll cap.

Frontend acceptance: scroll from the header through all ten restaurant cards to
the footer in one continuous page; long flipped histories expand fully; switch to
the map and confirm it remains visible; check swipe choices and loading on mobile.
