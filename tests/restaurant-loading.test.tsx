// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RestaurantLoading } from "../components/RestaurantLoading";
afterEach(() => { cleanup(); vi.useRealTimers(); });
function clock() { vi.useFakeTimers({toFake:["setInterval","clearInterval","performance"]}); }
it("counts down an estimate then honestly switches to elapsed time on overrun", () => {
  clock();render(<RestaurantLoading />);
  expect(screen.getByText("20")).toBeTruthy();
  act(()=>vi.advanceTimersByTime(13000));
  expect(screen.getByText("7")).toBeTruthy();
  act(()=>vi.advanceTimersByTime(7000));
  expect(screen.getByRole("status").textContent).toBe("比預期耐少少，仍在處理");
  expect(screen.getByText("已等候")).toBeTruthy();
  expect(screen.queryByText("0")).toBeNull();
  act(()=>vi.advanceTimersByTime(3000));
  expect(screen.getByText("23")).toBeTruthy();
});
it("keeps elapsed time when results are being prepared and cleans up on completion", () => {
  clock();const view=render(<RestaurantLoading />);
  act(()=>vi.advanceTimersByTime(14000));
  view.rerender(<RestaurantLoading phase="details" />);
  expect(screen.getByText("6")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("整理緊餐廳資料");
  view.unmount();expect(vi.getTimerCount()).toBe(0);
  render(<RestaurantLoading />);expect(screen.getByText("20")).toBeTruthy();
});
it("uses a shorter estimate when only loading existing restaurant details",()=>{
  clock();render(<RestaurantLoading phase="details" />);
  expect(screen.getByText("5")).toBeTruthy();
});
it("lists only chosen answers, including neutral choices and travel/meal selections", async () => {
  const { sessionFixture } = await import("./fixtures");
  const session = sessionFixture();
  session.context.travelChoice = "walk30"; session.context.diningIntent = "snack";
  session.answers = [{ questionInstanceId:"question-1", action:"right",optionId:"right",value:.2, answeredAt:session.createdAt,requestId:"answer-1" }];
  const view = render(<RestaurantLoading session={session} />);
  const list = screen.getByRole("list", {name:"今次揀過嘅答案"});
  expect(list.textContent).toBe("步行30分鐘內小食慢慢食");
  session.answers[0] = {...session.answers[0],action:"neutral",optionId:null,value:null};
  view.rerender(<RestaurantLoading session={session} />);
  expect(list.textContent).toContain("快食快走／慢慢食：都得");
});
