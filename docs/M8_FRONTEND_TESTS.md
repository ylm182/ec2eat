# M8 frontend acceptance — user-run

Backend timing, replay and concurrency are verified with isolated emulators. Browser/device checks below are left to you. Preview uses explicitly synthetic restaurant results.

## Prepare eligible test records without waiting four hours

Optional, emulator-only command:

```sh
npm run seed:outcomes:emulator -- demo-owner
```

Use your existing approved emulator UID if different. This command creates/resets **only three named synthetic sessions**: `m8-fixture-eligible` (selected five hours ago), `m8-fixture-older` (six hours ago), and `m8-fixture-recent` (one hour ago). It does not rewrite your normal selections, clear the database, alter opening records or weaken production time gates. The account must already be allowed. The command refuses non-demo/non-loopback environments. It has not been run against your preview data by the agent.

After seeding, **reload the page** to start a new opening. An opening already checked with no eligible prompt stays empty, even if a record later becomes eligible. Other eligible selections may take priority if newer than the fixtures.

## Scenarios and expected results

1. **No immediate confirmation.** Make a fresh M6 selection. Expect no automatic visit prompt and no confirmed visit. In History, expand “確認用餐結果”: expect the earliest four-hour confirmation time and the later-opening requirement.
2. **Eligible next opening.** With the optional five-hour fixture, reload. Expect one “上次有冇去食？” panel for the newest eligible pending selection. The one-hour fixture must not be selected. Synthetic records are labeled.
3. **One logical prompt per opening.** Navigate among Home, Decide and History without reloading. No second prompt should appear. An unanswered prompt can still be handled from History. Ordinary short tab switches do not create another opening.
4. **Confirmed selected visit.** Press “有，去了所選餐廳”. Expect the prompt to disappear and History to show “已確認去咗所選餐廳”. The original selected ID, questions, answers, recommendation and date remain unchanged.
5. **Snooze.** Press “遲啲先（24小時）”. Expect PENDING/“未確認到訪”, no actual place or confirmation timestamp, and the reminder-suppression time in History. A reload before that time must not prompt this record, though a different older eligible record may be prompted in the new opening. After ≥24 hours, another opening may prompt it again. Backend tests verify the exact boundary.
6. **Manual confirmation while snoozed.** In History, proactively confirm a snoozed record. This is allowed when the original four-hour/different-selection-opening gates are satisfied: snooze suppresses automatic reminders, not an explicit confirmation you choose to make.
7. **Went elsewhere, unknown restaurant.** Press “去了其他地方”, leave “先唔填實際餐廳” selected, then save. Expect VISITED_OTHER with unknown actual restaurant, distinctly different from “最後沒有外食”.
8. **Went elsewhere, known restaurant.** Enter at least two characters. Search starts after a 400 ms pause; stale requests are cancelled. In synthetic results mode, select an alternative and save. Expect its ID as the actual place, while the original selected place stays unchanged. Current closure does not disqualify a reported past visit.
9. **Search unavailable.** Restart the preview with `PLACES_FIXTURE=failure npm run dev:emulator`. An eligible History record can still be marked “去了其他地方” without a restaurant ID, “有，去了” or “最後沒有外食”. Search failure must not prevent those actions. Restart in results mode for subsequent tests.
10. **No meal out.** Choose “最後沒有外食”. Expect DID_NOT_EAT_OUT and a null actual restaurant. It must not be described as a dislike or as merely visiting a different restaurant.
11. **Correction.** Expand “更正用餐結果” in History. Change selected-visit → other-visit → no-meal-out, then back if desired. Expect the latest result only and the original question trail unchanged. M9 learning has not been activated; there are no accumulated visit increments to double count.
12. **Cross-tab competition.** Open the same pending record in two tabs and submit different outcomes. Only one wins at that revision. The stale tab refreshes the saved result; it must not silently overwrite the winner. Review the result before correcting again.
13. **Lost connection.** Go offline before saving. Expect no false success and “重試原本確認” or reload recovery. Return online and retry. If the first response was lost after commit, retry/reload restores the same single result.
14. **Long background return.** Hide the app for at least 30 minutes and return. This creates a new opening and may claim one eligible prompt. Shorter returns do not. Nothing automatically turns a selection into a visit.
15. **Lookup expiry.** Search for an actual restaurant and wait 15 minutes before saving that ID. Expect a request to search again or leave the restaurant blank. Arbitrary IDs and a receipt from another decision must be rejected.
16. **Account and keyboard checks.** Sign out: prompts/history disappear. Disallowed accounts cannot confirm or search. Actions work with keyboard; long IDs wrap on mobile; other-place radio groups remain independent when a prompt and History form are both mounted.

## Remaining live acceptance

Real Places lookup, applicable attribution/content permissions and the deployed outcome index need real-project smoke checks. HF warm-up remains independently optional; its failure cannot turn an outcome into a visit or change a frozen decision. No live credentials were invented and no paid resources were deployed.
