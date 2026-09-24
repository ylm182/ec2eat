import "server-only";
import { z } from "zod";
const configSchema = z.object({
  APP_MODE: z.enum(["emulator", "live"]),
  APP_ORIGIN: z.string().url(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GEMINI_MODEL: z
    .literal("gemini-3.5-flash-lite")
    .default("gemini-3.5-flash-lite"),
  VERTEX_LOCATION: z.string().default("global"),
});
export function serverConfig() {
  const config = configSchema.parse(process.env);
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (config.APP_MODE === "emulator") {
    if (
      process.env.NODE_ENV === "production" ||
      !config.GOOGLE_CLOUD_PROJECT.startsWith("demo-") ||
      !/^127\.0\.0\.1:\d+$/.test(authHost ?? "") ||
      !/^127\.0\.0\.1:\d+$/.test(dbHost ?? "")
    )
      throw new Error("Unsafe emulator configuration");
  } else if (
    authHost ||
    dbHost ||
    process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL ||
    config.GOOGLE_CLOUD_PROJECT.startsWith("demo-")
  )
    throw new Error("Emulator configuration forbidden in live mode");
  if (
    config.APP_MODE === "live" &&
    new URL(config.APP_ORIGIN).protocol !== "https:"
  )
    throw new Error("Live origin must be HTTPS");
  return config;
}
