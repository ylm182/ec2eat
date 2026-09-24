import { type Dimension, type QuestionDefinition } from "./schema";
import type { Feature } from "../providers/contracts";
export const CATALOG_VERSION = "hk-meals-1";
export const ENGINE_VERSION = "heuristic-1";
type Pair = readonly [string, string];
const wordings: Record<Dimension, readonly [Pair, Pair]> = {
  richness: [
    ["清爽啲", "濃郁啲"],
    ["味道輕盈", "味道濃厚"],
  ],
  spiciness: [
    ["唔辣", "想食辣"],
    ["溫和口味", "辣啲開胃"],
  ],
  novelty: [
    ["熟悉嘅選擇", "試新嘢"],
    ["食返慣常口味", "探索少食嘅類型"],
  ],
  speed: [
    ["快食快走", "慢慢食"],
    ["食得快啲", "可以坐耐啲"],
  ],
  formality: [
    ["輕鬆隨意", "正式啲"],
    ["Casual 就好", "想要正式用餐"],
  ],
  comfort: [
    ["日常一餐", "特別享受"],
    ["簡單滿足", "慰勞自己"],
  ],
  healthiness: [
    ["健康啲", "放縱一下"],
    ["想食均衡啲", "今日想 indulgent 啲"],
  ],
  temperature: [
    ["清涼啲", "熱食"],
    ["凍食都好", "想食暖笠笠"],
  ],
  social: [
    ["一個人方便", "適合分享"],
    ["個人份量", "一齊分住食"],
  ],
  distanceTolerance: [
    ["附近搞掂", "好食可以遠少少"],
    ["落雨想近啲", "落雨都願意行遠啲"],
  ],
  price: [
    ["平實啲", "願意花多啲"],
    ["今餐慳啲", "今餐可以豪啲"],
  ],
};
export const binaryCatalog: QuestionDefinition[] = Object.entries(
  wordings,
).flatMap(([dimension, pairs]) =>
  pairs.map((labels, index) => {
    const reversed = dimension === "speed" || dimension === "healthiness";
    return {
      id: `${dimension}-${index === 0 ? "01" : "02"}`,
      version: 1,
      kind: "binary" as const,
      dimensionId: dimension as Dimension,
      prompt: "今餐你想點揀？",
      options: [
        { id: "left", label: labels[0], value: reversed ? 0.8 : 0.2 },
        { id: "right", label: labels[1], value: reversed ? 0.2 : 0.8 },
      ],
      contextTags:
        dimension === "distanceTolerance" && index === 1 ? ["rain"] : [],
    };
  }),
);
export const categoryTemplate = {
  id: "meal-category-01",
  version: 1,
  kind: "category" as const,
  prompt: "有冇邊類特別想食？",
  contextTags: [],
};
export const categories: Record<string, string> = {
  noodles: "麵",
  rice: "飯",
  soup: "湯或鍋物",
  salad: "沙律",
};
export type Archetype = {
  id: string;
  label: string;
  categoryId?: string;
  distanceM?: number;
  features: Partial<Record<Dimension, Feature>>;
};
function features(
  values: Partial<Record<Dimension, number>>,
): Archetype["features"] {
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [
      id,
      { value, confidence: 0.6, source: "rule" as const },
    ]),
  );
}
// App-authored, uncertain broad meal defaults. These are NOT restaurant facts.
// Novelty and distance remain unknown until actual user/history/location evidence exists.
export const archetypes: Archetype[] = [
  {
    id: "casual-noodles",
    label: "日常麵食",
    categoryId: "noodles",
    features: features({
      richness: 0.4,
      spiciness: 0.2,
      speed: 0.8,
      formality: 0.2,
      comfort: 0.3,
      healthiness: 0.5,
      temperature: 0.9,
      social: 0.2,
      price: 0.25,
    }),
  },
  {
    id: "curry-rice",
    label: "咖喱飯",
    categoryId: "rice",
    features: features({
      richness: 0.8,
      spiciness: 0.6,
      speed: 0.7,
      formality: 0.2,
      comfort: 0.5,
      healthiness: 0.3,
      temperature: 0.9,
      social: 0.2,
      price: 0.4,
    }),
  },
  {
    id: "light-salad",
    label: "清爽沙律",
    categoryId: "salad",
    features: features({
      richness: 0.15,
      spiciness: 0.1,
      speed: 0.8,
      formality: 0.3,
      comfort: 0.3,
      healthiness: 0.85,
      temperature: 0.15,
      social: 0.2,
      price: 0.45,
    }),
  },
  {
    id: "ramen",
    label: "拉麵",
    categoryId: "noodles",
    features: features({
      richness: 0.85,
      spiciness: 0.3,
      speed: 0.6,
      formality: 0.3,
      comfort: 0.6,
      healthiness: 0.3,
      temperature: 0.9,
      social: 0.2,
      price: 0.55,
    }),
  },
  {
    id: "rice-bowl",
    label: "飯碗料理",
    categoryId: "rice",
    features: features({
      richness: 0.5,
      spiciness: 0.2,
      speed: 0.85,
      formality: 0.2,
      comfort: 0.4,
      healthiness: 0.55,
      temperature: 0.8,
      social: 0.2,
      price: 0.35,
    }),
  },
  {
    id: "shared-hotpot",
    label: "分享鍋物",
    categoryId: "soup",
    features: features({
      richness: 0.7,
      spiciness: 0.5,
      speed: 0.15,
      formality: 0.4,
      comfort: 0.85,
      healthiness: 0.45,
      temperature: 0.95,
      social: 0.9,
      price: 0.8,
    }),
  },
  {
    id: "soup-meal",
    label: "湯餐",
    categoryId: "soup",
    features: features({
      richness: 0.25,
      spiciness: 0.1,
      speed: 0.65,
      formality: 0.2,
      comfort: 0.4,
      healthiness: 0.65,
      temperature: 0.95,
      social: 0.25,
      price: 0.35,
    }),
  },
];
export function binaryTemplate(
  dimension: Dimension,
  rain: boolean,
  alternate = false,
) {
  const index =
    (alternate && dimension !== "distanceTolerance") ||
    (dimension === "distanceTolerance" && rain)
      ? "02"
      : "01";
  return structuredClone(
    binaryCatalog.find((q) => q.id === `${dimension}-${index}`)!,
  );
}
