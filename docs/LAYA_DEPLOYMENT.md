# Laya production integration — 2026-09-25

## Verified

- HF endpoint: https://6ab54d3c9ec415b652acb0c3.endpoints.huggingface.cloud
- Wrapper repository: ylm182/ec2eat-laya-serving; private, per owner.
- Wrapper commit: 1942f86f6f828e850a0e963bec0daf8c225e4113.
- Multilingual weights: e4e9ddf21a7b1903b7acffd8814ad4307bf63a67.
- Laya 0.3.20, HF Inference Toolkit 0.5.6 (startup log); compatible core pins in deploy/laya/requirements.txt.
- User's endpoint setup: AWS N. Virginia, 4 vCPU / 8 GB, min 0/max 1,
  idle 60 minutes. Automatic idle-down remains unobserved; forced scale-to-zero
  then authenticated wake-up passed with a private repository.
- Anonymous request rejected with 401. Four real synthetic scoring fixtures
  cover English, Traditional Chinese, 1 and 10 candidate IDs.
- Final app encoding passed real HF requests for seven app-authored archetypes,
  including six answered dimensions. See hf-app-encoding.json.

## Behavior and limits

Adapter uses POST / with inputs.state and inputs.candidates. It validates the model,
revision, contract, runtime, complete score vector, and normalized weights. Confidence
is null; ranking weights must not be presented as enjoyment probabilities. Candidate
rows are compact positional value@confidence tuples with an explicit dimension order.
Missing evidence stays unknown; neutral suppresses priors; explicit answers override
inference. High speed=fast and high healthiness=healthy, independent of swipe polarity.
No preference evidence uses deterministic fallback without treating it as endpoint failure.

Request/response contract is verified, not general model quality. The HF handler rejects
more than 700 state tokens; larger requests fall back instead of truncating preferences.
Warm encoded requests from the developer Mac measured about 1.5–2.0 seconds, with an
 earlier trial around 2.2 seconds. The existing 1.75-second rank budget plus bounded
150ms circuit bookkeeping remains unchanged, so some warm requests can fall back.
Taiwan route performance must be measured after rollout.

PLACES_MODEL_INPUT_APPROVED remains false. Laya can rank app-authored meal archetypes;
Google-derived restaurant candidates keep deterministic ranking. No real Google content
was used in the tests. No raw Calendar text or secrets are sent to HF.

## Deployment configuration

App Hosting gets LAYA_BASE_URL, LAYA_MODEL_REVISION, LAYA_RUNTIME_VERSION and the
existing HF_TOKEN@1 secret reference. No Firebase region changes.

The local ignored functions/.env.ec2eat-davidyu-prod contains the same three nonsecret
LAYA values. warmLaya runs in asia-east1 at 11:00 and 17:00 Asia/Hong_Kong, maxInstances 1,
no scheduler retry. HF_TOKEN is a bound Secret Manager secret, never an env-file value.
Do not expose the worker publicly. Verify Cloud Scheduler OIDC and Cloud Run IAM after
creating it; trigger a scheduled run once and inspect its ready/warming result.

## User frontend checks after rollout

1. Open the app signed in and start a decision. Warm-up must not block question display.
2. Swipe left/right/up; binary questions and skip behavior must remain intact.
3. Finish a decision, select a real result, and check History and its flipped question trail.
4. Selection must not automatically mark a visit. Confirm only on an eligible later opening.
5. With HF scaled to zero, decisions must still work using fallback while the model warms.

Cold startup 503, timeout and malformed output fallback are covered by backend tests.
Real Hong Kong browser timing and UX remain the user's frontend test, as requested.

## Deployment verification

- Commit 42b3a99 pushed to GitHub main; App Hosting rollout build-2026-09-24-004
  SUCCEEDED, serving 100% of traffic. /decide returned HTTP 200.
- warmLaya is ACTIVE in asia-east1, with the configured HF_TOKEN version 1.
- Cloud Scheduler firebase-schedule-warmLaya-asia-east1 is enabled, cron 0 11,17 * * *,
  time zone Asia/Hong_Kong, OIDC using the project's compute service account.
- Worker Cloud Run IAM grants run.invoker only to that service account; anonymous
  worker request returned HTTP 403.
- An explicitly triggered scheduler invocation completed successfully; sanitized
  log at 2026-09-24T23:14:11.866652Z reports status=ready, reason=null, durationMs=2507.
  This measures the whole warm-up, including Firestore; it is not a rank latency test.
- New gcf-artifacts repository has seven-day build-image retention; this resolved
  the post-deployment Firebase CLI cleanup-policy warning.
- App-open warming is implemented at /api/app/open and legacy /api/app-open.
  The architecture's /api/laya/warmup name is not a deployed route (404).

Remaining: user-run signed-in frontend checks, Taiwan rank latency/fallback observation
through actual decisions, and passive automatic idle scale-down observation. No live
Places model input was enabled. The production worker uses existing project compute
identity; no service-account keys were created.
- Final anonymous checks of /api/app/open and /api/app-open both returned HTTP 401.
