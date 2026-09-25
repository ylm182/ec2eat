import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocation } from "../lib/context/location";
import { extractRules, validateExtraction } from "../lib/context/calendar";
import {
  bounded,
  calendarEvents,
  GoogleWeatherProvider,
  ProviderFailure,
  VertexGeminiLanguageProvider,
} from "../lib/providers/google-context";
import {
  collectContext,
  type ContextDependencies,
} from "../lib/server/context";
import { KmsTokenVault } from "../lib/server/calendar-oauth";
import { createSessionInput } from "../lib/domain/schema";
import { newSession, applyAnswer } from "../lib/domain/session";
const now = "2026-09-24T04:00:00.000Z";
const events = [
  {
    id: "timed",
    summary: "同事午餐",
    location: "灣仔",
    start: { dateTime: "2026-09-24T04:30:00Z" },
  },
  { id: "day", summary: "Holiday", start: { date: "2026-09-24" } },
];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const signal = () => new AbortController().signal;
const absent: ContextDependencies = {
  weather: async () => {
    throw new ProviderFailure("absent");
  },
  calendar: async () => {
    throw new ProviderFailure("absent");
  },
};
afterEach(() => vi.useRealTimers());
it.each(["meal", "snack", "any"] as const)("preserves explicit dining intent %s in context", async diningIntent => {
  const context = await collectContext("u", { requestId: "intent-test", launchId: "launch", area: "中環", diningIntent }, absent, now);
  expect(context.diningIntent).toBe(diningIntent);
});
describe("M4 context boundaries", () => {
  it("retains explicit search scope without retaining GPS coordinates", async () => {
    for (const searchRadiusM of [3000, 10000] as const) {
      const input = createSessionInput.parse({requestId: "radius", launchId: "open", searchRadiusM,
        location: {latitude: 22.28, longitude: 114.185}});
      const context = await collectContext("u", input, absent, now);
      expect(context.searchRadiusM).toBe(searchRadiusM);
      expect(JSON.stringify(context)).not.toContain("latitude");
    }
    expect(createSessionInput.safeParse({requestId: "r", launchId: "l", area: "中環", searchRadiusM: 50000}).success).toBe(false);
  });

  it("resolves manual centroids and GPS to approximate area without event locations", () => {
    expect(resolveLocation({ area: "灣仔" })).toMatchObject({
      source: "manual",
      location: { latitude: 22.276 },
    });
    expect(
      resolveLocation({ location: { latitude: 22.28, longitude: 114.185 } }),
    ).toMatchObject({ source: "gps", area: "銅鑼灣" });
    expect(() =>
      resolveLocation({ location: { latitude: 0, longitude: 0 } }),
    ).toThrow("OUTSIDE_HK");
    expect(() => resolveLocation({ area: "unknown" })).toThrow();
  });
  it("keeps all-day, past and cancelled events from becoming deadlines", () => {
    expect(extractRules(events, now).nextEventSoon).toBe(true);
    expect(
      extractRules(
        [
          events[1],
          { ...events[0], status: "cancelled" },
          { ...events[0], start: { dateTime: "2026-09-24T03:59:00Z" } },
        ],
        now,
      ).nextEventSoon,
    ).toBe(false);
    expect(
      extractRules(
        [{ ...events[0], start: { dateTime: "2026-09-24T12:30:00+08:00" } }],
        now,
      ).nextEventSoon,
    ).toBe(true);
  });
  it("rejects fabricated evidence and discards unsupported hints", () => {
    expect(() =>
      validateExtraction(
        {
          socialHint: true,
          areaHint: null,
          mealHint: null,
          evidenceIds: ["invented"],
        },
        events,
        now,
      ),
    ).toThrow();
    expect(
      validateExtraction(
        {
          socialHint: false,
          areaHint: "中環",
          mealHint: "dinner",
          evidenceIds: ["timed"],
        },
        events,
        now,
      ),
    ).toMatchObject({ socialHint: true, areaHint: "灣仔", mealHint: "lunch" });
  });
  it("each absent or failing optional context still starts a valid decision", async () => {
    for (const code of ["absent", "failed", "denied"] as const) {
      const fail = async () => {
        throw new ProviderFailure(code);
      };
      const context = await collectContext(
        "u",
        { requestId: "r", launchId: "l", area: "中環" },
        { weather: fail, calendar: fail },
        now,
      );
      expect(context).toMatchObject({
        weather: null,
        calendar: null,
        availability: { weather: code, calendar: code },
      });
      expect(
        newSession({
          id: "s",
          uid: "u",
          launchId: "l",
          area: "中環",
          now,
          context,
        }).questions,
      ).toHaveLength(1);
    }
  });
  it("weather failure preserves Calendar; Calendar failure preserves weather; stores no precise position or raw text", async () => {
    const context = await collectContext(
      "u",
      {
        requestId: "r",
        launchId: "l",
        location: { latitude: 22.2819, longitude: 114.1589 },
      },
      { ...absent, calendar: async () => extractRules(events, now) },
      now,
    );
    expect(context.calendar?.nextEventSoon).toBe(true);
    expect(context.area).toBe("中環");
    expect(JSON.stringify(context)).not.toMatch(
      /latitude|longitude|同事午餐|timed/,
    );
    const other = await collectContext(
      "u",
      { requestId: "r", launchId: "l", area: "灣仔" },
      {
        ...absent,
        weather: async () => ({ condition: "RAIN", temperatureC: 23 }),
      },
      now,
    );
    expect(other.weather?.condition).toBe("RAIN");
    expect(other.calendar).toBeNull();
  });
  it("explicit and neutral answers override weak social context and snapshots remain frozen", async () => {
    const context = await collectContext(
      "u",
      { requestId: "r", launchId: "l", area: "灣仔" },
      { ...absent, calendar: async () => extractRules(events, now) },
      now,
    );
    const original = newSession({
      id: "s",
      uid: "u",
      launchId: "l",
      area: "灣仔",
      now,
      context,
    });
    expect(original.preferences.social).toEqual({
      state: "inferred",
      value: 0.8,
      strength: 0.15,
    });
    const issued = {
      instanceId: "s-q1",
      definition: {
        id: "social-01",
        version: 1,
        dimensionId: "social" as const,
        kind: "binary" as const,
        prompt: "分享？",
        options: [
          { id: "left", label: "個人", value: 0.2 },
          { id: "right", label: "分享", value: 0.8 },
        ],
        contextTags: [],
      },
      issuedAt: now,
    };
    original.questions = [issued];
    for (const action of ["left", "neutral"] as const) {
      const next = applyAnswer(
        original,
        {
          requestId: `r-${action}`,
          expectedRevision: 0,
          questionInstanceId: "s-q1",
          action,
          ...(action === "left" ? { optionId: "left" } : {}),
        },
        now,
      );
      expect(next.preferences.social).toEqual(
        action === "left"
          ? { state: "answered", value: 0.2, strength: 1 }
          : { state: "neutral", value: null, strength: 0 },
      );
      expect(next.context).toEqual(context);
      expect(next.questions[0]).toEqual(issued);
    }
  });
  it("times out an uncooperative optional provider and aborts its signal", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    const work = bounded(20, (s) => {
      captured = s;
      return new Promise(() => {});
    });
    const check = expect(work).rejects.toMatchObject({ code: "failed" });
    await vi.advanceTimersByTimeAsync(21);
    await check;
    expect(captured?.aborted).toBe(true);
  });
  it("Google Weather validates units, ranges and missing fields without inventing sunshine", async () => {
    const transport = vi.fn(async () =>
      json({
        temperature: { degrees: 25, unit: "CELSIUS" },
        relativeHumidity: 80,
        weatherCondition: { type: "RAIN" },
      }),
    );
    const provider = new GoogleWeatherProvider("synthetic-key", transport);
    expect(
      await provider.current({ latitude: 22.28, longitude: 114.16 }, signal()),
    ).toMatchObject({
      condition: "RAIN",
      temperatureC: 25,
      humidity: 80,
      feelsLikeC: null,
    });
    expect(transport.mock.calls[0]).toBeDefined();
    expect(
      await new GoogleWeatherProvider("x", async () => json({})).current(
        { latitude: 22, longitude: 114 },
        signal(),
      ),
    ).toMatchObject({ condition: "UNKNOWN", temperatureC: null });
    await expect(
      new GoogleWeatherProvider("x", async () =>
        json({ relativeHumidity: 101 }),
      ).current({ latitude: 22, longitude: 114 }, signal()),
    ).rejects.toThrow();
  });
  it("Calendar requests primary expanded events, bounded pagination and minimal fields", async () => {
    const calls: string[] = [];
    const result = await calendarEvents(
      "synthetic-access",
      now,
      signal(),
      async (url) => {
        calls.push(String(url));
        return json(
          calls.length === 1
            ? { items: [events[0]], nextPageToken: "p2" }
            : { items: [events[1]] },
        );
      },
    );
    expect(result).toHaveLength(2);
    const url = new URL(calls[0]);
    expect(url.pathname).toContain("/primary/events");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("timeMin")).toBe("2026-09-24T01:00:00.000Z");
    expect(url.searchParams.get("timeMax")).toBe("2026-09-24T10:00:00.000Z");
    expect(url.searchParams.get("fields")).not.toMatch(/attendees|description/);
    expect(new URL(calls[1]).searchParams.get("pageToken")).toBe("p2");
    let pages = 0;
    await expect(
      calendarEvents("x", now, signal(), async () => {
        pages++;
        return json({ items: [], nextPageToken: "again" });
      }),
    ).rejects.toThrow();
    expect(pages).toBe(3);
  });
  it("Gemini uses pinned Vertex model, minimal thinking and bounded output, with one repair", async () => {
    const requests: { url: string; body: any }[] = [];
    const provider = new VertexGeminiLanguageProvider(
      "test-project",
      "global",
      async () => "synthetic-token",
      async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        return json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      requests.length === 1
                        ? "invalid"
                        : JSON.stringify({
                            socialHint: true,
                            areaHint: "灣仔",
                            mealHint: "lunch",
                            evidenceIds: ["timed"],
                          }),
                  },
                ],
              },
            },
          ],
        });
      },
    );
    expect(await provider.extractEvents(events, now, signal())).toMatchObject({
      nextEventSoon: true,
      socialHint: true,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain(
      "/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(requests[0].body.generationConfig).toMatchObject({
      maxOutputTokens: 512,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
  });
  it("Gemini unavailable, malformed and timed-out responses deterministically fall back", async () => {
    for (const transport of [
      async () => json({}, 503),
      async () => json({ candidates: [] }),
    ])
      expect(
        await new VertexGeminiLanguageProvider(
          "test-project",
          "global",
          async () => "x",
          transport,
        ).extractEvents(events, now, signal()),
      ).toEqual(extractRules(events, now));
    vi.useFakeTimers();
    const pending = new VertexGeminiLanguageProvider(
      "test-project",
      "global",
      async () => "x",
      async () => new Promise(() => {}),
    ).extractEvents(events, now, signal());
    await vi.advanceTimersByTimeAsync(4001);
    expect(await pending).toEqual(extractRules(events, now));
  });
  it("KMS binds encrypted refresh tokens to UID via authenticated data", async () => {
    const calls: any[] = [];
    const vault = new KmsTokenVault(
      "projects/test-project/locations/asia-east1/keyRings/test/cryptoKeys/calendar",
      async () => "synthetic-adc",
      async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return json(
          String(url).endsWith(":encrypt")
            ? { ciphertext: "encrypted-fixture" }
            : {
                plaintext: Buffer.from("synthetic-refresh").toString("base64"),
              },
        );
      },
    );
    expect(await vault.seal("alice", "synthetic-refresh", signal())).toBe(
      "encrypted-fixture",
    );
    expect(await vault.open("alice", "encrypted-fixture", signal())).toBe(
      "synthetic-refresh",
    );
    expect(calls[0].body.additionalAuthenticatedData).toBe(
      Buffer.from("ec2eat-calendar:alice").toString("base64"),
    );
    expect(calls[1].body.additionalAuthenticatedData).toBe(
      calls[0].body.additionalAuthenticatedData,
    );
  });
});
