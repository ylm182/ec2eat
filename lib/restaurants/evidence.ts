import type { SearchPlace } from "./types";
// Exact provider type mappings only. Broad national cuisines do not imply a dish,
// and neither a query match nor an archetype supplies restaurant taste facts.
const categories: Record<string, string> = {
  ramen_restaurant: "noodles", noodle_shop: "noodles", chinese_noodle_restaurant: "noodles",
  salad_shop: "salad", soup_restaurant: "soup", hot_pot_restaurant: "soup",
};
const cuisineTypes: Record<string,string> = {
  chinese_restaurant:"Chinese", cantonese_restaurant:"Cantonese", japanese_restaurant:"Japanese",
  korean_restaurant:"Korean", thai_restaurant:"Thai", italian_restaurant:"Italian", indian_restaurant:"Indian",
  vietnamese_restaurant:"Vietnamese", french_restaurant:"French", american_restaurant:"American",
};
export function restaurantEvidence(place: SearchPlace) {
  const types = new Set([place.primaryType, ...(place.types ?? [])].filter(Boolean));
  const primaryCategory = place.primaryType ? categories[place.primaryType] : undefined;
  const mapped = [...new Set([...types].map(t => categories[t!]).filter(Boolean))];
  const categoryId = primaryCategory ?? (mapped.length === 1 ? mapped[0] : undefined);
  return {
    cuisines: [...types].flatMap(t => cuisineTypes[t!] ? [cuisineTypes[t!]] : []).sort().slice(0,3),
    ...(categoryId ? { categoryId } : {}),
    features: {
      ...(types.has("fine_dining_restaurant") ? {
        formality: { value: .8, confidence: .8, source: "provider" as const },
      } : {}),
    },
  };
}
