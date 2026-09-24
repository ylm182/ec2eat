import { describe, it, expect } from "vitest";
import { derivePriors } from "../lib/domain/learning";
import { selectedFixture } from "./fixtures";
import { apiMetric } from "../lib/server/telemetry";
function evidence(id: string, action: "left" | "right" | "neutral" = "left") {
  const s = selectedFixture();
  s.id = id;
  s.outcome = {
    ...s.outcome,
    status: "VISITED_SELECTED",
    actualPlaceId: s.decision.selectedPlaceId,
    confirmedAt: "2026-09-24T08:00:00.000Z",
  };
  s.answers = [
    {
      questionInstanceId: "question-1",
      action,
      optionId: action === "neutral" ? null : action,
      value: action === "neutral" ? null : action === "left" ? 0.8 : 0.2,
      answeredAt: s.createdAt,
      requestId: id,
    },
  ];
  return s;
}
describe("bounded personal learning", () => {
  it("uses the latest twenty selected visits with capped strength and stable tie order", () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      evidence(String(i).padStart(2, "0")),
    );
    const result = derivePriors(sessions.reverse());
    expect(result.learningSourceSessionIds).toEqual(
      Array.from({ length: 20 }, (_, i) => String(24 - i).padStart(2, "0")),
    );
    expect(result.priors.speed).toMatchObject({
      state: "inferred",
      strength: 0.25,
    });
    expect(result.priors.speed.value).toBeCloseTo(0.8);
  });
  it("ignores neutral, other visits, pending and inherited preferences", () => {
    const other = evidence("other");
    other.outcome.status = "VISITED_OTHER";
    other.outcome.actualPlaceId = null;
    const pending = selectedFixture();
    pending.preferences.speed = { state: "inferred", value: 1, strength: 0.25 };
    expect(
      derivePriors([evidence("neutral", "neutral"), other, pending]).priors
        .speed.state,
    ).toBe("unknown");
    expect(derivePriors([evidence("one")]).priors.speed).toEqual({
      state: "inferred",
      value: 0.8,
      strength: 0.0125,
    });
  });
  it("logs fixed technical projections without input or identity text", () => {
    const s = evidence("private-session");
    s.uid = "private-user";
    s.context.area = "private-location";
    const metric = apiMetric(
      "outcome.save",
      "private-request",
      123.4,
      200,
      null,
      s,
    );
    expect(metric).toMatchObject({
      durationMs: 123,
      outcome: "VISITED_SELECTED",
      provider: "heuristic",
      questionCount: 1,
    });
    expect(JSON.stringify(metric)).not.toMatch(/private-|想點食|快食/);
    expect(
      apiMetric("api", "r", 1, 503, "SERVICE_UNAVAILABLE", {
        token: "secret",
        event: "secret",
      }),
    ).not.toHaveProperty("token");
  });
});
