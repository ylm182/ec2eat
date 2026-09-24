import {
  dimensions,
  type Dimension,
  type Preference,
  type DecisionSession,
  type QuestionDefinition,
} from "./schema";
import {
  type Archetype,
  binaryTemplate,
  categoryTemplate,
  categories,
} from "./catalog";
export type Ranked = { id: string; score: number; weight: number };
export type Preferences = Partial<Record<Dimension, Preference>>;
export type EngineContext = {
  rain: boolean | null;
  nextEventSoon: boolean | null;
};
const stableId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function rankCandidates(
  candidates: Archetype[],
  preferences: Preferences,
  priors: Preferences = {},
  category: string | null = null,
): Ranked[] {
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new Error("Duplicate candidate IDs");
  const scored = candidates
    .map((candidate) => {
      let total = 0,
        evidence = 0;
      for (const dimension of dimensions) {
        const current = preferences[dimension];
        const preference =
          current && current.state !== "unknown" ? current : priors[dimension];
        const feature = candidate.features[dimension];
        if (
          !preference ||
          preference.state === "neutral" ||
          preference.value === null ||
          !feature ||
          feature.value === null ||
          feature.confidence === 0
        )
          continue;
        if (
          ![
            preference.value,
            feature.value,
            feature.confidence,
            preference.strength,
          ].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
        )
          throw new Error("Invalid scoring input");
        const strength =
          preference.state === "inferred"
            ? Math.min(0.25, preference.strength)
            : preference.strength;
        const weight = strength * feature.confidence;
        const utility =
          dimension === "distanceTolerance"
            ? 1 - feature.value * (1 - preference.value)
            : dimension === "price"
              ? 1 - Math.max(0, feature.value - preference.value)
              : 1 - Math.abs(preference.value - feature.value);
        total += weight * utility;
        evidence += weight;
      }
      // One categorical observation, not a fabricated numeric cuisine dimension.
      if (category && candidate.categoryId) {
        total += candidate.categoryId === category ? 1 : 0;
        evidence += 1;
      }
      return {
        id: candidate.id,
        score: evidence ? total / evidence : 0.5,
        distance: candidate.distanceM ?? Infinity,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.distance - b.distance || stableId(a.id, b.id),
    );
  const max = scored[0]?.score ?? 0;
  const weights = scored.map((c) => Math.exp((c.score - max) / 0.25));
  const sum = weights.reduce((a, b) => a + b, 0);
  return scored.map((c, i) => ({
    id: c.id,
    score: c.score,
    weight: weights[i] / sum,
  }));
}
export function usefulDimensions(
  candidates: Archetype[],
  ranked: Ranked[],
  preferences: Preferences,
  asked: Set<Dimension>,
  context: EngineContext,
) {
  const top = ranked.slice(0, 5);
  return dimensions
    .flatMap((dimension) => {
      const state = preferences[dimension]?.state ?? "unknown";
      if (asked.has(dimension) || state === "answered" || state === "neutral")
        return [];
      const known = top.flatMap((r) => {
        const feature = candidates.find((c) => c.id === r.id)?.features[
          dimension
        ];
        return feature && feature.value !== null && feature.confidence > 0
          ? [{ value: feature.value, weight: r.weight }]
          : [];
      });
      if (known.length < 2) return [];
      const mass = known.reduce((a, b) => a + b.weight, 0);
      if (mass <= 0) return [];
      const mean = known.reduce((a, b) => a + b.value * b.weight, 0) / mass;
      const variance =
        known.reduce((a, b) => a + b.weight * (b.value - mean) ** 2, 0) / mass;
      const relevance =
        (dimension === "distanceTolerance" && context.rain) ||
        (dimension === "speed" && context.nextEventSoon)
          ? 1.5
          : 1;
      const score = variance * relevance * (state === "inferred" ? 0.75 : 1);
      return score > 1e-9 ? [{ dimension, score }] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score || stableId(`${a.dimension}-01`, `${b.dimension}-01`),
    );
}
export function categoryPreference(
  session: Pick<DecisionSession, "questions" | "answers">,
): string | null {
  const answer = session.answers.find((a) => a.action === "category");
  if (!answer) return null;
  return (
    session.questions
      .find((q) => q.instanceId === answer.questionInstanceId)
      ?.definition.options.find((o) => o.id === answer.optionId)?.categoryId ??
    null
  );
}
export function stopReason(
  count: number,
  ranked: Ranked[],
  hasQuestion: boolean,
  userRequested = false,
): DecisionSession["decision"]["stopReason"] {
  if (userRequested) return "user_requested";
  if (count >= 6) return "max_questions";
  if (
    count >= 3 &&
    (ranked[0]?.weight ?? 0) >= 0.7 &&
    (ranked[0]?.weight ?? 0) - (ranked[1]?.weight ?? 0) >= 0.2
  )
    return "weight_margin";
  return hasQuestion ? null : "exhausted";
}
export function nextQuestion(
  session: Pick<DecisionSession, "questions" | "answers" | "preferences">,
  candidates: Archetype[],
  ranked: Ranked[],
  context: EngineContext,
): QuestionDefinition | null {
  const asked = new Set(
    session.questions.flatMap((q) =>
      q.definition.dimensionId ? [q.definition.dimensionId] : [],
    ),
  );
  const useful = usefulDimensions(
    candidates,
    ranked,
    session.preferences,
    asked,
    context,
  );
  const binaryAnswers = session.answers.filter(
    (a) =>
      session.questions.find((q) => q.instanceId === a.questionInstanceId)
        ?.definition.kind === "binary",
  ).length;
  const masses = new Map<string, number>();
  for (const rank of ranked.slice(0, 5)) {
    const category = candidates.find((c) => c.id === rank.id)?.categoryId;
    if (category && categories[category])
      masses.set(category, (masses.get(category) ?? 0) + rank.weight);
  }
  const total = [...masses.values()].reduce((a, b) => a + b, 0);
  // Conservative category exception: no category dominates and top two candidates are close.
  if (
    binaryAnswers >= 2 &&
    !session.questions.some((q) => q.definition.kind === "category") &&
    masses.size >= 2 &&
    Math.max(...masses.values()) / total <= 0.55 &&
    ranked[0].weight - (ranked[1]?.weight ?? 0) < 0.1
  ) {
    return {
      ...categoryTemplate,
      options: [...masses.keys()]
        .sort(stableId)
        .map((id) => ({ id, categoryId: id, label: categories[id] })),
    };
  }
  return useful[0]
    ? binaryTemplate(useful[0].dimension, context.rain === true)
    : null;
}
