import type {
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "../providers/contracts";
import { HeuristicDecisionProvider } from "../providers/heuristic";
import { LayaFailure, validateRanking } from "./provider";
export interface LayaStore {
  circuitOpen(now: number): Promise<boolean>;
  record(success: boolean, now: number): Promise<void>;
  acquire(
    owner: string,
    now: number,
    duration: number,
    suppress: boolean,
  ): Promise<boolean>;
  release(owner: string, success: boolean, now: number): Promise<void>;
}
export async function deadline<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new LayaFailure("laya_timeout", true));
    };
    parent?.addEventListener("abort", cancel, { once: true });
    if (parent?.aborted) cancel();
    timer = setTimeout(cancel, ms);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return run(controller.signal);
      }),
      aborted,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
export class LayaService {
  constructor(
    private provider: DecisionProvider | null,
    private store: LayaStore,
    private unavailable = "laya_not_configured",
    private random = Math.random,
  ) {}
  async rank(input: DecisionInput, parent?: AbortSignal): Promise<DecisionResult> {
    const start = performance.now();
    let reason = this.unavailable;
    if (this.provider) {
      try {
        const result = await deadline(input.stage === "restaurant" ? 30000 : 1750, async (signal) => {
          if (await this.store.circuitOpen(Date.now()))
            throw new LayaFailure("laya_circuit_open");
          signal.throwIfAborted();
          for (let attempt = 0; attempt < 2; attempt++)
            try {
              const result = await this.provider!.rank(input, signal);
              validateRanking(
                { entries: result.entries, confidence: result.confidence },
                input,
              );
              return result;
            } catch (error) {
              if (
                !(error instanceof LayaFailure) ||
                !error.transient ||
                attempt === 1
              )
                throw error;
              signal.throwIfAborted();
            }
          throw new LayaFailure("laya_failed");
        }, parent);
        await deadline(150, () => this.store.record(true, Date.now())).catch(
          () => {},
        );
        return result;
      } catch (error) {
        reason =
          error instanceof LayaFailure ? error.reason : "laya_invalid_output";
        if (reason !== "laya_circuit_open" && reason !== "laya_no_preference_evidence")
          await deadline(150, () => this.store.record(false, Date.now())).catch(
            () => {},
          );
      }
    }
    parent?.throwIfAborted();
    const fallback = await new HeuristicDecisionProvider().rank(
      input,
      new AbortController().signal,
    );
    return {
      ...fallback,
      latencyMs: performance.now() - start,
      fallbackReason: reason,
    };
  }
  async warm(
    mode: "app" | "scheduled",
    owner: string,
  ): Promise<{
    status: "ready" | "warming" | "unavailable";
    reason: string | null;
  }> {
    if (!this.provider)
      return { status: "unavailable", reason: this.unavailable };
    const budget = mode === "app" ? 3000 : 120000;
    let acquired = false;
    let success = false;
    try {
      return await deadline(budget - 150, async (signal) => {
        acquired = await this.store.acquire(
          owner,
          Date.now(),
          budget + 5000,
          mode === "app",
        );
        signal.throwIfAborted();
        if (!acquired)
          return { status: "warming" as const, reason: "warmup_suppressed" };
        const delays = mode === "app" ? [] : [5000, 10000, 20000, 40000];
        for (let attempt = 0; ; attempt++) {
          try {
            const ready = await deadline(
              mode === "app" ? 2700 : 8000,
              (s) => this.provider!.warm(s),
              signal,
            );
            if (!ready.ready) throw new LayaFailure("laya_warming", true);
            success = true;
            return { status: "ready" as const, reason: null };
          } catch (error) {
            if (
              !(error instanceof LayaFailure) ||
              !error.transient ||
              attempt >= delays.length
            )
              throw error;
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(new LayaFailure("laya_timeout", true));
              };
              const timer = setTimeout(
                () => {
                  signal.removeEventListener("abort", abort);
                  resolve();
                },
                delays[attempt] * (0.8 + 0.4 * this.random()),
              );
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
          }
        }
      });
    } catch (error) {
      return {
        status:
          error instanceof LayaFailure && error.transient
            ? "warming"
            : "unavailable",
        reason: error instanceof LayaFailure ? error.reason : "laya_failed",
      };
    } finally {
      if (acquired)
        await deadline(150, () =>
          this.store.release(owner, success, Date.now()),
        ).catch(() => {});
    }
  }
}
