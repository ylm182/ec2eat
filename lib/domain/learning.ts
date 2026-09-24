import { dimensions, unknownPreferences, type DecisionSession } from "./schema";
export const LEARNING_VERSION = "recent-20-v1";
/** Only issued directional answers are evidence, never inherited preferences. */
export function derivePriors(sessions: DecisionSession[]) {
  const window = sessions
    .filter(
      (s) => s.status === "SELECTED" && s.outcome.status === "VISITED_SELECTED",
    )
    .sort(
      (a, b) =>
        Date.parse(b.selectedAt!) - Date.parse(a.selectedAt!) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .slice(0, 20);
  const priors = unknownPreferences();
  for (const dimension of dimensions) {
    const values = window.flatMap((s) =>
      s.answers.flatMap((a) => {
        const q = s.questions.find(
          (q) => q.instanceId === a.questionInstanceId,
        )?.definition;
        return q?.dimensionId === dimension &&
          (a.action === "left" || a.action === "right") &&
          a.value !== null
          ? [a.value]
          : [];
      }),
    );
    if (values.length)
      priors[dimension] = {
        state: "inferred",
        value: values.reduce((a, b) => a + b, 0) / values.length,
        strength: Math.min(0.25, (0.25 * values.length) / 20),
      };
  }
  return {
    priors,
    learningSourceSessionIds: window.map((s) => s.id),
    learningAlgorithm: LEARNING_VERSION,
  };
}
