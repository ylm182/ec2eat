import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticate, type AuthDependencies } from "../lib/server/auth";
import { apiResponse, parseBody, requireOrigin } from "../lib/server/http";
import { serverConfig } from "../lib/server/config";
import { decodeDocument, encodeDocument } from "../lib/server/repository";
import {
  answerInput,
  createSessionInput,
  preferenceSchema,
  sessionSchema,
} from "../lib/domain/schema";
import { validateTransition } from "../lib/domain/transitions";
import {
  mayPersist,
  maySendToModel,
  templateLanguage,
  unconfiguredPlaces,
} from "../lib/providers/unconfigured";
import { selectedFixture, sessionFixture } from "./fixtures";
const deps: AuthDependencies = {
  verify: async (token) => {
    if (token === "bad") throw new Error("secret should not leak");
    return { uid: token, provider: "google.com" };
  },
  allowed: async (uid) => uid === "alice",
};
const request = (token?: string) =>
  new Request("http://localhost:3000/api/profile", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
afterEach(() => vi.unstubAllEnvs());
describe("authorization", () => {
  it("accepts verified allowlisted Google identity", async () =>
    expect((await authenticate(request("alice"), deps)).uid).toBe("alice"));
  it.each([undefined, "bad"])(
    "rejects absent or invalid token: %s",
    async (token) => {
      await expect(authenticate(request(token), deps)).rejects.toMatchObject({
        status: 401,
      });
    },
  );
  it("rejects unapproved user and non-Google login", async () => {
    await expect(authenticate(request("bob"), deps)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      authenticate(request("alice"), {
        ...deps,
        verify: async () => ({ uid: "alice", provider: "password" }),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not trust a body UID", async () => {
    const r = new Request("http://localhost:3000", {
      method: "POST",
      headers: { Authorization: "Bearer alice" },
      body: JSON.stringify({ uid: "bob" }),
    });
    expect((await authenticate(r, deps)).uid).toBe("alice");
  });
  it("rejects forged origin", () => {
    vi.stubEnv("APP_MODE", "emulator");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "demo-ec2eat");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    expect(() =>
      requireOrigin(
        new Request("http://localhost:3000", {
          headers: { origin: "https://attacker.invalid" },
        }),
      ),
    ).toThrow();
    expect(() =>
      requireOrigin(
        new Request("http://localhost:3000", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => serverConfig()).toThrow("Unsafe emulator");
  });
  it("returns private responses without leaking error details", async () => {
    const result = await apiResponse(async () => {
      throw new Error("secret payload");
    });
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await result.json())).not.toContain("secret payload");
  });
});
describe("domain boundaries", () => {
  it("requires explicit area/location and rejects client values or UID", () => {
    expect(
      createSessionInput.safeParse({ launchId: "launch", requestId: "req" })
        .success,
    ).toBe(false);
    expect(
      createSessionInput.safeParse({
        launchId: "launch",
        requestId: "req",
        area: "中環",
      }).success,
    ).toBe(true);
    expect(
      answerInput.safeParse({
        requestId: "req",
        expectedRevision: 0,
        questionInstanceId: "q",
        action: "left",
        value: 0.2,
      }).success,
    ).toBe(false);
  });
  it("handles malformed JSON as validation failure", async () => {
    await expect(
      parseBody(
        new Request("http://localhost", { method: "POST", body: "{" }),
        answerInput,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("neutral is null and inferred is bounded", () => {
    expect(
      preferenceSchema.safeParse({ state: "neutral", value: 0.5, strength: 0 })
        .success,
    ).toBe(false);
    expect(
      preferenceSchema.safeParse({
        state: "inferred",
        value: 0.5,
        strength: 0.8,
      }).success,
    ).toBe(false);
  });
  it("round trips UTC timestamps through Firestore", () => {
    const s = sessionFixture();
    expect(sessionSchema.parse(decodeDocument(encodeDocument(s)))).toEqual(s);
  });
  it("accepts issued reversed-polarity option and rejects fabricated value", () => {
    const s = sessionFixture();
    s.answers = [
      {
        questionInstanceId: "question-1",
        action: "left",
        optionId: "left",
        value: 0.8,
        answeredAt: s.createdAt,
        requestId: "req",
      },
    ];
    expect(sessionSchema.safeParse(s).success).toBe(true);
    s.answers[0].value = 0.2;
    expect(sessionSchema.safeParse(s).success).toBe(false);
  });
  it("rejects duplicates and unissued answers", () => {
    const s = sessionFixture();
    s.questions.push(s.questions[0]);
    expect(sessionSchema.safeParse(s).success).toBe(false);
    s.questions = [];
    s.answers = [
      {
        questionInstanceId: "fake",
        action: "neutral",
        optionId: null,
        value: null,
        answeredAt: s.createdAt,
        requestId: "req",
      },
    ];
    expect(sessionSchema.safeParse(s).success).toBe(false);
  });
  it("selection is pending, with four-hour gate and valid shortlist ID", () => {
    const s = selectedFixture();
    expect(sessionSchema.safeParse(s).success).toBe(true);
    expect(s.outcome.status).toBe("PENDING");
    s.outcome.eligibleAfter = s.selectedAt;
    expect(sessionSchema.safeParse(s).success).toBe(false);
    s.decision.selectedPlaceId = "invented";
    expect(sessionSchema.safeParse(s).success).toBe(false);
  });
  it("enforces precise outcome meaning", () => {
    const s = selectedFixture();
    s.outcome.status = "VISITED_OTHER";
    s.outcome.confirmedAt = "2026-09-24T09:00:00.000Z";
    expect(sessionSchema.safeParse(s).success).toBe(true);
    s.outcome.actualPlaceId = s.decision.selectedPlaceId;
    expect(sessionSchema.safeParse(s).success).toBe(false);
    s.outcome.status = "DID_NOT_EAT_OUT";
    expect(sessionSchema.safeParse(s).success).toBe(false);
  });
  it("freezes selected trail and disallows state skipping", () => {
    const before = selectedFixture();
    const after = structuredClone(before);
    after.revision++;
    after.context.area = "changed";
    expect(() => validateTransition(before, after)).toThrow("immutable");
    const start = sessionFixture();
    expect(() => validateTransition(start, { ...before, revision: 1 })).toThrow(
      "transition",
    );
  });
});
describe("provider absence and content policy", () => {
  it("keeps fixed wording and does not fabricate Places", async () => {
    const signal = new AbortController().signal;
    const q = sessionFixture().questions[0].definition;
    expect(await templateLanguage.phrase(q, signal)).toBe(q.prompt);
    await expect(unconfiguredPlaces.details("place", signal)).rejects.toThrow(
      "PLACES_NOT_CONFIGURED",
    );
  });
  it("keeps persistence and model permissions separate, with expiry", () => {
    const field = {
      persistAllowed: false,
      modelInputAllowed: true,
      expiresAt: "2026-09-24T04:00:00.000Z",
    };
    expect(mayPersist(field, 0)).toBe(false);
    expect(maySendToModel(field, 0)).toBe(true);
    expect(maySendToModel(field, Date.now() + 1e12)).toBe(false);
  });
});
