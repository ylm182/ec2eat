# M5 frontend acceptance — for you to run

Status: user testing pending. Automated provider/store tests passed separately. Use http://localhost:3000/decide with the synthetic approved owner account. If the emulator was reseeded and your old login is denied, sign out and sign in again using `owner@example.test`. Earlier test runs reset synthetic preview data; if an old decision is missing, start a new one. Future automated runs use separate emulator ports.

## Available now, without HF credentials

1. **Sign in/open Home or Decide.** Expected: no blocking “waiting for AI” screen. Warm-up runs separately; manual location and questions remain usable.
2. **Complete a decision with HF unconfigured.** Expected: normal adaptive questions and saved answers, ending with the existing restaurant-unavailable message. No false claim that Laya is ready, and no fabricated restaurant or selection.
3. **Reload during questions.** Expected: the saved question/answers resume; warm-up does not reset the decision or add an answer.
4. **Rapid answers/retry after a brief network interruption.** Expected: only one answer is saved per question, and Retry retains the original answer. No duplicated question or extra progress step.
5. **Open a second tab or revisit the page.** Expected: both remain usable; warm-up never blocks either. Once a real endpoint is configured, the backend lease suppresses duplicate app-open warm-ups for ten minutes.
6. **Switch tabs briefly.** Expected: no new decision or question reset. Returning after at least 30 minutes hidden can request a new background warm-up; short tab switches do not.
7. **Sign out and use an unapproved account.** Expected: no access to your session or authenticated warm-up action.

In the browser Network panel, an optional technical check is POST `/api/app-open`: default emulator mode returns `{status:"unavailable",reason:"laya_emulator"}` in the data envelope. This is expected. No HF credential or raw context is returned. There is intentionally no UI toggle that pretends the mock is live Laya.

## Blocked until a real HF recipe is verified and configured

- **Endpoint cold/warming or returning 503:** answers still save using deterministic scoring within the bounded provider budget. Overall response also includes ordinary authentication/database latency.
- **Endpoint ready:** new answers can use Laya; already issued questions and historical answers stay unchanged. Scores are not represented as calibrated enjoyment probabilities.
- **Malformed output/invalid credentials:** deterministic fallback; no broken question screen. Permanent errors are not retried.
- **Circuit cooldown:** after three failed logical ranking calls, subsequent requests bypass Laya for 60 seconds; questions continue with heuristics.
- **App-open duplicate warm-up:** multiple tabs result in one shared lease holder, with ten-minute suppression.

The 11:00/17:00 HKT scheduled runs are backend/deployment checks, not something to simulate by changing your browser clock. Their code builds for Taiwan, but no function or HF endpoint has been deployed. See `tests/fixtures/laya/README.md` for the precise live gate.

Report Pass / Fail / Blocked, browser/device, scenario number and what happened. No frontend/browser pass is claimed by the implementation agent.
