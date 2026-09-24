import {describe, it, expect} from "vitest";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {installedRecipe, encodeLaya} from "../lib/laya/recipe";
import {LayaService} from "../lib/laya/service";
import {vi} from "vitest";
import {HuggingFaceLayaProvider} from "../lib/laya/provider";
import {unknownPreferences} from "../lib/domain/schema";
import {validateRanking} from "../lib/laya/provider";
import type {DecisionInput} from "../lib/providers/contracts";
const input = (): DecisionInput => ({version:1, stage:"archetype", candidates:[
  {id:"a",features:{speed:{value:.9,confidence:.6,source:"rule"}}},
  {id:"b",features:{speed:{value:.1,confidence:.6,source:"rule"}}}],
  preferences:unknownPreferences(),priors:{},context:{rain:null,nextEventSoon:null}});
describe("verified HF handler recipe",()=>{
 it("no-evidence fallback neither calls HF nor trips circuit health",async()=>{
  const transport=vi.fn();const record=vi.fn(async()=>{});
  const p=new HuggingFaceLayaProvider("https://example.endpoints.huggingface.cloud","test",installedRecipe,input(),transport);
  const store={circuitOpen:async()=>false,record,acquire:async()=>true,release:async()=>{}};
  const result=await new LayaService(p,store).rank(input());
  expect(result.provider).toBe("heuristic");expect(result.fallbackReason).toBe("laya_no_preference_evidence");
  expect(transport).not.toHaveBeenCalled();expect(record).not.toHaveBeenCalled();
 });
 it("keeps no-evidence sessions deterministic",()=>{expect(()=>encodeLaya(input())).toThrow("laya_no_preference_evidence");});
 it("binds the fixture and validates all real candidate vectors",()=>{
  const text=readFileSync("tests/fixtures/laya/hf-smoke.json","utf8");
  expect(createHash("sha256").update(text).digest("hex")).toBe(installedRecipe.fixtureSha256);
  for(const c of JSON.parse(text).cases){
   const i=input();i.candidates=c.request.inputs.candidates.map((x:{id:string})=>({id:x.id,features:{}}));
   expect(validateRanking(installedRecipe.decode(c.response),i).entries).toHaveLength(i.candidates.length);
   expect(()=>installedRecipe.decode({...c.response,modelRevision:"wrong"})).toThrow();
  }
 });
 it("preserves high=fast/healthy and neutral suppression of priors",()=>{
  const i=input();i.preferences.speed={state:"answered",value:.8,strength:1};
  i.preferences.healthiness={state:"answered",value:.8,strength:1};
  i.preferences.price={state:"neutral",value:null,strength:0};
  i.priors.price={state:"inferred",value:.9,strength:.25};
  const payload=encodeLaya(i).body.inputs;
  expect(payload.state).toContain("speed=fast");expect(payload.state).toContain("healthiness=healthy");
  expect(payload.state).toContain("neutral: price");expect(payload.state).not.toContain("price: weak");
  expect(payload.candidates[0].description).toContain("0.9@0.6");
  expect(payload.candidates[0].description).toContain("?");
 });
 it("keeps explicit answers above conflicting priors and rejects nonfinite evidence",()=>{
  const i=input();i.preferences.speed={state:"answered",value:.8,strength:1};
  i.priors.speed={state:"inferred",value:.1,strength:.25};
  expect(encodeLaya(i).body.inputs.state).toContain("speed: explicit=0.8 strength=1");
  i.candidates[0].features.speed!.value=NaN;expect(()=>encodeLaya(i)).toThrow();
 });
});
