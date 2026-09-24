"use client";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import type { DecisionSession } from "@/lib/domain/schema";
import {
  authorizedJson,
  decisionApi,
  DecisionApiError,
} from "@/lib/client/decision-api";
import { currentLaunchId } from "@/lib/client/launch";
import { canConfirm, outcomeInput } from "@/lib/outcomes/contracts";
import {
  restaurantCardSchema,
  type RestaurantCard,
} from "@/lib/restaurants/types";
import { hongKongTime, outcomeLabels } from "@/lib/history/schema";
export function OutcomeForm({
  uid,
  session: initial,
  onSaved,
}: {
  uid: string;
  session: DecisionSession;
  onSaved?: () => void;
}) {
  const radioGroup = useId();
  const [session, setSession] = useState(initial);
  const [launch, setLaunch] = useState(currentLaunchId);
  const [other, setOther] = useState(false),
    [query, setQuery] = useState("");
  const [cards, setCards] = useState<RestaurantCard[]>([]),
    [lookup, setLookup] = useState<string | null>(null),
    [actual, setActual] = useState<string | null>(null);
  const [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const pending = useRef<z.infer<typeof outcomeInput> | null>(null),
    lock = useRef(false);
  useEffect(() => {
    setSession(initial);
  }, [initial]);
  useEffect(() => {
    const changed = () => setLaunch(currentLaunchId());
    window.addEventListener("ec2eat:opening", changed);
    return () => window.removeEventListener("ec2eat:opening", changed);
  }, []);
  const eligible = canConfirm(session, launch, Date.now());
  useEffect(() => {
    setCards([]);
    setLookup(null);
    setActual(null);
    setSearchError("");
    if (!other || query.trim().length < 2 || !eligible) {
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void authorizedJson(
        uid,
        "/api/restaurants/search",
        {
          requestId: crypto.randomUUID(),
          sessionId: session.id,
          launchId: launch,
          query: query.trim(),
        },
        abort.signal,
      )
        .then((data) => {
          const result = z
            .object({
              cards: z.array(restaurantCardSchema).max(5),
              lookupRequestId: z.string(),
            })
            .parse(data);
          if (!abort.signal.aborted) {
            setCards(result.cards);
            setLookup(result.lookupRequestId);
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            setSearchError(
              e instanceof Error ? e.message : "搜尋暫時不可用；可以先留空。",
            );
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [uid, session.id, launch, other, query, eligible]);
  function publish(s: DecisionSession) {
    setSession(s);
    window.dispatchEvent(new CustomEvent("ec2eat:outcome", { detail: s }));
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const s = await decisionApi(uid, "/api/decision/sessions/" + session.id);
      pending.current = null;
      publish(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能載入。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(
    action: "VISITED_SELECTED" | "VISITED_OTHER" | "DID_NOT_EAT_OUT" | "snooze",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const body = pending.current ?? {
      requestId: crypto.randomUUID(),
      launchId: launch,
      expectedRevision: session.revision,
      expectedOutcomeRevision: session.outcome.revision,
      ...(action === "snooze"
        ? { snooze: true as const }
        : {
            status: action,
            ...(action === "VISITED_OTHER"
              ? {
                  actualPlaceId: actual,
                  ...(actual && lookup ? { lookupRequestId: lookup } : {}),
                }
              : {}),
          }),
    };
    pending.current = body;
    try {
      const next = await decisionApi(
        uid,
        "/api/decision/sessions/" + session.id + "/outcome",
        body,
      );
      pending.current = null;
      publish(next);
      setSuccess(
        body.snooze
          ? "仍然未確認，至少24小時後另一次開啟先再提醒。"
          : "已儲存用餐結果。",
      );
      setOther(false);
      setQuery("");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能儲存，請重試。");
      if (
        e instanceof DecisionApiError &&
        [
          "STALE_REVISION",
          "OUTCOME_NOT_ELIGIBLE",
          "INVALID_ACTUAL_PLACE",
          "INVALID_STATE",
        ].includes(e.code)
      ) {
        pending.current = null;
        try {
          publish(
            await decisionApi(uid, "/api/decision/sessions/" + session.id),
          );
        } catch {
          /* Keep original error. */
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!eligible)
    return (
      <p className="hint">
        選擇至少四小時後，喺另一次開啟先可以確認或更正。最早確認時間：
        {hongKongTime(session.outcome.eligibleAfter!)}（香港時間）。
      </p>
    );
  return (
    <section className="outcome-form" aria-label="確認用餐結果">
      <p>目前結果：{outcomeLabels[session.outcome.status]}</p>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
      {pending.current ? (
        <>
          <button disabled={busy} onClick={() => save("VISITED_SELECTED")}>
            {busy ? "儲存中…" : "重試原本確認"}
          </button>
          <button disabled={busy} onClick={reload}>
            重新載入結果
          </button>
        </>
      ) : (
        <>
          <div className="outcome-actions">
            <button disabled={busy} onClick={() => save("VISITED_SELECTED")}>
              有，去了所選餐廳
            </button>
            <button
              disabled={busy}
              onClick={() => setOther((v) => !v)}
              aria-expanded={other}
            >
              去了其他地方
            </button>
            <button disabled={busy} onClick={() => save("DID_NOT_EAT_OUT")}>
              最後沒有外食
            </button>
            {session.outcome.status === "PENDING" && (
              <button disabled={busy} onClick={() => save("snooze")}>
                遲啲先（24小時）
              </button>
            )}
          </div>
          {other && (
            <div>
              <label>
                實際餐廳（可留空）
                <input
                  value={query}
                  maxLength={80}
                  disabled={busy}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActual(null);
                    setLookup(null);
                    setCards([]);
                  }}
                  placeholder="輸入至少兩個字搜尋"
                />
              </label>
              {searching && <p role="status">搜尋中…</p>}
              {searchError && <p role="status">{searchError}</p>}
              {!searching &&
                query.trim().length >= 2 &&
                !cards.length &&
                !searchError && <p>未搵到餐廳，可以先唔填。</p>}
              <div className="actual-options">
                <label>
                  <input
                    type="radio"
                    name={radioGroup}
                    checked={actual === null}
                    onChange={() => setActual(null)}
                    disabled={busy}
                  />
                  先唔填實際餐廳
                </label>
                {cards.map((c) => (
                  <div key={c.placeId}>
                    <label>
                      <input
                        type="radio"
                        name={radioGroup}
                        checked={actual === c.placeId}
                        onChange={() => setActual(c.placeId)}
                        disabled={busy}
                      />
                      {c.name ?? c.placeId}
                      {c.source === "synthetic" ? "（合成測試）" : ""} ·{" "}
                      {c.address ?? "地址未知"}
                    </label>
                    {c.source === "google-places" && (
                      <div className="places-attribution">
                        <span translate="no">Google Maps</span>
                        {c.attributions.map((a, i) => (
                          <p key={i}>
                            {a.uri ? (
                              <a
                                href={a.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {a.name}
                              </a>
                            ) : (
                              a.name
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || (!!actual && !lookup)}
                onClick={() => save("VISITED_OTHER")}
              >
                儲存：去了其他地方{actual ? "" : "（餐廳未填）"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
