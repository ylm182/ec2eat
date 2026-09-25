import { afterEach, expect, it, vi } from "vitest";
import { rankRestaurantPool } from "../lib/restaurants/ranking";
import { unknownPreferences } from "../lib/domain/schema";
import { HeuristicDecisionProvider } from "../lib/providers/heuristic";
import type { DecisionInput, DecisionResult } from "../lib/providers/contracts";
const input = (n: number): DecisionInput => ({version:1,stage:"restaurant",preferences:unknownPreferences(),priors:{},context:{rain:null,nextEventSoon:null},candidates:Array.from({length:n},(_,i)=>({id:`r-${i}`,distanceM:i,features:{}}))});
const response = (batch: DecisionInput): DecisionResult => ({version:1,provider:"laya",model:"test",revision:"test",confidence:null,confidenceKind:"none",latencyMs:1,fallbackReason:null,entries:[...batch.candidates].reverse().map((c,i)=>({id:c.id,score:batch.candidates.length-i,weight:(batch.candidates.length-i)/(batch.candidates.length*(batch.candidates.length+1)/2)}))});
afterEach(()=>vi.useRealTimers());
it.each([1,10,11,20,21,50])("ranks %i candidates within ten-option batches and rescoring finalists", async n => {
  const rank = vi.fn(async (batch:DecisionInput)=>response(batch));
  const result = await rankRestaurantPool(input(n),rank,new AbortController().signal);
  expect(result.provider).toBe("laya");
  expect(result.entries).toHaveLength(Math.min(n,10));
  expect(rank.mock.calls.every(([b])=>b.candidates.length<=10)).toBe(true);
  const rounds = n<=10 ? 1 : Math.ceil(n/10);
  expect(new Set(rank.mock.calls.slice(0,rounds).flatMap(([b])=>b.candidates.map(c=>c.id))).size).toBe(n);
  expect(rank).toHaveBeenCalledTimes(n<=10?1:rounds+1);
  expect(result.entries).toEqual(response(rank.mock.calls.at(-1)![0]).entries);
  expect(new Set(result.entries.map(e=>e.id)).size).toBe(Math.min(n,10));
});
it("abandons partial tournament scores when a middle batch fails",async()=>{
  const pool=input(50); let calls=0;
  const result=await rankRestaurantPool(pool,async b=>{if(++calls===2)throw Error("offline");return response(b);},new AbortController().signal);
  expect(result.provider).toBe("heuristic");
  expect(result.entries).toEqual((await new HeuristicDecisionProvider().rank(pool,new AbortController().signal)).entries);
  expect(result.entries).toHaveLength(50);
  expect(calls).toBe(2);
});
it("does not accept unknown candidate IDs",async()=>{
  const result=await rankRestaurantPool(input(20),async b=>({...response(b),entries:[{id:"invented",score:1,weight:1}]}),new AbortController().signal);
  expect(result.provider).toBe("heuristic");expect(result.entries.every(e=>e.id!=="invented")).toBe(true);
});
it("bounds tournament waiting and falls back on timeout",async()=>{
  vi.useFakeTimers();
  const result=rankRestaurantPool(input(50),async()=>new Promise(()=>{}),new AbortController().signal);
  await vi.advanceTimersByTimeAsync(20001);
  expect((await result).provider).toBe("heuristic");
});
