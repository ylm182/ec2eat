import { rankCandidates } from "../domain/engine";
import { ENGINE_VERSION } from "../domain/catalog";
import type { DecisionProvider } from "./contracts";
export class HeuristicDecisionProvider implements DecisionProvider {
  async rank(
    input: Parameters<DecisionProvider["rank"]>[0],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const start = performance.now();
    const entries = rankCandidates(
      input.candidates.map((c) => ({ ...c, label: c.id })),
      input.preferences,
      input.priors,
      input.categoryPreference,
    );
    return {
      version: 1 as const,
      entries,
      confidence: null,
      confidenceKind: "none" as const,
      provider: "heuristic" as const,
      model: null,
      revision: ENGINE_VERSION,
      latencyMs: performance.now() - start,
      fallbackReason: "laya_not_configured",
    };
  }
  async warm(signal: AbortSignal) {
    signal.throwIfAborted();
    return { ready: false };
  }
}
