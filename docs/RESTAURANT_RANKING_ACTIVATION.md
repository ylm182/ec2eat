# Restaurant ranking activation — 25 September 2026

The initial ten-candidate/three-result flow below is superseded by [TOP_TEN_RANKING.md](TOP_TEN_RANKING.md). Permission confirmation remains applicable.

Permission blocker closed on the owner's explicit confirmation: “Permission remains is granted, please close the first blocker.” This is owner-attested approval, not an independently obtained Google support response. The earlier review and unsent support draft are retained as historical records. No further permission request is required for this change.

## Implemented behavior

- One Nearby Search (up to 20) plus up to two preference-driven Text Searches (up to 20 each), in parallel. The text queries are selected using explicit answers, bounded priors and explicit category preference. They now run even when nearby results are plentiful. This increases typical search requests from one to three per decision; no pagination or background harvesting.
- Each pool is filtered for radius and availability, deduplicated and ordered by distance. Targeted and nearby pools are interleaved into at most ten unique candidates. A dense nearby pool cannot exclude all targeted matches. Query failures preserve available results; failures with no usable results remain retryable errors.
- Request `primaryType` and `types` as well as existing minimal search fields. [Official place types](https://developers.google.com/maps/documentation/places/web-service/place-types) were checked. Exact noodle, salad and soup/hotpot types map to the matching app categories; conflicting secondary categories stay unknown unless a specific primary type resolves them. Broad national cuisine is not a dish category. Fine-dining type provides a bounded formality signal, not a serving-speed or price claim.
- Distance, known price, recognized category and supported formality are passed to Laya with the user's preferences. Explicit category is now passed to both Laya and deterministic scoring. No restaurant names, reviews, photos, raw coordinates or Calendar text go to Laya. Type/feature inputs stay transient; existing ID/score decision persistence remains.
- No copied archetype taste features. Spiciness, healthiness, richness, temperature, speed, social suitability and novelty stay unknown without evidence. User answers to these dimensions influence retrieval through broad food-type preferences but are not represented as verified restaurant facts.
- If none of the active preferences has comparable restaurant evidence, Laya is skipped with `laya_no_preference_evidence`; heuristics remain available. This does not increment the endpoint-failure circuit. Malformed response, cold start or timeout also falls back. One rank call per restaurant batch; top three displayed.
- `PLACES_MODEL_INPUT_APPROVED=true` in production configuration. App Hosting Taiwan and Firestore Hong Kong are unchanged. Weather remains disabled.

## Verification

- 116 unit/component tests pass; 39 Firebase emulator tests pass; production build passes.
- New checks cover dense nearby pools, the ten-candidate cap, targeted-query failures, exact/ambiguous type mappings, missing restaurant evidence, category propagation, and minimal field masks. Existing checks validate IDs, normalized vectors, duplicate writes, selection/history and delayed outcomes.
- Explicit live smoke from developer Mac, using synthetic preferences and actual Google API candidates: ten candidates, one recognized category, three shortlisted, provider `laya`, no fallback, ranking ~1061 ms. A ten-candidate synthetic contract call took ~2233 ms, reinforcing the need for timeout fallback. Production rank budget remains 1750 ms plus bounded bookkeeping.
- The live script prints only counts/provider/latency. Secrets and Google content remain in memory. No Google response or model input/output fixture is written.
- This verifies functionality, not recommendation quality or production p95 latency. Google's sparse type data remains a limitation; no attributes were fabricated to hide it.

## User frontend checks

1. Start a new decision (existing selections remain frozen). Choose 3 km or 10 km and answer the food questions. Expect up to three real restaurant choices inside the selected radius.
2. When offered category choice, select salad/noodles and complete the flow. Targeted searches should affect the candidate pool; category matching is evidence-dependent and does not guarantee a particular cuisine if unavailable.
3. Select a result, inspect its history and Maps link. Selection must still remain pending until later visit confirmation.
4. If inference is cold or unavailable, the same flow must complete via fallback. A successful restaurant list alone does not prove which ranker ran; provider is recorded server-side.

Rollback: restore PLACES_MODEL_INPUT_APPROVED=false and deploy for deterministic-only ranking. Revert the retrieval change separately if reverting the extra query budget is necessary.
