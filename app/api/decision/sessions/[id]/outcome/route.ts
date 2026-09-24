import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { outcomeInput } from "@/lib/outcomes/contracts";
import { outcomeRepository } from "@/lib/server/outcomes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let requestId: string = crypto.randomUUID();
  return apiResponse(
    async () => {
      const user = await authenticate(request);
      requireOrigin(request);
      const input = await parseBody(request, outcomeInput);
      requestId = input.requestId;
      return outcomeRepository(adminServices().db, user).save(
        (await context.params).id,
        input,
      );
    },
    () => requestId,
  );
}
