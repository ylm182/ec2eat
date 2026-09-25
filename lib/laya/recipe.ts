import { z } from "zod";
import { dimensions, type Dimension } from "../domain/schema";
import { LayaFailure, type VerifiedLayaRecipe } from "./provider";
import type { DecisionInput } from "../providers/contracts";

export const LAYA_REVISION = "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67";
export const LAYA_RUNTIME = "laya==0.3.20";
export const LAYA_WRAPPER_REVISION = "1942f86f6f828e850a0e963bec0daf8c225e4113";
// High-value meanings follow domain/catalog.ts, including reversed swipe polarities.
const high: Record<Dimension, string> = {
  richness: "rich", spiciness: "spicy", novelty: "novel", speed: "fast",
  formality: "formal", comfort: "special treat", healthiness: "healthy",
  temperature: "hot", social: "sharing", distanceTolerance: "far", price: "expensive",
};
const unit = (n: number) => {
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new LayaFailure("laya_invalid_input");
  return String(Math.round(n * 100) / 100);
};
export function encodeLaya(input: DecisionInput) {
  const active = dimensions.filter(d => {
    const p = input.preferences[d];
    return p.state === "answered" || p.state === "inferred" ||
      (p.state === "unknown" && input.priors[d]?.state === "inferred");
  });
  if (!active.length && !input.categoryPreference) throw new LayaFailure("laya_no_preference_evidence");
  if (input.stage === "restaurant" && !input.candidates.some(c =>
    (input.categoryPreference && c.categoryId) || active.some(d => {
      const f = c.features[d];
      return f && f.value !== null && f.confidence > 0;
    })
  )) throw new LayaFailure("laya_no_preference_evidence");
  const neutral = dimensions.filter(d => input.preferences[d].state === "neutral");
  const state = [
    "Match explicit preferences first. Values 0..1; 1 means:",
    active.map(d => `${d}=${high[d]}`).join(","),
    "Cuisine is descriptive only; do not infer taste, speed or health from cuisine. Missing=?; neutral=no preference, never fill from priors. Candidate rows use the dimension order above; each value@confidence.",
    ...active.map(d => {
      const current = input.preferences[d];
      const p = current.state === "unknown" ? input.priors[d]! : current;
      return `${d}: ${p.state === "answered" ? "explicit" : "weak inferred"}=${unit(p.value!)} strength=${unit(p.state === "inferred" ? Math.min(.25,p.strength) : p.strength)}`;
    }),
    `neutral: ${neutral.join(",") || "none"}; other dimensions unknown.`,
    ...(input.categoryPreference ? [`Explicit category=${input.categoryPreference}`] : []),
    ...(active.includes("price") ? ["Price is a budget ceiling; cheaper is acceptable."] : []),
    ...(active.includes("distanceTolerance") ? ["Distance preference is willingness to travel; nearby is always acceptable."] : []),
    // Weak, minimized boolean context only; never raw Calendar/weather provider text.
    `Weak context: rain=${input.context.rain ?? "unknown"}, nextEventSoon=${input.context.nextEventSoon ?? "unknown"}.`,
  ].join("\n");
  return {path: "/", body: {inputs: {state, candidates: input.candidates.map(c => ({
    id: c.id,
    description: [
      ...(c.cuisines?.length ? [`cuisine=${c.cuisines.join("/")}`] : []),
      ...(c.categoryId ? [`category=${c.categoryId}`] : []),
      ...active.map(d => {
        const f = c.features[d];
        return !f || f.value === null || f.confidence === 0 ? "?" : `${unit(f.value)}@${unit(f.confidence)}`;
      }),
    ].join(",") || "No known features",
  }))}}};
}
const responseSchema = z.object({
  contract: z.literal("ec2eat-laya-choice-v1"),
  model: z.literal("convaiinnovations/laya-multilingual"),
  modelRevision: z.literal(LAYA_REVISION), runtimeVersion: z.literal(LAYA_RUNTIME),
  entries: z.array(z.object({id:z.string(), score:z.number().finite().min(0).max(1),
    weight:z.number().finite().min(0).max(1)}).strict()).min(1).max(10),
  confidence:z.null(),
}).strict();
export const installedRecipe: VerifiedLayaRecipe = {
  modelRevision: LAYA_REVISION,
  runtimeVersion: LAYA_RUNTIME,
  fixtureSha256: "7f7197270894d6acab6b844def6f7170d2d64a5214e8c347e2ded0edc721220c",
  encode: encodeLaya,
  decode(raw) {
    const {entries, confidence} = responseSchema.parse(raw);
    return {entries, confidence};
  },
};
