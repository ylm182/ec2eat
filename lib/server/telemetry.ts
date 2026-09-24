import "server-only";
import { createHash } from "node:crypto";
import { sessionSchema } from "../domain/schema";
const reference = (v: string) =>
  createHash("sha256").update(v).digest("hex").slice(0, 24);
/** Fixed projection: no errors, request bodies, coordinates, event text or provider payloads. */
export function apiMetric(
  route: string,
  requestId: string,
  durationMs: number,
  status: number,
  code: string | null,
  data?: unknown,
) {
  const wrapper =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const parsed = sessionSchema.safeParse(wrapper.session ?? data);
  const s = parsed.success ? parsed.data : null;
  return {
    event: "api_request",
    route,
    requestRef: reference(requestId),
    durationMs: Math.round(durationMs),
    status,
    errorCategory: code,
    ...(s
      ? {
          sessionRef: reference(s.id),
          userRef: reference(s.uid),
          provider: s.decision.provider,
          modelRevisionRef: s.decision.modelRevision
            ? reference(s.decision.modelRevision)
            : null,
          fallback: !!s.decision.fallbackReason,
          questionCount: s.questions.length,
          stopReason: s.decision.stopReason,
          outcome: s.outcome.status,
          candidateCount: s.decision.candidates.length,
        }
      : {}),
  };
}
export function recordApiMetric(...args: Parameters<typeof apiMetric>) {
  // Logging must never change the committed API result.
  try {
    console.info(JSON.stringify(apiMetric(...args)));
  } catch {
    /* unavailable log sink */
  }
}
export async function providerMetric<T>(
  provider: "google-places" | "laya",
  operation: "nearby" | "text" | "details" | "rank" | "warm",
  run: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let success = false;
  let result: T | undefined;
  try {
    result = await run();
    success = true;
    return result;
  } finally {
    const value =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
    try {
      console.info(
        JSON.stringify({
          event: "provider_request",
          provider,
          operation,
          durationMs: Math.round(performance.now() - start),
          success,
          fieldMaskCategory:
            provider === "google-places"
              ? operation === "details"
                ? "display-details"
                : "search-minimal"
              : null,
          operationCount: 1,
          fallback: typeof value.fallbackReason === "string",
          warmupStatus: ["ready", "warming", "unavailable"].includes(
            String(value.status),
          )
            ? value.status
            : null,
        }),
      );
    } catch {
      /* unavailable log sink */
    }
  }
}
