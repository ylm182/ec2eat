// Expire early, leaving a safety margin before Google's one-hour maximum.
export const WEATHER_TTL_MS = 30 * 60 * 1000;
export function withoutExpiredWeather(value: Record<string, unknown>, now = Date.now()) {
  const weather = value.weather as { provenance?: { source?: string; expiresAt?: string; persistAllowed?: boolean } } | null | undefined;
  if (weather?.provenance?.source !== "google-weather") return value;
  const expiry = Date.parse(weather.provenance.expiresAt ?? "");
  if (weather.provenance.persistAllowed && Number.isFinite(expiry) && expiry > now) return value;
  return { ...value, weather: null, availability: { ...(value.availability as object), weather: "absent" } };
}
