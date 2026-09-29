import { z } from "zod";
import { sessionSchema } from "../domain/schema";
import { placeIdSchema } from "./types";
export type DisplaySummary = { placeId: string; text: string };
export function parseRecommendation(raw: unknown) {
  const { restaurantSummaries, ...rest } = z.object({ restaurantSummaries: z.array(z.object({ placeId: placeIdSchema, text: z.string().trim().min(1).max(650) })).max(10).optional() }).passthrough().parse(raw);
  const session = sessionSchema.parse(rest);
  return { session, summaries: (restaurantSummaries ?? []).filter(x => session.decision.candidates.some(c => c.placeId === x.placeId)) };
}
