# ec2eat

Private Hong Kong restaurant decision app. Behavior is governed by [EC2EAT_IMPLEMENTATION_SPEC.md](EC2EAT_IMPLEMENTATION_SPEC.md); technical contracts by [EC2EAT_ARCHITECTURE.md](EC2EAT_ARCHITECTURE.md).

**Current scope: M1 foundation.** Home/history/privacy shells, Firebase Google sign-in, server allowlist, isolated read repositories, runtime domain schemas, provider interfaces, emulator rules/indexes and verification. The decision button is explicitly unavailable until M2/M3. No restaurants, visits or AI responses are represented as live data. No cloud resources have been created.

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

CI performs these checks with Java 21 and no paid API credentials. Unit tests use explicit dependency injection; emulator tests use actual Auth/Firestore emulators, Firebase token verification and deny-all client rules. Full external integration and mobile swipe tests belong to later milestones.

## Structure

- `app/`, `components/`: mobile-first Traditional Chinese shell and Google login UI.
- `lib/domain/`: versioned session, question, preference, answer and outcome validation; transition guard.
- `lib/server/`: verified Google identity + enabled UID allowlist, origin/body validation, private API envelopes, UTC/Firestore conversion and UID-scoped repository.
- `lib/providers/`: asynchronous abortable provider contracts, fixed-wording fallback and explicit unavailable Places adapter. Laya scoring and Gemini/Google live adapters are not implemented yet.
- `tests/`: synthetic fixtures, authorization/domain tests and emulator acceptance tests.
- `firestore.rules`, `firestore.indexes.json`: client denial, history/pending indexes and seven-day operation cleanup field (expiry is set by later write orchestration).

## Configuration and release gates

Read [implementation status](docs/IMPLEMENTATION_STATUS.md) for the consistency review, plan, defaults, measured checks and remaining gates. Read [deployment setup](docs/SETUP.md) before configuring a real project. App Hosting remains `asia-east1` (Taiwan); Firestore remains `asia-east2` (Hong Kong). Setting a region in documentation does not provision it.
