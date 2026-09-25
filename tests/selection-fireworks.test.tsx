// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SelectionFireworks } from "../components/SelectionFireworks";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("skips animation with reduced motion enabled", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const done = vi.fn(); render(<SelectionFireworks onDone={done} />);
  expect(done).toHaveBeenCalledTimes(1);
});
it("finishes once and cleans up animation on unmount", () => {
  vi.useFakeTimers();
  const remove = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: remove }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
  const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
  const done = vi.fn(); const view = render(<SelectionFireworks onDone={done} />);
  vi.advanceTimersByTime(4000);
  expect(done).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith(42);
  view.unmount();
  expect(remove).toHaveBeenCalled();
  vi.advanceTimersByTime(4000);
  expect(done).toHaveBeenCalledTimes(1);
});
