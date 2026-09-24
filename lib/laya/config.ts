import { unknownPreferences } from "../domain/schema";
import { installedRecipe } from "./recipe";
import { HuggingFaceLayaProvider, LayaFailure } from "./provider";
import type { DecisionProvider } from "../providers/contracts";
export function layaConfiguration(env: Record<string, string | undefined>): {
  provider: DecisionProvider | null;
  reason: string;
} {
  if (env.APP_MODE === "emulator")
    return { provider: null, reason: "laya_emulator" };
  if (!env.LAYA_BASE_URL || !env.HF_TOKEN)
    return { provider: null, reason: "laya_not_configured" };
  if (
    !installedRecipe ||
    env.LAYA_MODEL_REVISION !== installedRecipe.modelRevision ||
    env.LAYA_RUNTIME_VERSION !== installedRecipe.runtimeVersion
  )
    return { provider: null, reason: "laya_unverified_contract" };
  try {
    return {
      provider: new HuggingFaceLayaProvider(
        env.LAYA_BASE_URL,
        env.HF_TOKEN,
        installedRecipe,
        {
          version: 1,
          stage: "archetype",
          candidates: [
            {
              id: "warm-a",
              features: {
                speed: { value: 0.8, confidence: 0.5, source: "rule" },
              },
            },
            {
              id: "warm-b",
              features: {
                speed: { value: 0.2, confidence: 0.5, source: "rule" },
              },
            },
          ],
          preferences: unknownPreferences(),
          priors: {},
          context: { rain: null, nextEventSoon: null },
        },
      ),
      reason: "",
    };
  } catch (error) {
    return {
      provider: null,
      reason:
        error instanceof LayaFailure
          ? error.reason
          : "laya_configuration_error",
    };
  }
}
