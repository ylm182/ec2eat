# Up to 50 candidates, up to 10 recommendations

25 September 2026. Implements the owner's accepted larger-pool recommendation. Supersedes the earlier ten-candidate/three-result restaurant flow; swipe questions and their limits remain unchanged.

## Retrieval

- Nearby Search uses Google POPULARITY ordering, maximum 20.
- Up to six Text Searches run alongside it: two preference-driven food queries plus Chinese, Japanese, Korean and Thai cuisine queries. Each requests at most 20; no pagination. These four cuisine queries are bounded HK discovery defaults, not an exhaustive cuisine list or inferred user preferences.
- Preserve provider order within each pool, enforce the exact selected circular radius, exclude known closed entries, deduplicate and interleave pools up to 50 unique restaurants. No guarantee of 50 results or exhaustive coverage.
- This is an app discovery pool, not Google's definitive best 50. Google does not supply a global popularity score to merge across queries.
- Returned cuisine types are passed as descriptive information, not converted into invented taste/health/speed attributes. The user still answers the existing food-dimension/category questions; no cuisine-preference question has been added.

## Ranking

For 11–50 candidates, distribute them across balanced groups of at most ten. Rank each group sequentially through the existing HF endpoint. Advance balanced quotas totaling ten (for fifty: two per group), then rank all ten finalists together. Ten or fewer candidates need one pass. At most six logical rank calls. The existing service may retry a transient failure once within each pass's deadline.

Never compare normalized weights from separate groups. Persist only final-pass weights (renormalized for displayed results). This is an approximate tournament: a strong group can contain more deserving candidates than its advancement quota. No global optimum, calibrated enjoyment probability or quality improvement is claimed.

Any failed/malformed/timeout/heuristic pass abandons partial results and uses the deterministic scorer over the full pool. No mixing incomparable scores. Missing-evidence behavior is preserved. The parent cancellation signal propagates to Laya; no later passes start after deadline.

Restaurant pass budget: 3 seconds plus at most 150 ms bookkeeping. Whole tournament: 20 seconds. Retrieval + ranking: 25 seconds. The existing 30-second search lease remains longer than this budget. Swipe-question inference stays at 1.75 seconds.

## Results and cost

Store/display up to ten instead of three; the existing session schema already permits ten. Detail fetching and client validation now permit ten. Results retain the one-card-at-a-time previous/next controls. Selected-only history fetches one restaurant. Existing smaller histories work unchanged.

Typical discovery cost rises from three to seven search requests. Results can request ten details and up to ten photo-media resolutions rather than three each. Ranking uses up to six sequential logical calls on the current single-replica CPU endpoint. No hardware/replica changes. The pool is request-local, not a stored restaurant directory.

## Verification

- 125 unit/component tests and 40 emulator tests pass; production build passed before the restaurant deadline adjustment, and typecheck passes after it. Firebase also rebuilds the deployed commit.
- Tests cover all candidate counts around batch boundaries, all-candidate participation, unique finalists, final-pass scoring, partial-failure and deadline fallback, malformed IDs, 50-candidate cap, popularity request, and persistence/display/selection of the tenth recommendation.
- First live attempt at the old 1.75-second limit fell back on pass two: 50 discovered, ten deterministic results. This verified failure behavior and justified changing only the restaurant deadline.
- Second live run: 50 unique real Google candidates, six successful Laya passes, ten finalists, no fallback, ~8,314 ms total ranking. Per-pass times ~1,105–2,032 ms. Developer Mac measurement with synthetic user preferences; not production p95. No provider payload/IDs/secrets written to fixtures or logs.

## Frontend checks for the owner

1. Start a new 3 km choice, finish answers: up to ten restaurant cards, with previous/next controls showing 1/N through N/N. Repeat with 10 km.
2. During retrieval/ranking, large loading indicator stays visible. A longer wait than the old single-pass flow is expected.
3. Select a later card (especially number ten), open Maps, then check history: the selected restaurant and question trail must agree. Visit status remains pending until later confirmation.
4. Where fewer than ten eligible places exist, show only those available, never fabricated fillers.
5. Existing saved selections and flip-card histories remain readable.

Permission remains closed on the owner's earlier confirmation. Firebase regions and Weather settings are unchanged.
