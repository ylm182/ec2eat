import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { restaurantRepository, selectInput } from "@/lib/server/restaurants";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let requestId: string = crypto.randomUUID();
  return apiResponse(
    async () => {
      const user = await authenticate(request);
      requireOrigin(request);
      const input = await parseBody(request, selectInput);
      requestId = input.requestId;
      return restaurantRepository(adminServices().db, user).select(
        (await context.params).id,
        input,
      );
    },
    () => requestId,
    "restaurant.select",
  );
}
