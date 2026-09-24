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
3. **M3 — adaptive engine (next):** all 22 templates/11 dimensions, app-authored archetypes, deterministic scoring, known/neutral distinction, variance questions, categorical exception, stop-by-six and server session orchestration with transactions/idempotency. Complete the mocked vertical slice.
4. **M4 — context:** explicit location or manual district, independent Calendar/Weather failure handling and validated Gemini extraction with fixed-template fallback.
5. **M5 — Laya:** real HF recipe fixture and pinned revision, bounded scoring fallback, lease/circuit behavior, app-open warm-up and authenticated 11:00/17:00 HKT scheduled function.
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
