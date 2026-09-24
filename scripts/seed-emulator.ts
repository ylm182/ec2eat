import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
// Intentionally unable to seed a real project.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
if (
  !/^127\.0\.0\.1:\d+$/.test(authHost ?? "") ||
  !/^127\.0\.0\.1:\d+$/.test(dbHost ?? "")
)
  throw new Error("Set local Auth and Firestore emulator hosts first");
const app = initializeApp({ projectId: "demo-ec2eat" });
const auth = getAuth(app);
const db = getFirestore(app);
async function main() {
  for (const [uid, email, enabled] of [
    ["demo-owner", "owner@example.test", true],
    ["demo-denied", "denied@example.test", false],
  ] as const) {
    try {
      await auth.getUser(uid);
    } catch {
      await auth.createUser({
        uid,
        email,
        emailVerified: true,
        displayName: enabled ? "測試用戶" : "未獲邀測試用戶",
      });
    }
    await db.doc(`allowedUsers/${uid}`).set({ enabled });
  }
  console.log(
    "Local emulator accounts ready: owner@example.test (allowed), denied@example.test (denied). Use these emails in the emulated Google popup.",
  );
}
void main();
