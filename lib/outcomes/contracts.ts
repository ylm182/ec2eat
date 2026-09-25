import { z } from "zod";
import { idSchema, type DecisionSession } from "../domain/schema";
import { placeIdSchema } from "../restaurants/types";
export const openingInput = z
  .object({ requestId: idSchema, launchId: idSchema })
  .strict();
export const outcomeInput = z
  .object({
    requestId: idSchema,
    launchId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    expectedOutcomeRevision: z.number().int().nonnegative(),
    status: z
      .enum(["VISITED_SELECTED", "VISITED_OTHER", "DID_NOT_EAT_OUT"])
      .optional(),
    snooze: z.literal(true).optional(),
    actualPlaceId: placeIdSchema.nullable().optional(),
    lookupRequestId: idSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.snooze) === Boolean(v.status))
      ctx.addIssue({ code: "custom", message: "Choose one outcome or snooze" });
    if (
      v.status !== "VISITED_OTHER" &&
      (v.actualPlaceId !== undefined || v.lookupRequestId !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Only other visits accept actual place",
      });
    if (
      v.status === "VISITED_OTHER" &&
      Boolean(v.actualPlaceId) !== Boolean(v.lookupRequestId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Actual place requires lookup receipt",
      });
  });
export const actualSearchInput = z
  .object({
    requestId: idSchema,
    sessionId: idSchema,
    launchId: idSchema,
    query: z.string().trim().min(2).max(80),
  })
  .strict();
// Explicit confirmation (including History) is available immediately after selection.
export function canConfirm(s: DecisionSession, _launchId: string, _now: number) {
  return s.status === "SELECTED" && s.selectedAt !== null;
}
export function canPrompt(s: DecisionSession, launchId: string, now: number) {
  return (
    canConfirm(s, launchId, now) &&
    s.selectionLaunchId !== launchId &&
    s.outcome.eligibleAfter !== null &&
    now >= Date.parse(s.selectedAt!) + 4 * 3600000 &&
    now >= Date.parse(s.outcome.eligibleAfter) &&
    s.outcome.status === "PENDING" &&
    (s.outcome.snoozedUntil === null ||
      now >= Date.parse(s.outcome.snoozedUntil))
  );
}
