import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, requireOrigin } from "@/lib/server/http";
import { layaService } from "@/lib/server/laya";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return apiResponse(async () => {
    await authenticate(request);
    requireOrigin(request);
    return layaService(adminServices().db).warm("app", crypto.randomUUID());
  });
}
