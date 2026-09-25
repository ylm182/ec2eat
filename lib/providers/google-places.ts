import "server-only";
import { distanceM } from "../restaurants/search";
import { z } from "zod";
import { bounded, jsonRequest, type Transport } from "./google-context";
import type { Coordinates } from "./contracts";
import {
  placeIdSchema,
  safeGoogleMapsUrl,
  type RestaurantProvider,
  type RestaurantCard,
  type SearchPlace,
} from "../restaurants/types";
const attribution = z.object({
  provider: z.string().optional(),
  providerUri: z.string().optional(),
});
const author = z.object({
  displayName: z.string(),
  uri: z.string().optional(),
});
const place = z.object({
  id: placeIdSchema,
  primaryType: z.string().max(100).optional(),
  types: z.array(z.string().max(100)).max(100).optional(),
  displayName: z.object({ text: z.string().max(1000) }).optional(),
  formattedAddress: z.string().max(2000).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
  businessStatus: z
    .enum([
      "BUSINESS_STATUS_UNSPECIFIED",
      "OPERATIONAL",
      "CLOSED_TEMPORARILY",
      "CLOSED_PERMANENTLY",
    ])
    .optional(),
  currentOpeningHours: z.object({ openNow: z.boolean().optional() }).optional(),
  priceLevel: z.string().max(100).optional(),
  rating: z.number().min(0).max(5).optional(),
  googleMapsUri: z.string().optional(),
  attributions: z.array(attribution).max(20).optional(),
  photos: z
    .array(
      z.object({
        name: z.string().max(2000),
        googleMapsUri: z.string().optional(),
        authorAttributions: z.array(author).max(20).optional(),
      }),
    )
    .max(10)
    .optional(),
});
const SEARCH_FIELDS =
  "id,location,businessStatus,currentOpeningHours.openNow,priceLevel,primaryType,types";
const DETAIL_FIELDS =
  "id,location,displayName,formattedAddress,businessStatus,currentOpeningHours.openNow,priceLevel,rating,googleMapsUri,attributions,photos";
function searchPlace(value: z.infer<typeof place>): SearchPlace {
  return {
    placeId: value.id,
    primaryType: value.primaryType ?? null,
    types: value.types ?? [],
    location: value.location ?? null,
    businessStatus: value.businessStatus ?? null,
    openNow: value.currentOpeningHours?.openNow ?? null,
    priceLevel: value.priceLevel ?? null,
  };
}
export class GooglePlacesProvider implements RestaurantProvider {
  readonly source = "google-places" as const;
  constructor(
    private key: string,
    readonly modelInputAllowed = false,
    private transport: Transport = fetch,
  ) {}
  private call(
    path: string,
    fields: string,
    signal: AbortSignal,
    body?: unknown,
  ) {
    return jsonRequest(
      `https://places.googleapis.com/v1/${path}`,
      {
        method: body ? "POST" : "GET",
        signal,
        headers: {
          "X-Goog-Api-Key": this.key,
          "X-Goog-FieldMask": fields,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      this.transport,
    );
  }
  private async search(method: string, body: unknown, signal: AbortSignal) {
    const response = z
      .object({ places: z.array(place).max(20).default([]) })
      .parse(
        await this.call(
          method,
          SEARCH_FIELDS.split(",")
            .map((f) => `places.${f}`)
            .join(","),
          signal,
          body,
        ),
      );
    return response.places.map(searchPlace);
  }
  nearby(location: Coordinates, radiusM: number, signal: AbortSignal) {
    return this.search(
      "places:searchNearby",
      {
        includedTypes: ["restaurant"],
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        languageCode: "zh-TW",
        locationRestriction: { circle: { center: location, radius: radiusM } },
      },
      signal,
    );
  }
  text(
    query: string,
    location: Coordinates,
    radiusM: number,
    signal: AbortSignal,
  ) {
    return this.search(
      "places:searchText",
      {
        textQuery: query,
        includedType: "restaurant",
        strictTypeFiltering: true,
        pageSize: 20,
        languageCode: "zh-TW",
        locationBias: { circle: { center: location, radius: radiusM } },
      },
      signal,
    );
  }
  async details(
    id: string,
    signal: AbortSignal,
    includePhoto = true,
    centre?: Coordinates,
  ): Promise<RestaurantCard> {
    placeIdSchema.parse(id);
    const value = place.parse(
      await this.call(
        `places/${encodeURIComponent(id)}?languageCode=zh-TW`,
        DETAIL_FIELDS,
        signal,
      ),
    );
    if (value.id !== id) throw new Error("Place ID mismatch");
    let photo: RestaurantCard["photo"] = null;
    const first = value.photos?.[0];
    const photoMapsUri = safeGoogleMapsUrl(first?.googleMapsUri);
    if (
      includePhoto &&
      first &&
      photoMapsUri &&
      first.name.startsWith(`places/${id}/photos/`) &&
      /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(first.name)
    )
      try {
        const data = await bounded(
          2000,
          (s) =>
            jsonRequest(
              `https://places.googleapis.com/v1/${first.name}/media?maxWidthPx=640&skipHttpRedirect=true`,
              { signal: s, headers: { "X-Goog-Api-Key": this.key } },
              this.transport,
            ),
          signal,
        );
        const uri = z
          .object({ photoUri: z.string().url() })
          .parse(data).photoUri;
        const url = new URL(uri);
        if (
          url.protocol === "https:" &&
          url.hostname.endsWith(".googleusercontent.com") &&
          !url.username &&
          !url.password
        )
          photo = {
            url: url.href,
            mapsUri: photoMapsUri,
            authors: (first.authorAttributions ?? []).map((a) => ({
              name: a.displayName,
              uri: safeGoogleMapsUrl(a.uri),
            })),
          };
      } catch {
        /* Photos are optional; preserve the card and required author attribution when present. */
      }
    return {
      location: value.location ?? null,
      distanceM:
        centre && value.location ? distanceM(centre, value.location) : null,
      placeId: id,
      name: value.displayName?.text ?? null,
      address: value.formattedAddress ?? null,
      businessStatus: value.businessStatus ?? null,
      openNow: value.currentOpeningHours?.openNow ?? null,
      priceLevel: value.priceLevel ?? null,
      rating: value.rating ?? null,
      mapsUri: safeGoogleMapsUrl(value.googleMapsUri),
      photo,
      attributions: (value.attributions ?? []).map((a) => ({
        name: a.provider ?? "資料來源",
        uri:
          a.providerUri && /^https:\/\//.test(a.providerUri)
            ? a.providerUri
            : null,
      })),
      available: true,
      fetchedAt: new Date().toISOString(),
      source: this.source,
      persistAllowed: false,
      modelInputAllowed: this.modelInputAllowed,
    };
  }
}
