# M6 frontend acceptance — user-run

Backend checks are automated; browser/device acceptance below is intentionally left to you. Use the approved emulator Google account from the earlier milestones. None of these local modes query live Google Places or HF.

## Local setup

Keep the normal Auth/Firestore preview emulators running. Start the app at http://localhost:3000 with one of these commands (stop the previous app process before changing modes):

- Normal unavailable mode: `npm run dev:emulator`
- Three **clearly synthetic** cards: `PLACES_FIXTURE=results npm run dev:emulator`
- Empty search: `PLACES_FIXTURE=empty npm run dev:emulator`
- Provider failure: `PLACES_FIXTURE=failure npm run dev:emulator`
- All returned places closed: `PLACES_FIXTURE=closed npm run dev:emulator`
- Search succeeds but details fail: `PLACES_FIXTURE=details-failure npm run dev:emulator`

The M6 handoff preview uses **results**. This is an explicit process setting; the committed environment still defaults to unavailable. “開始另一次選擇” starts fresh. Do not clear the preview database to switch fixtures.

## Scenarios and expected results

1. **Automatic result flow.** In results mode, pick a district and answer until the engine stops (at most six). Expect three cards marked “合成測試資料”, the recommendation first, and explicit “揀呢間” buttons. No selection or Maps action appears automatically.
2. **Manual stop.** Start another decision and press “睇選擇” after one answer. Expect cards and the original question/answer trail, with no further questions.
3. **Facts and unknowns.** Synthetic cards have honest photo/price/rating placeholders; the third has unknown opening hours and asks you to confirm before travelling. No made-up queue, menu or walking-time claims.
4. **Choose an alternative.** Choose the second/third card. Expect saved selection on that card, a pending-visit explanation, and unchanged original ranking/trail. Synthetic IDs never produce real Maps links.
5. **Double tap and reload.** Rapidly tap the same choice, then reload. Expect one saved selection, no duplicate visit, and the same choice/trail. The pending outcome stays unconfirmed.
6. **Interrupted save.** In browser network tools, switch offline before choosing. Expect an error and no saved-success/Maps state. Return online and retry the same choice. Expect one saved result. If the save reached the server but its response was lost, reloading restores it.
7. **Empty and expansion.** In empty mode, start fresh. Expect no fabricated cards, a retry button, and an explicit “擴大範圍再搵” button. Expansion widens 1.5 km to 5 km (or 5 km to 10 km for an explicit far-travel preference). There is no second expansion; starting another decision lets you change area.
8. **Closed places.** In closed mode, start fresh. Expect the same honest empty state, never selectable closed cards. To exercise closure between search and selection, first load results mode cards, restart the app in closed mode, then choose: expect a closure error and no saved selection.
9. **Search unavailable.** In normal mode or failure mode, stop questioning. Expect saved answers, recoverable error, retry and new-decision actions. Restart in results mode and retry; expect results using the saved answers.
10. **Missing details.** In details-failure mode, expect unavailable detail placeholders and disabled choice buttons. The original questions stay visible. Restart in results mode, press “重新載入目前餐廳資料”, and expect usable cards.
11. **Location.** Deny location: manual district remains usable. Allow a Hong Kong location: search uses transient coordinates. Reload before searching: it uses the saved district centre and labels that fallback. Precise coordinates must not appear in browser storage.
12. **Concurrent tabs.** Open the same decision in two tabs and choose different cards. Expect one committed choice; the other tab reports a changed decision and refreshes to the saved choice.
13. **Small screens and keyboard.** At phone width, cards fit without horizontal scrolling; buttons remain reachable. Tab through actions; existing swipe left/right/up semantics, neutral answers and downward inertness remain unchanged.
14. **Privacy and terms.** Footer links open current data-use explanations. Signing out hides the decision/cards. A disallowed account cannot retrieve result data.

## Live-only acceptance — blocked until configured

These are **not** validated by synthetic cards or stubbed HTTP responses:

- Actual Hong Kong Nearby/Text/Details coverage, field-mask billing and a restricted server Places key.
- Returned restaurant identities, live opening status, prices/ratings, photo URLs and visible Google Maps / provider / photo-author attribution.
- Optional photo failure leaves facts and selection usable.
- No Maps action before successful selection; after persistence, Maps opens the selected real place ID. Opening Maps never records a visit.
- Separate content-use and model-input permissions under the applicable current Google terms; public privacy/terms URLs and attribution review.
- HF inference requires the real M5 endpoint/recipe fixture and pinned revision; otherwise deterministic fallback remains active.

History flipping follows in M7; next-opening visit prompts follow in M8. M6 only writes the pending outcome and four-hour eligibility timestamp.
