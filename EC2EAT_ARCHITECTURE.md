# ec2eat — Architecture Specification

Version 1.0 · 24 September 2026 · Companion: [Implementation specification](EC2EAT_IMPLEMENTATION_SPEC.md)

## 1. Deployment decisions

Use Next.js App Router, TypeScript, React and a small CSS/Tailwind component layer. Keep domain logic in pure TypeScript; use Node-runtime route handlers for Firebase Admin and external integrations. Pin supported package versions and the lockfile during M1; **`react-tinder-card` is the required MVP gesture component**, with a compatible `@react-spring/web` dependency; verify React peer compatibility during M1.

- **Firebase App Hosting: `asia-east1` (Taiwan).** Hosts both frontend and ordinary Next.js backend. Taiwan is an available App Hosting location. Static assets use its CDN; personalized responses must not be publicly cached. [App Hosting architecture and locations](https://firebase.google.com/docs/app-hosting/about-app-hosting)
- **Cloud Firestore: regional `asia-east2` (Hong Kong).** Explicitly choose the database location before creation; do not assume the hosting region sets it. The location is a foundational provisioning choice. [Firestore locations](https://firebase.google.com/docs/firestore/locations)
- **Firebase Auth:** Google sign-in plus server-enforced private allowlist. This does not itself grant Calendar access.
- **General backend:** Next.js in Taiwan. Accept and measure Taiwan–Hong Kong database latency; batch reads/writes. No separate custom application server.
- **Scheduled work:** one Firebase scheduled function, preferably `asia-east1`, sharing the warm-up module. No self-hosted Laya/Cloud Run service in MVP.
- **Laya:** protected Hugging Face Dedicated Inference Endpoint, scale-to-zero, CPU configuration first. Endpoint geography depends on offered hardware; measure from Taiwan rather than assume Hong Kong availability.
- **Gemini:** Google Cloud/Vertex AI authenticated with the runtime service account. Configure the model location independently; `global` is the initial deployment candidate, subject to a real project smoke test. Firestore in Hong Kong does not imply all processing/data stays there.

Architecture path: browser → authenticated Next.js routes → Firestore and provider adapters. The browser never calls HF, Gemini or Calendar with privileged credentials. Scheduled function → HF directly through the shared adapter.

Suggested modules: `app/` pages/routes, `lib/domain/` schemas/engine/catalog, `lib/server/` auth/repositories/orchestration, `lib/providers/` interfaces/adapters, `functions/` scheduled warm-up, `tests/fixtures/` synthetic data. Mark server-only modules accordingly.

### Swipe component integration

Wrap `react-tinder-card` in a client component (`"use client"`) named `DecisionSwipeCard`. Pin compatible versions in the lockfile; the upstream web installation specifies `@react-spring/web@9.5.5`, so verify that combination against the selected React version rather than blindly installing latest packages. [Component installation and API](https://github.com/3DJakob/react-tinder-card)

- Set `preventSwipe={['down']}`. Map `onSwipe` left/right/up to left/right/neutral through one guarded answer handler; ignore down defensively.
- Use position-based thresholds sized to the card. Threshold callbacks drive directional feedback. Clip exiting cards within the decision surface while preserving page scrolling outside it.
- Tap/keyboard actions use the same guarded submission path, optionally invoking the component ref's `swipe(direction)`. Never submit once from the button and again from its swipe callback.
- `onCardLeftScreen` handles presentation cleanup only; persistence belongs to the answer handler. Key cards by question instance ID and ignore stale callbacks.
- While saving, block further interaction and keep a visible saving/retry state. On failure, restore the card via `restoreCard()` or remount the same question; reuse the request ID. This is recovery, not a user-facing Undo feature.
- Prefer action buttons outside the draggable card; interactive children inside it need the documented `pressable` class. Supply keyboard, focus and reduced-motion handling in the wrapper.
- History uses a separate React/CSS flip component; categorical grids do not use swipe gestures. Verify mobile touch/scrolling, duplicate prevention, recovery and Next.js hydration in M2. If SSR causes a demonstrated issue, isolate the import with client-side dynamic loading rather than replacing the library silently.

## 2. Providers and service boundaries

Use asynchronous interfaces accepting an AbortSignal, typed input and versioned output. Validate all external responses at runtime, for example with Zod. Provider-specific HTTP payloads stay inside adapters.

```ts
interface DecisionProvider {
  rank(input: DecisionInput, signal: AbortSignal): Promise<DecisionResult>;
  warm(signal: AbortSignal): Promise<{ ready: boolean }>;
}
interface LanguageProvider {
  extractContext(input: LanguageInput, signal: AbortSignal): Promise<ContextHints>;
  phrase(input: ApprovedMeaning, signal: AbortSignal): Promise<string>;
}
interface PlacesProvider {
  search(input: SearchInput, signal: AbortSignal): Promise<PlaceCandidate[]>;
  details(placeId: string, signal: AbortSignal): Promise<PlaceDetails>;
}
interface CalendarProvider {
  context(uid: string, window: TimeWindow, signal: AbortSignal): Promise<CalendarHints>;
}
interface WeatherProvider {
  current(location: Coordinates, signal: AbortSignal): Promise<WeatherHints>;
}
```

Domain types: `DecisionInput` contains stage (`archetype` or `restaurant`), bounded candidate IDs and features, current explicit preferences, weak priors, and minimized context. `DecisionResult` contains ordered `{id, score, weight}` entries, optional provider confidence, confidence kind, provider/model/revision, latency and fallback reason. `score` is utility; `weight` is a normalized ranking weight. Neither is a predicted visit probability.

Provide `HuggingFaceLayaProvider`, `HeuristicDecisionProvider`, `VertexGeminiLanguageProvider`, real Google adapters and deterministic test adapters. Application code depends on interfaces; no provider-specific branching inside UI components.

### Gemini

Default **`GEMINI_MODEL=gemini-3.5-flash-lite`**, matching the discussion and current official model identifier. Use small structured outputs for Calendar/user-language extraction and optional wording/reasons. It is not the primary ranker. [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Google Cloud model documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite)

Use the Google Cloud API path rather than relying on a supplied AI Studio key; confirm project entitlement and model/location support in M4. An unavailable model means deterministic extraction/templates and an explicit configuration issue, not an automatic move to Pro. Any stronger model requires a deliberate configuration change justified by measured extraction failures.

Implementation defaults: cap input at 4,000 tokens and output at 512; use the minimum supported thinking setting; at most one repair attempt within a total four-second language budget. Validate enums, ranges and evidence references. Discard unsupported claims. Template-based questions/reasons require zero model calls. Do not send raw Calendar text to Laya or retain model chain-of-thought.

### Laya / Hugging Face

Use multilingual checkpoint **`convaiinnovations/laya-multilingual`** with a pinned revision and serving-image/runtime version. The upstream server describes typed state/questions and `/v1/systemone`; validate the selected HF recipe’s real route, authorization and response shape before writing the adapter. A generic Transformers classification endpoint is not automatically this API. [Laya model and serving documentation](https://huggingface.co/convaiinnovations/laya)

M5 must capture a sanitized working request/response fixture from the deployed recipe. Verify multilingual input, all requested candidate IDs, finite scores, candidate limits and context length. Use a typed choice over the bounded candidate set; map its returned scores to the domain contract. If the contract or model cannot reliably support that, expose a blocked live-integration check and continue with heuristics rather than fabricating probabilities. Model confidence is uncalibrated for this restaurant use case until independently evaluated.

Configuration: minimum replicas 0, maximum 1, scale-to-zero on, idle timeout **60 minutes** where supported; record the actual configured value. Cold starts may take minutes and are not covered by a promised 10–60-second SLA. Current HF documentation describes 503 during initialization; also handle transient 502/504. [HF autoscaling](https://huggingface.co/docs/inference-endpoints/guides/autoscaling)

Warm-up behavior:

- Scheduled function: cron `0 11,17 * * *`, timezone **`Asia/Hong_Kong`**, daily. No Calendar data is needed.
- Authenticated app-open route sends one tiny valid inference request, concurrently with context loading; UI does not await readiness.
- Share a Firestore lease (`leaseUntil`, `lastAttemptAt`, `lastSuccessAt`) to prevent duplicate warm-ups across instances. Default app-open suppression window: 10 minutes since the last attempt; always release/expire the lease safely.
- Scheduled worker uses bounded jittered waits around 5/10/20/40 seconds, capped at 120 seconds overall, with a configured function timeout above that budget. Retry only transient readiness/network failures; do not retry invalid credentials/payloads.
- App-open route has a three-second budget and returns ready/warming/unavailable. Sending the inference request triggers scale-up; do not rely on unawaited work surviving a Next.js response. Subsequent scoring calls may find it ready.
- Normal ranking has a two-second total budget, at most one retry within that budget, then heuristics. Add a 60-second circuit cooldown after three consecutive failures.
- A successful 11:00 warm-up with 60-minute inactivity timeout can expire around noon; 17:00 does not guarantee 18:30 readiness. Keep app-open warm-up and fallback. Do not add continuous keep-alive traffic implicitly.

HF charges for provisioned compute time, including initialization/running, rather than simply per request; actual hardware pricing must be checked in the endpoint dashboard. The discussed $0.067/hour is an example, not a quote. At that rate, two one-hour windows daily would be $4.02 over 30 days, excluding additional usage/initialization and other services. [HF pricing](https://huggingface.co/docs/inference-endpoints/pricing)

## 3. Context and restaurant integrations

**Location:** browser geolocation only after permission; manual area fallback resolves to a curated area centroid, tagged `manual`. Keep precise coordinates transient and store only the coarse area in durable history by default. Event locations never silently substitute for GPS.

**Calendar:** incremental server OAuth authorization-code flow with offline access; scope `https://www.googleapis.com/auth/calendar.events.readonly`. Use the primary calendar in MVP and query now−3h to now+6h with bounded pagination and expanded recurring instances. Extract timing/area/meal/social hints; all-day events must not become precise deadlines. Persist only coarse hints, not event titles, descriptions, attendees or raw payloads. Revocation clears stored authorization; expired/revoked tokens produce disconnected state. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)

**Weather:** Google Weather API current conditions; temperature, feels-like, precipitation/condition and humidity when returned. Hong Kong coverage includes current conditions; weather alerts are not required. Unknown weather is neutral, never assumed sunny. [Weather coverage](https://developers.google.com/maps/documentation/weather/coverage)

**Places API (New):** retrieve real candidates after questioning using Nearby Search and, only if needed, Text Search for the top archetypes. Request explicit field masks. Implementation defaults: one nearby call returning up to 20 candidates; at most two targeted text searches; deduplicate by place ID, then prefilter to ≤10 for scoring. Start at 1.5 km, or 5 km when the user explicitly prefers travelling farther; these are configurable HK defaults. Expansion after no results requires an explicit user action.

Fetch rich details/photos only for the final 2–3 cards. Essential data: ID, display name, location/address, business status, known opening status, price level/rating when available, Google Maps URI and attribution. “Unavailable” must remain distinct from zero/closed. Preserve original candidate order and selected ID independently of later content refreshes. No Maps saved-place read/sync feature or scraping dependency.

### Content retention and AI inputs

Keep app-owned answers, IDs, decisions and outcomes durable. Places IDs may be stored indefinitely, while other Places content has caching restrictions and attribution requirements. Do not place raw Places responses/photos/reviews in immutable history, and do not assume adding a TTL makes storage permissible. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)

Before enabling persistent restaurant tags or sending Google-derived text to an AI provider, verify permitted use under the current applicable service terms. Google-sourced content must not become a training/fine-tuning dataset; generated tags are not automatically exempt. For baseline implementation, use app-authored archetype rules and user-provided observations; keep any permitted API-based scoring transient. If the desired enrichment is not permitted, leave it disabled and record that integration limit rather than silently swapping data providers. [Maps service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)

Every provider-sourced field carries provenance, fetched time and any applicable expiry. A content policy gate controls persistence and model input separately. Historical context fields derived from licensed APIs may expire/redact; the app-owned question/answer trail and decision metadata remain intact. Render attribution even without an embedded map. Privacy/terms pages must describe actual data use.

## 4. Preference representation and engine

Use exactly the 11 dimension IDs/polarities in the implementation spec. Each feature is `{value: number|null, confidence: number, source: 'rule'|'user'|'provider'}`; null means unknown. Candidate novelty is relative to the user's own history. Candidate distance is normalized travel burden relative to the session search radius; user `distanceTolerance` sets how strongly distance penalizes utility, not a desire to maximize distance. Price preference controls a soft expense penalty, not an invented cash budget.

```ts
type Preference = {
  state: 'unknown' | 'inferred' | 'answered' | 'neutral';
  value: number | null; // 0..1; neutral/unknown = null
  strength: number;   // explicit=1; inferred at most .25; neutral=0
};
type QuestionDefinition = {
  id: string; version: number; dimensionId?: string;
  kind: 'binary' | 'category'; prompt: string;
  options: { id: string; label: string; value?: number; categoryId?: string }[];
  contextTags: string[];
};
```

Maintain 22 versioned binary templates plus one contextual category template definition with runtime options. Binary option IDs are `left/right`; neutral is a distinct answer action. Category options map to IDs, never positions or numeric dimension values. Save the complete issued question before accepting its answer.

Seed an app-authored archetype catalog (for example ramen, rice bowl, curry, light salad, shared hotpot and casual noodles). These are broad search candidates with uncertain feature defaults, not claims about particular restaurants. Unknown features receive no evidence weight. Add the category question only when at least two surviving archetypes have different known categories.

**Deterministic fallback:** for each candidate compute the weighted mean of `1−abs(userValue−featureValue)` over known, non-neutral dimensions. Use preference strength × feature confidence as the weight. Distance instead uses `1−normalizedDistance*(1−tolerance)` and price uses `1−max(0,normalizedPrice−spendTolerance)`. If there is no known comparable evidence, set base utility .5; do not promote unknowns as a perfect match. Break ties by shorter known distance, then stable ID. Convert utility to normalized weights with softmax temperature .25; label these as heuristic weights.

**Question selection:** take the top five archetypes, normalize their weights and compute feature variance using only known values. Require at least two known values. Score = variance × context factor × uncertainty. Defaults: context factor 1; rain/distance or next timed event within 60 minutes/speed = 1.5; uncertainty unknown=1, inferred=.75, answered/neutral=0. Break ties by catalog ID. If there are no eligible dimensions, stop with `exhausted`; do not ask pointless repeats.

Use the shared stop policy (three-answer minimum for weight/margin stop, maximum six including category). Record provider confidence separately from ranking weights. Re-run ranking after each answer with at most one Laya call; templates and heuristic question selection are local computation. Late context/provider responses must not mutate an issued question or selected decision.

**Learning default:** derive bounded priors from the most recent 20 `VISITED_SELECTED` sessions using their explicit directional answers only; cap prior strength at .25. Neutral and pending/skipped/non-visit outcomes add no directional evidence. `VISITED_OTHER` updates actual visit counts but not unknown preference vectors. Recompute this small window on outcome changes, rather than applying irreversible increments. Store profile version and source session IDs; session history always retains the version used originally. Do not claim this is model training.

## 5. Firestore data model

All writes use Firebase Admin through verified server routes. Deny direct client Firestore reads/writes in MVP; fetch authorized data through APIs. Admin bypasses rules, so every repository call must bind ownership to verified UID.

- `allowedUsers/{uid}`: enabled flag, provisioned by administrator; never client editable.
- `users/{uid}`: display preferences, timezone, timestamps, Calendar connection flag, learned-prior version and bounded prior values.
- `users/{uid}/sessions/{sessionId}`: session below, including issued questions/answers and frozen result. Cap at six answers and ten shortlisted IDs; keep documents small.
- `users/{uid}/restaurantRelations/{placeId}`: app-owned selected/actual visit counts and last visit date; no raw Places content.
- `oauthConnections/{uid}`: encrypted refresh token, granted scopes, token metadata; server-only, never included in profile responses.
- `internal/layaWarmup`: lease and warm-up timestamps; no client access.
- `users/{uid}/operations/{requestId}`: idempotency response/hash and expiry; reject reuse with a different body. Default seven-day cleanup; monotonic session transitions remain safe after expiry.

Use server timestamps. API timestamps are ISO-8601 UTC strings, converted to Firestore Timestamp by the repository. Durable minimum session contract:

```ts
type DecisionSession = {
  schemaVersion: 1; id: string; uid: string; revision: number;
  status: 'QUESTIONING' | 'RECOMMENDING' | 'READY' | 'SELECTED' | 'ABANDONED';
  createdAt: string; updatedAt: string; selectedAt: string | null;
  launchId: string; selectionLaunchId: string | null;
  catalogVersion: string; engineVersion: string; priorVersion: string;
  context: {
    capturedAt: string; timezone: 'Asia/Hong_Kong';
    meal: 'lunch' | 'dinner' | 'other'; area: string;
    locationSource: 'gps' | 'manual';
    weather: { condition: string; temperatureC: number | null } | null;
    calendar: { nextEventSoon: boolean; socialHint: boolean | null } | null;
    availability: Record<string, 'available' | 'denied' | 'failed' | 'absent'>;
    // Provider-sourced context includes provenance/retention metadata.
  };
  preferences: Record<string, Preference>;
  questions: { instanceId: string; definition: QuestionDefinition; issuedAt: string }[];
  answers: {
    questionInstanceId: string; action: 'left' | 'right' | 'neutral' | 'category';
    optionId: string | null; value: number | null;
    answeredAt: string; requestId: string;
  }[];
  decision: {
    stopReason: 'weight_margin' | 'max_questions' | 'exhausted' | 'user_requested' | null;
    provider: 'laya' | 'heuristic'; modelRevision: string | null;
    confidence: number | null; confidenceKind: 'provider_uncalibrated' | 'none';
    candidates: { placeId: string; score: number; weight: number }[];
    recommendedPlaceId: string | null; selectedPlaceId: string | null;
    reason: string | null; fallbackReason: string | null;
  };
  outcome: {
    status: 'PENDING' | 'VISITED_SELECTED' | 'VISITED_OTHER' | 'DID_NOT_EAT_OUT';
    actualPlaceId: string | null; confirmedAt: string | null; revision: number;
    eligibleAfter: string | null; snoozedUntil: string | null;
    lastPromptLaunchId: string | null;
  };
};
```

Nonselected sessions' `PENDING` outcome is ineligible (`eligibleAfter=null`). `VISITED_SELECTED` requires actual ID=selected ID; `VISITED_OTHER` allows null but never the selected ID; `DID_NOT_EAT_OUT` requires null. Validate these invariants and all numeric ranges on the server.

Transitions: QUESTIONING → RECOMMENDING → READY → SELECTED; any unfinished state → ABANDONED. Search failures remain RECOMMENDING with a retriable error. Only issued, unanswered questions may accept answers. Selection freezes context/questions/answers/decision. Only outcome and derived relations may change afterward. No automatic selected→visited transition.

Use optimistic concurrency (`expectedRevision`) plus Firestore transactions for writes. Never call an external API inside a transaction: read version, compute outside, then commit if unchanged. A stale computation is discarded; duplicate operation returns the stored response. Select accepts only a current shortlist ID. Recommending jobs use a short lease so a timed-out client can retry; no durable queue is needed for ordinary requests.

Indexes: session history by selectedAt descending; pending selection by status + outcome.status + outcome.eligibleAfter; exclude large question/answer maps from indexing. Define indexes in version control. Paginate history at 20 records; avoid whole-history listeners.

## 6. HTTP API contracts

Every user route derives UID from verified Firebase bearer ID token and checks allowlist. Never trust a submitted UID. Validate Origin on browser mutations; OAuth uses a separate secure, short-lived HttpOnly state cookie. Return `{data, revision?, requestId}` or `{error:{code,message,retryable},requestId}`. Mutation requests carry `requestId` and session mutations carry `expectedRevision`.

- `POST /api/app/open {launchId}` → profile, at most one eligible outcome prompt and warm-up status. Applies four-hour and 24-hour snooze rules; warm-up is independently bounded.
- `POST /api/decision/sessions {launchId,location|area}` → saved context, session ID and first issued question. Missing location/area is a validation error.
- `GET /api/decision/sessions/:id` → authorized current state, issued question/result and safe errors; supports refresh recovery.
- `POST /api/decision/sessions/:id/answers {questionInstanceId,action,optionId?}` → persisted answer and next question or recommendation-ready transition. Client cannot submit values or fabricated wording.
- `POST /api/decision/sessions/:id/recommend {reason:'automatic'|'user_requested',expandArea?:boolean}` → persisted shortlist. Server validates stop eligibility/explicit expansion and deduplicates retries.
- `POST /api/decision/sessions/:id/select {placeId,launchId}` → frozen selection and pending outcome with eligibleAfter=selectedAt+4h.
- `POST /api/decision/sessions/:id/outcome {status?,actualPlaceId?,snooze?:true,launchId}` → outcome revision and recomputed personal priors. Enforce age eligibility, and that confirming launch differs from selection launch, including History confirmation.
- `GET /api/history?cursor=...` → selected-session page; `GET /api/restaurants/:placeId` → current display data and attribution.
- `POST /api/restaurants/search {query}` → bounded lookup only for actual-other confirmation; rate-limited, minimum two characters, debounced 400 ms in UI.
- `GET /api/calendar/connect` → OAuth redirect; `GET /api/calendar/callback` → state/code validation and server token exchange; `DELETE /api/calendar/connection` → revoke/delete tokens.
- `POST /api/laya/warmup` → authenticated, rate-limited readiness hint; shared by app-open flow. Scheduled function uses shared server code, not this public URL.

Use 401 for unauthenticated, 403 for disallowed, 404 for inaccessible/missing session, 409 for stale revision/invalid state, 422 for bad input, 429 for limits, and 503 for unavailable required Places operations. Optional-provider failures return successful degraded behavior with recorded metadata. Rate-limit by UID and provider budget, not solely by in-memory counters.

## 7. Security and privacy

- Keep HF token, Maps/Weather server keys and OAuth client secret in Secret Manager, referenced from `apphosting.yaml`/function configuration. Use least-privilege runtime service accounts and application default credentials for Firestore/Gemini; no downloaded service-account key in the repository.
- Firebase browser configuration is public configuration, not an Admin credential. Never place server secrets in `NEXT_PUBLIC_*`.
- Encrypt OAuth refresh tokens with Cloud KMS before storing them; restrict decrypt permission to the web runtime. Access tokens stay transient. Validate OAuth state, redirect allowlist and account binding; handle token refresh errors without looping.
- Restrict Google API keys to required APIs and apply supported application restrictions. Serverless egress is not automatically fixed-IP; do not configure a fictitious IP allowlist or add a NAT gateway just for MVP.
- No raw Calendar events, coordinates, OAuth codes/tokens, model payloads or secrets in logs. Treat provider text as untrusted data, never tool instructions. Model outputs cannot execute tools, change scopes, choose arbitrary URLs or bypass eligibility filters.
- Use no-store/private caching on authenticated API responses. Do not cache them in a service worker. Provide disconnect, session deletion and account-data deletion; removal also recomputes priors/relations. Keep minimal technical logs on a 30-day retention default.

## 8. Performance, cache and failure budgets

All values here are initial engineering budgets, not provider SLAs. Measure on a real Hong Kong mobile connection.

- Swipe feedback target <100 ms locally; question API p95 target ≤2.5s including heuristic fallback. Do not await optional Gemini prose before showing the next card.
- First question target ≤3s after usable location/area; context retrieval is parallel and uses bounded deadlines. Freeze context at session creation; late Calendar/Weather results do not rewrite the trail.
- Restaurant retrieval/ranking target ≤8s total; progress text and a retry state at a 10s hard request budget. Apply a shared deadline across retries rather than stacking full per-provider timeouts.
- Default Calendar request budget 2s, Weather 2s, Places search 5s, Laya rank 2s, Gemini 4s. Run independent work concurrently where applicable.
- Cache static catalog and app-authored rules freely. Profile/context hints may use a user-scoped five-minute cache; purge on disconnect/deletion. Cache Weather at a coarse location for ten minutes only if allowed by current terms. Places defaults to request-lifetime reuse; persistent fields require an explicit allowed retention policy.
- Collapse identical in-flight requests. Fetch only needed fields; avoid reviews/photos for every candidate. Each answer causes at most one inference and one authoritative session mutation.
- Firestore/selection failure: fail visibly and retry idempotently. Calendar/Weather/Gemini failure: missing hints or templates. Laya cold/invalid: heuristics. Places failure: no fabricated substitute. Cached external details are served only within permitted expiry and labeled with freshness.

Cost controls: max one HF replica; App Hosting initial min instances 0/max 2; one scheduled function instance at a time; explicit provider quotas and per-user request caps; billing alerts at owner-configured thresholds. Budgets alert rather than guarantee a hard spending cap. Measure HF initializing/running time, Gemini tokens, Places field/SKU calls, Firestore operations and cross-region traffic. Never assume the entire Firebase stack is free or that doubling inference calls is latency-free because HF bills by time.

## 9. Deployment and verification

1. Create separate development and production Firebase projects, enable billing where required, and explicitly provision Firestore `asia-east2` before application data exists.
2. Create App Hosting backend `asia-east1`, connect the repository and configure supported Next.js/Node versions, resource limits and nonsecret environment variables.
3. Enable required APIs, Auth Google provider/authorized domains, allowlisted UID, Secret Manager/KMS access and Firestore rules/indexes. Configure OAuth consent/test users and exact callback URLs; document testing-mode token limitations and any production consent requirements.
4. Set `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL`, `LAYA_BASE_URL`, pinned model revision, feature flags and timeout budgets. Supply secrets by reference only. Perform a real Gemini model/location call and HF contract test.
5. Deploy the protected HF endpoint with the recorded serving recipe and scale settings. Add the scheduled function and verify timezone, duplicate safety, manual warm-up and idle scale-down.
6. Run typecheck/build, domain and state-transition tests, authorization/rules tests in emulators, adapter contract tests with synthetic fixtures, and browser flow tests. CI must not spend against paid APIs by default; run separately configured live smoke tests before release.
7. Deploy the web app; verify login, denied permissions, real Places selection, Maps link, history, later outcome and Laya-down behavior from Hong Kong. Keep the previous rollout available; schema changes must be additive/versioned and preserve history.

Critical test cases: reversed speed/healthiness polarity; neutral vs unknown; six-question termination; malformed Laya IDs/NaN scores; category answers; concurrent answer/select retries; selection never implies visit; four-hour/new-launch eligibility; snooze; outcome correction; inaccessible other-user sessions; expired provider content; revoked Calendar token; warm-up lock expiry.

Structured logs: request/session IDs, route duration, provider/model revision, timeout/error category, fallback, question count, stop reason, API field-mask category and token/count estimates. Use pseudonymous user references. Exclude raw inputs. Track p50/p95 decision latency, fallback rate, Places failures, confirmed outcomes, HF warm-up success/latency and estimated spend. Alert on repeated auth/configuration failures, repeated scheduled warm-up failures or sustained required-provider outages; do not alert for every expected scale-to-zero fallback.

MVP release requires real external smoke tests, not only fixture success. Unverified account access, recipe routes, regional availability or content-use permissions are explicit deployment checks; they do not justify redesigning the product or claiming an integration is complete.


## Owner-approved restaurant-ranking update — 25 September 2026

The accepted larger-pool flow supersedes the earlier restaurant-only candidate/result and call-count limits: up to 50 unique in-radius candidates from popular nearby and bounded food/cuisine searches, at most six Laya tournament passes of ten or fewer candidates, and up to ten displayed recommendations. Weights from different batches are never compared. Any failed pass uses deterministic ranking over the whole pool. Restaurant ranking has a 20-second budget within 25-second retrieval/ranking; question inference and three-to-six adaptive answers are unchanged. See [TOP_TEN_RANKING.md](docs/TOP_TEN_RANKING.md) for defaults, cost, approximation limits and verification.


## Owner-approved update — 25 September 2026: compact UI and dining intent

New decisions ask 正餐 (left) / 小食 (right) before radius selection. Up remains neutral (都得). This explicit pre-search choice is persisted as optional `context.diningIntent` (`meal`, `snack`, `any`), separate from the eleven adaptive dimensions and six-question limit. Older sessions omit it and retain existing retrieval. New explicit meal/snack choices scope all seven Text Search calls: meal queries include 正餐; snack queries cover 小食/港式小食/街頭小食/甜品/麵包糕點/日式小食/台式小食. This is retrieval relevance, not proof of menu contents. Radius validation and bounded 50-candidate/10-result ranking remain.

Header becomes ec2eat | 今日，食咩好. Home/result large headings, results reason/area, reload and restart buttons are removed as requested; home remains reachable through the brand link. History hides raw IDs, offers 確認到訪 for pending outcomes, and retains correction access. Four-hour/next-opening eligibility is unchanged. Flipping history loads current restaurant names in original saved order through an authenticated owner-scoped route, without photos or persistence. Missing names are labelled unavailable rather than replaced by IDs. Front history still fetches only the selected restaurant.
