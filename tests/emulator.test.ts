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
import { decisionRepository } from "../lib/server/decisions";
import { decisionRoute } from "../lib/server/decision-route";
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

describe("M3 transactional decisions", () => {
  async function approved(name: string) {
    const identity = await googleToken(name);
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    return { identity, user: await authenticate(request(identity.token)), db };
  }
  it("replays create/answer responses exactly, rejects changed bodies and concurrent alternate answers", async () => {
    const { user, db } = await approved("engine-owner");
    const repository = decisionRepository(db, user);
    const create = {
      requestId: "create-1",
      launchId: "launch-1",
      area: "旺角",
    };
    const [first, duplicate] = await Promise.all([
      repository.create(create),
      repository.create(create),
    ]);
    expect(first).toEqual(duplicate);
    expect(first.revision).toBe(0);
    await expect(
      repository.create({ ...create, area: "中環" }),
    ).rejects.toMatchObject({ status: 409 });
    const body = {
      requestId: "answer-1",
      expectedRevision: 0,
      questionInstanceId: first.questions[0].instanceId,
      action: "neutral",
    };
    const results = await Promise.all([
      repository.answer(first.id, body),
      repository.answer(first.id, body),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].answers).toHaveLength(1);
    expect(results[0].revision).toBe(1);
    const second = results[0];
    const question = second.questions.at(-1)!;
    const choices = [
      {
        requestId: "answer-a",
        expectedRevision: 1,
        questionInstanceId: question.instanceId,
        action: "left",
        optionId: "left",
      },
      {
        requestId: "answer-b",
        expectedRevision: 1,
        questionInstanceId: question.instanceId,
        action: "right",
        optionId: "right",
      },
    ];
    const races = await Promise.allSettled(
      choices.map((c) => repository.answer(first.id, c)),
    );
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await userRepository(db, user).session(first.id)).answers,
    ).toHaveLength(2);
    // A replay returns its original response even after later mutations.
    expect(await repository.answer(first.id, body)).toEqual(second);
    await db.doc(`users/${user.uid}/operations/create-1`).delete();
    await expect(repository.create(create)).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.collection(`users/${user.uid}/sessions`).get()).size).toBe(
      1,
    );
  }, 20_000);
  it("isolates mutations and completes a persisted neutral flow, including category and six-answer cap", async () => {
    const owner = await approved("flow-owner");
    const outsider = await approved("flow-other");
    const repository = decisionRepository(owner.db, owner.user);
    let s = await repository.create({
      requestId: "create-flow",
      launchId: "launch",
      area: "灣仔",
    });
    await expect(
      decisionRepository(outsider.db, outsider.user).answer(s.id, {
        requestId: "attack",
        expectedRevision: 0,
        questionInstanceId: s.questions[0].instanceId,
        action: "neutral",
      }),
    ).rejects.toMatchObject({ status: 404 });
    while (s.status === "QUESTIONING") {
      s = await repository.answer(s.id, {
        requestId: `answer-${s.answers.length}`,
        expectedRevision: s.revision,
        questionInstanceId: s.questions.at(-1)!.instanceId,
        action: "neutral",
      });
      expect(s.answers.length).toBeLessThanOrEqual(6);
    }
    const stored = await userRepository(owner.db, owner.user).session(s.id);
    expect(stored).toEqual(s);
    expect(s.decision.stopReason).not.toBeNull();
    expect(s.outcome.eligibleAfter).toBeNull();
    expect(s.decision.candidates).toEqual([]);
  }, 20_000);
  it("enforces Origin/payloads and reports unavailable Places after a durable explicit stop", async () => {
    const { identity, user, db } = await approved("route-owner");
    const post = (body: unknown, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/decision/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.token}`,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await decisionRoute(
          post(
            { requestId: "bad", launchId: "launch", area: "旺角" },
            "https://wrong.example",
          ),
          "create",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await decisionRoute(
          post({
            requestId: "bad",
            launchId: "launch",
            area: "旺角",
            uid: "forged",
          }),
          "create",
        )
      ).status,
    ).toBe(422);
    const created = await decisionRoute(
      post({ requestId: "route-create", launchId: "launch", area: "旺角" }),
      "create",
    );
    expect(created.status).toBe(200);
    const payload = await created.json();
    expect(payload.requestId).toBe("route-create");
    expect(payload.revision).toBe(0);
    const stop = await decisionRoute(
      post({
        requestId: "stop",
        expectedRevision: 0,
        reason: "user_requested",
      }),
      "recommend",
      payload.data.id,
    );
    expect(stop.status).toBe(503);
    expect((await stop.json()).requestId).toBe("stop");
    const stored = await userRepository(db, user).session(payload.data.id);
    expect(stored.status).toBe("RECOMMENDING");
    expect(stored.decision.stopReason).toBe("user_requested");
    await expect(
      decisionRepository(db, user).answer(stored.id, {
        requestId: "late",
        expectedRevision: 1,
        questionInstanceId: stored.questions[0].instanceId,
        action: "neutral",
      }),
    ).rejects.toMatchObject({ status: 409 });
  }, 20_000);
});

describe("M4 context and Calendar authorization in Firestore", () => {
  it("persists only coarse context and replays without another provider call", async () => {
    const identity = await googleToken("context-owner");
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    let weatherCalls = 0;
    const repo = decisionRepository(db, user, {
      mock: true,
      weather: async () => {
        weatherCalls++;
        return { condition: "RAIN", temperatureC: 24 };
      },
      calendar: async () => ({
        version: 1,
        nextEventSoon: true,
        socialHint: true,
        areaHint: "灣仔",
        mealHint: "lunch",
      }),
    });
    const body = {
      requestId: "m4-create",
      launchId: "m4-launch",
      location: { latitude: 22.2819, longitude: 114.1589 },
    };
    const first = await repo.create(body);
    expect(await repo.create(body)).toEqual(first);
    expect(weatherCalls).toBe(1);
    expect(first.context).toMatchObject({
      area: "中環",
      locationSource: "gps",
      calendar: { nextEventSoon: true, areaHint: "灣仔" },
    });
    const saved = (
      await db.doc(`users/${user.uid}/sessions/${first.id}`).get()
    ).data();
    expect(JSON.stringify(saved)).not.toMatch(
      /latitude|longitude|22.2819|114.1589/,
    );
    expect((await userRepository(db, user).session(first.id)).context).toEqual(
      first.context,
    );
  });
  it("OAuth state rejects wrong browser, expiry, replay and revoked allowlist", async () => {
    const { CalendarAuthorization } = await import(
      "../lib/server/calendar-oauth"
    );
    const { db } = adminServices();
    const vault = {
      seal: async () => "cipher-fixture",
      open: async () => "synthetic-refresh",
    };
    const flow = new CalendarAuthorization(
      db,
      {
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        origin: "https://example.test",
      },
      vault,
    );
    for (const uid of ["oauth-state", "oauth-expired", "oauth-denied"])
      await db.doc(`allowedUsers/${uid}`).set({ enabled: true });
    const begun = await flow.begin("oauth-state");
    const state = new URL(begun.url).searchParams.get("state")!;
    expect(new URL(begun.url).searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    await expect(flow.consume(state, "wrong")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await flow.consume(state, begun.binding)).toMatchObject({
      uid: "oauth-state",
    });
    await expect(flow.consume(state, begun.binding)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const expired = await flow.begin("oauth-expired");
    const { createHash } = await import("node:crypto");
    const { Timestamp } = await import("firebase-admin/firestore");
    const expiredState = new URL(expired.url).searchParams.get("state")!;
    await db
      .doc(
        `oauthStates/${createHash("sha256").update(expiredState).digest("hex")}`,
      )
      .update({ expiresAt: Timestamp.fromMillis(0) });
    await expect(
      flow.consume(expiredState, expired.binding),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const denied = await flow.begin("oauth-denied");
    await db.doc("allowedUsers/oauth-denied").set({ enabled: false });
    await expect(
      flow.consume(
        new URL(denied.url).searchParams.get("state")!,
        denied.binding,
      ),
    ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
  it("stores ciphertext only; revoked refresh clears authorization; disconnect blocks late callbacks", async () => {
    const { CalendarAuthorization, CALENDAR_SCOPE } = await import(
      "../lib/server/calendar-oauth"
    );
    const { db } = adminServices();
    const uid = "oauth-tokens";
    await db.doc(`allowedUsers/${uid}`).set({ enabled: true });
    let revoked = false;
    const flow = new CalendarAuthorization(
      db,
      {
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        origin: "https://example.test",
      },
      {
        seal: async () => "encrypted-only",
        open: async () => "synthetic-refresh",
      },
      async () =>
        new Response(
          JSON.stringify(
            revoked
              ? { error: "invalid_grant" }
              : {
                  access_token: "synthetic-access",
                  refresh_token: "synthetic-refresh",
                  scope: CALENDAR_SCOPE,
                  expires_in: 3600,
                  token_type: "Bearer",
                },
          ),
          { status: revoked ? 400 : 200 },
        ),
    );
    const begun = await flow.begin(uid);
    const identity = await flow.consume(
      new URL(begun.url).searchParams.get("state")!,
      begun.binding,
    );
    await flow.finish(identity, "synthetic-code", new AbortController().signal);
    const saved = (await db.doc(`oauthConnections/${uid}`).get()).data();
    expect(saved?.encryptedRefreshToken).toBe("encrypted-only");
    expect(JSON.stringify(saved)).not.toMatch(
      /synthetic-refresh|synthetic-access|synthetic-code|synthetic-secret/,
    );
    expect((await db.doc(`users/${uid}`).get()).data()?.calendarConnected).toBe(
      true,
    );
    revoked = true;
    await expect(
      flow.access(uid, new AbortController().signal),
    ).rejects.toMatchObject({ code: "denied" });
    expect(
      (await db.doc(`oauthConnections/${uid}`).get()).data()
        ?.encryptedRefreshToken,
    ).toBeUndefined();
    expect((await db.doc(`users/${uid}`).get()).data()?.calendarConnected).toBe(
      false,
    );
    revoked = false;
    await flow.clear(uid);
    await expect(
      flow.finish(identity, "late-code", new AbortController().signal),
    ).rejects.toMatchObject({ code: "denied" });
  });
  it("Calendar mutation requires Origin; absent config stays optional and private", async () => {
    const { calendarRoute } = await import("../lib/server/calendar-route");
    const identity = await googleToken("calendar-routes");
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    const wrong = await calendarRoute(
      new Request("http://localhost:3000/api/calendar/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.token}`,
          Origin: "https://wrong.test",
        },
      }),
      "start",
    );
    expect(wrong.status).toBe(403);
    const status = await calendarRoute(request(identity.token), "status");
    expect((await status.json()).data).toEqual({
      configured: false,
      connected: false,
      fixture: null,
    });
    expect(status.headers.get("cache-control")).toBe("private, no-store");
    const start = await calendarRoute(
      new Request("http://localhost:3000/api/calendar/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.token}`,
          Origin: "http://localhost:3000",
        },
      }),
      "start",
    );
    expect(start.status).toBe(503);
  });
});
