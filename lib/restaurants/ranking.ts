import { deadline as withDeadline } from "../laya/service";
import { HeuristicDecisionProvider } from "../providers/heuristic";
import { LayaFailure, validateRanking } from "../laya/provider";
import type { DecisionInput, DecisionResult } from "../providers/contracts";
export type RestaurantRanker = (input: DecisionInput, signal?: AbortSignal) => Promise<DecisionResult>;
/** Transport batches of ten; the handler scores each restaurant in isolation. */
export async function rankRestaurantPool(input: DecisionInput, rank: RestaurantRanker, signal: AbortSignal): Promise<DecisionResult> {
  const started = performance.now();
  let batchIndex = 0;
  try {
    return await withDeadline(120000, async deadline => {
      const entries: DecisionResult["entries"] = [];
      let last: DecisionResult | undefined;
      for (let offset = 0; offset < input.candidates.length; offset += 10) {
        batchIndex++;
        deadline.throwIfAborted();
        const batch = { ...input, candidates: input.candidates.slice(offset, offset + 10) };
        const result = await rank(batch, deadline);
        deadline.throwIfAborted();
        if (result.provider !== "laya") throw new LayaFailure(result.fallbackReason ?? "laya_unavailable");
        const valid = validateRanking({ entries: result.entries, confidence: result.confidence }, batch);
        if (valid.entries.some(e => e.score < 0 || e.score > 1)) throw new LayaFailure("laya_invalid_score");
        entries.push(...valid.entries);
        last = result;
      }
      if (!last) throw new LayaFailure("laya_empty_pool");
      // Batch weights are deliberately discarded. Only the absolute 0..1 scores compare.
      entries.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const total = entries.reduce((sum, e) => sum + e.score, 0);
      return { ...last, entries: entries.map(e => ({ ...e, weight: total ? e.score / total : 1 / entries.length })), latencyMs: performance.now() - started };
    }, signal);
  } catch (error) {
    signal.throwIfAborted();
    const reason = error instanceof LayaFailure ? error.reason : error instanceof Error && error.name === "AbortError" ? "laya_timeout" : "laya_invalid_output";
    // Do not mix the uncalibrated model scale with deterministic utility scores.
    return { ...await new HeuristicDecisionProvider().rank(input, signal), fallbackReason: `laya_score_fallback:batch_${batchIndex}:${reason}`, latencyMs: performance.now() - started };
  }
}
