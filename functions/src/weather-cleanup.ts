import { type QueryDocumentSnapshot, type Firestore } from "firebase-admin/firestore";

// Update only weather fields: concurrent answers, choices and visits remain intact.
export async function cleanWeather(db: Firestore, now = Date.now()) {
  let removed = 0;
  for (const [group, prefix] of [["sessions", "context"], ["operations", "response.context"], ["restaurantOperations", "response.context"]]) {
    const expiry = `${prefix}.weather.provenance.expiresAt`;
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      let query = db.collectionGroup(group).where(expiry, "<=", new Date(now)).orderBy(expiry).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      for (const document of page.docs) {
        await db.runTransaction(async tx => {
          const fresh = await tx.get(document.ref);
          const weather = fresh.get(`${prefix}.weather`);
          if (!weather || weather.provenance?.source !== "google-weather") return;
          const expires = weather.provenance.expiresAt;
          if (typeof expires?.toMillis !== "function" || expires.toMillis() > now) return;
          tx.update(document.ref, { [`${prefix}.weather`]: null, [`${prefix}.availability.weather`]: "absent" });
          removed++;
        });
      }
      cursor = page.docs[page.docs.length - 1];
      if (page.size < 200) break;
    }
  }
  return removed;
}
