import { z } from "zod";
import { sessionSchema, type DecisionSession } from "../domain/schema";
export const historyPageSchema = z
  .object({
    sessions: z.array(sessionSchema).max(20),
    nextCursor: z.string().max(256).nullable(),
  })
  .strict();
// Redact expired/licensing-ineligible context in the read projection only.
// The app-owned question wording and answers remain the originally saved values.
export function historySnapshot(
  session: DecisionSession,
  now = Date.now(),
): DecisionSession {
  const copy = structuredClone(session);
  for (const kind of ["weather", "calendar"] as const) {
    const field = copy.context[kind];
    if (
      field &&
      (!field.provenance.persistAllowed ||
        (field.provenance.expiresAt !== null &&
          Date.parse(field.provenance.expiresAt) <= now))
    ) {
      copy.context[kind] = null;
      copy.context.availability[kind] = "absent";
    }
  }
  return copy;
}
export const outcomeLabels: Record<
  DecisionSession["outcome"]["status"],
  string
> = {
  PENDING: "未確認到訪",
  VISITED_SELECTED: "已確認去咗所選餐廳",
  VISITED_OTHER: "去了其他地方",
  DID_NOT_EAT_OUT: "最後沒有外食",
};
export function hongKongTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
