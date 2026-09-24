import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse } from "@/lib/server/http";
import { restaurantRepository } from "@/lib/server/restaurants";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return apiResponse(async () => {
    const user = await authenticate(request);
    return restaurantRepository(adminServices().db, user).cards(
      (await context.params).id,
    );
  });
}
