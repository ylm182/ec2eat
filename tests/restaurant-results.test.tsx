// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RestaurantResults } from "../components/RestaurantResults";
import { selectedFixture } from "./fixtures";
import { syntheticPlaces } from "../lib/server/places";
const mock = vi.hoisted(() => ({ api: vi.fn(), decision: vi.fn() }));
vi.mock("../lib/client/decision-api", () => ({ authorizedJson: mock.api, decisionApi: mock.decision, DecisionApiError: class extends Error {} }));
vi.mock("../components/RestaurantMap", () => ({ RestaurantMap: () => null }));
vi.mock("../components/SelectionFireworks", () => ({ SelectionFireworks: () => <div data-testid="fireworks" /> }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn(); });
async function setup(restored = false) {
  const card = await syntheticPlaces("results").details("synthetic-0", new AbortController().signal);
  const cards = [ { ...card, placeId: "place-a", name: "餐廳甲", source: "google-places", available: true, openNow: true }, { ...card, placeId: "place-b", name: "餐廳乙", source: "google-places", available: true, openNow: true } ];
  const saved = selectedFixture(); saved.decision.selectedPlaceId = "place-b";
  mock.api.mockImplementation((_uid: string, url: string) => Promise.resolve({ cards: url.includes("/history/") ? [cards[1]] : cards }));
  mock.decision.mockResolvedValue(saved);
  function Harness() {
    const [session, setSession] = useState(restored ? saved : { ...saved, status: "READY" as const, decision: { ...saved.decision, selectedPlaceId: null } });
    return <RestaurantResults uid="alice" session={session} location={null} onSession={setSession} />;
  }
  render(<Harness />);
  await screen.findByText("餐廳乙");
}
it("links to each Google place without selecting it, then only shows the saved choice", async () => {
  await setup();
  const link = screen.getByRole("link", { name: "在 Google Maps 查看餐廳乙" });
  expect(link.getAttribute("href")).toContain("query_place_id=place-b");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(mock.decision).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "揀呢間" })[1]);
  await screen.findByText("已儲存你的選擇");
  await waitFor(() => expect(screen.queryByText("餐廳甲")).toBeNull());
  expect(await screen.findByText("餐廳乙")).toBeTruthy();
  expect(await screen.findByTestId("fireworks")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "清單" })).toBeNull();
  expect(mock.api).toHaveBeenCalledWith("alice", "/api/history/session-1/restaurant", undefined, expect.any(AbortSignal));
});
it("does not replay fireworks when opening an existing saved choice", async () => {
  await setup(true);
  expect(screen.queryByTestId("fireworks")).toBeNull();
  expect(screen.queryByText("餐廳甲")).toBeNull();
});
it("does not celebrate or hide choices when saving fails", async () => {
  await setup();
  mock.decision.mockRejectedValue(new Error("儲存失敗"));
  fireEvent.click(screen.getAllByRole("button", { name: "揀呢間" })[1]);
  await screen.findByRole("alert");
  expect(screen.queryByTestId("fireworks")).toBeNull();
  expect(screen.getByText("餐廳甲")).toBeTruthy();
});
