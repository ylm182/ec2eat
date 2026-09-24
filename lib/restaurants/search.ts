import { bounded } from "../providers/google-context";
import { validateRanking } from "../laya/provider";
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
        distanceM(centre, a.location!) - distanceM(centre, b.location!) ||
        a.placeId.localeCompare(b.placeId),
    )
    .slice(0, 10);
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
  rank: (input: DecisionInput) => Promise<DecisionResult>,
  signal: AbortSignal,
) {
  let all = await bounded(
    4000,
    (s) => provider.nearby(centre, radius, s),
    signal,
  );
  let candidates = eligible(all, centre, radius);
  if (candidates.length < 3) {
    const top = rankCandidates(
      archetypes,
      session.preferences,
      {},
      categoryPreference(session),
    ).slice(0, 2);
    for (const candidate of top) {
      signal.throwIfAborted();
      const label = archetypes.find((a) => a.id === candidate.id)!.label;
      try {
        all = all.concat(
          await bounded(
            2500,
            (s) => provider.text(`${label} 餐廳`, centre, radius, s),
            signal,
          ),
        );
      } catch (error) {
        if (!candidates.length) throw error;
      }
      candidates = eligible(all, centre, radius);
      if (candidates.length >= 3) break;
    }
  }
  signal.throwIfAborted();
  const input: DecisionInput = {
    version: 1,
    stage: "restaurant",
    candidates: candidates.map((p) => ({
      id: p.placeId,
      distanceM: distanceM(centre, p.location!),
      features: {
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
    context: { rain: null, nextEventSoon: null },
  };
  // No Google-derived features go to HF unless separately approved. No invented cuisine/taste tags.
  let result: DecisionResult;
  if (provider.modelInputAllowed && candidates.length) {
    try {
      result = await rank(input);
      validateRanking(
        { entries: result.entries, confidence: result.confidence },
        input,
      );
    } catch {
      result = {
        ...(await new HeuristicDecisionProvider().rank(input, signal)),
        fallbackReason: "laya_invalid_output",
      };
    }
  } else
    result = {
      ...(await new HeuristicDecisionProvider().rank(input, signal)),
      fallbackReason: "places_model_input_not_approved",
    };
  const shortlist = result.entries.slice(0, 3);
  const sum = shortlist.reduce((n, c) => n + c.weight, 0);
  return {
    result,
    candidates: shortlist.map((c) => ({
      placeId: c.id,
      score: c.score,
      weight: sum ? c.weight / sum : 1 / shortlist.length,
    })),
  };
}
