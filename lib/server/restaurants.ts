import "server-only";
import { configuredRoutes, restaurantEnrichment } from "./restaurant-enrichment";
import { travelLimits } from "../restaurants/travel";
import { prepareLearning } from "./learning";
import { assertDataActive } from "./data-guard";
import { createHash, randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import {
  idSchema,
  sessionSchema,
  type DecisionSession,
} from "../domain/schema";
import { validateTransition } from "../domain/transitions";
import { resolveLocation } from "../context/location";
import { bounded } from "../providers/google-context";
import {
  placeIdSchema,
  selectable,
  type RestaurantProvider,
  type RestaurantCard,
} from "../restaurants/types";
import { searchRestaurants } from "../restaurants/search";
import type { VerifiedUser } from "./auth";
import { ApiError } from "./http";
import { encodeDocument, decodeDocument } from "./repository";
import { decisionRepository, recommendInput } from "./decisions";
import { placesProvider } from "./places";
import { layaService } from "./laya";
export const selectInput = z
  .object({
    requestId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    placeId: placeIdSchema,
    launchId: idSchema,
  })
  .strict();
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function restaurantRepository(
  db: Firestore,
  user: VerifiedUser,
  provider: () => RestaurantProvider = placesProvider,
) {
  const root = db.collection("users").doc(idSchema.parse(user.uid));
  const ref = (id: string) =>
    root.collection("sessions").doc(idSchema.parse(id));
  function parse(data: unknown, id: string) {
    const s = sessionSchema.parse(decodeDocument(data));
    if (s.uid !== user.uid || s.id !== id)
      throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
    return s;
  }
  async function get(id: string) {
    await assertDataActive(db, user.uid, undefined, id);
    const snap = await ref(id).get();
    if (!snap.exists) throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
    return parse(snap.data(), id);
  }
  async function budget() {
    const limit = root.collection("limits").doc("places");
    await db.runTransaction(async (tx) => {
      await assertDataActive(db, user.uid, tx);
      const data = (await tx.get(limit)).data();
      const hour = Math.floor(Date.now() / 3600000);
      const count = data?.hour === hour ? data.count : 0;
      if (count >= 120)
        throw new ApiError(
          429,
          "RATE_LIMITED",
          "餐廳查詢太多，請稍後再試。",
          true,
        );
      tx.set(limit, { hour, count: count + 1 });
    });
  }
  function matchingProvider(s: DecisionSession) {
    const p = provider();
    if (s.search && s.search.source !== p.source)
      throw new ApiError(
        503,
        "PLACES_SOURCE_CHANGED",
        "資料來源已更改，請開始另一次選擇。",
      );
    return p;
  }
  return {
    async recommend(id: string, raw: unknown) {
      await assertDataActive(db, user.uid, undefined, id);
      const input = recommendInput.parse(raw);
      const op = root.collection("restaurantOperations").doc(input.requestId);
      const digest = hash({ id, input });
      const replay = await op.get();
      if (replay.exists && replay.data()!.hash !== digest)
        throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
      if (replay.data()?.response) return parse(replay.data()!.response, id);
      const current = await get(id);
      if (
        input.expandArea &&
        (current.context.travelChoice || !current.search ||
          current.search.result !== "empty" ||
          current.search.expanded || current.search.radiusM >= 10000)
      )
        throw new ApiError(
          409,
          "INVALID_EXPANSION",
          "只有未有結果時可以擴大一次範圍。",
        );
      let centre: ReturnType<typeof resolveLocation>;
      try {
        centre = resolveLocation(
          input.location
            ? { location: input.location }
            : { area: current.context.area },
        );
      } catch {
        throw new ApiError(422, "INVALID_LOCATION", "請選擇香港地區。");
      }
      if (centre.area !== current.context.area)
        throw new ApiError(
          422,
          "LOCATION_CHANGED",
          "地區已改變，請開始另一次選擇。",
        );
      const stopped = await decisionRepository(db, user).recommend(id, input);
      const owner = randomUUID();
      const claimed = await db.runTransaction(async (tx) => {
        await assertDataActive(db, user.uid, tx, id);
        const [operation, saved] = await Promise.all([
          tx.get(op),
          tx.get(ref(id)),
        ]);
        const data = operation.data();
        if (data && data.hash !== digest)
          throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
        if (data?.response) return parse(data.response, id);
        if (data?.leaseUntil?.toMillis() > Date.now())
          throw new ApiError(409, "IN_PROGRESS", "搜尋中，請稍後重試。", true);
        const before = parse(saved.data(), id);
        if (
          before.revision !== stopped.revision ||
          before.status !== "RECOMMENDING"
        )
          throw new ApiError(409, "STALE_REVISION", "選擇已更新，請重新載入。");
        tx.set(op, {
          hash: digest,
          sessionId: id,
          owner,
          leaseUntil: Timestamp.fromMillis(Date.now() + 240000),
          expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
        });
        return null;
      });
      if (claimed) return claimed;
      try {
        const p = matchingProvider(stopped);
        await budget();
        const distance = stopped.preferences.distanceTolerance;
        const base =
          (stopped.context.travelChoice ? travelLimits[stopped.context.travelChoice].radiusM : undefined) ?? stopped.context.searchRadiusM ??
          (distance?.state === "answered" && distance.value >= 0.8 ? 5000 : 1500);
        const radius = input.expandArea
          ? stopped.search!.radiusM < 5000
            ? 5000
            : 10000
          : (stopped.search?.radiusM ?? base);
        const found = await bounded(210000, (signal) =>
          searchRestaurants(
            stopped,
            centre.location,
            radius,
            p,
            (i, s) => layaService(db).rank(i, s),
            signal,
            restaurantEnrichment(p, Boolean(stopped.context.travelChoice)),
          ),
        );
        const committed = await db.runTransaction(async (tx) => {
          await assertDataActive(db, user.uid, tx, id);
          const [operation, saved] = await Promise.all([
            tx.get(op),
            tx.get(ref(id)),
          ]);
          if (operation.data()?.response)
            return parse(operation.data()!.response, id);
          if (operation.data()?.owner !== owner)
            throw new ApiError(409, "IN_PROGRESS", "搜尋已更新。", true);
          const before = parse(saved.data(), id);
          if (before.revision !== stopped.revision)
            throw new ApiError(
              409,
              "STALE_REVISION",
              "選擇已更新，請重新載入。",
            );
          const next = sessionSchema.parse({
            ...before,
            revision: before.revision + 1,
            updatedAt: new Date().toISOString(),
            status: found.candidates.length ? "READY" : "RECOMMENDING",
            search: {
              radiusM: radius,
              expanded: input.expandArea || stopped.search?.expanded || false,
              result: found.candidates.length ? "ready" : "empty",
              source: p.source,
              centreSource: centre.source,
            },
            decision: {
              ...before.decision,
              candidates: found.candidates,
              recommendedPlaceId: found.candidates[0]?.placeId ?? null,
              provider: found.result.provider,
              modelRevision: found.result.revision,
              confidence: found.result.confidence,
              confidenceKind: found.result.confidenceKind,
              fallbackReason: found.result.fallbackReason,
              reason: stopped.context.travelChoice ? "按行程時間篩選，再依餐廳資料及偏好排序。" : "按可用距離及價格資料排序；未確認口味特徵。",
            },
          });
          validateTransition(before, next);
          const document = encodeDocument(next);
          tx.set(ref(id), document as FirebaseFirestore.DocumentData);
          tx.update(op, {
            response: document,
            leaseUntil: Timestamp.fromMillis(0),
          });
          return next;
        });
        // Provider-derived text stays response-only, outside durable session/replay documents.
        return found.restaurantSummaries.length ? { ...committed, restaurantSummaries: found.restaurantSummaries.filter(x => committed.decision.candidates.some(c => c.placeId === x.placeId)) } : committed;
      } catch (error) {
        await db.runTransaction(async (tx) => {
          await assertDataActive(db, user.uid, tx);
          const snap = await tx.get(op);
          if (snap.data()?.owner === owner && !snap.data()?.response)
            tx.update(op, { leaseUntil: Timestamp.fromMillis(0) });
        });
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && ["ROUTES_NOT_CONFIGURED", "ROUTES_UNAVAILABLE"].includes(error.message))
          throw new ApiError(503, error.message, "暫時未能核對行程時間，請稍後重試。", true);
        throw new ApiError(
          503,
          "PLACES_UNAVAILABLE",
          "答案已儲存；餐廳搜尋暫時失敗，請重試。",
          true,
        );
      }
    },
    async travel(id: string, location?: { latitude: number; longitude: number }) {
      const s = await get(id);
      if (!["READY", "SELECTED"].includes(s.status)) throw new ApiError(409, "INVALID_STATE", "請先完成餐廳搜尋。");
      const p = matchingProvider(s);
      if (p.source !== "google-places") return { routes: [], originSource: "manual" };
      const origin = resolveLocation(location ? { location } : { area: s.context.area });
      await budget();
      const ids = s.decision.candidates.filter(c => s.status !== "SELECTED" || c.placeId === s.decision.selectedPlaceId).slice(0, 10).map(c => c.placeId);
      const provider = configuredRoutes();
      const modes = await Promise.allSettled([
        bounded(10000, signal => provider.matrix(origin.location, ids, "WALK", signal)),
        s.context.travelChoice === "drive20" ? bounded(10000, signal => provider.matrix(origin.location, ids, "DRIVE", signal)) : Promise.resolve(new Map()),
      ]);
      return { originSource: origin.source, routes: ids.map(placeId => ({ placeId,
        walking: modes[0].status === "fulfilled" ? modes[0].value.get(placeId) ?? null : null,
        driving: modes[1].status === "fulfilled" ? modes[1].value.get(placeId) ?? null : null,
      })) };
    },
    async cards(id: string, selectedOnly: boolean | "ranking" = false) {
      const s = await get(id);
      if (selectedOnly && s.status !== "SELECTED")
        throw new ApiError(404, "NOT_FOUND", "搵唔到呢次已儲存選擇。");
      if (!["READY", "SELECTED"].includes(s.status)) return { cards: [] };
      const p = matchingProvider(s);
      await budget();
      const cards = await Promise.all(
        s.decision.candidates
          .filter(
            (c) => selectedOnly !== true || c.placeId === s.decision.selectedPlaceId,
          )
          .slice(0, selectedOnly === true ? 1 : 10)
          .map(async (c) => {
            try {
              return await bounded(5000, (signal) =>
                p.details(
                  c.placeId,
                  signal,
                  selectedOnly !== "ranking",
                  resolveLocation({ area: s.context.area }).location,
                ),
              );
            } catch {
              return {
                distanceM: null,
                placeId: c.placeId,
                name: null,
                address: null,
                businessStatus: null,
                openNow: null,
                priceLevel: null,
                rating: null,
                mapsUri: null,
                photo: null,
                attributions: [],
                available: false,
                fetchedAt: new Date().toISOString(),
                source: p.source,
                persistAllowed: false,
                modelInputAllowed: false,
              } satisfies RestaurantCard;
            }
          }),
      );
      return { cards };
    },
    async select(id: string, raw: unknown) {
      await assertDataActive(db, user.uid, undefined, id);
      const input = selectInput.parse(raw);
      const op = root.collection("operations").doc(input.requestId);
      const digest = hash({ kind: "select", id, input });
      const replay = await op.get();
      if (replay.exists) {
        if (replay.data()!.hash !== digest)
          throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
        return parse(replay.data()!.response, id);
      }
      const before = await get(id);
      function validate(s: DecisionSession) {
        if (s.revision !== input.expectedRevision)
          throw new ApiError(409, "STALE_REVISION", "選擇已更新，請重新載入。");
        if (
          s.status !== "READY" ||
          !s.decision.candidates.some((c) => c.placeId === input.placeId)
        )
          throw new ApiError(
            422,
            "INVALID_SELECTION",
            "請選擇今次清單內嘅餐廳。",
          );
      }
      try {
        validate(before);
      } catch (error) {
        const retry = await op.get();
        if (retry.exists && retry.data()!.hash === digest)
          return parse(retry.data()!.response, id);
        throw error;
      }
      const p = matchingProvider(before);
      await budget();
      let card: RestaurantCard;
      try {
        card = await bounded(5000, (signal) =>
          p.details(input.placeId, signal, false),
        );
      } catch {
        throw new ApiError(
          503,
          "DETAILS_UNAVAILABLE",
          "未能確認餐廳資料，請重試。",
          true,
        );
      }
      if (
        !card.available ||
        card.placeId !== input.placeId ||
        !selectable(card)
      )
        throw new ApiError(
          409,
          "PLACE_CLOSED",
          "餐廳目前不可選擇，請揀另一間。",
        );
      return db.runTransaction(async (tx) => {
        await assertDataActive(db, user.uid, tx, id);
        const [operation, saved] = await Promise.all([
          tx.get(op),
          tx.get(ref(id)),
        ]);
        if (operation.exists) {
          if (operation.data()!.hash !== digest)
            throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
          return parse(operation.data()!.response, id);
        }
        const s = parse(saved.data(), id);
        validate(s);
        const now = Timestamp.now();
        const next = sessionSchema.parse({
          ...s,
          revision: s.revision + 1,
          status: "SELECTED",
          updatedAt: now.toDate().toISOString(),
          selectedAt: now.toDate().toISOString(),
          selectionLaunchId: input.launchId,
          decision: { ...s.decision, selectedPlaceId: input.placeId },
          outcome: {
            ...s.outcome,
            eligibleAfter: new Date(now.toMillis() + 4 * 3600000).toISOString(),
          },
        });
        validateTransition(s, next);
        const commitLearning = await prepareLearning(tx, root, s, next);
        commitLearning();
        const doc = encodeDocument(next);
        tx.set(ref(id), doc as FirebaseFirestore.DocumentData);
        tx.create(op, {
          hash: digest,
          response: doc,
          createdAt: now,
          expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 86400000),
        });
        return next;
      });
    },
  };
}
