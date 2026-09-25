# Archived support case draft — not sent

Superseded: the owner confirmed permission is granted on 25 September 2026. No new support submission is required for this implementation.

Subject: Clarify Places API use for personalized restaurant ranking and third-party inference

Project: ec2eat-davidyu-prod
Application: https://ec2eat--ec2eat-davidyu-prod.asia-east1.hosted.app/

We operate a personal Hong Kong restaurant decision app using Places API (New). Please clarify the following under the agreement applicable to our billing account, or route this request to the appropriate licensing team.

The app obtains up to 20 nearby restaurants, filters unavailable/out-of-range entries, and reduces the candidates to at most 10. It currently uses deterministic calculations from distance and price to display up to three recommendations. It stores place IDs, user answers and decision scores/weights, but does not store raw search responses, restaurant names, addresses or reviews as history. Current restaurant details are retrieved for display with Google attribution and Maps links.

We propose using a fixed pretrained Laya model on a private Hugging Face Inference Endpoint to score these candidates. The proposed request contains place IDs, normalized distance derived from Places coordinates, normalized price level and the user's explicit preference answers. It excludes names, addresses, reviews, photos, raw GPS coordinates and Calendar event text. The model is used for request-time inference, without training, fine-tuning or model improvement. We have not enabled this Google-to-Hugging-Face path. Hosting-provider retention conditions would be verified before activation.

Please confirm:

1. Whether this transient third-party processing is permitted, and under which conditions.
2. Whether our existing deterministic filtering/reordering and proposed model-ranked recommendations are permitted under section 3.2.3(g).
3. Whether normalized distance/price features and storing resulting decision scores/weights are permitted under sections 3.2.3(b) and (c), and any retention limits.
4. Whether real-request functional/latency checks without training or model improvement are permitted; we use synthetic fixtures for automated tests.
5. If restaurant types or other fields could later be used to match cuisine preferences, which fields and transformations are permitted? We are not seeking permission to invent attributes or create a training dataset.
6. Whether a different agreement or service is required for this exact flow, and any applicable attribution requirements.

Please distinguish ordinary Places API permission from permissions specific to Maps Grounding Lite. A pointer to the applicable written terms or account-specific clarification would help us implement the correct flow.

Submission route: https://developers.google.com/maps/support
