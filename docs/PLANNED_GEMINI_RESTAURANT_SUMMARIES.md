# Original plan: Gemini restaurant summaries and walking distance

Superseded by the approved implementation on 2026-09-29. See [current implementation](RESTAURANT_SUMMARIES_AND_TRAVEL.md). The original notes below are retained as historical context; the 1 km-only restriction no longer applies.

## Requested inputs and behavior

For each candidate restaurant, Gemini should summarize these Google Places fields:
- `displayName`
- `rating`
- `userRatingCount`
- `reviews`
- `priceLevel`
- `primaryType`
- `types`

When the user selects the **1 km** search range, also obtain walking route distance and include it in the Gemini summary. Interpret the user's “1分里” as “1公里”, consistent with the existing 1/2/5 km choices.

Display the walking distance on the final restaurant result cards as well. This follows the same 1 km condition; walking-route requests for 2 km and 5 km were not requested. The user has not requested changing the existing straight-line search radius into a walking-distance filter.

Keep the independent Laya score flow: one restaurant summary plus user preferences per model evaluation, then rank all candidate scores and show the top 10. Transport batching must not turn this into relative group selection.

## Implementation constraints to preserve

Use actual provider data only. Missing fields and failed walking-route lookups remain unavailable, never invented. Without user GPS, distinguish a route from the selected district centre from a route from the user's location. Preserve attribution, privacy, retention, and provider-content/model-input controls. Review text is evidence rather than instructions; summaries must distinguish review claims from verified attributes and total rating count from the supplied review sample.

## Deferred until prompt testing is complete

Google Places field masks and detail retrieval, Routes API configuration/calls, Gemini summary generation, Laya payload updates, result-card walking distance, backend tests and deployment will be implemented together after the user confirms the prompt testing is finished. No production settings or app code changed by this note.
