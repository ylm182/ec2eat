import "server-only";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { idSchema, sessionSchema } from "../domain/schema";
import { decodeDocument } from "./repository";
import { prepareLearning } from "./learning";
import { assertDataActive } from "./data-guard";
import { ApiError } from "./http";
import type { VerifiedUser } from "./auth";
import { calendarSettings, configuredCalendar } from "./calendar-oauth";
export const deleteSessionInput = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    confirm: z.literal(true),
  })
  .strict();
export const deleteAccountInput = z
  .object({ confirm: z.literal("DELETE") })
  .strict();
export function deletionRepository(db: Firestore, user: VerifiedUser) {
  const root = db.doc(`users/${user.uid}`);
  return {
    async session(id: string, raw: unknown) {
      idSchema.parse(id);
      const input = deleteSessionInput.parse(raw);
      const tombstone = root.collection("sessionTombstones").doc(id);
      await db.runTransaction(async (tx) => {
        await assertDataActive(db, user.uid, tx);
        const deleted = await tx.get(tombstone);
        if (deleted.exists) return;
        const saved = await tx.get(root.collection("sessions").doc(id));
        if (!saved.exists)
          throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
        const before = sessionSchema.parse(decodeDocument(saved.data()));
        if (before.uid !== user.uid)
          throw new ApiError(404, "NOT_FOUND", "搵唔到呢次選擇。");
        if (before.revision !== input.expectedRevision)
          throw new ApiError(
            409,
            "STALE_REVISION",
            "記錄已更新，請重新載入再刪除。",
          );
        const commit = await prepareLearning(tx, root, before, null);
        commit();
        tx.delete(saved.ref);
        tx.create(tombstone, { deletedAt: Timestamp.now() });
      });
      // Fence is durable before paged cleanup. Retrying completes interrupted cleanup.
      for (const [collection, field] of [
        ["operations", "response.id"],
        ["operations", "sessionId"],
        ["restaurantOperations", "response.id"],
        ["restaurantOperations", "sessionId"],
        ["actualLookups", "sessionId"],
      ]) {
        while (true) {
          const page = await root
            .collection(collection)
            .where(field, "==", id)
            .limit(200)
            .get();
          if (page.empty) break;
          const batch = db.batch();
          for (const doc of page.docs) {
            batch.delete(doc.ref);
            if (collection === "actualLookups")
              batch.delete(root.collection("operations").doc(doc.id));
          }
          await batch.commit();
        }
      }
      return { deleted: true };
    },
    async account(raw: unknown) {
      deleteAccountInput.parse(raw);
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`dataDeletions/${user.uid}`);
        if (!(await tx.get(ref)).exists)
          tx.create(ref, { status: "deleting", requestedAt: Timestamp.now() });
      });
      const marker = db.doc(`dataDeletions/${user.uid}`);
      const connection = await db.doc(`oauthConnections/${user.uid}`).get();
      const connected = Boolean(connection.data()?.encryptedRefreshToken);
      // A pending OAuth generation may already be exchanging a code remotely.
      if (connection.exists)
        await marker.set({ revocationUnconfirmed: true }, { merge: true });
      if (connected && calendarSettings()) {
        const result = await configuredCalendar(db).disconnect(user.uid);
        if (result.revoked)
          await marker.set({ revocationUnconfirmed: false }, { merge: true });
      }
      await db.recursiveDelete(root);
      const states = await db
        .collection("oauthStates")
        .where("uid", "==", user.uid)
        .get();
      for (const doc of states.docs) await doc.ref.delete();
      await db.doc(`oauthConnections/${user.uid}`).delete();
      const revoked = !(await marker.get()).data()?.revocationUnconfirmed;
      await marker.set(
        { status: "deleted", completedAt: Timestamp.now() },
        { merge: true },
      );
      return { deleted: true, revoked };
    },
  };
}
