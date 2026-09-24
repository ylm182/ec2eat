import "server-only";
import { restaurantRepository } from "./restaurants";
import { authenticate } from "./auth";
import { adminServices } from "./firebase";
import { apiResponse, parseBody, requireOrigin } from "./http";
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
      return restaurantRepository(adminServices().db, user).recommend(
        id!,
        input,
      );
    },
    () => requestId,
    `decision.${kind}`,
  );
}
