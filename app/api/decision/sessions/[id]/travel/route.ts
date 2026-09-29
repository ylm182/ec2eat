import { z } from "zod";
import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { restaurantRepository } from "@/lib/server/restaurants";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ location: z.object({ latitude: z.number().min(22.15).max(22.58), longitude: z.number().min(113.83).max(114.45) }).strict().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const user = await authenticate(request); requireOrigin(request);
    const body = await parseBody(request, input);
    return restaurantRepository(adminServices().db, user).travel((await context.params).id, body.location);
  });
}
