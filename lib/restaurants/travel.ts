import { z } from "zod";
export const travelChoiceSchema = z.enum(["walk20", "walk30", "drive20"]);
export type TravelChoice = z.infer<typeof travelChoiceSchema>;
export const travelLimits = {
  walk20: { mode: "WALK", seconds: 1200, radiusM: 3000, label: "步行 20 分鐘內" },
  walk30: { mode: "WALK", seconds: 1800, radiusM: 5000, label: "步行 30 分鐘內" },
  drive20: { mode: "DRIVE", seconds: 1200, radiusM: 20000, label: "私家車 20 分鐘內" },
} as const;
export const routeMetricSchema = z.object({ distanceMeters: z.number().finite().nonnegative(), duration: z.string().regex(/^\d+(\.\d+)?s$/), durationSeconds: z.number().finite().nonnegative() }).strict();
export type RouteMetric = z.infer<typeof routeMetricSchema>;
export const travelResultSchema = z.object({ walking: routeMetricSchema.nullable(), driving: routeMetricSchema.nullable() }).strict();
export type TravelResult = z.infer<typeof travelResultSchema>;
