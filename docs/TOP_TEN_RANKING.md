# Up to 50 candidates, up to 10 recommendations

> The tournament below describes the previously deployed flow. The new independent
> score implementation supersedes ranking and budgets; see [LAYA_SCORE_RANKING.md](LAYA_SCORE_RANKING.md). HF score handler and real 50-candidate flow are verified; see that document for rollout status.

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

Store/display up to ten instead of three; the existing session schema already permits ten. Detail fetching and client validation now permit ten. Per the owner’s follow-up, results use one vertically scrolling panel containing all available recommendations, numbered 1–10. History keeps its existing pager. Selected-only history fetches one restaurant. Existing smaller histories work unchanged.

Typical discovery cost rises from three to seven search requests. Results can request ten details and up to ten photo-media resolutions rather than three each. Ranking uses up to six sequential logical calls on the current single-replica CPU endpoint. No hardware/replica changes. The pool is request-local, not a stored restaurant directory.

## Verification

- 127 unit/component tests and 41 emulator tests pass, including map pin/location lifecycle and authenticated browser configuration. Production build, typecheck, and client bundle secret scan pass. Firebase also rebuilds the deployed commit.
- Tests cover all candidate counts around batch boundaries, all-candidate participation, unique finalists, final-pass scoring, partial-failure and deadline fallback, malformed IDs, 50-candidate cap, popularity request, and persistence/display/selection of the tenth recommendation.
- First live attempt at the old 1.75-second limit fell back on pass two: 50 discovered, ten deterministic results. This verified failure behavior and justified changing only the restaurant deadline.
- Second live run: 50 unique real Google candidates, six successful Laya passes, ten finalists, no fallback, ~8,314 ms total ranking. Per-pass times ~1,105–2,032 ms. Developer Mac measurement with synthetic user preferences; not production p95. No provider payload/IDs/secrets written to fixtures or logs.

## Frontend checks for the owner

1. Start a new 3 km choice, finish answers: up to ten numbered restaurant cards in one scrollable panel. Scroll within the panel to reach the tenth; header/settings stay in the mobile shell. Repeat with 10 km.
2. During retrieval/ranking, large loading indicator stays visible. A longer wait than the old single-pass flow is expected.
3. Select a later card (especially number ten), open Maps, then check history: the selected restaurant and question trail must agree. Visit status remains pending until later confirmation.
4. Where fewer than ten eligible places exist, show only those available, never fabricated fillers.
5. Existing saved selections and flip-card histories remain readable.

Permission remains closed on the owner's earlier confirmation. Firebase regions and Weather settings are unchanged.


## List and Google Map views

Results use one vertical scroll panel with up to ten cards. The Map tab loads Google Maps only when opened. Numbered pins match list order; tapping a pin and 查看餐廳 returns to that card. Google Places coordinates are returned with live details only, never persisted in the decision record. Missing coordinates and synthetic records are not plotted as real restaurants.

A fresh browser location watch supplies the blue dot while the map is open. Denied/unavailable location leaves restaurant pins usable; no guessed blue dot is shown. The watch stops on leaving the map. No precise location is written to storage.

Production uses a separate `GOOGLE_MAPS_BROWSER_API_KEY` runtime secret, restricted to the ec2eat production HTTPS origin and Maps JavaScript API (`maps-backend.googleapis.com`). This is a browser-visible key, not the server Places credential. Local testing requires a separately restricted development key; emulator-only runs can exercise the unavailable-map message. Opening the map can incur Google Maps usage charges.

Frontend acceptance checks:
- Scroll from recommendation 1 to 10 in the results panel; page header stays in place.
- Switch to 地圖: numbered pins match all returned restaurants with coordinates.
- Tap pin 10 and 查看餐廳: return to the tenth list card; selection saves as before.
- Allow location: a blue dot appears at the real current location; deny it: restaurant pins remain usable.
- Switch between views repeatedly: no duplicate map controls or location watches.
- Missing map configuration/network failure: readable retry message, list remains available.
- Check a small mobile viewport: pan/zoom map and access Google attribution without page overflow.
