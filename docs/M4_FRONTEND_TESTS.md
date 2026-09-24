# M4 frontend acceptance — for you to run

Status: not yet run by the user. Backend tests are separate; this checklist does not imply a browser pass.

## Start here

Open http://localhost:3000/decide in your preferred browser. Local Auth and Firestore emulators and the dev server must be running. Sign in through the simulated Google popup using `owner@example.test`; this is a synthetic account, not a real Google credential. Allow the popup if your browser blocks it. `denied@example.test` should remain denied. Do not enter a real Google password into the emulator.

The standard local mode has no live Weather, Calendar or Gemini calls. Start a fresh decision for each context test. If an old decision is restored, choose “睇選擇”, then “開始另一次選擇”. Tests stop at the honest restaurant-unavailable state; M6 will add restaurant results.

Record each scenario as **Pass / Fail / Blocked**, plus browser/device and the exact unexpected result. Screenshots are optional. Please test desktop and your usual mobile browser where practical.

## Available in the default local mode

1. **No automatic location prompt.** Open/reload the page and sign in. Expected: no geolocation permission request until you press “使用目前位置”; manual area is initially empty for a new decision.
2. **Manual area without optional services.** Ignore location and Calendar, choose a district and press “幫我揀”. Expected: the first question appears; the summary shows your chosen manual district, unknown weather and no Calendar hints. Calendar not configured does not block you.
3. **Location denied.** Press “使用目前位置” and deny permission. Expected: a clear manual-area fallback; select a district and proceed successfully.
4. **Location allowed.** With a Hong Kong location, allow permission. Expected: an approximate nearby district is shown; starting the decision labels it “定位地區”. The district is approximate, not an exact address. Outside the supported bounding box, or with unavailable GPS, expect manual fallback without silently choosing Central.
5. **Manual override after GPS.** After successful location, explicitly choose a different district. Expected: the new decision uses that district and labels it “手動地區”.
6. **Slow/unavailable location.** Disable OS location or let the request time out. Expected: within roughly eight seconds, a fallback message and usable manual selection. Calendar/Weather availability has no effect on this fallback.
7. **Answer meanings remain intact.** Use left, right and up across fresh decisions. Expected: left/right select their displayed labels, up means “都可以”, down does nothing; buttons and keyboard match. No dimension repeats, no more than six answers, and a category grid—if shown—uses buttons rather than swipes.
8. **Refresh during questions.** Answer one or two questions, then refresh. Expected: the same next question resumes with the original context; no extra answer or new session is created.
9. **Rapid clicks and save recovery.** Tap a choice repeatedly, or briefly disconnect the network while saving. Expected: only one accepted answer. Restore the connection and Retry; the original answer is retained and advances once.
10. **Refresh during GPS session creation.** Start with GPS, then reload while “準備今次選擇…” is displayed. Expected: recover the already-saved session by request ID. If it has not saved yet, the recovery button can retry; no precise coordinates are persisted locally. “放棄恢復，重新開始” explicitly abandons that recovery and starts a separate decision.
11. **Stop without restaurants.** Press “睇選擇” or finish the questions. Expected: answers saved, the ordered trail shown, and an explicit message that restaurant search is not connected. No fabricated restaurant, selection or visit.
12. **Account isolation.** Sign out and use the unapproved synthetic account. Expected: no prior user's decision is shown and decision controls remain unavailable.

## Synthetic context scenarios

These require restarting only the dev server with one of the commands below. Keep the emulators running. If you prefer, ask me to switch the fixture for you. Use a new decision after every switch.

- **Rain + timed event:** `CONTEXT_FIXTURE=rain-busy npm run dev:emulator`
  Expected: a clear synthetic-data label, weather and Calendar available, and a message that a timed event is within an hour. Questions still honor your actual answers. The fixture's event area must not replace the district you chose.
- **All-day event:** `CONTEXT_FIXTURE=all-day npm run dev:emulator`
  Expected: synthetic label and Calendar context, but the summary explicitly says there is no timed-event hint within an hour. An all-day event must not create urgency.
- **Independent failures:** `CONTEXT_FIXTURE=failures npm run dev:emulator`
  Expected: synthetic label, unknown weather and no usable Calendar hints, while questions and saving still work.
- **Return to default:** `npm run dev:emulator`
  Expected: new decisions have no synthetic context label and optional integrations are absent. Previously saved decisions retain their original labels/context.

Backend tests cover independent single-provider failure, malformed Gemini responses and explicit/neutral precedence; no UI control is added just to force a specific dimension or model answer.

## After real integrations are configured — currently blocked

1. **Separate Calendar consent:** “連接唯讀 Calendar” opens Google consent for read-only events. Decline it; expected: return safely to ec2eat and continue without Calendar.
2. **Successful Calendar consent:** accept using an intended test account. Expected: connected status and “斷開 Calendar”; no event titles, descriptions or attendee lists displayed or stored in sessions.
3. **Disconnect:** disconnect, then start a new decision. Expected: no Calendar hints. If Google revocation fails, the app explains that local access stopped and offers guidance to remove the grant in Google account settings.
4. **Revoked/expired grant:** revoke Calendar access in Google, then start a decision. Expected: the app continues without Calendar and clears the connection state when revocation is detected.
5. **Weather failure:** use a deliberately unavailable test configuration. Expected: weather becomes unknown, while Calendar and decisions still work. Successful live weather must show its attribution.
6. **Gemini failure/unavailable model:** use the configured live test environment with Gemini unavailable. Expected: deterministic extraction and fixed question wording; no stronger-model substitution, blocked flow or invented claims.
7. **OAuth callback replay/expired consent:** revisit an old callback or finish after state expiry. Expected: a safe failed-connection message; no new grant from the stale callback.

Real tests require configured OAuth client/consent, KMS permissions, Weather entitlement and approved retention/attribution, plus Vertex model/location access. Local fixtures cannot validate those. Taiwan App Hosting and Hong Kong Firestore are unchanged; no deployment is part of this checklist.
