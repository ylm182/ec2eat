import { expect, it } from "vitest";
import { selectedFixture } from "./fixtures";
import { parseRecommendation } from "../lib/restaurants/summary-response";
it("keeps summaries outside the durable session and removes unrelated place IDs", () => {
  const session = selectedFixture();
  const result = parseRecommendation({ ...session, restaurantSummaries: [{placeId:"synthetic-place",text:"清淡午餐"},{placeId:"another",text:"不相關"}] });
  expect(result.session).toEqual(session);
  expect(result.session).not.toHaveProperty("restaurantSummaries");
  expect(result.summaries).toEqual([{placeId:"synthetic-place",text:"清淡午餐"}]);
  expect(parseRecommendation(session).summaries).toEqual([]);
});
