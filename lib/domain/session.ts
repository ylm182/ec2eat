import { archetypes, CATALOG_VERSION, ENGINE_VERSION } from "./catalog";
import {
  categoryPreference,
  nextQuestion,
  rankCandidates,
  stopReason,
  type EngineContext,
} from "./engine";
import {
  sessionSchema,
  unknownPreferences,
  type DecisionSession,
} from "./schema";
import type { z } from "zod";
import type { answerInput } from "./schema";
export class SessionError extends Error {
  constructor(
    public code: "INVALID_STATE" | "INVALID_ANSWER" | "STALE_REVISION",
    message: string,
  ) {
    super(message);
  }
}
export function engineContext(session: DecisionSession): EngineContext {
  return {
    rain:
      session.context.weather && session.context.weather.condition !== "UNKNOWN"
        ? /rain|drizzle|shower|thunderstorm|雨/i.test(session.context.weather.condition)
        : null,
    nextEventSoon: session.context.calendar?.nextEventSoon ?? null,
  };
}
function advance(session: DecisionSession, now: string): DecisionSession {
  const ranked = rankCandidates(
    archetypes,
    session.preferences,
    {},
    categoryPreference(session),
  );
  const question = nextQuestion(
    session,
    archetypes,
    ranked,
    engineContext(session),
  );
  const reason = stopReason(session.answers.length, ranked, Boolean(question));
  session.decision.stopReason = reason;
  if (reason) session.status = "RECOMMENDING";
  else if (question)
    session.questions.push({
      instanceId: `${session.id}-q${session.questions.length + 1}`,
      definition: question,
      issuedAt: now,
    });
  return sessionSchema.parse(session);
}
export function newSession(input: {
  id: string;
  uid: string;
  launchId: string;
  area: string;
  now: string;
  priorVersion?: string;
  preferences?: DecisionSession["preferences"];
  context?: DecisionSession["context"];
}): DecisionSession {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(input.now)),
  );
  const preferences = structuredClone(
    input.preferences ?? unknownPreferences(),
  );
  // Context is weak evidence and never replaces explicit or neutral answers.
  if (
    input.context?.calendar?.socialHint === true &&
    (!preferences.social || preferences.social.state === "unknown")
  )
    preferences.social = { state: "inferred", value: 0.8, strength: 0.15 };
  return advance(
    {
      schemaVersion: 1,
      id: input.id,
      uid: input.uid,
      revision: 0,
      status: "QUESTIONING",
      createdAt: input.now,
      updatedAt: input.now,
      selectedAt: null,
      launchId: input.launchId,
      selectionLaunchId: null,
      catalogVersion: CATALOG_VERSION,
      engineVersion: ENGINE_VERSION,
      priorVersion: input.priorVersion ?? "initial",
      context: input.context ?? {
        capturedAt: input.now,
        timezone: "Asia/Hong_Kong",
        meal:
          hour >= 11 && hour < 15
            ? "lunch"
            : hour >= 17 && hour < 22
              ? "dinner"
              : "other",
        area: input.area,
        locationSource: "manual",
        weather: null,
        calendar: null,
        availability: {
          weather: "absent",
          calendar: "absent",
          location: "absent",
        },
      },
      preferences,
      questions: [],
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
        fallbackReason: "laya_not_configured",
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
    },
    input.now,
  );
}
export function applyAnswer(
  before: DecisionSession,
  input: z.infer<typeof answerInput>,
  now: string,
): DecisionSession {
  if (before.revision !== input.expectedRevision)
    throw new SessionError("STALE_REVISION", "頁面已更新，請重新載入。");
  if (
    before.status !== "QUESTIONING" ||
    before.engineVersion !== ENGINE_VERSION ||
    before.catalogVersion !== CATALOG_VERSION
  )
    throw new SessionError("INVALID_STATE", "呢次問題已結束或版本已更新。");
  const issued = before.questions.at(-1);
  if (
    !issued ||
    issued.instanceId !== input.questionInstanceId ||
    before.answers.some((a) => a.questionInstanceId === issued.instanceId)
  )
    throw new SessionError("INVALID_STATE", "只可以回答目前未答嘅問題。");
  const definition = issued.definition;
  const option = definition.options.find((o) => o.id === input.optionId);
  if (
    input.action === "neutral"
      ? input.optionId !== undefined
      : !option ||
        (definition.kind === "binary"
          ? input.action !== option.id
          : input.action !== "category")
  )
    throw new SessionError("INVALID_ANSWER", "答案唔符合目前問題。");
  const next = structuredClone(before);
  const value =
    input.action === "neutral" || definition.kind === "category"
      ? null
      : option!.value!;
  next.answers.push({
    questionInstanceId: issued.instanceId,
    action: input.action,
    optionId: input.action === "neutral" ? null : option!.id,
    value,
    answeredAt: now,
    requestId: input.requestId,
  });
  if (definition.dimensionId)
    next.preferences[definition.dimensionId] =
      input.action === "neutral"
        ? { state: "neutral", value: null, strength: 0 }
        : { state: "answered", value: value!, strength: 1 };
  next.revision++;
  next.updatedAt = now;
  return advance(next, now);
}
export function requestOptions(
  before: DecisionSession,
  expectedRevision: number,
  reason: "automatic" | "user_requested",
  now: string,
) {
  if (before.revision !== expectedRevision)
    throw new SessionError("STALE_REVISION", "頁面已更新，請重新載入。");
  if (!["QUESTIONING", "RECOMMENDING"].includes(before.status))
    throw new SessionError("INVALID_STATE", "呢次選擇已結束。");
  if (reason === "automatic" && before.status === "QUESTIONING")
    throw new SessionError("INVALID_STATE", "未到自動停止條件。");
  const next = structuredClone(before);
  if (next.status === "QUESTIONING") {
    next.status = "RECOMMENDING";
    next.decision.stopReason = "user_requested";
  }
  next.revision++;
  next.updatedAt = now;
  return sessionSchema.parse(next);
}
