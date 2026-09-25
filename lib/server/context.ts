import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import type { z } from "zod";
import {
  contextSchema,
  createSessionInput,
  type DecisionSession,
} from "../domain/schema";
import { resolveLocation } from "../context/location";
import { extractRules, type CalendarHints } from "../context/calendar";
import {
  bounded,
  calendarEvents,
  GoogleWeatherProvider,
  ProviderFailure,
  VertexGeminiLanguageProvider,
} from "../providers/google-context";
import { configuredCalendar } from "./calendar-oauth";
import { serverConfig } from "./config";
import { ApiError } from "./http";
export type WeatherHints = {
  condition: string;
  temperatureC: number | null;
  feelsLikeC?: number | null;
  humidity?: number | null;
  precipitationProbability?: number | null;
};
export type ContextDependencies = {
  weather: (
    location: { latitude: number; longitude: number },
    signal: AbortSignal,
  ) => Promise<WeatherHints>;
  calendar: (
    uid: string,
    now: string,
    signal: AbortSignal,
  ) => Promise<CalendarHints>;
  mock?: boolean;
};
export function contextDependencies(db: Firestore): ContextDependencies {
  const config = serverConfig();
  const fixture = process.env.CONTEXT_FIXTURE;
  if (fixture && config.APP_MODE !== "emulator")
    throw new Error("Context fixtures forbidden in live mode");
  if (fixture && !["rain-busy", "all-day", "failures"].includes(fixture))
    throw new Error("Unknown context fixture");
  if (fixture)
    return {
      mock: true,
      weather: async () => {
        if (fixture === "failures") throw new ProviderFailure("failed");
        return {
          condition: "RAIN",
          temperatureC: 24,
          feelsLikeC: 26,
          humidity: 85,
          precipitationProbability: 90,
        };
      },
      calendar: async (_uid, now) => {
        if (fixture === "failures") throw new ProviderFailure("denied");
        return extractRules(
          [
            {
              id: "synthetic-event",
              summary: "同事午餐",
              location: "灣仔",
              start:
                fixture === "all-day"
                  ? { date: now.slice(0, 10) }
                  : {
                      dateTime: new Date(
                        Date.parse(now) + 30 * 60000,
                      ).toISOString(),
                    },
            },
          ],
          now,
        );
      },
    };
  return {
    weather: async (location, signal) => {
      // Weather-derived durable content is gated separately from account credentials.
      if (
        config.APP_MODE !== "live" ||
        !process.env.GOOGLE_WEATHER_API_KEY ||
        process.env.GOOGLE_WEATHER_PERSIST_APPROVED !== "true"
      )
        throw new ProviderFailure("absent");
      return new GoogleWeatherProvider(
        process.env.GOOGLE_WEATHER_API_KEY,
      ).current(location, signal);
    },
    calendar: async (uid, now, signal) => {
      const auth = configuredCalendar(db);
      let access: Awaited<ReturnType<typeof auth.access>> | undefined;
      let events;
      try {
        events = await bounded(
          2000,
          async (limited) => {
            access = await auth.access(uid, limited);
            return calendarEvents(access.token, now, limited);
          },
          signal,
        );
      } catch (e) {
        if (e instanceof ProviderFailure && e.code === "denied" && access)
          await auth.clear(uid, access.generation);
        throw e;
      }
      let hints = extractRules(events, now);
      if (process.env.GEMINI_CONTEXT_ENABLED === "true")
        hints = await new VertexGeminiLanguageProvider(
          config.GOOGLE_CLOUD_PROJECT,
          config.VERTEX_LOCATION,
        ).extractEvents(events, now, signal);
      if (!(await auth.isCurrent(uid, access!.generation)))
        throw new ProviderFailure("denied");
      return hints;
    },
  };
}
export async function collectContext(
  uid: string,
  input: z.infer<typeof createSessionInput>,
  deps: ContextDependencies,
  now = new Date().toISOString(),
): Promise<DecisionSession["context"]> {
  let place;
  try {
    place = resolveLocation(input);
  } catch {
    throw new ApiError(
      422,
      "AREA_REQUIRED",
      "定位未能確認香港範圍，請手動揀地區。",
    );
  }
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now)),
  );
  const [weather, calendar] = await Promise.allSettled([
    bounded(2000, (s) => deps.weather(place.location, s)),
    bounded(6500, (s) => deps.calendar(uid, now, s)),
  ]);
  const state = (result: PromiseSettledResult<unknown>) =>
    result.status === "fulfilled"
      ? "available"
      : result.reason instanceof ProviderFailure
        ? result.reason.code
        : "failed";
  const provenance = (
    source: "google-calendar" | "google-weather",
    ttl: number,
  ) => ({
    source: deps.mock ? ("rule" as const) : source,
    fetchedAt: now,
    expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
    persistAllowed: true,
    modelInputAllowed: false,
  });
  return contextSchema.parse({
    capturedAt: now,
    timezone: "Asia/Hong_Kong",
    meal:
      hour >= 11 && hour < 15
        ? "lunch"
        : hour >= 17 && hour < 22
          ? "dinner"
          : "other",
    area: place.area,
    ...(input.diningIntent ? { diningIntent: input.diningIntent } : {}),
    ...(input.searchRadiusM ? { searchRadiusM: input.searchRadiusM } : {}),
    locationSource: place.source,
    weather:
      weather.status === "fulfilled"
        ? {
            ...weather.value,
            provenance: provenance("google-weather", 3600000),
          }
        : null,
    calendar:
      calendar.status === "fulfilled"
        ? {
            nextEventSoon: calendar.value.nextEventSoon,
            socialHint: calendar.value.socialHint,
            areaHint: calendar.value.areaHint,
            mealHint: calendar.value.mealHint,
            provenance: provenance("google-calendar", 6 * 3600000),
          }
        : null,
    availability: {
      location: "available",
      weather: state(weather),
      calendar: state(calendar),
      ...(deps.mock ? { fixture: "available" } : {}),
    },
  });
}
