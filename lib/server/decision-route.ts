import "server-only";
import { authenticate } from "./auth";
import { adminServices } from "./firebase";
import { apiResponse, ApiError, parseBody, requireOrigin } from "./http";
import { decisionRepository, recommendInput } from "./decisions";
import { createSessionInput, answerInput } from "../domain/schema";
export function decisionRoute(
  request: Request,
  kind: "create" | "answer" | "recommend",
  id?: string,
) {
  let requestId: string = crypto.randomUUID();
  return apiResponse(
    async () => {
      const user = await authenticate(request);
      requireOrigin(request);
      const repository = decisionRepository(adminServices().db, user);
      if (kind === "create") {
        const input = await parseBody(request, createSessionInput);
        requestId = input.requestId;
        return repository.create(input);
      }
      if (kind === "answer") {
        const input = await parseBody(request, answerInput);
        requestId = input.requestId;
        return repository.answer(id!, input);
      }
      const input = await parseBody(request, recommendInput);
      requestId = input.requestId;
      await repository.recommend(id!, input);
      // M3 records the stop transition; required Places is explicitly unavailable until M6.
      throw new ApiError(
        503,
        "PLACES_NOT_CONFIGURED",
        "答案已儲存；餐廳搜尋未接通，暫時未有餐廳推薦。",
        true,
      );
    },
    () => requestId,
  );
}
