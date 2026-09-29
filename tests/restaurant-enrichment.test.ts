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
it("translates only exact shortlist scoring inputs and tolerates individual translation failure", async () => {
 const { translateShortlist } = await import("../lib/restaurants/enrichment");
 const translate = vi.fn(async (text: string) => { if (text === "failed") throw Error("timeout"); return "清淡午餐，步行約6分鐘。"; });
 const result = await translateShortlist(["a", "b"], new Map([["a", "Exact input. Walking: distanceMeters=800, duration=360s."], ["b", "failed"], ["excluded", "not shortlisted"]]), translate, signal());
 expect(result).toEqual([{ placeId: "a", text: "清淡午餐，步行約6分鐘。" }]);
 expect(translate.mock.calls.map(c => c[0])).toEqual(["Exact input. Walking: distanceMeters=800, duration=360s.", "failed"]);
});
it("asks Gemini to translate the actual scoring text into Cantonese without adding evidence", async () => {
 const transport = vi.fn(async () => new Response(JSON.stringify({ candidates: [{content: {parts: [{text: JSON.stringify({summary:"清淡午餐，步行800米，約6分鐘。"})}]}}] })));
 const result = await new GeminiRestaurantSummary("sample-project", "global", async()=>"mock", transport).translate("Light lunch. Walking: distanceMeters=800, duration=360s.", signal());
 expect(result).toContain("步行800米");
 const [, init] = transport.mock.calls[0] as unknown as [string,RequestInit];
 const body = JSON.parse(init.body as string);
 expect(body.contents[0].parts[0].text).toBe("Light lunch. Walking: distanceMeters=800, duration=360s.");
 expect(body.systemInstruction.parts[0].text).toContain("Hong Kong Cantonese");
});
it("returns Cantonese only for the top ten without adding provider text to persisted candidate records", async () => {
 const { searchRestaurants } = await import("../lib/restaurants/search");
 const { sessionFixture } = await import("./fixtures");
 const { syntheticPlaces } = await import("../lib/server/places");
 const provider = syntheticPlaces("results"); provider.modelInputAllowed = true;
 const places = Array.from({length:12}, (_,i)=>({...candidates[0],placeId:`p${i}`}));
 provider.nearby = async()=>places; provider.text = async()=>places;
 const translate = vi.fn(async (text:string)=>`廣東話：${text}`);
 const deps:RestaurantEnrichment = {routes:async()=>new Map(places.map(p=>[p.placeId,route(360)])),facts:async(id)=>({...facts,displayName:id}),summarize:async(f)=>`${f.displayName} light lunch.`,translate};
 const result = await searchRestaurants(sessionFixture(),origin,3000,provider,async input=>({version:1,provider:"laya",model:"test",revision:"test",confidence:null,confidenceKind:"none",latencyMs:0,fallbackReason:null,entries:input.candidates.map(c=>({id:c.id,score:Number(c.id.slice(1))/12,weight:1/input.candidates.length}))}),signal(),deps);
 expect(result.candidates).toHaveLength(10);
 expect(translate).toHaveBeenCalledTimes(10);
 expect(result.restaurantSummaries.map(s=>s.placeId).sort()).toEqual(result.candidates.map(c=>c.placeId).sort());
 expect(translate.mock.calls.every(([text])=>text.includes("Walking: distanceMeters=800, duration=360s."))).toBe(true);
 expect(Object.keys(result.candidates[0]).sort()).toEqual(["placeId","score","weight"]);
});
