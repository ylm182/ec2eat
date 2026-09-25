import { afterEach, expect, it, vi } from "vitest";
import { rankRestaurantPool } from "../lib/restaurants/ranking";
import { unknownPreferences } from "../lib/domain/schema";
import { HeuristicDecisionProvider } from "../lib/providers/heuristic";
import { LayaFailure } from "../lib/laya/provider";
import type { DecisionInput, DecisionResult } from "../lib/providers/contracts";
const input = (n: number): DecisionInput => ({version:1,stage:"restaurant",preferences:unknownPreferences(),priors:{},context:{rain:null,nextEventSoon:null},candidates:Array.from({length:n},(_,i)=>({id:`r-${String(i).padStart(2,"0")}`,distanceM:i,features:{}}))});
// Deliberately unhelpful batch weights: the pool must rank on absolute scores.
const response = (batch: DecisionInput): DecisionResult => ({version:1,provider:"laya",model:"test",revision:"test",confidence:null,confidenceKind:"none",latencyMs:1,fallbackReason:null,entries:batch.candidates.map(c=>({id:c.id,score:Number(c.id.slice(2))/50,weight:1/batch.candidates.length}))});
afterEach(()=>vi.useRealTimers());
it.each([1,10,11,20,21,50])("independently scores all %i candidates exactly once and merges raw scores", async n => {
  const rank = vi.fn(async (batch:DecisionInput)=>response(batch));
  const result = await rankRestaurantPool(input(n),rank,new AbortController().signal);
  expect(result.provider).toBe("laya");
  expect(result.entries).toHaveLength(n);
  expect(rank).toHaveBeenCalledTimes(Math.ceil(n/10));
  expect(rank.mock.calls.every(([b])=>b.candidates.length<=10)).toBe(true);
  expect(rank.mock.calls.flatMap(([b])=>b.candidates.map(c=>c.id))).toEqual(input(n).candidates.map(c=>c.id));
  expect(result.entries.map(e=>e.id)).toEqual(input(n).candidates.map(c=>c.id).reverse());
  expect(result.entries.reduce((sum,e)=>sum+e.weight,0)).toBeCloseTo(1);
  if(n===20 || n===50) expect(result.entries.slice(0,10).map(e=>e.id)).toEqual(input(n).candidates.slice(n-10).reverse().map(c=>c.id));
});
it("uses stable tie ordering and valid display weights even when every score is zero",async()=>{
 const rank=async(b:DecisionInput)=>({...response(b),entries:response(b).entries.map(e=>({...e,score:0}))});
 const result=await rankRestaurantPool(input(20),rank,new AbortController().signal);
 expect(result.entries.map(e=>e.id)).toEqual(input(20).candidates.map(c=>c.id));
 expect(result.entries.every(e=>e.score===0&&e.weight===.05)).toBe(true);
});
it("never mixes heuristic and model scales and preserves the failing batch reason",async()=>{
 const pool=input(50);let calls=0;
 const result=await rankRestaurantPool(pool,async b=>{if(++calls===2)throw new LayaFailure("laya_http_503");return response(b);},new AbortController().signal);
 expect(result.provider).toBe("heuristic");
 expect(result.entries).toEqual((await new HeuristicDecisionProvider().rank(pool,new AbortController().signal)).entries);
 expect(result.fallbackReason).toBe("laya_score_fallback:batch_2:laya_http_503");
 expect(calls).toBe(2);
});
it("rejects malformed IDs and out-of-range scores",async()=>{
 for(const entry of [{id:"invented",score:1,weight:1},{id:"r-00",score:1.1,weight:1}]){
  const result=await rankRestaurantPool(input(1),async b=>({...response(b),entries:[entry]}),new AbortController().signal);
  expect(result.provider).toBe("heuristic");
 }
});
it("bounds waiting and identifies timeout",async()=>{
 vi.useFakeTimers();
 const result=rankRestaurantPool(input(50),async()=>new Promise(()=>{}),new AbortController().signal);
 await vi.advanceTimersByTimeAsync(120001);
 expect((await result).fallbackReason).toBe("laya_score_fallback:batch_1:laya_timeout");
});
it("propagates parent cancellation without starting further batches",async()=>{
 const controller=new AbortController();let calls=0;
 await expect(rankRestaurantPool(input(50),async b=>{calls++;controller.abort();return response(b);},controller.signal)).rejects.toThrow();
 expect(calls).toBe(1);
});
