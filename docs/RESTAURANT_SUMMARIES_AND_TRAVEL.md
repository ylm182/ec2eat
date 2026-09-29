# Restaurant summaries and travel choices — 2026-09-29

Implemented locally; not yet deployed. This update supersedes the earlier planned 1 km-only walking enrichment.

## Decision flow and defaults

- Left: walk within 20 minutes. Up: walk within 30 minutes. Right: drive within 20 minutes. Other question swipe meanings remain unchanged.
- Google Places retrieves at most 20 candidates using bounded search radii of 3, 5 and 20 km respectively. These are candidate retrieval heuristics, not exhaustive travel-time coverage.
- Google Routes computes actual routes and excludes candidates exceeding the chosen duration. Unknown routes cannot qualify. If every route is unavailable, show an error instead of claiming candidates meet the limit.
- Driving uses TRAFFIC_UNAWARE; parking and real-time traffic are not included. Walking routes are fetched for driving results too.
- For each eligible restaurant, Google Places supplies displayName, rating, userRatingCount, reviews, priceLevel, primaryType and types. At most five supplied reviews, each capped at 1,000 characters, are used; author identifiers are not forwarded.
- Gemini gemini-3.5-flash-lite summarizes the evidence in English, at most 110 words / 850 characters. It receives walking/driving route metrics too. The app appends exact distanceMeters and duration to avoid relying on model-generated route numbers.
- Laya receives the summary and explicit user preferences for independent scoring. The highest ten scores across the eligible pool are shown. Transport batches do not change the independent scoring method.
- Four summary workers run concurrently. Any missing summary causes the entire eligible pool to use deterministic ranking, avoiding mixed scoring scales. Existing Laya validation and fallback remain.
- Recommendation timeout is 210 seconds and lease is 240 seconds. UI estimate is 45 seconds, an estimate rather than a guaranteed completion time.

## Results and data

Results refresh route metrics and show walking metres/minutes; driving choices also show driving minutes. District-centre origins are labelled when GPS is unavailable. Missing routes display unavailable, never straight-line distance. The route caution remains visible when walking routes are shown.

Actions use an accessible joined button group in this order: 揀呢間 | Openrice | Google Maps. Pattern reference: https://ui.shadcn.com/docs/components/base/button-group . Native controls and project CSS are used without introducing Tailwind.

Raw GPS, route metrics, review text and summaries are request-only and are not persisted in decision documents. Travel choice, existing preference data, candidate IDs and scores remain stored. Privacy copy was updated.

## Configuration and verification

Routes API enabled on ec2eat-davidyu-prod. Dedicated routes.googleapis.com-restricted key stored as GOOGLE_ROUTES_API_KEY version 1; runtime service account access granted. apphosting.yaml references this runtime secret and sets RESTAURANT_SUMMARIES_ENABLED=true. A rollout is still required. App Hosting remains Taiwan; Firestore remains Hong Kong.

A live two-restaurant smoke test successfully called Places, WALK/DRIVE Routes, Gemini and the deployed Laya endpoint. Each supplied five reviews. Scores were 0.550025 and 0.5245; total elapsed time was 13.3 seconds. This verifies integration, not ranking quality or guaranteed latency. No production history was written.

## User frontend acceptance

1. Start with GPS permission: confirm left/up/right show the three requested travel choices and start successfully.
2. Complete each choice: results show walking metres and minutes; driving choice additionally shows driving time excluding traffic/parking.
3. Deny GPS and choose a district: route text says it starts from the district centre.
4. Check the three joined actions: choosing saves only that restaurant; Openrice and Google Maps open the correct restaurant in a new tab.
5. If no route qualifies, show an empty result without silently extending the chosen time limit. If route lookup fails, do not display straight-line distance.
6. Confirm loading progress remains visible during summaries/scoring and old saved choices still open.

Final verification: 165 unit/component tests and all 44 Firebase Auth/Firestore emulator tests passed. TypeScript checks, production build, client secret-bundle scan and declared-region release checks passed. Frontend visual/gesture acceptance remains for the user.
