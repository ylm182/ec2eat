import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { LayaStore } from "./service";
// Node-only infrastructure shared by Next routes and the scheduled function.
export class FirestoreLayaStore implements LayaStore {
  constructor(private db: Firestore) {}
  async circuitOpen(now: number) {
    return (
      ((await this.db.doc("internal/layaCircuit").get())
        .data()
        ?.openUntil?.toMillis() ?? 0) > now
    );
  }
  async record(success: boolean, now: number) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc("internal/layaCircuit");
      const current = (await tx.get(ref)).data();
      if ((current?.updatedAt?.toMillis() ?? 0) > now) return;
      const failures = success ? 0 : (current?.failures ?? 0) + 1;
      tx.set(ref, {
        failures,
        openUntil: Timestamp.fromMillis(
          !success && failures >= 3 ? now + 60000 : 0,
        ),
        updatedAt: Timestamp.fromMillis(now),
      });
    });
  }
  async acquire(
    owner: string,
    now: number,
    duration: number,
    suppress: boolean,
  ) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc("internal/layaWarmup");
      const current = (await tx.get(ref)).data();
      if (
        (current?.leaseUntil?.toMillis() ?? 0) > now ||
        (suppress &&
          (current?.lastAttemptAt?.toMillis() ?? -Infinity) > now - 600000)
      )
        return false;
      tx.set(
        ref,
        {
          owner,
          leaseUntil: Timestamp.fromMillis(now + duration),
          lastAttemptAt: Timestamp.fromMillis(now),
        },
        { merge: true },
      );
      return true;
    });
  }
  async release(owner: string, success: boolean, now: number) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.doc("internal/layaWarmup");
      const current = (await tx.get(ref)).data();
      if (current?.owner !== owner) return;
      tx.set(
        ref,
        {
          leaseUntil: Timestamp.fromMillis(0),
          ...(success ? { lastSuccessAt: Timestamp.fromMillis(now) } : {}),
        },
        { merge: true },
      );
    });
  }
}
