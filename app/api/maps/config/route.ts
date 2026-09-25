import { authenticate } from "@/lib/server/auth";
import { apiResponse, ApiError } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () => {
    await authenticate(request);
    const apiKey = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
    if (!apiKey) throw new ApiError(503, "MAPS_NOT_CONFIGURED", "地圖暫時未設定，可以用清單揀餐廳。");
    return { apiKey };
  });
}
