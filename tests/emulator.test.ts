import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { authenticate } from "../lib/server/auth";
import { adminServices } from "../lib/server/firebase";
import { encodeDocument, userRepository } from "../lib/server/repository";
import { sessionFixture } from "./fixtures";
const project = "demo-ec2eat";
let env: RulesTestEnvironment;
async function googleToken(uid: string) {
  const result = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: "http://localhost",
        postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: uid, email: `${uid}@example.test`, email_verified: true }))}&providerId=google.com`,
        returnSecureToken: true,
      }),
    },
  );
  const body = await result.json();
  if (!body.idToken) throw new Error("Emulator sign-in failed");
  return { token: body.idToken as string, uid: body.localId as string };
}
const request = (token: string) =>
  new Request("http://localhost:3000/api/profile", {
    headers: { Authorization: `Bearer ${token}` },
  });
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Emulators required; refusing live tests");
  process.env.APP_MODE = "emulator";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.GOOGLE_CLOUD_PROJECT = project;
  env = await initializeTestEnvironment({
    projectId: project,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
  await env.clearFirestore();
});
afterAll(async () => {
  await env?.cleanup();
});
describe("real emulator authorization and isolation", () => {
  it("approved Google account works, disallowed/revoked accounts fail, other-user session is inaccessible", async () => {
    const alice = await googleToken("alice");
    const bob = await googleToken("bob");
    const { db } = adminServices();
    await db.doc(`allowedUsers/${alice.uid}`).set({ enabled: true });
    const user = await authenticate(request(alice.token));
    expect((await userRepository(db, user).profile()).uid).toBe(alice.uid);
    await expect(authenticate(request(bob.token))).rejects.toMatchObject({
      status: 403,
    });
    await db.doc(`allowedUsers/${bob.uid}`).set({ enabled: true });
    const other = await authenticate(request(bob.token));
    const fixture = sessionFixture(alice.uid);
    await db
      .doc(`users/${alice.uid}/sessions/session-1`)
      .set(encodeDocument(fixture) as Record<string, unknown>);
    expect((await userRepository(db, user).session("session-1")).uid).toBe(
      alice.uid,
    );
    await expect(
      userRepository(db, other).session("session-1"),
    ).rejects.toMatchObject({ status: 404 });
    await db.doc(`allowedUsers/${alice.uid}`).set({ enabled: false });
    await expect(authenticate(request(alice.token))).rejects.toMatchObject({
      status: 403,
    });
  });
  it("denies every direct client collection, even authenticated owner and allowlist edits", async () => {
    const clients = [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext("alice").firestore(),
    ];
    const paths = [
      "allowedUsers/alice",
      "users/alice",
      "users/alice/sessions/s",
      "users/bob/sessions/s",
      "users/alice/operations/r",
      "users/alice/restaurantRelations/p",
      "oauthConnections/alice",
      "internal/layaWarmup",
    ];
    for (const db of clients)
      for (const path of paths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { enabled: true }));
      }
  });
});
