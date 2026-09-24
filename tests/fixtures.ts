import { unknownPreferences, type DecisionSession } from "../lib/domain/schema";
export function sessionFixture(uid = "alice"): DecisionSession {
  return {
    schemaVersion: 1,
    id: "session-1",
    uid,
    revision: 0,
    status: "QUESTIONING",
    createdAt: "2026-09-24T04:00:00.000Z",
    updatedAt: "2026-09-24T04:00:00.000Z",
    selectedAt: null,
    launchId: "launch-1",
    selectionLaunchId: null,
    catalogVersion: "fixture-v1",
    engineVersion: "fixture-v1",
    priorVersion: "initial",
    context: {
      capturedAt: "2026-09-24T04:00:00.000Z",
      timezone: "Asia/Hong_Kong",
      meal: "lunch",
      area: "測試地區",
      locationSource: "manual",
      weather: null,
      calendar: null,
      availability: { calendar: "absent", weather: "absent" },
    },
    preferences: unknownPreferences(),
    questions: [
      {
        instanceId: "question-1",
        issuedAt: "2026-09-24T04:00:00.000Z",
        definition: {
          id: "speed-01",
          version: 1,
          dimensionId: "speed",
          kind: "binary",
          prompt: "想點食？",
          options: [
            { id: "left", label: "快食快走", value: 0.8 },
            { id: "right", label: "慢慢食", value: 0.2 },
          ],
          contextTags: [],
        },
      },
    ],
    answers: [],
    decision: {
      stopReason: null,
      provider: "heuristic",
      modelRevision: null,
      confidence: null,
      confidenceKind: "none",
      candidates: [],
      recommendedPlaceId: null,
      selectedPlaceId: null,
      reason: null,
      fallbackReason: null,
    },
    outcome: {
      status: "PENDING",
      actualPlaceId: null,
      confirmedAt: null,
      revision: 0,
      eligibleAfter: null,
      snoozedUntil: null,
      lastPromptLaunchId: null,
    },
  };
}
export function selectedFixture(): DecisionSession {
  const s = sessionFixture();
  return {
    ...s,
    status: "SELECTED",
    selectedAt: s.createdAt,
    selectionLaunchId: s.launchId,
    decision: {
      ...s.decision,
      stopReason: "user_requested",
      candidates: [{ placeId: "synthetic-place", score: 0.5, weight: 1 }],
      recommendedPlaceId: "synthetic-place",
      selectedPlaceId: "synthetic-place",
    },
    outcome: { ...s.outcome, eligibleAfter: "2026-09-24T08:00:00.000Z" },
  };
}
