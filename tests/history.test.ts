import { describe, it, expect } from "vitest";
import { selectedFixture } from "./fixtures";
import {
  historySnapshot,
  hongKongTime,
  historyPageSchema,
  outcomeLabels,
} from "../lib/history/schema";
import {
  encodeHistoryCursor,
  decodeHistoryCursor,
} from "../lib/server/history";
describe("history read contracts", () => {
  it("round-trips bounded canonical cursors and rejects malformed anchors", () => {
    expect(decodeHistoryCursor(encodeHistoryCursor("selected-123"))).toBe(
      "selected-123",
    );
    for (const bad of [
      "",
      "???",
      "a".repeat(257),
      Buffer.from("../alice").toString("base64url"),
      "c2VsZWN0ZWQtMTIz=",
    ])
      expect(() => decodeHistoryCursor(bad)).toThrow();
  });
  it("redacts expired or nonpersistable provider context without changing saved questions or source snapshots", () => {
    const original = selectedFixture();
    const now = Date.parse("2026-09-24T12:00:00.000Z");
    original.context.weather = {
      condition: "RAIN",
      temperatureC: 26,
      provenance: {
        source: "google-weather",
        fetchedAt: "2026-09-24T04:00:00.000Z",
        expiresAt: "2026-09-24T12:00:00.000Z",
        persistAllowed: true,
        modelInputAllowed: false,
      },
    };
    original.context.calendar = {
      nextEventSoon: true,
      socialHint: null,
      provenance: {
        source: "google-calendar",
        fetchedAt: "2026-09-24T04:00:00.000Z",
        expiresAt: null,
        persistAllowed: false,
        modelInputAllowed: false,
      },
    };
    const copy = historySnapshot(original, now);
    expect(copy.context.weather).toBeNull();
    expect(copy.context.calendar).toBeNull();
    expect(original.context.weather.condition).toBe("RAIN");
    expect(original.context.calendar.nextEventSoon).toBe(true);
    expect(copy.questions).toEqual(original.questions);
    expect(copy.decision).toEqual(original.decision);
    expect(copy.answers).toEqual(original.answers);
    expect(historySnapshot(original, now - 1).context.weather).toEqual(
      original.context.weather,
    );
  });
  it("history pages are capped at 20 and Hong Kong time does not follow device timezone", () => {
    const selected = selectedFixture();
    expect(
      historyPageSchema.safeParse({
        sessions: Array(21).fill(selected),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(hongKongTime("2026-09-24T04:00:00.000Z")).toContain("12:00");
    expect(outcomeLabels.PENDING).not.toEqual(outcomeLabels.VISITED_SELECTED);
  });
});
