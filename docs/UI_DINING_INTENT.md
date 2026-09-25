# Dining intent and compact UI

See the 25 September owner-approved update in both source specifications. Google names are current live details, not historical snapshots. The history back fetches up to ten details without photo requests only when opened. These reads retain attribution and existing rate limits. No new credentials or services are required.

Manual frontend checks:
1. Home has only the compact ec2eat | 今日，食咩好 header. Choose 今次食咩: meal/snack illustration appears before range selection.
2. Swipe left 正餐 / right 小食 / up 都得. Choose 3 km or 10 km; continue existing adaptive questions. Explicit intent appears in history context after selecting a restaurant.
3. Results retain list/map tabs and all available recommendations, with no large title, area, ranking reason, reload or restart text. Header brand returns home to start again.
4. History front shows restaurant name without raw IDs. Pending records have 確認到訪; opening it retains four-hour/next-opening eligibility. Successfully confirm and the button disappears. Confirmed records retain 更正用餐結果.
5. Flip history: original recommendation order uses current names. Network failure shows a name-unavailable message, never invented names or raw IDs. Google attribution remains visible.
6. Check a small mobile display: card/list/map receives the extra space and account gear remains usable.

Defaults: snacks cover savoury snacks, sweets and bakery food. Search relevance cannot guarantee that every result serves only snacks/main meals. Old and neutral sessions keep the earlier mixed search strategy. No subjective restaurant features are inferred from query wording.

Snack Text Search omits the strict restaurant-only type restriction so bakeries/dessert venues are not excluded solely by their Google type. Main-meal queries retain that restriction. All candidates still require actual coordinates within the selected radius and must not be known closed.

Verification: 135 unit/component tests and 41 Firebase emulator tests passed; typecheck and production build passed. Manual visual/mobile acceptance is left to the owner as requested.


### Owner update: immediate History confirmation
Explicit History confirmation/correction and actual-restaurant lookup are available immediately after selection, including the selecting opening. This supersedes the previous manual four-hour/opening gate. Automatic reminders retain the four-hour/later-opening gate and only target PENDING outcomes. A confirmed outcome never needs a second confirmation after four hours. Authentication, ownership, revisions and idempotency remain enforced.
