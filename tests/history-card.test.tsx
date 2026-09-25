// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistoryCard } from "../components/HistoryCard";
import { selectedFixture } from "./fixtures";
import { syntheticPlaces } from "../lib/server/places";
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../lib/client/decision-api", () => ({ authorizedJson: mock.api }));
vi.mock("../components/OutcomeForm", () => ({ OutcomeForm: () => <div>確認表格</div> }));
vi.mock("../components/DataControls", () => ({ DeleteSession: () => null }));
afterEach(cleanup);
it("offers confirmation instead of a pending label or restaurant ID, then hides the button after confirmation", () => {
  const s = selectedFixture();
  const rendered = render(<HistoryCard uid="alice" session={s} />);
  expect(screen.queryByText(/餐廳編號|未確認到訪/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "確認到訪" }));
  expect(screen.getByText("確認表格")).toBeTruthy();
  const confirmed = { ...s, outcome: { ...s.outcome, status: "VISITED_SELECTED" as const, actualPlaceId: s.decision.selectedPlaceId, confirmedAt: s.createdAt } };
  rendered.rerender(<HistoryCard uid="alice" session={confirmed} />);
  expect(screen.queryByRole("button", { name: "確認到訪" })).toBeNull();
});
it("fetches current names only when flipped and keeps the original ranking order", async () => {
  const s = selectedFixture();
  const card = await syntheticPlaces("results").details("synthetic-0", new AbortController().signal);
  s.decision.candidates = [{ placeId: card.placeId, score: 1, weight: 1 }];
  mock.api.mockResolvedValue({ cards: [{ ...card, name: "測試餐廳名" }] });
  render(<HistoryCard uid="alice" session={s} />);
  fireEvent.click(screen.getByRole("button", { name: "睇返點揀" }));
  expect(await screen.findByText(/測試餐廳名/)).toBeTruthy();
  expect(screen.queryByText(card.placeId)).toBeNull();
  expect(mock.api).toHaveBeenCalledWith("alice", "/api/history/session-1/ranking", undefined, expect.any(AbortSignal));
});
