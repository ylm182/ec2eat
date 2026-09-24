import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { deletionRepository, deleteAccountInput } from "@/lib/server/deletion";
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireOrigin(request);
    const user = await authenticate(request, undefined, true);
    return deletionRepository(adminServices().db, user).account(
      await parseBody(request, deleteAccountInput),
    );
  });
}
