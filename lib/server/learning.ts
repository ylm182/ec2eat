import "server-only";
import { createHash } from "node:crypto";
import {
  FieldPath,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { derivePriors } from "../domain/learning";
import { sessionSchema, type DecisionSession } from "../domain/schema";
import { decodeDocument } from "./repository";
/** Prepare all reads first; returned commit participates in the caller's atomic mutation. */
export async function prepareLearning(
  tx: Transaction,
  root: DocumentReference,
  before: DecisionSession | null,
  after: DecisionSession | null,
) {
  const collection = root.collection("sessions");
  const [profile, recent] = await Promise.all([
    tx.get(root),
    tx.get(
      collection
        .where("status", "==", "SELECTED")
        .where("outcome.status", "==", "VISITED_SELECTED")
        .orderBy("selectedAt", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(21),
    ),
  ]);
  const overlay = (rows: DecisionSession[]) => [
    ...rows.filter((s) => s.id !== before?.id),
    ...(after ? [after] : []),
  ];
  const derived = derivePriors(
    overlay(
      recent.docs.map((d) => sessionSchema.parse(decodeDocument(d.data()))),
    ),
  );
  const priorVersion = createHash("sha256")
    .update(JSON.stringify(derived))
    .digest("hex")
    .slice(0, 24);
  const ids = [
    ...new Set(
      [
        before?.decision.selectedPlaceId,
        before?.outcome.actualPlaceId,
        after?.decision.selectedPlaceId,
        after?.outcome.actualPlaceId,
      ].filter((v): v is string => !!v),
    ),
  ];
  const relations = await Promise.all(
    ids.map(async (placeId) => {
      const [selected, visited] = await Promise.all([
        tx.get(collection.where("decision.selectedPlaceId", "==", placeId)),
        tx.get(collection.where("outcome.actualPlaceId", "==", placeId)),
      ]);
      const unique = new Map(
        [...selected.docs, ...visited.docs].map((d) => [
          d.id,
          sessionSchema.parse(decodeDocument(d.data())),
        ]),
      );
      const rows = overlay([...unique.values()]).filter(
        (s) => s.status === "SELECTED",
      );
      const actual = rows.filter(
        (s) =>
          s.outcome.actualPlaceId === placeId &&
          ["VISITED_SELECTED", "VISITED_OTHER"].includes(s.outcome.status),
      );
      return {
        placeId,
        selectedCount: rows.filter(
          (s) => s.decision.selectedPlaceId === placeId,
        ).length,
        actualVisitCount: actual.length,
        lastVisitAt:
          actual
            .map((s) => s.selectedAt!)
            .sort()
            .at(-1) ?? null,
      };
    }),
  );
  const values = {
    ...derived,
    priorVersion,
    learningRevision: (profile.data()?.learningRevision ?? 0) + 1,
  };
  const commit = () => {
    // Shared revision serializes concurrent outcomes even when their restaurants differ.
    tx.set(root, values, { merge: true });
    for (const relation of relations) {
      const ref = root.collection("restaurantRelations").doc(relation.placeId);
      if (!relation.selectedCount && !relation.actualVisitCount) tx.delete(ref);
      else tx.set(ref, relation);
    }
  };
  return Object.assign(commit, { profile: values });
}
