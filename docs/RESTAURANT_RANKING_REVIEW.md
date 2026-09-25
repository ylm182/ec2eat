# Actual-restaurant Laya activation review

Reviewed 25 September 2026 against code at 7f817f0 and the public sources below.

Historical review — superseded by the owner permission confirmation and implementation recorded in RESTAURANT_RANKING_ACTIVATION.md.

Original status: **not enabled**. `PLACES_MODEL_INPUT_APPROVED=false` remains unchanged. No Google-derived candidates were sent to Hugging Face and no production configuration was changed in this review.

## Permission finding

The public [Maps Platform terms](https://cloud.google.com/maps-platform/terms), section 3.2.3, restrict exporting content, deriving content, model improvement (including training/testing/validation), and changing search results. These create unresolved questions for the proposed third-party inference and ranking. The model-improvement provision alone does **not** establish that all inference is forbidden.

The [service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), section 14, do not supply an explicit Places exception for this flow. Section 10 describes a separate Maps Grounding Lite exception; it must not be assumed to cover ordinary Places API responses sent to Laya. No service substitution is proposed.

Conclusion is an engineering release decision, not a definitive legal interpretation: public documentation does not establish permission for this exact use. Obtain account-applicable clarification before enabling. The public non-EEA terms were reviewed; billing-address jurisdiction and any negotiated agreement are not verified. Existing deterministic reordering and persistence of scores should be included in the same clarification; using a non-AI scorer does not automatically resolve those terms.

[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) also govern attribution and storage. Durable place IDs do not imply unrestricted storage of other fields or permission for third-party model inputs.

## What the current code actually knows

- Nearby Search requests up to 20 results. Supplemental text searches run only when fewer than three eligible candidates remain, with at most two queries.
- Eligible results are deduplicated, filtered for status/location/radius, sorted by distance, and capped at 10.
- Restaurant scoring features are normalized distance and known price level. Cuisine/category, spiciness, richness, healthiness, speed, sharing and other restaurant-specific attributes are absent. Names/reviews/photos are not inference inputs.
- Switching the flag would send place IDs and these feature rows, with active user preferences, to the private HF endpoint. It would not create evidence for unknown attributes.
- Most food answers only affect the seven app-authored archetypes. Since supplemental category queries are conditional, those answers do not necessarily influence restaurant retrieval when nearby search already yields three eligible places. This is an existing product limitation, not a completed preference-to-restaurant ranking integration.
- Ranking returns at most three IDs with scores/weights. These values are persisted with the decision; raw Places responses are not persisted by the search path.

## Next steps after clarification

1. Record the applicable agreement/Google response and permitted fields, derived outputs, retention and processing conditions.
2. Confirm HF processing/log retention conditions for permitted data. Do not equate a private endpoint with zero retention.
3. Implement a permitted, evidence-backed mapping from preferences to restaurant candidates. Do not infer unverified cuisine/taste facts from restaurant names or copy archetype attributes onto actual restaurants.
4. Exercise missing-evidence, malformed-output, candidate-ID and timeout paths with synthetic data. Use actual-provider smoke tests only within confirmed permitted use; do not turn Google data into model-quality evaluation/training fixtures.
5. Enable only after the allowed flow is useful and verified. Preserve the deterministic fallback and record the actual provider used.

A ready-to-send support case is in GOOGLE_MAPS_RANKING_SUPPORT.md. It has not been sent.
