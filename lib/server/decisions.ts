import "server-only";
import { createHash } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";
import {
  answerInput,
  createSessionInput,
  idSchema,
  preferenceSchema,
  sessionSchema,
  unknownPreferences,
  dimensions,
  type DecisionSession,
} from "../domain/schema";
import {
  applyAnswer,
  newSession,
  requestOptions,
  SessionError,
} from "../domain/session";
import { validateTransition } from "../domain/transitions";
import type { VerifiedUser } from "./auth";
import { ApiError } from "./http";
import { decodeDocument, encodeDocument } from "./repository";
export const recommendInput = z
  .object({
    requestId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    reason: z.enum(["automatic", "user_requested"]),
    expandArea: z.boolean().optional(),
  })
  .strict();
import {
  collectContext,
  contextDependencies,
  type ContextDependencies,
} from "./context";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function decisionRepository(
  db: Firestore,
  user: VerifiedUser,
  dependencies?: ContextDependencies,
) {
  const uid = idSchema.parse(user.uid);
  const root = db.collection("users").doc(uid);
  async function mutate(
    kind: "create" | "answer" | "recommend",
    raw: unknown,
    sessionId?: string,
  ) {
    const input =
      kind === "create"
        ? createSessionInput.parse(raw)
        : kind === "answer"
          ? answerInput.parse(raw)
          : recommendInput.parse(raw);
    const requestId = input.requestId;
    const hash = digest({ kind, sessionId: sessionId ?? null, input });
    const id = sessionId
      ? idSchema.parse(sessionId)
      : digest({ uid, requestId }).slice(0, 32);
    const ref = root.collection("sessions").doc(id);
    const op = root.collection("operations").doc(requestId);
    const limit = root.collection("limits").doc("decisions");
    let context: DecisionSession["context"] | undefined;
    if (kind === "create") {
      // Fast replay avoids optional API calls; the transaction rechecks the hash and budget.
      const existing = await op.get();
      if (existing.exists) {
        if (existing.data()!.hash !== hash)
          throw new ApiError(
            409,
            "REQUEST_ID_REUSED",
            "同一要求編號唔可以改答案。",
          );
        return sessionSchema.parse(decodeDocument(existing.data()!.response));
      }
      const budget = (await limit.get()).data();
      if (
        budget?.hour === Math.floor(Date.now() / 3600000) &&
        (budget.creates >= 30 || budget.mutations >= 240)
      )
        throw new ApiError(
          429,
          "RATE_LIMITED",
          "今個鐘嘅要求太多，請稍後再試。",
          true,
        );
      context = await collectContext(
        uid,
        createSessionInput.parse(input),
        dependencies ?? contextDependencies(db),
      );
    }
    await db.runTransaction(async (tx) => {
      const previous = await tx.get(op);
      if (previous.exists) {
        if (previous.data()!.hash !== hash)
          throw new ApiError(
            409,
            "REQUEST_ID_REUSED",
            "同一要求編號唔可以改答案。",
          );
        return;
      }
      const [saved, budget, profile] = await Promise.all([
        tx.get(ref),
        tx.get(limit),
        tx.get(root),
      ]);
      const now = Timestamp.now();
      const time = now.toDate().toISOString();
      const hour = Math.floor(now.toMillis() / 3600000);
      const counts =
        budget.data()?.hour === hour
          ? budget.data()!
          : { hour, creates: 0, mutations: 0 };
      if (
        counts.mutations >= 240 ||
        (kind === "create" && counts.creates >= 30)
      )
        throw new ApiError(
          429,
          "RATE_LIMITED",
          "今個鐘嘅要求太多，請稍後再試。",
          true,
        );
      let next: DecisionSession;
      if (kind === "create") {
        if (saved.exists)
          throw new ApiError(
            409,
            "SESSION_ALREADY_EXISTS",
            "呢個要求已建立過選擇，請載入原有記錄。",
          );
        const start = createSessionInput.parse(input);
        const preferences = unknownPreferences();
        for (const dimension of dimensions) {
          const prior = preferenceSchema.safeParse(
            profile.data()?.priors?.[dimension],
          );
          if (prior.success && prior.data.state === "inferred")
            preferences[dimension] = prior.data;
        }
        const priorVersion =
          typeof profile.data()?.priorVersion === "string"
            ? profile.data()!.priorVersion
            : "initial";
        next = newSession({
          id,
          uid,
          launchId: start.launchId,
          area: context!.area,
          context,
          now: time,
          preferences,
          priorVersion,
        });
      } else {
        if (!saved.exists)
          throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
        const before = sessionSchema.parse(decodeDocument(saved.data()));
        if (before.uid !== uid || before.id !== id)
          throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
        try {
          if (kind === "answer")
            next = applyAnswer(before, answerInput.parse(input), time);
          else {
            const stop = recommendInput.parse(input);
            if (stop.expandArea)
              throw new ApiError(
                503,
                "PLACES_NOT_CONFIGURED",
                "餐廳搜尋未接通，暫時未能擴大範圍。",
                true,
              );
            next = requestOptions(
              before,
              stop.expectedRevision,
              stop.reason,
              time,
            );
          }
        } catch (error) {
          if (error instanceof SessionError)
            throw new ApiError(
              error.code === "INVALID_ANSWER" ? 422 : 409,
              error.code,
              error.message,
            );
          throw error;
        }
        validateTransition(before, next);
      }
      const document = encodeDocument(next) as Record<string, unknown>;
      // Commit timestamps and the replay snapshot resolve in the same Firestore commit.
      document.updatedAt = FieldValue.serverTimestamp();
      if (kind === "create") document.createdAt = FieldValue.serverTimestamp();
      tx.set(ref, document);
      tx.create(op, {
        hash,
        response: document,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 86400000),
      });
      tx.set(limit, {
        hour,
        creates: counts.creates + (kind === "create" ? 1 : 0),
        mutations: counts.mutations + 1,
      });
      if (!profile.exists)
        tx.create(root, {
          timezone: "Asia/Hong_Kong",
          priorVersion: "initial",
          calendarConnected: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    });
    // Read resolved server timestamps from the immutable response, not a newer session revision.
    return sessionSchema.parse(
      decodeDocument((await op.get()).data()!.response),
    );
  }
  return {
    create: (input: unknown) => mutate("create", input),
    answer: (id: string, input: unknown) => mutate("answer", input, id),
    recommend: (id: string, input: unknown) => mutate("recommend", input, id),
  };
}
