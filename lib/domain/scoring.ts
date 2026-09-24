import { archetypes } from "./catalog";
import { categoryPreference, nextQuestion, stopReason } from "./engine";
import { engineContext } from "./session";
import {
  sessionSchema,
  unknownPreferences,
  type DecisionSession,
} from "./schema";
import type { DecisionInput, DecisionResult } from "../providers/contracts";
export function scoringInput(session: DecisionSession): DecisionInput {
  return {
    version: 1,
    stage: "archetype",
    candidates: archetypes.map(({ id, features, categoryId }) => ({
      id,
      features,
      ...(categoryId ? { categoryId } : {}),
    })),
    preferences: { ...unknownPreferences(), ...session.preferences },
    priors: {},
    categoryPreference: categoryPreference(session),
    context: engineContext(session),
  };
}
// Apply only to an uncommitted draft. The original issued/answered trail is retained verbatim.
export function applyScoring(
  draft: DecisionSession,
  result: DecisionResult,
): DecisionSession {
  const next = structuredClone(draft);
  if (next.questions.length > next.answers.length) next.questions.pop();
  next.decision.provider = result.provider;
  next.decision.modelRevision = result.revision;
  next.decision.confidence = result.confidence;
  next.decision.confidenceKind = result.confidenceKind;
  next.decision.fallbackReason = result.fallbackReason;
  const question = nextQuestion(
    next,
    archetypes,
    result.entries,
    engineContext(next),
  );
  const reason = stopReason(
    next.answers.length,
    result.entries,
    Boolean(question),
  );
  next.decision.stopReason = reason;
  next.status = reason ? "RECOMMENDING" : "QUESTIONING";
  if (!reason && question)
    next.questions.push({
      instanceId: `${next.id}-q${next.questions.length + 1}`,
      definition: question,
      issuedAt: next.updatedAt,
    });
  return sessionSchema.parse(next);
}
