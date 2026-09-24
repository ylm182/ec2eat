import { z } from "zod";
import type {
  DecisionInput,
  DecisionProvider,
  DecisionResult,
} from "../providers/contracts";
export const MODEL = "convaiinnovations/laya-multilingual";
export class LayaFailure extends Error {
  constructor(
    public reason: string,
    public transient = false,
  ) {
    super(reason);
  }
}
// A deployment-specific recipe is installed only after a real sanitized smoke fixture verifies it.
export interface VerifiedLayaRecipe {
  readonly modelRevision: string;
  readonly runtimeVersion: string;
  readonly fixtureSha256: string;
  encode(input: DecisionInput): { path: string; body: unknown };
  decode(response: unknown): unknown;
}
const resultSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            id: z.string().min(1),
            score: z.number().finite(),
            weight: z.number().finite().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    confidence: z.number().finite().min(0).max(1).nullable(),
  })
  .strict();
export function validateRanking(raw: unknown, input: DecisionInput) {
  const result = resultSchema.parse(raw);
  const ids = new Set(input.candidates.map((c) => c.id));
  if (
    ids.size !== input.candidates.length ||
    result.entries.length !== ids.size ||
    new Set(result.entries.map((e) => e.id)).size !== ids.size ||
    result.entries.some((e) => !ids.has(e.id)) ||
    Math.abs(result.entries.reduce((sum, e) => sum + e.weight, 0) - 1) > 1e-6
  )
    throw new LayaFailure("laya_invalid_output");
  return {
    ...result,
    entries: [...result.entries].sort(
      (a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  };
}
export class HuggingFaceLayaProvider implements DecisionProvider {
  constructor(
    private endpoint: string,
    private token: string,
    private recipe: VerifiedLayaRecipe,
    private warmInput: DecisionInput,
    private transport: typeof fetch = fetch,
  ) {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".endpoints.huggingface.cloud") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new LayaFailure("laya_invalid_endpoint");
    if (
      !/^[a-f0-9]{40}$/.test(recipe.modelRevision) ||
      !recipe.runtimeVersion ||
      !/^[a-f0-9]{64}$/.test(recipe.fixtureSha256) ||
      !token
    )
      throw new LayaFailure("laya_unverified_contract");
  }
  async rank(
    input: DecisionInput,
    signal: AbortSignal,
  ): Promise<DecisionResult> {
    signal.throwIfAborted();
    const started = performance.now();
    if (
      input.candidates.length < 1 ||
      input.candidates.length > 10 ||
      Buffer.byteLength(JSON.stringify(input)) > 16000
    )
      throw new LayaFailure("laya_input_limit");
    const request = this.recipe.encode(input);
    const url = new URL(request.path, this.endpoint);
    if (url.origin !== new URL(this.endpoint).origin || url.search || url.hash)
      throw new LayaFailure("laya_invalid_route");
    let response: Response;
    try {
      response = await this.transport(url, {
        method: "POST",
        redirect: "error",
        signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
    } catch {
      throw new LayaFailure(
        signal.aborted ? "laya_timeout" : "laya_network",
        !signal.aborted,
      );
    }
    if (!response.ok)
      throw new LayaFailure(
        `laya_http_${response.status}`,
        [502, 503, 504, 429].includes(response.status),
      );
    try {
      const text = await response.text();
      if (text.length > 65536) throw new Error("large");
      const decoded = validateRanking(
        this.recipe.decode(JSON.parse(text)),
        input,
      );
      return {
        version: 1,
        ...decoded,
        confidenceKind:
          decoded.confidence === null ? "none" : "provider_uncalibrated",
        provider: "laya",
        model: MODEL,
        revision: this.recipe.modelRevision,
        latencyMs: performance.now() - started,
        fallbackReason: null,
      };
    } catch {
      throw new LayaFailure("laya_invalid_output");
    }
  }
  async warm(signal: AbortSignal) {
    await this.rank(this.warmInput, signal);
    return { ready: true };
  }
}
