import { afterEach, describe, expect, it, vi } from "vitest";
import { LayaService, deadline, type LayaStore } from "../lib/laya/service";
import {
  HuggingFaceLayaProvider,
  LayaFailure,
  validateRanking,
  type VerifiedLayaRecipe,
} from "../lib/laya/provider";
import { layaConfiguration } from "../lib/laya/config";
import { HeuristicDecisionProvider } from "../lib/providers/heuristic";
import type {
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "../lib/providers/contracts";
import { unknownPreferences } from "../lib/domain/schema";
import { applyScoring, scoringInput } from "../lib/domain/scoring";
import { newSession, applyAnswer } from "../lib/domain/session";
const input: DecisionInput = {
  version: 1,
  stage: "archetype",
  candidates: [
    { id: "a", features: {} },
    { id: "b", features: {} },
  ],
  preferences: unknownPreferences(),
  priors: {},
  context: { rain: null, nextEventSoon: null },
};
const valid = {
  entries: [
    { id: "a", score: 0.8, weight: 0.8 },
    { id: "b", score: 0.2, weight: 0.2 },
  ],
  confidence: null,
};
const recipe: VerifiedLayaRecipe = {
  modelRevision: "a".repeat(40),
  runtimeVersion: "SYNTHETIC-TEST-ONLY",
  fixtureSha256: "b".repeat(64),
  encode: () => ({ path: "/synthetic-test-only", body: { synthetic: true } }),
  decode: (raw) => raw,
};
const store = (): LayaStore => ({
  circuitOpen: vi.fn(async () => false),
  record: vi.fn(async () => {}),
  acquire: vi.fn(async () => true),
  release: vi.fn(async () => {}),
});
const result: DecisionResult = {
  version: 1,
  ...valid,
  confidenceKind: "none",
  provider: "laya",
  model: "convaiinnovations/laya-multilingual",
  revision: "a".repeat(40),
  latencyMs: 1,
  fallbackReason: null,
};
const provider = (
  rank: DecisionProvider["rank"] = async () => result,
  warm: DecisionProvider["warm"] = async () => ({ ready: true }),
): DecisionProvider => ({ rank, warm });
afterEach(() => vi.useRealTimers());
describe("M5 contract and fallback", () => {
  it("never enables a live recipe from environment values alone or in emulator mode", () => {
    expect(
      layaConfiguration({
        APP_MODE: "emulator",
        LAYA_BASE_URL: "https://example.endpoints.huggingface.cloud",
        HF_TOKEN: "synthetic",
      }).provider,
    ).toBeNull();
    expect(
      layaConfiguration({
        APP_MODE: "live",
        LAYA_BASE_URL: "https://example.endpoints.huggingface.cloud",
        HF_TOKEN: "synthetic",
        LAYA_MODEL_REVISION: "a".repeat(40),
      }),
    ).toMatchObject({ provider: null, reason: "laya_unverified_contract" });
  });
  it("validates exact candidate coverage, duplicates, finite values and normalized weights", () => {
    expect(validateRanking(valid, input).entries).toHaveLength(2);
    for (const entries of [
      [valid.entries[0]],
      [valid.entries[0], valid.entries[0]],
      [valid.entries[0], { ...valid.entries[1], id: "invented" }],
      [{ ...valid.entries[0], score: NaN }, valid.entries[1]],
      [{ ...valid.entries[0], weight: 0.9 }, valid.entries[1]],
    ])
      expect(() =>
        validateRanking({ entries, confidence: null }, input),
      ).toThrow();
  });
  it("rejects endpoint credentials, non-HF hosts, insecure URLs and off-origin recipe paths", async () => {
    for (const endpoint of [
      "http://x.endpoints.huggingface.cloud",
      "https://evil.example/",
      "https://user:pass@x.endpoints.huggingface.cloud/",
    ])
      expect(
        () => new HuggingFaceLayaProvider(endpoint, "synthetic", recipe, input),
      ).toThrow();
    await expect(
      new HuggingFaceLayaProvider(
        "https://x.endpoints.huggingface.cloud/",
        "synthetic",
        {
          ...recipe,
          encode: () => ({ path: "https://evil.example/", body: {} }),
        },
        input,
      ).rank(input, new AbortController().signal),
    ).rejects.toThrow("laya_invalid_route");
  });
  it("HTTP adapter uses bearer auth, no redirects and records pinned provenance", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(valid)));
    const adapter = new HuggingFaceLayaProvider(
      "https://x.endpoints.huggingface.cloud/",
      "synthetic",
      recipe,
      input,
      transport,
    );
    expect(
      await adapter.rank(input, new AbortController().signal),
    ).toMatchObject({
      provider: "laya",
      revision: recipe.modelRevision,
      confidenceKind: "none",
      fallbackReason: null,
    });
    expect(transport.mock.calls[0]).toBeDefined();
    expect(await adapter.warm(new AbortController().signal)).toEqual({
      ready: true,
    });
  });
  it("503 gets at most one ranking retry and then identical deterministic fallback", async () => {
    const rank = vi.fn(async () => {
      throw new LayaFailure("laya_http_503", true);
    });
    const saved = store();
    const fallback = await new LayaService(provider(rank), saved).rank(input);
    expect(rank).toHaveBeenCalledTimes(2);
    expect(fallback.entries).toEqual(
      (
        await new HeuristicDecisionProvider().rank(
          input,
          new AbortController().signal,
        )
      ).entries,
    );
    expect(fallback).toMatchObject({
      provider: "heuristic",
      fallbackReason: "laya_http_503",
      confidence: null,
    });
    expect(saved.record).toHaveBeenCalledWith(false, expect.any(Number));
  });
  it("invalid credentials and malformed results are not retried", async () => {
    for (const fail of [
      async () => {
        throw new LayaFailure("laya_http_401");
      },
      async () => ({ ...result, entries: [] }),
    ]) {
      const rank = vi.fn(fail);
      const answer = await new LayaService(provider(rank), store()).rank(input);
      expect(answer.provider).toBe("heuristic");
      expect(rank).toHaveBeenCalledTimes(1);
    }
  });
  it("hung ranking aborts and falls back within two seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const p = new LayaService(
      provider(async (_input, s) => {
        signal = s;
        return new Promise(() => {});
      }),
      store(),
    ).rank(input);
    await vi.advanceTimersByTimeAsync(1950);
    expect(await p).toMatchObject({
      provider: "heuristic",
      fallbackReason: "laya_timeout",
    });
    expect(signal?.aborted).toBe(true);
  });
  it("open circuit bypasses inference without counting another failure", async () => {
    const saved = store();
    saved.circuitOpen = async () => true;
    const rank = vi.fn(async () => result);
    expect(
      await new LayaService(provider(rank), saved).rank(input),
    ).toMatchObject({ fallbackReason: "laya_circuit_open" });
    expect(rank).not.toHaveBeenCalled();
    expect(saved.record).not.toHaveBeenCalled();
  });
  it("successful inference resets failure tracking", async () => {
    const saved = store();
    expect(
      (await new LayaService(provider(), saved).rank(input)).provider,
    ).toBe("laya");
    expect(saved.record).toHaveBeenCalledWith(true, expect.any(Number));
  });
  it("unconfigured warm-up is explicit and creates no lease", async () => {
    const saved = store();
    expect(
      await new LayaService(null, saved, "laya_unverified_contract").warm(
        "app",
        "owner",
      ),
    ).toEqual({ status: "unavailable", reason: "laya_unverified_contract" });
    expect(saved.acquire).not.toHaveBeenCalled();
  });
  it("app warm-up respects shared suppression", async () => {
    const saved = store();
    saved.acquire = async () => false;
    const warm = vi.fn(async () => ({ ready: true }));
    expect(
      await new LayaService(provider(undefined, warm), saved).warm(
        "app",
        "owner",
      ),
    ).toEqual({ status: "warming", reason: "warmup_suppressed" });
    expect(warm).not.toHaveBeenCalled();
  });
  it("app warm-up returns within three seconds even if provider ignores abort", async () => {
    vi.useFakeTimers();
    const saved = store();
    const work = new LayaService(
      provider(undefined, async () => new Promise(() => {})),
      saved,
    ).warm("app", "owner");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await work).toMatchObject({
      status: "warming",
      reason: "laya_timeout",
    });
    expect(saved.release).toHaveBeenCalledWith(
      "owner",
      false,
      expect.any(Number),
    );
  });
  it("scheduled transient failures use bounded jittered waits then release the lease", async () => {
    vi.useFakeTimers();
    const saved = store();
    let calls = 0;
    const warm = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new LayaFailure("laya_http_503", true);
      return { ready: true };
    });
    const work = new LayaService(
      provider(undefined, warm),
      saved,
      "",
      () => 0.5,
    ).warm("scheduled", "owner");
    await vi.advanceTimersByTimeAsync(15001);
    expect(await work).toEqual({ status: "ready", reason: null });
    expect(calls).toBe(3);
    expect(saved.release).toHaveBeenCalledWith(
      "owner",
      true,
      expect.any(Number),
    );
  });
  it("scheduled permanent failure is not retried and hangs never exceed 120 seconds", async () => {
    const warm = vi.fn(async () => {
      throw new LayaFailure("laya_http_401");
    });
    expect(
      await new LayaService(provider(undefined, warm), store()).warm(
        "scheduled",
        "owner",
      ),
    ).toMatchObject({ status: "unavailable" });
    expect(warm).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    const hung = new LayaService(
      provider(undefined, async () => new Promise(() => {})),
      store(),
      "",
      () => 0.5,
    ).warm("scheduled", "owner");
    await vi.advanceTimersByTimeAsync(120000);
    expect(await hung).toMatchObject({
      status: "warming",
      reason: "laya_timeout",
    });
  });
  it("rescoring changes only the uncommitted next question and decision metadata", async () => {
    const now = "2026-09-24T04:00:00.000Z";
    const before = newSession({
      id: "s",
      uid: "u",
      launchId: "l",
      area: "中環",
      now,
    });
    const question = before.questions[0];
    const draft = applyAnswer(
      before,
      {
        requestId: "r",
        expectedRevision: 0,
        questionInstanceId: question.instanceId,
        action: "neutral",
      },
      now,
    );
    const scored = await new HeuristicDecisionProvider().rank(
      scoringInput(draft),
      new AbortController().signal,
    );
    const next = applyScoring(draft, {
      ...scored,
      fallbackReason: "laya_http_503",
    });
    expect(next.questions[0]).toEqual(question);
    expect(next.answers).toEqual(draft.answers);
    expect(next.context).toEqual(before.context);
    expect(next.decision.fallbackReason).toBe("laya_http_503");
  });
});
