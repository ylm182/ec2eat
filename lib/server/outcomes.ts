import "server-only";
import { prepareLearning } from "./learning";
import { assertDataActive } from "./data-guard";
import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  idSchema,
  sessionSchema,
  type DecisionSession,
} from "../domain/schema";
import { validateTransition } from "../domain/transitions";
import {
  outcomeInput,
  openingInput,
  canConfirm,
  canPrompt,
} from "../outcomes/contracts";
import { historySnapshot } from "../history/schema";
import { decodeDocument, encodeDocument } from "./repository";
import type { VerifiedUser } from "./auth";
import { ApiError } from "./http";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function outcomeRepository(
  db: Firestore,
  user: VerifiedUser,
  clock: () => number = Date.now,
) {
  const root = db.collection("users").doc(idSchema.parse(user.uid));
  const sessions = root.collection("sessions");
  function parse(data: unknown, id: string) {
    if (!data) throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
    const s = sessionSchema.parse(decodeDocument(data));
    if (s.uid !== user.uid || s.id !== id)
      throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
    return s;
  }
  function sameHash(
    data: FirebaseFirestore.DocumentData | undefined,
    hash: string,
  ) {
    if (data && data.hash !== hash)
      throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
  }
  const limit = root.collection("limits").doc("outcomes");
  return {
    async open(raw: unknown) {
      const input = openingInput.parse(raw);
      const launch = root.collection("openings").doc(input.launchId);
      const op = root.collection("operations").doc(input.requestId);
      const hash = digest({ kind: "open", input });
      return db.runTransaction(async (tx) => {
        await assertDataActive(db, user.uid, tx);
        const [operation, opening] = await Promise.all([
          tx.get(op),
          tx.get(launch),
        ]);
        sameHash(operation.data(), hash);
        const now = clock();
        if (opening.exists) {
          const id = opening.data()!.sessionId as string | null;
          const snap = id ? await tx.get(sessions.doc(id)) : null;
          const s = snap?.exists ? parse(snap.data(), id!) : null;
          if (!operation.exists) {
            const budget = await tx.get(limit);
            const hour = Math.floor(now / 3600000);
            const counts =
              budget.data()?.hour === hour
                ? budget.data()!
                : { hour, opens: 0, mutations: 0 };
            if (counts.opens >= 60)
              throw new ApiError(
                429,
                "RATE_LIMITED",
                "開啟要求太多，請稍後再試。",
                true,
              );
            tx.set(limit, { ...counts, opens: counts.opens + 1 });
            tx.create(op, {
              hash,
              kind: "open",
              createdAt: Timestamp.fromMillis(now),
              expiresAt: Timestamp.fromMillis(now + 7 * 86400000),
            });
          }
          return {
            session:
              !opening.data()!.completed &&
              s &&
              canPrompt(s, input.launchId, now) &&
              s.outcome.lastPromptLaunchId === input.launchId
                ? historySnapshot(s, now)
                : null,
          };
        }
        const budget = await tx.get(limit);
        const hour = Math.floor(now / 3600000);
        const counts =
          budget.data()?.hour === hour
            ? budget.data()!
            : { hour, opens: 0, mutations: 0 };
        if (counts.opens >= 60)
          throw new ApiError(
            429,
            "RATE_LIMITED",
            "開啟要求太多，請稍後再試。",
            true,
          );
        let picked: DecisionSession | null = null;
        let anchor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
        // Scan bounded pages until the most recent eligible, unsnoozed selection is found.
        while (!picked) {
          let query = sessions
            .where("status", "==", "SELECTED")
            .where("outcome.status", "==", "PENDING")
            .where("selectedAt", "<=", Timestamp.fromMillis(now - 4 * 3600000))
            .orderBy("selectedAt", "desc")
            .limit(20);
          if (anchor) query = query.startAfter(anchor);
          const batch = await tx.get(query);
          for (const doc of batch.docs) {
            const s = parse(doc.data(), doc.id);
            if (canPrompt(s, input.launchId, now)) {
              picked = s;
              break;
            }
          }
          if (picked || batch.size < 20) break;
          anchor = batch.docs.at(-1);
        }
        if (picked) {
          const before = picked;
          picked = sessionSchema.parse({
            ...before,
            revision: before.revision + 1,
            updatedAt: new Date(now).toISOString(),
            outcome: {
              ...before.outcome,
              revision: before.outcome.revision + 1,
              lastPromptLaunchId: input.launchId,
            },
          });
          validateTransition(before, picked);
          tx.set(
            sessions.doc(picked.id),
            encodeDocument(picked) as FirebaseFirestore.DocumentData,
          );
        }
        tx.create(launch, {
          sessionId: picked?.id ?? null,
          createdAt: Timestamp.fromMillis(now),
        });
        tx.set(limit, { ...counts, opens: counts.opens + 1 });
        tx.create(op, {
          hash,
          kind: "open",
          createdAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + 7 * 86400000),
        });
        return { session: picked ? historySnapshot(picked, now) : null };
      });
    },
    async save(id: string, raw: unknown) {
      idSchema.parse(id);
      const input = outcomeInput.parse(raw);
      const op = root.collection("operations").doc(input.requestId);
      const hash = digest({ kind: "outcome", id, input });
      return db.runTransaction(async (tx) => {
        await assertDataActive(db, user.uid, tx, id);
        const operation = await tx.get(op);
        sameHash(operation.data(), hash);
        if (operation.exists) return parse(operation.data()!.response, id);
        const [saved, budget, receipt] = await Promise.all([
          tx.get(sessions.doc(id)),
          tx.get(limit),
          input.lookupRequestId
            ? tx.get(
                root.collection("actualLookups").doc(input.lookupRequestId),
              )
            : Promise.resolve(null),
        ]);
        const s = parse(saved.data(), id);
        const now = clock();
        if (
          s.revision !== input.expectedRevision ||
          s.outcome.revision !== input.expectedOutcomeRevision
        )
          throw new ApiError(
            409,
            "STALE_REVISION",
            "用餐結果已更新，請重新載入再確認。",
          );
        if (!canConfirm(s, input.launchId, now))
          throw new ApiError(
            409,
            "OUTCOME_NOT_ELIGIBLE",
            "選擇至少四小時後，喺另一次開啟先可以確認。",
          );
        if (input.snooze && s.outcome.status !== "PENDING")
          throw new ApiError(409, "INVALID_STATE", "已確認嘅結果唔可以略過。");
        if (input.actualPlaceId) {
          const lookup = receipt?.data();
          if (
            input.actualPlaceId === s.decision.selectedPlaceId ||
            !lookup ||
            lookup.sessionId !== id ||
            lookup.expiresAt.toMillis() <= now ||
            lookup.source !== s.search?.source ||
            !lookup.placeIds.includes(input.actualPlaceId)
          )
            throw new ApiError(
              422,
              "INVALID_ACTUAL_PLACE",
              "請重新搜尋實際餐廳，或者先留空。",
            );
        }
        const hour = Math.floor(now / 3600000);
        const counts =
          budget.data()?.hour === hour
            ? budget.data()!
            : { hour, opens: 0, mutations: 0 };
        if (counts.mutations >= 120)
          throw new ApiError(
            429,
            "RATE_LIMITED",
            "確認要求太多，請稍後再試。",
            true,
          );
        const outcome = input.snooze
          ? {
              ...s.outcome,
              revision: s.outcome.revision + 1,
              snoozedUntil: new Date(now + 86400000).toISOString(),
              lastPromptLaunchId: input.launchId,
            }
          : {
              ...s.outcome,
              status: input.status!,
              actualPlaceId:
                input.status === "VISITED_SELECTED"
                  ? s.decision.selectedPlaceId
                  : input.status === "VISITED_OTHER"
                    ? (input.actualPlaceId ?? null)
                    : null,
              confirmedAt: new Date(now).toISOString(),
              revision: s.outcome.revision + 1,
              snoozedUntil: null,
            };
        const next = sessionSchema.parse({
          ...s,
          revision: s.revision + 1,
          updatedAt: new Date(now).toISOString(),
          outcome,
        });
        validateTransition(s, next);
        const commitLearning = input.snooze
          ? null
          : await prepareLearning(tx, root, s, next);
        commitLearning?.();
        tx.set(
          sessions.doc(id),
          encodeDocument(next) as FirebaseFirestore.DocumentData,
        );
        const response = historySnapshot(next, now);
        tx.create(op, {
          hash,
          response: encodeDocument(response),
          createdAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + 7 * 86400000),
        });
        tx.set(limit, { ...counts, mutations: counts.mutations + 1 });
        tx.set(
          root.collection("openings").doc(input.launchId),
          { completed: true },
          { merge: true },
        );
        return response;
      });
    },
  };
}
