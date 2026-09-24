import { authenticate } from "@/lib/server/auth";
import { adminServices } from "@/lib/server/firebase";
import { apiResponse, parseBody, requireOrigin } from "@/lib/server/http";
import { openingInput } from "@/lib/outcomes/contracts";
import { outcomeRepository } from "@/lib/server/outcomes";
import { userRepository } from "@/lib/server/repository";
import { layaService } from "@/lib/server/laya";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  let requestId: string = crypto.randomUUID();
  return apiResponse(
    async () => {
      const user = await authenticate(request);
      requireOrigin(request);
      const input = await parseBody(request, openingInput);
      requestId = input.requestId;
      const { db } = adminServices();
      const [opening, profile, warmup] = await Promise.all([
        outcomeRepository(db, user).open(input),
        userRepository(db, user).profile(),
        layaService(db)
          .warm("app", input.launchId)
          .catch(() => ({ status: "unavailable", reason: "warmup_failed" })),
      ]);
      return { ...opening, profile, warmup };
    },
    () => requestId,
  );
}
