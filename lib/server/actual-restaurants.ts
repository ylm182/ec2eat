import "server-only";
import { assertDataActive } from "./data-guard";
import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { actualSearchInput, canConfirm } from "../outcomes/contracts";
import { bounded } from "../providers/google-context";
import { placesProvider } from "./places";
import type { RestaurantProvider, RestaurantCard } from "../restaurants/types";
import { userRepository } from "./repository";
import { ApiError } from "./http";
import type { VerifiedUser } from "./auth";
export async function searchActualRestaurants(
  db: Firestore,
  user: VerifiedUser,
  raw: unknown,
  provider: () => RestaurantProvider = placesProvider,
  clock: () => number = Date.now,
) {
  const input = actualSearchInput.parse(raw);
  const session = await userRepository(db, user).session(input.sessionId);
  if (!canConfirm(session, input.launchId, clock()))
    throw new ApiError(409, "OUTCOME_NOT_ELIGIBLE", "未到確認時間。");
  const p = provider();
  if (p.source !== session.search?.source)
    throw new ApiError(
      503,
      "PLACES_SOURCE_CHANGED",
      "餐廳資料來源不可用；實際餐廳可以留空。",
    );
  const root = db.collection("users").doc(user.uid);
  const limit = root.collection("limits").doc("actualSearch");
  const op = root.collection("operations").doc(input.requestId);
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind: "actual-search", input }))
    .digest("hex");
  await db.runTransaction(async (tx) => {
    await assertDataActive(db, user.uid, tx, input.sessionId);
    const [budget, operation] = await Promise.all([tx.get(limit), tx.get(op)]);
    if (operation.exists && operation.data()!.hash !== hash)
      throw new ApiError(409, "REQUEST_ID_REUSED", "要求編號已使用。");
    const hour = Math.floor(clock() / 3600000);
    const count = budget.data()?.hour === hour ? budget.data()!.count : 0;
    if (count >= 30)
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "搜尋太多，可以先唔填餐廳，稍後再補。",
        true,
      );
    tx.set(limit, { hour, count: count + 1 });
    if (!operation.exists)
      tx.create(op, {
        hash,
        kind: "actual-search",
        sessionId: input.sessionId,
        expiresAt: Timestamp.fromMillis(clock() + 7 * 86400000),
      });
  });
  const receiptRef = root.collection("actualLookups").doc(input.requestId);
  async function display(ids: string[], signal: AbortSignal) {
    const values = await Promise.all(
      ids.map(async (id) => {
        try {
          const card = await bounded(
            4000,
            (s) => p.details(id, s, false),
            signal,
          );
          return card.placeId === id ? card : null;
        } catch {
          return null;
        }
      }),
    );
    return values.filter((v): v is RestaurantCard => v !== null && v.available);
  }
  function validReceipt(data: FirebaseFirestore.DocumentData) {
    if (
      data.hash !== hash ||
      data.sessionId !== session.id ||
      data.source !== p.source ||
      data.expiresAt.toMillis() <= clock()
    )
      throw new ApiError(
        422,
        "LOOKUP_EXPIRED",
        "搜尋結果已過期，請重新搜尋或先留空。",
      );
    return data.placeIds as string[];
  }
  try {
    const previous = await receiptRef.get();
    if (previous.exists)
      return {
        cards: await bounded(4000, (signal) =>
          display(validReceipt(previous.data()!), signal),
        ),
        lookupRequestId: input.requestId,
      };
    const cards = await bounded(8000, async (signal) => {
      // Bias and bound to Hong Kong; current closure does not invalidate a past visit.
      const found = await bounded(
        3500,
        (s) =>
          p.text(
            input.query,
            { latitude: 22.3193, longitude: 114.1694 },
            50000,
            s,
          ),
        signal,
      );
      const ids = [
        ...new Set(
          found
            .filter(
              (c) =>
                c.location &&
                c.location.latitude >= 22.15 &&
                c.location.latitude <= 22.58 &&
                c.location.longitude >= 113.83 &&
                c.location.longitude <= 114.45,
            )
            .map((c) => c.placeId),
        ),
      ]
        .filter((id) => id !== session.decision.selectedPlaceId)
        .slice(0, 5);
      return display(ids, signal);
    });
    // The first receipt wins. Retries refresh display content, never change accepted IDs.
    const winner = await db.runTransaction(async (tx) => {
      await assertDataActive(db, user.uid, tx, input.sessionId);
      const existing = await tx.get(receiptRef);
      if (existing.exists) return validReceipt(existing.data()!);
      tx.create(receiptRef, {
        hash,
        sessionId: session.id,
        source: p.source,
        placeIds: cards.map((c) => c.placeId),
        expiresAt: Timestamp.fromMillis(clock() + 15 * 60000),
      });
      return null;
    });
    return {
      cards: winner
        ? await bounded(4000, (signal) => display(winner, signal))
        : cards,
      lookupRequestId: input.requestId,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "PLACES_UNAVAILABLE",
      "暫時搵唔到資料；可以先唔填餐廳。",
      true,
    );
  }
}
