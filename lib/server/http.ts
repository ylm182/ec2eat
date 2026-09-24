import "server-only";
import { recordApiMetric } from "./telemetry";
import { ZodError, type ZodType } from "zod";
import { serverConfig } from "./config";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function requireOrigin(request: Request) {
  if (
    request.headers.get("origin") !== new URL(serverConfig().APP_ORIGIN).origin
  )
    throw new ApiError(403, "INVALID_ORIGIN", "要求來源不符。");
}
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const raw = await request.text();
  if (raw.length > 16384)
    throw new ApiError(422, "INVALID_INPUT", "要求內容太長。");
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new ApiError(422, "INVALID_INPUT", "要求內容不正確。");
  }
}
export async function apiResponse(
  run: () => Promise<unknown>,
  requestId: string | (() => string) = crypto.randomUUID(),
  route = "api",
) {
  const started = performance.now();
  const metric = (status: number, code: string | null, data?: unknown) =>
    recordApiMetric(
      route,
      typeof requestId === "function" ? requestId() : requestId,
      performance.now() - started,
      status,
      code,
      data,
    );
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Authorization, Origin",
  };
  try {
    const data = await run();
    metric(200, null, data);
    const revision =
      data && typeof data === "object" && "revision" in data
        ? data.revision
        : undefined;
    return Response.json(
      {
        data,
        revision,
        requestId: typeof requestId === "function" ? requestId() : requestId,
      },
      { headers },
    );
  } catch (error) {
    const safe =
      error instanceof ApiError
        ? error
        : error instanceof ZodError
          ? new ApiError(422, "INVALID_INPUT", "要求內容不正確。")
          : new ApiError(
              503,
              "SERVICE_UNAVAILABLE",
              "暫時未能連線，請稍後再試。",
              true,
            );
    metric(safe.status, safe.code);
    return Response.json(
      {
        error: {
          code: safe.code,
          message: safe.message,
          retryable: safe.retryable,
        },
        requestId: typeof requestId === "function" ? requestId() : requestId,
      },
      { status: safe.status, headers },
    );
  }
}
