"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { currentLaunchId } from "@/lib/client/launch";
import { RestaurantResults } from "./RestaurantResults";
import { EntrySwipe } from "./EntrySwipe";
import { Loading } from "./Loading";
import { resolveLocation } from "@/lib/context/location";
import { Account } from "./Account";
import {
  DecisionSwipeCard,
  DecisionCategoryCard,
  type SwipeSubmission,
} from "./DecisionSwipeCard";
import { decisionApi, DecisionApiError } from "@/lib/client/decision-api";
import {
  createSessionInput,
  idSchema,
  type DecisionSession,
} from "@/lib/domain/schema";
import { manualAreas } from "@/lib/domain/areas";
import { decisionCopy as text } from "@/lib/decision-copy";
export function DecisionFlow() {
  const [uid, setUid] = useState<string | null>(null);
  return (
    <>

      <Account onAuthorizationChange={setUid} />
      {uid ? (
        <AuthenticatedDecision key={uid} uid={uid} />
      ) : (
        <p>{text.login}</p>
      )}
    </>
  );
}
function AuthenticatedDecision({ uid }: { uid: string }) {
  const [session, setSession] = useState<DecisionSession | null>(null);
  const [area, setArea] = useState("");
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [recoverId, setRecoverId] = useState<string | null>(null);
  async function locate() {
    if (!navigator.geolocation) {
      setLocationMessage("瀏覽器未能定位，請手動揀地區。");
      return;
    }
    setLocating(true);
    setLocationMessage("定位中…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          const resolved = resolveLocation({ location: coords });
          setLocation(coords);
          setArea(resolved.area);
          setLocationMessage(`定位約喺${resolved.area}附近。只會儲存地區。`);
        } catch {
          setLocation(null);
          setLocationMessage("未能確認香港範圍，請手動揀地區。");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocation(null);
        setLocationMessage("定位未獲批准或暫時不可用，請手動揀地區。");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 },
    );
  }

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const response = useRef<DecisionSession | null>(null);
  const createRequest = useRef<ReturnType<
    typeof createSessionInput.parse
  > | null>(null);
  const stopRequest = useRef<{
    requestId: string;
    expectedRevision: number;
    reason: "user_requested";
  } | null>(null);
  const key = `ec2eat.session.${uid}`;
  const createKey = `ec2eat.create.${uid}`;
  async function restore(signal?: AbortSignal) {
    const saved = sessionStorage.getItem(key);
    if (saved && idSchema.safeParse(saved).success)
      setSession(
        await decisionApi(
          uid,
          `/api/decision/sessions/${saved}`,
          undefined,
          signal,
        ),
      );
    const recovery = sessionStorage.getItem(`${createKey}.recovery`);
    if (recovery && idSchema.safeParse(recovery).success) {
      setRecoverId(recovery);
      const restored = await decisionApi(
        uid,
        `/api/decision/requests/${recovery}`,
        undefined,
        signal,
      );
      setSession(restored);
      sessionStorage.setItem(key, restored.id);
      sessionStorage.removeItem(`${createKey}.recovery`);
      setRecoverId(null);
    }
    const pending = sessionStorage.getItem(createKey);
    if (pending) {
      const parsed = createSessionInput.safeParse(JSON.parse(pending));
      if (parsed.success) {
        createRequest.current = parsed.data;
        setArea(parsed.data.area ?? "");
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void restore(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : text.error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // This component is keyed by verified UID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function start(searchRadiusM: 3000 | 10000 = 3000) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const body = createRequest.current ?? {
        requestId: crypto.randomUUID(),
        launchId: currentLaunchId(),
        searchRadiusM,
        ...(location ? { location } : { area }),
      };
      createRequest.current = body;
      if (body.location)
        sessionStorage.setItem(`${createKey}.recovery`, body.requestId);
      else sessionStorage.setItem(createKey, JSON.stringify(body));
      const next = await decisionApi(uid, "/api/decision/sessions", body);
      sessionStorage.setItem(key, next.id);
      sessionStorage.removeItem(createKey);
      sessionStorage.removeItem(`${createKey}.recovery`);
      createRequest.current = null;
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : text.error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit(answer: SwipeSubmission, signal: AbortSignal) {
    locked.current = true;
    setBusy(true);
    try {
      response.current = await decisionApi(
        uid,
        `/api/decision/sessions/${session!.id}/answers`,
        answer,
        signal,
      );
    } catch (e) {
      if (
        e instanceof DecisionApiError &&
        ["STALE_REVISION", "INVALID_STATE"].includes(e.code)
      ) {
        const fresh = await decisionApi(
          uid,
          `/api/decision/sessions/${session!.id}`,
          undefined,
          signal,
        );
        if (fresh.revision !== session!.revision) {
          setSession(fresh);
          locked.current = false;
          setBusy(false);
        }
      }
      throw e;
    }
  }
  function answered() {
    if (response.current) setSession(response.current);
    response.current = null;
    locked.current = false;
    setBusy(false);
  }
  async function showOptions() {
    if (!session || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const body = stopRequest.current ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: session.revision,
      reason: "user_requested" as const,
      ...(location ? { location } : {}),
    };
    stopRequest.current = body;
    try {
      await decisionApi(
        uid,
        `/api/decision/sessions/${session.id}/recommend`,
        body,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : text.error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
    try {
      setSession(
        await decisionApi(uid, `/api/decision/sessions/${session.id}`),
      );
      stopRequest.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : text.error);
    }
  }
  async function recover() {
    setLoading(true);
    setError("");
    try {
      await restore();
    } catch (e) {
      setError(e instanceof Error ? e.message : text.error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!loading && !session && !recoverId && !createRequest.current) void locate();
    // Request fresh location for every new decision, never persist coordinates.
  }, [loading, session?.id, recoverId]);
  if (loading) return <Loading label="載入中" />;
  const question = session?.questions.at(-1);
  return (
    <section className="live-decision">
      {error && <p role="alert">{error}</p>}
      {recoverId && !session ? (
        <div>
          <p>正在恢復上次定位建立嘅選擇。精確位置冇儲存喺瀏覽器。</p>
          <button onClick={recover}>重新載入已儲存選擇</button>
          <button
            onClick={() => {
              sessionStorage.removeItem(`${createKey}.recovery`);
              setRecoverId(null);
              setError("");
            }}
          >
            放棄恢復，重新開始
          </button>
        </div>
      ) : null}
      {session && <div className="session-meta">{session.context.area}{session.context.availability.fixture === "available" ? " · 測試" : ""}{session.context.weather?.provenance.source === "google-weather" && <span> · Google Weather</span>}</div>}
      {!session ? (
        <>
          {locating && <Loading label="定位中" />}
          {!location && !locating && <p className="hint">{locationMessage}</p>}
          <label className="sr-only" htmlFor="area">{text.areaLabel}</label>
          <select
            id="area"
            value={area}
            disabled={
              busy || locating || !!createRequest.current || !!recoverId
            }
            onChange={(e) => {
              setArea(e.target.value);
              setLocation(null);
              setLocationMessage("");
            }}
          >
            <option value="">{text.chooseArea}</option>
            {manualAreas.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <EntrySwipe kind="range" disabled={busy || locating || !!recoverId || !area}
            onChoose={(direction) => void start(direction === "left" ? 3000 : 10000)} />
          {busy && <Loading label="準備中" />}

        </>
      ) : session.status === "QUESTIONING" && question ? (
        <>
          {question.definition.kind === "binary" ? (
            <DecisionSwipeCard
              question={question}
              expectedRevision={session.revision}
              progress={session.answers.length + 1}
              onSubmit={submit}
              onAnswered={answered}
            />
          ) : (
            <DecisionCategoryCard
              question={question}
              expectedRevision={session.revision}
              progress={session.answers.length + 1}
              onSubmit={submit}
              onAnswered={answered}
            />
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={showOptions}
          >
            {text.show}
          </button>
        </>
      ) : (
        <>
          <RestaurantResults
            key={session.id}
            uid={uid}
            session={session}
            location={location}
            onSession={(next) => {
              setSession(next);
              setError("");
            }}
            skipAuto={!!error}
          />
          {session.status === "SELECTED" && (
            <p>
              <Link href="/history">睇返已選擇記錄 →</Link>
            </p>
          )}
          <button
            className="text-button"
            onClick={() => {
              sessionStorage.removeItem(key);
              setSession(null);
              setLocation(null);
              setError("");
            }}
          >
            {text.newDecision}
          </button>
        </>
      )}
    </section>
  );
}
