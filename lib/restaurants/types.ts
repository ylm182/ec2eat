import { z } from "zod";
import type { Coordinates } from "../providers/contracts";
export const placeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const attributionSchema = z.object({
  name: z.string().max(1000),
  uri: z.string().nullable(),
});
export const restaurantCardSchema = z.object({
  placeId: placeIdSchema,
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
  name: z.string().nullable(),
  address: z.string().nullable(),
  businessStatus: z.string().nullable(),
  openNow: z.boolean().nullable(),
  priceLevel: z.string().nullable(),
  distanceM: z.number().nonnegative().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  mapsUri: z.string().nullable(),
  photo: z
    .object({ url: z.string(), mapsUri: z.string(), authors: z.array(attributionSchema) })
    .nullable(),
  attributions: z.array(attributionSchema),
  available: z.boolean(),
  fetchedAt: z.string().datetime(),
  source: z.enum(["google-places", "synthetic"]),
  persistAllowed: z.literal(false),
  modelInputAllowed: z.boolean(),
});
export type RestaurantCard = z.infer<typeof restaurantCardSchema>;
export type SearchPlace = {
  primaryType?: string | null;
  types?: string[];
  placeId: string;
  location: Coordinates | null;
  businessStatus: string | null;
  openNow: boolean | null;
  priceLevel: string | null;
};
export interface RestaurantProvider {
  source: "google-places" | "synthetic";
  modelInputAllowed: boolean;
  nearby(
    location: Coordinates,
    radiusM: number,
    signal: AbortSignal,
  ): Promise<SearchPlace[]>;
  text(
    query: string,
    location: Coordinates,
    radiusM: number,
    signal: AbortSignal,
  ): Promise<SearchPlace[]>;
  details(
    id: string,
    signal: AbortSignal,
    photo?: boolean,
    centre?: Coordinates,
  ): Promise<RestaurantCard>;
}
export function safeGoogleMapsUrl(value: string | undefined | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "maps.google.com" ||
        url.hostname === "www.google.com" ||
        url.hostname === "maps.app.goo.gl")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function mapsUrl(placeId: string) {
  return `https://www.google.com/maps/search/?api=1&query=restaurant&query_place_id=${encodeURIComponent(placeIdSchema.parse(placeId))}`;
}
export function selectable(place: {
  businessStatus: string | null;
  openNow: boolean | null;
}) {
  return (
    !["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(
      place.businessStatus ?? "",
    ) && place.openNow !== false
  );
}
