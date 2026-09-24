import { describe, expect, it } from "vitest";
import { createDemoTransport, demoQuestions } from "../lib/fixtures/swipe-demo";
import type { SwipeSubmission } from "../components/DecisionSwipeCard";
const answer: SwipeSubmission = {
  requestId: "fixture-request",
  expectedRevision: 0,
  questionInstanceId: demoQuestions[0].instanceId,
  action: "neutral",
};
const signal = () => new AbortController().signal;
describe("synthetic demo transport (not real persistence)", () => {
  it("replays a lost response without recording twice", async () => {
    const transport = createDemoTransport(0);
    transport.loseNextResponse();
    await expect(transport.submit(answer, signal())).rejects.toThrow(
      "lost response",
    );
    expect(transport.records).toHaveLength(1);
    await transport.submit(answer, signal());
    expect(transport.records).toHaveLength(1);
  });
  it("rejects request ID reuse with different content and repeated question with new ID", async () => {
    const transport = createDemoTransport(0);
    await transport.submit(answer, signal());
    await expect(
      transport.submit(
        { ...answer, action: "left", optionId: "left" },
        signal(),
      ),
    ).rejects.toThrow("reused");
    await expect(
      transport.submit({ ...answer, requestId: "different" }, signal()),
    ).rejects.toThrow("Stale");
  });
  it("rejects invalid action/option pairs and stops after the three explicit fixtures", async () => {
    const transport = createDemoTransport(0);
    await expect(
      transport.submit({ ...answer, action: "left" }, signal()),
    ).rejects.toThrow("Invalid");
    for (const [index, question] of demoQuestions.entries())
      await transport.submit(
        {
          ...answer,
          requestId: `request-${index}`,
          expectedRevision: index,
          questionInstanceId: question.instanceId,
        },
        signal(),
      );
    expect(transport.records).toHaveLength(3);
    await expect(
      transport.submit(
        { ...answer, requestId: "request-4", expectedRevision: 3 },
        signal(),
      ),
    ).rejects.toThrow("Stale");
  });
  it("does not record an aborted attempt", async () => {
    const transport = createDemoTransport(10);
    const controller = new AbortController();
    const saving = transport.submit(answer, controller.signal);
    controller.abort();
    await expect(saving).rejects.toThrow();
    expect(transport.records).toHaveLength(0);
  });
});
