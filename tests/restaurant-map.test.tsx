// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RestaurantMap } from "../components/RestaurantMap";
import type { RestaurantCard } from "../lib/restaurants/types";
const mocks = vi.hoisted(() => ({ config: vi.fn(), load: vi.fn() }));
vi.mock("../lib/client/decision-api", () => ({ authorizedJson: mocks.config }));
vi.mock("../lib/client/google-maps", () => ({ loadGoogleMaps: mocks.load }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("pins all real coordinates, updates the blue dot, opens the matching card and stops location on unmount", async () => {
  const features = new Map();
  let click: (event: unknown) => void = () => {};
  let content: HTMLElement;
  const remove = vi.fn(), close = vi.fn();
  const add = vi.fn((feature) => { const value = { ...feature, setGeometry: vi.fn() }; features.set(feature.id, value); });
  const fitBounds = vi.fn();
  const maps = {
    Map: class { data = { add, setStyle: vi.fn(), getFeatureById: (id: string) => features.get(id), addListener: (_: string, cb: typeof click) => { click = cb; return { remove }; } }; fitBounds = fitBounds; },
    LatLngBounds: class { extend() {} isEmpty() { return false; } },
    Data: { Point: class { constructor(public position: unknown) {} } },
    InfoWindow: class { setContent(value: HTMLElement) { content = value; } setPosition() {} open() {} close = close; },
  };
  mocks.config.mockResolvedValue({ apiKey: "public-test-key" });
  mocks.load.mockResolvedValue(maps);
  let success: PositionCallback = () => {};
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: vi.fn((cb) => { success = cb; return 42; }), clearWatch } });
  const cards = Array.from({ length: 10 }, (_, i) => ({ placeId: `place${i}`, source: "google-places", name: `Restaurant ${i}`, location: { latitude: 22.3, longitude: 114.1 + i / 1000 } })) as RestaurantCard[];
  const onView = vi.fn();
  const rendered = render(<RestaurantMap uid="user" cards={cards} onView={onView} />);
  await waitFor(() => expect(add).toHaveBeenCalledTimes(10));
  success({ coords: { latitude: 22.4, longitude: 114.2 } } as GeolocationPosition);
  await waitFor(() => expect(screen.getByText(/你的位置/)).toBeTruthy());
  expect(features.get("__user").geometry.position).toEqual({ lat: 22.4, lng: 114.2 });
  click({ feature: { getId: () => "place9", getProperty: (key: string) => key === "rank" ? 10 : "Restaurant 9" }, latLng: {} });
  fireEvent.click(content!.querySelector("button")!);
  expect(onView).toHaveBeenCalledWith("place9");
  rendered.unmount();
  expect(clearWatch).toHaveBeenCalledWith(42);
  expect(remove).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});
it("shows an actionable error when Maps configuration is unavailable", async () => {
  mocks.config.mockRejectedValue(new Error("地圖暫時未設定"));
  render(<RestaurantMap uid="user" cards={[]} onView={() => {}} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重試" })).toBeTruthy();
});
