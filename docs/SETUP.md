# Setup and deployment boundaries

## Local development

`npm run dev:emulator` loads `.env.example` into only the development process. Start `npm run emulators`, then `npm run seed:emulator` first. Java 21 is required for Firestore. Node 22 is required for the app. `npm run test:emulator` starts/stops isolated emulators and refuses to run without both emulator hosts. It uses isolated Auth/Firestore ports 9199/8180 and clears only its `demo-ec2eat` test data. The manual preview remains on 9099/8080. Do not point the test process at the preview hosts.

The development seed uses synthetic email addresses and server-managed allowlist entries. Google sign-in is simulated by Firebase Auth emulator. There is no local bearer-token bypass. Missing integrations are explicit, not mock restaurants passed off as Places results.

## Environment variables

- `APP_MODE`: explicit `emulator` or `live`. Never `emulator` in a production process.
- `APP_ORIGIN`: exact browser origin used for mutation validation; HTTPS in live mode. Do not infer it from an untrusted forwarded Host header.
- `GOOGLE_CLOUD_PROJECT`: actual Firebase/GCP project in live mode; `demo-ec2eat` locally. ADC is used in live mode. Do not download/commit service-account JSON.
- `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`: local loopback host:port only; forbidden in live mode.
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: public Firebase browser configuration, provided at build time. The browser API key is not a server credential. Apply supported restrictions in the actual project.
- `NEXT_PUBLIC_AUTH_EMULATOR_URL`: local HTTP Auth emulator only; forbidden in production. Leave unset for production builds.
- `GEMINI_MODEL`: `gemini-3.5-flash-lite`; no implicit model upgrade.
- `VERTEX_LOCATION`: initial candidate `global`; verify model/project entitlement in M4 before enabling the adapter.
- Later M5: `LAYA_BASE_URL`, `LAYA_MODEL_REVISION`, serving recipe/runtime version; HF token via Secret Manager only. No default endpoint/revision is fabricated.
- Later M4/M6: server Maps/Weather key, OAuth client ID/secret, callback URI and KMS key resource. Add Secret Manager references only after actual names exist; never prefix server secrets with `NEXT_PUBLIC_`.

## Provisioning checklist — no resources provisioned yet

1. Create separate development/production Firebase projects when authorized for live integration. Before any app data, explicitly create regional Firestore **asia-east2 (Hong Kong)**. Database placement is not controlled by App Hosting configuration.
2. Create Firebase App Hosting backend **asia-east1 (Taiwan)** with Node 22; verify support for the pinned Next.js version. `apphosting.yaml` records min 0/max 2 instances but cannot choose the backend's region. Do not replace this with Firebase Hosting or a different region silently.
3. Enable Google Auth and its authorized domains. Provision `allowedUsers/{actualUid}` with `{ enabled: true }` via administrator access. Sign-in alone is insufficient. Never allow users to edit allowlist documents. The allowlist is checked on every user request.
4. Deploy the versioned Firestore rules/indexes to the intended project. All browser Firestore access remains denied; only authenticated/allowlisted server repositories may act. The Admin SDK bypasses rules, so retaining UID scoping is mandatory.
5. Indexes: selected history (`status`, `selectedAt DESC`), pending prompts (`status`, `outcome.status`, `outcome.eligibleAfter ASC`); large question/answer arrays excluded. `operations.expiresAt` is a TTL field; session mutations set it to seven days. Single-field `selectedAt` indexing remains enabled. History pagination is 20 records when M7 is implemented.
6. Grant runtime least-privilege Firestore/Auth access using its service account and ADC. Add Vertex/Secret Manager/KMS permissions only for enabled adapters. Configure exact APP_ORIGIN and public Firebase config; leave all emulator variables absent.
7. M4: separate read-only Calendar consent; encrypted refresh tokens; bounded optional contexts. M5: protected HF recipe smoke fixture, scale 0–1, requested 60-minute inactivity timeout and shared warm-up lease. Schedule runs at 11:00/17:00 Asia/Hong_Kong in Taiwan. These are requirements, not deployed resources in M1.
8. M6+: confirm current Google content terms; use request-lifetime Places content by default, retain durable place IDs/app-owned trails, show attribution. No persistent enrichment or model input without its separate permission gate.
9. Before release: resolve/review dependency audit findings, run real provider smoke checks and Hong Kong device flow, configure quotas/billing alerts/30-day technical log retention, complete deletion/disconnect and privacy/terms details. Never deploy paid resources implicitly.

## Data boundaries for subsequent milestones

Profile reads are read-only in M1. Authoritative mutations must use Firestore transactions, server timestamps, expected revisions, UID-scoped operation records/body hashes, and the same request ID on retries. External provider calls run outside transactions. Repository conversion preserves nested UTC timestamps. Session selected snapshots are frozen; outcome corrections remain separate and recompute priors. Do not expose a generic client document write API.

## M3 local flow

Use `http://localhost:3000/decide` so the origin matches `.env.example`. Sign in with the seeded synthetic owner in the Auth emulator, select a manual district and answer. The server saves every issued question and accepted answer. Refresh resumes the active session using a UID-scoped session pointer in sessionStorage; full answers remain server-side. Restarting emulators can invalidate that pointer.

M3 adds POST session/create, answer and recommend routes. Every mutation verifies identity, allowlist, exact Origin and strict input; Firestore transactions enforce expected revision, request-body hash and original-response replay. Operations expire after seven days. Default per-user hourly limits are 30 creates and 240 total mutations; replays do not consume another allowance. Provider calls never run inside transactions.

The recommend route records the stop and returns `503 PLACES_NOT_CONFIGURED`; the UI shows the saved question trail and an honest unavailable state. GPS, Calendar/Weather and Gemini context remain M4, HF Laya remains M5, real restaurant results remain M6. No selection or visit is generated by this intermediate flow.

## M4 configuration and live gates

No live values are supplied in this repository. Calendar stays optional when configuration is missing. Use `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` (Secret Manager), and `CALENDAR_KMS_KEY` (full symmetric CryptoKey resource). Register exactly `${APP_ORIGIN}/api/calendar/callback` in the Google web OAuth client. Enable Calendar API, configure consent/test users for `https://www.googleapis.com/auth/calendar.events.readonly`, and grant the runtime KMS encrypt/decrypt access to only that key. The callback binds to a single-use server state and browser cookie; it does not accept a client-provided UID. Deploy the added `oauthStates.expiresAt` TTL and ciphertext index exemption. Test consent denial, missing scope, revocation and disconnected state with a real account before release.

Weather: enable Google Weather API and provide server-only `GOOGLE_WEATHER_API_KEY`. The adapter uses current conditions, metric units and request-only coordinates. It remains disabled unless `GOOGLE_WEATHER_PERSIST_APPROVED=true` is deliberately set after applicable storage/derivative/attribution terms and retention cleanup are verified. See `docs/WEATHER.md`: deploy and verify the five-minute physical cleanup and indexes before enabling; app expiry is 30 minutes. Do not enable this simply because a key works. Google content is never sent to Gemini from Weather. Unknown conditions do not imply sunshine.

Gemini: enable the project API/billing and least-privilege Vertex access for ADC, retain `GEMINI_MODEL=gemini-3.5-flash-lite` and independently verify `VERTEX_LOCATION=global` entitlement. Set `GEMINI_CONTEXT_ENABLED=true` only after a real extraction smoke test. OAuth Calendar consent copy explains optional Google model extraction; only minimized transient event text is used. KMS/Vertex endpoints have no fabricated tokens. Local contract tests do not verify actual project access.

Synthetic frontend scenarios: restart the dev process with `CONTEXT_FIXTURE=rain-busy npm run dev:emulator`, `CONTEXT_FIXTURE=all-day npm run dev:emulator`, or `CONTEXT_FIXTURE=failures npm run dev:emulator`. Never use these in live mode. Start a new decision after changing fixture; an existing session correctly retains its original context. The default `npm run dev:emulator` has no fixture or live optional calls.

Read-only provider contracts were checked against [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Weather current conditions](https://developers.google.com/maps/documentation/weather/current-conditions), [KMS encryption](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys/encrypt), and [Gemini 3.5 Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite). Live smoke tests are still required.

## M5 scoring and scheduled function

`npm --prefix functions ci` then `npm --prefix functions run build` verifies the separate Node 22 scheduled worker. CI runs this build. Firebase configuration references the `functions` source/codebase, but nothing is deployed by ordinary build/test commands. The worker shares the Next app's Firestore project and `internal/layaWarmup` / `internal/layaCircuit` documents. No additional index is needed; direct browser access remains denied.

Follow `tests/fixtures/laya/README.md` before installing a real recipe. Set server-only `LAYA_BASE_URL` (protected HF origin), `LAYA_MODEL_REVISION` and `LAYA_RUNTIME_VERSION` to its verified values and supply `HF_TOKEN` through Secret Manager for both App Hosting and the scheduled worker. The installed recipe validates the tested model/runtime and response contract; see docs/LAYA_DEPLOYMENT.md. Deployment must verify scheduler service-account IAM and reject anonymous HTTP invocation; [Firebase scheduled functions](https://firebase.google.com/docs/functions/schedule-functions) create the associated job and invocation permissions. Do not manually expose a public worker. Keep the schedule in Taiwan, Firestore in Hong Kong, and HF replica/idle settings as explicitly verified in its control plane.

The warm-up input is a tiny synthetic two-candidate inference request passed through the installed recipe; readiness is not assumed from a generic health ping. The installed recipe's live fixture must verify that input. Scheduled 11:00/17:00 calls do not guarantee lunch/dinner readiness after idle scale-down; app-open warm-up and fallback remain required. No continuous keep-alive or model upgrade is added.

## M6 Places and selection

The M3-only recommend-unavailable behavior above is superseded: the route now saves a shortlist when Places is configured, and otherwise keeps the saved stop/answers with a recoverable 503. See [M6 frontend acceptance](M6_FRONTEND_TESTS.md) for explicit synthetic emulator modes.

Live prerequisites: server-only `GOOGLE_PLACES_API_KEY`, Places API (New) enabled with billing/restrictions, and `PLACES_CONTENT_USE_APPROVED=true` after reviewing the applicable terms, display/attribution and public privacy/terms pages. Store the real key in Secret Manager; do not add an invented secret resource or any NEXT_PUBLIC key. App Hosting stays in Taiwan; Firestore stays in Hong Kong.

`PLACES_MODEL_INPUT_APPROVED` is a separate permission gate, false by default. Production is set to true following the owner’s permission confirmation; see `RESTAURANT_RANKING_ACTIVATION.md`. Without it, restaurant ranking uses the deterministic local scorer and sends no Google-derived features to HF. No restaurant enrichment, raw response, photo URL, name, price, rating, coordinates or hours are durably stored. Only IDs and app-owned decision metadata are retained. The current implementation has no persistent enrichment switch.

Search defaults: 1.5 km, or 5 km for explicitly answered distance tolerance ≥.8. One explicit empty-result expansion widens to 5/10 km; no automatic widening. One nearby call, up to two supplemental text searches, ≤10 scoring candidates, ≤3 final cards. Text Search location bias is followed by a strict local radius filter. Supplemental failure may preserve already returned candidates; total absence with failed search is an error, not an empty-success result.

Budgets: nearby 4 seconds; each text 2.5 seconds; whole search 12 seconds including scoring; each details operation 5 seconds including optional 2-second photo lookup. Shared per-user Firestore budget: 120 search/card-load/selection-check operations per hour (each operation has bounded underlying API calls). No unbounded automatic retries. Identical recommendation operations use a 30-second owner-fenced lease; seven-day replay snapshots have TTL in `restaurantOperations`, with response indexing disabled. Deploy those field settings with the existing Firestore rules/indexes when live provisioning is authorized.

Recommendation and selection routes accept only verified allowed identities, strict input, Origin and revision checks. Selection refreshes status without loading photo media and saves pending outcome eligibility at selection +4 hours. Current card details are request-lifetime/no-store, membership-scoped to the session and preserve shortlist order. Preview synthetic IDs cannot cross into the live provider.

Transient GPS stays in page memory until search; reload intentionally falls back to the district centre. Displayed straight-line distance is from that labelled district centre, not an ETA and not a claim of current GPS distance. Restaurant taste/cuisine features remain unknown; no unsupported tags are inferred from Google text. Small valid pools may yield one card rather than filling the list with invented choices.

## M7 history

`GET /api/history?cursor=...` returns selected sessions only, newest first, 20 records per page with one lookahead record. Ordering is `selectedAt DESC, document ID DESC`; the existing `status ASC, selectedAt DESC` composite index supplies the implicit same-direction document-ID tie-breaker. Deploy/verify that index in the actual project before live acceptance; emulator success does not prove production index availability.

The canonical base64url cursor contains a session ID, not a user ID or trusted timestamp. Its anchor is resolved only inside the authenticated user's collection and must still be selected. Pagination uses the raw Firestore document snapshot to preserve timestamp nanoseconds. Invalid/missing/foreign/unfinished anchors yield 422 and the UI offers a latest-page refresh. Newer inserts do not shift older page boundaries; no full-history listener or client Firestore access is introduced.

`GET /api/history/:sessionId/restaurant` is a session-scoped extension to the planned generic restaurant-details endpoint. It checks selected-session ownership and fetches only the selected ID; it does not allow arbitrary ID lookups. It reuses M6's provider source guard, five-second details budget, optional photo handling, no-store response and per-user provider budget. The History UI loads details as cards enter the viewport, keeps them only in component memory, and offers manual retry. If IntersectionObserver is unavailable, manual refresh remains available.

History reads never score, rewrite templates, select, confirm visits or recompute priors. The current outcome is displayed separately from the frozen decision. Expired or nonpersistable Weather/Calendar fields are omitted in the history read projection while app-owned question wording and answers remain intact; this is not a database retention-cleanup job. The existing retention-policy/cleanup release gates still apply. Current restaurant content stays separate from the durable session and replay records.

See [M7 frontend acceptance](M7_FRONTEND_TESTS.md). No additional credentials, migrations, paid services or region changes are required for local M7 use.

## M8 app openings and outcomes

The client now uses `POST /api/app/open {requestId,launchId}` for a profile, at most one pending prompt and independently bounded HF warm-up. The older `/api/app-open` remains a warm-up-only compatibility route. A module-level opening ID survives client navigation, resets on a full document load, and rotates after ≥30 minutes hidden. Short tab switching does not rotate it. StrictMode/navigation share the same in-memory request and presentation marker; no launch or provider-content cache is placed in browser storage.

Server `users/{uid}/openings/{launchId}` records the claimed session (or no eligible session) and completion. It never allocates a second prompt to that opening, even if four hours pass while the page stays open. Opening markers are deliberately not TTL-deleted, so a long-lived page cannot re-claim after cleanup; include them in M9 account-data deletion. Prompt claims change only outcome prompt metadata/session revision. A new composite index orders `status, outcome.status, selectedAt DESC`; pending records older than four hours are scanned in pages of 20 until the newest unsnoozed eligible record is found. The separate eligibleAfter guard is still checked. Deploy and verify the declared index before live acceptance.

`POST /api/decision/sessions/:id/outcome` requires requestId, launchId, expectedRevision and expectedOutcomeRevision, plus exactly one confirmed status or `snooze:true`. The server enforces selected status, four-hour eligibility and a launch different from selection, including History corrections. Selected visits derive the actual ID from the saved selection. Other visits may leave actualPlaceId null. No-meal-out always has null actual ID. Snooze leaves PENDING and suppresses automatic prompts for 24 hours and until another opening; explicit History confirmation can still occur under the original age/opening gates. Confirmed outcomes cannot be snoozed or reset to PENDING.

All writes use UID-scoped transactions, body-hash replay and both revisions. Original context, questions, answers, shortlist and selection are immutable. Concurrent alternate outcomes produce a stale-revision response rather than overwriting each other. Canonical outcome replacement is the source for M9's bounded prior/visit-relation recomputation; M8 applies no irreversible learning or visit-count increments. Limits: 60 distinct app-open requests and 120 outcome mutations per UID/hour; exact replays do not consume another mutation.

Optional `POST /api/restaurants/search` requires requestId, sessionId, launchId and a trimmed 2–80-character query, and is gated by the same ownership/age/opening rules. The client debounces 400 ms. A HK-biased text search is geographically filtered, capped at five current display results, and does not reject a restaurant merely because it is currently closed. Limits: 30 lookup calls per UID/hour, 3.5-second search plus parallel 4-second details within an 8-second primary budget. Concurrent receipt recovery may add one bounded 4-second details refresh. Search text/content is not persisted. The first 15-minute `actualLookups` receipt stores only IDs, source, session binding, hash and expiry; retries refresh display fields without changing accepted IDs. Saving an actual ID requires that receipt, correct source/session, an unexpired timestamp and a different ID from the original selection. Unknown-other remains usable without Places.

Local manual timing fixtures are opt-in: `npm run seed:outcomes:emulator -- demo-owner`. This resets only three clearly synthetic M8 fixture IDs for an existing allowed emulator user and refuses real-project configuration. It does not alter real selection timestamps. See [M8 frontend acceptance](M8_FRONTEND_TESTS.md); do not change runtime clocks to bypass the gate.

## M9 learning, deletion and release checks

Learning reads the latest 20 `VISITED_SELECTED` sessions by selected time and descending ID. Only issued left/right answers contribute dimension values. Each prior is their mean with strength `0.25 × contributing-session-count / 20`, capped at 0.25. This conservative count-based strength is an implementation default. Neutral, pending, snoozed, no-meal-out and other-place outcomes add no directional evidence. Category answers imply no undocumented dimension mapping. Current explicit/neutral answers override priors. No fine-tuning or background training occurs.

A deterministic content-derived prior version and source session IDs are stored on the user profile, alongside a transaction revision. Selection, outcome replacement and deletion recompute from canonical sessions, atomically with their mutation. Reading 21 recent confirmations permits removing a top-20 record and refilling from the next one. Exact replay returns the saved response without learning again. An existing pre-M9 profile initializes priors lazily on its next new decision; existing session snapshots are never rewritten. Stale precomputed scoring is discarded if the authoritative scoring input changed.

Affected `restaurantRelations/{placeId}` records are recomputed from matching canonical sessions: selected count includes pending selections; actual-visit count includes confirmed selected and known other-place visits. `lastVisitAt` uses the latest selected-session meal timestamp as the known meal date, not a claimed exact arrival or confirmation time. Unknown other-place visits cannot create a restaurant relation. Relations for older history initialize when that restaurant is next affected; they are not the learning source. Relation recomputation reads all matching history for the affected IDs; this is a personal-app default, not an unbounded multi-user aggregation service. Monitor transaction cost/latency before larger-volume use.

`POST /api/sessions/:sessionId/delete` accepts `{confirm:true,expectedRevision}`; `POST /api/account/delete` accepts `{confirm:"DELETE"}`. Both require verified Google allowlist access and exact Origin. Session tombstones override replay and recreation. Account deletion fences all app/OAuth writers before erasing records and is resumable through the same route. Browser deletion controls require an explicit confirmation; implementation tests use isolated disposable identities. Administrator access-control/deletion markers remain, and account reactivation is deliberate. See [release readiness](M9_RELEASE.md) for retention, revocation, index, rollback and billing details, and [user-run frontend scenarios](M9_FRONTEND_TESTS.md).

Search/ranking now has a 10-second work deadline instead of M6's 12 seconds. Real Calendar token/event acquisition has a two-second shared deadline, with the existing optional four-second Gemini phase inside a 6.5-second combined context envelope. Weather stays two seconds. Firestore and client-network latency still need real Hong Kong-device measurement. Structured telemetry excludes raw user/provider payloads. `npm run check:release` checks local declarations; `npm run check:release -- --live` reports missing real configuration/evidence and currently must fail. Cloud log retention, alarms, spend limits/alerts and actual service regions are operator provisioning gates, never inferred from local test success.

### Production Laya preparation — 2026-09-25

The candidate HF Inference Toolkit wrapper is in `deploy/laya/` (see its README).
It pins the multilingual checkpoint and runtime, uses CPU, validates all returned
candidate scores and rejects oversized inputs. Five isolated handler tests passed;
real local English/Traditional Chinese inference returned complete score vectors.
This is local evidence, **not a verified HF endpoint contract**. The application
recipe remains null and deterministic fallback remains enabled. Next upload the
wrapper's three serving files to an owned HF model repo, pin that repo commit,
then verify custom-handler startup and authenticated synthetic inference on HF.
No endpoint was created by this work. The user's production HF token is already
in Secret Manager; do not grant it repository-write permissions for uploading.

2026-09-25 HF endpoint smoke update: v2 endpoint authenticated synthetic scoring
passed in four cases and anonymous access was rejected (401). See
`tests/fixtures/laya/hf-smoke.json`. Request times from the developer Mac were
1.31–1.49 seconds. No Firebase runtime configuration was enabled by this check;
private-repo cold start, Taiwan execution, and app recipe/warm-up remain pending.
