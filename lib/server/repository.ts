import "server-only";
import { assertDataActive } from "./data-guard";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  idSchema,
  sessionSchema,
  type DecisionSession,
} from "../domain/schema";
import type { VerifiedUser } from "./auth";
import { ApiError } from "./http";

const timestampKeys = new Set([
  "createdAt",
  "updatedAt",
  "selectedAt",
  "capturedAt",
  "issuedAt",
  "answeredAt",
  "confirmedAt",
  "eligibleAfter",
  "snoozedUntil",
  "fetchedAt",
  "expiresAt",
]);
export function encodeDocument(value: unknown, key = ""): unknown {
  if (typeof value === "string" && timestampKeys.has(key))
    return Timestamp.fromDate(new Date(value));
  if (Array.isArray(value)) return value.map((v) => encodeDocument(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encodeDocument(v, k)]),
    );
  return value;
}
export function decodeDocument(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(decodeDocument);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decodeDocument(v)]),
    );
  return value;
}
// Repositories are scoped once to a verified identity. No route/body UID is accepted.
export function userRepository(db: Firestore, user: VerifiedUser) {
  const uid = idSchema.parse(user.uid);
  const root = db.collection("users").doc(uid);
  return {
    async profile() {
      const profile = (await root.get()).data() ?? {};
      // Explicit projection: never serialize a raw profile or OAuth record.
      return {
        uid,
        timezone: "Asia/Hong_Kong" as const,
        calendarConnected: profile.calendarConnected === true,
        priorVersion:
          typeof profile.priorVersion === "string"
            ? profile.priorVersion
            : "initial",
      };
    },
    async session(id: string): Promise<DecisionSession> {
      await assertDataActive(db, uid, undefined, idSchema.parse(id));
      const snapshot = await root
        .collection("sessions")
        .doc(idSchema.parse(id))
        .get();
      if (!snapshot.exists)
        throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
      const session = sessionSchema.parse(decodeDocument(snapshot.data()));
      if (session.uid !== uid || session.id !== id)
        throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
      return session;
    },
  };
}
