"use client";
import { useEffect, useRef, useState } from "react";
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
      <h1 className="small-title">{text.heading}</h1>
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
  async function start() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const body = createRequest.current ?? {
        requestId: crypto.randomUUID(),
        launchId: crypto.randomUUID(),
        area,
      };
      createRequest.current = body;
      sessionStorage.setItem(createKey, JSON.stringify(body));
      const next = await decisionApi(uid, "/api/decision/sessions", body);
      sessionStorage.setItem(key, next.id);
      sessionStorage.removeItem(createKey);
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
    };
    stopRequest.current = body;
    try {
      await decisionApi(
        uid,
        `/api/decision/sessions/${session.id}/recommend`,
        body,
      );
    } catch (e) {
      if (
        !(
          e instanceof DecisionApiError &&
          ["PLACES_NOT_CONFIGURED", "STALE_REVISION"].includes(e.code)
        )
      ) {
        setError(e instanceof Error ? e.message : text.error);
        return;
      }
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
  if (loading) return <p role="status">{text.resume}</p>;
  const question = session?.questions.at(-1);
  return (
    <section className="live-decision">
      {error && <p role="alert">{error}</p>}
      {!session ? (
        <>
          <label htmlFor="area">{text.areaLabel}</label>
          <select
            id="area"
            value={area}
            disabled={busy || !!createRequest.current}
            onChange={(e) => setArea(e.target.value)}
          >
            <option value="">{text.chooseArea}</option>
            {manualAreas.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <p className="hint">{text.context}</p>
          <button className="primary" disabled={busy || !area} onClick={start}>
            {busy
              ? text.loading
              : createRequest.current
                ? text.retry
                : text.start}
          </button>
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
          <p role="status">{text.unavailable}</p>
          <h2>{text.trail}</h2>
          <ol>
            {session.answers.map((a) => {
              const q = session.questions.find(
                (q) => q.instanceId === a.questionInstanceId,
              )!;
              return (
                <li key={a.questionInstanceId}>
                  {q.definition.prompt}{" "}
                  {a.action === "neutral"
                    ? text.either
                    : q.definition.options.find((o) => o.id === a.optionId)
                        ?.label}
                </li>
              );
            })}
          </ol>
          <button
            className="text-button"
            onClick={() => {
              sessionStorage.removeItem(key);
              setSession(null);
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
