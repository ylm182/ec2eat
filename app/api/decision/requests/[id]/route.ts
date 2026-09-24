import { createHash } from "node:crypto";
import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse } from "@/lib/server/http";
import { userRepository } from "@/lib/server/repository";
import { idSchema } from "@/lib/domain/schema";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return apiResponse(async () => {
    const user = await authenticate(request);
    const requestId = idSchema.parse((await params).id);
    const id = createHash("sha256")
      .update(JSON.stringify({ uid: user.uid, requestId }))
      .digest("hex")
      .slice(0, 32);
    return userRepository(adminServices().db, user).session(id);
  });
}
