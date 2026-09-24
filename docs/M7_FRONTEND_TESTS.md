# M7 frontend acceptance — user-run

The backend is verified automatically. Browser/device checks below are intentionally left to you. Open http://localhost:3000/history and sign in with the approved emulator account. The preview keeps M6's explicit `PLACES_FIXTURE=results` mode; displayed restaurants are synthetic, never live claims.

## Prepare a few saved decisions

In /decide, complete or stop questioning, then explicitly press “揀呢間”. Create at least two selections, including the same synthetic restaurant twice. For one decision answer up/neutral; for another use “睇選擇” before answering the current question. A saved-selection screen now links directly to History. If no selections exist, History should show an honest empty state.

## Scenarios and expected results

1. **Selected decisions only.** Open History after leaving another decision unfinished. Expect the selected decisions newest first, with repeated choices shown as separate cards. The unfinished decision must not appear.
2. **Front of card.** Expect the selected restaurant ID, selection date/time in Hong Kong time, meal and saved area. M6 selections show “未確認到訪”; they must not be labeled as confirmed meals or visits.
3. **Current details.** Scroll a card into view. Expect its selected restaurant's current details to load, with “目前餐廳資料” and a refresh time. Synthetic content is visibly labeled. Missing photos, price, rating or opening status stay unknown. Original recommendation alternatives are not fetched as history display cards.
4. **Flip and restore.** Click “睇返點揀”. Expect exact saved question wording and option labels in original order, the chosen answer, explicit up/neutral answers, and “未回答（已停止提問）” for an issued question left unanswered by manual stop. Click “返餐廳資料” to restore the front.
5. **Original decision evidence.** The back shows original context summary, shortlist IDs/order, which was recommended and selected, ranking method/revision, fallback, stop reason and confidence type. Weights/confidence are explicitly not enjoyment probabilities.
6. **No mutation from navigation.** Flip repeatedly, refresh current details and leave/reopen History. The answer trail, original order, selected place, date and pending outcome stay unchanged. Flipping itself must not send answers or select/visit requests. Account mounting may independently make the existing app-open warm-up request.
7. **Unavailable Places.** Stop the preview app and restart with `PLACES_FIXTURE=details-failure npm run dev:emulator`, or with no fixture for the unconfigured state. Reload History. Saved cards and flip controls remain usable despite missing current details. Restart results mode and press “重新載入目前資料” to recover. Do not clear the database.
8. **Current closure versus past selection.** Restart in `PLACES_FIXTURE=closed npm run dev:emulator`. The current details may report closure, but the saved selection, original trail and outcome stay intact.
9. **Pagination.** If the account has more than 20 selections, expect the first 20 and “載入更多選擇”. Loading more appends older records without duplicates. The last page shows the end message. New decisions added from another tab appear after “重新載入最新記錄”. The 25-record, equal-time and nanosecond-boundary cases are already covered by isolated backend fixtures; none were inserted into your preview history.
10. **Network failure and retry.** Go offline before first load or “載入更多選擇”. Expect a retryable error; already loaded cards stay visible. Return online and retry without duplicated records. A stale/deleted cursor directs recovery to the latest page.
11. **Account isolation.** Sign out: cards disappear. Sign in as an unapproved account: history stays inaccessible. Switching approved accounts must never retain the previous account's cards.
12. **Keyboard and phone.** Tab to the explicit flip button and use Enter/Space. Focus remains on the toggle; the hidden face has no focusable controls. At phone width, long place IDs wrap and the full trail remains scrollable without horizontal overflow. With reduced motion enabled, flipping has no animation.
13. **Expired context.** Where a saved licensed context field has reached its allowed expiry, its value is absent with an honest unknown/expiry explanation; the saved question wording/answers remain. Backend tests cover this projection without altering the source snapshot.
14. **Outcome labels.** M7 reads all four existing outcome statuses distinctly. Normal M6-created records are PENDING. The UI does not offer confirmation/correction buttons yet: those are M8, not a missing M7 save action.

## Live-only gates

Current Google names/photos/status/attribution and the deployed history index still need real-project checks after credentials, permissions and deployment are configured. No live restaurant data or provider credentials were invented, and synthetic tests do not satisfy those gates.
