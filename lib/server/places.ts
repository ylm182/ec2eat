import "server-only";
import { serverConfig } from "./config";
import { ApiError } from "./http";
import { GooglePlacesProvider } from "../providers/google-places";
import type { RestaurantProvider, RestaurantCard } from "../restaurants/types";
export function placesProvider(): RestaurantProvider {
  const config = serverConfig();
  const fixture = process.env.PLACES_FIXTURE;
  if (fixture && config.APP_MODE !== "emulator")
    throw new Error("Places fixtures forbidden in live mode");
  if (config.APP_MODE === "emulator" && fixture) {
    if (
      !["results", "empty", "failure", "closed", "details-failure"].includes(
        fixture,
      )
    )
      throw new Error("Unknown Places fixture");
    return syntheticPlaces(fixture);
  }
  if (
    config.APP_MODE !== "live" ||
    !process.env.GOOGLE_PLACES_API_KEY ||
    process.env.PLACES_CONTENT_USE_APPROVED !== "true"
  )
    throw new ApiError(
      503,
      "PLACES_NOT_CONFIGURED",
      "餐廳搜尋未接通，答案已儲存。",
      true,
    );
  return new GooglePlacesProvider(
    process.env.GOOGLE_PLACES_API_KEY,
    process.env.PLACES_MODEL_INPUT_APPROVED === "true",
  );
}
export function syntheticPlaces(mode: string): RestaurantProvider {
  const search: RestaurantProvider["nearby"] = async (centre) => {
    if (mode === "failure")
      throw new ApiError(
        503,
        "PLACES_UNAVAILABLE",
        "測試：餐廳搜尋暫時失敗。",
        true,
      );
    return mode === "empty"
      ? []
      : [0, 1, 2].map((i) => ({
          placeId: `synthetic-${i}`,
          location: {
            latitude: centre.latitude + 0.001 * i,
            longitude: centre.longitude,
          },
          businessStatus:
            mode === "closed" ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
          openNow: i === 2 ? null : true,
          priceLevel: i === 2 ? null : "PRICE_LEVEL_MODERATE",
        }));
  };
  return {
    source: "synthetic",
    modelInputAllowed: false,
    nearby: search,
    text: async (_q, c, r, s) => search(c, r, s),
    details: async (id) => {
      if (mode === "details-failure")
        throw new Error("Synthetic detail failure");
      return {
        distanceM: null,
        placeId: id,
        name: `示範餐廳 ${id.slice(-1)}（合成）`,
        address: "合成地址，唔係真實餐廳",
        businessStatus:
          mode === "closed" ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
        openNow: id.endsWith("2") ? null : true,
        priceLevel: null,
        rating: null,
        mapsUri: null,
        photo: null,
        attributions: [],
        available: true,
        fetchedAt: new Date().toISOString(),
        source: "synthetic",
        persistAllowed: false,
        modelInputAllowed: false,
      } satisfies RestaurantCard;
    },
  };
}
