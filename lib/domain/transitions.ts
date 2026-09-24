import type { DecisionSession } from "./schema";
import { sessionSchema } from "./schema";
export function validateTransition(
  before: DecisionSession,
  after: DecisionSession,
) {
  sessionSchema.parse(after);
  if (
    before.id !== after.id ||
    before.uid !== after.uid ||
    before.createdAt !== after.createdAt ||
    after.revision !== before.revision + 1
  )
    throw new Error("Invalid identity or revision");
  const allowed: Record<
    DecisionSession["status"],
    DecisionSession["status"][]
  > = {
    QUESTIONING: ["QUESTIONING", "RECOMMENDING", "ABANDONED"],
    RECOMMENDING: ["RECOMMENDING", "READY", "ABANDONED"],
    READY: ["SELECTED", "ABANDONED"],
    SELECTED: ["SELECTED"],
    ABANDONED: [],
  };
  if (!allowed[before.status].includes(after.status))
    throw new Error("Invalid transition");
  if (before.status === "SELECTED") {
    const { outcome: _old, revision: _r, updatedAt: _t, ...frozen } = before;
    const {
      outcome: _new,
      revision: _nr,
      updatedAt: _nt,
      ...nextFrozen
    } = after;
    if (JSON.stringify(frozen) !== JSON.stringify(nextFrozen))
      throw new Error("Selected decision is immutable");
  }
}
