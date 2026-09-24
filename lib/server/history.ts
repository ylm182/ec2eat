import "server-only";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { idSchema, sessionSchema } from "../domain/schema";
import { historySnapshot } from "../history/schema";
import type { VerifiedUser } from "./auth";
import { ApiError } from "./http";
import { decodeDocument } from "./repository";
const invalidCursor = () =>
  new ApiError(
    422,
    "INVALID_CURSOR",
    "歷史頁面位置已失效，請重新載入最新記錄。",
  );
export function encodeHistoryCursor(id: string) {
  return Buffer.from(idSchema.parse(id)).toString("base64url");
}
export function decodeHistoryCursor(value: string) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw invalidCursor();
  const id = Buffer.from(value, "base64url").toString("utf8");
  if (!idSchema.safeParse(id).success || encodeHistoryCursor(id) !== value)
    throw invalidCursor();
  return id;
}
export function historyRepository(db: Firestore, user: VerifiedUser) {
  const uid = idSchema.parse(user.uid);
  const sessions = db.collection("users").doc(uid).collection("sessions");
  return {
    async page(cursor?: string) {
      // The anchor is fetched inside the caller's own collection. A cursor is not authority.
      let query = sessions
        .where("status", "==", "SELECTED")
        .orderBy("selectedAt", "desc")
        .orderBy(FieldPath.documentId(), "desc");
      if (cursor !== undefined) {
        const anchor = await sessions.doc(decodeHistoryCursor(cursor)).get();
        if (!anchor.exists) throw invalidCursor();
        const parsed = sessionSchema.safeParse(decodeDocument(anchor.data()));
        if (
          !parsed.success ||
          parsed.data.uid !== uid ||
          parsed.data.id !== anchor.id ||
          parsed.data.status !== "SELECTED"
        )
          throw invalidCursor();
        // Document snapshots preserve timestamp nanoseconds and the document-ID tie-breaker.
        query = query.startAfter(anchor);
      }
      const found = await query.limit(21).get();
      const page = found.docs.slice(0, 20);
      const result = page.map((doc) => {
        const session = sessionSchema.parse(decodeDocument(doc.data()));
        if (
          session.uid !== uid ||
          session.id !== doc.id ||
          session.status !== "SELECTED"
        )
          throw new ApiError(
            503,
            "HISTORY_UNAVAILABLE",
            "暫時未能載入歷史。",
            true,
          );
        return historySnapshot(session);
      });
      return {
        sessions: result,
        nextCursor:
          found.size > 20 ? encodeHistoryCursor(page.at(-1)!.id) : null,
      };
    },
  };
}
