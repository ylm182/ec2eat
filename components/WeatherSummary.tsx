"use client";
import { useEffect, useState } from "react";
import type { DecisionSession } from "@/lib/domain/schema";
export function WeatherSummary({ weather }: { weather: DecisionSession["context"]["weather"] }) {
  const [now, setNow] = useState(Date.now);
  const expiry = weather?.provenance.expiresAt ? Date.parse(weather.provenance.expiresAt) : Infinity;
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [expiry]);
  if (!weather || now >= expiry) return null;
  const condition = /THUNDER/.test(weather.condition) ? "雷雨" : /RAIN|DRIZZLE|SHOWER/.test(weather.condition) ? "有雨" : /CLOUD|OVERCAST/.test(weather.condition) ? "多雲" : /CLEAR|SUNNY/.test(weather.condition) ? "天晴" : /FOG|MIST/.test(weather.condition) ? "有霧" : "目前天氣";
  return <span className="weather-summary"> · {condition}{weather.temperatureC !== null ? ` ${Math.round(weather.temperatureC)}°C` : ""}{weather.provenance.source === "google-weather" && <> · <span translate="no">Google Maps</span></>}</span>;
}
