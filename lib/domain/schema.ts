import { z } from "zod";

export const dimensions = [
  "richness",
  "spiciness",
  "novelty",
  "speed",
  "formality",
  "comfort",
  "healthiness",
  "temperature",
  "social",
  "distanceTolerance",
  "price",
] as const;
export const dimensionSchema = z.enum(dimensions);
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().min(1).max(500);
const unit = z.number().finite().min(0).max(1);
const date = z.string().datetime();
export const preferenceSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("unknown"),
      value: z.null(),
      strength: z.literal(0),
    })
    .strict(),
  z
    .object({
      state: z.literal("neutral"),
      value: z.null(),
      strength: z.literal(0),
    })
    .strict(),
  z
    .object({
      state: z.literal("answered"),
      value: unit,
      strength: z.literal(1),
    })
    .strict(),
  z
    .object({
      state: z.literal("inferred"),
      value: unit,
      strength: z.number().min(0).max(0.25),
    })
    .strict(),
]);
export type Preference = z.infer<typeof preferenceSchema>;
export type Dimension = (typeof dimensions)[number];
export const preferencesSchema = z
  .record(dimensionSchema, preferenceSchema)
  .superRefine((p, ctx) => {
    if (dimensions.some((d) => !p[d]))
      ctx.addIssue({
        code: "custom",
        message: "All eleven dimensions are required",
      });
  });
export function unknownPreferences(): Record<Dimension, Preference> {
  return Object.fromEntries(
    dimensions.map((d) => [d, { state: "unknown", value: null, strength: 0 }]),
  ) as Record<Dimension, Preference>;
}
export const questionSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    dimensionId: dimensionSchema.optional(),
    kind: z.enum(["binary", "category"]),
    prompt: text,
    options: z
      .array(
        z
          .object({
            id: idSchema,
            label: text,
            value: unit.optional(),
            categoryId: idSchema.optional(),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    contextTags: z.array(text).max(10),
  })
  .strict()
  .superRefine((q, ctx) => {
    const valid =
      q.kind === "binary"
        ? q.dimensionId &&
          q.options.length === 2 &&
          q.options[0].id === "left" &&
          q.options[1].id === "right" &&
          q.options.every((o) => o.value !== undefined && !o.categoryId)
        : !q.dimensionId &&
          q.options.every((o) => o.categoryId && o.value === undefined);
    if (!valid || new Set(q.options.map((o) => o.id)).size !== q.options.length)
      ctx.addIssue({ code: "custom", message: "Invalid question options" });
  });
export type QuestionDefinition = z.infer<typeof questionSchema>;
export const provenanceSchema = z
  .object({
    source: z.enum([
      "google-places",
      "google-weather",
      "google-calendar",
      "user",
      "rule",
    ]),
    fetchedAt: date,
    expiresAt: date.nullable(),
    persistAllowed: z.boolean(),
    modelInputAllowed: z.boolean(),
  })
  .strict();
export const contextSchema = z
  .object({
    capturedAt: date,
    timezone: z.literal("Asia/Hong_Kong"),
    meal: z.enum(["lunch", "dinner", "other"]),
    area: text,
    locationSource: z.enum(["gps", "manual"]),
    weather: z
      .object({
        condition: text,
        temperatureC: z.number().finite().nullable(),
        feelsLikeC: z.number().finite().nullable().optional(),
        humidity: z.number().min(0).max(100).nullable().optional(),
        precipitationProbability: z
          .number()
          .min(0)
          .max(100)
          .nullable()
          .optional(),
        provenance: provenanceSchema,
      })
      .strict()
      .nullable(),
    calendar: z
      .object({
        nextEventSoon: z.boolean(),
        socialHint: z.boolean().nullable(),
        areaHint: text.nullable().optional(),
        mealHint: z.enum(["lunch", "dinner"]).nullable().optional(),
        provenance: provenanceSchema,
      })
      .strict()
      .nullable(),
    availability: z.record(z.enum(["available", "denied", "failed", "absent"])),
  })
  .strict();
export const sessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    uid: idSchema,
    revision: z.number().int().nonnegative(),
    status: z.enum([
      "QUESTIONING",
      "RECOMMENDING",
      "READY",
      "SELECTED",
      "ABANDONED",
    ]),
    createdAt: date,
    updatedAt: date,
    selectedAt: date.nullable(),
    launchId: idSchema,
    selectionLaunchId: idSchema.nullable(),
    catalogVersion: text,
    engineVersion: text,
    priorVersion: text,
    context: contextSchema,
    preferences: preferencesSchema,
    questions: z
      .array(
        z
          .object({
            instanceId: idSchema,
            definition: questionSchema,
            issuedAt: date,
          })
          .strict(),
      )
      .max(6),
    answers: z
      .array(
        z
          .object({
            questionInstanceId: idSchema,
            action: z.enum(["left", "right", "neutral", "category"]),
            optionId: idSchema.nullable(),
            value: unit.nullable(),
            answeredAt: date,
            requestId: idSchema,
          })
          .strict(),
      )
      .max(6),
    search: z
      .object({
        radiusM: z.number().positive(),
        expanded: z.boolean(),
        result: z.enum(["empty", "ready"]),
        source: z.enum(["google-places", "synthetic"]),
        centreSource: z.enum(["gps", "manual"]),
      })
      .strict()
      .optional(),
    decision: z
      .object({
        stopReason: z
          .enum([
            "weight_margin",
            "max_questions",
            "exhausted",
            "user_requested",
          ])
          .nullable(),
        provider: z.enum(["laya", "heuristic"]),
        modelRevision: text.nullable(),
        confidence: unit.nullable(),
        confidenceKind: z.enum(["provider_uncalibrated", "none"]),
        candidates: z
          .array(
            z
              .object({
                placeId: text,
                score: z.number().finite(),
                weight: unit,
              })
              .strict(),
          )
          .max(10),
        recommendedPlaceId: text.nullable(),
        selectedPlaceId: text.nullable(),
        reason: text.nullable(),
        fallbackReason: text.nullable(),
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum([
          "PENDING",
          "VISITED_SELECTED",
          "VISITED_OTHER",
          "DID_NOT_EAT_OUT",
        ]),
        actualPlaceId: text.nullable(),
        confirmedAt: date.nullable(),
        revision: z.number().int().nonnegative(),
        eligibleAfter: date.nullable(),
        snoozedUntil: date.nullable(),
        lastPromptLaunchId: idSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const selected = s.status === "SELECTED";
    if (
      selected !==
      Boolean(
        s.selectedAt &&
          s.selectionLaunchId &&
          s.decision.selectedPlaceId &&
          s.outcome.eligibleAfter,
      )
    )
      fail("Selection requires complete metadata");
    if (
      !selected &&
      (s.selectedAt ||
        s.selectionLaunchId ||
        s.decision.selectedPlaceId ||
        s.outcome.eligibleAfter ||
        s.outcome.status !== "PENDING")
    )
      fail("Unselected sessions are ineligible");
    if (
      s.decision.selectedPlaceId &&
      !s.decision.candidates.some(
        (c) => c.placeId === s.decision.selectedPlaceId,
      )
    )
      fail("Selection must belong to shortlist");
    if (
      s.decision.recommendedPlaceId &&
      !s.decision.candidates.some(
        (c) => c.placeId === s.decision.recommendedPlaceId,
      )
    )
      fail("Recommendation must belong to shortlist");
    if (
      new Set(s.decision.candidates.map((c) => c.placeId)).size !==
      s.decision.candidates.length
    )
      fail("Duplicate candidate");
    if (
      s.outcome.status === "VISITED_SELECTED" &&
      s.outcome.actualPlaceId !== s.decision.selectedPlaceId
    )
      fail("Selected visit ID mismatch");
    if (
      s.outcome.status === "VISITED_OTHER" &&
      s.outcome.actualPlaceId !== null &&
      s.outcome.actualPlaceId === s.decision.selectedPlaceId
    )
      fail("Other visit cannot be selected place");
    if (
      ["PENDING", "DID_NOT_EAT_OUT"].includes(s.outcome.status) &&
      s.outcome.actualPlaceId !== null
    )
      fail("Outcome requires null actual place");
    if ((s.outcome.status === "PENDING") !== (s.outcome.confirmedAt === null))
      fail("Confirmation timestamp mismatch");
    if (
      selected &&
      Date.parse(s.outcome.eligibleAfter!) <
        Date.parse(s.selectedAt!) + 4 * 3600000
    )
      fail("Outcome must wait four hours");
    if (
      new Set(s.questions.map((q) => q.instanceId)).size !==
        s.questions.length ||
      new Set(s.answers.map((a) => a.questionInstanceId)).size !==
        s.answers.length
    )
      fail("Duplicate question or answer");
    const asked = s.questions.flatMap((q) =>
      q.definition.dimensionId ? [q.definition.dimensionId] : [],
    );
    if (new Set(asked).size !== asked.length) fail("Repeated dimension");
    for (const a of s.answers) {
      const q = s.questions.find(
        (q) => q.instanceId === a.questionInstanceId,
      )?.definition;
      if (!q) {
        fail("Unissued question");
        continue;
      }
      if (a.action === "neutral") {
        if (a.optionId !== null || a.value !== null)
          fail("Neutral has no numeric value");
        continue;
      }
      const option = q.options.find((o) => o.id === a.optionId);
      if (
        !option ||
        (q.kind === "binary"
          ? a.action !== option.id || a.value !== option.value
          : a.action !== "category" || a.value !== null)
      )
        fail("Answer does not match issued option");
    }
  });
export type DecisionSession = z.infer<typeof sessionSchema>;
export const createSessionInput = z
  .object({
    requestId: idSchema,
    launchId: idSchema,
    area: text.optional(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.area || v.location),
    "Location or manual area required",
  );
export const answerInput = z
  .object({
    requestId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    questionInstanceId: idSchema,
    action: z.enum(["left", "right", "neutral", "category"]),
    optionId: idSchema.optional(),
  })
  .strict();
