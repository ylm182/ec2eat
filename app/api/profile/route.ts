import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse } from "@/lib/server/http";
import { userRepository } from "@/lib/server/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const user = await authenticate(request);
    return userRepository(adminServices().db, user).profile();
  });
}
