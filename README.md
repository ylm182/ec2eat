# ec2eat

Private Hong Kong restaurant decision app. Behavior is governed by [EC2EAT_IMPLEMENTATION_SPEC.md](EC2EAT_IMPLEMENTATION_SPEC.md); technical contracts by [EC2EAT_ARCHITECTURE.md](EC2EAT_ARCHITECTURE.md).

**Current scope: M1–M4 implemented locally, M5 fallback/warm-up infrastructure verified; live integrations remain gated.** `/decide` provides an authenticated, persisted adaptive flow with all 22 binary templates, deterministic ranking, neutral answers, an occasional category grid and a six-question cap. Refresh resumes the saved session. M4 adds explicit GPS/manual context, independently bounded Weather/Calendar adapters, read-only Calendar OAuth with KMS token storage and validated Gemini extraction with deterministic fallback. Unconfigured services stay absent; optional emulator fixtures are clearly labeled. The separate `/demo` remains a synthetic swipe/retry preview. Restaurant search is explicitly unavailable until M6; no restaurants, visits or AI responses are represented as live data. No cloud resources have been created.

## Local setup

Use Node 22 and Java 21 (Firestore emulator). Dependencies and transitive versions are recorded in `package-lock.json`.

```sh
npm ci
npm run emulators
```

In another terminal:

```sh
npm run seed:emulator
npm run dev:emulator
```

Open `http://localhost:3000`. The emulator Google popup can use `owner@example.test` (approved) or `denied@example.test` (not approved). These are synthetic local accounts, not credentials. The seed command only targets `demo-ec2eat` and loopback emulator hosts. It never provisions a live account. Emulator state is ephemeral; reseed after restarting. Auth's Google simulation does not verify production Google OAuth configuration.

`npm run dev` without configuration shows the honest setup state. `.env.example` is the complete credential-free local example; `dev:emulator` loads it only for that process. Do not copy its emulator values into a production build. No live-mode authentication bypass or hardcoded bearer token exists.

## Checks

```sh
npm run typecheck
npm test
npm run test:emulator
HF_TOKEN=EC2EAT_SECRET_CANARY_7f21 OAUTH_CLIENT_SECRET=EC2EAT_SECRET_CANARY_7f21 npm run build
npm run check:client
```

The last build uses a synthetic secret marker to check that server environment values do not appear in `.next/static`. All privileged server modules import `server-only`. This is a focused boundary check, not a promise to detect every conceivable secret.

CI performs these checks with Java 21 and no paid API credentials. Unit tests use explicit dependency injection; emulator tests use actual Auth/Firestore emulators, Firebase token verification and deny-all client rules. M2 adds real-library component tests (mouse/touch gestures, buttons, keys, duplicate protection, retry, cancellation and reduced motion). Mobile-width browser verification is recorded in the status notes. Real-device touch testing and full external integration remain release checks.

## Structure

- `app/`, `components/`: mobile-first Traditional Chinese shell, Google login UI, `DecisionSwipeCard` and fixture demo.
- `lib/fixtures/`: synthetic questions and an in-memory idempotent demo transport; no production authentication or data access.
- `lib/domain/`: versioned schemas, 22-template catalog, uncertain meal archetypes, deterministic scoring, adaptive question selection and transition guard.
- `lib/server/`: verified Google identity + enabled UID allowlist, origin/body validation, private API envelopes, UTC/Firestore conversion and UID-scoped transactional session writes with idempotent retries.
- `lib/providers/`: asynchronous abortable provider contracts, fixed-wording fallback and explicit unavailable Places adapter. Gemini/Weather/Calendar adapters require configured live smoke tests. `lib/laya/` contains the contract-gated HF adapter, deterministic fallback and shared warm-up/circuit modules; the real HF recipe fixture is still missing.
- `tests/`: synthetic fixtures, authorization/domain tests and emulator acceptance tests.
- `firestore.rules`, `firestore.indexes.json`: client denial, history/pending indexes and seven-day operation expiry and response index exclusion.

## Configuration and release gates

Read [implementation status](docs/IMPLEMENTATION_STATUS.md) for the consistency review, plan, defaults, measured checks and remaining gates. Read [deployment setup](docs/SETUP.md) before configuring a real project. App Hosting remains `asia-east1` (Taiwan); Firestore remains `asia-east2` (Hong Kong). Setting a region in documentation does not provision it.

For manual frontend acceptance, use [M4 frontend test scenarios](docs/M4_FRONTEND_TESTS.md). Browser testing is assigned to the user; automated backend checks do not replace it.

M5 adds a shared circuit/lease and the built (not deployed) Taiwan scheduled worker. See [M5 frontend checks](docs/M5_FRONTEND_TESTS.md) and [live HF contract gate](tests/fixtures/laya/README.md).
