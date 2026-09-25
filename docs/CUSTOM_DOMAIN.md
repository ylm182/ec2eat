# ec2eat.fun activation — 25 September 2026

Canonical application origin: https://ec2eat.fun. HTTPS home, /privacy and /terms
returned 200 before migration. Firebase App Hosting remains asia-east1 Taiwan;
Firestore remains asia-east2 Hong Kong. DNS/certificate records remain unchanged.

Configured and verified:
- Firebase Authentication authorizedDomains includes ec2eat.fun, preserving all
  previous domains and the existing UID allowlist.
- Google Maps browser key allows https://ec2eat.fun/* and the old hosted origin;
  API restriction remains maps-backend.googleapis.com. No new key or secret.
- Calendar OAuth client ending c8nec856 has redirect URI
  https://ec2eat.fun/api/calendar/callback in addition to its previous callback.
- OAuth branding home/privacy/terms URLs use ec2eat.fun; authorized domains includes
  ec2eat.fun. Console confirmed both OAuth client and branding saves.
- apphosting.yaml APP_ORIGIN becomes https://ec2eat.fun so strict mutation-origin
  validation and Calendar authorization/token exchange use the new origin.
- Middleware reads App Hosting X-Forwarded-Host (falling back to Host). Requests
  to the exact former hosted.app hostname redirect permanently (308) to
  the same path/query on ec2eat.fun. Localhost and other hosts are not redirected.

NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN remains ec2eat-davidyu-prod.firebaseapp.com.
The app uses signInWithPopup, retaining Firebase's existing auth helper endpoint;
do not simply replace authDomain with the App Hosting domain without configuring
an auth helper/proxy. Firebase's authorized-domain addition permits the new app
origin. Existing OAuth scopes and stored Calendar tokens are unchanged.

Users may need to sign in again because Firebase browser persistence is per-origin.
No account migration is necessary: the same Google account resolves to the same UID.
An OAuth flow started on the old domain during migration should be restarted on the
new domain. Google notes OAuth setting propagation can take minutes to hours.

Google console still reports branding requires verification. This existing review
status is separate from domain routing and was not falsely marked verified. No new
scopes, public sharing, or verification application was submitted.

Owner acceptance: sign in at ec2eat.fun; start a decision (no INVALID_ORIGIN);
open the map (no referrer error); connect Calendar and return to ec2eat.fun/decide;
check previous history under the same account. The agent does not disconnect an
existing Calendar or grant consent on the user's behalf just to test migration.

References:
- https://firebase.google.com/docs/app-hosting/custom-domain
- https://firebase.google.com/docs/auth/web/redirect-best-practices

The first deployment used Next config Host matching, which live verification
found ineffective behind App Hosting. Replaced with tested forwarded-host
middleware; redirect responses are private/no-store.
Source: https://firebase.blog/posts/2024/07/app-hosting-updates/
