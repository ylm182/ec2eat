import { expect, it, vi } from "vitest";
import { GoogleRoutesProvider } from "../lib/providers/google-routes";
import { GeminiRestaurantSummary } from "../lib/providers/restaurant-summary";
import { enrichRestaurants, type RestaurantEnrichment } from "../lib/restaurants/enrichment";
import { encodeLaya } from "../lib/laya/recipe";
import { unknownPreferences } from "../lib/domain/schema";
const origin = { latitude: 22.28, longitude: 114.16 };
const route = (seconds: number) => ({ durationSeconds: seconds, duration: `${seconds}s`, distanceMeters: 800 });
const facts = { displayName: "Test", rating: 4.2, userRatingCount: 120, reviews: [{text:"Light food, quick lunch",rating:4}], priceLevel: "PRICE_LEVEL_INEXPENSIVE", primaryType: "restaurant", types: ["restaurant"] };
const candidates = ["a", "b", "c"].map(placeId => ({ placeId, location: origin, openNow: true, businessStatus: "OPERATIONAL", priceLevel: "PRICE_LEVEL_INEXPENSIVE" }));
const signal = () => new AbortController().signal;
it("maps route responses by index, preserves seconds and omits unknown routes", async () => {
 const transport = vi.fn(async () => new Response(JSON.stringify([
  { originIndex:0,destinationIndex:1,status:{},condition:"ROUTE_EXISTS",distanceMeters:850,duration:"360.5s" },
  { originIndex:0,destinationIndex:0,status:{code:5},condition:"ROUTE_NOT_FOUND" },
 ])));
 const result = await new GoogleRoutesProvider("mock", transport).matrix(origin,["a","b"],"WALK",signal());
 expect(result.has("a")).toBe(false); expect(result.get("b")?.durationSeconds).toBe(360.5);
 const request = transport.mock.calls[0] as unknown as [string,RequestInit];
 expect(JSON.parse(request[1].body as string).travelMode).toBe("WALK");
 expect(request[1].cache).toBe("no-store");
});
it.each([["walk20",1200],["walk30",1800],["drive20",1200]] as const)("filters %s by actual route duration before summary",async(choice,limit)=>{
 const routes=vi.fn(async (_o,_ids,mode)=>new Map([["a",route(limit)],["b",route(limit+1)]]));
 const summarize=vi.fn(async()=>"Light food and inexpensive lunch.");
 const deps:RestaurantEnrichment={routes,facts:async()=>facts,summarize};
 const result=await enrichRestaurants(candidates,origin,choice,deps,signal());
 expect(result.candidates.map(c=>c.placeId)).toEqual(["a"]);
 expect(summarize).toHaveBeenCalledTimes(1);
 expect(result.descriptions.get("a")).toContain("distanceMeters=800");
 expect(routes.mock.calls[0][2]).toBe(choice==="drive20"?"DRIVE":"WALK");
 if(choice==="drive20")expect(routes).toHaveBeenCalledTimes(2);
});
it("never invents routes; summary failure is signalled for whole-pool fallback",async()=>{
 const deps:RestaurantEnrichment={routes:async()=>new Map(),facts:async()=>facts,summarize:async()=>"summary"};
 await expect(enrichRestaurants(candidates,origin,"walk20",deps,signal())).rejects.toThrow("ROUTES_UNAVAILABLE");
 deps.routes=async()=>new Map([["a",route(600)]]); deps.summarize=async()=>{throw Error("timeout");};
 const result=await enrichRestaurants(candidates,origin,"walk20",deps,signal());
 expect(result.incomplete).toBe(true); expect(result.descriptions.size).toBe(0);
});
it("Gemini receives all seven fields and route metrics with the fixed model",async()=>{
 const transport=vi.fn(async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({summary:"Light, inexpensive lunch; reviewers report fast service."})}]}}]})));
 const summary=await new GeminiRestaurantSummary("sample-project","global",async()=>"mock",transport).summarize(facts,{walking:route(360),driving:null},signal());
 expect(summary).toContain("Light");
 const [url,init]=transport.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toContain("gemini-3.5-flash-lite");
 const body=JSON.parse(init.body as string); const input=JSON.parse(body.contents[0].parts[0].text);
 expect(input).toMatchObject({...facts,travel:{walking:{duration:"360s"}}});
});
it("sends the summary verbatim for independent scoring even without legacy taste features",()=>{
 const preferences=unknownPreferences();preferences.richness={state:"answered",value:.2,strength:1};
 const result=encodeLaya({version:1,stage:"restaurant",candidates:[{id:"a",summary:"Light food. Walking: duration=360s.",features:{}}],preferences,priors:{},context:{rain:null,nextEventSoon:null},travelPreference:"WALK within 20 minutes"});
 expect(result.body.inputs.mode).toBe("score");
 expect(result.body.inputs.candidates[0].description).toBe("Light food. Walking: duration=360s.");
 expect(result.body.inputs.state).toContain("Explicit preference: light");
 expect(result.body.inputs.state).not.toContain("Candidate rows");
});
