import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { actualSearchInput } from "@/lib/outcomes/contracts";
import { searchActualRestaurants } from "@/lib/server/actual-restaurants";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  let requestId: string = crypto.randomUUID();
  return apiResponse(
    async () => {
      const user = await authenticate(request);
      requireOrigin(request);
      const input = await parseBody(request, actualSearchInput);
      requestId = input.requestId;
      return searchActualRestaurants(adminServices().db, user, input);
    },
    () => requestId,
  );
}
