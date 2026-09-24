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

describe("M5 shared scoring and warm-up coordination", () => {
  it("only one lease wins, scheduled bypasses suppression, expired ownership cannot release a successor", async () => {
    const { FirestoreLayaStore } = await import("../lib/laya/store");
    const { db } = adminServices();
    const store = new FirestoreLayaStore(db);
    const now = Date.now();
    const results = await Promise.all([
      store.acquire("a", now, 5000, true),
      store.acquire("b", now, 5000, true),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const owner = results[0] ? "a" : "b";
    await store.release(owner, true, now + 100);
    expect(await store.acquire("suppressed", now + 101, 5000, true)).toBe(
      false,
    );
    expect(await store.acquire("scheduled", now + 102, 5000, false)).toBe(true);
    expect(await store.acquire("successor", now + 6000, 5000, false)).toBe(
      true,
    );
    await store.release("scheduled", true, now + 6001);
    expect((await db.doc("internal/layaWarmup").get()).data()?.owner).toBe(
      "successor",
    );
    expect(await store.acquire("blocked", now + 6002, 5000, false)).toBe(false);
  });
  it("three consecutive failures open circuit for 60 seconds and success resets it", async () => {
    const { FirestoreLayaStore } = await import("../lib/laya/store");
    const { db } = adminServices();
    const store = new FirestoreLayaStore(db);
    const now = Date.now();
    await store.record(false, now);
    await store.record(false, now + 1);
    expect(await store.circuitOpen(now + 2)).toBe(false);
    await store.record(false, now + 2);
    expect(await store.circuitOpen(now + 3)).toBe(true);
    expect(await store.circuitOpen(now + 60003)).toBe(false);
    await store.record(true, now + 60004);
    expect(await store.circuitOpen(now + 60005)).toBe(false);
  });
  it("scores outside transactions, retains returned provider metadata and replay never rescoring", async () => {
    const { HeuristicDecisionProvider } = await import(
      "../lib/providers/heuristic"
    );
    const identity = await googleToken("laya-owner");
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    let calls = 0;
    const repo = decisionRepository(db, user, undefined, async (input) => {
      calls++;
      return {
        ...(await new HeuristicDecisionProvider().rank(
          input,
          new AbortController().signal,
        )),
        fallbackReason: "laya_http_503",
      };
    });
    const created = await repo.create({
      requestId: "laya-create",
      launchId: "launch",
      area: "中環",
    });
    expect(created.decision.fallbackReason).toBe("laya_http_503");
    expect(calls).toBe(1);
    const body = {
      requestId: "laya-answer",
      expectedRevision: 0,
      questionInstanceId: created.questions[0].instanceId,
      action: "neutral",
    };
    const answered = await repo.answer(created.id, body);
    expect(await repo.answer(created.id, body)).toEqual(answered);
    expect(calls).toBe(2);
    expect(answered.questions[0]).toEqual(created.questions[0]);
  });
  it("app-open is authenticated and Origin protected, while missing HF is honest", async () => {
    const { POST } = await import("../app/api/app-open/route");
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/app-open", { method: "POST" }),
        )
      ).status,
    ).toBe(401);
    const identity = await googleToken("warmup-owner");
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/app-open", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${identity.token}`,
              Origin: "https://wrong.test",
            },
          }),
        )
      ).status,
    ).toBe(403);
    const response = await POST(
      new Request("http://localhost:3000/api/app-open", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.token}`,
          Origin: "http://localhost:3000",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      status: "unavailable",
      reason: "laya_emulator",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("M6 restaurant transactions", () => {
  async function setup(label: string, mode = "results") {
    const { restaurantRepository } = await import("../lib/server/restaurants");
    const { syntheticPlaces } = await import("../lib/server/places");
    const identity = await googleToken(label);
    const { db } = adminServices();
    await db.doc("allowedUsers/" + identity.uid).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    const session = await decisionRepository(db, user).create({
      requestId: "create",
      launchId: "opening",
      area: "中環",
    });
    const provider = syntheticPlaces(mode);
    return {
      db,
      user,
      session,
      provider,
      repo: restaurantRepository(db, user, () => provider),
    };
  }
  it("persists only IDs and app metadata; explicit selection is idempotent and never a visit", async () => {
    const { db, user, session, provider, repo } =
      await setup("restaurants-select");
    let searches = 0;
    const nearby = provider.nearby;
    provider.nearby = async (...args) => {
      searches++;
      return nearby(...args);
    };
    const body = {
      requestId: "recommend",
      expectedRevision: session.revision,
      reason: "user_requested",
    };
    const ready = await repo.recommend(session.id, body);
    expect(ready.status).toBe("READY");
    expect(ready.decision.candidates).toHaveLength(3);
    expect(ready.decision.selectedPlaceId).toBeNull();
    expect(await repo.recommend(session.id, body)).toEqual(ready);
    expect(searches).toBe(1);
    expect((await repo.cards(session.id)).cards[0].name).toContain("合成");
    const saved = JSON.stringify(
      (
        await db.doc("users/" + user.uid + "/sessions/" + session.id).get()
      ).data(),
    );
    expect(saved).not.toMatch(
      /合成地址|示範餐廳|latitude|longitude|photo|rating|formattedAddress/,
    );
    const select = {
      requestId: "select",
      expectedRevision: ready.revision,
      placeId: ready.decision.candidates[1].placeId,
      launchId: "selection-opening",
    };
    const selected = await repo.select(session.id, select);
    expect(selected.status).toBe("SELECTED");
    expect(selected.selectionLaunchId).toBe("selection-opening");
    expect(selected.outcome.status).toBe("PENDING");
    expect(selected.outcome.actualPlaceId).toBeNull();
    expect(
      Date.parse(selected.outcome.eligibleAfter!) -
        Date.parse(selected.selectedAt!),
    ).toBe(4 * 3600000);
    provider.details = async () => {
      throw new Error("offline");
    };
    expect(await repo.select(session.id, select)).toEqual(selected);
    expect(await repo.recommend(session.id, body)).toEqual(ready);
    await expect(
      repo.select(session.id, {
        ...select,
        placeId: ready.decision.candidates[0].placeId,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    expect(selected.questions).toEqual(session.questions);
    expect(selected.answers).toEqual(session.answers);
  });
  it("competing selections commit once, unknown hours may be selected, arbitrary IDs and cross-user access fail", async () => {
    const { session, repo } = await setup("restaurants-race");
    const ready = await repo.recommend(session.id, {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    });
    await expect(
      repo.select(session.id, {
        requestId: "bad",
        expectedRevision: ready.revision,
        placeId: "invented",
        launchId: "opening",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    const body = {
      requestId: "same",
      expectedRevision: ready.revision,
      placeId: "synthetic-2",
      launchId: "opening",
    };
    const same = await Promise.all([
      repo.select(session.id, body),
      repo.select(session.id, body),
    ]);
    expect(same[0]).toEqual(same[1]);
    await expect(
      repo.select(session.id, {
        ...body,
        requestId: "competing",
        placeId: "synthetic-0",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const other = await setup("restaurants-other");
    await expect(other.repo.cards(session.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("empty search needs explicit expansion, only once, and closed candidates remain excluded", async () => {
    const { session, repo } = await setup("restaurants-empty", "closed");
    const empty = await repo.recommend(session.id, {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    });
    expect(empty.status).toBe("RECOMMENDING");
    expect(empty.search).toMatchObject({
      radiusM: 1500,
      expanded: false,
      result: "empty",
    });
    const expanded = await repo.recommend(session.id, {
      requestId: "expand",
      expectedRevision: empty.revision,
      reason: "automatic",
      expandArea: true,
    });
    expect(expanded.search).toMatchObject({
      radiusM: 5000,
      expanded: true,
      result: "empty",
    });
    await expect(
      repo.recommend(session.id, {
        requestId: "expand-again",
        expectedRevision: expanded.revision,
        reason: "automatic",
        expandArea: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPANSION" });
  });
  it("lease collapses simultaneous identical searches", async () => {
    const { session, provider, repo } = await setup("restaurants-lease");
    const original = provider.nearby;
    let release!: () => void;
    let entered!: () => void;
    const start = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.nearby = async (...args) => {
      entered();
      await wait;
      return original(...args);
    };
    const body = {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    };
    const pending = repo.recommend(session.id, body);
    await start;
    await expect(repo.recommend(session.id, body)).rejects.toMatchObject({
      code: "IN_PROGRESS",
    });
    release();
    const ready = await pending;
    expect(await repo.recommend(session.id, body)).toEqual(ready);
  });
  it("provider failure saves the stop and permits the same retry; missing details never imply a closed or visited place", async () => {
    const { session, provider, repo, user, db } = await setup(
      "restaurants-failure",
      "failure",
    );
    const body = {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    };
    await expect(repo.recommend(session.id, body)).rejects.toMatchObject({
      code: "PLACES_UNAVAILABLE",
    });
    const stopped = await userRepository(db, user).session(session.id);
    expect(stopped.status).toBe("RECOMMENDING");
    expect(stopped.questions).toEqual(session.questions);
    const { syntheticPlaces } = await import("../lib/server/places");
    Object.assign(provider, syntheticPlaces("results"));
    const ready = await repo.recommend(session.id, body);
    provider.details = async () => {
      throw new Error("offline");
    };
    expect(
      (await repo.cards(session.id)).cards.every(
        (c) => !c.available && c.openNow === null,
      ),
    ).toBe(true);
    await expect(
      repo.select(session.id, {
        requestId: "select",
        expectedRevision: ready.revision,
        placeId: "synthetic-0",
        launchId: "opening",
      }),
    ).rejects.toMatchObject({ code: "DETAILS_UNAVAILABLE" });
    expect((await userRepository(db, user).session(session.id)).status).toBe(
      "READY",
    );
  });
  it("fresh closure blocks selection and search locations cannot silently switch areas", async () => {
    const { session, provider, repo } = await setup("restaurants-closure");
    await expect(
      repo.recommend(session.id, {
        requestId: "wrong-area",
        expectedRevision: 0,
        reason: "user_requested",
        location: { latitude: 22.4445, longitude: 114.0222 },
      }),
    ).rejects.toMatchObject({ code: "LOCATION_CHANGED" });
    const ready = await repo.recommend(session.id, {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    });
    const original = provider.details;
    provider.details = async (...args) => ({
      ...(await original(...args)),
      businessStatus: "CLOSED_PERMANENTLY",
    });
    await expect(
      repo.select(session.id, {
        requestId: "select",
        expectedRevision: ready.revision,
        placeId: "synthetic-0",
        launchId: "opening",
      }),
    ).rejects.toMatchObject({ code: "PLACE_CLOSED" });
  });
  it("stale search results are discarded, and changed provider sources never query synthetic IDs live", async () => {
    const { session, provider, repo, db, user } =
      await setup("restaurants-stale");
    const original = provider.nearby;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const wait = new Promise<void>((r) => {
      release = r;
    });
    provider.nearby = async (...args) => {
      entered();
      await wait;
      return original(...args);
    };
    const pending = repo.recommend(session.id, {
      requestId: "rec",
      expectedRevision: 0,
      reason: "user_requested",
    });
    await started;
    const stopped = await userRepository(db, user).session(session.id);
    await decisionRepository(db, user).recommend(session.id, {
      requestId: "other-request",
      expectedRevision: stopped.revision,
      reason: "automatic",
    });
    release();
    await expect(pending).rejects.toMatchObject({ code: "STALE_REVISION" });
    const current = await userRepository(db, user).session(session.id);
    expect(current.decision.candidates).toEqual([]);
    provider.nearby = original;
    await repo.recommend(session.id, {
      requestId: "fresh",
      expectedRevision: current.revision,
      reason: "automatic",
    });
    provider.source = "google-places";
    let queried = false;
    provider.details = async () => {
      queried = true;
      throw new Error("must not query");
    };
    await expect(repo.cards(session.id)).rejects.toMatchObject({
      code: "PLACES_SOURCE_CHANGED",
    });
    expect(queried).toBe(false);
  });
  it("selection route requires authentication and exact Origin; cards never bypass access control", async () => {
    const { POST } = await import(
      "../app/api/decision/sessions/[id]/select/route"
    );
    const { GET } = await import(
      "../app/api/decision/sessions/[id]/restaurants/route"
    );
    const context = { params: Promise.resolve({ id: "missing" }) };
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/test", { method: "POST" }),
          context,
        )
      ).status,
    ).toBe(401);
    expect(
      (await GET(new Request("http://localhost:3000/api/test"), context))
        .status,
    ).toBe(401);
    const identity = await googleToken("restaurants-route");
    const { db } = adminServices();
    await db.doc("allowedUsers/" + identity.uid).set({ enabled: true });
    const response = await POST(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + identity.token,
          Origin: "https://wrong.test",
        },
        body: "{}",
      }),
      context,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("M7 selected-session history", () => {
  async function setup(name: string) {
    const identity = await googleToken(name);
    const { db } = adminServices();
    await db.doc("allowedUsers/" + identity.uid).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    const { historyRepository } = await import("../lib/server/history");
    return { db, user, identity, repo: historyRepository(db, user) };
  }
  async function seed(
    db: ReturnType<typeof adminServices>["db"],
    uid: string,
    id: string,
    selected = true,
  ) {
    const { selectedFixture } = await import("./fixtures");
    const s = selected ? selectedFixture() : sessionFixture(uid);
    s.uid = uid;
    s.id = id;
    s.context.area = "中環";
    if (selected)
      s.search = {
        radiusM: 1500,
        expanded: false,
        result: "ready",
        source: "synthetic",
        centreSource: "manual",
      };
    await db
      .doc("users/" + uid + "/sessions/" + id)
      .set(encodeDocument(s) as Record<string, unknown>);
    return s;
  }
  it("paginates 20 selected sessions by timestamp and ID; repeated places stay separate, new inserts do not duplicate older pages", async () => {
    const { db, user, repo } = await setup("history-pages");
    for (let i = 0; i < 25; i++)
      await seed(db, user.uid, "selection-" + String(i).padStart(2, "0"));
    await seed(db, user.uid, "unfinished", false);
    const first = await repo.page();
    expect(first.sessions).toHaveLength(20);
    expect(first.sessions[0].id).toBe("selection-24");
    expect(
      new Set(first.sessions.map((s) => s.decision.selectedPlaceId)).size,
    ).toBe(1);
    const inserted = await seed(db, user.uid, "newest");
    inserted.selectedAt = "2026-09-25T04:00:00.000Z";
    inserted.outcome.eligibleAfter = "2026-09-25T08:00:00.000Z";
    await db
      .doc("users/" + user.uid + "/sessions/newest")
      .set(encodeDocument(inserted) as Record<string, unknown>);
    const second = await repo.page(first.nextCursor!);
    expect(second.sessions.map((s) => s.id)).toEqual([
      "selection-04",
      "selection-03",
      "selection-02",
      "selection-01",
      "selection-00",
    ]);
    expect(second.nextCursor).toBeNull();
    expect((await repo.page()).sessions[0].id).toBe("newest");
    expect(
      new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size,
    ).toBe(25);
  });
  it("unknown, unfinished, malformed and other-user cursor anchors cannot expose history", async () => {
    const owner = await setup("history-owner");
    const other = await setup("history-other");
    await seed(owner.db, owner.user.uid, "private");
    await seed(other.db, other.user.uid, "unfinished", false);
    const { encodeHistoryCursor } = await import("../lib/server/history");
    expect((await other.repo.page()).sessions).toEqual([]);
    for (const cursor of [
      encodeHistoryCursor("private"),
      encodeHistoryCursor("unfinished"),
      encodeHistoryCursor("missing"),
      "bad!",
    ])
      await expect(other.repo.page(cursor)).rejects.toMatchObject({
        code: "INVALID_CURSOR",
      });
  });
  it("uses raw snapshot nanoseconds for cursor boundaries and rejects a deleted anchor", async () => {
    const { Timestamp } = await import("firebase-admin/firestore");
    const { db, user, repo } = await setup("history-precision");
    for (let i = 0; i < 22; i++) {
      const id = "precise-" + String(i).padStart(2, "0");
      await seed(db, user.uid, id);
      await db
        .doc("users/" + user.uid + "/sessions/" + id)
        .update({ selectedAt: new Timestamp(1790222400, i * 1000) });
    }
    const first = await repo.page();
    const second = await repo.page(first.nextCursor!);
    expect(second.sessions.map((s) => s.id)).toEqual([
      "precise-01",
      "precise-00",
    ]);
    await db
      .doc("users/" + user.uid + "/sessions/" + first.sessions.at(-1)!.id)
      .delete();
    await expect(repo.page(first.nextCursor!)).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });
  it("history refresh fetches only the selected restaurant and failures leave the immutable trail readable", async () => {
    const { db, user, repo } = await setup("history-details");
    const s = await seed(db, user.uid, "saved");
    s.decision.candidates = [
      { placeId: "synthetic-0", score: 0.6, weight: 0.6 },
      { placeId: "synthetic-2", score: 0.4, weight: 0.4 },
    ];
    s.decision.selectedPlaceId = "synthetic-2";
    s.decision.recommendedPlaceId = "synthetic-0";
    s.answers = [
      {
        questionInstanceId: s.questions[0].instanceId,
        action: "neutral",
        optionId: null,
        value: null,
        answeredAt: s.createdAt,
        requestId: "original-answer",
      },
    ];
    const path = db.doc("users/" + user.uid + "/sessions/saved");
    await path.set(encodeDocument(s) as Record<string, unknown>);
    const before = (await path.get()).data();
    const { restaurantRepository } = await import("../lib/server/restaurants");
    const { syntheticPlaces } = await import("../lib/server/places");
    const provider = syntheticPlaces("results");
    const details = provider.details;
    const ids: string[] = [];
    provider.details = async (...args) => {
      ids.push(args[0]);
      return details(...args);
    };
    const restaurants = restaurantRepository(db, user, () => provider);
    expect(
      (await restaurants.cards("saved", true)).cards.map((c) => c.placeId),
    ).toEqual(["synthetic-2"]);
    expect(ids).toEqual(["synthetic-2"]);
    provider.details = async () => {
      throw new Error("unavailable");
    };
    expect((await restaurants.cards("saved", true)).cards[0].available).toBe(
      false,
    );
    const history = (await repo.page()).sessions[0];
    expect(history.questions).toEqual(s.questions);
    expect(history.answers).toEqual(s.answers);
    expect(history.decision).toEqual(s.decision);
    expect((await path.get()).data()).toEqual(before);
    await seed(db, user.uid, "unfinished", false);
    await expect(restaurants.cards("unfinished", true)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("history endpoints enforce allowlist and ownership, reject extra query fields and use no-store responses", async () => {
    const { db, user, identity } = await setup("history-route");
    await seed(db, user.uid, "own");
    const { GET } = await import("../app/api/history/route");
    const { GET: detail } = await import(
      "../app/api/history/[id]/restaurant/route"
    );
    expect(
      (await GET(new Request("http://localhost:3000/api/history"))).status,
    ).toBe(401);
    const auth = { Authorization: "Bearer " + identity.token };
    const response = await GET(
      new Request("http://localhost:3000/api/history", { headers: auth }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data.sessions).toHaveLength(1);
    for (const suffix of ["?uid=another", "?cursor=a&cursor=b"])
      expect(
        (
          await GET(
            new Request("http://localhost:3000/api/history" + suffix, {
              headers: auth,
            }),
          )
        ).status,
      ).toBe(422);
    expect(
      (
        await detail(
          new Request("http://localhost:3000/api/history/foreign/restaurant", {
            headers: auth,
          }),
          { params: Promise.resolve({ id: "foreign" }) },
        )
      ).status,
    ).toBe(404);
    await db.doc("allowedUsers/" + user.uid).set({ enabled: false });
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/history", { headers: auth }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("M8 delayed outcomes and corrections", () => {
  const eligible = Date.parse("2026-09-24T08:00:00.000Z");
  async function setup(name: string) {
    const identity = await googleToken(name);
    const { db } = adminServices();
    await db.doc("allowedUsers/" + identity.uid).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    const { selectedFixture } = await import("./fixtures");
    const s = selectedFixture();
    s.uid = user.uid;
    s.id = "saved";
    s.context.area = "中環";
    s.search = {
      radiusM: 1500,
      result: "ready",
      expanded: false,
      source: "synthetic",
      centreSource: "manual",
    };
    await db
      .doc("users/" + user.uid + "/sessions/saved")
      .set(encodeDocument(s) as Record<string, unknown>);
    let now = eligible;
    const clock = () => now;
    const { outcomeRepository } = await import("../lib/server/outcomes");
    return {
      identity,
      db,
      user,
      s,
      repo: outcomeRepository(db, user, clock),
      clock,
      setTime: (v: number) => {
        now = v;
      },
    };
  }
  const body = (
    s: ReturnType<typeof sessionFixture>,
    requestId: string,
    status?: string,
  ) => ({
    requestId,
    launchId: "later",
    expectedRevision: s.revision,
    expectedOutcomeRevision: s.outcome.revision,
    ...(status ? { status } : { snooze: true }),
  });
  it("never prompts or confirms immediately or in the selecting launch; an empty opening stays empty as time passes", async () => {
    const { repo, s, setTime, db, user } = await setup("outcome-boundary");
    setTime(eligible - 1);
    expect(
      (await repo.open({ requestId: "early", launchId: "early" })).session,
    ).toBeNull();
    await expect(
      repo.save(s.id, body(s, "too-early", "VISITED_SELECTED")),
    ).rejects.toMatchObject({ code: "OUTCOME_NOT_ELIGIBLE" });
    setTime(eligible);
    expect(
      (await repo.open({ requestId: "early", launchId: "early" })).session,
    ).toBeNull();
    expect(
      (
        await repo.open({
          requestId: "select-launch",
          launchId: s.selectionLaunchId!,
        })
      ).session,
    ).toBeNull();
    await expect(
      repo.save(s.id, {
        ...body(s, "same-opening", "VISITED_SELECTED"),
        launchId: s.selectionLaunchId!,
      }),
    ).rejects.toMatchObject({ code: "OUTCOME_NOT_ELIGIBLE" });
    const opened = await repo.open({ requestId: "open", launchId: "later" });
    expect(opened.session?.id).toBe(s.id);
    expect(opened.session?.outcome.status).toBe("PENDING");
    expect(await repo.open({ requestId: "open", launchId: "later" })).toEqual(
      opened,
    );
    await db
      .doc("users/" + user.uid + "/limits/outcomes")
      .set({ hour: Math.floor(eligible / 3600000), opens: 60, mutations: 0 });
    await expect(
      repo.open({ requestId: "extra-alias", launchId: "later" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await repo.open({ requestId: "open", launchId: "later" })).toEqual(
      opened,
    );
  });
  it("skip is pending, exactly 24 hours, replay-safe, and never re-prompts in the skipping opening", async () => {
    const { repo, setTime } = await setup("outcome-snooze");
    const opened = (await repo.open({ requestId: "open", launchId: "later" }))
      .session!;
    const input = body(opened, "skip");
    const skipped = await repo.save(opened.id, input);
    expect(skipped.outcome.status).toBe("PENDING");
    expect(skipped.outcome.actualPlaceId).toBeNull();
    expect(skipped.outcome.confirmedAt).toBeNull();
    expect(Date.parse(skipped.outcome.snoozedUntil!)).toBe(eligible + 86400000);
    setTime(eligible + 86399999);
    expect(
      (await repo.open({ requestId: "before-day", launchId: "before-day" }))
        .session,
    ).toBeNull();
    setTime(eligible + 86400000);
    expect(await repo.save(opened.id, input)).toEqual(skipped);
    expect(
      (await repo.open({ requestId: "open", launchId: "later" })).session,
    ).toBeNull();
    expect(
      (await repo.open({ requestId: "after-day", launchId: "after-day" }))
        .session?.id,
    ).toBe(opened.id);
  });
  it("chooses newest eligible pending through snoozed rows and claims no second prompt in one opening", async () => {
    const { db, user, s, repo } = await setup("outcome-most-recent");
    for (let i = 1; i <= 22; i++) {
      const newer = structuredClone(s);
      newer.id = "snoozed-" + i;
      newer.selectedAt = new Date(Date.parse(s.selectedAt!) + i).toISOString();
      newer.outcome.eligibleAfter = new Date(eligible + i).toISOString();
      newer.outcome.snoozedUntil = new Date(eligible + 86400000).toISOString();
      await db
        .doc("users/" + user.uid + "/sessions/" + newer.id)
        .set(encodeDocument(newer) as Record<string, unknown>);
    }
    const { outcomeRepository } = await import("../lib/server/outcomes");
    const later = outcomeRepository(db, user, () => eligible + 1000);
    const open = (await later.open({ requestId: "open", launchId: "later" }))
      .session!;
    expect(open.id).toBe("saved");
    const confirmed = await later.save(
      open.id,
      body(open, "confirm", "VISITED_SELECTED"),
    );
    expect(confirmed.outcome.actualPlaceId).toBe(s.decision.selectedPlaceId);
    expect(
      (await later.open({ requestId: "again", launchId: "later" })).session,
    ).toBeNull();
    expect(
      (await repo.open({ requestId: "different-empty", launchId: "other" }))
        .session,
    ).toBeNull();
  });
  it("cross-tab duplicates and competing corrections cannot double-apply or change frozen evidence", async () => {
    const { repo, s, db, user } = await setup("outcome-races");
    const first = (await repo.open({ requestId: "open-a", launchId: "a" }))
      .session!;
    const second = (await repo.open({ requestId: "open-b", launchId: "b" }))
      .session!;
    await expect(
      repo.save(s.id, {
        ...body(first, "stale", "VISITED_SELECTED"),
        launchId: "a",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    const input = {
      ...body(second, "same", "VISITED_SELECTED"),
      launchId: "b",
    };
    const duplicate = await Promise.all([
      repo.save(s.id, input),
      repo.save(s.id, input),
    ]);
    expect(duplicate[0]).toEqual(duplicate[1]);
    const confirmed = duplicate[0];
    expect(confirmed.outcome.revision).toBe(second.outcome.revision + 1);
    const results = await Promise.allSettled([
      repo.save(s.id, body(confirmed, "correction-a", "DID_NOT_EAT_OUT")),
      repo.save(s.id, {
        ...body(confirmed, "correction-b", "VISITED_OTHER"),
        actualPlaceId: null,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await userRepository(db, user).session(s.id);
    expect(final.questions).toEqual(s.questions);
    expect(final.answers).toEqual(s.answers);
    expect(final.decision).toEqual(s.decision);
    expect(final.context).toEqual(s.context);
    expect(final.outcome.actualPlaceId).toBeNull();
    await expect(
      repo.save(s.id, { ...input, status: "DID_NOT_EAT_OUT" }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    const relation = (
      await db
        .doc(
          `users/${user.uid}/restaurantRelations/${s.decision.selectedPlaceId}`,
        )
        .get()
    ).data();
    expect(relation).toMatchObject({
      selectedCount: 1,
      actualVisitCount: 0,
      lastVisitAt: null,
    });
  }, 20000);
  it("other-place lookup stores IDs only, accepts a returned alternative, permits unknown, and rejects arbitrary/expired IDs", async () => {
    const { repo, s, db, user, clock, setTime } = await setup("outcome-other");
    const { searchActualRestaurants } = await import(
      "../lib/server/actual-restaurants"
    );
    const { syntheticPlaces } = await import("../lib/server/places");
    const found = await searchActualRestaurants(
      db,
      user,
      {
        requestId: "lookup",
        sessionId: s.id,
        launchId: "later",
        query: "示範",
      },
      () => syntheticPlaces("results"),
      clock,
    );
    expect(found.cards.length).toBeGreaterThan(0);
    const receipt = (
      await db.doc("users/" + user.uid + "/actualLookups/lookup").get()
    ).data();
    expect(JSON.stringify(receipt)).not.toMatch(
      /示範|address|name|rating|query/,
    );
    await expect(
      repo.save(s.id, {
        ...body(s, "invented", "VISITED_OTHER"),
        actualPlaceId: "invented",
        lookupRequestId: "lookup",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACTUAL_PLACE" });
    const saved = await repo.save(s.id, {
      ...body(s, "other", "VISITED_OTHER"),
      actualPlaceId: found.cards[0].placeId,
      lookupRequestId: "lookup",
    });
    expect(saved.outcome.actualPlaceId).toBe(found.cards[0].placeId);
    setTime(eligible + 15 * 60000);
    await expect(
      repo.save(s.id, {
        ...body(saved, "expired", "VISITED_OTHER"),
        actualPlaceId: found.cards[0].placeId,
        lookupRequestId: "lookup",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACTUAL_PLACE" });
    const unknown = await repo.save(s.id, {
      ...body(saved, "unknown", "VISITED_OTHER"),
      actualPlaceId: null,
    });
    expect(unknown.outcome.actualPlaceId).toBeNull();
    const missed = await repo.save(
      s.id,
      body(unknown, "missed", "DID_NOT_EAT_OUT"),
    );
    expect(missed.outcome.status).toBe("DID_NOT_EAT_OUT");
    expect(missed.outcome.actualPlaceId).toBeNull();
  });
  it("outcome/open/search endpoints enforce Origin and authorization; another user cannot confirm a session", async () => {
    const { identity, user, db, s } = await setup("outcome-route");
    const { POST } = await import(
      "../app/api/decision/sessions/[id]/outcome/route"
    );
    const { POST: open } = await import("../app/api/app/open/route");
    const { POST: search } = await import(
      "../app/api/restaurants/search/route"
    );
    const context = { params: Promise.resolve({ id: s.id }) };
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/test", { method: "POST" }),
          context,
        )
      ).status,
    ).toBe(401);
    for (const route of [open, search])
      expect(
        (
          await route(
            new Request("http://localhost:3000/api/test", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + identity.token,
                Origin: "https://wrong.test",
              },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(403);
    const other = await setup("outcome-foreign");
    await db.doc("users/" + other.user.uid + "/sessions/saved").delete();
    await expect(
      other.repo.save(s.id, body(s, "foreign", "VISITED_SELECTED")),
    ).rejects.toMatchObject({ status: 404 });
    await db.doc("allowedUsers/" + user.uid).set({ enabled: false });
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/test", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + identity.token,
              Origin: "http://localhost:3000",
            },
            body: JSON.stringify(body(s, "denied", "VISITED_SELECTED")),
          }),
          context,
        )
      ).status,
    ).toBe(403);
  });
  it("lookup retries preserve accepted IDs, failures allow unknown-other, and real open returns profile plus independent warm-up", async () => {
    const { repo, s, db, user, identity, clock } = await setup(
      "outcome-lookup-retry",
    );
    const { searchActualRestaurants } = await import(
      "../lib/server/actual-restaurants"
    );
    const { syntheticPlaces } = await import("../lib/server/places");
    const provider = syntheticPlaces("closed");
    const query = {
      requestId: "lookup-stable",
      sessionId: s.id,
      launchId: "later",
      query: "示範",
    };
    const first = await searchActualRestaurants(
      db,
      user,
      query,
      () => provider,
      clock,
    );
    expect(first.cards.length).toBeGreaterThan(0);
    provider.text = async () => [];
    expect(
      (
        await searchActualRestaurants(db, user, query, () => provider, clock)
      ).cards.map((c) => c.placeId),
    ).toEqual(first.cards.map((c) => c.placeId));
    await expect(
      searchActualRestaurants(
        db,
        user,
        { ...query, query: "改字" },
        () => provider,
        clock,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    await expect(
      searchActualRestaurants(
        db,
        user,
        { ...query, requestId: "lookup-failure" },
        () => syntheticPlaces("failure"),
        clock,
      ),
    ).rejects.toMatchObject({ code: "PLACES_UNAVAILABLE" });
    const unknown = await repo.save(s.id, {
      ...body(s, "no-lookup", "VISITED_OTHER"),
      actualPlaceId: null,
    });
    expect(unknown.outcome.status).toBe("VISITED_OTHER");
    const { POST } = await import("../app/api/app/open/route");
    const response = await POST(
      new Request("http://localhost:3000/api/app/open", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + identity.token,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: "real-open", launchId: "real-open" }),
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.profile.uid).toBe(user.uid);
    expect(data.session).toBeNull();
    expect(data.warmup.status).toBe("unavailable");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("M9 recomputed learning and deletion", () => {
  async function setup(name: string) {
    const identity = await googleToken(name);
    const { db } = adminServices();
    await db.doc(`allowedUsers/${identity.uid}`).set({ enabled: true });
    const user = await authenticate(request(identity.token));
    const { outcomeRepository } = await import("../lib/server/outcomes");
    const { deletionRepository } = await import("../lib/server/deletion");
    return {
      identity,
      user,
      db,
      root: db.doc(`users/${user.uid}`),
      outcomes: outcomeRepository(db, user, () =>
        Date.parse("2026-10-01T08:00:00Z"),
      ),
      deletion: deletionRepository(db, user),
    };
  }
  async function fixture(uid: string, id: string, confirmed = false) {
    const { selectedFixture } = await import("./fixtures");
    const s = selectedFixture();
    s.uid = uid;
    s.id = id;
    s.answers = [
      {
        questionInstanceId: "question-1",
        action: "left",
        optionId: "left",
        value: 0.8,
        answeredAt: s.createdAt,
        requestId: "answer",
      },
    ];
    if (confirmed)
      s.outcome = {
        ...s.outcome,
        status: "VISITED_SELECTED",
        actualPlaceId: s.decision.selectedPlaceId,
        confirmedAt: "2026-09-24T08:00:00.000Z",
      };
    return s;
  }
  function body(
    s: ReturnType<typeof sessionFixture>,
    requestId: string,
    status = "VISITED_SELECTED",
  ) {
    return {
      requestId,
      launchId: "later",
      expectedRevision: s.revision,
      expectedOutcomeRevision: s.outcome.revision,
      status,
    };
  }
  it("recomputes a 20-session window, refills on correction/deletion and does not double count replay", async () => {
    const { db, user, root, outcomes, deletion } =
      await setup("learning-window");
    for (let i = 0; i < 21; i++) {
      const s = await fixture(
        user.uid,
        `s${String(i).padStart(2, "0")}`,
        i < 20,
      );
      await root
        .collection("sessions")
        .doc(s.id)
        .set(encodeDocument(s) as Record<string, unknown>);
    }
    const pending = await userRepository(db, user).session("s20");
    const confirmed = await outcomes.save(pending.id, body(pending, "confirm"));
    const profile = (await root.get()).data()!;
    expect(profile.learningSourceSessionIds).toHaveLength(20);
    expect(profile.learningSourceSessionIds).not.toContain("s00");
    expect(profile.priors.speed.strength).toBe(0.25);
    const fresh = await decisionRepository(db, user).create({
      requestId: "new-prior",
      launchId: "new",
      area: "中環",
    });
    expect(fresh.priorVersion).toBe(profile.priorVersion);
    expect(fresh.preferences.speed).toEqual(profile.priors.speed);
    expect(await outcomes.save(pending.id, body(pending, "confirm"))).toEqual(
      confirmed,
    );
    expect((await root.get()).data()?.learningRevision).toBe(
      profile.learningRevision,
    );
    expect(
      (
        await root
          .collection("restaurantRelations")
          .doc("synthetic-place")
          .get()
      ).data(),
    ).toMatchObject({ selectedCount: 21, actualVisitCount: 21 });
    const corrected = await outcomes.save(
      confirmed.id,
      body(confirmed, "correct", "DID_NOT_EAT_OUT"),
    );
    expect((await root.get()).data()?.learningSourceSessionIds).toContain(
      "s00",
    );
    expect(corrected.priorVersion).toBe(pending.priorVersion);
    expect(corrected.preferences).toEqual(pending.preferences);
    await deletion.session("s19", { confirm: true, expectedRevision: 0 });
    const next = (await root.get()).data()!;
    expect(next.learningSourceSessionIds).toHaveLength(19);
    expect(next.priors.speed.strength).toBe(0.2375);
    expect(
      (
        await root
          .collection("restaurantRelations")
          .doc("synthetic-place")
          .get()
      ).data(),
    ).toMatchObject({ selectedCount: 20, actualVisitCount: 19 });
    await deletion.session("s19", { confirm: true, expectedRevision: 0 });
    expect((await root.get()).data()?.learningRevision).toBe(
      next.learningRevision,
    );
  }, 20000);
  it("serializes confirmations on different sessions and removes evidence when both are deleted", async () => {
    const { root, user, outcomes, deletion } = await setup("learning-race");
    const a = await fixture(user.uid, "a"),
      b = await fixture(user.uid, "b");
    for (const s of [a, b])
      await root
        .collection("sessions")
        .doc(s.id)
        .set(encodeDocument(s) as Record<string, unknown>);
    const results = await Promise.all([
      outcomes.save(a.id, body(a, "a")),
      outcomes.save(b.id, body(b, "b")),
    ]);
    expect((await root.get()).data()?.learningSourceSessionIds).toHaveLength(2);
    expect(
      (
        await root
          .collection("restaurantRelations")
          .doc("synthetic-place")
          .get()
      ).data(),
    ).toMatchObject({ selectedCount: 2, actualVisitCount: 2 });
    for (const s of results)
      await deletion.session(s.id, {
        confirm: true,
        expectedRevision: s.revision,
      });
    expect((await root.get()).data()?.priors.speed.state).toBe("unknown");
    expect((await root.collection("restaurantRelations").get()).empty).toBe(
      true,
    );
    await expect(outcomes.save(a.id, body(a, "a"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await root.collection("operations").get()).empty).toBe(true);
  }, 20000);
  it("deleted create requests cannot recreate sessions; in-flight scoring cannot restore account data", async () => {
    const { root, db, user, deletion, identity } =
      await setup("delete-inflight");
    const repo = decisionRepository(db, user);
    const input = { requestId: "create", launchId: "start", area: "中環" };
    const s = await repo.create(input);
    await expect(
      deletion.session(s.id, { confirm: true, expectedRevision: 99 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await deletion.session(s.id, {
      confirm: true,
      expectedRevision: s.revision,
    });
    await expect(repo.create(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    let release!: () => void, entered!: () => void;
    const pause = new Promise<void>((resolve) => (release = resolve)),
      ready = new Promise<void>((resolve) => (entered = resolve));
    const { HeuristicDecisionProvider } = await import(
      "../lib/providers/heuristic"
    );
    const slow = decisionRepository(db, user, undefined, async (input) => {
      entered();
      await pause;
      return new HeuristicDecisionProvider().rank(
        input,
        new AbortController().signal,
      );
    });
    const pending = slow.create({ ...input, requestId: "inflight" });
    await ready;
    await db.doc(`oauthConnections/${user.uid}`).set({
      generation: "test",
      encryptedRefreshToken: "synthetic-not-a-token",
    });
    await db.doc("oauthStates/delete-test").set({ uid: user.uid });
    const removed = await deletion.account({ confirm: "DELETE" });
    expect(removed).toEqual({ deleted: true, revoked: false });
    release();
    await expect(pending).rejects.toMatchObject({ code: "DATA_DELETED" });
    expect((await root.get()).exists).toBe(false);
    expect(await root.listCollections()).toHaveLength(0);
    expect((await db.doc(`oauthConnections/${user.uid}`).get()).exists).toBe(
      false,
    );
    expect((await db.doc("oauthStates/delete-test").get()).exists).toBe(false);
    expect(await deletion.account({ confirm: "DELETE" })).toEqual(removed);
    await expect(authenticate(request(identity.token))).rejects.toMatchObject({
      code: "DATA_DELETED",
    });
    await expect(
      authenticate(request(identity.token), undefined, true),
    ).resolves.toMatchObject({ uid: user.uid });
  }, 20000);
  it("initializes priors from pre-M9 confirmations without rewriting their snapshots", async () => {
    const { db, root, user } = await setup("learning-bootstrap");
    const old = await fixture(user.uid, "legacy", true);
    await root
      .collection("sessions")
      .doc(old.id)
      .set(encodeDocument(old) as Record<string, unknown>);
    const next = await decisionRepository(db, user).create({
      requestId: "first-m9",
      launchId: "new",
      area: "中環",
    });
    expect(next.preferences.speed).toEqual({
      state: "inferred",
      value: 0.8,
      strength: 0.0125,
    });
    expect(next.priorVersion).toBe((await root.get()).data()?.priorVersion);
    expect(await userRepository(db, user).session(old.id)).toEqual(old);
  });
  it("deletion routes enforce origin, ownership and confirmation", async () => {
    const owner = await setup("delete-routes-owner"),
      stranger = await setup("delete-routes-stranger");
    const s = await fixture(owner.user.uid, "private");
    await owner.root
      .collection("sessions")
      .doc(s.id)
      .set(encodeDocument(s) as Record<string, unknown>);
    const { POST } = await import(
      "../app/api/sessions/[sessionId]/delete/route"
    );
    const call = (token: string, origin: string, body: unknown) =>
      POST(
        new Request("http://localhost:3000/api/sessions/private/delete", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ sessionId: s.id }) },
      );
    expect(
      (
        await call(owner.identity.token, "https://other.test", {
          confirm: true,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(stranger.identity.token, "http://localhost:3000", {
          confirm: true,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(owner.identity.token, "http://localhost:3000", {
          confirm: false,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(422);
    expect(
      (await owner.root.collection("sessions").doc(s.id).get()).exists,
    ).toBe(true);
  });
});
