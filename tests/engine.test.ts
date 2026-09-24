import { describe, it, expect } from "vitest";
import {
  binaryCatalog,
  binaryTemplate,
  archetypes,
  type Archetype,
} from "../lib/domain/catalog";
import {
  rankCandidates,
  usefulDimensions,
  nextQuestion,
  stopReason,
} from "../lib/domain/engine";
import { applyAnswer, newSession, requestOptions } from "../lib/domain/session";
import {
  unknownPreferences,
  questionSchema,
  type Dimension,
} from "../lib/domain/schema";
import { HeuristicDecisionProvider } from "../lib/providers/heuristic";
const now = "2026-09-24T04:00:00.000Z";
const make = () =>
  newSession({ id: "s", uid: "u", launchId: "launch", area: "旺角", now });
const feature = (value: number | null, confidence = 1) => ({
  value,
  confidence,
  source: "rule" as const,
});
const pair = (dimension: Dimension): Archetype[] => [
  { id: "a", label: "a", features: { [dimension]: feature(0) } },
  { id: "b", label: "b", features: { [dimension]: feature(1) } },
];
describe("catalog and fallback scoring", () => {
  it("validates 22 templates, eleven dimensions, reversed speed/healthiness and rain guard", () => {
    expect(binaryCatalog).toHaveLength(22);
    expect(new Set(binaryCatalog.map((q) => q.dimensionId)).size).toBe(11);
    for (const q of binaryCatalog)
      expect(() => questionSchema.parse(q)).not.toThrow();
    for (const dimension of ["speed", "healthiness"] as const)
      expect(
        binaryTemplate(dimension, false).options.map((o) => o.value),
      ).toEqual([0.8, 0.2]);
    expect(binaryTemplate("distanceTolerance", false, true).id).toBe(
      "distanceTolerance-01",
    );
    expect(binaryTemplate("distanceTolerance", true).id).toBe(
      "distanceTolerance-02",
    );
  });
  it("unknown evidence gives .5; neutral suppresses prior whereas unknown can inherit it", () => {
    const prefs = unknownPreferences();
    const priors = {
      richness: { state: "inferred" as const, value: 1, strength: 0.25 },
    };
    expect(rankCandidates(pair("richness"), prefs)[0].score).toBe(0.5);
    expect(rankCandidates(pair("richness"), prefs, priors)[0].id).toBe("b");
    prefs.richness = { state: "neutral", value: null, strength: 0 };
    expect(
      rankCandidates(pair("richness"), prefs, priors).map((r) => r.score),
    ).toEqual([0.5, 0.5]);
    prefs.richness = { state: "answered", value: 0, strength: 1 };
    expect(rankCandidates(pair("richness"), prefs, priors)[0].id).toBe("a");
  });
  it("weights by known confidence; zero-confidence and null features give no evidence", () => {
    const prefs = unknownPreferences();
    prefs.richness = { state: "answered", value: 1, strength: 1 };
    prefs.speed = { state: "answered", value: 1, strength: 1 };
    expect(
      rankCandidates(
        [
          {
            id: "a",
            label: "a",
            features: { richness: feature(1, 0.5), speed: feature(0, 1) },
          },
        ],
        prefs,
      )[0].score,
    ).toBeCloseTo(1 / 3);
    expect(
      rankCandidates(
        [
          {
            id: "a",
            label: "a",
            features: { richness: feature(null), speed: feature(1, 0) },
          },
        ],
        prefs,
      )[0].score,
    ).toBe(0.5);
  });
  it("distance tolerance never rewards farther places; spending tolerance never penalizes cheaper ones", () => {
    const prefs = unknownPreferences();
    prefs.distanceTolerance = { state: "answered", value: 0.8, strength: 1 };
    expect(
      rankCandidates(pair("distanceTolerance"), prefs).map((r) => r.score),
    ).toEqual([1, 0.8]);
    prefs.distanceTolerance = { state: "unknown", value: null, strength: 0 };
    prefs.price = { state: "answered", value: 0.8, strength: 1 };
    expect(rankCandidates(pair("price"), prefs).map((r) => r.score)).toEqual([
      1, 0.8,
    ]);
  });
  it("ties prefer shorter known distance then stable ID; softmax sums to one", () => {
    const candidates = [
      { id: "z", label: "z", distanceM: 10, features: {} },
      { id: "a", label: "a", features: {} },
      { id: "b", label: "b", distanceM: 10, features: {} },
    ];
    const rank = rankCandidates(candidates, unknownPreferences());
    expect(rank.map((r) => r.id)).toEqual(["b", "z", "a"]);
    expect(rank.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1);
  });
  it("bounded provider returns heuristic metadata and respects abort", async () => {
    const provider = new HeuristicDecisionProvider();
    const input = {
      version: 1 as const,
      stage: "archetype" as const,
      candidates: archetypes,
      preferences: unknownPreferences(),
      priors: {},
      context: { rain: null, nextEventSoon: null },
    };
    expect(
      await provider.rank(input, new AbortController().signal),
    ).toMatchObject({
      provider: "heuristic",
      confidence: null,
      confidenceKind: "none",
      fallbackReason: "laya_not_configured",
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.rank(input, aborted.signal)).rejects.toThrow();
  });
});
describe("adaptive questions and stopping", () => {
  it("different candidate variance selects a different useful dimension", () => {
    for (const dimension of ["richness", "temperature"] as const) {
      const candidates = pair(dimension);
      expect(
        usefulDimensions(
          candidates,
          rankCandidates(candidates, {}),
          {},
          new Set(),
          { rain: null, nextEventSoon: null },
        )[0].dimension,
      ).toBe(dimension);
    }
  });
  it("unknown and inferred uncertainty differ; context is a soft relevance multiplier", () => {
    const candidates = pair("speed").map((c, i) => ({
      ...c,
      features: { ...c.features, richness: feature(i) },
    }));
    const prefs = unknownPreferences();
    const rank = rankCandidates(candidates, prefs);
    expect(
      usefulDimensions(candidates, rank, prefs, new Set(), {
        rain: false,
        nextEventSoon: false,
      })[0].dimension,
    ).toBe("richness");
    expect(
      usefulDimensions(candidates, rank, prefs, new Set(), {
        rain: false,
        nextEventSoon: true,
      })[0].dimension,
    ).toBe("speed");
    prefs.richness = { state: "inferred", value: 0.5, strength: 0.25 };
    expect(
      usefulDimensions(candidates, rank, prefs, new Set(), {
        rain: null,
        nextEventSoon: null,
      })[0].dimension,
    ).toBe("speed");
  });
  it("requires two known values, excludes answered/neutral and exhausted variance", () => {
    const candidates = pair("richness");
    candidates[1].features.richness = feature(null);
    expect(
      usefulDimensions(
        candidates,
        rankCandidates(candidates, {}),
        {},
        new Set(),
        { rain: null, nextEventSoon: null },
      ),
    ).toEqual([]);
    const prefs = unknownPreferences();
    prefs.richness = { state: "neutral", value: null, strength: 0 };
    expect(
      usefulDimensions(
        pair("richness"),
        rankCandidates(pair("richness"), prefs),
        prefs,
        new Set(),
        { rain: null, nextEventSoon: null },
      ),
    ).toEqual([]);
  });
  it("allows one category question only after two binary answers and applies it as categorical evidence", () => {
    let s = make();
    for (let i = 0; i < 2; i++)
      s = applyAnswer(
        s,
        {
          requestId: `r${i}`,
          expectedRevision: s.revision,
          questionInstanceId: s.questions.at(-1)!.instanceId,
          action: "neutral",
        },
        now,
      );
    const candidates = [
      { ...pair("richness")[0], categoryId: "rice" },
      { ...pair("richness")[1], categoryId: "noodles" },
    ];
    const clone = structuredClone(s);
    clone.questions = clone.questions.slice(0, 2);
    const q = nextQuestion(clone, candidates, rankCandidates(candidates, {}), {
      rain: null,
      nextEventSoon: null,
    });
    expect(q?.kind).toBe("category");
    expect(rankCandidates(candidates, {}, {}, "rice")[0].id).toBe("a");
    expect(
      nextQuestion(make(), candidates, rankCandidates(candidates, {}), {
        rain: null,
        nextEventSoon: null,
      })?.kind,
    ).toBe("binary");
  });
  it("never repeats a dimension and ends by six for directional and all-neutral sessions", () => {
    for (const action of ["left", "right", "neutral"] as const) {
      let s = make();
      while (s.status === "QUESTIONING") {
        const q = s.questions.at(-1)!;
        const category = q.definition.kind === "category";
        s = applyAnswer(
          s,
          {
            requestId: `request-${s.answers.length}`,
            expectedRevision: s.revision,
            questionInstanceId: q.instanceId,
            action: category && action !== "neutral" ? "category" : action,
            ...(action === "neutral"
              ? {}
              : { optionId: category ? q.definition.options[0].id : action }),
          },
          now,
        );
        expect(s.answers.length).toBeLessThanOrEqual(6);
      }
      expect(
        new Set(
          s.questions.flatMap((q) =>
            q.definition.dimensionId ? [q.definition.dimensionId] : [],
          ),
        ).size,
      ).toBe(s.questions.filter((q) => q.definition.kind === "binary").length);
      expect(
        s.questions.filter((q) => q.definition.kind === "category").length,
      ).toBeLessThanOrEqual(1);
      expect(s.decision.stopReason).not.toBeNull();
      expect(s.decision.candidates).toEqual([]);
      expect(s.outcome.eligibleAfter).toBeNull();
    }
  });
  it("early confidence stop respects minimum, max and exact reasons", () => {
    const rank = [
      { id: "a", score: 1, weight: 0.8 },
      { id: "b", score: 0.1, weight: 0.2 },
    ];
    expect(stopReason(2, rank, true)).toBeNull();
    expect(stopReason(3, rank, true)).toBe("weight_margin");
    expect(stopReason(6, rank, true)).toBe("max_questions");
    expect(stopReason(1, rank, false)).toBe("exhausted");
    expect(stopReason(1, rank, true, true)).toBe("user_requested");
  });
  it("accepts only issued options/revisions, stops explicitly, freezes earlier wording", () => {
    const s = make();
    const original = structuredClone(s.questions);
    expect(() =>
      applyAnswer(
        s,
        {
          requestId: "r",
          expectedRevision: 1,
          questionInstanceId: s.questions[0].instanceId,
          action: "neutral",
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      applyAnswer(
        s,
        {
          requestId: "r",
          expectedRevision: 0,
          questionInstanceId: s.questions[0].instanceId,
          action: "neutral",
          optionId: "left",
        },
        now,
      ),
    ).toThrow();
    const next = applyAnswer(
      s,
      {
        requestId: "r",
        expectedRevision: 0,
        questionInstanceId: s.questions[0].instanceId,
        action: "neutral",
      },
      now,
    );
    expect(next.questions[0]).toEqual(original[0]);
    expect(s.answers).toEqual([]);
    expect(
      requestOptions(s, 0, "user_requested", now).decision.stopReason,
    ).toBe("user_requested");
    expect(() => requestOptions(s, 0, "automatic", now)).toThrow();
  });
});
