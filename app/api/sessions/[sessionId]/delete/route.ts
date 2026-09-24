import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { deletionRepository, deleteSessionInput } from "@/lib/server/deletion";
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return apiResponse(async () => {
    requireOrigin(request);
    const user = await authenticate(request);
    const { sessionId } = await context.params;
    return deletionRepository(adminServices().db, user).session(
      sessionId,
      await parseBody(request, deleteSessionInput),
    );
  });
}
