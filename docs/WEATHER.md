# Weather integration

Google Weather current conditions are requested once when creating a decision, using request-only GPS coordinates or the app-curated centre of the chosen district. Metric units; 2-second timeout; no automatic retries. Failure/denied/missing credentials remain optional context and never imply sunny weather.

## Production configuration

- Enable `weather.googleapis.com` on `ec2eat-davidyu-prod`.
- Dedicated server key `ec2eat-weather-server`, restricted to Weather API only. Secret Manager `GOOGLE_WEATHER_API_KEY@1`; App Hosting runtime service account has access. Never expose it in browser configuration.
- `GOOGLE_WEATHER_PERSIST_APPROVED=true` only after indexes and `cleanExpiredWeather` are deployed and verified. To disable new requests, set it to false and roll out.
- App Hosting / scheduled function: Taiwan (`asia-east1`). Firestore remains Hong Kong (`asia-east2`).

## Retention and use

Current conditions have a one-hour maximum under the [current service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), reviewed 2026-09-25. App expiry is 30 minutes, leaving operational margin. The Taiwan scheduled function runs every 5 minutes and physically clears weather from `sessions.context`, `operations.response.context`, and `restaurantOperations.response.context`. It updates only weather/availability fields in transactions, preserving concurrent answers and visits. Indexed collection-group pagination includes every user and retry copy. Firestore's asynchronous TTL is not used for this deadline.

Expired content is also removed on decode/encode so stale requests cannot recreate it, and UI hides it at expiry. History does not preserve weather indefinitely. Questions and explicit user answers remain. Weather may prioritize an app-owned distance question, never overwrite an answer; its content or derived rain hint is not sent to Laya/Gemini (`modelInputAllowed=false`). Restaurant scoring continues to use explicit preferences. Raw locations, API bodies and secrets are not logged.

Google Maps text attribution accompanies the display. The dedicated API returns actual current conditions, not forecasts or weather alerts. An unknown condition remains unknown.

## Operations / tests

Inspect Cloud Scheduler execution status and Cloud Function `cleanExpiredWeather` logs (`weather_cleanup`, removed count). A successful cleanup writes `system/weatherRetention.lastSuccessAt`; new Weather requests automatically stop when it is older than 10 minutes. Failure retries are enabled; investigate immediately if cleanup fails or has no successful execution within 10 minutes, disable new Weather requests until resolved. Prolonged scheduler outages can breach the deadline; read-time redaction alone does not solve physical retention. Backups/PITR that retain provider content must remain disabled or separately address this retention limit.

Verified direct production Weather request: HTTP 200, condition and temperature fields present. Unit tests cover expiry and model-input exclusion; emulator test verifies actual removal from all three collections and preservation of a fresh record/choice/revision.

Frontend acceptance:
1. Start a new choice with location permission: question header shows short weather text, Celsius temperature and Google Maps attribution.
2. Deny location and choose a district: current weather uses that district centre.
3. Continue answering: your answer direction is unchanged; no extra weather question is required.
4. Open an old history entry: expired weather is absent, but answers/restaurant/visit remain.
5. Simulated unavailable Weather configuration: decision still works; no invented sunny condition.
