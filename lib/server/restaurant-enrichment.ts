import "server-only";
import type { RestaurantProvider } from "../restaurants/types";
import type { RestaurantEnrichment } from "../restaurants/enrichment";
import { GoogleRoutesProvider } from "../providers/google-routes";
import { GeminiRestaurantSummary } from "../providers/restaurant-summary";
import { ApiError } from "./http";
export function configuredRoutes() {
  if (process.env.APP_MODE !== "live" || !process.env.GOOGLE_ROUTES_API_KEY)
    throw new ApiError(503, "ROUTES_NOT_CONFIGURED", "路線服務未接通，暫時未能按行程時間搜尋。", true);
  return new GoogleRoutesProvider(process.env.GOOGLE_ROUTES_API_KEY);
}
export function restaurantEnrichment(provider: RestaurantProvider, travelRequested = false): RestaurantEnrichment | undefined {
  if (travelRequested && provider.source === "synthetic" && process.env.APP_MODE === "emulator") return {
    routes: async (_origin, ids) => new Map(ids.map(id => [id, { distanceMeters: 800, duration: "600s", durationSeconds: 600 }])),
    facts: async (id, signal) => { const c = await provider.details(id, signal, false); return { displayName: c.name, rating: c.rating, userRatingCount: null, reviews: [], priceLevel: c.priceLevel, primaryType: null, types: [] }; },
    summarize: async facts => `Synthetic emulator restaurant: ${facts.displayName ?? "unknown"}. Price: ${facts.priceLevel ?? "unknown"}. No review evidence.`,
  };
  if (process.env.RESTAURANT_SUMMARIES_ENABLED !== "true" || provider.source !== "google-places") return undefined;
  if (!provider.modelInputAllowed || !provider.facts) throw new ApiError(503, "SUMMARY_NOT_CONFIGURED", "餐廳摘要服務未接通。", true);
  const routes = configuredRoutes();
  const gemini = new GeminiRestaurantSummary(process.env.GOOGLE_CLOUD_PROJECT!, process.env.VERTEX_LOCATION ?? "global");
  return { translate: (...args) => gemini.translate(...args), routes: (...args) => routes.matrix(...args), facts: (...args) => provider.facts!(...args), summarize: (...args) => gemini.summarize(...args) };
}
