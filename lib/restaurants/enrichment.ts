import { bounded } from "../providers/google-context";
import { travelLimits, type TravelChoice, type RouteMetric, type TravelResult } from "./travel";
import type { Coordinates } from "../providers/contracts";
import type { RestaurantFacts, SearchPlace } from "./types";
export type RestaurantEnrichment = {
  routes(origin: Coordinates, ids: string[], mode: "WALK" | "DRIVE", signal: AbortSignal): Promise<Map<string, RouteMetric>>;
  facts(id: string, signal: AbortSignal): Promise<RestaurantFacts>;
  summarize(facts: RestaurantFacts, travel: TravelResult, signal: AbortSignal): Promise<string>;
};
export async function enrichRestaurants(candidates: SearchPlace[], origin: Coordinates, choice: TravelChoice | undefined, deps: RestaurantEnrichment, signal: AbortSignal) {
  const ids = candidates.map(c => c.placeId);
  if (!ids.length) return { candidates, descriptions: new Map<string, string>(), incomplete: false };
  const mode = choice ? travelLimits[choice].mode : "WALK";
  const required = await bounded(10000, s => deps.routes(origin, ids, mode, s), signal);
  // Unknown routes cannot be claimed to meet the selected travel-time limit.
  if (choice && required.size === 0) throw new Error("ROUTES_UNAVAILABLE");
  const eligible = choice ? candidates.filter(c => {
    const route = required.get(c.placeId);
    return route && route.durationSeconds <= travelLimits[choice].seconds;
  }) : candidates;
  let walking = mode === "WALK" ? required : new Map<string, RouteMetric>();
  if (mode === "DRIVE" && eligible.length) {
    try { walking = await bounded(10000, s => deps.routes(origin, eligible.map(c => c.placeId), "WALK", s), signal); }
    catch { signal.throwIfAborted(); /* Optional walking display never invents a route. */ }
  }
  const descriptions = new Map<string, string>();
  let incomplete = false;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, async () => {
    for (;;) {
      const candidate = eligible[cursor++]; if (!candidate) return;
      try {
        const travel = { walking: walking.get(candidate.placeId) ?? null, driving: mode === "DRIVE" ? required.get(candidate.placeId) ?? null : null };
        const facts = await bounded(5000, s => deps.facts(candidate.placeId, s), signal);
        const summary = await bounded(12000, s => deps.summarize(facts, travel, s), signal);
        const routes = [travel.walking ? `Walking: distanceMeters=${travel.walking.distanceMeters}, duration=${travel.walking.duration}.` : "Walking route unknown.",
          ...(travel.driving ? [`Driving: distanceMeters=${travel.driving.distanceMeters}, duration=${travel.driving.duration}.`] : [])].join(" ");
        descriptions.set(candidate.placeId, `${summary}\n${routes}`);
      } catch { signal.throwIfAborted(); incomplete = true; }
    }
  }));
  return { candidates: eligible, descriptions, incomplete };
}
