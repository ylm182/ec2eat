# Mobile UI refresh — 25 September 2026

User-requested update before Weather integration. This supersedes the original visible instructional layout and new-session radius defaults; decision scoring, question polarities, binary-first selection, neutral answers, history snapshots and later-opening outcome eligibility remain unchanged.

## Implemented

- Violet, coral, mint and yellow palette in a mobile viewport shell using dynamic viewport height and bottom safe-area padding.
- Signed-in home card: left opens History; right starts a fresh decision. Buttons provide equivalent accessible actions. Existing in-progress sessions still recover when opening `/decide` directly.
- New decisions request fresh browser geolocation automatically. Browsers control whether a permission dialog appears again. Denial, unsupported GPS or an outside-HK result offers manual area selection. Coordinates remain request-only.
- First card chooses 3 km on the left or 10 km on the right. This is search setup, not a preference answer, so it does not count towards the three-to-six adaptive questions. The chosen radius is durable app-owned context; later distance-preference answers do not override it. Invalid radii are rejected. Existing sessions without this field retain their earlier search defaults. Explicit empty-result expansion remains available below 10 km, never above it.
- All 11 dimensions have paired illustrations with option-aligned symbols. SVG compositions use native emoji (appearance varies by device). Visible question sentences and repeated instructional labels are removed; full prompts remain available to screen readers and in saved history. Category exception retains named category buttons.
- Corner gear contains Calendar connection/disconnection, logout and account data controls.
- Large loading indicator for account authorization, location, creation, saving, restaurant requests and history. Reduced-motion setting stops animation.
- Results/history show one card at a time with pagination; flip-card history and later-opening confirmation are retained. Long details, settings, legal text and enlarged accessibility text can scroll inside the app instead of being clipped. Normal home/range/question stages are designed to fit the viewport.

## User frontend checks (pending)

1. At 390×844 and 375×667: home, range and question stages fit without vertical scrolling; gear and all three question actions remain reachable. Repeat with mobile browser bars visible.
2. Existing Google session: home left goes to History; right starts a new choice. Signed-out home offers login. Gear opens settings, logout returns to signed-out state, Calendar disconnect updates its status.
3. New choice: location requested. Allow → area resolves; deny → manual area selector remains usable. Left starts a 3 km search, right starts a 10 km search. A remembered browser permission may not show another permission dialog.
4. Questions: illustrated options match left/right meanings, including fast on the left and healthy on the left. Swipe up stays neutral. Buttons and keyboard arrows still work. There are at least three useful answers before confidence stopping, maximum six; true exhaustion and explicit show-results remain supported.
5. Slow network: large loader appears; rapid duplicate gestures do not submit twice. Failed answer shows retry and preserves the selected answer. Failed create permits retry without losing the original request identity/radius.
6. Results: previous/next changes restaurants; choose saves once. Google Maps and author attribution remain accessible. Selection is not automatically marked as a visit.
7. History: page between records and flip each card to its original question trail. On a later eligible launch, confirm or snooze the previous visit as before.
8. Reduced motion and large text: no required information or actions become inaccessible. Longer details/settings may scroll within the viewport.

Weather remains disabled. No provider data or credentials were invented. No production rollout is included in this UI implementation; mobile visual acceptance is pending user testing.

## Automated verification

- Production Next.js build passed.
- 109 unit/component tests passed, including real react-tinder-card gesture, keyboard, duplicate-submit and retry tests.
- 39 Firebase emulator tests passed, including explicit 3 km / 10 km radius persistence and provider requests, rejection of expansion above 10 km, and existing auth/history/outcome behavior.
- No paid provider calls were used for these checks.
