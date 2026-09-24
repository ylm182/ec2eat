# Setup and deployment boundaries

## Local development

`npm run dev:emulator` loads `.env.example` into only the development process. Start `npm run emulators`, then `npm run seed:emulator` first. Java 21 is required for Firestore. Node 22 is required for the app. `npm run test:emulator` starts/stops isolated emulators and refuses to run without both emulator hosts. It clears only `demo-ec2eat` Firestore test data; do not run it alongside a manual session you wish to preserve.

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
5. Indexes: selected history (`status`, `selectedAt DESC`), pending prompts (`status`, `outcome.status`, `outcome.eligibleAfter ASC`); large question/answer arrays excluded. `operations.expiresAt` is a TTL field; future mutations set it to seven days. Single-field `selectedAt` indexing remains enabled. History pagination is 20 records when M7 is implemented.
6. Grant runtime least-privilege Firestore/Auth access using its service account and ADC. Add Vertex/Secret Manager/KMS permissions only for enabled adapters. Configure exact APP_ORIGIN and public Firebase config; leave all emulator variables absent.
7. M4: separate read-only Calendar consent; encrypted refresh tokens; bounded optional contexts. M5: protected HF recipe smoke fixture, scale 0–1, requested 60-minute inactivity timeout and shared warm-up lease. Schedule runs at 11:00/17:00 Asia/Hong_Kong in Taiwan. These are requirements, not deployed resources in M1.
8. M6+: confirm current Google content terms; use request-lifetime Places content by default, retain durable place IDs/app-owned trails, show attribution. No persistent enrichment or model input without its separate permission gate.
9. Before release: resolve/review dependency audit findings, run real provider smoke checks and Hong Kong device flow, configure quotas/billing alerts/30-day technical log retention, complete deletion/disconnect and privacy/terms details. Never deploy paid resources implicitly.

## Data boundaries for subsequent milestones

Profile reads are read-only in M1. Authoritative mutations must use Firestore transactions, server timestamps, expected revisions, UID-scoped operation records/body hashes, and the same request ID on retries. External provider calls run outside transactions. Repository conversion preserves nested UTC timestamps. Session selected snapshots are frozen; outcome corrections remain separate and recompute priors. Do not expose a generic client document write API.
