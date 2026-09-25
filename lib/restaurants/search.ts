import { restaurantEvidence } from "./evidence";
import { bounded } from "../providers/google-context";
import { rankRestaurantPool, type RestaurantRanker } from "./ranking";
import { rankCandidates, categoryPreference } from "../domain/engine";
import { archetypes } from "../domain/catalog";
import { unknownPreferences, type DecisionSession } from "../domain/schema";
import type {
  Coordinates,
  DecisionInput,
  DecisionResult,
} from "../providers/contracts";
import { HeuristicDecisionProvider } from "../providers/heuristic";
import { selectable, type SearchPlace, type RestaurantProvider } from "./types";
export function distanceM(a: Coordinates, b: Coordinates) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad,
    dLng = (b.longitude - a.longitude) * rad;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}
export function eligible(
  places: SearchPlace[],
  centre: Coordinates,
  radius: number,
  preserveOrder = false,
) {
  return [...new Map(places.map((p) => [p.placeId, p])).values()]
    .filter(
      (p) =>
        selectable(p) &&
        p.location !== null &&
        distanceM(centre, p.location) <= radius,
    )
    .sort(
      (a, b) =>
        preserveOrder ? 0 : distanceM(centre, a.location!) - distanceM(centre, b.location!) ||
        a.placeId.localeCompare(b.placeId),
    )
    .slice(0, 50);
}
const prices: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 0.25,
  PRICE_LEVEL_MODERATE: 0.5,
  PRICE_LEVEL_EXPENSIVE: 0.75,
  PRICE_LEVEL_VERY_EXPENSIVE: 1,
};
export async function searchRestaurants(
  session: DecisionSession,
  centre: Coordinates,
  radius: number,
  provider: RestaurantProvider,
  rank: RestaurantRanker,
  signal: AbortSignal,
) {
  const top = rankCandidates(
    archetypes, session.preferences, {}, categoryPreference(session),
  ).slice(0, 2);
  // Queries reflect preferences even in dense areas. Query results are retrieval
  // evidence only: never turn the searched-for dish into a restaurant attribute.
  const queries = [...new Set([...top.map(c => archetypes.find(a => a.id === c.id)!.label + " 餐廳"), "中菜 餐廳", "日本料理 餐廳", "韓國料理 餐廳", "泰國料理 餐廳"])];
  const batches = await Promise.allSettled([
    bounded(4000, s => provider.nearby(centre, radius, s), signal),
    ...queries.map(q => bounded(2500, s => provider.text(q, centre, radius, s), signal)),
  ]);
  signal.throwIfAborted();
  const pools = batches.map(b => b.status === "fulfilled" ? eligible(b.value, centre, radius, true) : []);
  // Interleave targeted pools and nearby results so close generic results
  // cannot crowd every preference-matched retrieval out of the scoring set.
  const orderedPools = [...pools.slice(1), pools[0]];
  const candidates: SearchPlace[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 20 && candidates.length < 50; i++) {
    for (const pool of orderedPools) {
      const place = pool[i];
      if (place && !seen.has(place.placeId) && candidates.length < 50) {
        candidates.push(place); seen.add(place.placeId);
      }
    }
  }
  if (!candidates.length) {
    const failure = batches.find(b => b.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  signal.throwIfAborted();
  const input: DecisionInput = {
    version: 1,
    stage: "restaurant",
    candidates: candidates.map((p) => ({
      id: p.placeId,
      ...restaurantEvidence(p),
      distanceM: distanceM(centre, p.location!),
      features: {
        ...restaurantEvidence(p).features,
        distanceTolerance: {
          value: Math.min(1, distanceM(centre, p.location!) / radius),
          confidence: 1,
          source: "provider",
        },
        ...(p.priceLevel && prices[p.priceLevel] !== undefined
          ? {
              price: {
                value: prices[p.priceLevel],
                confidence: 1,
                source: "provider" as const,
              },
            }
          : {}),
      },
    })),
    preferences: { ...unknownPreferences(), ...session.preferences },
    priors: {},
    categoryPreference: categoryPreference(session),
    context: { rain: null, nextEventSoon: null },
  };
  // No Google-derived features go to HF unless separately approved. No invented cuisine/taste tags.
  let result: DecisionResult;
  if (provider.modelInputAllowed && candidates.length) {
    result = await rankRestaurantPool(input, rank, signal);
  } else
    result = {
      ...(await new HeuristicDecisionProvider().rank(input, signal)),
      fallbackReason: "places_model_input_not_approved",
    };
  const shortlist = result.entries.slice(0, 10);
  const sum = shortlist.reduce((n, c) => n + c.weight, 0);
  return {
    result,
    poolSize: candidates.length,
    candidates: shortlist.map((c) => ({
      placeId: c.id,
      score: c.score,
      weight: sum ? c.weight / sum : 1 / shortlist.length,
    })),
  };
}
