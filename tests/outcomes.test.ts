import { describe, it, expect } from "vitest";
import { selectedFixture, sessionFixture } from "./fixtures";
import {
  canConfirm,
  canPrompt,
  outcomeInput,
  actualSearchInput,
} from "../lib/outcomes/contracts";
describe("outcome gates and intent", () => {
  it("requires a selected session, four hours, and a different opening even for manual History", () => {
    const s = selectedFixture(),
      at = Date.parse(s.outcome.eligibleAfter!);
    expect(canConfirm(s, "another", at - 1)).toBe(false);
    expect(canConfirm(s, "another", at)).toBe(true);
    expect(canConfirm(s, s.selectionLaunchId!, at + 86400000)).toBe(false);
    expect(canConfirm(sessionFixture(), "another", at)).toBe(false);
  });
  it("snooze suppresses automatic prompts only; explicit History confirmation still uses the age/opening gates", () => {
    const s = selectedFixture(),
      at = Date.parse(s.outcome.eligibleAfter!);
    s.outcome.snoozedUntil = new Date(at + 86400000).toISOString();
    expect(canPrompt(s, "next", at + 86399999)).toBe(false);
    expect(canPrompt(s, "next", at + 86400000)).toBe(true);
    expect(canConfirm(s, "next", at)).toBe(true);
    s.outcome.status = "DID_NOT_EAT_OUT";
    expect(canPrompt(s, "next", at + 86400000)).toBe(false);
  });
  it("rejects ambiguous intent, invented UID/revisions and unsupported actual-place combinations", () => {
    const base = {
      requestId: "r",
      launchId: "l",
      expectedRevision: 1,
      expectedOutcomeRevision: 0,
    };
    for (const input of [
      { ...base },
      { ...base, status: "PENDING" },
      { ...base, snooze: true, status: "DID_NOT_EAT_OUT" },
      { ...base, status: "VISITED_SELECTED", actualPlaceId: "x" },
      { ...base, status: "VISITED_OTHER", actualPlaceId: "x" },
      { ...base, snooze: true, uid: "foreign" },
    ])
      expect(outcomeInput.safeParse(input).success).toBe(false);
    expect(
      outcomeInput.parse({
        ...base,
        status: "VISITED_OTHER",
        actualPlaceId: null,
      }).actualPlaceId,
    ).toBeNull();
    expect(
      actualSearchInput.safeParse({
        requestId: "r",
        sessionId: "s",
        launchId: "l",
        query: "a",
      }).success,
    ).toBe(false);
  });
});
