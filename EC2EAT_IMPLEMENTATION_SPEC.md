# ec2eat — Implementation Specification

Version 1.0 · 24 September 2026 · Companion: [Architecture](EC2EAT_ARCHITECTURE.md)

## 1. Purpose and authority

**ec2eat = easy to eat.** Help the user quickly decide which restaurant to eat at through a few low-effort questions informed by current context. This is a private, personal, mobile-first web app, primarily used in Hong Kong; a few explicitly invited friends may use their own isolated accounts. It is not a public restaurant directory.

This specification consolidates the full referenced “App 決策腦暴” discussion. Explicit user decisions take precedence over earlier assistant suggestions. The architecture document governs technical contracts; this document governs behavior. Numbers marked **implementation default** make previously open details buildable; they are configurable, not historical product commitments.

Locked decisions: binary-first adaptive questions; left/right/up gestures; occasional categorical choice grids; historical restaurant cards with flip-to-question-trail; actual visit confirmation only on a later app opening; Google context and restaurant APIs; Gemini for language/context; Laya for decisions through Hugging Face; Firebase deployment balancing simplicity and Hong Kong performance.

## 2. MVP experience

Default copy is Traditional Chinese with natural Hong Kong phrasing; keep strings separate from logic. No multilingual UI project is required. Use Asia/Hong_Kong for meal windows and display; store timestamps in UTC.

### Home and context

- Google sign-in, restricted to an allowlist. Home centers on **Decide for me / 幫我揀** and a secondary History entry.
- Ask for location permission with a clear purpose. If unavailable, offer manual district/area selection before searching; never silently assume Central or use a Calendar event as current location.
- Calendar connection is optional and separately consented. Declining Calendar or weather failure must not prevent a decision.
- On authenticated app open, start non-blocking Laya warm-up and gather available context. Use location, local time, weather and nearby Calendar events as weak priors, never instructions that override explicit answers.
- Show a compact, dismissible outcome card for an eligible previous selection. It must not block a new decision.
- No mandatory onboarding preference questionnaire. Initialize unknown preferences and learn gradually.

### Decision flow

1. Start a new server-owned decision session with a frozen context snapshot and versioned preference prior.
2. Ask approximately **3–6 adaptive questions**. Show progress as “3 / ~6”, not a promise of a fixed total.
3. Rank broad meal archetypes during questioning. Use that distribution to pick the next useful dimension; avoid a Places request for every swipe.
4. On a stop condition, search real restaurants through Places and rank eligible candidates with Laya, or the deterministic fallback.
5. Show **2–3 restaurant cards**, with the highest-ranked recommendation first. Present supported facts, a short grounded reason and an explicit **揀呢間 / Choose this** action. Do not auto-select the model’s top result.
6. Persist the selection before offering **Open in Google Maps**. Opening Maps does not count as a visit.
7. Save the decision trail and leave outcome pending. Confirm the actual outcome only on a later eligible opening.

Restaurant cards use explicit selection buttons and ordinary browsing in MVP. Earlier restaurant-battle/swipe suggestions are not a second mandatory gesture system. If all cards are unsuitable, offer a new decision or an explicit wider-area search; do not silently relax constraints.

## 3. Interaction rules

### Binary cards

Use **[react-tinder-card](https://github.com/3DJakob/react-tinder-card)** as the required MVP swipe component, with its compatible `@react-spring/web` dependency. Wrap it in an ec2eat `DecisionSwipeCard`; card styling remains app-owned. Do not replace it with a custom gesture engine without a documented compatibility blocker and an explicit decision to change this requirement. History flip cards use React/CSS, and categorical choices use a normal option grid.

- Left = displayed option A; right = displayed option B; up = **都可以 / Either**.
- Up is a recorded `neutral` answer: this dimension does not matter for this session. It is not an unanswered question, a numeric midpoint, or a negative preference.
- Show directional labels before dragging and highlight the active answer during dragging. Down does nothing in MVP.
- Provide equivalent tap buttons and keyboard controls; accessible labels must include the actual option text. Respect reduced motion and avoid hijacking page scrolling.
- Commit one answer per card; disable repeat submissions while saving. On network failure, keep the answer visible as unsaved and allow retry with the same request ID.
- Do not repeat a dimension already answered or marked neutral. A full answer-editing/undo system is outside the baseline MVP; do not expose a decorative Undo control.

### Categorical exceptions

Use a single-select grid only when the uncertainty is genuinely categorical and one question replaces several awkward binary comparisons. Example: **麵 / 飯 / 湯或鍋物 / 都可以**. Choose non-overlapping labels appropriate to the remaining candidates; “meat” and “rice” should not be treated as mutually exclusive universal food categories.

Implementation default: at most one categorical question, after at least two binary answers, counting toward the six-question cap. Return directly to the normal flow afterwards. Cuisine is a candidate category, not a numeric preference dimension. Multi-select “I already have something in mind” mode is deferred.

## 4. Adaptive question engine

Use a finite, versioned catalog: **11 dimensions and 22 binary templates** below. This stays within the discussed 10–15 / 20–30 range and merges the overlapping familiarity/novelty examples. Each pair below is template 01 then 02. All offer the same neutral action.

- `richness`: 清爽啲 ↔ 濃郁啲; 味道輕盈 ↔ 味道濃厚. High = rich.
- `spiciness`: 唔辣 ↔ 想食辣; 溫和口味 ↔ 辣啲開胃. High = spicy.
- `novelty`: 熟悉嘅選擇 ↔ 試新嘢; 食返慣常口味 ↔ 探索少食嘅類型. High = novel to this user.
- `speed`: 快食快走 ↔ 慢慢食; 食得快啲 ↔ 可以坐耐啲. High = fast; reversed numeric polarity.
- `formality`: 輕鬆隨意 ↔ 正式啲; Casual 就好 ↔ 想要正式用餐. High = formal.
- `comfort`: 日常一餐 ↔ 特別享受; 簡單滿足 ↔ 慰勞自己. High = occasion/treat intent, not richness.
- `healthiness`: 健康啲 ↔ 放縱一下; 想食均衡啲 ↔ 今日想 indulgent 啲. High = healthy; reversed polarity. A subjective meal preference, not medical guidance.
- `temperature`: 清涼啲 ↔ 熱食; 凍食都好 ↔ 想食暖笠笠. High = hot food.
- `social`: 一個人方便 ↔ 適合分享; 個人份量 ↔ 一齊分住食. High = sharing suitability, not an assertion about companions.
- `distanceTolerance`: 附近搞掂 ↔ 好食可以遠少少; 落雨想近啲 ↔ 落雨都願意行遠啲. High = willingness to travel; template 02 requires rain.
- `price`: 平實啲 ↔ 願意花多啲; 今餐慳啲 ↔ 今餐可以豪啲. High = higher spend tolerance, not a hard HKD budget.

Implementation defaults: option values 0.2/0.8, reversed for speed and healthiness. Template 01 is always available; template 02 is an alternate wording, with the rain guard above. Never ask both versions in one session. Candidate feature definitions and polarity must match the architecture exactly.

Next-question policy:

1. Rank the current archetypes using answers and available priors.
2. Among the top five, compute weighted variance for each unasked dimension with enough known candidate features.
3. Multiply variance by context relevance and remaining uncertainty; choose the highest score with stable ID tie-breaking.
4. Increase distance relevance in rain and speed relevance near a timed event. These are soft priorities.
5. Use the matching fixed template. Gemini may rewrite wording only while preserving option meanings, numeric values and the selected dimension; fixed wording is always available.

Do not perform dozens of hypothetical Laya calls per answer or let Gemini invent dimensions. Detailed defaults and unknown-value handling are in the architecture.

Stopping defaults: allow early stopping after three answers when top weight ≥0.70 and top-two margin ≥0.20; otherwise stop at six, on exhaustion of useful questions, or when the user taps “Show options”. Record the exact stop reason. Weights and model confidence are ranking signals, not a calibrated probability that the user will enjoy a meal. A low-confidence stop still yields a shortlist when real candidates exist.

## 5. Recommendation and failure UX

- Display current name, area, available price/rating and photo with required attribution; use placeholders for unavailable fields. Never invent queue lengths, menus, opening status or walking time.
- Use straight-line distance with an explicit label if available; route ETA is not in MVP.
- Known permanently closed restaurants are excluded. Known currently closed restaurants are excluded for “eat now”; unknown hours are labeled and require checking. Soft preferences must not become hard exclusions.
- Explain only facts and answers actually used. “你想快食、又想食熱嘢” is acceptable; “一定不用排隊” is not.
- Location denied: choose an area. Calendar disconnected: continue without it. Gemini failed: use templates/rules. Laya warming/failed: use heuristic ranking and record the fallback.
- Places unavailable or no candidates: show a recoverable error/empty state with retry or area change. Do not fabricate restaurants or present development fixtures as live data.
- Selection persistence failure: do not show a saved-success state. A lost response must be recoverable without duplicate records.

## 6. History and delayed outcome

History is a newest-first paginated collection of **selected sessions**, not an aggregated restaurant directory. Repeated visits may produce repeated cards.

Front: restaurant identity, selection date, meal, area and actual outcome; current restaurant details/photo when available. Explicit **Flip / 睇返點揀** button reveals the back: exact ordered question wording, option labels, selected answers including neutral, original context summary, original shortlist IDs/order, provider/fallback, stop reason and recorded confidence type. Flip back restores the front. History navigation does not submit answers.

Freeze app-owned context, questions, answers and decision metadata when selection succeeds. Later template/model changes must not rewrite them. Separate mutable outcome from the frozen decision. Google-sourced content must obey retention rules: do not promise permanent historical photos, ratings or raw reviews. Current refreshed details must be labeled as current, and unavailable details must not hide the question trail.

Outcome implementation default: show at the next app opening **at least four hours after selection**, never in the selecting launch. An opening means a new page/app load or return after ≥30 minutes hidden; tab switching does not repeatedly prompt. Show only the most recent eligible pending selection, at most one per opening. Older records remain confirmable in History.

Actions:

- **有，去了** → `VISITED_SELECTED`, actual place = selected place.
- **去了其他地方** → `VISITED_OTHER`; optionally search/select the actual place, but allow leaving it unknown.
- **最後沒有外食** → `DID_NOT_EAT_OUT`, actual place = null.
- **Skip / 遲啲先** → keep `PENDING`, suppress until a later opening and at least 24 hours later (default).

If using an initial “沒有” button, expand the more precise choices above; do not equate “did not visit this restaurant” with “did not eat out”. Allow outcome correction from History and update derived learning without double counting. Do not ask why the user changed plans in MVP.

## 7. Learning and scope

MVP includes authentication, context permission handling, adaptive swipe flow, the categorical exception, real Places shortlist, Laya plus heuristic fallback, Gemini context extraction, selection, Maps link, flip-card history, delayed outcomes and modest personal priors.

Learning uses explicit user answers and confirmed outcomes. A confirmed selected visit may strengthen that session's expressed preferences; neutral contributes no directional signal. A missed visit is not evidence of dislike. A visit elsewhere updates actual visit history without attributing unknown restaurant characteristics. Current explicit answers always override historical priors. No training job or fine-tuning is required.

Non-goals: public signup, social/group decisions, bookings/payments/delivery, native apps, autonomous Calendar writes, Maps saved-list sync/scraping, Takeout import, share targets, a full restaurant library, queue prediction, dietary/allergy certification, analytics dashboards, full Bayesian information gain, automatic model upgrades, self-hosted Laya, vector databases and microservices. A basic home-screen install manifest is optional polish, not an offline product requirement.

## 8. Milestones and acceptance

1. **M1 Foundation:** Next.js/TypeScript, server validation, Auth allowlist, Firestore emulator/schema/rules, page shell and provider interfaces. Acceptance: approved account works; unapproved/other-user access fails; production secrets are absent from client output.
2. **M2 Swipe UI:** integrate `react-tinder-card` and compatible `@react-spring/web`, fixtures, directional feedback and buttons. Acceptance: all three inputs record exactly once; down is inert; keyboard/reduced-motion modes work on mobile-width layouts.
3. **M3 Preference engine:** catalog, deterministic ranking, neutral handling and stop policy. Acceptance: fixtures with different candidate variance select different useful questions; no dimension repeats; neutral and unknown behave differently; flow terminates by six.
4. **M4 Context:** location/manual area, Calendar read-only OAuth, Weather and Gemini extraction. Acceptance: each permission/API can fail independently without blocking the core flow; explicit answers beat context priors.
5. **M5 Laya:** HF adapter, app-open and scheduled warm-up, timeout/fallback. Acceptance: real contract smoke test plus simulated 503, timeout and malformed output all produce bounded behavior; both HKT scheduled runs are configured and authenticated.
6. **M6 Restaurants:** Places search/details, rank 2–3, choose and Maps link. Acceptance: only real returned IDs can be selected; duplicate request is safe; empty results are honest; attribution and content-retention controls work.
7. **M7 History:** durable selection snapshot and flip cards. Acceptance: changing a template does not alter older wording; refreshed/deleted Places fields do not corrupt the trail.
8. **M8 Outcome:** later-opening/four-hour gate, skip, actual-other and corrections. Acceptance: never prompt immediately; skip is not a negative outcome; cross-tab duplicates and corrections remain consistent.
9. **M9 Personal learning and release:** bounded priors, production configuration, observability and cost checks. Acceptance: replay/correction does not double count; current answers override learned values; deployed HK-device smoke flow succeeds.

M1–M3 establish a usable vertical slice before paid integrations. End-to-end MVP acceptance covers one real selection, later confirmation and history replay, plus a complete heuristic flow with Laya unavailable. Test meaningful contracts, transitions, authorization and failure behavior; do not require brittle pixel-perfect snapshots.

## 9. GPT-6 implementation instructions

Read both documents completely. Perform a short consistency review before coding, focusing on provider contracts, regional availability, content retention, session transitions and credentials. Preserve these product decisions. Resolve routine implementation details with documented defaults; only surface genuine blockers requiring account access or a changed product decision.

Start M1, with fixtures and emulators, then advance in milestone order. Keep dependency versions compatible with current Firebase App Hosting support and commit a lockfile. Never claim mocks validate an external integration. Record setup steps, environment variables, required indexes/rules and actual test results in the repository. Do not deploy paid resources or change chosen regions silently. A missing credential blocks its live integration, not the rest of the build.

### Copyable handoff prompt

> Implement the personal Hong Kong restaurant decision app **ec2eat** using `EC2EAT_IMPLEMENTATION_SPEC.md` and `EC2EAT_ARCHITECTURE.md` as the source of truth. Read both, perform a concise consistency review, state the milestone plan, and begin M1. Use `react-tinder-card` for question swipes. Preserve left/right/up semantics, binary-first adaptive questions, flip-card history and next-opening visit confirmation. Use Gemini `gemini-3.5-flash-lite` for context/language, Hugging Face Laya for scoring, and a deterministic fallback. Keep Firebase App Hosting in Taiwan and Firestore in Hong Kong. Use mocks/emulators until integrations are configured; never invent live data or credentials. Implement and verify each milestone incrementally, documenting defaults and real blockers without expanding the product scope.


## Owner-approved restaurant-ranking update — 25 September 2026

The accepted larger-pool flow supersedes the earlier restaurant-only candidate/result and call-count limits: up to 50 unique in-radius candidates from popular nearby and bounded food/cuisine searches, at most six Laya tournament passes of ten or fewer candidates, and up to ten displayed recommendations. Weights from different batches are never compared. Any failed pass uses deterministic ranking over the whole pool. Restaurant ranking has a 20-second budget within 25-second retrieval/ranking; question inference and three-to-six adaptive answers are unchanged. See [TOP_TEN_RANKING.md](docs/TOP_TEN_RANKING.md) for defaults, cost, approximation limits and verification.


## Owner-approved update — 25 September 2026: compact UI and dining intent

New decisions ask 正餐 (left) / 小食 (right) before radius selection. Up remains neutral (都得). This explicit pre-search choice is persisted as optional `context.diningIntent` (`meal`, `snack`, `any`), separate from the eleven adaptive dimensions and six-question limit. Older sessions omit it and retain existing retrieval. New explicit meal/snack choices scope all seven Text Search calls: meal queries include 正餐; snack queries cover 小食/港式小食/街頭小食/甜品/麵包糕點/日式小食/台式小食. This is retrieval relevance, not proof of menu contents. Radius validation and bounded 50-candidate/10-result ranking remain.

Header becomes ec2eat | 今日，食咩好. Home/result large headings, results reason/area, reload and restart buttons are removed as requested; home remains reachable through the brand link. History hides raw IDs, offers 確認到訪 for pending outcomes, and retains correction access. Four-hour/next-opening eligibility is unchanged. Flipping history loads current restaurant names in original saved order through an authenticated owner-scoped route, without photos or persistence. Missing names are labelled unavailable rather than replaced by IDs. Front history still fetches only the selected restaurant.


### Owner update: immediate History confirmation
Explicit History confirmation/correction and actual-restaurant lookup are available immediately after selection, including the selecting opening. This supersedes the previous manual four-hour/opening gate. Automatic reminders retain the four-hour/later-opening gate and only target PENDING outcomes. A confirmed outcome never needs a second confirmation after four hours. Authentication, ownership, revisions and idempotency remain enforced.
