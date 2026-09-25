import { describe, it, expect, vi } from "vitest";
import { GooglePlacesProvider } from "../lib/providers/google-places";
import { eligible, searchRestaurants } from "../lib/restaurants/search";
import { syntheticPlaces } from "../lib/server/places";
import { safeGoogleMapsUrl, selectable } from "../lib/restaurants/types";
import { restaurantEvidence } from "../lib/restaurants/evidence";
import { encodeLaya } from "../lib/laya/recipe";
import { HeuristicDecisionProvider } from "../lib/providers/heuristic";
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
  it("limits text queries to six and does not fabricate results for an empty search", async () => {
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
    expect(text).toHaveBeenCalledTimes(6);
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
    expect(JSON.parse(init.body as string).rankPreference).toBe("POPULARITY");
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
                  googleMapsUri: "https://www.google.com/maps/place/photo",
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
    expect(result.location).toEqual(centre);
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
  expect(result.result.fallbackReason).toBe("laya_score_fallback:batch_1:laya_invalid_output");
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
                  googleMapsUri: "https://www.google.com/maps/place/photo",
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
    mapsUri: "https://www.google.com/maps/place/photo",
    authors: [
      { name: "Photographer", uri: "https://www.google.com/maps/contrib/123" },
    ],
  });
});

 it.each([undefined,"https://untrusted.test/photo"])("omits photos with missing or unsafe source links: %s", async (googleMapsUri) => {
 let calls=0;
 const transport=async()=>{calls++;return new Response(JSON.stringify({id:"place-id",photos:[{name:"places/place-id/photos/photo-id",googleMapsUri}]}));};
 const card=await new GooglePlacesProvider("test-only",false,transport).details("place-id",signal());
 expect(card.photo).toBeNull();expect(card.available).toBe(true);expect(calls).toBe(1);
 });


it("keeps targeted candidates in a dense nearby set and caps the candidate pool at twenty", async () => {
  const p = syntheticPlaces("results"); p.modelInputAllowed = true;
  const base = (await p.nearby(centre, 3000, signal()))[0];
  p.nearby = async () => Array.from({length:20}, (_, i) => ({...base, placeId:`near-${i}`, location:centre}));
  const queries: string[] = [];
  p.text = async q => {
    queries.push(q);
    return Array.from({length:8}, (_, i) => ({...base, placeId:`target-${queries.length}-${i}`,
      location:{latitude:22.29,longitude:114.16}, primaryType:"ramen_restaurant"}));
  };
  const rank = vi.fn(async input => ({...await new HeuristicDecisionProvider().rank(input, signal()),provider:"laya" as const}));
  await searchRestaurants(sessionFixture(), centre, 3000, p, rank, signal());
  expect(queries).toHaveLength(6);
  const candidates = rank.mock.calls[0][0].candidates;
  expect(candidates).toHaveLength(10);
  expect(new Set(rank.mock.calls.flatMap(call=>call[0].candidates.map((c:{id:string})=>c.id))).size).toBe(20);
  expect(rank).toHaveBeenCalledTimes(2);
  expect(new Set(candidates.map((c: {id:string}) => c.id)).size).toBe(10);
  expect(candidates.some((c: {id:string}) => c.id.startsWith("target-"))).toBe(true);
  expect(rank.mock.calls.flatMap(call => call[0].candidates).some((c: {id:string}) => c.id.startsWith("near-"))).toBe(true);
  expect(candidates[0].categoryId).toBe("noodles");
});
it("provider types map narrowly and never inherit archetype taste attributes", () => {
  const base = {placeId:"test",location:centre,businessStatus:null,openNow:null,priceLevel:null};
  expect(restaurantEvidence({...base,types:["japanese_restaurant"]})).toEqual({features:{},cuisines:["Japanese"]});
  expect(restaurantEvidence({...base,types:["ramen_restaurant","salad_shop"]})).toEqual({features:{},cuisines:[]});
  expect(restaurantEvidence({...base,primaryType:"salad_shop",types:["restaurant"]}).categoryId).toBe("salad");
  const evidence = restaurantEvidence({...base,types:["fine_dining_restaurant","ramen_restaurant"]});
  expect(evidence.categoryId).toBe("noodles");
  expect(Object.keys(evidence.features)).toEqual(["formality"]);
});
it("avoids inference on absent restaurant evidence", async () => {
  const p = syntheticPlaces("results"); p.modelInputAllowed = true;
  const s = sessionFixture();
  s.preferences = Object.fromEntries(Object.keys(s.preferences).map(k => [k,{state:"unknown",value:null,strength:0}])) as typeof s.preferences;
  s.preferences.spiciness = {state:"answered",value:.8,strength:1};
  const rank = vi.fn(async input => {
    expect(() => encodeLaya(input)).toThrow("laya_no_preference_evidence");
    return new HeuristicDecisionProvider().rank(input, signal());
  });
  await searchRestaurants(s,centre,3000,p,rank,signal());
  expect(rank).toHaveBeenCalledOnce();
});
it("asks preference-driven searches even when nearby succeeds and tolerates their failure", async () => {
  const p = syntheticPlaces("results");
  const text = vi.spyOn(p,"text").mockRejectedValue(new Error("unavailable"));
  const result = await searchRestaurants(sessionFixture(),centre,3000,p,vi.fn(),signal());
  expect(text).toHaveBeenCalledTimes(6);
  expect(result.candidates).toHaveLength(3);
});

it("explicit food category drives retrieval and is passed to both rankers", async () => {
  const p = syntheticPlaces("results"); p.modelInputAllowed = true;
  const s = sessionFixture();
  s.questions.push({instanceId:"category-test",issuedAt:s.createdAt,definition:{id:"category",version:1,kind:"category",prompt:"Food",contextTags:[],options:[{id:"salad",label:"沙律",categoryId:"salad"}]}});
  s.answers.push({questionInstanceId:"category-test",action:"category",optionId:"salad",value:null,answeredAt:s.createdAt,requestId:"category-answer"});
  const query = vi.spyOn(p,"text");
  const rank = vi.fn(async input => new HeuristicDecisionProvider().rank(input,signal()));
  await searchRestaurants(s,centre,3000,p,rank,signal());
  expect(query.mock.calls.some(call => call[0].includes("沙律"))).toBe(true);
  expect(rank.mock.calls[0][0].categoryPreference).toBe("salad");
});
it("reads provider types without adding reviews or names to search payloads", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({places:[{id:"type-test",location:centre,primaryType:"ramen_restaurant",types:["restaurant","ramen_restaurant"]}]})));
  const p = new GooglePlacesProvider("test-only",true,transport);
  const found = await p.nearby(centre,3000,signal());
  expect(found[0].primaryType).toBe("ramen_restaurant");
  expect(restaurantEvidence(found[0]).categoryId).toBe("noodles");
  const init = (transport.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.stringify(init.headers)).toContain("primaryType");
  expect(JSON.stringify(init.headers)).not.toMatch(/reviews|displayName/);
});


it.each(["meal", "snack"] as const)("scopes all Google retrieval to explicit %s intent within the selected radius", async intent => {
  const session = sessionFixture();
  session.context.diningIntent = intent;
  const provider = syntheticPlaces("results");
  const nearby = vi.spyOn(provider, "nearby");
  const text = vi.spyOn(provider, "text");
  await searchRestaurants(session, centre, 10000, provider, vi.fn(), signal());
  expect(nearby).not.toHaveBeenCalled();
  expect(text).toHaveBeenCalledTimes(7);
  for (const [query, location, radius] of text.mock.calls) {
    expect(location).toEqual(centre);
    expect(radius).toBe(10000);
    if (intent === "meal") expect(query).toContain("正餐");
    else expect(query).toMatch(/小食|甜品|麵包糕點/);
  }
});


it("snack search permits food venues outside the restaurant type, while ordinary search keeps its restriction", async () => {
  const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ places: [] })));
  const provider = new GooglePlacesProvider("test", false, transport);
  await provider.text("小食", centre, 3000, signal(), false);
  const snack = JSON.parse(transport.mock.calls[0][1]!.body as string);
  expect(snack.textQuery).toBe("小食");
  expect(snack.includedType).toBeUndefined();
  await provider.text("正餐 餐廳", centre, 3000, signal());
  expect(JSON.parse(transport.mock.calls[1][1]!.body as string).includedType).toBe("restaurant");
});
