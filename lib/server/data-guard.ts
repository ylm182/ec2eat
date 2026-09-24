import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { ApiError } from "./http";
/** Read these fences in every writing transaction, before any writes. */
export async function assertDataActive(
  db: Firestore,
  uid: string,
  tx?: Transaction,
  sessionId?: string,
) {
  const refs = [
    db.doc(`dataDeletions/${uid}`),
    ...(sessionId
      ? [db.doc(`users/${uid}/sessionTombstones/${sessionId}`)]
      : []),
  ];
  const snaps = await Promise.all(
    refs.map((ref) => (tx ? tx.get(ref) : ref.get())),
  );
  if (snaps[0].exists)
    throw new ApiError(
      403,
      "DATA_DELETED",
      "帳戶資料已刪除；如要再次使用，請聯絡管理員。",
    );
  if (snaps[1]?.exists)
    throw new ApiError(404, "NOT_FOUND", "呢次選擇已刪除。");
}
