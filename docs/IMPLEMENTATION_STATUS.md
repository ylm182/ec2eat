# Implementation status · 24 September 2026

## Concise consistency review

Both source documents were read in full. No conflicting locked behavior was found: left/right select the displayed binary options, up records neutral, categories are exceptional, selection never implies a visit, and confirmation requires a later opening and four-hour delay. Behavior takes precedence from the implementation specification; technical contracts from the architecture.

Provider responsibilities align: `gemini-3.5-flash-lite` handles context/language; HF `convaiinnovations/laya-multilingual` handles ranking only through a verified serving contract; deterministic ranking remains the fallback. No live Laya route, model revision or payload has been guessed. The Gemini model ID is retained as requested; entitlement/location/model availability is still an M4 smoke-test gate.

The specified regions are listed by official Firebase documentation: [App Hosting Taiwan](https://firebase.google.com/docs/app-hosting/about-app-hosting) and [Firestore Hong Kong](https://firebase.google.com/docs/firestore/locations). They are separate provisioning choices. No deployment occurred. HF/Vertex processing locations are independent of Firestore.

History must freeze app-owned questions, answers and decision metadata while allowing licensed provider fields to expire. Provider contracts carry provenance, freshness and separate persistence/model-input permissions; unverified Places enrichment is disabled. The actual terms review remains an M6 activation gate. The schema rejects raw undeclared fields; no raw Places, Calendar or precise-coordinate history is written.

Session transitions and delayed outcome rules are compatible. `GET /api/profile` is a read-only M1 helper; absent profiles return unknown/default settings without writing on GET. The specified app-open mutation and full transactional/idempotent session orchestration follow in later milestones, rather than returning a fake completed flow now. Every eventual mutation must use the provided Origin check and authoritative server validation.

## Milestone plan

1. **M1 — foundation (implemented, locally verified):** Next.js/TypeScript shell, private authentication, domain schemas, UID-scoped server reads, provider contracts, rules/indexes, local setup and CI.
2. **M2 — swipe UI (implemented, locally verified):** `DecisionSwipeCard` using the pinned `react-tinder-card`; left/right/up, inert down, threshold feedback, common guarded tap/keyboard path, retry with stable request ID, reduced motion and mobile touch/scroll checks. Use clearly labeled synthetic fixtures.
3. **M3 — adaptive engine (implemented, locally verified):** all 22 templates/11 dimensions, app-authored archetypes, deterministic scoring, known/neutral distinction, variance questions, categorical exception, stop-by-six and server session orchestration with transactions/idempotency. Complete the mocked vertical slice.
4. **M4 — context (implemented; live activation and user frontend acceptance pending):** explicit location or manual district, independent Calendar/Weather failure handling and validated Gemini extraction with fixed-template fallback.
5. **M5 — Laya (next):** real HF recipe fixture and pinned revision, bounded scoring fallback, lease/circuit behavior, app-open warm-up and authenticated 11:00/17:00 HKT scheduled function.
6. **M6 — restaurants:** real Places shortlist only, content policy/attribution, idempotent explicit selection, Maps after persistence, honest empty/error states.
7. **M7 — history:** immutable selection snapshots, paginated history and accessible flip-to-trail cards independent of refreshed Places content.
8. **M8 — outcomes:** four-hour/new-opening eligibility, hidden-for-30-min definition, snooze for 24 hours, one prompt/opening, actual-other and correction/concurrency checks.
9. **M9 — learning/release:** recomputed recent-20 confirmed-selected priors capped at .25, deletion/disconnect, observability/cost controls, external smoke tests and deployed Hong Kong device acceptance.

## M1 defaults and limits

- Node 22; Next.js 15.5.26; React/React DOM 18.3.1; react-tinder-card 1.6.4; @react-spring/web 9.5.5. Registry peer resolution passes without `--force` or `--legacy-peer-deps`.
- Next.js 15.5 is newer than the active 15.2 line in the currently published [App Hosting support table](https://firebase.google.com/docs/app-hosting/frameworks-tooling), so treat its managed adapter support as preview and verify on the actual backend before release. It was chosen to retain the supported React 18 peer range and current 15.x patches. Do not silently move to React 19, which the required swipe library does not declare support for. Gesture hydration is still an M2 test, not proven by package installation.
- Runtime schemas cover the durable session contract, all eleven preference IDs, option meaning, answer count/issued IDs, UTC timestamps, outcome identity, shortlist membership and selection immutability. State mutation routes are not yet exposed.
- Local setup is explicitly emulator-only, loopback-only and uses a `demo-` project. Production rejects emulator configuration. Live auth requires ADC/project configuration and a server-provisioned `allowedUsers/{uid}.enabled=true` document.
- Authenticated responses are `private, no-store`; errors hide internal details. Profiles are explicitly projected; no OAuth records or raw documents are serialized as profiles.
- `apiResponse` assigns a server request ID to current GET routes. Future mutations must pass the validated client operation ID, persist body hashes/results and return the same response on retry; a random GET correlation ID is not idempotency.
- PostCSS is overridden to 8.5.28 to address audit findings in Next's pinned build dependency; the patched build passes. Vitest is 3.2.7 (critical UI-server issue fixed). npm 10.9.2 hit an optional-peer resolver error trying Vitest 4.1.11; no forced peer install was used.
- Full audit after compatible fixes: 7 moderate findings, no high/critical; production dependency audit: 2 moderate entries (`gaxios` / `uuid`, through Firebase Admin's optional Cloud Storage dependency). The remaining tooling findings involve Firebase CLI's OpenTelemetry chain and Vitest's mocker. Do not claim a clean audit; review/update these before release. No test UI server is exposed; the app does not import Cloud Storage or use uuid buffer APIs. No blanket major overrides were applied.

## Actual verification

- `npm run typecheck`: passed.
- `npm test`: 18 tests passed: verified/denied identity, spoofed UID, Origin checks, private safe errors, strict payloads, preference bounds, timestamp conversion, issued/reversed answers, duplicates, selection/outcome consistency, frozen transitions and content permissions.
- `npm run test:emulator`: 2 integration tests passed with Auth + Firestore emulators (including 32 direct client read/write denials). Approved Google identity succeeds; unapproved/disabled identity fails; another user's session returns 404. Repeated after lockfile patches. Expected permission-denied output is part of the assertions.
- Local Java was initially missing; a temporary official Temurin Java 21 runtime under `/private/tmp/ec2eat-java21` resolved that verification blocker without a system install. CI installs Java 21 itself.
- `npm run build`: passed; `npm run check:client`: passed with synthetic server-secret markers injected during build. No privileged package/name/marker appeared in browser JS.
- `npm ls react react-dom react-tinder-card @react-spring/web`: compatible, deduplicated React 18 tree.
- Browser: home rendered, setup state visible, decision action explicitly unavailable, History navigation worked. No real restaurant content was shown. Mobile gesture/retry testing is intentionally not claimed for M1.

## Remaining real integration/release gates

No live project configuration, UID allowlist, OAuth consent/KMS setup, Google API credentials/entitlement, or HF protected endpoint/revision was supplied. These block their live checks, not M2/M3. Backend provisioning must verify Next adapter support and both selected regions. Google content-use permissions must be checked before enrichment or persistent content is enabled. Resolve/review remaining dependency advisories before release. Production device tests, real selection/confirmation/history flow, scheduled warm-up and real Laya-down fallback are still outstanding.


## M2 implementation and verification · 24 September 2026

`DecisionSwipeCard` now wraps the actual pinned `react-tinder-card` package. The ordinary Next.js client component import builds and hydrates without observed errors, so no SSR workaround or gesture-engine substitution was needed. Callback identities and the down-prevention array remain stable during feedback renders, avoiding the library's listener resets mid-drag.

Left/right send the displayed option IDs; up sends `neutral` without an option ID or numeric value. Down is prevented and ignored defensively. A synchronous per-instance lock covers swipe, tap and arrow keys; buttons are outside the draggable surface. Each question gets its own component key, focus target and operation ID. Late completion after unmount is ignored and its request signal aborted. Success navigation is separate from persistence.

Defaults: position threshold = 22% of surface width, clamped to 64–120 px; a save attempt has a 10-second recovery deadline. Failure remounts the same question at its origin, preserves the selected answer as unconfirmed, disables answer changes and focuses Retry. Retrying reuses the same request ID, expected revision and body. A response lost after a commit is simulated by the demo store and replayed without a second record. These are frontend/mock guarantees; server transaction/idempotency verification still belongs to M3.

Reduced motion is read from the media query and suppresses library transforms via CSS, including during drag; directional highlights, swipes, buttons and keys remain usable. No global animation setting is changed. Touch handling is confined to the card. Arrow handling is scoped to its focused region; down, keys outside the region, modified keys and held/repeated keys do not submit.

`/demo` is visibly marked as a synthetic, non-adaptive three-question preview. It makes no provider/API calls, requires no credentials, and retains answers only until the page is reloaded or left. The retry simulator lives in a collapsed demo-only section. It does not recommend restaurants, write History or infer visits. The normal `1 / ~6` presentation is shown alongside an explicit three-fixture explanation. The authenticated application data routes and allowlist are unchanged.

Verification completed:

- Typecheck and production build passed with the real swipe dependency. Client-secret scan passed.
- 40 unit/component tests passed: 18 original foundation tests, 18 real-library component tests, 4 synthetic transport tests. Tests cover all directions, threshold feedback during drag, inert down/below-threshold movement, touch event path, buttons, arrow keys, concurrent input, Strict Mode, unchanged retry payload, late completion, timeout, cancellation and reduced-motion input.
- Browser QA at 390×844 and 320×740: left/right/up gestures work; down remains on the current question; buttons and keyboard advance correctly; lost-response retry preserves neutral and advances once. A completed trail contained exactly three answers in order.
- At 320 px, page width was 320 px (no horizontal overflow); scrolling outside the card moved the page. Browser error log was empty, including hydration. Temporary viewport overrides were reset after testing.
- Browser gestures were mouse-driven at mobile dimensions; touch events and reduced-motion media were exercised in component tests. A physical mobile-device touch smoke test remains a release check; do not describe this as device-lab coverage.

No new live integration blocker was introduced. Existing deployment/provider/audit gates remain as documented above. M3 will replace fixed question ordering with the adaptive catalog and deterministic engine and connect authoritative session writes.

## M3 implementation and verification · 24 September 2026

The authenticated `/decide` flow now uses all 22 fixed templates across eleven dimensions, seven app-authored meal archetypes and a deterministic scorer. Archetypes are uncertain search concepts, not restaurant facts. Unknown distance/novelty stay unknown. Answers derive values from the frozen server-issued question; neutral has zero evidence weight and suppresses priors. Speed/healthiness polarity, confidence-weighted utility, distance/price penalties, stable tie-breaking and softmax temperature .25 follow the architecture.

The next question uses top-five known-feature variance, context relevance and remaining uncertainty. No dimension repeats. Stops record `weight_margin`, `max_questions`, `exhausted` or `user_requested`; confidence requires three answers, top weight .70 and margin .20, with a hard six-answer cap. Ranking weights are not enjoyment probabilities.

Documented defaults: the category exception requires at least two binary answers, different known categories, maximum category mass ≤.55 and top-two weight gap <.10. At most one category question counts toward six. Its selected category contributes one unit of match/mismatch evidence to the heuristic weighted mean; it is not a numeric preference dimension or restaurant filter. Category choices use native grid buttons and a separate neutral button, never swipe gestures.

M3 accepts twelve manual districts. GPS is deferred to M4. HKT lunch defaults to 11:00–14:59 and dinner to 17:00–21:59; other hours use `other`. Weather and Calendar remain absent. Existing valid inferred profile priors may be snapshotted with their version and bounded influence; learning updates remain M9. Gemini and Laya are not called. The heuristic provider explicitly reports `laya_not_configured`.

Session writes are UID-scoped Firestore transactions with persisted issued questions, expected revisions, server timestamps, strict bodies, immutable replay responses and seven-day operation expiry. Reusing an ID with a different body returns 409. Competing answers commit once. Defaults are 30 creates/240 total mutations per user per hour. Refresh uses only a UID-scoped local session pointer; create retries retain the original request body. Restaurant recommendation remains an explicit 503 after the stop is saved; no shortlist, selection or visit is invented.

Verification: 55 unit/component tests and 5 Auth/Firestore emulator integration tests passed. Coverage includes variance-driven question changes, neutral versus unknown, categorical IDs/evidence, all-neutral termination, exact replay after later mutations, concurrent retries/competing answers, expired-operation duplicate protection, cross-user denial, Origin/strict-body checks and durable stop on unavailable Places. Typecheck, production build and browser-secret canary scan passed. M2 gesture coverage remains in the suite. Browser verification is recorded below; physical-device and live-provider checks remain release gates.

Browser limitation: `/decide` rendered correctly, but the embedded browser did not expose a usable Auth emulator popup. Full signed-in refresh/answer UI acceptance is therefore unverified here; authenticated persistence/retrieval and replay passed the actual emulator integration suite. No authentication bypass was introduced.

## M4 implementation and verification · 24 September 2026

Location is requested only from an explicit button. Manual choice uses twelve app-curated approximate neighbourhood centres, never a default Central location. GPS is checked against a coarse Hong Kong bounding box and labeled by its nearest curated centre; this is approximate neighbourhood labeling, not a boundary/geocoding service. Precise coordinates stay in request memory, never session documents or browser storage. A GPS create interrupted by reload can recover via its request ID; abandoning recovery explicitly starts a separate decision.

Context is gathered before the session transaction and before issuing the first question. Weather (2 seconds) and Calendar (6.5 seconds including optional language extraction) run independently. Absence, denial, malformed provider responses and timeouts preserve the other context and core flow. Weather stays unknown on failure. Calendar reads primary, now−3h to now+6h, recurring instances expanded, at most three pages of 50; truncated windows fail rather than imply completeness. All-day events never create a deadline. Only timing, coarse area/meal and social hints are persisted; event titles/locations remain transient. Event area never replaces current location. Social context can initialize an unknown preference at strength .15; explicit and neutral answers override it. Context does not change an already issued question.

Gemini uses ADC and the fixed `gemini-3.5-flash-lite` Vertex endpoint; minimal thinking, 512 output tokens, a conservative 2,500-byte event payload within the 4,000-token input ceiling, at most two attempts inside four seconds. Output schemas and supplied-event evidence are checked; unsupported claims are discarded against deterministic extraction. Timing stays deterministic. Failure returns rules and fixed wording; no model upgrade, chain-of-thought storage or Laya event-text input. Calendar text sent to Gemini is limited to brief titles/locations and start information, never descriptions or attendees.

Calendar OAuth starts with verified Firebase identity and exact Origin. A ten-minute random state record is hashed, bound to an HttpOnly SameSite=Lax browser cookie, atomically single-use, allowlist checked on callback and invalidated by disconnect/new authorization generation. Offline read-only consent is separate. KMS encrypts refresh tokens with UID-bound additional authenticated data; access tokens remain transient. Missing scope/refresh token is rejected. `invalid_grant` or denied Calendar access clears local authorization; disconnect immediately clears local credentials and attempts Google revocation with a bounded timeout. Failed remote revocation is disclosed. Expired state gets Firestore TTL cleanup; ciphertext is excluded from indexing.

Live calls are disabled in emulator mode. Optional `CONTEXT_FIXTURE=rain-busy|all-day|failures` is emulator-only and visibly labeled synthetic. No fixture is passed off as live data or an authenticated Google connection. Weather activation additionally requires explicit content-persistence approval; default off. Weather provenance uses one-hour expiry, Calendar hints six hours. Actual provider-content retention cleanup and applicable Weather attribution/terms must be verified before turning on that persistence gate; timestamps alone do not establish permission. Existing regions remain unchanged and nothing was provisioned.

Backend verification: 67 unit/component tests and 9 Auth/Firestore integration tests passed. M4 covers location bounds/manual centres, all-day/past/cancelled events, evidence rejection, independent absence/failure, explicit/neutral precedence, bounded timeout/abort, Weather validation, bounded Calendar pagination, pinned Gemini/repair/fallback, KMS UID binding, persisted coarse-only context, replay without another provider call, OAuth browser binding/expiry/replay/allowlist denial, encrypted-only storage, revoked refresh cleanup, late callback rejection, Origin and honest unconfigured status. Typecheck, production build and client-secret scan passed. The build injected synthetic secret markers for HF, OAuth and Weather; privileged markers were absent from browser output.

The user will perform frontend acceptance using `docs/M4_FRONTEND_TESTS.md`; no M4 browser pass is claimed. Real OAuth consent/client/redirect setup, KMS IAM, Weather entitlement and approved retention/attribution, and Vertex model/location entitlement remain live smoke-test gates. These are configuration/release blockers, not simulated successes. M5 remains next.
