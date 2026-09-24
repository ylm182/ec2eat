// @vitest-environment jsdom
import React, { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DecisionSwipeCard,
  DecisionCategoryCard,
  type DecisionSwipeCardProps,
} from "../components/DecisionSwipeCard";
import { demoQuestions } from "../lib/fixtures/swipe-demo";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const base = { question: demoQuestions[0], expectedRevision: 0, progress: 1 };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function drag(card: Element, x: number, y: number) {
  fireEvent.mouseDown(card, { clientX: 200, clientY: 300 });
  fireEvent.mouseMove(window, { clientX: 200 + x, clientY: 300 + y });
  fireEvent.mouseUp(window);
}
function card(container: HTMLElement) {
  return container.querySelector(".tinder-question")!;
}

describe("real react-tinder-card integration", () => {
  it.each([
    ["left", -150, 0, "left"],
    ["right", 150, 0, "right"],
    ["up", 0, -150, "neutral"],
  ])(
    "maps a %s gesture once, through changing feedback renders",
    async (_direction, x, y, action) => {
      const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(
        async () => {},
      );
      const { container } = render(
        <DecisionSwipeCard {...base} onSubmit={onSubmit} />,
      );
      const element = card(container);
      fireEvent.mouseDown(element, { clientX: 200, clientY: 300 });
      fireEvent.mouseMove(window, {
        clientX: 200 + Number(x),
        clientY: 300 + Number(y),
      });
      expect(
        container.querySelectorAll(".direction-labels [data-active=true]")
          .length,
      ).toBe(1);
      fireEvent.mouseUp(window);
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        questionInstanceId: base.question.instanceId,
        action,
        expectedRevision: 0,
      });
      if (action === "neutral")
        expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("optionId");
      else expect(onSubmit.mock.calls[0][0]).toHaveProperty("optionId", action);
      drag(element, -150, 0);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    },
  );
  it("down and below-threshold gestures do not answer", () => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    const { container } = render(
      <DecisionSwipeCard {...base} onSubmit={onSubmit} />,
    );
    drag(card(container), 0, 150);
    drag(card(container), 20, 0);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("touch gestures use the same library path", async () => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    const { container } = render(
      <DecisionSwipeCard {...base} onSubmit={onSubmit} />,
    );
    const element = card(container);
    fireEvent.touchStart(element, {
      touches: [{ clientX: 200, clientY: 300 }],
    });
    fireEvent.touchMove(element, { touches: [{ clientX: 200, clientY: 130 }] });
    fireEvent.touchEnd(element, { touches: [] });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ action: "neutral" });
  });
  it("does not cancel touch events outside the swipe surface", () => {
    render(
      <>
        <p data-testid="outside">Outside card</p>
        <DecisionSwipeCard {...base} onSubmit={vi.fn()} />
      </>,
    );
    const event = new Event("touchstart", { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("outside"), event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("buttons, keyboard and saving", () => {
  it.each([
    ["向左揀：清爽啲", "left"],
    ["向右揀：濃郁啲", "right"],
    ["向上揀：都可以", "neutral"],
  ])("tap %s records the matching answer", async (label, action) => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    render(<DecisionSwipeCard {...base} onSubmit={onSubmit} />);
    await userEvent.setup().click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ action });
  });
  it.each([
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "neutral"],
  ])("%s records %s", async (key, action) => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    render(<DecisionSwipeCard {...base} onSubmit={onSubmit} />);
    expect(document.activeElement).toBe(screen.getByRole("region"));
    fireEvent.keyDown(screen.getByRole("region"), { key });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ action });
  });
  it("leaves down and outside keys alone, ignores held keys", () => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    render(<DecisionSwipeCard {...base} onSubmit={onSubmit} />);
    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByRole("region"), down);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("region"), {
      key: "ArrowRight",
      repeat: true,
    });
    expect(down.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("guards competing gesture, button and keyboard events synchronously", async () => {
    const saving = deferred();
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(
      () => saving.promise,
    );
    const onAnswered = vi.fn();
    const { container } = render(
      <StrictMode>
        <DecisionSwipeCard
          {...base}
          onSubmit={onSubmit}
          onAnswered={onAnswered}
        />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "向左揀：清爽啲" }));
    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowUp" });
    drag(card(container), 150, 0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    for (const button of container.querySelectorAll(".answer-buttons button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("清爽啲");
    expect(screen.getByRole("status").textContent).toContain("儲存中");
    await act(async () => saving.resolve());
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });
  it("restores the same question after failure and retries exactly the same request ID and body", async () => {
    const onSubmit = vi
      .fn<DecisionSwipeCardProps["onSubmit"]>()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(undefined);
    const onAnswered = vi.fn();
    const { container } = render(
      <DecisionSwipeCard
        {...base}
        onSubmit={onSubmit}
        onAnswered={onAnswered}
      />,
    );
    const original = card(container);
    drag(original, 0, -150);
    const retry = await screen.findByRole("button", { name: "重試儲存" });
    expect(card(container)).not.toBe(original);
    expect(
      screen.getByRole("heading", { name: base.question.definition.prompt }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("都可以");
    expect(screen.getByRole("status").textContent).toContain("未確認儲存");
    expect(document.activeElement).toBe(retry);
    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowLeft" });
    fireEvent.click(retry);
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0]);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("value");
  });
  it("ignores late completion after moving to a different question", async () => {
    const pending = deferred();
    const oldSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(
      () => pending.promise,
    );
    const onAnswered = vi.fn();
    const view = render(
      <DecisionSwipeCard
        {...base}
        onSubmit={oldSubmit}
        onAnswered={onAnswered}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "向左揀：清爽啲" }));
    const newSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    view.rerender(
      <DecisionSwipeCard
        {...base}
        question={demoQuestions[1]}
        progress={2}
        expectedRevision={1}
        onSubmit={newSubmit}
        onAnswered={onAnswered}
      />,
    );
    expect((oldSubmit.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    await act(async () => pending.resolve());
    expect(onAnswered).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "向左揀：快食快走" }));
    await waitFor(() => expect(newSubmit).toHaveBeenCalledTimes(1));
    expect(newSubmit.mock.calls[0][0]).toMatchObject({
      questionInstanceId: demoQuestions[1].instanceId,
      expectedRevision: 1,
    });
  });
  it("bounds a hung save, preserves the chosen answer and aborts the attempt", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(
      () => new Promise<void>(() => {}),
    );
    render(<DecisionSwipeCard {...base} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "向右揀：濃郁啲" }));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect((onSubmit.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect(screen.getByRole("button", { name: "重試儲存" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("濃郁啲");
  });
  it("supports reduced motion without disabling input", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    const { container } = render(
      <DecisionSwipeCard {...base} onSubmit={onSubmit} />,
    );
    expect(
      container
        .querySelector(".swipe-surface")
        ?.getAttribute("data-reduced-motion"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowUp" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ action: "neutral" });
  });
});

describe("categorical grid shares safe submission without swipe gestures", () => {
  const category = {
    instanceId: "category-q",
    definition: {
      id: "category-01",
      version: 1,
      kind: "category" as const,
      prompt: "揀邊類？",
      options: [
        { id: "rice", categoryId: "rice", label: "飯" },
        { id: "noodles", categoryId: "noodles", label: "麵" },
      ],
      contextTags: [],
    },
  };
  it("sends a category ID once, never a position or numeric value", async () => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    const { container } = render(
      <DecisionCategoryCard
        {...base}
        question={category}
        onSubmit={onSubmit}
      />,
    );
    expect(container.querySelector(".tinder-question")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "飯" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      action: "category",
      optionId: "rice",
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("value");
  });
  it("neutral is a distinct action on the category grid too", async () => {
    const onSubmit = vi.fn<DecisionSwipeCardProps["onSubmit"]>(async () => {});
    render(
      <DecisionCategoryCard
        {...base}
        question={category}
        onSubmit={onSubmit}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "都可以" }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ action: "neutral" });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("optionId");
  });
});
