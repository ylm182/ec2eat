import { describe, it, expect, vi } from "vitest";
import { GooglePlacesProvider } from "../lib/providers/google-places";
import { eligible, searchRestaurants } from "../lib/restaurants/search";
import { syntheticPlaces } from "../lib/server/places";
import { safeGoogleMapsUrl, selectable } from "../lib/restaurants/types";
import { sessionFixture } from "./fixtures";
const centre = { latitude: 22.28, longitude: 114.16 };
const signal = () => new AbortController().signal;
describe("restaurant search and content boundaries", () => {
  it("deduplicates, excludes closed, unknown coordinates and out-of-radius; unknown hours stay eligible", () => {
    const p = {
      placeId: "a",
      location: centre,
      businessStatus: "OPERATIONAL",
      openNow: null,
      priceLevel: null,
    };
    expect(
      eligible(
        [
          p,
          p,
          { ...p, placeId: "closed", openNow: false },
          { ...p, placeId: "permanent", businessStatus: "CLOSED_PERMANENTLY" },
          { ...p, placeId: "far", location: { latitude: 23, longitude: 115 } },
          { ...p, placeId: "unknown", location: null },
        ],
        centre,
        1500,
      ).map((c) => c.placeId),
    ).toEqual(["a"]);
    expect(selectable(p)).toBe(true);
  });
  it("never sends Google-derived content to HF without separate permission; returns only IDs and scores", async () => {
    const provider = syntheticPlaces("results");
    provider.source = "google-places";
    const rank = vi.fn();
    const result = await searchRestaurants(
      sessionFixture(),
      centre,
      1500,
      provider,
      rank,
      signal(),
    );
    expect(rank).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(3);
    expect(Object.keys(result.candidates[0]).sort()).toEqual([
      "placeId",
      "score",
      "weight",
    ]);
    expect(result.result.fallbackReason).toBe(
      "places_model_input_not_approved",
    );
    expect(result.candidates.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(
      1,
    );
  });
  it("limits text queries to two and does not fabricate results for an empty search", async () => {
    const p = syntheticPlaces("empty");
    const text = vi.spyOn(p, "text");
    const result = await searchRestaurants(
      sessionFixture(),
      centre,
      1500,
      p,
      vi.fn(),
      signal(),
    );
    expect(text).toHaveBeenCalledTimes(2);
    expect(result.candidates).toEqual([]);
  });
  it("uses only evidence-backed distance and price when model use is approved", async () => {
    const p = syntheticPlaces("results");
    p.modelInputAllowed = true;
    const { HeuristicDecisionProvider } = await import(
      "../lib/providers/heuristic"
    );
    const rank = vi.fn(async (input) =>
      new HeuristicDecisionProvider().rank(input, signal()),
    );
    await searchRestaurants(sessionFixture(), centre, 1500, p, rank, signal());
    const input = rank.mock.calls[0][0];
    expect(input.candidates).toHaveLength(3);
    expect(Object.keys(input.candidates[0].features).sort()).toEqual([
      "distanceTolerance",
      "price",
    ]);
    expect(input.candidates[2].features.price).toBeUndefined();
  });
  it("uses bounded minimal masks, no reviews, no-store and hardcoded official API origin", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            places: [{ id: "real-response-id", location: centre }],
          }),
        ),
    );
    const p = new GooglePlacesProvider("test-only-key", false, transport);
    const result = await p.nearby(centre, 1500, signal());
    expect(result[0].openNow).toBeNull();
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(init.cache).toBe("no-store");
    expect(JSON.stringify(init.headers)).not.toMatch(
      /photos|reviews|displayName/,
    );
    expect(JSON.parse(init.body as string).maxResultCount).toBe(20);
  });
  it("keeps live detail attribution and unknowns; photo failure cannot erase the restaurant", async () => {
    const transport = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).includes("/media?")
              ? { error: "photo failed" }
              : {
                  id: "place-id",
                  displayName: { text: "Provider name" },
                  location: centre,
                  attributions: [
                    {
                      provider: "Data owner",
                      providerUri: "https://example.org",
                    },
                  ],
                  photos: [
                    {
                      name: "places/place-id/photos/photo-id",
                      authorAttributions: [{ displayName: "Author" }],
                    },
                  ],
                },
          ),
        ),
    );
    const result = await new GooglePlacesProvider(
      "test-only",
      false,
      transport,
    ).details("place-id", signal(), true, centre);
    expect(result.name).toBe("Provider name");
    expect(result.rating).toBeNull();
    expect(result.openNow).toBeNull();
    expect(result.photo).toBeNull();
    expect(result.distanceM).toBe(0);
    expect(result.attributions[0].name).toBe("Data owner");
    expect(result.persistAllowed).toBe(false);
  });
  it("validates detail identity and rejects unsafe Maps URLs", async () => {
    const p = new GooglePlacesProvider(
      "test",
      false,
      async () => new Response(JSON.stringify({ id: "another-id" })),
    );
    await expect(p.details("requested-id", signal())).rejects.toThrow(
      "Place ID mismatch",
    );
    expect(safeGoogleMapsUrl("javascript:alert(1)")).toBeNull();
    expect(
      safeGoogleMapsUrl("https://www.google.com.evil.test/maps"),
    ).toBeNull();
  });
});

it("invalid model IDs cannot enter the shortlist and supplemental failure preserves real candidates", async () => {
  const p = syntheticPlaces("results");
  p.modelInputAllowed = true;
  const original = p.nearby;
  p.nearby = async (...args) => (await original(...args)).slice(0, 1);
  p.text = async () => {
    throw new Error("optional search failed");
  };
  const rank = vi.fn(async () => ({
    version: 1 as const,
    entries: [{ id: "invented", score: 1, weight: 1 }],
    confidence: null,
    confidenceKind: "none" as const,
    provider: "laya" as const,
    model: null,
    revision: null,
    latencyMs: 1,
    fallbackReason: null,
  }));
  const result = await searchRestaurants(
    sessionFixture(),
    centre,
    1500,
    p,
    rank,
    signal(),
  );
  expect(result.candidates.map((c) => c.placeId)).toEqual(["synthetic-0"]);
  expect(result.result.provider).toBe("heuristic");
  expect(result.result.fallbackReason).toBe("laya_invalid_output");
});

it("photo media is displayed only with a safe URL and its supplied author attribution", async () => {
  const transport = async (url: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        String(url).includes("/media?")
          ? { photoUri: "https://lh3.googleusercontent.com/photo" }
          : {
              id: "place-id",
              photos: [
                {
                  name: "places/place-id/photos/photo-id",
                  authorAttributions: [
                    {
                      displayName: "Photographer",
                      uri: "https://www.google.com/maps/contrib/123",
                    },
                  ],
                },
              ],
            },
      ),
    );
  const card = await new GooglePlacesProvider(
    "test-only",
    false,
    transport,
  ).details("place-id", signal());
  expect(card.photo).toEqual({
    url: "https://lh3.googleusercontent.com/photo",
    authors: [
      { name: "Photographer", uri: "https://www.google.com/maps/contrib/123" },
    ],
  });
});
