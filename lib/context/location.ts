import { manualAreas } from "../domain/areas";
import type { Coordinates } from "../providers/contracts";
// App-curated approximate neighbourhood centres; not live geocoding or boundaries.
const centres = [
  [22.2819, 114.1589],
  [22.276, 114.1751],
  [22.28, 114.1846],
  [22.2855, 114.2163],
  [22.2988, 114.1722],
  [22.3193, 114.1694],
  [22.33, 114.1622],
  [22.312, 114.225],
  [22.3707, 114.1144],
  [22.3816, 114.1887],
  [22.307, 114.26],
  [22.4445, 114.0222],
];
export function resolveLocation(input: {
  area?: string;
  location?: Coordinates;
}) {
  if (input.location) {
    const { latitude, longitude } = input.location;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < 22.15 ||
      latitude > 22.58 ||
      longitude < 113.83 ||
      longitude > 114.45
    )
      throw new Error("OUTSIDE_HK");
    const nearest = centres
      .map(([lat, lng], i) => ({
        i,
        d:
          (latitude - lat) ** 2 +
          ((longitude - lng) * Math.cos((latitude * Math.PI) / 180)) ** 2,
      }))
      .sort((a, b) => a.d - b.d)[0];
    return {
      area: manualAreas[nearest.i],
      location: input.location,
      source: "gps" as const,
    };
  }
  const index = manualAreas.indexOf(input.area as (typeof manualAreas)[number]);
  if (index < 0) throw new Error("AREA_REQUIRED");
  return {
    area: manualAreas[index],
    location: { latitude: centres[index][0], longitude: centres[index][1] },
    source: "manual" as const,
  };
}
