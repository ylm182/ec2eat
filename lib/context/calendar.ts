import { z } from "zod";
import { manualAreas } from "../domain/areas";
export const eventSchema = z.object({
  id: z.string().min(1).max(1024),
  status: z.string().optional(),
  summary: z.string().max(4096).optional(),
  location: z.string().max(4096).optional(),
  start: z.object({
    dateTime: z.string().datetime({ offset: true }).optional(),
    date: z.string().optional(),
  }),
});
export type ContextEvent = z.infer<typeof eventSchema>;
export type CalendarHints = {
  version: 1;
  nextEventSoon: boolean;
  socialHint: boolean | null;
  areaHint: string | null;
  mealHint: "lunch" | "dinner" | null;
};
export function extractRules(
  events: ContextEvent[],
  now: string,
): CalendarHints {
  const active = events.filter((e) => e.status !== "cancelled");
  const words = active
    .map((e) => `${e.summary ?? ""} ${e.location ?? ""}`)
    .join("\n");
  const lunch = /午餐|午飯|lunch/i.test(words),
    dinner = /晚餐|晚飯|dinner/i.test(words);
  const areas = manualAreas.filter((a) => words.includes(a));
  return {
    version: 1,
    nextEventSoon: active.some((e) => {
      const delta = Date.parse(e.start.dateTime ?? "") - Date.parse(now);
      return delta >= 0 && delta <= 3600000;
    }),
    socialHint:
      /一齊|聚餐|聚會|朋友|同事|family|friends|team lunch|team dinner/i.test(
        words,
      )
        ? true
        : null,
    areaHint: areas.length === 1 ? areas[0] : null,
    mealHint: lunch !== dinner ? (lunch ? "lunch" : "dinner") : null,
  };
}
export const extractionSchema = z
  .object({
    socialHint: z.boolean().nullable(),
    areaHint: z.enum(manualAreas).nullable(),
    mealHint: z.enum(["lunch", "dinner"]).nullable(),
    evidenceIds: z.array(z.string().max(1024)).max(20),
  })
  .strict();
// A model claim must cite supplied events and be independently supported. Timing stays deterministic.
export function validateExtraction(
  raw: unknown,
  events: ContextEvent[],
  now: string,
): CalendarHints {
  const parsed = extractionSchema.parse(raw);
  if (parsed.evidenceIds.some((id) => !events.some((e) => e.id === id)))
    throw new Error("UNSUPPORTED_EVIDENCE");
  const evidence = extractRules(
    events.filter((e) => parsed.evidenceIds.includes(e.id)),
    now,
  );
  const base = extractRules(events, now);
  return {
    ...base,
    socialHint:
      parsed.socialHint === evidence.socialHint
        ? parsed.socialHint
        : base.socialHint,
    areaHint:
      parsed.areaHint === evidence.areaHint ? parsed.areaHint : base.areaHint,
    mealHint:
      parsed.mealHint === evidence.mealHint ? parsed.mealHint : base.mealHint,
  };
}
