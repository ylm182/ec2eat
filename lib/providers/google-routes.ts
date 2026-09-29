import "server-only";
import { z } from "zod";
import { jsonRequest, type Transport } from "./google-context";
import type { Coordinates } from "./contracts";
import type { RouteMetric } from "../restaurants/travel";
const rows = z.array(z.object({
  originIndex: z.number().int().optional(), destinationIndex: z.number().int(),
  status: z.object({ code: z.number().optional() }).optional(), condition: z.string().optional(),
  distanceMeters: z.number().finite().nonnegative().optional(),
  duration: z.string().regex(/^\d+(\.\d+)?s$/).optional(),
}));
export class GoogleRoutesProvider {
  constructor(private key: string, private transport: Transport = fetch) {}
  async matrix(origin: Coordinates, ids: string[], mode: "WALK" | "DRIVE", signal: AbortSignal): Promise<Map<string, RouteMetric>> {
    if (!ids.length) return new Map();
    if (ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("Invalid route candidates");
    const raw = await jsonRequest("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST", signal,
      headers: { "X-Goog-Api-Key": this.key, "Content-Type": "application/json",
        "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration" },
      body: JSON.stringify({ origins: [{ waypoint: { location: { latLng: origin } } }],
        destinations: ids.map(placeId => ({ waypoint: { placeId } })), travelMode: mode,
        ...(mode === "DRIVE" ? { routingPreference: "TRAFFIC_UNAWARE" } : {}), units: "METRIC" }),
    }, this.transport);
    const result = new Map<string, RouteMetric>();
    const seen = new Set<number>();
    for (const row of rows.parse(raw)) {
      if ((row.originIndex ?? 0) !== 0 || row.destinationIndex < 0 || row.destinationIndex >= ids.length || seen.has(row.destinationIndex)) throw new Error("Invalid route index");
      seen.add(row.destinationIndex);
      if ((row.status?.code ?? 0) !== 0 || row.condition !== "ROUTE_EXISTS" || row.distanceMeters === undefined || !row.duration) continue;
      const durationSeconds = Number(row.duration.slice(0, -1));
      if (!Number.isFinite(durationSeconds)) throw new Error("Invalid route duration");
      result.set(ids[row.destinationIndex], { distanceMeters: row.distanceMeters, duration: row.duration, durationSeconds });
    }
    return result;
  }
}
