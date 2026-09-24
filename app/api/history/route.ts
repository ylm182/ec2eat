import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, ApiError } from "@/lib/server/http";
import { historyRepository } from "@/lib/server/history";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return apiResponse(async () => {
    const user = await authenticate(request);
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((k) => k !== "cursor") ||
      params.getAll("cursor").length > 1
    )
      throw new ApiError(422, "INVALID_INPUT", "歷史查詢格式不正確。");
    return historyRepository(adminServices().db, user).page(
      params.get("cursor") ?? undefined,
    );
  });
}
