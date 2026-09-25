import { describe, it, expect } from "vitest";
import { encodeDocument, decodeDocument } from "../lib/server/repository";
import { scoringInput } from "../lib/domain/scoring";
import { selectedFixture } from "./fixtures";
function context(expires: number) {
  const s = selectedFixture();
  s.context.weather = { condition: "RAIN", temperatureC: 24, provenance: { source: "google-weather", fetchedAt: new Date(expires - 1800000).toISOString(), expiresAt: new Date(expires).toISOString(), persistAllowed: true, modelInputAllowed: false } };
  s.context.availability.weather = "available";
  return s;
}
describe("weather retention", () => {
  it("strips expired weather from sessions and nested replay copies without losing choices", () => {
    const s = context(Date.now() - 1000);
    const decoded = decodeDocument(encodeDocument({ response: s })) as { response: typeof s };
    expect(decoded.response.context.weather).toBeNull();
    expect(decoded.response.context.availability.weather).toBe("absent");
    expect(decoded.response.decision).toEqual(s.decision);
    expect(s.context.weather).not.toBeNull();
  });
  it("retains fresh context but does not send Google weather-derived hints to Laya", () => {
    const s = context(Date.now() + 1800000);
    expect((decodeDocument(encodeDocument(s)) as typeof s).context.weather).toEqual(s.context.weather);
    expect(scoringInput(s).context.rain).toBeNull();
  });
});
