import { answerInput, type QuestionDefinition } from "@/lib/domain/schema";
import type {
  IssuedSwipeQuestion,
  SwipeSubmission,
} from "@/components/DecisionSwipeCard";

// Synthetic questions exercise the UI only. The adaptive catalog belongs to M3.
const definition = (
  id: string,
  dimensionId: QuestionDefinition["dimensionId"],
  prompt: string,
  left: string,
  right: string,
  reversed = false,
): QuestionDefinition => ({
  id,
  version: 1,
  kind: "binary",
  dimensionId,
  prompt,
  options: [
    { id: "left", label: left, value: reversed ? 0.8 : 0.2 },
    { id: "right", label: right, value: reversed ? 0.2 : 0.8 },
  ],
  contextTags: [],
});
export const demoQuestions: IssuedSwipeQuestion[] = [
  {
    instanceId: "demo-richness-01",
    definition: definition(
      "richness-01",
      "richness",
      "今餐想食咩口味？",
      "清爽啲",
      "濃郁啲",
    ),
  },
  {
    instanceId: "demo-speed-01",
    definition: definition(
      "speed-01",
      "speed",
      "想快快食，定慢慢嘆？",
      "快食快走",
      "慢慢食",
      true,
    ),
  },
  {
    instanceId: "demo-temperature-01",
    definition: definition(
      "temperature-01",
      "temperature",
      "想食凍啲，定暖啲？",
      "清涼啲",
      "熱食",
    ),
  },
];
export function createDemoTransport(delayMs = 450) {
  const records: SwipeSubmission[] = [];
  const operations = new Map<string, string>();
  let loseNextResponse = false;
  return {
    records,
    loseNextResponse() {
      loseNextResponse = true;
    },
    async submit(raw: SwipeSubmission, signal: AbortSignal) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      signal.throwIfAborted();
      const answer = answerInput.parse(raw);
      const hash = JSON.stringify(answer);
      const prior = operations.get(answer.requestId);
      if (prior) {
        if (prior !== hash)
          throw new Error("Demo request ID reused with another body");
        return;
      }
      const current = demoQuestions[records.length];
      if (
        !current ||
        current.instanceId !== answer.questionInstanceId ||
        answer.expectedRevision !== records.length ||
        !["left", "right", "neutral"].includes(answer.action)
      )
        throw new Error("Stale demo answer");
      if (
        answer.action === "neutral"
          ? answer.optionId !== undefined
          : answer.optionId !== answer.action
      )
        throw new Error("Invalid demo option");
      operations.set(answer.requestId, hash);
      records.push(answer);
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new Error("Simulated lost response AFTER recording answer");
      }
    },
  };
}
