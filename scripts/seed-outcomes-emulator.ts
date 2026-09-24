import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { newSession, requestOptions } from "../lib/domain/session";
import { sessionSchema, idSchema } from "../lib/domain/schema";
// Opt-in fixtures only: never change a user's real selection or weaken runtime clocks.
if (
  process.env.APP_MODE !== "emulator" ||
  process.env.GOOGLE_CLOUD_PROJECT !== "demo-ec2eat" ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")
)
  throw new Error("Local demo emulators required");
const uid = idSchema.parse(process.argv[2] ?? "demo-owner");
const db = getFirestore(initializeApp({ projectId: "demo-ec2eat" }));
const timestampKeys = new Set([
  "createdAt",
  "updatedAt",
  "selectedAt",
  "capturedAt",
  "issuedAt",
  "answeredAt",
  "eligibleAfter",
  "confirmedAt",
  "snoozedUntil",
  "fetchedAt",
  "expiresAt",
]);
function encode(value: unknown, key = ""): unknown {
  if (typeof value === "string" && timestampKeys.has(key))
    return Timestamp.fromDate(new Date(value));
  if (Array.isArray(value)) return value.map((v) => encode(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encode(v, k)]),
    );
  return value;
}
async function main() {
  if (!(await db.doc("allowedUsers/" + uid).get()).data()?.enabled)
    throw new Error("Use an existing approved emulator UID");
  const batch = db.batch();
  for (const [label, hours] of [
    ["eligible", 5],
    ["older", 6],
    ["recent", 1],
  ] as const) {
    const time = new Date(Date.now() - hours * 3600000).toISOString();
    const id = "m8-fixture-" + label;
    const initial = newSession({
      id,
      uid,
      launchId: "m8-fixture-selection-opening",
      area: "中環",
      now: time,
    });
    const stopped = requestOptions(initial, 0, "user_requested", time);
    const s = sessionSchema.parse({
      ...stopped,
      status: "SELECTED",
      selectedAt: time,
      selectionLaunchId: initial.launchId,
      context: {
        ...stopped.context,
        availability: { ...stopped.context.availability, fixture: "available" },
      },
      search: {
        radiusM: 1500,
        expanded: false,
        result: "ready",
        source: "synthetic",
        centreSource: "manual",
      },
      decision: {
        ...stopped.decision,
        candidates: [{ placeId: "synthetic-0", score: 0.5, weight: 1 }],
        recommendedPlaceId: "synthetic-0",
        selectedPlaceId: "synthetic-0",
        reason: "合成 M8 測試選擇",
      },
      outcome: {
        ...stopped.outcome,
        eligibleAfter: new Date(Date.parse(time) + 4 * 3600000).toISOString(),
      },
    });
    batch.set(
      db.doc("users/" + uid + "/sessions/" + id),
      encode(s) as Record<string, unknown>,
    );
  }
  await batch.commit();
  console.log(
    "Three clearly synthetic M8 fixtures created/reset for approved emulator user. Reload the app: the 5-hour selection is eligible, the 1-hour selection is not. Other sessions and opening records were untouched.",
  );
}
void main();
