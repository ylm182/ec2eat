import { bounded } from "../providers/google-context";
import { HeuristicDecisionProvider } from "../providers/heuristic";
import { validateRanking } from "../laya/provider";
import type { DecisionInput, DecisionResult } from "../providers/contracts";
export type RestaurantRanker = (input: DecisionInput, signal?: AbortSignal) => Promise<DecisionResult>;
// Tournament scores are only compared within their own batch. The final ten are
// rescored together; this is an approximate shortlist, not a global probability.
export async function rankRestaurantPool(input: DecisionInput, rank: RestaurantRanker, signal: AbortSignal): Promise<DecisionResult> {
  const started = performance.now();
  try {
    return await bounded(20000, async deadline => {
      const run = async (candidates: DecisionInput["candidates"]) => {
        deadline.throwIfAborted();
        const batch = { ...input, candidates };
        const result = await rank(batch, deadline);
        deadline.throwIfAborted();
        if (result.provider !== "laya") throw new Error(result.fallbackReason ?? "laya_unavailable");
        const valid = validateRanking({entries:result.entries,confidence:result.confidence},batch);
        return {...result, entries:valid.entries};
      };
      if (input.candidates.length <= 10) return await run(input.candidates);
      const count = Math.ceil(input.candidates.length / 10);
      const groups = Array.from({length:count}, () => [] as DecisionInput["candidates"]);
      input.candidates.forEach((c,i) => groups[i % count].push(c));
      const finalists: DecisionInput["candidates"] = [];
      for (let i = 0; i < count; i++) {
        const result = await run(groups[i]);
        const quota = Math.floor(10/count) + (i < 10 % count ? 1 : 0);
        finalists.push(...result.entries.slice(0,quota).map(e => groups[i].find(c => c.id === e.id)!));
      }
      const final = await run(finalists);
      return {...final,latencyMs:performance.now()-started};
    },signal);
  } catch {
    signal.throwIfAborted();
    return {...await new HeuristicDecisionProvider().rank(input,signal),fallbackReason:"laya_tournament_fallback",latencyMs:performance.now()-started};
  }
}
